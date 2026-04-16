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
import { vi } from "vitest";
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

  it("executes watcher-triggered events and prevents duplicate idempotency claims", async () => {
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
        details: {
          taskCount: number;
          pendingApprovalCount: number;
          artifactCount: number;
          actionLogCount: number;
          requiresReview: boolean;
          recoveryAction: string;
          processingLatencyMs: number;
        };
      };
      bundle: {
        tasks: Array<{ id: string }>;
        approvals: Array<{ decision: string }>;
        artifacts: Array<{ id: string }>;
        actionLogs: Array<{ id: string }>;
      };
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
    };
    const persistedEvents = await repository.listAutopilotEvents(SYSTEM_USER_ID);

    expect(firstResponse.status).toBe(200);
    expect(firstPayload.event.status).toBe("executed");
    expect(firstPayload.event.resultGoalId).toBeTruthy();
    expect(firstPayload.event.actorContext).toEqual(createSystemActorContext(SYSTEM_USER_ID));
    expect(firstPayload.event.details.taskCount).toBe(firstPayload.bundle.tasks.length);
    expect(firstPayload.event.details.pendingApprovalCount).toBe(
      firstPayload.bundle.approvals.filter((approval) => approval.decision === "pending").length
    );
    expect(firstPayload.event.details.artifactCount).toBe(firstPayload.bundle.artifacts.length);
    expect(firstPayload.event.details.actionLogCount).toBe(firstPayload.bundle.actionLogs.length);
    expect(firstPayload.event.details.requiresReview).toBe(
      firstPayload.event.details.pendingApprovalCount > 0
    );
    expect(firstPayload.event.details.recoveryAction).toBe(
      firstPayload.event.details.pendingApprovalCount > 0 ? "review_approvals" : "none"
    );
    expect(firstPayload.event.details.processingLatencyMs).toBeGreaterThanOrEqual(0);
    expect(secondResponse.status).toBe(200);
    expect(secondPayload.duplicate).toBe(true);
    expect(secondPayload.event.id).toBe(firstPayload.event.id);
    expect(secondPayload.event.actorContext).toEqual(createSystemActorContext(SYSTEM_USER_ID));
    await expect(repository.listGoals(SYSTEM_USER_ID)).resolves.toHaveLength(2);
    expect(persistedEvents).toHaveLength(1);
    expect(persistedEvents[0]?.actorContext).toEqual(createSystemActorContext(SYSTEM_USER_ID));
  });

  it("captures recovery context when watcher-triggered execution fails after claiming the event", async () => {
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
    repository.saveGoalBundle = async () => {
      throw new Error("Synthetic autopilot execution failure");
    };
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
      error: string;
      event: {
        status: string;
        error: string | null;
        actorContext: unknown;
        details: {
          failureStage: string;
          requiresReview: boolean;
          recoveryAction: string;
          processingLatencyMs: number;
        };
      };
      dashboard: {
        autopilotEvents: Array<{ status: string }>;
      };
    };
    const autopilotEvents = await repository.listAutopilotEvents(SYSTEM_USER_ID);

    repository.saveGoalBundle = originalSaveGoalBundle;

    expect(response.status).toBe(500);
    expect(payload.error).toBe("Autopilot execution failed.");
    expect(payload.event.status).toBe("failed");
    expect(payload.event.error).toBe("Autopilot execution failed.");
    expect(payload.event.actorContext).toEqual(createSystemActorContext(SYSTEM_USER_ID));
    expect(payload.event.details.failureStage).toBe("execution");
    expect(payload.event.details.requiresReview).toBe(true);
    expect(payload.event.details.recoveryAction).toBe("review_event_error");
    expect(payload.event.details.processingLatencyMs).toBeGreaterThanOrEqual(0);
    expect(payload.dashboard.autopilotEvents.some((event) => event.status === "failed")).toBe(true);
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
    const persistedEvents = await repository.listAutopilotEvents(SYSTEM_USER_ID);

    expect(firstResponse.status).toBe(200);
    expect(secondResponse.status).toBe(200);
    expect(secondPayload.debounced).toBe(true);
    expect(secondPayload.event.status).toBe("debounced");
    expect(secondPayload.event.actorContext).toEqual(createSystemActorContext(SYSTEM_USER_ID));
    await expect(repository.listGoals(SYSTEM_USER_ID)).resolves.toHaveLength(2);
    expect(persistedEvents).toHaveLength(2);
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
    let payload: { event: { actorContext: unknown; resultGoalId: string | null } };
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
      payload = (await response.json()) as { event: { actorContext: unknown; resultGoalId: string | null } };
    } finally {
      requireApiSessionSpy.mockRestore();
    }

    const events = await repository.listAutopilotEvents(secondaryUserId);
    const updatedTemplate = (await repository.listTemplates(secondaryUserId)).find(
      (template) => template.id === "template-session-run"
    );

    expect(response.status).toBe(200);
    expect(payload.event.resultGoalId).toBeTruthy();
    expect(payload.event.actorContext).toEqual(createHumanActorContext(secondaryUserId, "session-secondary"));
    expect(events).toHaveLength(1);
    expect(events[0]?.actorContext).toEqual(createHumanActorContext(secondaryUserId, "session-secondary"));
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
        status: string;
        resultGoalId: string | null;
      };
    };
    const updatedTemplate = (await repository.listTemplates(SYSTEM_USER_ID)).find(
      (template) => template.id === "template-autopilot-run"
    );

    expect(response.status).toBe(200);
    expect(payload.event.status).toBe("executed");
    expect(payload.event.resultGoalId).toBeTruthy();
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
        status: string;
        resultGoalId: string | null;
      };
      dashboard: {
        briefingHistory: Array<{ goalId: string }>;
      };
    };

    expect(response.status).toBe(200);
    expect(payload.event.status).toBe("executed");
    expect(payload.event.resultGoalId).toBeTruthy();
    expect(payload.dashboard.briefingHistory.some((entry) => entry.goalId === payload.event.resultGoalId)).toBe(true);
    await expect(repository.listGoals(SYSTEM_USER_ID)).resolves.toHaveLength(1);
  });
});
