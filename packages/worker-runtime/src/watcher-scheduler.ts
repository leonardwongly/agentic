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

type WatcherSignalEvaluation = Awaited<ReturnType<WatcherSignalEvaluator>>;

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

function getErrorMessage(error: unknown, fallback: string): string {
  return error instanceof Error ? error.message : fallback;
}

function clearWatcherLease(watcher: Watcher, evaluatedAt: string): Watcher {
  return WatcherSchema.parse({
    ...watcher,
    schedule: {
      ...watcher.schedule,
      lease: null
    },
    updatedAt: evaluatedAt
  });
}

function applyWatcherEvaluationProgress(params: {
  watcher: Watcher;
  evaluation: WatcherSignalEvaluation;
  lastEvaluation: unknown;
  evaluatedAt: string;
}): Watcher {
  return WatcherSchema.parse({
    ...params.watcher,
    schedule: {
      ...params.watcher.schedule,
      cursor: params.evaluation.cursor === undefined ? params.watcher.schedule.cursor : params.evaluation.cursor,
      lastRunAt: params.evaluatedAt,
      nextRunAt: computeNextRunAt(params.watcher, params.evaluatedAt),
      lease: null
    },
    lastEvaluation: params.lastEvaluation,
    updatedAt: params.evaluatedAt
  });
}

async function defaultEvaluateWatcher(watcher: Watcher) {
  return {
    wouldTrigger: false,
    reason: `Watcher evaluation skipped for ${watcher.targetEntity} because no evaluator was provided.`,
    cursor: watcher.schedule.cursor
  };
}

function throwIfAborted(signal: AbortSignal | undefined): void {
  if (signal?.aborted) {
    throw signal.reason instanceof Error ? signal.reason : new Error("Watcher scheduler aborted.");
  }
}

export async function runWatcherSchedulerOnce(params: {
  repository: AgenticRepository;
  runnerId: string;
  userId?: string;
  now?: string;
  leaseMs?: number;
  mode?: AutopilotMode;
  evaluator?: WatcherSignalEvaluator;
  signal?: AbortSignal;
}): Promise<WatcherSchedulerResult> {
  const evaluatedAt = params.now ?? nowIso();
  const leaseMs = params.leaseMs ?? 60_000;
  const evaluator = params.evaluator ?? defaultEvaluateWatcher;
  const watchers = await params.repository.listWatchers({ userId: params.userId });
  const decisions: WatcherSchedulerDecision[] = [];

  for (const watcher of watchers) {
    throwIfAborted(params.signal);

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

    let currentLeasedWatcher = leasedWatcher;
    let evaluation: WatcherSignalEvaluation;
    let leaseReleased = false;
    let leaseRenewalError: string | null = null;
    const renewalAttempts: Array<Promise<void>> = [];
    const releaseLease = async (replacement?: Watcher) => {
      if (leaseReleased) {
        return;
      }

      await params.repository.saveWatcher(replacement ?? clearWatcherLease(currentLeasedWatcher, evaluatedAt));
      leaseReleased = true;
    };
    const tryReleaseLease = async (replacement?: Watcher): Promise<string | null> => {
      try {
        await releaseLease(replacement);
        return null;
      } catch (error) {
        return getErrorMessage(error, "Watcher lease release failed.");
      }
    };

    const renewLease = async () => {
      const acquiredAt = nowIso();
      const renewed = await params.repository.claimWatcherLease({
        watcherId: watcher.id,
        userId: params.userId,
        runnerId: params.runnerId,
        acquiredAt,
        expiresAt: new Date(Date.parse(acquiredAt) + leaseMs).toISOString()
      });

      if (renewed) {
        currentLeasedWatcher = renewed;
      }
    };
    const renewalIntervalMs = Math.max(1, Math.floor(leaseMs / 2));
    const renewalTimer = setInterval(() => {
      const renewalAttempt = renewLease().catch((error) => {
        leaseRenewalError ??= getErrorMessage(error, "Watcher lease renewal failed.");
      });
      renewalAttempts.push(renewalAttempt);
      void renewalAttempt;
    }, renewalIntervalMs);

    try {
      try {
        throwIfAborted(params.signal);
        evaluation = await evaluator(currentLeasedWatcher);
        throwIfAborted(params.signal);
      } catch (error) {
        const releaseError = await tryReleaseLease();
        decisions.push({
          watcherId: watcher.id,
          action: "skipped",
          reason: releaseError
            ? `${getErrorMessage(error, "Watcher evaluator failed.")} Lease release failed: ${releaseError}`
            : getErrorMessage(error, "Watcher evaluator failed."),
          idempotencyKey: null
        });
        continue;
      }
    } finally {
      clearInterval(renewalTimer);
      await Promise.allSettled(renewalAttempts);
    }
    if (leaseRenewalError) {
      const releaseError = await tryReleaseLease();
      decisions.push({
        watcherId: watcher.id,
        action: "skipped",
        reason: releaseError ? `${leaseRenewalError} Lease release failed: ${releaseError}` : leaseRenewalError,
        idempotencyKey: null
      });
      continue;
    }
    const idempotencyKey = buildWatcherIdempotencyKey(currentLeasedWatcher, evaluatedAt);
    const notificationsDisabled = !currentLeasedWatcher.escalationPolicy.notify;
    const lastEvaluation = WatcherDryRunResultSchema.parse({
      evaluatedAt,
      wouldTrigger: evaluation.wouldTrigger,
      reason: evaluation.reason,
      idempotencyKey,
      sideEffectsSuppressed: currentLeasedWatcher.schedule.dryRun || notificationsDisabled
    });

    if (currentLeasedWatcher.schedule.dryRun || notificationsDisabled || !evaluation.wouldTrigger) {
      const progressedWatcher = applyWatcherEvaluationProgress({
        watcher: currentLeasedWatcher,
        evaluation,
        lastEvaluation,
        evaluatedAt
      });

      try {
        await params.repository.saveWatcher(progressedWatcher);
        leaseReleased = true;
      } catch (error) {
        const releaseError = await tryReleaseLease(progressedWatcher);
        decisions.push({
          watcherId: watcher.id,
          action: "skipped",
          reason: releaseError
            ? `${getErrorMessage(error, "Watcher persistence failed.")} Lease release failed: ${releaseError}`
            : getErrorMessage(error, "Watcher persistence failed."),
          idempotencyKey
        });
        continue;
      }

      decisions.push({
        watcherId: watcher.id,
        action: currentLeasedWatcher.schedule.dryRun ? "dry_run_recorded" : "skipped",
        reason:
          notificationsDisabled && evaluation.wouldTrigger
            ? "Watcher notification policy disabled trigger emission."
            : evaluation.reason,
        idempotencyKey
      });
      continue;
    }

    const progressedWatcher = applyWatcherEvaluationProgress({
      watcher: currentLeasedWatcher,
      evaluation,
      lastEvaluation,
      evaluatedAt
    });
    let claim: Awaited<ReturnType<AgenticRepository["claimAutopilotEvent"]>>;

    try {
      claim = await params.repository.claimAutopilotEvent({
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
    } catch (error) {
      const releaseError = await tryReleaseLease();
      decisions.push({
        watcherId: watcher.id,
        action: "skipped",
        reason: releaseError
          ? `${getErrorMessage(error, "Watcher trigger persistence failed.")} Lease release failed: ${releaseError}`
          : getErrorMessage(error, "Watcher trigger persistence failed."),
        idempotencyKey
      });
      continue;
    }

    try {
      await params.repository.saveWatcher(progressedWatcher);
      leaseReleased = true;
      decisions.push({
        watcherId: watcher.id,
        action: claim.outcome === "claimed" ? "trigger_claimed" : "trigger_suppressed",
        reason:
          claim.event.details.suppression?.reason ??
          (claim.event.details.reason && typeof claim.event.details.reason === "string" ? claim.event.details.reason : evaluation.reason),
        idempotencyKey
      });
    } catch (error) {
      const releaseError = await tryReleaseLease(progressedWatcher);
      decisions.push({
        watcherId: watcher.id,
        action: "skipped",
        reason: releaseError
          ? `${getErrorMessage(error, "Watcher trigger persistence failed.")} Lease release failed: ${releaseError}`
          : getErrorMessage(error, "Watcher trigger persistence failed."),
        idempotencyKey
      });
    }
  }

  return {
    evaluatedAt,
    runnerId: params.runnerId,
    decisions
  };
}

function delay(ms: number, signal?: AbortSignal): Promise<void> {
  if (ms <= 0) {
    return Promise.resolve();
  }

  if (signal?.aborted) {
    return Promise.resolve();
  }

  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", abort);
      resolve();
    }, ms);

    function abort() {
      clearTimeout(timer);
      signal?.removeEventListener("abort", abort);
      resolve();
    }

    signal?.addEventListener("abort", abort, { once: true });
  });
}

function createAbortSignalWithTimeout(parent: AbortSignal | undefined, timeoutMs: number): {
  signal: AbortSignal;
  cancel: () => void;
} {
  const controller = new AbortController();
  const timeout = setTimeout(() => {
    controller.abort(new Error(`Watcher scheduler run timed out after ${timeoutMs}ms.`));
  }, timeoutMs);
  const abortFromParent = () => {
    controller.abort(parent?.reason instanceof Error ? parent.reason : new Error("Watcher scheduler aborted."));
  };

  parent?.addEventListener("abort", abortFromParent, { once: true });

  return {
    signal: controller.signal,
    cancel: () => {
      clearTimeout(timeout);
      parent?.removeEventListener("abort", abortFromParent);
    }
  };
}

export async function runWatcherSchedulerLoop(params: {
  repository: AgenticRepository;
  runnerId: string;
  userId?: string;
  enabled?: boolean;
  intervalMs?: number;
  timeoutMs?: number;
  leaseMs?: number;
  mode?: AutopilotMode;
  evaluator?: WatcherSignalEvaluator;
  signal?: AbortSignal;
  onRunStart?: (startedAt: string) => void | Promise<void>;
  onRunComplete?: (result: WatcherSchedulerResult) => void | Promise<void>;
  onRunError?: (error: unknown) => void | Promise<void>;
}): Promise<void> {
  if (params.enabled === false) {
    return;
  }

  const intervalMs = Math.max(1_000, params.intervalMs ?? 60_000);
  const timeoutMs = Math.max(1_000, params.timeoutMs ?? Math.min(intervalMs, 30_000));

  while (!params.signal?.aborted) {
    const startedAt = nowIso();
    const timeout = createAbortSignalWithTimeout(params.signal, timeoutMs);

    try {
      await params.onRunStart?.(startedAt);
      const result = await runWatcherSchedulerOnce({
        repository: params.repository,
        runnerId: params.runnerId,
        userId: params.userId,
        leaseMs: params.leaseMs,
        mode: params.mode,
        evaluator: params.evaluator,
        signal: timeout.signal
      });
      await params.onRunComplete?.(result);
    } catch (error) {
      await params.onRunError?.(error);
    } finally {
      timeout.cancel();
    }

    await delay(intervalMs, params.signal);
  }
}
