import { mkdtemp } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createJobRecord } from "@agentic/execution";
import { createMemoryRecord } from "@agentic/memory";
import { processUserRequest } from "@agentic/orchestrator";
import { SYSTEM_USER_ID, nowIso } from "@agentic/contracts";
import { createRepository, type AgenticRepository } from "@agentic/repository";
import { GET as dashboardActivityRoute } from "../apps/web/app/api/dashboard/activity/route";
import { GET as dashboardApprovalsRoute } from "../apps/web/app/api/dashboard/approvals/route";
import { GET as dashboardArtifactsRoute } from "../apps/web/app/api/dashboard/artifacts/route";
import { GET as dashboardCommitmentsRoute } from "../apps/web/app/api/dashboard/commitments/route";
import { GET as dashboardJobsRoute } from "../apps/web/app/api/dashboard/jobs/route";
import { GET as dashboardMemoriesRoute } from "../apps/web/app/api/dashboard/memories/route";
import { GET as dashboardSummaryRoute } from "../apps/web/app/api/dashboard/summary/route";
import { AGENTIC_ACCESS_KEY_HEADER } from "../apps/web/lib/auth";
import { expectNoStoreHeaders } from "./route-test-helpers";
import { vi } from "vitest";

function buildAuthorizedGetRequest(pathname: string) {
  return new Request(`http://localhost${pathname}`, {
    method: "GET",
    headers: {
      [AGENTIC_ACCESS_KEY_HEADER]: "test-access-key"
    }
  });
}

async function createGoalForUser(repository: AgenticRepository, userId: string, request: string) {
  const bundle = await processUserRequest({
    userId,
    request,
    memories: await repository.listMemory(userId),
    integrations: await repository.listIntegrations(userId)
  });

  await repository.saveGoalBundle(bundle);
  return bundle;
}

describe("dashboard collection routes", () => {
  const originalAccessKey = process.env.AGENTIC_ACCESS_KEY;
  const originalRuntimeStorePath = process.env.AGENTIC_RUNTIME_STORE_PATH;

  beforeEach(async () => {
    process.env.AGENTIC_ACCESS_KEY = "test-access-key";
    process.env.AGENTIC_RUNTIME_STORE_PATH = path.join(
      await mkdtemp(path.join(os.tmpdir(), "agentic-dashboard-collections-route-")),
      "runtime-store.json"
    );
    Reflect.set(globalThis, "__agenticRepository", undefined);
  });

  afterEach(() => {
    process.env.AGENTIC_ACCESS_KEY = originalAccessKey;
    process.env.AGENTIC_RUNTIME_STORE_PATH = originalRuntimeStorePath;
    Reflect.set(globalThis, "__agenticRepository", undefined);
  });

  it("returns a compact dashboard summary without full collection payloads", async () => {
    const repository = createRepository({
      storePath: process.env.AGENTIC_RUNTIME_STORE_PATH
    });
    await repository.seedDefaults(SYSTEM_USER_ID);
    await createGoalForUser(repository, SYSTEM_USER_ID, "Review my inbox and send one external reply.");
    await repository.seedDefaults("user-secondary");
    await createGoalForUser(repository, "user-secondary", "Keep this private planning goal out of the summary.");
    Reflect.set(globalThis, "__agenticRepository", undefined);

    const response = await dashboardSummaryRoute(buildAuthorizedGetRequest("/api/dashboard/summary"));
    const payload = (await response.json()) as {
      summary: {
        counts: { goals: number; pendingApprovals: number };
        lanes: Array<{ key: string; targetSection: string }>;
        goals?: unknown;
      };
    };

    expect(response.status).toBe(200);
    expectNoStoreHeaders(response);
    expect(payload.summary.counts.goals).toBe(1);
    expect(payload.summary.counts.pendingApprovals).toBeGreaterThan(0);
    expect(payload.summary.lanes.map((lane) => lane.key)).toEqual([
      "operate",
      "approve",
      "recover",
      "govern",
      "build",
      "learn"
    ]);
    expect(payload.summary.goals).toBeUndefined();
  });

  it("filters and searches each bounded dashboard collection route", async () => {
    const repository = createRepository({
      storePath: process.env.AGENTIC_RUNTIME_STORE_PATH
    });
    await repository.seedDefaults(SYSTEM_USER_ID);
    const bundle = await processUserRequest({
      userId: SYSTEM_USER_ID,
      request: "Review my inbox and send one external reply for the dashboard collections.",
      memories: await repository.listMemory(SYSTEM_USER_ID),
      integrations: await repository.listIntegrations(SYSTEM_USER_ID)
    });
    const approval = bundle.approvals[0];
    expect(approval).toBeDefined();
    const createdAt = nowIso();
    await repository.saveGoalBundle({
      ...bundle,
      artifacts: [
        ...bundle.artifacts,
        {
          id: "artifact-dashboard-collections",
          goalId: bundle.goal.id,
          artifactType: "summary",
          title: "Dashboard collection artifact",
          content: "Bounded artifact content for dashboard collection route tests.",
          createdAt
        }
      ],
      actionLogs: [
        ...bundle.actionLogs,
        {
          id: "action-dashboard-collections",
          goalId: bundle.goal.id,
          taskId: null,
          workflowId: bundle.workflow.id,
          actor: "orchestrator",
          kind: "dashboard.collection_test",
          message: "Dashboard collection activity was recorded.",
          details: {},
          createdAt,
          prevHash: null
        }
      ]
    });
    await repository.saveCommitment({
      id: "commitment-dashboard-low-confidence",
      userId: SYSTEM_USER_ID,
      title: "Dashboard low confidence commitment",
      summary: "Needs operator review before execution.",
      status: "pending",
      sourceKind: "goal",
      sourceId: bundle.goal.id,
      goalId: bundle.goal.id,
      approvalId: approval!.id,
      dueAt: null,
      urgency: "today",
      riskClass: "R3",
      confidence: 0.42,
      provenanceSummary: "Manual test commitment for bounded dashboard route coverage.",
      evidence: [
        {
          section: "approvals",
          itemId: approval!.id,
          label: approval!.title
        }
      ],
      createdAt,
      updatedAt: createdAt
    });
    await repository.saveMemory(
      createMemoryRecord({
        userId: SYSTEM_USER_ID,
        category: "dashboard-seed-memory",
        memoryType: "confirmed",
        content: "Dashboard collection searchable memory.",
        confidence: 0.91,
        source: "test",
        sensitivity: "internal",
        permissions: ["orchestrator"]
      })
    );
    await repository.enqueueJob(
      createJobRecord({
        userId: SYSTEM_USER_ID,
        kind: "goal_create",
        payload: {
          type: "goal_create",
          goalId: bundle.goal.id,
          workflowId: bundle.workflow.id,
          request: "Create dashboard collection goal.",
          workspaceId: null,
          agentId: null,
          metadata: {}
        }
      })
    );
    Reflect.set(globalThis, "__agenticRepository", undefined);

    const approvals = await dashboardApprovalsRoute(
      buildAuthorizedGetRequest(`/api/dashboard/approvals?status=pending&riskClass=${approval!.riskClass}&q=${approval!.id}&limit=5`)
    );
    const commitments = await dashboardCommitmentsRoute(
      buildAuthorizedGetRequest("/api/dashboard/commitments?bucket=low_confidence&q=low%20confidence&limit=5")
    );
    const jobs = await dashboardJobsRoute(
      buildAuthorizedGetRequest("/api/dashboard/jobs?status=queued&kind=goal_create&q=dashboard&limit=5")
    );
    const activity = await dashboardActivityRoute(
      buildAuthorizedGetRequest("/api/dashboard/activity?kind=dashboard.collection_test&q=activity&limit=5")
    );
    const memories = await dashboardMemoriesRoute(
      buildAuthorizedGetRequest("/api/dashboard/memories?kind=confirmed&q=searchable&limit=5")
    );
    const artifacts = await dashboardArtifactsRoute(
      buildAuthorizedGetRequest("/api/dashboard/artifacts?kind=summary&q=bounded&limit=5")
    );
    const payloads = await Promise.all([
      approvals.json(),
      commitments.json(),
      jobs.json(),
      activity.json(),
      memories.json(),
      artifacts.json()
    ]) as Array<{ page: { items: Array<{ id: string; kind?: string }>; totalCount: number; limit: number } }>;

    for (const response of [approvals, commitments, jobs, activity, memories, artifacts]) {
      expect(response.status).toBe(200);
      expectNoStoreHeaders(response);
    }
    expect(payloads[0]!.page.items[0]?.id).toBe(approval!.id);
    expect(payloads[1]!.page.items[0]?.id).toBe("commitment-dashboard-low-confidence");
    expect(payloads[2]!.page.items[0]?.kind).toBe("goal_create");
    expect(payloads[3]!.page.items[0]?.id).toBe("action-dashboard-collections");
    expect(payloads[4]!.page.totalCount).toBe(1);
    expect(payloads[5]!.page.items[0]?.id).toBe("artifact-dashboard-collections");
    expect(payloads.every((payload) => payload.page.limit === 5)).toBe(true);
  });

  it("rejects unsafe dashboard collection query shapes", async () => {
    const unknownQuery = await dashboardCommitmentsRoute(
      buildAuthorizedGetRequest("/api/dashboard/commitments?unknown=1")
    );
    const oversizedPage = await dashboardMemoriesRoute(buildAuthorizedGetRequest("/api/dashboard/memories?limit=101"));
    const invalidCursor = await dashboardArtifactsRoute(
      buildAuthorizedGetRequest("/api/dashboard/artifacts?cursor=not-a-valid-cursor")
    );
    const duplicateQuery = await dashboardJobsRoute(
      buildAuthorizedGetRequest("/api/dashboard/jobs?limit=1&limit=2")
    );

    await expect(unknownQuery.json()).resolves.toMatchObject({
      error: expect.stringContaining("Unknown dashboard query parameter")
    });
    await expect(oversizedPage.json()).resolves.toMatchObject({
      error: expect.stringContaining("Too big")
    });
    await expect(invalidCursor.json()).resolves.toMatchObject({
      error: expect.stringContaining("cursor is invalid")
    });
    await expect(duplicateQuery.json()).resolves.toMatchObject({
      error: expect.stringContaining("Duplicate dashboard query parameter")
    });
    expect(unknownQuery.status).toBe(400);
    expect(oversizedPage.status).toBe(400);
    expect(invalidCursor.status).toBe(400);
    expect(duplicateQuery.status).toBe(400);
  });

  it("does not expose another user's workspace approvals or artifacts through search", async () => {
    const repository = createRepository({
      storePath: process.env.AGENTIC_RUNTIME_STORE_PATH
    });
    await repository.seedDefaults(SYSTEM_USER_ID);
    await repository.seedDefaults("user-secondary");
    await createGoalForUser(repository, SYSTEM_USER_ID, "Prepare a visible dashboard collection goal.");
    const privateBundle = await createGoalForUser(
      repository,
      "user-secondary",
      "PRIVATE_SECONDARY_WORKSPACE_TOKEN prepare a confidential approval workflow."
    );
    await repository.saveGoalBundle({
      ...privateBundle,
      artifacts: [
        ...privateBundle.artifacts,
        {
          id: "artifact-secondary-private",
          goalId: privateBundle.goal.id,
          artifactType: "summary",
          title: "PRIVATE_SECONDARY_WORKSPACE_TOKEN artifact",
          content: "This artifact belongs to a different workspace owner.",
          createdAt: nowIso()
        }
      ]
    });
    Reflect.set(globalThis, "__agenticRepository", undefined);

    const approvals = await dashboardApprovalsRoute(
      buildAuthorizedGetRequest("/api/dashboard/approvals?q=PRIVATE_SECONDARY_WORKSPACE_TOKEN&limit=10")
    );
    const artifacts = await dashboardArtifactsRoute(
      buildAuthorizedGetRequest("/api/dashboard/artifacts?q=PRIVATE_SECONDARY_WORKSPACE_TOKEN&limit=10")
    );
    const approvalPayload = (await approvals.json()) as { page: { totalCount: number; items: unknown[] } };
    const artifactPayload = (await artifacts.json()) as { page: { totalCount: number; items: unknown[] } };

    expect(approvals.status).toBe(200);
    expect(artifacts.status).toBe(200);
    expect(approvalPayload.page.totalCount).toBe(0);
    expect(approvalPayload.page.items).toEqual([]);
    expect(artifactPayload.page.totalCount).toBe(0);
    expect(artifactPayload.page.items).toEqual([]);
  });

  it("searches bounded approval and artifact collections beyond the dashboard goal summary window", async () => {
    const repository = createRepository({
      storePath: process.env.AGENTIC_RUNTIME_STORE_PATH
    });
    await repository.seedDefaults(SYSTEM_USER_ID);
    const token = "DEEP_DASHBOARD_COLLECTION_TOKEN";
    const oldestBundle = await createGoalForUser(
      repository,
      SYSTEM_USER_ID,
      `${token} send one external reply that needs a retained approval.`
    );
    const approval = oldestBundle.approvals[0];
    expect(approval).toBeDefined();
    const createdAt = nowIso();

    await repository.saveGoalBundle({
      ...oldestBundle,
      approvals: oldestBundle.approvals.map((candidate) =>
        candidate.id === approval!.id
          ? {
              ...candidate,
              title: `${token} retained approval`,
              rationale: `${candidate.rationale} ${token}`
            }
          : candidate
      ),
      artifacts: [
        ...oldestBundle.artifacts,
        {
          id: "artifact-deep-dashboard-collection-token",
          goalId: oldestBundle.goal.id,
          artifactType: "summary",
          title: `${token} retained artifact`,
          content: "This old artifact must remain discoverable by the bounded collection route.",
          createdAt
        }
      ]
    });

    await new Promise((resolve) => setTimeout(resolve, 2));

    for (let index = 0; index < 45; index += 1) {
      await createGoalForUser(repository, SYSTEM_USER_ID, `Prepare newer dashboard filler goal ${index}.`);
    }

    Reflect.set(globalThis, "__agenticRepository", undefined);

    const approvals = await dashboardApprovalsRoute(
      buildAuthorizedGetRequest(`/api/dashboard/approvals?q=${token}&limit=5`)
    );
    const artifacts = await dashboardArtifactsRoute(
      buildAuthorizedGetRequest("/api/dashboard/artifacts?q=artifact-deep-dashboard-collection-token&limit=5")
    );
    const approvalPayload = (await approvals.json()) as { page: { totalCount: number; items: Array<{ id: string }> } };
    const artifactPayload = (await artifacts.json()) as { page: { totalCount: number; items: Array<{ id: string }> } };

    expect(approvals.status).toBe(200);
    expect(artifacts.status).toBe(200);
    expect(approvalPayload.page.totalCount).toBe(1);
    expect(approvalPayload.page.items[0]?.id).toBe(approval!.id);
    expect(artifactPayload.page.totalCount).toBe(1);
    expect(artifactPayload.page.items[0]?.id).toBe("artifact-deep-dashboard-collection-token");
  });

  it("keeps large memory fixtures paginated and scoped to the signed-in user", async () => {
    const repository = createRepository({
      storePath: process.env.AGENTIC_RUNTIME_STORE_PATH
    });
    await repository.seedDefaults(SYSTEM_USER_ID);
    await repository.seedDefaults("user-secondary");

    for (let index = 0; index < 80; index += 1) {
      await repository.saveMemory(
        createMemoryRecord({
          userId: SYSTEM_USER_ID,
          category: `bulk-dashboard-memory-${index.toString().padStart(2, "0")}`,
          memoryType: "observed",
          content: `Bulk dashboard collection memory ${index}`,
          confidence: 0.8,
          source: "test",
          sensitivity: "internal",
          permissions: ["orchestrator"]
        })
      );
    }
    await repository.saveMemory(
      createMemoryRecord({
        userId: "user-secondary",
        category: "bulk-dashboard-memory-private",
        memoryType: "observed",
        content: "Private memory from another user must not leak.",
        confidence: 0.8,
        source: "test",
        sensitivity: "internal",
        permissions: ["orchestrator"]
      })
    );
    Reflect.set(globalThis, "__agenticRepository", undefined);

    const firstResponse = await dashboardMemoriesRoute(
      buildAuthorizedGetRequest("/api/dashboard/memories?q=bulk-dashboard-memory&limit=7&sort=title_asc")
    );
    const firstPayload = (await firstResponse.json()) as {
      page: {
        items: Array<{ id: string; category: string }>;
        nextCursor: string | null;
        totalCount: number;
      };
    };
    const secondResponse = await dashboardMemoriesRoute(
      buildAuthorizedGetRequest(`/api/dashboard/memories?q=bulk-dashboard-memory&limit=7&sort=title_asc&cursor=${firstPayload.page.nextCursor}`)
    );
    const secondPayload = (await secondResponse.json()) as {
      page: {
        items: Array<{ id: string; category: string }>;
      };
    };
    const firstPayloadBytes = JSON.stringify(firstPayload).length;

    expect(firstResponse.status).toBe(200);
    expect(secondResponse.status).toBe(200);
    expect(firstPayload.page.items).toHaveLength(7);
    expect(secondPayload.page.items).toHaveLength(7);
    expect(firstPayload.page.totalCount).toBe(80);
    expect(firstPayload.page.nextCursor).not.toBeNull();
    expect(firstPayload.page.items.some((item) => item.category.includes("private"))).toBe(false);
    expect(secondPayload.page.items.some((item) => item.category.includes("private"))).toBe(false);
    expect(firstPayloadBytes).toBeLessThan(12_000);
  });

  it("uses bounded repository page APIs instead of unbounded dashboard collection reads", async () => {
    const repository = createRepository({
      storePath: process.env.AGENTIC_RUNTIME_STORE_PATH
    });
    await repository.seedDefaults(SYSTEM_USER_ID);
    const bundle = await createGoalForUser(
      repository,
      SYSTEM_USER_ID,
      "Prepare a dashboard collection fixture that exercises bounded repository reads."
    );
    const createdAt = nowIso();

    await repository.saveGoalBundle({
      ...bundle,
      artifacts: [
        ...bundle.artifacts,
        {
          id: "artifact-bounded-contract",
          goalId: bundle.goal.id,
          artifactType: "summary",
          title: "Bounded contract artifact",
          content: "Bounded collection contract evidence.",
          createdAt
        }
      ],
      actionLogs: [
        ...bundle.actionLogs,
        {
          id: "action-bounded-contract",
          goalId: bundle.goal.id,
          taskId: null,
          workflowId: bundle.workflow.id,
          actor: "orchestrator",
          kind: "dashboard.bounded_contract",
          message: "Bounded dashboard collection contract was exercised.",
          details: {},
          createdAt,
          prevHash: null
        }
      ]
    });
    await repository.saveMemory(
      createMemoryRecord({
        userId: SYSTEM_USER_ID,
        category: "bounded-dashboard-contract-memory",
        memoryType: "observed",
        content: "Bounded dashboard collection memory.",
        confidence: 0.82,
        source: "test",
        sensitivity: "internal",
        permissions: ["orchestrator"]
      })
    );
    await repository.enqueueJob(
      createJobRecord({
        userId: SYSTEM_USER_ID,
        kind: "goal_create",
        payload: {
          type: "goal_create",
          goalId: bundle.goal.id,
          workflowId: bundle.workflow.id,
          request: "Create bounded dashboard collection job.",
          workspaceId: null,
          agentId: null,
          metadata: {}
        }
      })
    );

    const unboundedRead = vi.fn(async () => {
      throw new Error("Dashboard collection route attempted an unbounded repository read.");
    });
    vi.spyOn(repository, "listGoals").mockImplementation(unboundedRead as AgenticRepository["listGoals"]);
    vi.spyOn(repository, "listApprovals").mockImplementation(unboundedRead as AgenticRepository["listApprovals"]);
    vi.spyOn(repository, "listMemory").mockImplementation(unboundedRead as AgenticRepository["listMemory"]);
    const listJobsSpy = vi.spyOn(repository, "listJobs");

    Reflect.set(globalThis, "__agenticRepository", repository);

    const responses = await Promise.all([
      dashboardApprovalsRoute(buildAuthorizedGetRequest("/api/dashboard/approvals?limit=5")),
      dashboardCommitmentsRoute(buildAuthorizedGetRequest("/api/dashboard/commitments?limit=5")),
      dashboardJobsRoute(buildAuthorizedGetRequest("/api/dashboard/jobs?limit=5")),
      dashboardActivityRoute(buildAuthorizedGetRequest("/api/dashboard/activity?limit=5")),
      dashboardMemoriesRoute(buildAuthorizedGetRequest("/api/dashboard/memories?limit=5")),
      dashboardArtifactsRoute(buildAuthorizedGetRequest("/api/dashboard/artifacts?limit=5"))
    ]);

    for (const response of responses) {
      expect(response.status).toBe(200);
      expectNoStoreHeaders(response);
    }
    expect(unboundedRead).not.toHaveBeenCalled();
    expect(listJobsSpy).toHaveBeenCalledWith(expect.objectContaining({ limit: 1_000 }));
  });
});
