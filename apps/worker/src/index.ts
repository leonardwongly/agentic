import { assertDatabaseSchemaReady } from "@agentic/db/migration-runtime";
import { prepareDefaultIntegrations } from "@agentic/integrations";
import { logError, logInfo, withTelemetryContext } from "@agentic/observability";
import { createRepository } from "@agentic/repository";
import { createSelfImprovementRepository } from "@agentic/self-improvement-memory";
import {
  createFileWorkerRuntimeHealthSink,
  createRepositoryWorkerRuntimeHealthSink,
  createWorkerRuntimeHealthSnapshot,
  resolveWorkerConcurrencyPolicy,
  runWatcherSchedulerLoop,
  runWatcherSchedulerOnce,
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
  const concurrencyPolicy = resolveWorkerConcurrencyPolicy();
  const concurrencyLimits = concurrencyPolicy.limits;
  const retryJitterRatio = parseRatioEnv("AGENTIC_WORKER_RETRY_JITTER_RATIO", 0.1);
  const runOnce = process.argv.includes("--once") || parseBooleanEnv("AGENTIC_WORKER_RUN_ONCE", false);
  const maxJobsPerRun = parsePositiveIntEnv("AGENTIC_WORKER_MAX_JOBS", 50);
  const maxRunDurationMs = parsePositiveIntEnv("AGENTIC_WORKER_MAX_DURATION_MS", 55_000);
  const healthPath = process.env.AGENTIC_WORKER_HEALTH_PATH?.trim();
  const databaseConfigured = Boolean(process.env.DATABASE_URL?.trim());
  const baseHealthSink = healthPath
    ? createFileWorkerRuntimeHealthSink(healthPath)
    : databaseConfigured
      ? createRepositoryWorkerRuntimeHealthSink(repository)
      : null;
  let healthSnapshot: WorkerRuntimeHealthSnapshot | null = baseHealthSink
    ? createWorkerRuntimeHealthSnapshot({
        runnerId,
        status: "starting"
      })
    : null;
  const healthSink: WorkerRuntimeHealthSink | undefined = baseHealthSink
    ? {
        async write(snapshot) {
          healthSnapshot = updateWorkerRuntimeHealthSnapshot({
            ...snapshot,
            scheduler: healthSnapshot?.scheduler ?? snapshot.scheduler
          }, {});
          await baseHealthSink.write(healthSnapshot);
        }
      }
    : undefined;
  const writeSchedulerHealth = async (updates: Partial<WorkerRuntimeHealthSnapshot["scheduler"]>) => {
    if (!baseHealthSink || !healthSnapshot) {
      return;
    }

    healthSnapshot = updateWorkerRuntimeHealthSnapshot(healthSnapshot, {
      scheduler: {
        ...healthSnapshot.scheduler,
        ...updates,
        enabled: watcherSchedulerEnabled
      }
    });
    await baseHealthSink.write(healthSnapshot);
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
        concurrencyPolicySource: concurrencyPolicy.source,
        concurrencyPolicyConstrained: concurrencyPolicy.constrained,
        concurrencyPolicyExplicitlyConfigured: concurrencyPolicy.explicitlyConfigured,
        watcherSchedulerEnabled,
        watcherSchedulerIntervalMs,
        watcherSchedulerTimeoutMs,
        healthConfigured: Boolean(healthSink),
        healthBackend: healthPath ? "file" : databaseConfigured ? "database" : "none",
        runOnce,
        maxJobsPerRun,
        maxRunDurationMs
      });

      if (runOnce) {
        const deadlineTimer = setTimeout(() => shutdown("deadline"), maxRunDurationMs);
        deadlineTimer.unref();
        let onceExitCode = 0;

        try {
          const drainScheduler = async () => {
            if (!watcherSchedulerEnabled) {
              return;
            }

            await writeSchedulerHealth({ lastRunAt: new Date().toISOString() });

            try {
              const schedulerResult = await runWatcherSchedulerOnce({
                repository,
                runnerId,
                leaseMs: watcherSchedulerLeaseMs,
                signal: controller.signal
              });
              await writeSchedulerHealth({
                lastCompletedAt: schedulerResult.evaluatedAt,
                lastDecisionCount: schedulerResult.decisions.length,
                lastErrorAt: null,
                lastErrorClass: null
              });
            } catch (error) {
              await writeSchedulerHealth({
                lastErrorAt: new Date().toISOString(),
                lastErrorClass: error instanceof Error ? error.name : "UnknownError"
              });
            }
          };

          const [onceResult] = await Promise.all([
            runWorkerRuntime({
              repository,
              selfImprovementRepository,
              runnerId,
              pollIntervalMs,
              leaseMs,
              concurrencyLimits,
              retryJitterRatio,
              requireIdempotencyForRetry: true,
              maxJobs: maxJobsPerRun,
              stopWhenIdle: true,
              signal: controller.signal,
              health: healthSink
                ? {
                    sink: healthSink,
                    intervalMs: heartbeatIntervalMs,
                    schedulerEnabled: watcherSchedulerEnabled
                  }
                : undefined
            }),
            drainScheduler()
          ]);

          logInfo("worker.run_once_complete", {
            runnerId,
            processedCount: onceResult.processedCount,
            stopReason: onceResult.stopReason,
            maxJobs: maxJobsPerRun
          });
        } catch (error) {
          logError("worker.run_once_failed", error);
          onceExitCode = 1;
        } finally {
          clearTimeout(deadlineTimer);
        }

        process.exit(onceExitCode);
      }

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
