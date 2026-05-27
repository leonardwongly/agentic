import { mkdtemp } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  AgentDefinitionSchema,
  DEFAULT_OWNER_USER_ID,
  WorkspaceMemberSchema,
  WorkspaceSchema,
  createHumanActorContext,
  createSystemActorContext
} from "@agentic/contracts";
import { createJobRecord } from "@agentic/execution";
import { processUserRequest } from "@agentic/orchestrator";
import { createRepository } from "@agentic/repository";
import { createSelfImprovementRepository } from "@agentic/self-improvement-memory";
import { runWorkerRuntime } from "@agentic/worker-runtime";
import { vi } from "vitest";
import * as authModule from "../apps/web/lib/auth";
import { AGENTIC_ACCESS_KEY_HEADER } from "../apps/web/lib/auth";
import {
  resetAuthSessionStateStoreForTesting,
  setAuthSessionStateStoreForTesting,
  type AuthSessionStateStore
} from "../apps/web/lib/auth-session-store";
import { SHARED_GOAL_REFINEMENT_DENIED_REASON } from "../apps/web/lib/workspace-role-permissions";
import { GET as goalRoute } from "../apps/web/app/api/goals/[id]/route";
import { GET as goalJobRoute } from "../apps/web/app/api/goals/jobs/[id]/route";
import { POST as goalsCreateRoute } from "../apps/web/app/api/goals/route";
import { POST as goalRefineRoute } from "../apps/web/app/api/goals/[id]/refine/route";
import { createRouteTestRepository } from "./route-test-helpers";

describe("goal route", () => {
  const originalAccessKey = process.env.AGENTIC_ACCESS_KEY;
  const originalRuntimeStorePath = process.env.AGENTIC_RUNTIME_STORE_PATH;

  async function createGoalForUser(
    repository: ReturnType<typeof createRepository>,
    userId: string,
    request: string,
    workspaceId?: string | null
  ) {
    const bundle = await processUserRequest({
      userId,
      workspaceId,
      request,
      memories: await repository.listMemory(userId),
      integrations: await repository.listIntegrations(userId)
    });

    await repository.saveGoalBundle(bundle);
    return bundle;
  }

  async function createSharedWorkspace(
    repository: ReturnType<typeof createRepository>,
    ownerUserId: string,
    memberUserId: string
  ) {
    const timestamp = "2026-04-22T00:00:00.000Z";
    const ownerActor = createSystemActorContext(ownerUserId);
    const workspaceId = "workspace-shared-goal-refine";

    await repository.saveWorkspace(
      WorkspaceSchema.parse({
        id: workspaceId,
        ownerUserId,
        slug: "shared-goal-refine",
        name: "Shared Goal Refine Workspace",
        description: "Shared workspace for goal refinement permission tests.",
        isPersonal: false,
        createdAt: timestamp,
        updatedAt: timestamp
      }),
      ownerActor
    );
    await repository.saveWorkspaceMember(
      WorkspaceMemberSchema.parse({
        id: "workspace-shared-goal-refine-owner",
        workspaceId,
        userId: ownerUserId,
        role: "owner",
        joinedAt: timestamp,
        updatedAt: timestamp
      }),
      ownerActor
    );

    return {
      workspaceId,
      addMember: async (role: "editor" | "viewer") =>
        repository.saveWorkspaceMember(
          WorkspaceMemberSchema.parse({
            id: `workspace-shared-goal-refine-${memberUserId}-${role}`,
            workspaceId,
            userId: memberUserId,
            role,
            joinedAt: timestamp,
            updatedAt: timestamp
          }),
          ownerActor
        )
    };
  }

  async function processQueuedGoalJobs(maxJobs = 1) {
    const repository = createRouteTestRepository();
    const selfImprovementRepository = createSelfImprovementRepository({
      baseDir: await mkdtemp(path.join(os.tmpdir(), "agentic-goal-route-memory-"))
    });

    await Promise.all([
      repository.seedDefaults(DEFAULT_OWNER_USER_ID),
      selfImprovementRepository.seed()
    ]);

    return runWorkerRuntime({
      repository,
      selfImprovementRepository,
      runnerId: "worker-goal-route-test",
      maxJobs,
      pollIntervalMs: 50
    });
  }

  beforeEach(async () => {
    process.env.AGENTIC_ACCESS_KEY = "test-access-key";
    process.env.AGENTIC_RUNTIME_STORE_PATH = path.join(
      await mkdtemp(path.join(os.tmpdir(), "agentic-goal-route-")),
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

  it("queues goal creation, exposes a pollable status route, and completes through the worker runtime", async () => {
    const createResponse = await goalsCreateRoute(
      new Request("http://localhost/api/goals", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          [AGENTIC_ACCESS_KEY_HEADER]: "test-access-key"
        },
        body: JSON.stringify({
          request: "Plan my week around focus time and approvals."
        })
      })
    );
    const createPayload = (await createResponse.json()) as {
      job: {
        id: string;
        kind: string;
        status: string;
        goalId: string;
      };
      statusUrl: string;
    };
    const repository = createRouteTestRepository();

    expect(createResponse.status).toBe(202);
    expect(createPayload.job.kind).toBe("goal_create");
    expect(createPayload.job.status).toBe("queued");
    expect(createPayload.statusUrl).toBe(`/api/goals/jobs/${createPayload.job.id}`);
    expect(await repository.listGoals(DEFAULT_OWNER_USER_ID)).toHaveLength(0);
    expect(await repository.listJobs({ userId: DEFAULT_OWNER_USER_ID })).toHaveLength(1);

    const queuedStatusResponse = await goalJobRoute(
      new Request(`http://localhost${createPayload.statusUrl}`, {
        method: "GET",
        headers: {
          [AGENTIC_ACCESS_KEY_HEADER]: "test-access-key"
        }
      }),
      {
        params: Promise.resolve({ id: createPayload.job.id })
      }
    );
    const queuedStatusPayload = (await queuedStatusResponse.json()) as {
      job: { id: string; status: string; goalId: string };
      result: null;
      error: null;
    };

    expect(queuedStatusResponse.status).toBe(202);
    expect(queuedStatusPayload.job.id).toBe(createPayload.job.id);
    expect(queuedStatusPayload.job.status).toBe("queued");
    expect(queuedStatusPayload.result).toBeNull();
    expect(queuedStatusPayload.error).toBeNull();

    const workerResult = await processQueuedGoalJobs();
    const completedStatusResponse = await goalJobRoute(
      new Request(`http://localhost${createPayload.statusUrl}`, {
        method: "GET",
        headers: {
          [AGENTIC_ACCESS_KEY_HEADER]: "test-access-key"
        }
      }),
      {
        params: Promise.resolve({ id: createPayload.job.id })
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
    expect(completedStatusPayload.job.id).toBe(createPayload.job.id);
    expect(completedStatusPayload.job.status).toBe("completed");
    expect(completedStatusPayload.result.goalId).toBe(createPayload.job.goalId);
    expect(completedStatusPayload.result.taskCount).toBeGreaterThan(0);
    expect(completedStatusPayload.result.completedTaskCount).toBe(0);
    expect(completedStatusPayload.error).toBeNull();
    expect(await repository.listGoals(DEFAULT_OWNER_USER_ID)).toHaveLength(1);
  });

  it("deduplicates retried goal submissions when the same idempotency key is reused", async () => {
    const idempotencyKey = "goal-create-retry-1";
    const buildRequest = () =>
      new Request("http://localhost/api/goals", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          [AGENTIC_ACCESS_KEY_HEADER]: "test-access-key",
          "x-idempotency-key": idempotencyKey
        },
        body: JSON.stringify({
          request: "Prepare a durable weekly planning workflow."
        })
      });

    const firstResponse = await goalsCreateRoute(buildRequest());
    const secondResponse = await goalsCreateRoute(buildRequest());
    const firstPayload = (await firstResponse.json()) as {
      job: { id: string; goalId: string; status: string };
      statusUrl: string;
    };
    const secondPayload = (await secondResponse.json()) as {
      job: { id: string; goalId: string; status: string };
      statusUrl: string;
    };
    const repository = createRouteTestRepository();

    expect(firstResponse.status).toBe(202);
    expect(secondResponse.status).toBe(202);
    expect(secondPayload.job.id).toBe(firstPayload.job.id);
    expect(secondPayload.job.goalId).toBe(firstPayload.job.goalId);
    expect(secondPayload.statusUrl).toBe(firstPayload.statusUrl);
    expect(await repository.listGoals(DEFAULT_OWNER_USER_ID)).toHaveLength(0);
    expect(await repository.listJobs({ userId: DEFAULT_OWNER_USER_ID })).toHaveLength(1);
  });

  it("derives deterministic idempotency keys for duplicate goal submissions without a client key", async () => {
    const buildRequest = () =>
      new Request("http://localhost/api/goals", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          [AGENTIC_ACCESS_KEY_HEADER]: "test-access-key"
        },
        body: JSON.stringify({
          request: "Prepare a durable weekly planning workflow."
        })
      });

    const firstResponse = await goalsCreateRoute(buildRequest());
    const secondResponse = await goalsCreateRoute(buildRequest());
    const firstPayload = (await firstResponse.json()) as {
      job: { id: string; goalId: string; status: string };
      statusUrl: string;
    };
    const secondPayload = (await secondResponse.json()) as {
      job: { id: string; goalId: string; status: string };
      statusUrl: string;
    };
    const repository = createRouteTestRepository();
    const jobs = await repository.listJobs({ userId: DEFAULT_OWNER_USER_ID });

    expect(firstResponse.status).toBe(202);
    expect(secondResponse.status).toBe(202);
    expect(secondPayload.job.id).toBe(firstPayload.job.id);
    expect(secondPayload.job.goalId).toBe(firstPayload.job.goalId);
    expect(secondPayload.statusUrl).toBe(firstPayload.statusUrl);
    expect(jobs).toHaveLength(1);
    expect(jobs[0]?.idempotencyKey).toMatch(/^goal-create:/);
  });

  it("deduplicates retried goal refinements when the same idempotency key is reused", async () => {
    const repository = createRouteTestRepository();
    const bundle = await createGoalForUser(repository, DEFAULT_OWNER_USER_ID, "Plan a reviewer-safe follow-up workflow.");
    const idempotencyKey = "goal-refine-retry-1";
    const buildRequest = () =>
      new Request(`http://localhost/api/goals/${bundle.goal.id}/refine`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          [AGENTIC_ACCESS_KEY_HEADER]: "test-access-key",
          "x-idempotency-key": idempotencyKey
        },
        body: JSON.stringify({
          message: "Also include an executive summary for reviewers.",
          sourceRecommendation: {
            key: "execution_path:communications:send_message:R3:send",
            source: "outcome_trace",
            suggestedMessage:
              'Refine "Plan a reviewer-safe follow-up workflow." to follow the communications send_message recommendation. Preserve the draft, send capability path.'
          }
        })
      });

    Reflect.set(globalThis, "__agenticRepository", undefined);

    const firstResponse = await goalRefineRoute(buildRequest(), {
      params: Promise.resolve({ id: bundle.goal.id })
    });
    const secondResponse = await goalRefineRoute(buildRequest(), {
      params: Promise.resolve({ id: bundle.goal.id })
    });
    const firstPayload = (await firstResponse.json()) as {
      job: { id: string; goalId: string; status: string; kind: string };
      statusUrl: string;
    };
    const secondPayload = (await secondResponse.json()) as {
      job: { id: string; goalId: string; status: string; kind: string };
      statusUrl: string;
    };

    expect(firstResponse.status).toBe(202);
    expect(secondResponse.status).toBe(202);
    expect(firstPayload.job.kind).toBe("goal_refine");
    expect(secondPayload.job.id).toBe(firstPayload.job.id);
    expect(secondPayload.job.goalId).toBe(firstPayload.job.goalId);
    expect(secondPayload.statusUrl).toBe(firstPayload.statusUrl);
    const jobs = await repository.listJobs({ userId: DEFAULT_OWNER_USER_ID });

    expect(jobs).toHaveLength(1);
    expect(jobs[0]?.payload).toMatchObject({
      type: "goal_refine",
      metadata: {
        sourceRecommendation: {
          key: "execution_path:communications:send_message:R3:send",
          source: "outcome_trace"
        }
      }
    });
  });

  it("rate limits queued goal creation with a route-scoped abuse key", async () => {
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

    const response = await goalsCreateRoute(
      new Request("http://localhost/api/goals", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          [AGENTIC_ACCESS_KEY_HEADER]: "test-access-key",
          "user-agent": "Agentic Goal Rate Limit Test",
          "accept-language": "en-SG"
        },
        body: JSON.stringify({
          request: "Plan a reviewer-safe weekly operating cadence."
        })
      })
    );
    const payload = (await response.json()) as { error?: string };

    expect(response.status).toBe(429);
    expect(payload.error).toBe("Too many goal creation requests. Try again later.");
    expect(response.headers.get("retry-after")).toBe("30");
    expect(seenKeys).toHaveLength(1);
    expect(seenKeys[0]).toContain("goal-create:user:");
    expect(seenKeys[0]).toContain(":fp:/api/goals:");
  });

  it("rejects malformed goal idempotency keys", async () => {
    const response = await goalsCreateRoute(
      new Request("http://localhost/api/goals", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          [AGENTIC_ACCESS_KEY_HEADER]: "test-access-key",
          "x-idempotency-key": "bad key"
        },
        body: JSON.stringify({
          request: "Prepare a durable weekly planning workflow."
        })
      })
    );
    const payload = (await response.json()) as { error?: string };

    expect(response.status).toBe(400);
    expect(payload.error).toContain("x-idempotency-key");
  });

  it("rejects unknown, foreign, and non-active custom agents before goal enqueue", async () => {
    const repository = createRouteTestRepository();
    const timestamp = "2026-04-22T00:00:00.000Z";

    await repository.seedDefaults(DEFAULT_OWNER_USER_ID);
    await repository.seedDefaults("user-secondary");
    await repository.saveAgent(
      AgentDefinitionSchema.parse({
        id: "agent-secondary-only",
        userId: "user-secondary",
        name: "secondary-only",
        displayName: "Secondary Only",
        description: "Foreign agent.",
        systemPrompt: "Prepare scoped plans for the secondary user only.",
        artifactType: "summary",
        allowedCapabilities: ["read", "search"],
        status: "active",
        createdAt: timestamp,
        updatedAt: timestamp
      })
    );
    await repository.saveAgent(
      AgentDefinitionSchema.parse({
        id: "agent-draft-goal",
        userId: DEFAULT_OWNER_USER_ID,
        name: "draft-goal",
        displayName: "Draft Goal Agent",
        description: "Draft agent.",
        systemPrompt: "Prepare scoped plans only after activation.",
        artifactType: "summary",
        allowedCapabilities: ["read", "search"],
        status: "draft",
        createdAt: timestamp,
        updatedAt: timestamp
      })
    );

    for (const [agentId, expectedStatus, expectedError] of [
      ["agent-missing", 404, "Agent not found."],
      ["agent-secondary-only", 404, "Agent not found."],
      ["agent-draft-goal", 409, "Agent is not active and cannot execute goals."]
    ] as const) {
      const response = await goalsCreateRoute(
        new Request("http://localhost/api/goals", {
          method: "POST",
          headers: {
            "content-type": "application/json",
            [AGENTIC_ACCESS_KEY_HEADER]: "test-access-key"
          },
          body: JSON.stringify({
            request: "Prepare a durable weekly planning workflow.",
            agentId
          })
        })
      );
      const payload = (await response.json()) as { error?: string };

      expect(response.status).toBe(expectedStatus);
      expect(payload.error).toBe(expectedError);
    }

    await expect(repository.listJobs({ userId: DEFAULT_OWNER_USER_ID })).resolves.toHaveLength(0);
  });

  it("returns 404 for a goal owned by another user", async () => {
    const repository = createRouteTestRepository();
    const secondaryUserId = "user-secondary";

    await repository.seedDefaults(DEFAULT_OWNER_USER_ID);
    await repository.seedDefaults(secondaryUserId);

    const secondaryBundle = await createGoalForUser(repository, secondaryUserId, "Keep another user's planning private.");

    Reflect.set(globalThis, "__agenticRepository", undefined);

    const response = await goalRoute(
      new Request(`http://localhost/api/goals/${secondaryBundle.goal.id}`, {
        method: "GET",
        headers: {
          [AGENTIC_ACCESS_KEY_HEADER]: "test-access-key"
        }
      }),
      {
        params: Promise.resolve({ id: secondaryBundle.goal.id })
      }
    );
    const payload = (await response.json()) as { error?: string };

    expect(response.status).toBe(404);
    expect(payload.error).toContain(`Goal ${secondaryBundle.goal.id} was not found.`);
  });

  it("returns 404 when attempting to refine another user's goal", async () => {
    const repository = createRouteTestRepository();
    const secondaryUserId = "user-secondary";

    await repository.seedDefaults(DEFAULT_OWNER_USER_ID);
    await repository.seedDefaults(secondaryUserId);

    const secondaryBundle = await createGoalForUser(repository, secondaryUserId, "Keep another user's planning private.");

    Reflect.set(globalThis, "__agenticRepository", undefined);

    const response = await goalRefineRoute(
      new Request(`http://localhost/api/goals/${secondaryBundle.goal.id}/refine`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          [AGENTIC_ACCESS_KEY_HEADER]: "test-access-key"
        },
        body: JSON.stringify({
          message: "Expose a cross-user refinement attempt."
        })
      }),
      {
        params: Promise.resolve({ id: secondaryBundle.goal.id })
      }
    );
    const payload = (await response.json()) as { error?: string };

    expect(response.status).toBe(404);
    expect(payload.error).toContain(`Goal ${secondaryBundle.goal.id} was not found.`);
  });

  it("returns 403 when a viewer tries to refine a shared workspace goal", async () => {
    const repository = createRouteTestRepository();
    const viewerUserId = "user-viewer";

    await repository.seedDefaults(DEFAULT_OWNER_USER_ID);
    await repository.seedDefaults(viewerUserId);

    const workspace = await createSharedWorkspace(repository, DEFAULT_OWNER_USER_ID, viewerUserId);
    await workspace.addMember("viewer");
    const bundle = await createGoalForUser(
      repository,
      DEFAULT_OWNER_USER_ID,
      "Keep the shared planning lane current for the team.",
      workspace.workspaceId
    );
    const requireApiSessionSpy = vi.spyOn(authModule, "requireApiSession").mockResolvedValue({
      authMethod: "session",
      userId: viewerUserId,
      sessionId: "session-viewer",
      expiresAt: null
    });

    Reflect.set(globalThis, "__agenticRepository", undefined);

    try {
      const response = await goalRefineRoute(
        new Request(`http://localhost/api/goals/${bundle.goal.id}/refine`, {
          method: "POST",
          headers: {
            "content-type": "application/json"
          },
          body: JSON.stringify({
            message: "Add an escalation summary for the shared workflow."
          })
        }),
        {
          params: Promise.resolve({ id: bundle.goal.id })
        }
      );
      const payload = (await response.json()) as { error?: string };

      expect(response.status).toBe(403);
      expect(payload.error).toBe(SHARED_GOAL_REFINEMENT_DENIED_REASON);
      await expect(repository.listJobs({ userId: viewerUserId })).resolves.toHaveLength(0);
    } finally {
      requireApiSessionSpy.mockRestore();
    }
  });

  it("queues refinement when an editor refines a shared workspace goal", async () => {
    const repository = createRouteTestRepository();
    const editorUserId = "user-editor";

    await repository.seedDefaults(DEFAULT_OWNER_USER_ID);
    await repository.seedDefaults(editorUserId);

    const workspace = await createSharedWorkspace(repository, DEFAULT_OWNER_USER_ID, editorUserId);
    await workspace.addMember("editor");
    const bundle = await createGoalForUser(
      repository,
      DEFAULT_OWNER_USER_ID,
      "Keep the shared launch workflow aligned with current operator guidance.",
      workspace.workspaceId
    );
    const requireApiSessionSpy = vi.spyOn(authModule, "requireApiSession").mockResolvedValue({
      authMethod: "session",
      userId: editorUserId,
      sessionId: "session-editor",
      expiresAt: null
    });

    Reflect.set(globalThis, "__agenticRepository", undefined);

    try {
      const response = await goalRefineRoute(
        new Request(`http://localhost/api/goals/${bundle.goal.id}/refine`, {
          method: "POST",
          headers: {
            "content-type": "application/json"
          },
          body: JSON.stringify({
            message: "Add the operator recovery path and escalation checklist."
          })
        }),
        {
          params: Promise.resolve({ id: bundle.goal.id })
        }
      );
      const payload = (await response.json()) as {
        job: { id: string; goalId: string; kind: string; status: string };
        statusUrl: string;
      };
      const sharedJobs = await repository.listJobs({ userId: editorUserId });

      expect(response.status).toBe(202);
      expect(payload.job).toMatchObject({
        goalId: bundle.goal.id,
        kind: "goal_refine",
        status: "queued"
      });
      expect(payload.statusUrl).toBe(`/api/goals/jobs/${payload.job.id}`);
      expect(sharedJobs.some((job) => job.id === payload.job.id)).toBe(true);
      expect(await repository.getJob(payload.job.id, editorUserId)).toMatchObject({
        actorContext: createHumanActorContext(editorUserId, "session-editor"),
        payload: {
          type: "goal_refine",
          goalId: bundle.goal.id,
          workspaceId: workspace.workspaceId
        }
      });
    } finally {
      requireApiSessionSpy.mockRestore();
    }
  });

  it("returns 404 for a goal job owned by another user", async () => {
    const repository = createRouteTestRepository();

    await repository.seedDefaults("user-secondary");
    const job = await repository.enqueueJob(createJobRecord({
      userId: "user-secondary",
      kind: "goal_create",
      payload: {
        type: "goal_create",
        goalId: "goal-other-user",
        workflowId: "workflow-other-user",
        request: "Keep another user's queued work private.",
        workspaceId: null,
        agentId: null,
        metadata: {}
      },
      actorContext: createSystemActorContext("user-secondary")
    }));

    Reflect.set(globalThis, "__agenticRepository", undefined);

    const response = await goalJobRoute(
      new Request(`http://localhost/api/goals/jobs/${job.id}`, {
        method: "GET",
        headers: {
          [AGENTIC_ACCESS_KEY_HEADER]: "test-access-key"
        }
      }),
      {
        params: Promise.resolve({ id: job.id })
      }
    );
    const payload = (await response.json()) as { error?: string };

    expect(response.status).toBe(404);
    expect(payload.error).toContain(`Goal job ${job.id} was not found.`);
  });

  it("returns a sanitized dead-letter failure message from the goal job status route", async () => {
    const repository = createRouteTestRepository();

    await repository.seedDefaults(DEFAULT_OWNER_USER_ID);
    const queued = await repository.enqueueJob(createJobRecord({
      userId: DEFAULT_OWNER_USER_ID,
      kind: "goal_create",
      payload: {
        type: "goal_create",
        goalId: "goal-dead-letter",
        workflowId: "workflow-dead-letter",
        request: "Simulate a poisoned durable goal job.",
        workspaceId: null,
        agentId: null,
        metadata: {}
      },
      actorContext: createSystemActorContext(DEFAULT_OWNER_USER_ID)
    }));
    const claimed = await repository.claimNextJob({
      userId: DEFAULT_OWNER_USER_ID,
      runnerId: "worker-dead-letter-test",
      leaseMs: 1_000,
      now: new Date(Date.parse(queued.availableAt) + 1_000).toISOString()
    });

    expect(claimed?.id).toBe(queued.id);

    await repository.deadLetterJob({
      jobId: queued.id,
      runnerId: "worker-dead-letter-test",
      deadLetteredAt: "2026-04-16T10:01:00.000Z",
      error: "Connector token SECRET=top-secret-value expired."
    });

    Reflect.set(globalThis, "__agenticRepository", undefined);

    const response = await goalJobRoute(
      new Request(`http://localhost/api/goals/jobs/${queued.id}`, {
        method: "GET",
        headers: {
          [AGENTIC_ACCESS_KEY_HEADER]: "test-access-key"
        }
      }),
      {
        params: Promise.resolve({ id: queued.id })
      }
    );
    const payload = (await response.json()) as {
      job: { id: string; status: string };
      result: null;
      error: string;
    };

    expect(response.status).toBe(200);
    expect(payload.job.id).toBe(queued.id);
    expect(payload.job.status).toBe("dead_letter");
    expect(payload.result).toBeNull();
    expect(payload.error).toBe("Goal creation failed. Retry the request or inspect worker logs.");
    expect(payload.error).not.toContain("SECRET");
  });

  it("returns a sanitized dead-letter failure message for queued goal refinements", async () => {
    const repository = createRouteTestRepository();

    await repository.seedDefaults(DEFAULT_OWNER_USER_ID);
    const bundle = await createGoalForUser(repository, DEFAULT_OWNER_USER_ID, "Prepare a refined planning bundle.");
    const queued = await repository.enqueueJob(createJobRecord({
      userId: DEFAULT_OWNER_USER_ID,
      kind: "goal_refine",
      payload: {
        type: "goal_refine",
        goalId: bundle.goal.id,
        workflowId: bundle.workflow.id,
        refinement: "Add an executive-ready narrative.",
        workspaceId: bundle.goal.workspaceId,
        metadata: {}
      },
      actorContext: createSystemActorContext(DEFAULT_OWNER_USER_ID)
    }));
    const claimed = await repository.claimNextJob({
      userId: DEFAULT_OWNER_USER_ID,
      runnerId: "worker-refine-dead-letter-test",
      leaseMs: 1_000,
      now: new Date(Date.parse(queued.availableAt) + 1_000).toISOString()
    });

    expect(claimed?.id).toBe(queued.id);

    await repository.deadLetterJob({
      jobId: queued.id,
      runnerId: "worker-refine-dead-letter-test",
      deadLetteredAt: "2026-04-16T10:01:00.000Z",
      error: "Connector token SECRET=top-secret-value expired."
    });

    Reflect.set(globalThis, "__agenticRepository", undefined);

    const response = await goalJobRoute(
      new Request(`http://localhost/api/goals/jobs/${queued.id}`, {
        method: "GET",
        headers: {
          [AGENTIC_ACCESS_KEY_HEADER]: "test-access-key"
        }
      }),
      {
        params: Promise.resolve({ id: queued.id })
      }
    );
    const payload = (await response.json()) as {
      job: { id: string; status: string };
      result: null;
      error: string;
    };

    expect(response.status).toBe(200);
    expect(payload.job.id).toBe(queued.id);
    expect(payload.job.status).toBe("dead_letter");
    expect(payload.result).toBeNull();
    expect(payload.error).toBe("Goal refinement failed. Retry the request or inspect worker logs.");
    expect(payload.error).not.toContain("SECRET");
  }, 15_000);

  it("stamps access-key actor context onto goal refinement logs", async () => {
    const repository = createRouteTestRepository();

    await repository.seedDefaults(DEFAULT_OWNER_USER_ID);
    const bundle = await createGoalForUser(repository, DEFAULT_OWNER_USER_ID, "Plan follow-ups for my open client work.");

    Reflect.set(globalThis, "__agenticRepository", undefined);

    const response = await goalRefineRoute(
      new Request(`http://localhost/api/goals/${bundle.goal.id}/refine`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          [AGENTIC_ACCESS_KEY_HEADER]: "test-access-key"
        },
        body: JSON.stringify({
          message: "Also include a handoff summary for the reviewer."
        })
      }),
      {
        params: Promise.resolve({ id: bundle.goal.id })
      }
    );
    const payload = (await response.json()) as {
      job: { id: string; goalId: string; status: string };
      statusUrl: string;
    };

    expect(response.status).toBe(202);
    expect(payload.job.status).toBe("queued");

    const workerResult = await processQueuedGoalJobs();
    const persistedBundle = await repository.getGoalBundleForUser(bundle.goal.id, DEFAULT_OWNER_USER_ID);
    const refinementLogs = persistedBundle?.actionLogs.filter((log) => log.kind === "goal.refined") ?? [];

    expect(workerResult).toEqual({
      processedCount: 1,
      stopReason: "max_jobs"
    });
    expect(refinementLogs.length).toBeGreaterThanOrEqual(1);
    expect(refinementLogs.every((log) => log.details.actorContext)).toBe(true);
    expect(refinementLogs[0]?.details.actorContext).toEqual(createSystemActorContext(DEFAULT_OWNER_USER_ID));
  });

  it("stamps session actor context onto goal refinement logs", async () => {
    const repository = createRouteTestRepository();
    const secondaryUserId = "user-secondary";

    await repository.seedDefaults(secondaryUserId);
    const bundle = await createGoalForUser(repository, secondaryUserId, "Prepare a weekly planning summary.");
    const requireApiSessionSpy = vi.spyOn(authModule, "requireApiSession").mockResolvedValue({
      authMethod: "session",
      userId: secondaryUserId,
      sessionId: "session-secondary",
      expiresAt: null
    });

    Reflect.set(globalThis, "__agenticRepository", undefined);

    try {
      const response = await goalRefineRoute(
        new Request(`http://localhost/api/goals/${bundle.goal.id}/refine`, {
          method: "POST",
          headers: {
            "content-type": "application/json"
          },
          body: JSON.stringify({
            message: "Add an explicit risks section for leadership."
          })
        }),
        {
          params: Promise.resolve({ id: bundle.goal.id })
        }
      );
      const payload = (await response.json()) as {
        job: { id: string; goalId: string; status: string };
        statusUrl: string;
      };

      expect(response.status).toBe(202);
      expect(payload.job.status).toBe("queued");

      const workerResult = await processQueuedGoalJobs();
      const persistedBundle = await repository.getGoalBundleForUser(bundle.goal.id, secondaryUserId);
      const refinementLogs = persistedBundle?.actionLogs.filter((log) => log.kind === "goal.refined") ?? [];

      expect(workerResult).toEqual({
        processedCount: 1,
        stopReason: "max_jobs"
      });
      expect(refinementLogs.length).toBeGreaterThanOrEqual(1);
      expect(refinementLogs[0]?.details.actorContext).toEqual(createHumanActorContext(secondaryUserId, "session-secondary"));
    } finally {
      requireApiSessionSpy.mockRestore();
    }
  });
});
