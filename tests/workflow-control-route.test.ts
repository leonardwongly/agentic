import { mkdtemp } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { DEFAULT_OWNER_USER_ID, type ActionLog } from "@agentic/contracts";
import { processUserRequest } from "@agentic/orchestrator";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { AGENTIC_ACCESS_KEY_HEADER } from "../apps/web/lib/auth";
import { resetAuthSessionStateStoreForTesting } from "../apps/web/lib/auth-session-store";
import { POST as workflowControlRoute } from "../apps/web/app/api/goals/[id]/workflow-control/route";
import { buildAuthorizedJsonRequest, createRouteTestRepository } from "./route-test-helpers";

function control(goalId: string, body: unknown) {
  return workflowControlRoute(
    buildAuthorizedJsonRequest(`http://localhost/api/goals/${goalId}/workflow-control`, body),
    { params: Promise.resolve({ id: goalId }) }
  );
}

async function seedGoal() {
  const repository = createRouteTestRepository();
  await repository.seedDefaults(DEFAULT_OWNER_USER_ID);
  const bundle = await processUserRequest({
    userId: DEFAULT_OWNER_USER_ID,
    request: "Plan my week and prepare for the key client meetings.",
    memories: await repository.listMemory(DEFAULT_OWNER_USER_ID),
    integrations: await repository.listIntegrations(DEFAULT_OWNER_USER_ID)
  });
  await repository.saveGoalBundle(bundle);
  return bundle;
}

describe("workflow control route (AOS-25)", () => {
  const originalAccessKey = process.env.AGENTIC_ACCESS_KEY;
  const originalRuntimeStorePath = process.env.AGENTIC_RUNTIME_STORE_PATH;

  beforeEach(async () => {
    process.env.AGENTIC_ACCESS_KEY = "test-access-key";
    process.env.AGENTIC_RUNTIME_STORE_PATH = path.join(
      await mkdtemp(path.join(os.tmpdir(), "agentic-workflow-control-")),
      "runtime-store.json"
    );
    Reflect.set(globalThis, "__agenticRepository", undefined);
    Reflect.set(globalThis, "__agenticSelfImprovementRepository", undefined);
  });

  afterEach(() => {
    process.env.AGENTIC_ACCESS_KEY = originalAccessKey;
    process.env.AGENTIC_RUNTIME_STORE_PATH = originalRuntimeStorePath;
    Reflect.set(globalThis, "__agenticRepository", undefined);
    Reflect.set(globalThis, "__agenticSelfImprovementRepository", undefined);
    resetAuthSessionStateStoreForTesting();
  });

  it("pauses a goal workflow and reflects it in the projection", async () => {
    const bundle = await seedGoal();
    const response = await control(bundle.goal.id, { action: "pause", reason: "operator review" });

    expect(response.status).toBe(200);
    const payload = (await response.json()) as {
      control: { action: string; status: string; compensations: string[] };
      workflowDag: { status: string } | null;
    };
    expect(payload.control.status).toBe("paused");
    expect(payload.workflowDag?.status).toBe("paused");
  });

  it("cancels a goal workflow and emits compensation hints from completed steps", async () => {
    const bundle = await seedGoal();
    const response = await control(bundle.goal.id, { action: "cancel", reason: "duplicate run" });

    expect(response.status).toBe(200);
    const payload = (await response.json()) as { control: { status: string } };
    expect(payload.control.status).toBe("cancelled");
  });

  it("persists the control as an append-only workflow.dag.control action log", async () => {
    const bundle = await seedGoal();
    await control(bundle.goal.id, { action: "pause" });

    const repository = createRouteTestRepository();
    const reloaded = await repository.getGoalBundleForUser(bundle.goal.id, DEFAULT_OWNER_USER_ID);
    const controlLogs = (reloaded?.actionLogs ?? []).filter((log: ActionLog) => log.kind === "workflow.dag.control");

    expect(controlLogs).toHaveLength(1);
    expect((controlLogs[0]?.details as { action?: string }).action).toBe("pause");
  });

  it("rejects an unauthenticated request", async () => {
    const bundle = await seedGoal();
    const response = await workflowControlRoute(
      new Request(`http://localhost/api/goals/${bundle.goal.id}/workflow-control`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: "pause" })
      }),
      { params: Promise.resolve({ id: bundle.goal.id }) }
    );

    expect(response.status).toBe(401);
  });

  it("returns 404 for an unknown goal", async () => {
    await seedGoal();
    const response = await control("nonexistent-goal-id", { action: "pause" });
    expect(response.status).toBe(404);
  });

  it("rejects an invalid action", async () => {
    const bundle = await seedGoal();
    const response = await control(bundle.goal.id, { action: "destroy-everything" });
    expect(response.status).toBe(400);
  });
});
