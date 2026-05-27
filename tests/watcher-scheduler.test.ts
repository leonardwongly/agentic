import { mkdtemp } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { DEFAULT_OWNER_USER_ID, WatcherSchema, createSystemActorContext, nowIso } from "@agentic/contracts";
import { processUserRequest } from "@agentic/orchestrator";
import { createRepository } from "@agentic/repository";
import { runWatcherSchedulerLoop, runWatcherSchedulerOnce } from "@agentic/worker-runtime";
import { vi } from "vitest";

async function createSchedulerFixture() {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "agentic-watcher-scheduler-"));
  const repository = createRepository({
    storePath: path.join(tempDir, "runtime-store.json")
  });
  await repository.seedDefaults(DEFAULT_OWNER_USER_ID);
  const bundle = await processUserRequest({
    userId: DEFAULT_OWNER_USER_ID,
    request: "Watch for VIP client replies and prepare safe follow-up drafts.",
    memories: await repository.listMemory(DEFAULT_OWNER_USER_ID),
    integrations: await repository.listIntegrations(DEFAULT_OWNER_USER_ID)
  });
  await repository.saveGoalBundle(bundle);

  return {
    repository,
    bundle
  };
}

function buildWatcher(goalId: string, overrides: Partial<ReturnType<typeof WatcherSchema.parse>> = {}) {
  const timestamp = nowIso();

  return WatcherSchema.parse({
    id: "watcher-scheduler-1",
    goalId,
    targetEntity: "VIP inbox",
    condition: "A priority sender replies.",
    frequency: "5min",
    triggerAction: "Draft an operator-safe escalation.",
    sourceSystems: ["gmail"],
    status: "active",
    expiryAt: null,
    actorContext: createSystemActorContext(DEFAULT_OWNER_USER_ID),
    createdAt: timestamp,
    updatedAt: timestamp,
    ...overrides
  });
}

describe("watcher scheduler", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("records dry-run evaluations without claiming autopilot events", async () => {
    const { repository, bundle } = await createSchedulerFixture();
    const watcher = await repository.saveWatcher(buildWatcher(bundle.goal.id));
    const claimSpy = vi.spyOn(repository, "claimAutopilotEvent");

    const result = await runWatcherSchedulerOnce({
      repository,
      runnerId: "scheduler-1",
      userId: DEFAULT_OWNER_USER_ID,
      now: "2026-04-20T00:00:00.000Z",
      evaluator: async () => ({
        wouldTrigger: true,
        reason: "VIP thread would trigger.",
        cursor: "gmail-cursor-1"
      })
    });

    const persisted = (await repository.listWatchers({ userId: DEFAULT_OWNER_USER_ID })).find((candidate) => candidate.id === watcher.id);

    expect(result.decisions).toEqual([
      {
        watcherId: watcher.id,
        action: "dry_run_recorded",
        reason: "VIP thread would trigger.",
        idempotencyKey: "watcher:watcher-scheduler-1:2026-04-20T00:00:00.000Z"
      }
    ]);
    expect(claimSpy).not.toHaveBeenCalled();
    expect(persisted?.schedule).toMatchObject({
      dryRun: true,
      cursor: "gmail-cursor-1",
      lastRunAt: "2026-04-20T00:00:00.000Z",
      nextRunAt: "2026-04-20T00:05:00.000Z",
      lease: null
    });
    expect(persisted?.lastEvaluation).toMatchObject({
      wouldTrigger: true,
      sideEffectsSuppressed: true
    });
  });

  it("allows evaluators to clear stored watcher cursors", async () => {
    const { repository, bundle } = await createSchedulerFixture();
    const watcher = await repository.saveWatcher(
      buildWatcher(bundle.goal.id, {
        schedule: {
          enabled: true,
          dryRun: true,
          cursor: "stale-cursor",
          lastRunAt: null,
          nextRunAt: null,
          lease: null
        }
      })
    );

    await runWatcherSchedulerOnce({
      repository,
      runnerId: "scheduler-1",
      userId: DEFAULT_OWNER_USER_ID,
      now: "2026-04-20T00:00:00.000Z",
      evaluator: async () => ({
        wouldTrigger: false,
        reason: "Reset watcher cursor.",
        cursor: null
      })
    });
    const persisted = (await repository.listWatchers({ userId: DEFAULT_OWNER_USER_ID })).find((candidate) => candidate.id === watcher.id);

    expect(persisted?.schedule.cursor).toBeNull();
  });

  it("renews watcher leases during long evaluations", async () => {
    const { repository, bundle } = await createSchedulerFixture();
    await repository.saveWatcher(buildWatcher(bundle.goal.id));
    const claimSpy = vi.spyOn(repository, "claimWatcherLease");

    await runWatcherSchedulerOnce({
      repository,
      runnerId: "scheduler-1",
      userId: DEFAULT_OWNER_USER_ID,
      now: "2026-04-20T00:00:00.000Z",
      leaseMs: 10,
      evaluator: async () => {
        await new Promise((resolve) => setTimeout(resolve, 30));
        return {
          wouldTrigger: false,
          reason: "Slow but bounded evaluation."
        };
      }
    });

    expect(claimSpy.mock.calls.length).toBeGreaterThan(1);
  });

  it("runs the scheduler loop without overlapping evaluations", async () => {
    const { repository, bundle } = await createSchedulerFixture();
    await repository.saveWatcher(buildWatcher(bundle.goal.id));
    const controller = new AbortController();
    let activeEvaluations = 0;
    let maxActiveEvaluations = 0;
    let runStarts = 0;

    const loop = runWatcherSchedulerLoop({
      repository,
      runnerId: "scheduler-loop-1",
      userId: DEFAULT_OWNER_USER_ID,
      intervalMs: 1,
      timeoutMs: 1_000,
      signal: controller.signal,
      onRunStart: () => {
        runStarts += 1;
      },
      onRunComplete: () => {
        controller.abort();
      },
      evaluator: async () => {
        activeEvaluations += 1;
        maxActiveEvaluations = Math.max(maxActiveEvaluations, activeEvaluations);
        await new Promise((resolve) => setTimeout(resolve, 50));
        activeEvaluations -= 1;

        return {
          wouldTrigger: false,
          reason: "Loop evaluation completed."
        };
      }
    });

    await loop;

    expect(runStarts).toBe(1);
    expect(maxActiveEvaluations).toBe(1);
  });

  it("contains lease renewal failures and reports a watcher decision", async () => {
    const { repository, bundle } = await createSchedulerFixture();
    const watcher = await repository.saveWatcher(buildWatcher(bundle.goal.id));
    const originalClaimWatcherLease = repository.claimWatcherLease.bind(repository);
    let claimCount = 0;

    vi.spyOn(repository, "claimWatcherLease").mockImplementation(async (params) => {
      claimCount += 1;
      if (claimCount > 1) {
        throw new Error("transient lease store failure");
      }
      return originalClaimWatcherLease(params);
    });

    const result = await runWatcherSchedulerOnce({
      repository,
      runnerId: "scheduler-1",
      userId: DEFAULT_OWNER_USER_ID,
      now: "2026-04-20T00:00:00.000Z",
      leaseMs: 10,
      evaluator: async () => {
        await new Promise((resolve) => setTimeout(resolve, 30));
        return {
          wouldTrigger: false,
          reason: "Slow evaluation after renewal failure."
        };
      }
    });
    const persisted = (await repository.listWatchers({ userId: DEFAULT_OWNER_USER_ID })).find((candidate) => candidate.id === watcher.id);

    expect(result.decisions).toEqual([
      {
        watcherId: watcher.id,
        action: "skipped",
        reason: "transient lease store failure",
        idempotencyKey: null
      }
    ]);
    expect(persisted?.schedule.lease).toBeNull();
  });

  it("claims a trigger once when dry-run is disabled", async () => {
    const { repository, bundle } = await createSchedulerFixture();
    const watcher = await repository.saveWatcher(
      buildWatcher(bundle.goal.id, {
        schedule: {
          enabled: true,
          dryRun: false,
          cursor: null,
          lastRunAt: null,
          nextRunAt: null,
          lease: null
        }
      })
    );

    const result = await runWatcherSchedulerOnce({
      repository,
      runnerId: "scheduler-1",
      userId: DEFAULT_OWNER_USER_ID,
      now: "2026-04-20T00:00:00.000Z",
      evaluator: async () => ({
        wouldTrigger: true,
        reason: "VIP thread triggered.",
        cursor: "gmail-cursor-2"
      })
    });

    const events = await repository.listAutopilotEvents(DEFAULT_OWNER_USER_ID);

    expect(result.decisions[0]).toMatchObject({
      watcherId: watcher.id,
      action: "trigger_claimed"
    });
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      kind: "watcher_triggered",
      sourceId: watcher.id,
      status: "pending",
      details: {
        budget: {
          key: `watcher:${watcher.id}:hourly`,
          windowMinutes: 60,
          maxEvents: 4,
          scope: "source"
        }
      }
    });
  });

  it("persists watcher progress without emitting triggers when notifications are disabled", async () => {
    const { repository, bundle } = await createSchedulerFixture();
    const watcher = await repository.saveWatcher(
      buildWatcher(bundle.goal.id, {
        schedule: {
          enabled: true,
          dryRun: false,
          cursor: null,
          lastRunAt: null,
          nextRunAt: null,
          lease: null
        },
        escalationPolicy: {
          notify: false,
          minSuppressionMs: 0,
          maxTriggersPerHour: 4
        }
      })
    );
    const claimSpy = vi.spyOn(repository, "claimAutopilotEvent");

    const result = await runWatcherSchedulerOnce({
      repository,
      runnerId: "scheduler-1",
      userId: DEFAULT_OWNER_USER_ID,
      now: "2026-04-20T00:00:00.000Z",
      evaluator: async () => ({
        wouldTrigger: true,
        reason: "VIP thread triggered.",
        cursor: "gmail-cursor-2"
      })
    });
    const persisted = (await repository.listWatchers({ userId: DEFAULT_OWNER_USER_ID })).find((candidate) => candidate.id === watcher.id);

    expect(result.decisions).toEqual([
      {
        watcherId: watcher.id,
        action: "skipped",
        reason: "Watcher notification policy disabled trigger emission.",
        idempotencyKey: "watcher:watcher-scheduler-1:2026-04-20T00:00:00.000Z"
      }
    ]);
    expect(claimSpy).not.toHaveBeenCalled();
    expect(await repository.listAutopilotEvents(DEFAULT_OWNER_USER_ID)).toHaveLength(0);
    expect(persisted?.schedule.cursor).toBe("gmail-cursor-2");
    expect(persisted?.lastEvaluation?.sideEffectsSuppressed).toBe(true);
  });

  it("suppresses duplicate scheduler instances while a lease is active", async () => {
    const { repository, bundle } = await createSchedulerFixture();
    const watcher = await repository.saveWatcher(
      buildWatcher(bundle.goal.id, {
        schedule: {
          enabled: true,
          dryRun: true,
          cursor: null,
          lastRunAt: null,
          nextRunAt: null,
          lease: {
            ownerId: "scheduler-1",
            acquiredAt: "2026-04-20T00:00:00.000Z",
            expiresAt: "2026-04-20T00:02:00.000Z"
          }
        }
      })
    );

    const result = await runWatcherSchedulerOnce({
      repository,
      runnerId: "scheduler-2",
      userId: DEFAULT_OWNER_USER_ID,
      now: "2026-04-20T00:01:00.000Z"
    });

    expect(result.decisions).toEqual([
      {
        watcherId: watcher.id,
        action: "skipped",
        reason: "Watcher watcher-scheduler-1 is leased by scheduler-1.",
        idempotencyKey: null
      }
    ]);
  });

  it("does not trigger by default when no evaluator is wired", async () => {
    const { repository, bundle } = await createSchedulerFixture();
    const watcher = await repository.saveWatcher(
      buildWatcher(bundle.goal.id, {
        schedule: {
          enabled: true,
          dryRun: false,
          cursor: null,
          lastRunAt: null,
          nextRunAt: null,
          lease: null
        }
      })
    );

    const result = await runWatcherSchedulerOnce({
      repository,
      runnerId: "scheduler-1",
      userId: DEFAULT_OWNER_USER_ID,
      now: "2026-04-20T00:00:30.123Z"
    });

    expect(result.decisions).toEqual([
      {
        watcherId: watcher.id,
        action: "skipped",
        reason: "Watcher evaluation skipped for VIP inbox because no evaluator was provided.",
        idempotencyKey: "watcher:watcher-scheduler-1:2026-04-20T00:00:30.123Z"
      }
    ]);
    expect(await repository.listAutopilotEvents(DEFAULT_OWNER_USER_ID)).toHaveLength(0);
  });

  it("uses sub-minute idempotency keys for realtime watcher evaluations", async () => {
    const { repository, bundle } = await createSchedulerFixture();
    const watcher = await repository.saveWatcher(
      buildWatcher(bundle.goal.id, {
        frequency: "realtime",
        schedule: {
          enabled: true,
          dryRun: false,
          cursor: null,
          lastRunAt: null,
          nextRunAt: null,
          lease: null
        },
        escalationPolicy: {
          notify: true,
          minSuppressionMs: 0,
          maxTriggersPerHour: 60
        }
      })
    );

    const first = await runWatcherSchedulerOnce({
      repository,
      runnerId: "scheduler-1",
      userId: DEFAULT_OWNER_USER_ID,
      now: "2026-04-20T00:00:00.000Z",
      evaluator: async () => ({
        wouldTrigger: true,
        reason: "VIP thread triggered.",
        cursor: "gmail-cursor-1"
      })
    });
    const second = await runWatcherSchedulerOnce({
      repository,
      runnerId: "scheduler-1",
      userId: DEFAULT_OWNER_USER_ID,
      now: "2026-04-20T00:00:30.000Z",
      evaluator: async () => ({
        wouldTrigger: true,
        reason: "VIP thread triggered again.",
        cursor: "gmail-cursor-2"
      })
    });

    expect(first.decisions[0]?.idempotencyKey).toBe("watcher:watcher-scheduler-1:2026-04-20T00:00:00.000Z");
    expect(second.decisions[0]?.idempotencyKey).toBe("watcher:watcher-scheduler-1:2026-04-20T00:00:30.000Z");
    expect(watcher.frequency).toBe("realtime");
  });

  it("suppresses evaluation when another runner wins the atomic lease claim", async () => {
    const { repository, bundle } = await createSchedulerFixture();
    const watcher = await repository.saveWatcher(buildWatcher(bundle.goal.id));
    const claimSpy = vi.spyOn(repository, "claimWatcherLease").mockResolvedValueOnce(null);
    const evaluator = vi.fn();

    const result = await runWatcherSchedulerOnce({
      repository,
      runnerId: "scheduler-2",
      userId: DEFAULT_OWNER_USER_ID,
      now: "2026-04-20T00:00:00.000Z",
      evaluator
    });

    expect(result.decisions).toEqual([
      {
        watcherId: watcher.id,
        action: "skipped",
        reason: "Watcher watcher-scheduler-1 lease was claimed by another runner.",
        idempotencyKey: null
      }
    ]);
    expect(claimSpy).toHaveBeenCalledTimes(1);
    expect(evaluator).not.toHaveBeenCalled();
  });

  it("releases the watcher lease and continues when evaluation fails", async () => {
    const { repository, bundle } = await createSchedulerFixture();
    const watcher = await repository.saveWatcher(buildWatcher(bundle.goal.id));

    const result = await runWatcherSchedulerOnce({
      repository,
      runnerId: "scheduler-1",
      userId: DEFAULT_OWNER_USER_ID,
      now: "2026-04-20T00:00:00.000Z",
      evaluator: async () => {
        throw new Error("Evaluator unavailable.");
      }
    });
    const [updatedWatcher] = await repository.listWatchers({ userId: DEFAULT_OWNER_USER_ID });

    expect(result.decisions).toEqual([
      {
        watcherId: watcher.id,
        action: "skipped",
        reason: "Evaluator unavailable.",
        idempotencyKey: null
      }
    ]);
    expect(updatedWatcher?.schedule.lease).toBeNull();
  });

  it("releases the watcher lease and continues when autopilot event claiming fails", async () => {
    const { repository, bundle } = await createSchedulerFixture();
    const firstWatcher = await repository.saveWatcher(
      buildWatcher(bundle.goal.id, {
        id: "watcher-scheduler-claim-fails",
        createdAt: "2026-04-20T00:00:02.000Z",
        updatedAt: "2026-04-20T00:00:02.000Z",
        schedule: {
          enabled: true,
          dryRun: false,
          cursor: null,
          lastRunAt: null,
          nextRunAt: null,
          lease: null
        }
      })
    );
    const secondWatcher = await repository.saveWatcher(
      buildWatcher(bundle.goal.id, {
        id: "watcher-scheduler-continues-after-claim",
        createdAt: "2026-04-20T00:00:01.000Z",
        updatedAt: "2026-04-20T00:00:01.000Z"
      })
    );
    vi.spyOn(repository, "claimAutopilotEvent").mockRejectedValueOnce(new Error("Autopilot store unavailable."));

    const result = await runWatcherSchedulerOnce({
      repository,
      runnerId: "scheduler-1",
      userId: DEFAULT_OWNER_USER_ID,
      now: "2026-04-20T00:00:00.000Z",
      evaluator: async () => ({
        wouldTrigger: true,
        reason: "VIP thread triggered.",
        cursor: "gmail-cursor-1"
      })
    });
    const persisted = await repository.listWatchers({ userId: DEFAULT_OWNER_USER_ID });

    expect(result.decisions).toEqual([
      {
        watcherId: firstWatcher.id,
        action: "skipped",
        reason: "Autopilot store unavailable.",
        idempotencyKey: "watcher:watcher-scheduler-claim-fails:2026-04-20T00:00:00.000Z"
      },
      {
        watcherId: secondWatcher.id,
        action: "dry_run_recorded",
        reason: "VIP thread triggered.",
        idempotencyKey: "watcher:watcher-scheduler-continues-after-claim:2026-04-20T00:00:00.000Z"
      }
    ]);
    expect(persisted.find((candidate) => candidate.id === firstWatcher.id)?.schedule).toMatchObject({
      lease: null,
      lastRunAt: null,
      nextRunAt: null,
      cursor: null
    });
    expect(persisted.find((candidate) => candidate.id === secondWatcher.id)?.schedule.lease).toBeNull();
  });

  it("releases the watcher lease and continues when watcher persistence fails after a claim", async () => {
    const { repository, bundle } = await createSchedulerFixture();
    const firstWatcher = await repository.saveWatcher(
      buildWatcher(bundle.goal.id, {
        id: "watcher-scheduler-save-fails",
        createdAt: "2026-04-20T00:00:02.000Z",
        updatedAt: "2026-04-20T00:00:02.000Z",
        schedule: {
          enabled: true,
          dryRun: false,
          cursor: null,
          lastRunAt: null,
          nextRunAt: null,
          lease: null
        }
      })
    );
    const secondWatcher = await repository.saveWatcher(
      buildWatcher(bundle.goal.id, {
        id: "watcher-scheduler-continues-after-save",
        createdAt: "2026-04-20T00:00:01.000Z",
        updatedAt: "2026-04-20T00:00:01.000Z"
      })
    );
    const saveWatcher = repository.saveWatcher.bind(repository);
    const saveSpy = vi.spyOn(repository, "saveWatcher").mockImplementation((watcher) => saveWatcher(watcher));
    saveSpy.mockImplementationOnce(async () => {
      throw new Error("Watcher store write failed.");
    });

    const result = await runWatcherSchedulerOnce({
      repository,
      runnerId: "scheduler-1",
      userId: DEFAULT_OWNER_USER_ID,
      now: "2026-04-20T00:00:00.000Z",
      evaluator: async () => ({
        wouldTrigger: true,
        reason: "VIP thread triggered.",
        cursor: "gmail-cursor-1"
      })
    });
    const persisted = await repository.listWatchers({ userId: DEFAULT_OWNER_USER_ID });

    expect(result.decisions).toEqual([
      {
        watcherId: firstWatcher.id,
        action: "skipped",
        reason: "Watcher store write failed.",
        idempotencyKey: "watcher:watcher-scheduler-save-fails:2026-04-20T00:00:00.000Z"
      },
      {
        watcherId: secondWatcher.id,
        action: "dry_run_recorded",
        reason: "VIP thread triggered.",
        idempotencyKey: "watcher:watcher-scheduler-continues-after-save:2026-04-20T00:00:00.000Z"
      }
    ]);
    expect(persisted.find((candidate) => candidate.id === firstWatcher.id)?.schedule).toMatchObject({
      lease: null,
      cursor: "gmail-cursor-1",
      lastRunAt: "2026-04-20T00:00:00.000Z",
      nextRunAt: "2026-04-20T00:05:00.000Z"
    });
    expect(persisted.find((candidate) => candidate.id === firstWatcher.id)?.lastEvaluation).toMatchObject({
      wouldTrigger: true,
      reason: "VIP thread triggered.",
      idempotencyKey: "watcher:watcher-scheduler-save-fails:2026-04-20T00:00:00.000Z"
    });
    expect(persisted.find((candidate) => candidate.id === secondWatcher.id)?.schedule.lease).toBeNull();
  });

  it("passes watcher hourly trigger caps into autopilot event budgets", async () => {
    const { repository, bundle } = await createSchedulerFixture();
    const watcher = await repository.saveWatcher(
      buildWatcher(bundle.goal.id, {
        schedule: {
          enabled: true,
          dryRun: false,
          cursor: null,
          lastRunAt: null,
          nextRunAt: null,
          lease: null
        },
        escalationPolicy: {
          notify: true,
          minSuppressionMs: 0,
          maxTriggersPerHour: 1
        }
      })
    );

    await runWatcherSchedulerOnce({
      repository,
      runnerId: "scheduler-1",
      userId: DEFAULT_OWNER_USER_ID,
      now: "2026-04-20T00:00:00.000Z",
      evaluator: async () => ({
        wouldTrigger: true,
        reason: "VIP thread triggered.",
        cursor: "gmail-cursor-1"
      })
    });
    const second = await runWatcherSchedulerOnce({
      repository,
      runnerId: "scheduler-1",
      userId: DEFAULT_OWNER_USER_ID,
      now: "2026-04-20T00:05:00.000Z",
      evaluator: async () => ({
        wouldTrigger: true,
        reason: "VIP thread triggered again.",
        cursor: "gmail-cursor-2"
      })
    });

    expect(second.decisions[0]).toMatchObject({
      watcherId: watcher.id,
      action: "trigger_suppressed",
      reason: "Budget watcher:watcher-scheduler-1:hourly exhausted in the active window."
    });
    expect(await repository.listAutopilotEvents(DEFAULT_OWNER_USER_ID)).toHaveLength(2);
  });
});
