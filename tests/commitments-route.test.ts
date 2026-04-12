import { mkdtemp } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { SYSTEM_USER_ID } from "@agentic/contracts";
import { createRepository } from "@agentic/repository";
import { processUserRequest } from "@agentic/orchestrator";
import { AGENTIC_ACCESS_KEY_HEADER } from "../apps/web/lib/auth";
import { GET as commitmentInboxRoute } from "../apps/web/app/api/commitments/route";
import { PATCH as commitmentUpdateRoute } from "../apps/web/app/api/commitments/[id]/route";

describe("commitments route", () => {
  const originalAccessKey = process.env.AGENTIC_ACCESS_KEY;
  const originalRuntimeStorePath = process.env.AGENTIC_RUNTIME_STORE_PATH;

  async function createGoalForUser(
    repository: ReturnType<typeof createRepository>,
    userId: string,
    request: string
  ) {
    const bundle = await processUserRequest({
      userId,
      request,
      memories: await repository.listMemory(userId),
      integrations: await repository.listIntegrations(userId)
    });

    await repository.saveGoalBundle(bundle);
    return bundle;
  }

  beforeEach(async () => {
    process.env.AGENTIC_ACCESS_KEY = "test-access-key";
    process.env.AGENTIC_RUNTIME_STORE_PATH = path.join(
      await mkdtemp(path.join(os.tmpdir(), "agentic-commitments-route-")),
      "runtime-store.json"
    );
    Reflect.set(globalThis, "__agenticRepository", undefined);
  });

  afterEach(() => {
    process.env.AGENTIC_ACCESS_KEY = originalAccessKey;
    process.env.AGENTIC_RUNTIME_STORE_PATH = originalRuntimeStorePath;
    Reflect.set(globalThis, "__agenticRepository", undefined);
  });

  function buildPatchRequest(commitmentId: string, body: unknown) {
    return new Request(`http://localhost/api/commitments/${commitmentId}`, {
      method: "PATCH",
      headers: {
        "content-type": "application/json",
        [AGENTIC_ACCESS_KEY_HEADER]: "test-access-key"
      },
      body: JSON.stringify(body)
    });
  }

  function buildGetRequest(query = "") {
    const suffix = query.length > 0 ? `?${query}` : "";
    return new Request(`http://localhost/api/commitments${suffix}`, {
      method: "GET",
      headers: {
        [AGENTIC_ACCESS_KEY_HEADER]: "test-access-key"
      }
    });
  }

  it("returns a server-derived commitments inbox page with bucket counts", async () => {
    const repository = createRepository({
      storePath: process.env.AGENTIC_RUNTIME_STORE_PATH
    });

    await repository.seedDefaults(SYSTEM_USER_ID);
    await createGoalForUser(repository, SYSTEM_USER_ID, "Review my inbox and send one external reply.");
    await repository.saveCommitment({
      id: "commitment-manual-low-confidence",
      userId: SYSTEM_USER_ID,
      title: "Follow up later",
      summary: "Needs explicit confirmation",
      status: "pending",
      sourceKind: "goal",
      sourceId: "manual-low-confidence",
      goalId: null,
      approvalId: null,
      dueAt: null,
      confidence: 0.33,
      evidence: [
        {
          section: "goals",
          itemId: "manual-low-confidence",
          label: "Follow up later"
        }
      ],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    });

    Reflect.set(globalThis, "__agenticRepository", undefined);

    const response = await commitmentInboxRoute(buildGetRequest("bucket=low_confidence&limit=5"));
    const payload = (await response.json()) as {
      inbox: {
        bucket: string;
        totalCount: number;
        counts: Record<string, number>;
        items: Array<{ id: string }>;
      };
    };

    expect(response.status).toBe(200);
    expect(payload.inbox.bucket).toBe("low_confidence");
    expect(payload.inbox.totalCount).toBe(2);
    expect(payload.inbox.counts.unresolved).toBeGreaterThanOrEqual(2);
    expect(payload.inbox.items).toEqual(expect.arrayContaining([
      expect.objectContaining({
        id: "commitment-manual-low-confidence"
      })
    ]));
  });

  it("rejects invalid commitments inbox queries", async () => {
    const response = await commitmentInboxRoute(buildGetRequest("bucket=unknown"));
    const payload = (await response.json()) as { error?: string };

    expect(response.status).toBe(400);
    expect(payload.error).toContain("Invalid");
  });

  it("rejects malformed commitments inbox cursors", async () => {
    const repository = createRepository({
      storePath: process.env.AGENTIC_RUNTIME_STORE_PATH
    });

    await repository.seedDefaults(SYSTEM_USER_ID);
    await createGoalForUser(repository, SYSTEM_USER_ID, "Review my inbox and send one external reply.");
    Reflect.set(globalThis, "__agenticRepository", undefined);

    const response = await commitmentInboxRoute(buildGetRequest("cursor=not-a-valid-cursor"));
    const payload = (await response.json()) as { error?: string };

    expect(response.status).toBe(400);
    expect(payload.error).toContain("cursor is invalid");
  });

  it("completes a derived commitment and returns refreshed dashboard data", async () => {
    const repository = createRepository({
      storePath: process.env.AGENTIC_RUNTIME_STORE_PATH
    });

    await repository.seedDefaults(SYSTEM_USER_ID);
    const bundle = await createGoalForUser(repository, SYSTEM_USER_ID, "Review my inbox and send one external reply.");
    const initialDashboard = await repository.getDashboardData(SYSTEM_USER_ID);
    const commitment = initialDashboard.commitments.find((candidate) => candidate.goalId === bundle.goal.id);

    expect(commitment).toBeDefined();

    Reflect.set(globalThis, "__agenticRepository", undefined);

    const response = await commitmentUpdateRoute(buildPatchRequest(commitment!.id, { action: "complete" }), {
      params: Promise.resolve({ id: commitment!.id })
    });
    const payload = (await response.json()) as {
      commitment: { id: string; status: string };
      dashboard: { commitments: Array<{ id: string; status: string }> };
    };

    expect(response.status).toBe(200);
    expect(payload.commitment).toMatchObject({
      id: commitment!.id,
      status: "completed"
    });
    expect(payload.dashboard.commitments).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: commitment!.id,
          status: "completed"
        })
      ])
    );
  });

  it("reopens a completed commitment by dropping the persisted override", async () => {
    const repository = createRepository({
      storePath: process.env.AGENTIC_RUNTIME_STORE_PATH
    });

    await repository.seedDefaults(SYSTEM_USER_ID);
    const bundle = await createGoalForUser(repository, SYSTEM_USER_ID, "Review my inbox and send one external reply.");
    const initialDashboard = await repository.getDashboardData(SYSTEM_USER_ID);
    const commitment = initialDashboard.commitments.find((candidate) => candidate.goalId === bundle.goal.id);

    expect(commitment).toBeDefined();

    await repository.saveCommitment({
      ...commitment!,
      status: "completed",
      updatedAt: new Date().toISOString()
    });
    Reflect.set(globalThis, "__agenticRepository", undefined);

    const response = await commitmentUpdateRoute(buildPatchRequest(commitment!.id, { action: "reopen" }), {
      params: Promise.resolve({ id: commitment!.id })
    });
    const payload = (await response.json()) as {
      commitment: { id: string; status: string } | null;
      dashboard: { commitments: Array<{ id: string; status: string }> };
    };

    expect(response.status).toBe(200);
    expect(payload.commitment).toMatchObject({
      id: commitment!.id,
      status: "needs-review"
    });
    expect(payload.dashboard.commitments).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: commitment!.id,
          status: "needs-review"
        })
      ])
    );
  });

  it("returns 404 when updating another user's commitment", async () => {
    const repository = createRepository({
      storePath: process.env.AGENTIC_RUNTIME_STORE_PATH
    });
    const secondaryUserId = "user-secondary";

    await repository.seedDefaults(SYSTEM_USER_ID);
    await repository.seedDefaults(secondaryUserId);
    await repository.saveCommitment({
      id: "commitment-secondary-only",
      userId: secondaryUserId,
      title: "Private commitment",
      summary: "Belongs to another user",
      status: "pending",
      sourceKind: "goal",
      sourceId: "goal-secondary",
      goalId: "goal-secondary",
      approvalId: null,
      dueAt: null,
      confidence: 0.7,
      evidence: [
        {
          section: "goals",
          itemId: "goal-secondary",
          label: "Private commitment"
        }
      ],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    });

    Reflect.set(globalThis, "__agenticRepository", undefined);

    const response = await commitmentUpdateRoute(buildPatchRequest("commitment-secondary-only", { action: "dismiss" }), {
      params: Promise.resolve({ id: "commitment-secondary-only" })
    });
    const payload = (await response.json()) as { error?: string };

    expect(response.status).toBe(404);
    expect(payload.error).toContain("Commitment commitment-secondary-only was not found.");
  });
});
