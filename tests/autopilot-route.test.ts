import { mkdtemp } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  DEFAULT_AUTOPILOT_RELIABILITY_CONTROLS,
  GoalTemplateSchema,
  SYSTEM_USER_ID,
  WatcherSchema,
  WorkspaceMemberSchema,
  WorkspaceSchema,
  createHumanActorContext,
  createSystemActorContext,
  nowIso
} from "@agentic/contracts";
import { createRepository } from "@agentic/repository";
import { processUserRequest } from "@agentic/orchestrator";
import { createSelfImprovementRepository } from "@agentic/self-improvement-memory";
import { runWorkerRuntime } from "@agentic/worker-runtime";
import { vi } from "vitest";
import {
  resetAuthSessionStateStoreForTesting,
  setAuthSessionStateStoreForTesting,
  type AuthSessionStateStore
} from "../apps/web/lib/auth-session-store";
import * as authModule from "../apps/web/lib/auth";
import { AGENTIC_ACCESS_KEY_HEADER } from "../apps/web/lib/auth";
import { POST as autopilotEventsRoute } from "../apps/web/app/api/autopilot/events/route";

describe("autopilot events route", () => {
  const originalAccessKey = process.env.AGENTIC_ACCESS_KEY;
  const originalRuntimeStorePath = process.env.AGENTIC_RUNTIME_STORE_PATH;

  beforeEach(async () => {
    process.env.AGENTIC_ACCESS_KEY = "test-access-key";
    process.env.AGENTIC_RUNTIME_STORE_PATH = path.join(
      await mkdtemp(path.join(os.tmpdir(), "agentic-autopilot-route-")),
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

  function buildRequest(body: unknown) {
    return new Request("http://localhost/api/autopilot/events", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        [AGENTIC_ACCESS_KEY_HEADER]: "test-access-key"
      },
      body: JSON.stringify(body)
    });
  }

  async function createGoalForUser(request: string, userId = SYSTEM_USER_ID, workspaceId?: string | null) {
    const repository = createRepository({
      storePath: process.env.AGENTIC_RUNTIME_STORE_PATH
    });

    await repository.seedDefaults(userId);

    const bundle = await processUserRequest({
      userId,
      workspaceId,
      request,
      memories: await repository.listMemory(userId),
      integrations: await repository.listIntegrations(userId)
    });

    await repository.saveGoalBundle(bundle);
    return { repository, bundle };
  }

  async function createSharedWorkspace(
    repository: ReturnType<typeof createRepository>,
    ownerUserId: string,
    memberUserId: string
  ) {
    const timestamp = "2026-04-22T00:00:00.000Z";
    const ownerActor = createSystemActorContext(ownerUserId);
    const workspaceId = "workspace-shared-autopilot";

    await repository.saveWorkspace(
      WorkspaceSchema.parse({
        id: workspaceId,
        ownerUserId,
        slug: "shared-autopilot",
        name: "Shared Autopilot Workspace",
        description: "Shared workspace for autopilot permission tests.",
        isPersonal: false,
        createdAt: timestamp,
        updatedAt: timestamp
      }),
      ownerActor
    );
    await repository.saveWorkspaceMember(
      WorkspaceMemberSchema.parse({
        id: "workspace-shared-autopilot-owner",
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
            id: `workspace-shared-autopilot-${memberUserId}-${role}`,
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

  async function runAutopilotWorker(repository = createRepository({ storePath: process.env.AGENTIC_RUNTIME_STORE_PATH })) {
    const selfImprovementRepository = createSelfImprovementRepository({
      baseDir: path.join(path.dirname(process.env.AGENTIC_RUNTIME_STORE_PATH!), "self-improvement")
    });

    await selfImprovementRepository.seed();

    return runWorkerRuntime({
      repository,
      selfImprovementRepository,
      runnerId: "autopilot-route-test-worker",
      maxJobs: 1,
      pollIntervalMs: 10,
      claim: {
        userId: SYSTEM_USER_ID,
        kinds: ["autopilot_process"]
      }
    });
  }

  async function getAutopilotEvent(repository: ReturnType<typeof createRepository>, eventId: string, userId = SYSTEM_USER_ID) {
    const events = await repository.listAutopilotEvents(userId);
    return events.find((event) => event.id === eventId) ?? null;
  }

  it("simulates watcher-triggered events without persisting execution state", async () => {
    const { repository, bundle } = await createGoalForUser("Track priority inbox changes.");
    const watcher = WatcherSchema.parse({
      id: "watcher-autopilot-dry-run",
      goalId: bundle.goal.id,
      targetEntity: "priority-inbox",
      condition: "an urgent customer reply arrives",
      frequency: "hourly",
      triggerAction: "draft a response plan",
      sourceSystems: ["email"],
      status: "active",
      expiryAt: null,
      createdAt: nowIso(),
      updatedAt: nowIso()
    });

    await repository.saveWatcher(watcher);
    Reflect.set(globalThis, "__agenticRepository", undefined);

    const response = await autopilotEventsRoute(
      buildRequest({
        kind: "watcher_triggered",
        sourceId: watcher.id,
        mode: "draft_goal",
        dryRun: true
      })
    );
    const payload = (await response.json()) as {
      simulated: boolean;
      event: {
        status: string;
        actorContext: unknown;
        details: {
          eventEnvelope?: {
            family: string;
            trigger: string;
            priority: string;
          };
          suppression?: {
            outcome: string;
          };
        };
      };
    };

    expect(response.status).toBe(200);
    expect(payload.simulated).toBe(true);
    expect(payload.event.status).toBe("simulated");
    expect(payload.event.actorContext).toEqual(createSystemActorContext(SYSTEM_USER_ID));
    expect(payload.event.details).toMatchObject({
      eventEnvelope: {
        family: "watcher",
        trigger: "watcher_triggered",
        priority: "high"
      },
      suppression: {
        outcome: "allowed"
      }
    });
    await expect(repository.listGoals(SYSTEM_USER_ID)).resolves.toHaveLength(1);
    await expect(repository.listAutopilotEvents(SYSTEM_USER_ID)).resolves.toHaveLength(0);
  });

  it("simulates connector-failure events without persisting execution state", async () => {
    const repository = createRepository({
      storePath: process.env.AGENTIC_RUNTIME_STORE_PATH
    });

    await repository.seedDefaults(SYSTEM_USER_ID);
    Reflect.set(globalThis, "__agenticRepository", undefined);

    const response = await autopilotEventsRoute(
      buildRequest({
        kind: "connector_failed",
        sourceId: "gmail-sync",
        mode: "draft_goal",
        dryRun: true,
        details: {
          connector: "gmail",
          error: "Provider timeout while syncing inbound queue",
          impact: "VIP inbox triage is blocked"
        }
      })
    );
    const payload = (await response.json()) as {
      simulated: boolean;
      event: {
        status: string;
        summary: string;
        details: {
          eventEnvelope?: {
            family: string;
            trigger: string;
            priority: string;
          };
          suppression?: {
            outcome: string;
          };
        };
      };
    };

    expect(response.status).toBe(200);
    expect(payload.simulated).toBe(true);
    expect(payload.event.status).toBe("simulated");
    expect(payload.event.summary).toBe("Connector failure: gmail");
    expect(payload.event.details).toMatchObject({
      eventEnvelope: {
        family: "connector",
        trigger: "connector_failed",
        priority: "critical"
      },
      suppression: {
        outcome: "allowed"
      }
    });
    await expect(repository.listAutopilotEvents(SYSTEM_USER_ID)).resolves.toHaveLength(0);
  });

  it.each([
    {
      kind: "communication_received" as const,
      request: "Prepare the renewal plan for the finance inbox.",
      sourceId: "thread-finance-renewal",
      details: {
        sender: "CFO",
        subject: "Renewal approval needed"
      },
      enrich: (bundle: Awaited<ReturnType<typeof createGoalForUser>>["bundle"]) => ({
        goalId: bundle.goal.id
      }),
      expectedSummary: "Inbound communication from CFO: Renewal approval needed",
      expectedFamily: "communication",
      expectedPriority: "high",
      expectedQueue: "communications_inbox",
      expectedActionLabel: "Open goal"
    },
    {
      kind: "deadline_drift_detected" as const,
      request: "Recover the vendor onboarding workflow before the handoff date.",
      sourceIdFromBundle: "workflow" as const,
      details: {
        workflowName: "Vendor onboarding",
        deadlineAt: "2026-04-22T09:00:00.000Z"
      },
      expectedSummary: "Deadline drift detected for Vendor onboarding (2026-04-22T09:00:00.000Z)",
      expectedFamily: "deadline",
      expectedPriority: "high",
      expectedQueue: "deadline_recovery",
      expectedActionLabel: "Open goal"
    },
    {
      kind: "workflow_stalled" as const,
      request: "Unblock the contract review workflow for legal.",
      sourceIdFromBundle: "workflow" as const,
      details: {
        workflowName: "Contract review",
        blockedStep: "legal-approval"
      },
      expectedSummary: "Workflow stalled: Contract review",
      expectedFamily: "workflow",
      expectedPriority: "high",
      expectedQueue: "workflow_recovery",
      expectedActionLabel: "Open goal"
    },
    {
      kind: "dormant_workflow_review_due" as const,
      request: "Review the dormant quarterly vendor check-in workflow.",
      sourceIdFromBundle: "workflow" as const,
      details: {
        workflowName: "Quarterly vendor review",
        dormantDays: 21
      },
      expectedSummary: "Dormant workflow review due: Quarterly vendor review",
      expectedFamily: "workflow",
      expectedPriority: "medium",
      expectedQueue: "workflow_review",
      expectedActionLabel: "Review workflow"
    }
  ])(
    "simulates $kind events with normalized family, queue, and operator routing metadata",
    async ({
      kind,
      request,
      sourceId,
      sourceIdFromBundle,
      details,
      enrich,
      expectedSummary,
      expectedFamily,
      expectedPriority,
      expectedQueue,
      expectedActionLabel
    }) => {
      const { repository, bundle } = await createGoalForUser(request);
      Reflect.set(globalThis, "__agenticRepository", undefined);

      const response = await autopilotEventsRoute(
        buildRequest({
          kind,
          sourceId: sourceId ?? (sourceIdFromBundle === "workflow" ? bundle.workflow.id : bundle.goal.id),
          mode: "draft_goal",
          dryRun: true,
          details: {
            ...details,
            ...(enrich ? enrich(bundle) : {})
          }
        })
      );
      const payload = (await response.json()) as {
        simulated: boolean;
        event: {
          status: string;
          summary: string;
          details: {
            eventEnvelope?: {
              family: string;
              trigger: string;
              priority: string;
            };
            policy?: {
              queue: string;
              severity: string;
            };
            operatorRoute?: {
              section: string;
              itemId?: string;
              label: string;
              actionLabel?: string;
            };
            goalId?: string | null;
            workflowId?: string | null;
            workspaceId?: string | null;
          };
        };
      };

      expect(response.status).toBe(200);
      expect(payload.simulated).toBe(true);
      expect(payload.event.status).toBe("simulated");
      expect(payload.event.summary).toBe(expectedSummary);
      expect(payload.event.details.eventEnvelope).toMatchObject({
        family: expectedFamily,
        trigger: kind,
        priority: expectedPriority
      });
      expect(payload.event.details.policy).toMatchObject({
        queue: expectedQueue,
        severity: expectedPriority
      });
      expect(payload.event.details.operatorRoute).toMatchObject({
        section: "goals",
        itemId: bundle.goal.id,
        label: bundle.goal.title,
        actionLabel: expectedActionLabel
      });
      expect(payload.event.details.goalId).toBe(bundle.goal.id);
      expect(payload.event.details.workflowId).toBe(bundle.workflow.id);
      expect(payload.event.details.workspaceId).toBe(bundle.workflow.workspaceId);
      await expect(repository.listAutopilotEvents(SYSTEM_USER_ID)).resolves.toHaveLength(0);
    }
  );

  it.each([
    {
      kind: "communication_received" as const,
      request: "Prepare the renewal plan for the finance inbox.",
      sourceId: "thread-finance-renewal",
      details: {
        sender: "CFO",
        subject: "Renewal approval needed"
      },
      enrich: (bundle: Awaited<ReturnType<typeof createGoalForUser>>["bundle"]) => ({
        goalId: bundle.goal.id
      }),
      expectedSummary: "Inbound communication from CFO: Renewal approval needed",
      expectedFamily: "communication",
      expectedPriority: "high",
      expectedActionLabel: "Open goal"
    },
    {
      kind: "deadline_drift_detected" as const,
      request: "Recover the vendor onboarding workflow before the handoff date.",
      sourceIdFromBundle: "workflow" as const,
      details: {
        workflowName: "Vendor onboarding",
        deadlineAt: "2026-04-22T09:00:00.000Z"
      },
      expectedSummary: "Deadline drift detected for Vendor onboarding (2026-04-22T09:00:00.000Z)",
      expectedFamily: "deadline",
      expectedPriority: "high",
      expectedActionLabel: "Open goal"
    },
    {
      kind: "workflow_stalled" as const,
      request: "Unblock the contract review workflow for legal.",
      sourceIdFromBundle: "workflow" as const,
      details: {
        workflowName: "Contract review",
        blockedStep: "legal-approval"
      },
      expectedSummary: "Workflow stalled: Contract review",
      expectedFamily: "workflow",
      expectedPriority: "high",
      expectedActionLabel: "Open goal"
    },
    {
      kind: "dormant_workflow_review_due" as const,
      request: "Review the dormant quarterly vendor check-in workflow.",
      sourceIdFromBundle: "workflow" as const,
      details: {
        workflowName: "Quarterly vendor review",
        dormantDays: 21
      },
      expectedSummary: "Dormant workflow review due: Quarterly vendor review",
      expectedFamily: "workflow",
      expectedPriority: "medium",
      expectedActionLabel: "Review workflow"
    }
  ])(
    "executes $kind events through the worker and records the resulting goal",
    async ({
      kind,
      request,
      sourceId,
      sourceIdFromBundle,
      details,
      enrich,
      expectedSummary,
      expectedFamily,
      expectedPriority,
      expectedActionLabel
    }) => {
      const { repository, bundle } = await createGoalForUser(request);
      Reflect.set(globalThis, "__agenticRepository", undefined);

      const response = await autopilotEventsRoute(
        buildRequest({
          kind,
          sourceId: sourceId ?? (sourceIdFromBundle === "workflow" ? bundle.workflow.id : bundle.goal.id),
          mode: "draft_goal",
          details: {
            ...details,
            ...(enrich ? enrich(bundle) : {})
          }
        })
      );
      const payload = (await response.json()) as {
        event: {
          id: string;
          status: string;
          summary: string;
          resultGoalId: string | null;
          details: {
            eventEnvelope?: {
              family: string;
              trigger: string;
              priority: string;
            };
            operatorRoute?: {
              section: string;
              itemId?: string;
              label: string;
              actionLabel?: string;
            };
          };
        };
        job: {
          id: string;
        };
        queued: boolean;
      };
      const workerResult = await runAutopilotWorker(repository);
      const event = await getAutopilotEvent(repository, payload.event.id);

      expect(response.status).toBe(202);
      expect(payload.queued).toBe(true);
      expect(payload.event.status).toBe("pending");
      expect(payload.event.resultGoalId).toBeNull();
      expect(payload.event.summary).toBe(expectedSummary);
      expect(payload.event.details.eventEnvelope).toMatchObject({
        family: expectedFamily,
        trigger: kind,
        priority: expectedPriority
      });
      expect(payload.event.details.operatorRoute).toMatchObject({
        section: "goals",
        itemId: bundle.goal.id,
        label: bundle.goal.title,
        actionLabel: expectedActionLabel
      });
      expect(workerResult).toEqual({
        processedCount: 1,
        stopReason: "max_jobs"
      });
      expect(event?.status).toBe("executed");
      expect(event?.resultGoalId).toBeTruthy();
      expect(event?.summary).toBe(expectedSummary);
      expect(event?.details.eventEnvelope).toMatchObject({
        family: expectedFamily,
        trigger: kind,
        priority: expectedPriority
      });
      expect(event?.details.operatorRoute).toMatchObject({
        section: "goals",
        itemId: bundle.goal.id,
        label: bundle.goal.title,
        actionLabel: expectedActionLabel
      });
      await expect(repository.listGoals(SYSTEM_USER_ID)).resolves.toHaveLength(2);
    }
  );

  it("rate limits autopilot event creation with a route-scoped abuse key", async () => {
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

    const response = await autopilotEventsRoute(
      buildRequest({
        kind: "watcher_triggered",
        sourceId: "watcher-autopilot-rate-limit"
      })
    );
    const payload = (await response.json()) as { error: string };

    expect(response.status).toBe(429);
    expect(response.headers.get("retry-after")).toBe("30");
    expect(payload).toEqual({
      error: "Too many autopilot event requests. Try again later."
    });
    expect(seenKeys).toHaveLength(1);
    expect(seenKeys[0]).toContain("autopilot-event:user:");
    expect(seenKeys[0]).toContain(":fp:/api/autopilot/events:");
  });

  it("queues watcher-triggered events, reuses the same durable job for duplicates, and completes execution in the worker", async () => {
    const { repository, bundle } = await createGoalForUser("Watch my inbound queue for VIP customer issues.");
    const watcher = WatcherSchema.parse({
      id: "watcher-autopilot-duplicate",
      goalId: bundle.goal.id,
      targetEntity: "vip-inbox",
      condition: "a VIP thread becomes urgent",
      frequency: "hourly",
      triggerAction: "prepare the next response",
      sourceSystems: ["email"],
      status: "active",
      expiryAt: null,
      createdAt: nowIso(),
      updatedAt: nowIso()
    });

    await repository.saveWatcher(watcher);
    Reflect.set(globalThis, "__agenticRepository", undefined);

    const firstResponse = await autopilotEventsRoute(
      buildRequest({
        kind: "watcher_triggered",
        sourceId: watcher.id,
        mode: "draft_goal",
        idempotencyKey: "watcher-vip-1"
      })
    );
    const firstPayload = (await firstResponse.json()) as {
      event: {
        id: string;
        status: string;
        resultGoalId: string | null;
        actorContext: unknown;
      };
      job: {
        id: string;
        status: string;
      };
      queued: boolean;
    };

    const secondResponse = await autopilotEventsRoute(
      buildRequest({
        kind: "watcher_triggered",
        sourceId: watcher.id,
        mode: "draft_goal",
        idempotencyKey: "watcher-vip-1"
      })
    );
    const secondPayload = (await secondResponse.json()) as {
      duplicate?: boolean;
      event: {
        id: string;
        status: string;
        resultGoalId: string | null;
        actorContext: unknown;
      };
      job: {
        id: string;
        status: string;
      };
      queued: boolean;
    };
    const queuedJobs = await repository.listJobs({
      userId: SYSTEM_USER_ID,
      kinds: ["autopilot_process"]
    });
    const workerResult = await runAutopilotWorker(repository);
    const completedEvent = await getAutopilotEvent(repository, firstPayload.event.id);
    const persistedEvents = await repository.listAutopilotEvents(SYSTEM_USER_ID);
    const completedJob = await repository.getJob(firstPayload.job.id, SYSTEM_USER_ID);

    expect(firstResponse.status).toBe(202);
    expect(firstPayload.queued).toBe(true);
    expect(firstPayload.event.status).toBe("pending");
    expect(firstPayload.event.resultGoalId).toBeNull();
    expect(firstPayload.event.actorContext).toEqual(createSystemActorContext(SYSTEM_USER_ID));
    expect(firstPayload.job.status).toBe("queued");
    expect(secondResponse.status).toBe(202);
    expect(secondPayload.queued).toBe(true);
    expect(secondPayload.duplicate).toBe(true);
    expect(secondPayload.event.id).toBe(firstPayload.event.id);
    expect(secondPayload.event.actorContext).toEqual(createSystemActorContext(SYSTEM_USER_ID));
    expect(secondPayload.job.id).toBe(firstPayload.job.id);
    expect(queuedJobs).toHaveLength(1);
    expect(workerResult).toEqual({
      processedCount: 1,
      stopReason: "max_jobs"
    });
    expect(completedEvent?.status).toBe("executed");
    expect(completedEvent?.resultGoalId).toBeTruthy();
    expect(completedEvent?.details.taskCount).toBeGreaterThan(0);
    expect(completedEvent?.details.jobId).toBe(firstPayload.job.id);
    expect(completedEvent?.details.jobStatus).toBe("completed");
    expect(completedEvent?.details.processingLatencyMs).toBeGreaterThanOrEqual(0);
    expect(completedJob).toMatchObject({
      id: firstPayload.job.id,
      status: "completed",
      attemptCount: 1
    });
    await expect(repository.listGoals(SYSTEM_USER_ID)).resolves.toHaveLength(2);
    expect(persistedEvents).toHaveLength(1);
    expect(persistedEvents[0]?.actorContext).toEqual(createSystemActorContext(SYSTEM_USER_ID));
    expect(persistedEvents[0]?.status).toBe("executed");
  });

  it("captures sanitized recovery context when worker execution fails after the event is queued", async () => {
    const { repository, bundle } = await createGoalForUser("Watch my inbound queue for VIP customer issues.");
    const watcher = WatcherSchema.parse({
      id: "watcher-autopilot-failure",
      goalId: bundle.goal.id,
      targetEntity: "vip-inbox-failure",
      condition: "a VIP escalation arrives",
      frequency: "hourly",
      triggerAction: "prepare the next response",
      sourceSystems: ["email"],
      status: "active",
      expiryAt: null,
      createdAt: nowIso(),
      updatedAt: nowIso()
    });

    await repository.saveWatcher(watcher);
    const originalSaveGoalBundle = repository.saveGoalBundle.bind(repository);
    Reflect.set(globalThis, "__agenticRepository", repository);

    const response = await autopilotEventsRoute(
      buildRequest({
        kind: "watcher_triggered",
        sourceId: watcher.id,
        mode: "draft_goal",
        idempotencyKey: "watcher-failure-1"
      })
    );
    const payload = (await response.json()) as {
      event: {
        id: string;
        status: string;
        actorContext: unknown;
      };
      job: {
        id: string;
      };
      queued: boolean;
    };
    repository.saveGoalBundle = async () => {
      throw new Error("Synthetic autopilot execution failure");
    };
    const workerResult = await runAutopilotWorker(repository);
    const failedEvent = await getAutopilotEvent(repository, payload.event.id);
    const failedJob = await repository.getJob(payload.job.id, SYSTEM_USER_ID);
    const autopilotEvents = await repository.listAutopilotEvents(SYSTEM_USER_ID);

    repository.saveGoalBundle = originalSaveGoalBundle;

    expect(response.status).toBe(202);
    expect(payload.queued).toBe(true);
    expect(payload.event.status).toBe("pending");
    expect(payload.event.actorContext).toEqual(createSystemActorContext(SYSTEM_USER_ID));
    expect(workerResult).toEqual({
      processedCount: 1,
      stopReason: "max_jobs"
    });
    expect(failedEvent?.status).toBe("failed");
    expect(failedEvent?.error).toBe("Autopilot execution failed.");
    expect(failedEvent?.details.failureStage).toBe("execution");
    expect(failedEvent?.details.requiresReview).toBe(true);
    expect(failedEvent?.details.recoveryAction).toBe("worker_retry_scheduled");
    expect(failedEvent?.details.jobStatus).toBe("retrying");
    expect(failedEvent?.details.jobId).toBe(payload.job.id);
    expect(failedEvent?.details.nextRetryAt).toBeTruthy();
    expect(failedEvent?.details.processingLatencyMs).toBeGreaterThanOrEqual(0);
    expect(failedJob?.status).toBe("retrying");
    expect(autopilotEvents).toHaveLength(1);
    expect(autopilotEvents[0]?.status).toBe("failed");
    expect(autopilotEvents[0]?.actorContext).toEqual(createSystemActorContext(SYSTEM_USER_ID));
    await expect(repository.listGoals(SYSTEM_USER_ID)).resolves.toHaveLength(1);
  });

  it("uses the session principal when resolving watcher-triggered autopilot sources", async () => {
    const repository = createRepository({
      storePath: process.env.AGENTIC_RUNTIME_STORE_PATH
    });
    const secondaryUserId = "user-secondary";

    await repository.seedDefaults(SYSTEM_USER_ID);
    await repository.seedDefaults(secondaryUserId);

    const primaryBundle = await processUserRequest({
      userId: SYSTEM_USER_ID,
      request: "Watch my inbound queue for VIP customer issues.",
      memories: await repository.listMemory(SYSTEM_USER_ID),
      integrations: await repository.listIntegrations(SYSTEM_USER_ID)
    });
    await repository.saveGoalBundle(primaryBundle);

    const primaryWatcher = WatcherSchema.parse({
      id: "watcher-system-scope",
      goalId: primaryBundle.goal.id,
      targetEntity: "vip-inbox",
      condition: "a VIP thread becomes urgent",
      frequency: "hourly",
      triggerAction: "prepare the next response",
      sourceSystems: ["email"],
      status: "active",
      expiryAt: null,
      createdAt: nowIso(),
      updatedAt: nowIso()
    });

    await repository.saveWatcher(primaryWatcher);
    Reflect.set(globalThis, "__agenticRepository", undefined);

    const requireApiSessionSpy = vi.spyOn(authModule, "requireApiSession").mockResolvedValue({
      authMethod: "session",
      userId: secondaryUserId,
      sessionId: "session-secondary",
      expiresAt: "2026-12-31T00:00:00.000Z"
    });

    const response = await autopilotEventsRoute(
      new Request("http://localhost/api/autopilot/events", {
        method: "POST",
        headers: {
          "content-type": "application/json"
        },
        body: JSON.stringify({
          kind: "watcher_triggered",
          sourceId: primaryWatcher.id,
          mode: "draft_goal"
        })
      })
    );
    const payload = (await response.json()) as { error?: string };
    requireApiSessionSpy.mockRestore();

    expect(response.status).toBe(404);
    expect(payload.error).toContain(`Watcher ${primaryWatcher.id} was not found.`);
    await expect(repository.listAutopilotEvents(secondaryUserId)).resolves.toHaveLength(0);
  });

  it("returns 403 when a viewer triggers a shared workspace watcher event", async () => {
    const repository = createRepository({
      storePath: process.env.AGENTIC_RUNTIME_STORE_PATH
    });
    const viewerUserId = "user-viewer";

    await repository.seedDefaults(SYSTEM_USER_ID);
    await repository.seedDefaults(viewerUserId);

    const workspace = await createSharedWorkspace(repository, SYSTEM_USER_ID, viewerUserId);
    await workspace.addMember("viewer");

    const bundle = await processUserRequest({
      userId: SYSTEM_USER_ID,
      workspaceId: workspace.workspaceId,
      request: "Watch the shared escalation inbox for VIP issues.",
      memories: await repository.listMemory(SYSTEM_USER_ID),
      integrations: await repository.listIntegrations(SYSTEM_USER_ID)
    });
    await repository.saveGoalBundle(bundle);

    const watcher = await repository.saveWatcher(
      WatcherSchema.parse({
        id: "watcher-shared-viewer-denied",
        goalId: bundle.goal.id,
        targetEntity: "shared-vip-inbox",
        condition: "a VIP thread becomes urgent",
        frequency: "hourly",
        triggerAction: "prepare the next response",
        sourceSystems: ["email"],
        status: "active",
        expiryAt: null,
        createdAt: nowIso(),
        updatedAt: nowIso()
      })
    );
    Reflect.set(globalThis, "__agenticRepository", undefined);

    const requireApiSessionSpy = vi.spyOn(authModule, "requireApiSession").mockResolvedValue({
      authMethod: "session",
      userId: viewerUserId,
      sessionId: "session-viewer",
      expiresAt: "2026-12-31T00:00:00.000Z"
    });

    let response: Response;
    let payload: { error?: string };
    try {
      response = await autopilotEventsRoute(
        new Request("http://localhost/api/autopilot/events", {
          method: "POST",
          headers: {
            "content-type": "application/json"
          },
          body: JSON.stringify({
            kind: "watcher_triggered",
            sourceId: watcher.id,
            mode: "draft_goal",
            dryRun: true
          })
        })
      );
      payload = (await response.json()) as { error?: string };
    } finally {
      requireApiSessionSpy.mockRestore();
    }

    expect(response.status).toBe(403);
    expect(payload.error).toBe("Only workspace owners and editors can manage shared workspace automations.");
    await expect(repository.listAutopilotEvents(viewerUserId)).resolves.toHaveLength(0);
  });

  it("allows editors to trigger shared workspace watcher events", async () => {
    const repository = createRepository({
      storePath: process.env.AGENTIC_RUNTIME_STORE_PATH
    });
    const editorUserId = "user-editor";

    await repository.seedDefaults(SYSTEM_USER_ID);
    await repository.seedDefaults(editorUserId);

    const workspace = await createSharedWorkspace(repository, SYSTEM_USER_ID, editorUserId);
    await workspace.addMember("editor");

    const bundle = await processUserRequest({
      userId: SYSTEM_USER_ID,
      workspaceId: workspace.workspaceId,
      request: "Watch the shared escalation inbox for VIP issues.",
      memories: await repository.listMemory(SYSTEM_USER_ID),
      integrations: await repository.listIntegrations(SYSTEM_USER_ID)
    });
    await repository.saveGoalBundle(bundle);

    const watcher = await repository.saveWatcher(
      WatcherSchema.parse({
        id: "watcher-shared-editor-allowed",
        goalId: bundle.goal.id,
        targetEntity: "shared-vip-inbox",
        condition: "a VIP thread becomes urgent",
        frequency: "hourly",
        triggerAction: "prepare the next response",
        sourceSystems: ["email"],
        status: "active",
        expiryAt: null,
        createdAt: nowIso(),
        updatedAt: nowIso()
      })
    );
    Reflect.set(globalThis, "__agenticRepository", undefined);

    const requireApiSessionSpy = vi.spyOn(authModule, "requireApiSession").mockResolvedValue({
      authMethod: "session",
      userId: editorUserId,
      sessionId: "session-editor",
      expiresAt: "2026-12-31T00:00:00.000Z"
    });

    let response: Response;
    let payload: {
      simulated: boolean;
      event: {
        actorContext: unknown;
        responsibility: {
          owner: { userId: string | null };
        };
      };
    };
    try {
      response = await autopilotEventsRoute(
        new Request("http://localhost/api/autopilot/events", {
          method: "POST",
          headers: {
            "content-type": "application/json"
          },
          body: JSON.stringify({
            kind: "watcher_triggered",
            sourceId: watcher.id,
            mode: "draft_goal",
            dryRun: true
          })
        })
      );
      payload = (await response.json()) as typeof payload;
    } finally {
      requireApiSessionSpy.mockRestore();
    }

    expect(response.status).toBe(200);
    expect(payload.simulated).toBe(true);
    expect(payload.event.actorContext).toEqual(createHumanActorContext(editorUserId, "session-editor"));
    expect(payload.event.responsibility.owner.userId).toBe(editorUserId);
  });

  it("rejects auto-run mode when persistence is file-backed", async () => {
    const { repository, bundle } = await createGoalForUser("Watch my inbox for urgent customer escalations.");
    const watcher = WatcherSchema.parse({
      id: "watcher-autopilot-file-backend",
      goalId: bundle.goal.id,
      targetEntity: "urgent-inbox",
      condition: "a customer escalation arrives",
      frequency: "hourly",
      triggerAction: "prepare the next response",
      sourceSystems: ["email"],
      status: "active",
      expiryAt: null,
      createdAt: nowIso(),
      updatedAt: nowIso()
    });

    await repository.saveWatcher(watcher);
    Reflect.set(globalThis, "__agenticRepository", undefined);

    const response = await autopilotEventsRoute(
      buildRequest({
        kind: "watcher_triggered",
        sourceId: watcher.id,
        mode: "auto_run"
      })
    );
    const payload = (await response.json()) as { error: string; backend: string };

    expect(response.status).toBe(409);
    expect(payload.error).toMatch(/requires Postgres-backed persistence/i);
    expect(payload.backend).toBe("file");
    await expect(repository.listAutopilotEvents(SYSTEM_USER_ID)).resolves.toHaveLength(0);
  });

  it("debounces repeated watcher-triggered events from the same source", async () => {
    const { repository, bundle } = await createGoalForUser("Watch for high-priority internal escalations.");
    const watcher = WatcherSchema.parse({
      id: "watcher-autopilot-debounce",
      goalId: bundle.goal.id,
      targetEntity: "ops-inbox",
      condition: "multiple urgent escalation messages arrive",
      frequency: "hourly",
      triggerAction: "draft the next ops response",
      sourceSystems: ["email"],
      status: "active",
      expiryAt: null,
      createdAt: nowIso(),
      updatedAt: nowIso()
    });

    await repository.saveWatcher(watcher);
    Reflect.set(globalThis, "__agenticRepository", undefined);

    const firstResponse = await autopilotEventsRoute(
      buildRequest({
        kind: "watcher_triggered",
        sourceId: watcher.id,
        mode: "draft_goal"
      })
    );
    const secondResponse = await autopilotEventsRoute(
      buildRequest({
        kind: "watcher_triggered",
        sourceId: watcher.id,
        mode: "draft_goal"
      })
    );
    const secondPayload = (await secondResponse.json()) as {
      debounced?: boolean;
      event: {
        status: string;
        actorContext: unknown;
      };
    };
    const workerResult = await runAutopilotWorker(repository);
    const persistedEvents = await repository.listAutopilotEvents(SYSTEM_USER_ID);

    expect(firstResponse.status).toBe(202);
    expect(secondResponse.status).toBe(200);
    expect(secondPayload.debounced).toBe(true);
    expect(secondPayload.event.status).toBe("debounced");
    expect(secondPayload.event.actorContext).toEqual(createSystemActorContext(SYSTEM_USER_ID));
    expect(workerResult).toEqual({
      processedCount: 1,
      stopReason: "max_jobs"
    });
    await expect(repository.listGoals(SYSTEM_USER_ID)).resolves.toHaveLength(2);
    expect(persistedEvents).toHaveLength(2);
    expect(persistedEvents.some((event) => event.status === "executed")).toBe(true);
    expect(persistedEvents.some((event) => event.status === "debounced")).toBe(true);
    expect(persistedEvents.every((event) => event.actorContext?.subjectUserId === SYSTEM_USER_ID)).toBe(true);
  });

  it("suppresses watcher-triggered events when the source budget is exhausted", async () => {
    const { repository, bundle } = await createGoalForUser("Watch for repeated VIP escalations.");
    const watcher = WatcherSchema.parse({
      id: "watcher-autopilot-budget",
      goalId: bundle.goal.id,
      targetEntity: "vip-escalations",
      condition: "repeated urgent escalations arrive in a short window",
      frequency: "hourly",
      triggerAction: "draft the next operator response",
      sourceSystems: ["email"],
      status: "active",
      expiryAt: null,
      createdAt: nowIso(),
      updatedAt: nowIso()
    });

    await repository.saveWatcher(watcher);
    Reflect.set(globalThis, "__agenticRepository", undefined);

    const firstResponse = await autopilotEventsRoute(
      buildRequest({
        kind: "watcher_triggered",
        sourceId: watcher.id,
        mode: "draft_goal",
        budget: {
          key: "watcher:vip-escalations",
          windowMinutes: 60,
          maxEvents: 1,
          scope: "source"
        }
      })
    );
    const secondResponse = await autopilotEventsRoute(
      buildRequest({
        kind: "watcher_triggered",
        sourceId: watcher.id,
        mode: "draft_goal",
        budget: {
          key: "watcher:vip-escalations",
          windowMinutes: 60,
          maxEvents: 1,
          scope: "source"
        }
      })
    );
    const secondPayload = (await secondResponse.json()) as {
      ignored?: boolean;
      event: {
        status: string;
        details: {
          budget?: {
            key: string;
          };
          suppression?: {
            outcome: string;
            budgetKey: string | null;
            observedCount: number | null;
          };
        };
      };
    };
    const queuedJobs = await repository.listJobs({
      userId: SYSTEM_USER_ID,
      kinds: ["autopilot_process"]
    });
    const persistedEvents = await repository.listAutopilotEvents(SYSTEM_USER_ID);

    expect(firstResponse.status).toBe(202);
    expect(secondResponse.status).toBe(200);
    expect(secondPayload.ignored).toBe(true);
    expect(secondPayload.event.status).toBe("ignored");
    expect(secondPayload.event.details).toMatchObject({
      budget: {
        key: "watcher:vip-escalations"
      },
      suppression: {
        outcome: "budget_exhausted",
        budgetKey: "watcher:vip-escalations",
        observedCount: 1
      }
    });
    expect(queuedJobs).toHaveLength(1);
    expect(persistedEvents.map((event) => event.status).sort()).toEqual(["ignored", "pending"]);
  });

  it("suppresses new queued events when the pending backlog reliability control is exhausted", async () => {
    const { repository, bundle } = await createGoalForUser("Watch for high-priority internal escalations.");
    const watcherOne = WatcherSchema.parse({
      id: "watcher-autopilot-suppression-1",
      goalId: bundle.goal.id,
      targetEntity: "ops-inbox-a",
      condition: "an urgent escalation message arrives",
      frequency: "hourly",
      triggerAction: "draft the next ops response",
      sourceSystems: ["email"],
      status: "active",
      expiryAt: null,
      createdAt: nowIso(),
      updatedAt: nowIso()
    });
    const watcherTwo = WatcherSchema.parse({
      id: "watcher-autopilot-suppression-2",
      goalId: bundle.goal.id,
      targetEntity: "ops-inbox-b",
      condition: "a second urgent escalation message arrives",
      frequency: "hourly",
      triggerAction: "draft the next ops response",
      sourceSystems: ["email"],
      status: "active",
      expiryAt: null,
      createdAt: nowIso(),
      updatedAt: nowIso()
    });

    await repository.saveWatcher(watcherOne);
    await repository.saveWatcher(watcherTwo);
    const currentSettings = await repository.getAutopilotSettings(SYSTEM_USER_ID);
    await repository.saveAutopilotSettings({
      ...currentSettings,
      reliabilityControls: {
        ...DEFAULT_AUTOPILOT_RELIABILITY_CONTROLS,
        maxPendingEvents: 1
      },
      updatedAt: nowIso()
    });
    Reflect.set(globalThis, "__agenticRepository", undefined);

    const firstResponse = await autopilotEventsRoute(
      buildRequest({
        kind: "watcher_triggered",
        sourceId: watcherOne.id,
        mode: "draft_goal"
      })
    );
    const secondResponse = await autopilotEventsRoute(
      buildRequest({
        kind: "watcher_triggered",
        sourceId: watcherTwo.id,
        mode: "draft_goal"
      })
    );
    const secondPayload = (await secondResponse.json()) as {
      suppressed?: boolean;
      queued?: boolean;
      event: {
        status: string;
        details: {
          suppression?: {
            reason?: string;
            pendingEventCount?: number;
            maxPendingEvents?: number;
          };
        };
      };
    };
    const jobs = await repository.listJobs({
      userId: SYSTEM_USER_ID,
      kinds: ["autopilot_process"]
    });
    const events = await repository.listAutopilotEvents(SYSTEM_USER_ID);

    expect(firstResponse.status).toBe(202);
    expect(secondResponse.status).toBe(200);
    expect(secondPayload.suppressed).toBe(true);
    expect(secondPayload.queued).toBeUndefined();
    expect(secondPayload.event.status).toBe("ignored");
    expect(secondPayload.event.details.suppression).toMatchObject({
      reason: "pending_backlog",
      pendingEventCount: 1,
      maxPendingEvents: 1
    });
    expect(jobs).toHaveLength(1);
    expect(events.map((event) => event.status).sort()).toEqual(["ignored", "pending"]);
  });

  it("stamps the human actor when a session principal executes a template-triggered event", async () => {
    const repository = createRepository({
      storePath: process.env.AGENTIC_RUNTIME_STORE_PATH
    });
    const secondaryUserId = "user-secondary";

    await repository.seedDefaults(secondaryUserId);
    await repository.saveTemplate(
      GoalTemplateSchema.parse({
        id: "template-session-run",
        userId: secondaryUserId,
        name: "Session scheduled review",
        description: "Generate a private review workflow.",
        request: "Review my inbox and prepare a private response plan.",
        parameters: {},
        schedule: {
          enabled: true,
          cron: "0 9 * * *",
          timezone: "UTC",
          lastRunAt: null,
          nextRunAt: null
        },
        createdAt: nowIso(),
        updatedAt: nowIso()
      })
    );
    Reflect.set(globalThis, "__agenticRepository", undefined);

    const requireApiSessionSpy = vi.spyOn(authModule, "requireApiSession").mockResolvedValue({
      authMethod: "session",
      userId: secondaryUserId,
      sessionId: "session-secondary",
      expiresAt: "2026-12-31T00:00:00.000Z"
    });

    let response: Response;
    let payload: {
      event: { id: string; actorContext: unknown; resultGoalId: string | null };
      job: { id: string };
      queued: boolean;
    };
    try {
      response = await autopilotEventsRoute(
        new Request("http://localhost/api/autopilot/events", {
          method: "POST",
          headers: {
            "content-type": "application/json"
          },
          body: JSON.stringify({
            kind: "template_due",
            sourceId: "template-session-run",
            mode: "draft_goal"
          })
        })
      );
      payload = (await response.json()) as {
        event: { id: string; actorContext: unknown; resultGoalId: string | null };
        job: { id: string };
        queued: boolean;
      };
    } finally {
      requireApiSessionSpy.mockRestore();
    }

    const selfImprovementRepository = createSelfImprovementRepository({
      baseDir: path.join(path.dirname(process.env.AGENTIC_RUNTIME_STORE_PATH!), "self-improvement")
    });
    await selfImprovementRepository.seed();
    const workerResult = await runWorkerRuntime({
      repository,
      selfImprovementRepository,
      runnerId: "autopilot-route-template-session-worker",
      maxJobs: 1,
      pollIntervalMs: 10,
      claim: {
        userId: secondaryUserId,
        kinds: ["autopilot_process"]
      }
    });
    const events = await repository.listAutopilotEvents(secondaryUserId);
    const updatedTemplate = (await repository.listTemplates(secondaryUserId)).find(
      (template) => template.id === "template-session-run"
    );

    expect(response.status).toBe(202);
    expect(payload.queued).toBe(true);
    expect(payload.event.resultGoalId).toBeNull();
    expect(payload.event.actorContext).toEqual(createHumanActorContext(secondaryUserId, "session-secondary"));
    expect(workerResult).toEqual({
      processedCount: 1,
      stopReason: "max_jobs"
    });
    expect(events).toHaveLength(1);
    expect(events[0]?.actorContext).toEqual(createHumanActorContext(secondaryUserId, "session-secondary"));
    expect(events[0]?.status).toBe("executed");
    expect(events[0]?.resultGoalId).toBeTruthy();
    expect(updatedTemplate?.actorContext).toEqual(createHumanActorContext(secondaryUserId, "session-secondary"));
  });

  it("executes scheduled templates and advances their schedule window", async () => {
    const repository = createRepository({
      storePath: process.env.AGENTIC_RUNTIME_STORE_PATH
    });

    await repository.seedDefaults(SYSTEM_USER_ID);
    await repository.saveTemplate(
      GoalTemplateSchema.parse({
        id: "template-autopilot-run",
        userId: SYSTEM_USER_ID,
        name: "Daily inbox review",
        description: "Generate the morning inbox plan.",
        request: "Review my inbox and generate a focused response plan.",
        parameters: {},
        schedule: {
          enabled: true,
          cron: "0 9 * * *",
          timezone: "UTC",
          lastRunAt: null,
          nextRunAt: null
        },
        createdAt: nowIso(),
        updatedAt: nowIso()
      })
    );
    Reflect.set(globalThis, "__agenticRepository", undefined);

    const response = await autopilotEventsRoute(
      buildRequest({
        kind: "template_due",
        sourceId: "template-autopilot-run",
        mode: "draft_goal"
      })
    );
    const payload = (await response.json()) as {
      event: {
        id: string;
        status: string;
        resultGoalId: string | null;
      };
      job: {
        id: string;
      };
      queued: boolean;
    };
    const workerResult = await runAutopilotWorker(repository);
    const updatedTemplate = (await repository.listTemplates(SYSTEM_USER_ID)).find(
      (template) => template.id === "template-autopilot-run"
    );
    const events = await repository.listAutopilotEvents(SYSTEM_USER_ID);

    expect(response.status).toBe(202);
    expect(payload.queued).toBe(true);
    expect(payload.event.status).toBe("pending");
    expect(payload.event.resultGoalId).toBeNull();
    expect(workerResult).toEqual({
      processedCount: 1,
      stopReason: "max_jobs"
    });
    expect(events[0]?.status).toBe("executed");
    expect(events[0]?.resultGoalId).toBeTruthy();
    expect(updatedTemplate?.actorContext).toEqual(createSystemActorContext(SYSTEM_USER_ID));
    expect(updatedTemplate?.schedule.lastRunAt).toBeTruthy();
    expect(updatedTemplate?.schedule.nextRunAt).toBeTruthy();
    await expect(repository.listGoals(SYSTEM_USER_ID)).resolves.toHaveLength(1);
  });

  it("executes scheduled briefings and records the resulting goal", async () => {
    const repository = createRepository({
      storePath: process.env.AGENTIC_RUNTIME_STORE_PATH
    });

    await repository.seedDefaults(SYSTEM_USER_ID);
    Reflect.set(globalThis, "__agenticRepository", undefined);

    const response = await autopilotEventsRoute(
      buildRequest({
        kind: "briefing_due",
        sourceId: "startup",
        mode: "draft_goal"
      })
    );
    const payload = (await response.json()) as {
      event: {
        id: string;
        status: string;
        resultGoalId: string | null;
      };
      job: {
        id: string;
      };
      queued: boolean;
    };
    const workerResult = await runAutopilotWorker(repository);
    const events = await repository.listAutopilotEvents(SYSTEM_USER_ID);
    const dashboard = await repository.getDashboardData(SYSTEM_USER_ID);

    expect(response.status).toBe(202);
    expect(payload.queued).toBe(true);
    expect(payload.event.status).toBe("pending");
    expect(payload.event.resultGoalId).toBeNull();
    expect(workerResult).toEqual({
      processedCount: 1,
      stopReason: "max_jobs"
    });
    expect(events[0]?.status).toBe("executed");
    expect(events[0]?.resultGoalId).toBeTruthy();
    expect(dashboard.briefingHistory.some((entry) => entry.goalId === events[0]?.resultGoalId)).toBe(true);
    await expect(repository.listGoals(SYSTEM_USER_ID)).resolves.toHaveLength(1);
  });

  it("executes approval-sla-breached events and records the resulting goal", async () => {
    const repository = createRepository({
      storePath: process.env.AGENTIC_RUNTIME_STORE_PATH
    });

    await repository.seedDefaults(SYSTEM_USER_ID);
    Reflect.set(globalThis, "__agenticRepository", undefined);

    const response = await autopilotEventsRoute(
      buildRequest({
        kind: "approval_sla_breached",
        sourceId: "approval-security-review",
        mode: "draft_goal",
        details: {
          approvalTitle: "Security review for outbound send",
          approver: "Ops on-call",
          status: "Waiting 4 hours past the review SLO"
        }
      })
    );
    const payload = (await response.json()) as {
      event: {
        id: string;
        status: string;
        summary: string;
        resultGoalId: string | null;
        details: {
          eventEnvelope?: {
            family: string;
            trigger: string;
            priority: string;
          };
        };
      };
      job: {
        id: string;
      };
      queued: boolean;
    };
    const workerResult = await runAutopilotWorker(repository);
    const events = await repository.listAutopilotEvents(SYSTEM_USER_ID);

    expect(response.status).toBe(202);
    expect(payload.queued).toBe(true);
    expect(payload.event.status).toBe("pending");
    expect(payload.event.resultGoalId).toBeNull();
    expect(payload.event.summary).toBe("Approval SLA breached: Security review for outbound send");
    expect(payload.event.details.eventEnvelope).toMatchObject({
      family: "approval",
      trigger: "approval_sla_breached",
      priority: "critical"
    });
    expect(workerResult).toEqual({
      processedCount: 1,
      stopReason: "max_jobs"
    });
    expect(events[0]?.status).toBe("executed");
    expect(events[0]?.resultGoalId).toBeTruthy();
    expect(events[0]?.summary).toBe("Approval SLA breached: Security review for outbound send");
    await expect(repository.listGoals(SYSTEM_USER_ID)).resolves.toHaveLength(1);
  });

  it("normalizes workflow-stalled dry runs into the shared event fabric envelope", async () => {
    const { repository, bundle } = await createGoalForUser("Coordinate launch readiness reviews for a cross-team workflow.");
    Reflect.set(globalThis, "__agenticRepository", undefined);

    const response = await autopilotEventsRoute(
      buildRequest({
        kind: "workflow_stalled",
        sourceId: "workflow-stall-launch-readiness",
        mode: "draft_goal",
        dryRun: true,
        details: {
          stalledStep: "legal_review",
          status: "blocked",
          stalledSince: "2026-04-16T00:00:00.000Z",
          blocker: "Waiting for legal sign-off",
          references: {
            goalId: bundle.goal.id,
            workflowId: bundle.workflow.id
          }
        }
      })
    );
    const payload = (await response.json()) as {
      simulated: boolean;
      event: {
        status: string;
        details: {
          dryRun: boolean;
          fabric: {
            family: string;
            severity: string;
            operatorRoute: string;
            policy: string;
            references: {
              goalId: string | null;
              workflowId: string | null;
            };
          };
        };
      };
    };

    expect(response.status).toBe(200);
    expect(payload.simulated).toBe(true);
    expect(payload.event.status).toBe("simulated");
    expect(payload.event.details.dryRun).toBe(true);
    expect(payload.event.details.fabric).toMatchObject({
      family: "workflow_stall",
      severity: "high",
      operatorRoute: "workflow",
      policy: "queue_operator_review",
      references: {
        goalId: bundle.goal.id,
        workflowId: bundle.workflow.id
      }
    });
    await expect(repository.listAutopilotEvents(SYSTEM_USER_ID)).resolves.toHaveLength(0);
    await expect(repository.listGoals(SYSTEM_USER_ID)).resolves.toHaveLength(1);
  });
});
