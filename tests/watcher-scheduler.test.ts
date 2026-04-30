import { mkdtemp } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { SYSTEM_USER_ID, WatcherSchema, createSystemActorContext, nowIso } from "@agentic/contracts";
import { processUserRequest } from "@agentic/orchestrator";
import { createRepository } from "@agentic/repository";
import { runWatcherSchedulerOnce } from "@agentic/worker-runtime";
import { vi } from "vitest";

async function createSchedulerFixture() {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "agentic-watcher-scheduler-"));
  const repository = createRepository({
    storePath: path.join(tempDir, "runtime-store.json")
  });
  await repository.seedDefaults(SYSTEM_USER_ID);
  const bundle = await processUserRequest({
    userId: SYSTEM_USER_ID,
    request: "Watch for VIP client replies and prepare safe follow-up drafts.",
    memories: await repository.listMemory(SYSTEM_USER_ID),
    integrations: await repository.listIntegrations(SYSTEM_USER_ID)
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
    actorContext: createSystemActorContext(SYSTEM_USER_ID),
    createdAt: timestamp,
    updatedAt: timestamp,
    ...overrides
  });
}

describe("watcher scheduler", () => {
  it("records dry-run evaluations without claiming autopilot events", async () => {
    const { repository, bundle } = await createSchedulerFixture();
    const watcher = await repository.saveWatcher(buildWatcher(bundle.goal.id));
    const claimSpy = vi.spyOn(repository, "claimAutopilotEvent");

    const result = await runWatcherSchedulerOnce({
      repository,
      runnerId: "scheduler-1",
      userId: SYSTEM_USER_ID,
      now: "2026-04-20T00:00:00.000Z",
      evaluator: async () => ({
        wouldTrigger: true,
        reason: "VIP thread would trigger.",
        cursor: "gmail-cursor-1"
      })
    });

    const persisted = (await repository.listWatchers({ userId: SYSTEM_USER_ID })).find((candidate) => candidate.id === watcher.id);

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
      userId: SYSTEM_USER_ID,
      now: "2026-04-20T00:00:00.000Z",
      evaluator: async () => ({
        wouldTrigger: true,
        reason: "VIP thread triggered.",
        cursor: "gmail-cursor-2"
      })
    });

    const events = await repository.listAutopilotEvents(SYSTEM_USER_ID);

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
      userId: SYSTEM_USER_ID,
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
      userId: SYSTEM_USER_ID,
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
    expect(await repository.listAutopilotEvents(SYSTEM_USER_ID)).toHaveLength(0);
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
      userId: SYSTEM_USER_ID,
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
      userId: SYSTEM_USER_ID,
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
      userId: SYSTEM_USER_ID,
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
      userId: SYSTEM_USER_ID,
      now: "2026-04-20T00:00:00.000Z",
      evaluator: async () => {
        throw new Error("Evaluator unavailable.");
      }
    });
    const [updatedWatcher] = await repository.listWatchers({ userId: SYSTEM_USER_ID });

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
      userId: SYSTEM_USER_ID,
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
      userId: SYSTEM_USER_ID,
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
    expect(await repository.listAutopilotEvents(SYSTEM_USER_ID)).toHaveLength(2);
  });
});
