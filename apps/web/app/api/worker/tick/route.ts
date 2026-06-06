import { z } from "zod";
import { logInfo } from "@agentic/observability";
import {
  createRepositoryWorkerRuntimeHealthSink,
  resolveWorkerConcurrencyPolicy,
  runWorkerRuntime
} from "@agentic/worker-runtime";
import { authenticatedJson } from "../../../../lib/api-response";
import { createGovernedMutationRoute } from "../../../../lib/governed-route";
import { getSeededRepository, getSeededSelfImprovementRepository } from "../../../../lib/server";

const DEFAULT_TICK_MAX_JOBS = 10;
const MAX_TICK_MAX_JOBS = 50;
const DEFAULT_TICK_MAX_DURATION_MS = 10_000;
const MAX_TICK_MAX_DURATION_MS = 60_000;
const TICK_LEASE_MS = 30_000;
const TICK_HEARTBEAT_INTERVAL_MS = 5_000;

const WorkerTickRequestSchema = z
  .object({
    maxJobs: z.number().int().min(1).max(MAX_TICK_MAX_JOBS).optional(),
    maxDurationMs: z.number().int().min(1_000).max(MAX_TICK_MAX_DURATION_MS).optional()
  })
  .strict()
  .nullish();

// Serverless-friendly HTTP trigger: a free scheduler (Vercel Cron, cron-job.org,
// or any authenticated curl) can drain a bounded batch of already-enqueued,
// already-governed durable jobs. Side-effecting work stays gated by each job's
// own governance/approval rules; this route only paces the durable queue.
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
    const runnerId = process.env.AGENTIC_WORKER_TICK_RUNNER_ID?.trim() || "web-worker-tick";
    const [repository, selfImprovementRepository] = await Promise.all([
      getSeededRepository(),
      getSeededSelfImprovementRepository()
    ]);
    const controller = new AbortController();
    const deadlineTimer = setTimeout(() => controller.abort(), maxDurationMs);
    deadlineTimer.unref?.();

    try {
      const result = await runWorkerRuntime({
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
          schedulerEnabled: false
        }
      });

      logInfo("api.worker.tick.completed", {
        runnerId,
        processedCount: result.processedCount,
        stopReason: result.stopReason,
        maxJobs
      });

      return authenticatedJson({
        tick: {
          runnerId,
          processedCount: result.processedCount,
          stopReason: result.stopReason,
          maxJobs
        }
      });
    } finally {
      clearTimeout(deadlineTimer);
    }
  }
);
