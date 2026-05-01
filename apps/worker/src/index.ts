import { assertDatabaseSchemaReady } from "@agentic/db/migration-runtime";
import { prepareDefaultIntegrations } from "@agentic/integrations";
import { logError, logInfo, withTelemetryContext } from "@agentic/observability";
import { createRepository } from "@agentic/repository";
import { createSelfImprovementRepository } from "@agentic/self-improvement-memory";
import { runWorkerRuntime } from "@agentic/worker-runtime";

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
        concurrencyLimits
      });

      const result = await runWorkerRuntime({
        repository,
        selfImprovementRepository,
        runnerId,
        pollIntervalMs,
        leaseMs,
        concurrencyLimits,
        retryJitterRatio,
        requireIdempotencyForRetry: true,
        signal: controller.signal
      });

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
