import {
  WatcherDryRunResultSchema,
  WatcherSchema,
  nowIso,
  type AutopilotMode,
  type Watcher
} from "@agentic/contracts";
import type { AgenticRepository } from "@agentic/repository";

export type WatcherSchedulerDecision = {
  watcherId: string;
  action: "skipped" | "dry_run_recorded" | "trigger_claimed" | "trigger_suppressed";
  reason: string;
  idempotencyKey: string | null;
};

export type WatcherSchedulerResult = {
  evaluatedAt: string;
  runnerId: string;
  decisions: WatcherSchedulerDecision[];
};

export type WatcherSignalEvaluator = (watcher: Watcher) => Promise<{
  wouldTrigger: boolean;
  reason: string;
  cursor?: string | null;
}>;

const watcherFrequencyIntervalsMs: Record<Watcher["frequency"], number> = {
  realtime: 30_000,
  "5min": 5 * 60_000,
  "15min": 15 * 60_000,
  hourly: 60 * 60_000,
  daily: 24 * 60 * 60_000
};

function parseTime(value: string | null | undefined): number | null {
  if (!value) {
    return null;
  }

  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function computeNextRunAt(watcher: Watcher, evaluatedAt: string): string {
  return new Date(Date.parse(evaluatedAt) + watcherFrequencyIntervalsMs[watcher.frequency]).toISOString();
}

function isLeaseHeldByAnotherRunner(watcher: Watcher, runnerId: string, evaluatedAt: string): boolean {
  const lease = watcher.schedule.lease;
  const leaseExpiresAt = parseTime(lease?.expiresAt);

  return Boolean(lease && lease.ownerId !== runnerId && leaseExpiresAt !== null && leaseExpiresAt > Date.parse(evaluatedAt));
}

function isWatcherDue(watcher: Watcher, evaluatedAt: string): boolean {
  const nextRunAt = parseTime(watcher.schedule.nextRunAt);

  return nextRunAt === null || nextRunAt <= Date.parse(evaluatedAt);
}

function buildWatcherIdempotencyKey(watcher: Watcher, evaluatedAt: string): string {
  return `watcher:${watcher.id}:${new Date(Date.parse(evaluatedAt)).toISOString()}`;
}

function buildSuppressedDecision(watcherId: string, reason: string): WatcherSchedulerDecision {
  return {
    watcherId,
    action: "skipped",
    reason,
    idempotencyKey: null
  };
}

async function defaultEvaluateWatcher(watcher: Watcher) {
  return {
    wouldTrigger: false,
    reason: `Watcher evaluation skipped for ${watcher.targetEntity} because no evaluator was provided.`,
    cursor: watcher.schedule.cursor
  };
}

export async function runWatcherSchedulerOnce(params: {
  repository: AgenticRepository;
  runnerId: string;
  userId?: string;
  now?: string;
  leaseMs?: number;
  mode?: AutopilotMode;
  evaluator?: WatcherSignalEvaluator;
}): Promise<WatcherSchedulerResult> {
  const evaluatedAt = params.now ?? nowIso();
  const leaseMs = params.leaseMs ?? 60_000;
  const evaluator = params.evaluator ?? defaultEvaluateWatcher;
  const watchers = await params.repository.listWatchers({ userId: params.userId });
  const decisions: WatcherSchedulerDecision[] = [];

  for (const watcher of watchers) {
    if (watcher.status !== "active") {
      decisions.push(buildSuppressedDecision(watcher.id, `Watcher ${watcher.id} is ${watcher.status}.`));
      continue;
    }

    if (!watcher.schedule.enabled) {
      decisions.push(buildSuppressedDecision(watcher.id, `Watcher ${watcher.id} scheduling is disabled.`));
      continue;
    }

    const expiryAt = parseTime(watcher.expiryAt);

    if (expiryAt !== null && expiryAt <= Date.parse(evaluatedAt)) {
      decisions.push(buildSuppressedDecision(watcher.id, `Watcher ${watcher.id} has expired.`));
      continue;
    }

    if (isLeaseHeldByAnotherRunner(watcher, params.runnerId, evaluatedAt)) {
      decisions.push(buildSuppressedDecision(watcher.id, `Watcher ${watcher.id} is leased by ${watcher.schedule.lease?.ownerId}.`));
      continue;
    }

    if (!isWatcherDue(watcher, evaluatedAt)) {
      decisions.push(buildSuppressedDecision(watcher.id, `Watcher ${watcher.id} is not due yet.`));
      continue;
    }

    const leaseExpiresAt = new Date(Date.parse(evaluatedAt) + leaseMs).toISOString();
    const leasedWatcher = await params.repository.claimWatcherLease({
      watcherId: watcher.id,
      userId: params.userId,
      runnerId: params.runnerId,
      acquiredAt: evaluatedAt,
      expiresAt: leaseExpiresAt
    });

    if (!leasedWatcher) {
      decisions.push(buildSuppressedDecision(watcher.id, `Watcher ${watcher.id} lease was claimed by another runner.`));
      continue;
    }

    const evaluation = await evaluator(leasedWatcher);
    const idempotencyKey = buildWatcherIdempotencyKey(leasedWatcher, evaluatedAt);
    const lastEvaluation = WatcherDryRunResultSchema.parse({
      evaluatedAt,
      wouldTrigger: evaluation.wouldTrigger,
      reason: evaluation.reason,
      idempotencyKey,
      sideEffectsSuppressed: leasedWatcher.schedule.dryRun
    });

    if (leasedWatcher.schedule.dryRun || !evaluation.wouldTrigger) {
      await params.repository.saveWatcher(
        WatcherSchema.parse({
          ...leasedWatcher,
          schedule: {
            ...leasedWatcher.schedule,
            cursor: evaluation.cursor ?? leasedWatcher.schedule.cursor,
            lastRunAt: evaluatedAt,
            nextRunAt: computeNextRunAt(leasedWatcher, evaluatedAt),
            lease: null
          },
          lastEvaluation,
          updatedAt: evaluatedAt
        })
      );
      decisions.push({
        watcherId: watcher.id,
        action: leasedWatcher.schedule.dryRun ? "dry_run_recorded" : "skipped",
        reason: evaluation.reason,
        idempotencyKey
      });
      continue;
    }

    const claim = await params.repository.claimAutopilotEvent({
      userId: params.userId,
      kind: "watcher_triggered",
      sourceId: watcher.id,
      idempotencyKey,
      mode: params.mode ?? "draft_goal",
      summary: `Watcher triggered: ${watcher.targetEntity}`,
      details: {
        condition: watcher.condition,
        triggerAction: watcher.triggerAction,
        schedulerRunnerId: params.runnerId,
        budget: {
          key: `watcher:${watcher.id}:hourly`,
          windowMinutes: 60,
          maxEvents: watcher.escalationPolicy.maxTriggersPerHour,
          scope: "source"
        }
      },
      actorContext: watcher.actorContext,
      debounceMinutes: Math.ceil(watcher.escalationPolicy.minSuppressionMs / 60_000)
    });

    await params.repository.saveWatcher(
      WatcherSchema.parse({
        ...leasedWatcher,
        schedule: {
          ...leasedWatcher.schedule,
          cursor: evaluation.cursor ?? leasedWatcher.schedule.cursor,
          lastRunAt: evaluatedAt,
          nextRunAt: computeNextRunAt(leasedWatcher, evaluatedAt),
          lease: null
        },
        lastEvaluation,
        updatedAt: evaluatedAt
      })
    );

    decisions.push({
      watcherId: watcher.id,
      action: claim.outcome === "claimed" ? "trigger_claimed" : "trigger_suppressed",
      reason:
        claim.event.details.suppression?.reason ??
        (claim.event.details.reason && typeof claim.event.details.reason === "string" ? claim.event.details.reason : evaluation.reason),
      idempotencyKey
    });
  }

  return {
    evaluatedAt,
    runnerId: params.runnerId,
    decisions
  };
}
