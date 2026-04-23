import { mkdtemp } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { SYSTEM_USER_ID } from "@agentic/contracts";
import { processUserRequest } from "@agentic/orchestrator";
import { createRepository } from "@agentic/repository";
import { createSelfImprovementRepository } from "@agentic/self-improvement-memory";
import { runWorkerRuntime } from "@agentic/worker-runtime";
import { AGENTIC_ACCESS_KEY_HEADER } from "../apps/web/lib/auth";
import {
  resetAuthSessionStateStoreForTesting,
  setAuthSessionStateStoreForTesting,
  type AuthSessionStateStore
} from "../apps/web/lib/auth-session-store";
import { GET as briefingJobRoute } from "../apps/web/app/api/briefing/jobs/[id]/route";
import { GET as goalJobRoute } from "../apps/web/app/api/goals/jobs/[id]/route";
import { GET as nlIntentCapabilitiesRoute, POST as nlIntentRoute } from "../apps/web/app/api/nl/intent/route";
import {
  buildAuthorizedGetRequest,
  buildAuthorizedJsonRequest,
  createRouteTestRepository,
  expectNoStoreHeaders
} from "./route-test-helpers";

describe("nl intent route", () => {
  const originalAccessKey = process.env.AGENTIC_ACCESS_KEY;
  const originalRuntimeStorePath = process.env.AGENTIC_RUNTIME_STORE_PATH;

  async function buildRepository() {
    const repository = createRouteTestRepository();

    await repository.seedDefaults(SYSTEM_USER_ID);
    return repository;
  }

  async function createApprovalBundle(repository: ReturnType<typeof createRepository>) {
    const bundle = await processUserRequest({
      userId: SYSTEM_USER_ID,
      request: "Review my inbox and draft responses.",
      memories: await repository.listMemory(SYSTEM_USER_ID),
      integrations: await repository.listIntegrations(SYSTEM_USER_ID)
    });
    const approval = bundle.approvals[0];

    expect(approval).toBeDefined();

    const normalizedBundle = {
      ...bundle,
      approvals: bundle.approvals.map((candidate) =>
        candidate.id === approval!.id
          ? {
              ...candidate,
              riskClass: "R2" as const,
              decision: "pending" as const,
              respondedAt: null,
              decisionScope: null,
              decisionRationale: null,
              history: []
            }
          : candidate
      )
    };

    await repository.saveGoalBundle(normalizedBundle);
    return normalizedBundle;
  }

  async function processQueuedNlIntentJobs(maxJobs = 1) {
    const repository = createRouteTestRepository();
    const selfImprovementRepository = createSelfImprovementRepository({
      baseDir: await mkdtemp(path.join(os.tmpdir(), "agentic-nl-intent-route-memory-"))
    });

    await Promise.all([
      repository.seedDefaults(SYSTEM_USER_ID),
      selfImprovementRepository.seed()
    ]);

    return runWorkerRuntime({
      repository,
      selfImprovementRepository,
      runnerId: "worker-nl-intent-route-test",
      maxJobs,
      pollIntervalMs: 50
    });
  }

  beforeEach(async () => {
    process.env.AGENTIC_ACCESS_KEY = "test-access-key";
    process.env.AGENTIC_RUNTIME_STORE_PATH = path.join(
      await mkdtemp(path.join(os.tmpdir(), "agentic-nl-intent-route-")),
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

  it("returns filtered approval results through the server boundary", async () => {
    const repository = await buildRepository();
    const bundle = await createApprovalBundle(repository);

    Reflect.set(globalThis, "__agenticRepository", undefined);

    const response = await nlIntentRoute(
      buildAuthorizedJsonRequest("http://localhost/api/nl/intent", {
        type: "query",
        target: "approvals",
        filters: {
          status: "pending",
          riskClass: "R2"
        }
      })
    );
    const payload = (await response.json()) as {
      message: string;
      data: Array<{ id: string; decision: string; riskClass: string }>;
    };

    expect(response.status).toBe(200);
    expect(payload.message).toContain("Showing 1 recent approval from the active workspace view.");
    expect(payload.data).toEqual([
      expect.objectContaining({
        id: bundle.approvals[0]!.id,
        decision: "pending",
        riskClass: "R2"
      })
    ]);
    expectNoStoreHeaders(response);
  }, 15_000);

  it("publishes bounded NL capabilities and live integration readiness", async () => {
    const repository = await buildRepository();

    Reflect.set(globalThis, "__agenticRepository", repository);

    const response = await nlIntentCapabilitiesRoute(buildAuthorizedGetRequest("http://localhost/api/nl/intent"));
    const payload = (await response.json()) as {
      capabilities: {
        headline: string;
        commands: Array<{ id: string; status: string }>;
        integrations: Array<{ label: string; connectionStatus: string; readinessTier: string; readinessLabel: string }>;
      };
    };

    expect(response.status).toBe(200);
    expect(payload.capabilities.headline).toContain("bounded control commands");
    expect(payload.capabilities.commands).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: "create-goal", status: "ready" }),
        expect.objectContaining({ id: "approve-all-r2", status: "limited" })
      ])
    );
    expect(payload.capabilities.integrations).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ label: "Email" }),
        expect.objectContaining({ label: "Calendar" }),
        expect.objectContaining({
          label: "Notes",
          connectionStatus: "ready",
          readinessTier: "autonomous-grade",
          readinessLabel: "Autonomous-grade"
        })
      ])
    );
    expectNoStoreHeaders(response);
  });

  it("approves all pending R2 approvals and returns refreshed dashboard data", async () => {
    const repository = await buildRepository();
    const bundle = await createApprovalBundle(repository);

    Reflect.set(globalThis, "__agenticRepository", undefined);

    const response = await nlIntentRoute(
      buildAuthorizedJsonRequest("http://localhost/api/nl/intent", {
        type: "command",
        action: "approve",
        params: {
          all: true,
          riskClass: "R2"
        }
      })
    );
    const payload = (await response.json()) as {
      message: string;
      dashboard: { approvals: Array<{ id: string; decision: string; riskClass: string }> };
    };
    const queuedJobs = await repository.listJobs({ userId: SYSTEM_USER_ID });

    expect(response.status).toBe(200);
    expect(payload.message).toBe("Approved 1 R2 approval and queued 1 follow-up job.");
    expect(payload.dashboard.approvals).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: bundle.approvals[0]!.id,
          decision: "approved",
          riskClass: "R2"
        })
      ])
    );
    expect(queuedJobs).toEqual([
      expect.objectContaining({
        kind: "approval_follow_up",
        status: "queued",
        payload: expect.objectContaining({
          type: "approval_follow_up",
          approvalId: bundle.approvals[0]!.id,
          goalId: bundle.goal.id,
          taskId: bundle.approvals[0]!.taskId,
          decision: "approved"
        })
      })
    ]);
    expectNoStoreHeaders(response);
  }, 15_000);

  it("creates goal bundles from the NL command boundary", async () => {
    const repository = await buildRepository();

    Reflect.set(globalThis, "__agenticRepository", repository);

    const response = await nlIntentRoute(
      new Request("http://localhost/api/nl/intent", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          [AGENTIC_ACCESS_KEY_HEADER]: "test-access-key",
          "x-idempotency-key": "nl-create-goal-1"
        },
        body: JSON.stringify({
          type: "command",
          action: "create-goal",
          params: {
            request: "Draft a Q2 operating plan"
          }
        })
      })
    );
    const payload = (await response.json()) as {
      message: string;
      data: { goalId: string; request: string };
      job: { id: string; kind: string; status: string; goalId: string };
      statusUrl: string;
    };
    const queuedStatusResponse = await goalJobRoute(
      new Request(`http://localhost${payload.statusUrl}`, {
        method: "GET",
        headers: {
          [AGENTIC_ACCESS_KEY_HEADER]: "test-access-key"
        }
      }),
      {
        params: Promise.resolve({ id: payload.job.id })
      }
    );
    const queuedStatusPayload = (await queuedStatusResponse.json()) as {
      job: { id: string; status: string; goalId: string };
      result: null;
      error: null;
    };

    expect(response.status).toBe(202);
    expect(payload.message).toContain("Queued goal creation");
    expect(payload.data.goalId).toBeTruthy();
    expect(payload.job.kind).toBe("goal_create");
    expect(payload.job.status).toBe("queued");
    expect(payload.job.goalId).toBe(payload.data.goalId);
    expect(payload.statusUrl).toBe(`/api/goals/jobs/${payload.job.id}`);
    expect(await repository.listGoals(SYSTEM_USER_ID)).toHaveLength(0);
    expect(await repository.listJobs({ userId: SYSTEM_USER_ID })).toHaveLength(1);
    expect(queuedStatusResponse.status).toBe(202);
    expect(queuedStatusPayload.job.id).toBe(payload.job.id);
    expect(queuedStatusPayload.job.status).toBe("queued");
    expect(queuedStatusPayload.result).toBeNull();
    expect(queuedStatusPayload.error).toBeNull();

    const workerResult = await processQueuedNlIntentJobs();
    const completedStatusResponse = await goalJobRoute(
      new Request(`http://localhost${payload.statusUrl}`, {
        method: "GET",
        headers: {
          [AGENTIC_ACCESS_KEY_HEADER]: "test-access-key"
        }
      }),
      {
        params: Promise.resolve({ id: payload.job.id })
      }
    );
    const completedStatusPayload = (await completedStatusResponse.json()) as {
      job: { id: string; status: string; goalId: string };
      result: {
        goalId: string;
        taskCount: number;
        completedTaskCount: number;
      };
      error: null;
    };

    expect(workerResult).toEqual({
      processedCount: 1,
      stopReason: "max_jobs"
    });
    expect(completedStatusResponse.status).toBe(200);
    expect(completedStatusPayload.job.id).toBe(payload.job.id);
    expect(completedStatusPayload.job.status).toBe("completed");
    expect(completedStatusPayload.result.goalId).toBe(payload.job.goalId);
    expect(completedStatusPayload.result.taskCount).toBeGreaterThan(0);
    expect(completedStatusPayload.result.completedTaskCount).toBeGreaterThan(0);
    expect(completedStatusPayload.error).toBeNull();
    expect(await repository.listGoals(SYSTEM_USER_ID)).toHaveLength(1);
    expect(await repository.getGoalBundleForUser(payload.job.goalId, SYSTEM_USER_ID)).toEqual(
      expect.objectContaining({
        goal: expect.objectContaining({
          id: payload.job.goalId
        })
      })
    );
    expectNoStoreHeaders(response);
  });

  it("queues briefing generation from the NL command boundary and persists the completed bundle", async () => {
    const repository = await buildRepository();

    Reflect.set(globalThis, "__agenticRepository", repository);

    const response = await nlIntentRoute(
      new Request("http://localhost/api/nl/intent", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          [AGENTIC_ACCESS_KEY_HEADER]: "test-access-key",
          "x-idempotency-key": "nl-briefing-1"
        },
        body: JSON.stringify({
          type: "command",
          action: "briefing",
          params: {
            type: "morning"
          }
        })
      })
    );
    const payload = (await response.json()) as {
      message: string;
      data: { goalId: string; type: string };
      job: { id: string; kind: string; status: string; goalId: string; briefingType: string };
      statusUrl: string;
    };
    const queuedStatusResponse = await briefingJobRoute(
      new Request(`http://localhost${payload.statusUrl}`, {
        method: "GET",
        headers: {
          [AGENTIC_ACCESS_KEY_HEADER]: "test-access-key"
        }
      }),
      {
        params: Promise.resolve({ id: payload.job.id })
      }
    );
    const queuedStatusPayload = (await queuedStatusResponse.json()) as {
      job: { id: string; status: string; goalId: string; briefingType: string };
      result: null;
      error: null;
    };

    expect(response.status).toBe(202);
    expect(payload.message).toContain("Queued startup briefing generation");
    expect(payload.data.type).toBe("startup");
    expect(payload.job.kind).toBe("briefing_create");
    expect(payload.job.status).toBe("queued");
    expect(payload.job.goalId).toBe(payload.data.goalId);
    expect(payload.job.briefingType).toBe("startup");
    expect(payload.statusUrl).toBe(`/api/briefing/jobs/${payload.job.id}`);
    expect(await repository.listGoals(SYSTEM_USER_ID)).toHaveLength(0);
    expect(await repository.listJobs({ userId: SYSTEM_USER_ID })).toHaveLength(1);
    expect(queuedStatusResponse.status).toBe(202);
    expect(queuedStatusPayload.job.id).toBe(payload.job.id);
    expect(queuedStatusPayload.job.status).toBe("queued");
    expect(queuedStatusPayload.job.briefingType).toBe("startup");
    expect(queuedStatusPayload.result).toBeNull();
    expect(queuedStatusPayload.error).toBeNull();

    const workerResult = await processQueuedNlIntentJobs();
    const completedStatusResponse = await briefingJobRoute(
      new Request(`http://localhost${payload.statusUrl}`, {
        method: "GET",
        headers: {
          [AGENTIC_ACCESS_KEY_HEADER]: "test-access-key"
        }
      }),
      {
        params: Promise.resolve({ id: payload.job.id })
      }
    );
    const completedStatusPayload = (await completedStatusResponse.json()) as {
      job: { id: string; status: string; goalId: string; briefingType: string };
      result: {
        goalId: string;
        taskCount: number;
        completedTaskCount: number;
      };
      error: null;
    };
    const persistedBundle = await repository.getGoalBundleForUser(payload.job.goalId, SYSTEM_USER_ID);

    expect(workerResult).toEqual({
      processedCount: 1,
      stopReason: "max_jobs"
    });
    expect(completedStatusResponse.status).toBe(200);
    expect(completedStatusPayload.job.id).toBe(payload.job.id);
    expect(completedStatusPayload.job.status).toBe("completed");
    expect(completedStatusPayload.job.briefingType).toBe("startup");
    expect(completedStatusPayload.result.goalId).toBe(payload.job.goalId);
    expect(completedStatusPayload.result.taskCount).toBeGreaterThan(0);
    expect(completedStatusPayload.result.completedTaskCount).toBeGreaterThan(0);
    expect(completedStatusPayload.error).toBeNull();
    expect(persistedBundle?.goal.intent).toBe("briefing:startup");
    expect(await repository.listGoals(SYSTEM_USER_ID)).toHaveLength(1);
    expectNoStoreHeaders(response);
  });

  it("rate limits NL command execution with a route-scoped abuse key", async () => {
    const seenKeys: string[] = [];
    const store: AuthSessionStateStore = {
      scope: "shared",
      async checkRateLimit(key) {
        seenKeys.push(key);
        return {
          allowed: false,
          retryAfterMs: 30_000
        };
      },
      async clearRateLimit() {},
      async revokeSession() {},
      async isSessionRevoked() {
        return false;
      },
      async reset() {}
    };

    setAuthSessionStateStoreForTesting(store);

    const commandResponse = await nlIntentRoute(
      new Request("http://localhost/api/nl/intent", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          [AGENTIC_ACCESS_KEY_HEADER]: "test-access-key",
          "user-agent": "Agentic NL Rate Limit Test",
          "accept-language": "en-SG"
        },
        body: JSON.stringify({
          type: "command",
          action: "create-goal",
          params: {
            request: "Draft a weekly operating cadence."
          }
        })
      })
    );
    const commandPayload = (await commandResponse.json()) as { error?: string };

    expect(commandResponse.status).toBe(429);
    expect(commandPayload.error).toBe("Too many NL command requests. Try again later.");
    expect(commandResponse.headers.get("retry-after")).toBe("30");
    expect(seenKeys).toHaveLength(1);
    expect(seenKeys[0]).toContain("nl-command:user:");
    expect(seenKeys[0]).toContain(":fp:/api/nl/intent:");
  });

  it("deduplicates retried NL goal submissions when the same idempotency key is reused", async () => {
    const repository = await buildRepository();
    const idempotencyKey = "nl-create-goal-retry-1";
    const buildRequest = () =>
      new Request("http://localhost/api/nl/intent", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          [AGENTIC_ACCESS_KEY_HEADER]: "test-access-key",
          "x-idempotency-key": idempotencyKey
        },
        body: JSON.stringify({
          type: "command",
          action: "create-goal",
          params: {
            request: "Draft a Q2 operating plan"
          }
        })
      });

    Reflect.set(globalThis, "__agenticRepository", repository);

    const firstResponse = await nlIntentRoute(buildRequest());
    const secondResponse = await nlIntentRoute(buildRequest());
    const firstPayload = (await firstResponse.json()) as {
      job: { id: string; goalId: string; status: string };
      statusUrl: string;
    };
    const secondPayload = (await secondResponse.json()) as {
      job: { id: string; goalId: string; status: string };
      statusUrl: string;
    };

    expect(firstResponse.status).toBe(202);
    expect(secondResponse.status).toBe(202);
    expect(secondPayload.job.id).toBe(firstPayload.job.id);
    expect(secondPayload.job.goalId).toBe(firstPayload.job.goalId);
    expect(secondPayload.statusUrl).toBe(firstPayload.statusUrl);
    expect(await repository.listGoals(SYSTEM_USER_ID)).toHaveLength(0);
    expect(await repository.listJobs({ userId: SYSTEM_USER_ID })).toHaveLength(1);
    expectNoStoreHeaders(firstResponse);
    expectNoStoreHeaders(secondResponse);
  });

  it("rejects malformed NL idempotency keys", async () => {
    const repository = await buildRepository();

    Reflect.set(globalThis, "__agenticRepository", repository);

    const response = await nlIntentRoute(
      new Request("http://localhost/api/nl/intent", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          [AGENTIC_ACCESS_KEY_HEADER]: "test-access-key",
          "x-idempotency-key": "bad key"
        },
        body: JSON.stringify({
          type: "command",
          action: "create-goal",
          params: {
            request: "Draft a Q2 operating plan"
          }
        })
      })
    );
    const payload = (await response.json()) as { error?: string };

    expect(response.status).toBe(400);
    expect(payload.error).toContain("x-idempotency-key");
    expectNoStoreHeaders(response);
  });

  it("returns structured summaries instead of relying on local dashboard state", async () => {
    const repository = await buildRepository();
    await createApprovalBundle(repository);

    Reflect.set(globalThis, "__agenticRepository", undefined);

    const response = await nlIntentRoute(
      buildAuthorizedJsonRequest("http://localhost/api/nl/intent", {
        type: "summary",
        timeRange: "since-last-login"
      })
    );
    const payload = (await response.json()) as {
      message: string;
      data: {
        pendingApprovals: number;
        runningGoals: number;
        recentActivities: number;
      };
    };

    expect(response.status).toBe(200);
    expect(payload.message).toContain("since-last-login summary");
    expect(payload.data.pendingApprovals).toBeGreaterThanOrEqual(1);
    expect(payload.data.runningGoals).toEqual(expect.any(Number));
    expect(payload.data.recentActivities).toBeGreaterThan(0);
    expectNoStoreHeaders(response);
  });

  it("rejects NL reject commands that are missing an approval selection", async () => {
    const repository = await buildRepository();

    Reflect.set(globalThis, "__agenticRepository", repository);

    const response = await nlIntentRoute(
      buildAuthorizedJsonRequest("http://localhost/api/nl/intent", {
        type: "command",
        action: "reject",
        params: {}
      })
    );
    const payload = (await response.json()) as { error?: string };

    expect(response.status).toBe(400);
    expect(payload.error).toBe("Reject commands require selecting an approval in the approvals queue.");
    expectNoStoreHeaders(response);
  });
});
