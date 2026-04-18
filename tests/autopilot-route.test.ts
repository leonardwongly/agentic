import { mkdtemp } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  GoalTemplateSchema,
  SYSTEM_USER_ID,
  WatcherSchema,
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

  async function createGoalForUser(request: string) {
    const repository = createRepository({
      storePath: process.env.AGENTIC_RUNTIME_STORE_PATH
    });

    await repository.seedDefaults(SYSTEM_USER_ID);

    const bundle = await processUserRequest({
      userId: SYSTEM_USER_ID,
      request,
      memories: await repository.listMemory(SYSTEM_USER_ID),
      integrations: await repository.listIntegrations(SYSTEM_USER_ID)
    });

    await repository.saveGoalBundle(bundle);
    return { repository, bundle };
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
      };
    };

    expect(response.status).toBe(200);
    expect(payload.simulated).toBe(true);
    expect(payload.event.status).toBe("simulated");
    expect(payload.event.actorContext).toEqual(createSystemActorContext(SYSTEM_USER_ID));
    await expect(repository.listGoals(SYSTEM_USER_ID)).resolves.toHaveLength(1);
    await expect(repository.listAutopilotEvents(SYSTEM_USER_ID)).resolves.toHaveLength(0);
  });

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
});
