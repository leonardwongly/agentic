import { mkdtemp } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { ApprovalRequestSchema, SYSTEM_USER_ID } from "@agentic/contracts";
import { processUserRequest } from "@agentic/orchestrator";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { POST as previewBatchRoute } from "../apps/web/app/api/approvals/batch/preview/route";
import { POST as respondBatchRoute } from "../apps/web/app/api/approvals/batch/respond/route";
import { buildAuthorizedJsonRequest, createRouteTestRepository, expectNoStoreHeaders } from "./route-test-helpers";

describe("approval batch routes", () => {
  const originalAccessKey = process.env.AGENTIC_ACCESS_KEY;
  const originalRuntimeStorePath = process.env.AGENTIC_RUNTIME_STORE_PATH;

  async function createApproval(riskClass: "R1" | "R2" | "R3" | "R4", expiryAt?: string, userId = SYSTEM_USER_ID) {
    const repository = createRouteTestRepository();
    const bundle = await processUserRequest({
      userId,
      request: "Review my inbox and draft an external response.",
      memories: await repository.listMemory(userId),
      integrations: await repository.listIntegrations(userId)
    });
    const approval = ApprovalRequestSchema.parse({
      ...bundle.approvals[0]!,
      riskClass,
      expiryAt: expiryAt ?? bundle.approvals[0]!.expiryAt
    });
    const updatedBundle = {
      ...bundle,
      approvals: [approval]
    };

    await repository.saveGoalBundle(updatedBundle);
    return approval;
  }

  beforeEach(async () => {
    process.env.AGENTIC_ACCESS_KEY = "test-access-key";
    process.env.AGENTIC_RUNTIME_STORE_PATH = path.join(
      await mkdtemp(path.join(os.tmpdir(), "agentic-approval-batch-route-")),
      "runtime-store.json"
    );
    Reflect.set(globalThis, "__agenticRepository", undefined);
  });

  afterEach(() => {
    process.env.AGENTIC_ACCESS_KEY = originalAccessKey;
    process.env.AGENTIC_RUNTIME_STORE_PATH = originalRuntimeStorePath;
    Reflect.set(globalThis, "__agenticRepository", undefined);
  });

  it("previews affected systems and blocks R4 batch approval by default", async () => {
    await createRouteTestRepository().seedDefaults(SYSTEM_USER_ID);
    const approval = await createApproval("R4");

    Reflect.set(globalThis, "__agenticRepository", undefined);

    const response = await previewBatchRoute(
      buildAuthorizedJsonRequest("http://localhost/api/approvals/batch/preview", {
        approvalIds: [approval.id],
        decision: "approved"
      })
    );
    const payload = (await response.json()) as {
      preview: {
        blocked: boolean;
        riskCounts: { R4: number };
        blockers: string[];
        affectedSystems: string[];
      };
    };

    expect(response.status).toBe(200);
    expectNoStoreHeaders(response);
    expect(payload.preview.blocked).toBe(true);
    expect(payload.preview.riskCounts.R4).toBe(1);
    expect(payload.preview.blockers).toContain("R4 approvals cannot be approved through batch actions.");
    expect(payload.preview.affectedSystems.length).toBeGreaterThan(0);
  });

  it("does not expose another user's approval in a batch preview", async () => {
    await createRouteTestRepository().seedDefaults(SYSTEM_USER_ID);
    await createRouteTestRepository().seedDefaults("other-user");
    const otherApproval = await createApproval("R2", undefined, "other-user");

    Reflect.set(globalThis, "__agenticRepository", undefined);

    const response = await previewBatchRoute(
      buildAuthorizedJsonRequest("http://localhost/api/approvals/batch/preview", {
        approvalIds: [otherApproval.id],
        decision: "rejected"
      })
    );
    const payload = (await response.json()) as {
      preview: {
        actionableCount: number;
        staleOrSkippedItems: Array<{ requestedId: string; reason: string }>;
      };
    };

    expect(response.status).toBe(200);
    expect(payload.preview.actionableCount).toBe(0);
    expect(payload.preview.staleOrSkippedItems).toEqual([
      expect.objectContaining({
        requestedId: otherApproval.id,
        reason: "not_found_or_forbidden"
      })
    ]);
  });

  it("requires explicit confirmation for R3 approval batches", async () => {
    await createRouteTestRepository().seedDefaults(SYSTEM_USER_ID);
    const approval = await createApproval("R3");

    Reflect.set(globalThis, "__agenticRepository", undefined);

    const rejectedResponse = await respondBatchRoute(
      buildAuthorizedJsonRequest("http://localhost/api/approvals/batch/respond", {
        approvalIds: [approval.id],
        decision: "approved",
        scope: "once"
      })
    );
    const rejectedPayload = (await rejectedResponse.json()) as { error: string };

    expect(rejectedResponse.status).toBe(409);
    expect(rejectedPayload.error).toMatch(/CONFIRM R3 BATCH/);

    const acceptedResponse = await respondBatchRoute(
      buildAuthorizedJsonRequest("http://localhost/api/approvals/batch/respond", {
        approvalIds: [approval.id],
        decision: "approved",
        scope: "once",
        confirmationText: "CONFIRM R3 BATCH"
      })
    );
    const acceptedPayload = (await acceptedResponse.json()) as {
      resultCounts: { succeeded: number; failed: number; skipped: number };
      batchId: string;
    };

    expect(acceptedResponse.status).toBe(202);
    expect(acceptedPayload.resultCounts).toEqual({ succeeded: 1, failed: 0, skipped: 0 });
    expect(acceptedPayload.batchId).toMatch(/^approval-batch-/);
    expectNoStoreHeaders(acceptedResponse);

    const repository = createRouteTestRepository();
    const reloaded = await repository.getGoalBundleForUser(approval.goalId, SYSTEM_USER_ID);
    expect(reloaded?.actionLogs.some((log) => log.kind === "approval.batch_response")).toBe(true);
  });

  it("returns partial-failure detail for stale or expired items", async () => {
    await createRouteTestRepository().seedDefaults(SYSTEM_USER_ID);
    const actionable = await createApproval("R2");
    const expired = await createApproval("R2", "2020-01-01T00:00:00.000Z");

    Reflect.set(globalThis, "__agenticRepository", undefined);

    const response = await respondBatchRoute(
      buildAuthorizedJsonRequest("http://localhost/api/approvals/batch/respond", {
        approvalIds: [actionable.id, expired.id],
        decision: "rejected",
        scope: "once",
        rationale: "Keep this path manual until the stale request is reviewed."
      })
    );
    const payload = (await response.json()) as {
      resultCounts: { succeeded: number; failed: number; skipped: number };
      preview: { staleOrSkippedItems: Array<{ approvalId: string; reason: string }> };
    };

    expect(response.status).toBe(207);
    expect(payload.resultCounts).toEqual({ succeeded: 1, failed: 0, skipped: 1 });
    expect(payload.preview.staleOrSkippedItems).toEqual([
      expect.objectContaining({
        approvalId: expired.id,
        reason: "expired"
      })
    ]);
  });
});
