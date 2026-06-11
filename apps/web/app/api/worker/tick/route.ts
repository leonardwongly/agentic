import { z } from "zod";
import { logError, logInfo } from "@agentic/observability";
import {
  createRepositoryWorkerRuntimeHealthSink,
  resolveWorkerConcurrencyPolicy,
  runWatcherSchedulerOnce,
  runWorkerRuntime
} from "@agentic/worker-runtime";
import { authenticatedJson } from "../../../../lib/api-response";
import { getRuntimeEnvValue } from "../../../../lib/cloudflare-runtime";
import { createGovernedMutationRoute } from "../../../../lib/governed-route";
import { getSeededRepository, getSeededSelfImprovementRepository } from "../../../../lib/server";

const DEFAULT_TICK_MAX_JOBS = 10;
const MAX_TICK_MAX_JOBS = 50;
const DEFAULT_TICK_MAX_DURATION_MS = 10_000;
const MAX_TICK_MAX_DURATION_MS = 60_000;
const TICK_LEASE_MS = 30_000;
const TICK_WATCHER_LEASE_MS = 60_000;
const TICK_HEARTBEAT_INTERVAL_MS = 5_000;

const WATCHER_SCHEDULER_DISABLED_VALUES = new Set(["1", "true", "yes", "on"]);

function isWatcherSchedulerDisabled(): boolean {
  return WATCHER_SCHEDULER_DISABLED_VALUES.has(
    getRuntimeEnvValue("AGENTIC_WATCHER_SCHEDULER_DISABLED")?.trim().toLowerCase() ?? ""
  );
}

const WorkerTickRequestSchema = z
  .object({
    maxJobs: z.number().int().min(1).max(MAX_TICK_MAX_JOBS).optional(),
    maxDurationMs: z.number().int().min(1_000).max(MAX_TICK_MAX_DURATION_MS).optional(),
    // When true (used by the Cloudflare Cron Trigger), also run one watcher
    // scheduler pass so time-based watchers fire. Defaults to false to preserve
    // the behavior of existing HTTP schedulers.
    runWatchers: z.boolean().optional()
  })
  .strict()
  .nullish();

// Serverless-friendly HTTP trigger: a scheduler (Cloudflare Cron Trigger, Vercel
// Cron, cron-job.org, or any authenticated curl) can drain a bounded batch of
// already-enqueued, already-governed durable jobs and optionally run one
// watcher-scheduler pass. Side-effecting work stays gated by each job's own
// governance/approval rules; this route only paces the durable queue.
export const POST = createGovernedMutationRoute(
  {
    route: "api.worker.tick",
    fallbackError: "Failed to run the worker tick.",
    bodySchema: WorkerTickRequestSchema,
    rateLimit: {
      namespace: "worker-tick",
      error: "Too many worker tick requests. Try again later."
    },
    idempotency: false,
    machineRouteGroup: "worker",
    machineScope: "worker:tick",
    allowBootstrapAccessKey: false
  },
  async ({ body }) => {
    const maxJobs = body?.maxJobs ?? DEFAULT_TICK_MAX_JOBS;
    const maxDurationMs = body?.maxDurationMs ?? DEFAULT_TICK_MAX_DURATION_MS;
    const runWatchers = (body?.runWatchers ?? false) && !isWatcherSchedulerDisabled();
    const runnerId = getRuntimeEnvValue("AGENTIC_WORKER_TICK_RUNNER_ID")?.trim() || "web-worker-tick";
    const [repository, selfImprovementRepository] = await Promise.all([
      getSeededRepository(),
      getSeededSelfImprovementRepository()
    ]);
    const controller = new AbortController();
    const deadlineTimer = setTimeout(() => controller.abort(), maxDurationMs);
    deadlineTimer.unref?.();

    const runWatcherPass = async (): Promise<number | null> => {
      if (!runWatchers) {
        return null;
      }

      try {
        const schedulerResult = await runWatcherSchedulerOnce({
          repository,
          runnerId,
          leaseMs: TICK_WATCHER_LEASE_MS,
          signal: controller.signal
        });
        return schedulerResult.decisions.length;
      } catch (error) {
        logError("api.worker.tick.watcher_failed", error);
        return null;
      }
    };

    try {
      const [result, watcherDecisionCount] = await Promise.all([
        runWorkerRuntime({
          repository,
          selfImprovementRepository,
          runnerId,
          leaseMs: TICK_LEASE_MS,
          concurrencyLimits: resolveWorkerConcurrencyPolicy().limits,
          requireIdempotencyForRetry: true,
          maxJobs,
          stopWhenIdle: true,
          signal: controller.signal,
          health: {
            sink: createRepositoryWorkerRuntimeHealthSink(repository),
            intervalMs: TICK_HEARTBEAT_INTERVAL_MS,
            schedulerEnabled: runWatchers
          }
        }),
        runWatcherPass()
      ]);

      logInfo("api.worker.tick.completed", {
        runnerId,
        processedCount: result.processedCount,
        stopReason: result.stopReason,
        maxJobs,
        ranWatchers: runWatchers,
        watcherDecisionCount
      });

      return authenticatedJson({
        tick: {
          runnerId,
          processedCount: result.processedCount,
          stopReason: result.stopReason,
          maxJobs,
          ranWatchers: runWatchers,
          watcherDecisionCount
        }
      });
    } finally {
      clearTimeout(deadlineTimer);
    }
  }
);
