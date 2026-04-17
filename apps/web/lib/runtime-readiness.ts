import { getDatabaseSchemaStatus, type DatabaseSchemaStatus } from "@agentic/db";
import { createRepository } from "@agentic/repository";
import { getAuthMode } from "./auth";
import { getAuthRuntimeStateStatus, type AuthRuntimeStateStatus } from "./auth-runtime-state";

export type ReadinessCheck = {
  name: "access_key" | "database" | "auth_runtime_state" | "async_execution";
  status: "pass" | "warn" | "fail";
  message: string;
  details?: Record<string, string | boolean | number | null>;
};

export type WebReadinessReport = {
  ok: boolean;
  status: "ready" | "not_ready";
  runtime: "production" | "development" | "test";
  storageBackend: "postgres" | "file";
  generatedAt: string;
  checks: ReadinessCheck[];
};

type AuthModeSnapshot = ReturnType<typeof getAuthMode>;
type AsyncExecutionCheckSnapshot = Omit<ReadinessCheck, "name">;

type ReadinessEvaluationParams = {
  generatedAt?: string;
  nodeEnv?: string;
  databaseConfigured: boolean;
  authMode: AuthModeSnapshot;
  authRuntimeState: AuthRuntimeStateStatus;
  databaseStatus: DatabaseSchemaStatus | null;
  asyncExecution: AsyncExecutionCheckSnapshot;
};

const DEFAULT_MAX_PENDING_JOB_AGE_MS = 15 * 60 * 1000;

function normalizeRuntime(nodeEnv: string | undefined): WebReadinessReport["runtime"] {
  if (nodeEnv === "production") {
    return "production";
  }

  if (nodeEnv === "test") {
    return "test";
  }

  return "development";
}

function buildDatabaseCheck(params: ReadinessEvaluationParams): ReadinessCheck {
  const runtime = normalizeRuntime(params.nodeEnv);

  if (!params.databaseConfigured) {
    if (runtime === "production") {
      return {
        name: "database",
        status: "fail",
        message: "Production requires DATABASE_URL and the Postgres-backed repository."
      };
    }

    return {
      name: "database",
      status: "warn",
      message: "Running with the file-backed repository because DATABASE_URL is not configured.",
      details: {
        reachable: false,
        ready: true
      }
    };
  }

  if (!params.databaseStatus || !params.databaseStatus.reachable) {
    return {
      name: "database",
      status: "fail",
      message: "Database connectivity check failed.",
      details: {
        reachable: false,
        ready: false
      }
    };
  }

  if (!params.databaseStatus.ready) {
    return {
      name: "database",
      status: "fail",
      message: "Database schema is not ready for application startup.",
      details: {
        reachable: true,
        pendingMigrations: params.databaseStatus.pendingMigrations.length,
        driftedMigrations: params.databaseStatus.driftedMigrations.length,
        metadataMissing: params.databaseStatus.missingMetadataTable
      }
    };
  }

  return {
    name: "database",
    status: "pass",
    message: "Database connectivity and schema checks passed.",
    details: {
      reachable: true,
      ready: true,
      appliedMigrations: params.databaseStatus.appliedMigrations.length
    }
  };
}

function buildAccessKeyCheck(params: ReadinessEvaluationParams): ReadinessCheck {
  if (params.authMode.requiresConfiguredKey) {
    return {
      name: "access_key",
      status: "fail",
      message: "AGENTIC_ACCESS_KEY is not configured."
    };
  }

  if (params.authMode.usesDevelopmentFallback) {
    return {
      name: "access_key",
      status: "warn",
      message: "Using the development fallback access key; do not expose this runtime externally."
    };
  }

  return {
    name: "access_key",
    status: "pass",
    message: "Access-key signing secret is configured."
  };
}

function buildAuthRuntimeStateCheck(params: ReadinessEvaluationParams): ReadinessCheck {
  const runtime = normalizeRuntime(params.nodeEnv);
  const warningCount = params.authRuntimeState.warnings.length;

  if (runtime === "production" && params.authRuntimeState.requiresSharedState && !params.authRuntimeState.sharedStateConfigured) {
    return {
      name: "auth_runtime_state",
      status: "fail",
      message: "Shared auth runtime state is required but not fully configured.",
      details: {
        sessionStateScope: params.authRuntimeState.sessionStateScope,
        unlockStateScope: params.authRuntimeState.unlockStateScope
      }
    };
  }

  if (warningCount > 0) {
    return {
      name: "auth_runtime_state",
      status: runtime === "production" ? "warn" : "pass",
      message:
        runtime === "production"
          ? "Auth runtime state is operational, but some controls remain process-local."
          : "Auth runtime state is acceptable for non-production startup.",
      details: {
        sessionStateScope: params.authRuntimeState.sessionStateScope,
        unlockStateScope: params.authRuntimeState.unlockStateScope,
        warningCount
      }
    };
  }

  return {
    name: "auth_runtime_state",
    status: "pass",
    message: "Auth runtime state checks passed.",
    details: {
      sessionStateScope: params.authRuntimeState.sessionStateScope,
      unlockStateScope: params.authRuntimeState.unlockStateScope
    }
  };
}

function buildAsyncExecutionCheck(params: ReadinessEvaluationParams): ReadinessCheck {
  return {
    name: "async_execution",
    ...params.asyncExecution
  };
}

function getMaxPendingJobAgeMs(): number {
  const configured = Number.parseInt(process.env.AGENTIC_READY_MAX_PENDING_JOB_AGE_MS ?? "", 10);

  if (Number.isFinite(configured) && configured > 0) {
    return configured;
  }

  return DEFAULT_MAX_PENDING_JOB_AGE_MS;
}

function getAsyncExecutionFailureStatus(runtime: WebReadinessReport["runtime"]): ReadinessCheck["status"] {
  return runtime === "production" ? "fail" : "warn";
}

async function getAsyncExecutionCheckSnapshot(nodeEnv: string | undefined): Promise<AsyncExecutionCheckSnapshot> {
  const runtime = normalizeRuntime(nodeEnv);
  const maxPendingJobAgeMs = getMaxPendingJobAgeMs();

  try {
    const repository = createRepository();
    const jobs = await repository.listJobs({
      statuses: ["queued", "running", "retrying", "dead_letter"]
    });
    const now = Date.now();
    const deadLetterCount = jobs.filter((job) => job.status === "dead_letter").length;
    const expiredLeaseCount = jobs.filter((job) => {
      if (job.status !== "running" || !job.leaseExpiresAt) {
        return false;
      }

      const leaseExpiresAt = Date.parse(job.leaseExpiresAt);
      return Number.isFinite(leaseExpiresAt) && leaseExpiresAt <= now;
    }).length;
    const pendingJobs = jobs.filter((job) => job.status === "queued" || job.status === "retrying");
    const stalePendingCount = pendingJobs.filter((job) => {
      const availableAt = Date.parse(job.availableAt);
      return Number.isFinite(availableAt) && availableAt <= now && now - availableAt > maxPendingJobAgeMs;
    }).length;
    const oldestPendingAgeMs =
      pendingJobs.length === 0
        ? null
        : pendingJobs.reduce<number | null>((oldest, job) => {
            const availableAt = Date.parse(job.availableAt);

            if (!Number.isFinite(availableAt) || availableAt > now) {
              return oldest;
            }

            const age = Math.max(0, now - availableAt);
            return oldest === null ? age : Math.max(oldest, age);
          }, null);
    const details = {
      queuedJobs: jobs.filter((job) => job.status === "queued").length,
      retryingJobs: jobs.filter((job) => job.status === "retrying").length,
      runningJobs: jobs.filter((job) => job.status === "running").length,
      deadLetterJobs: deadLetterCount,
      expiredLeases: expiredLeaseCount,
      stalePendingJobs: stalePendingCount,
      oldestPendingJobAgeSeconds: oldestPendingAgeMs === null ? null : Math.floor(oldestPendingAgeMs / 1000),
      maxPendingJobAgeSeconds: Math.floor(maxPendingJobAgeMs / 1000)
    };

    if (deadLetterCount > 0 || expiredLeaseCount > 0 || stalePendingCount > 0) {
      const issues: string[] = [];

      if (deadLetterCount > 0) {
        issues.push(`${deadLetterCount} dead-letter job(s)`);
      }

      if (expiredLeaseCount > 0) {
        issues.push(`${expiredLeaseCount} expired worker lease(s)`);
      }

      if (stalePendingCount > 0) {
        issues.push(`${stalePendingCount} stale pending job(s)`);
      }

      return {
        status: getAsyncExecutionFailureStatus(runtime),
        message: `Async execution requires attention: ${issues.join(", ")}.`,
        details
      };
    }

    return {
      status: "pass",
      message: "Async execution backlog checks passed.",
      details
    };
  } catch (error) {
    return {
      status: getAsyncExecutionFailureStatus(runtime),
      message: "Async execution readiness checks could not be completed.",
      details: {
        error: error instanceof Error ? error.message : "Unknown readiness failure"
      }
    };
  }
}

export function buildWebReadinessReport(params: ReadinessEvaluationParams): WebReadinessReport {
  const runtime = normalizeRuntime(params.nodeEnv);
  const checks = [
    buildAccessKeyCheck(params),
    buildDatabaseCheck(params),
    buildAuthRuntimeStateCheck(params),
    buildAsyncExecutionCheck(params)
  ];
  const ok = checks.every((check) => check.status !== "fail");

  return {
    ok,
    status: ok ? "ready" : "not_ready",
    runtime,
    storageBackend: params.databaseConfigured ? "postgres" : "file",
    generatedAt: params.generatedAt ?? new Date().toISOString(),
    checks
  };
}

export async function getWebReadinessReport(): Promise<WebReadinessReport> {
  const databaseConfigured = Boolean(process.env.DATABASE_URL?.trim());
  const nodeEnv = process.env.NODE_ENV;

  return buildWebReadinessReport({
    nodeEnv,
    databaseConfigured,
    authMode: getAuthMode({ emitDevelopmentWarning: false }),
    authRuntimeState: getAuthRuntimeStateStatus(),
    databaseStatus: databaseConfigured
      ? await getDatabaseSchemaStatus({
          databaseUrl: process.env.DATABASE_URL
        })
      : null,
    asyncExecution: await getAsyncExecutionCheckSnapshot(nodeEnv)
  });
}
