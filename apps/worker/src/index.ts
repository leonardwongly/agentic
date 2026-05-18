import { assertDatabaseSchemaReady } from "@agentic/db/migration-runtime";
import { prepareDefaultIntegrations } from "@agentic/integrations";
import { logError, logInfo, withTelemetryContext } from "@agentic/observability";
import { createRepository } from "@agentic/repository";
import { createSelfImprovementRepository } from "@agentic/self-improvement-memory";
import {
  createFileWorkerRuntimeHealthSink,
  createWorkerRuntimeHealthSnapshot,
  runWatcherSchedulerLoop,
  runWorkerRuntime,
  updateWorkerRuntimeHealthSnapshot,
  type WorkerRuntimeHealthSink,
  type WorkerRuntimeHealthSnapshot
} from "@agentic/worker-runtime";

function parsePositiveIntEnv(name: string, fallback: number): number {
  const value = process.env[name]?.trim();

  if (!value) {
    return fallback;
  }

  const parsed = Number.parseInt(value, 10);

  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error(`${name} must be a positive integer when configured.`);
  }

  return parsed;
}

function parseOptionalPositiveIntEnv(name: string): number | undefined {
  const value = process.env[name]?.trim();

  if (!value) {
    return undefined;
  }

  const parsed = Number.parseInt(value, 10);

  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error(`${name} must be a positive integer when configured.`);
  }

  return parsed;
}

function parseRatioEnv(name: string, fallback: number): number {
  const value = process.env[name]?.trim();

  if (!value) {
    return fallback;
  }

  const parsed = Number.parseFloat(value);

  if (!Number.isFinite(parsed) || parsed < 0 || parsed > 1) {
    throw new Error(`${name} must be a number between 0 and 1 when configured.`);
  }

  return parsed;
}

function parseBooleanEnv(name: string, fallback: boolean): boolean {
  const value = process.env[name]?.trim().toLowerCase();

  if (!value) {
    return fallback;
  }

  if (["1", "true", "yes", "on"].includes(value)) {
    return true;
  }

  if (["0", "false", "no", "off"].includes(value)) {
    return false;
  }

  throw new Error(`${name} must be a boolean-like value when configured.`);
}

async function ensureWorkerRepositoryReady(): Promise<void> {
  const databaseUrl = process.env.DATABASE_URL?.trim();

  if (!databaseUrl) {
    return;
  }

  await assertDatabaseSchemaReady({ databaseUrl });
}

async function main() {
  await ensureWorkerRepositoryReady();
  const repository = createRepository();
  const selfImprovementRepository = createSelfImprovementRepository();
  const controller = new AbortController();
  const runnerId = process.env.AGENTIC_WORKER_RUNNER_ID?.trim() || `worker-${process.pid}`;
  const pollIntervalMs = parsePositiveIntEnv("AGENTIC_WORKER_POLL_INTERVAL_MS", 1_000);
  const leaseMs = parsePositiveIntEnv("AGENTIC_WORKER_LEASE_MS", 30_000);
  const heartbeatIntervalMs = parsePositiveIntEnv("AGENTIC_WORKER_HEARTBEAT_INTERVAL_MS", 5_000);
  const watcherSchedulerEnabled = !parseBooleanEnv("AGENTIC_WATCHER_SCHEDULER_DISABLED", false);
  const watcherSchedulerIntervalMs = parsePositiveIntEnv("AGENTIC_WATCHER_SCHEDULER_INTERVAL_MS", 60_000);
  const watcherSchedulerTimeoutMs = parsePositiveIntEnv("AGENTIC_WATCHER_SCHEDULER_TIMEOUT_MS", 30_000);
  const watcherSchedulerLeaseMs = parsePositiveIntEnv("AGENTIC_WATCHER_SCHEDULER_LEASE_MS", 60_000);
  const maxRunningPerKind = parseOptionalPositiveIntEnv("AGENTIC_WORKER_MAX_RUNNING_PER_KIND");
  const maxRunningPerUser = parseOptionalPositiveIntEnv("AGENTIC_WORKER_MAX_RUNNING_PER_USER");
  const maxRunningPerConcurrencyKey = parseOptionalPositiveIntEnv("AGENTIC_WORKER_MAX_RUNNING_PER_CONCURRENCY_KEY");
  const concurrencyLimits =
    maxRunningPerKind === undefined && maxRunningPerUser === undefined && maxRunningPerConcurrencyKey === undefined
      ? undefined
      : {
          maxRunningPerKind,
          maxRunningPerUser,
          maxRunningPerConcurrencyKey
        };
  const retryJitterRatio = parseRatioEnv("AGENTIC_WORKER_RETRY_JITTER_RATIO", 0.1);
  const healthPath = process.env.AGENTIC_WORKER_HEALTH_PATH?.trim();
  const healthFileSink = healthPath ? createFileWorkerRuntimeHealthSink(healthPath) : null;
  let healthSnapshot: WorkerRuntimeHealthSnapshot | null = healthFileSink
    ? createWorkerRuntimeHealthSnapshot({
        runnerId,
        status: "starting"
      })
    : null;
  const healthSink: WorkerRuntimeHealthSink | undefined = healthFileSink
    ? {
        async write(snapshot) {
          healthSnapshot = updateWorkerRuntimeHealthSnapshot({
            ...snapshot,
            scheduler: healthSnapshot?.scheduler ?? snapshot.scheduler
          }, {});
          await healthFileSink.write(healthSnapshot);
        }
      }
    : undefined;
  const writeSchedulerHealth = async (updates: Partial<WorkerRuntimeHealthSnapshot["scheduler"]>) => {
    if (!healthFileSink || !healthSnapshot) {
      return;
    }

    healthSnapshot = updateWorkerRuntimeHealthSnapshot(healthSnapshot, {
      scheduler: {
        ...healthSnapshot.scheduler,
        ...updates,
        enabled: watcherSchedulerEnabled
      }
    });
    await healthFileSink.write(healthSnapshot);
  };

  const shutdown = (signal: string) => {
    if (controller.signal.aborted) {
      return;
    }

    logInfo("worker.shutdown_requested", {
      signal,
      runnerId
    });
    controller.abort();
  };

  process.on("SIGINT", () => shutdown("SIGINT"));
  process.on("SIGTERM", () => shutdown("SIGTERM"));

  await Promise.all([
    repository.seedDefaults(),
    prepareDefaultIntegrations(),
    selfImprovementRepository.seed()
  ]);

  await withTelemetryContext(
    {
      runnerId
    },
    async () => {
      logInfo("worker.starting", {
        runnerId,
        pollIntervalMs,
        leaseMs,
        retryJitterRatio,
        concurrencyLimits,
        watcherSchedulerEnabled,
        watcherSchedulerIntervalMs,
        watcherSchedulerTimeoutMs,
        healthConfigured: Boolean(healthSink)
      });

      const [result] = await Promise.all([
        runWorkerRuntime({
          repository,
          selfImprovementRepository,
          runnerId,
          pollIntervalMs,
          leaseMs,
          concurrencyLimits,
          retryJitterRatio,
          requireIdempotencyForRetry: true,
          signal: controller.signal,
          health: healthSink
            ? {
                sink: healthSink,
                intervalMs: heartbeatIntervalMs,
                schedulerEnabled: watcherSchedulerEnabled
              }
            : undefined
        }),
        runWatcherSchedulerLoop({
          repository,
          runnerId,
          enabled: watcherSchedulerEnabled,
          intervalMs: watcherSchedulerIntervalMs,
          timeoutMs: watcherSchedulerTimeoutMs,
          leaseMs: watcherSchedulerLeaseMs,
          signal: controller.signal,
          onRunStart: (startedAt) =>
            writeSchedulerHealth({
              lastRunAt: startedAt
            }),
          onRunComplete: (schedulerResult) =>
            writeSchedulerHealth({
              lastCompletedAt: schedulerResult.evaluatedAt,
              lastDecisionCount: schedulerResult.decisions.length,
              lastErrorAt: null,
              lastErrorClass: null
            }),
          onRunError: (error) =>
            writeSchedulerHealth({
              lastErrorAt: new Date().toISOString(),
              lastErrorClass: error instanceof Error ? error.name : "UnknownError"
            })
        })
      ]);

      logInfo("worker.stopped", {
        runnerId,
        processedCount: result.processedCount,
        stopReason: result.stopReason
      });
    }
  );
}

main().catch((error) => {
  logError("worker.fatal_startup_failure", error);
  process.exitCode = 1;
});
