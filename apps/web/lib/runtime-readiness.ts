import { createRepository } from "@agentic/repository";
import type { ProviderCredential } from "@agentic/contracts";
import { getAuthMode } from "./auth";
import { getAuthRuntimeStateStatus, type AuthRuntimeStateStatus } from "./auth-runtime-state";
import { getRequestIdentityRuntimeStatus, type RequestIdentityRuntimeStatus } from "./request-client-identity";

type DatabaseSchemaStatus = import("@agentic/db/schema-status").DatabaseSchemaStatus;

export type ReadinessCheck = {
  name:
    | "access_key"
    | "database"
    | "auth_runtime_state"
    | "request_identity"
    | "async_execution"
    | "connector_health";
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
type ConnectorHealthCheckSnapshot = Omit<ReadinessCheck, "name">;

type ReadinessEvaluationParams = {
  generatedAt?: string;
  nodeEnv?: string;
  databaseConfigured: boolean;
  authMode: AuthModeSnapshot;
  authRuntimeState: AuthRuntimeStateStatus;
  requestIdentity: RequestIdentityRuntimeStatus;
  databaseStatus: DatabaseSchemaStatus | null;
  asyncExecution: AsyncExecutionCheckSnapshot;
  connectorHealth: ConnectorHealthCheckSnapshot;
};

const DEFAULT_MAX_PENDING_JOB_AGE_MS = 15 * 60 * 1000;
const DEFAULT_PROVIDER_VALIDATION_STALE_MS = 7 * 24 * 60 * 60 * 1000;

async function loadDatabaseSchemaStatus(options?: {
  databaseUrl?: string;
}): Promise<DatabaseSchemaStatus> {
  const runtime = await import("@agentic/db/schema-status");
  return runtime.getDatabaseSchemaStatus(options);
}

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
        missingAuthRuntimeTables: params.databaseStatus.requiredSchemaObjects.missingTables.length,
        missingAuthRuntimeIndexes: params.databaseStatus.requiredSchemaObjects.missingIndexes.length,
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
      appliedMigrations: params.databaseStatus.appliedMigrations.length,
      authRuntimeTables: params.databaseStatus.requiredSchemaObjects.tables.length,
      authRuntimeIndexes: params.databaseStatus.requiredSchemaObjects.indexes.length
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

function buildRequestIdentityCheck(params: ReadinessEvaluationParams): ReadinessCheck {
  const runtime = normalizeRuntime(params.nodeEnv);

  if (runtime === "production" && !params.requestIdentity.trustProxyHeaders) {
    return {
      name: "request_identity",
      status: "fail",
      message: "Trusted proxy headers must be enabled in production so abuse controls can key off canonical client IPs.",
      details: {
        identitySource: params.requestIdentity.identitySource,
        trustProxyHeaders: params.requestIdentity.trustProxyHeaders
      }
    };
  }

  if (params.requestIdentity.warnings.length > 0) {
    return {
      name: "request_identity",
      status: runtime === "production" ? "warn" : "pass",
      message:
        runtime === "production"
          ? "Request identity fallback is active; enable trusted proxy headers before exposing this runtime externally."
          : "Request identity fallback is acceptable for non-production startup.",
      details: {
        identitySource: params.requestIdentity.identitySource,
        trustProxyHeaders: params.requestIdentity.trustProxyHeaders,
        warningCount: params.requestIdentity.warnings.length
      }
    };
  }

  return {
    name: "request_identity",
    status: "pass",
    message: "Request identity controls are configured to trust canonical proxy IP headers.",
    details: {
      identitySource: params.requestIdentity.identitySource,
      trustProxyHeaders: params.requestIdentity.trustProxyHeaders
    }
  };
}

function buildAsyncExecutionCheck(params: ReadinessEvaluationParams): ReadinessCheck {
  return {
    name: "async_execution",
    ...params.asyncExecution
  };
}

function buildConnectorHealthCheck(params: ReadinessEvaluationParams): ReadinessCheck {
  return {
    name: "connector_health",
    ...params.connectorHealth
  };
}

function parseTimestampMs(timestamp: string | null | undefined): number | null {
  if (!timestamp) {
    return null;
  }

  const parsed = Date.parse(timestamp);
  return Number.isFinite(parsed) ? parsed : null;
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

function getConnectorHealthFailureStatus(runtime: WebReadinessReport["runtime"]): ReadinessCheck["status"] {
  return runtime === "production" ? "fail" : "warn";
}

function getConnectorHealthWarningStatus(runtime: WebReadinessReport["runtime"]): ReadinessCheck["status"] {
  return runtime === "production" ? "warn" : "pass";
}

function formatCountLabel(count: number, singular: string, plural: string): string {
  return `${count} ${count === 1 ? singular : plural}`;
}

export function buildConnectorHealthCheckSnapshot(params: {
  credentials: ProviderCredential[];
  runtime: WebReadinessReport["runtime"];
  now?: number;
}): ConnectorHealthCheckSnapshot {
  const now = params.now ?? Date.now();
  const connectedCount = params.credentials.filter((credential) => credential.status === "connected").length;
  const reconnectRequiredCount = params.credentials.filter((credential) => credential.status === "reconnect_required").length;
  const refreshFailedCount = params.credentials.filter((credential) => credential.status === "refresh_failed").length;
  const revokedCount = params.credentials.filter((credential) => credential.status === "revoked").length;
  const expiredCount = params.credentials.filter((credential) => {
    const expiresAtMs = parseTimestampMs(credential.expiresAt);
    return expiresAtMs !== null && expiresAtMs <= now;
  }).length;
  const validationStaleCount = params.credentials.filter((credential) => {
    if (credential.status !== "connected") {
      return false;
    }

    const validationReferenceMs = parseTimestampMs(credential.lastValidatedAt) ?? parseTimestampMs(credential.updatedAt);
    return validationReferenceMs !== null && now - validationReferenceMs >= DEFAULT_PROVIDER_VALIDATION_STALE_MS;
  }).length;
  const degradedCount = params.credentials.filter((credential) => {
    if (credential.status === "reconnect_required" || credential.status === "refresh_failed" || credential.status === "revoked") {
      return true;
    }

    const expiresAtMs = parseTimestampMs(credential.expiresAt);

    if (expiresAtMs !== null && expiresAtMs <= now) {
      return true;
    }

    if (credential.status !== "connected") {
      return false;
    }

    const validationReferenceMs = parseTimestampMs(credential.lastValidatedAt) ?? parseTimestampMs(credential.updatedAt);
    return validationReferenceMs !== null && now - validationReferenceMs >= DEFAULT_PROVIDER_VALIDATION_STALE_MS;
  }).length;
  const details = {
    totalCredentials: params.credentials.length,
    connectedCredentials: connectedCount,
    degradedCredentials: degradedCount,
    reconnectRequiredCredentials: reconnectRequiredCount,
    refreshFailedCredentials: refreshFailedCount,
    revokedCredentials: revokedCount,
    expiredCredentials: expiredCount,
    validationStaleCredentials: validationStaleCount,
    validationStaleAfterHours: Math.floor(DEFAULT_PROVIDER_VALIDATION_STALE_MS / (60 * 60 * 1000))
  };

  if (params.credentials.length === 0) {
    return {
      status: "pass",
      message: "No provider credentials are configured, so connector-health checks are idle.",
      details
    };
  }

  const criticalIssues: string[] = [];

  if (reconnectRequiredCount > 0) {
    criticalIssues.push(
      formatCountLabel(reconnectRequiredCount, "credential requires re-authentication", "credentials require re-authentication")
    );
  }

  if (revokedCount > 0) {
    criticalIssues.push(formatCountLabel(revokedCount, "credential was revoked", "credentials were revoked"));
  }

  if (expiredCount > 0) {
    criticalIssues.push(formatCountLabel(expiredCount, "credential is expired", "credentials are expired"));
  }

  if (criticalIssues.length > 0) {
    return {
      status: getConnectorHealthFailureStatus(params.runtime),
      message: `Connector health requires attention: ${criticalIssues.join(", ")}.`,
      details
    };
  }

  const warnings: string[] = [];

  if (refreshFailedCount > 0) {
    warnings.push(
      formatCountLabel(refreshFailedCount, "credential refresh failed recently", "credentials refresh failed recently")
    );
  }

  if (validationStaleCount > 0) {
    warnings.push(
      formatCountLabel(validationStaleCount, "credential validation is stale", "credentials validation is stale")
    );
  }

  if (warnings.length > 0) {
    return {
      status: getConnectorHealthWarningStatus(params.runtime),
      message: `Connector health is degraded: ${warnings.join(", ")}.`,
      details
    };
  }

  return {
    status: "pass",
    message: "Connector health checks passed.",
    details
  };
}

async function getConnectorHealthCheckSnapshot(nodeEnv: string | undefined): Promise<ConnectorHealthCheckSnapshot> {
  const runtime = normalizeRuntime(nodeEnv);

  try {
    const repository = createRepository();
    const credentials = await repository.listProviderCredentials();
    return buildConnectorHealthCheckSnapshot({
      credentials,
      runtime
    });
  } catch (error) {
    return {
      status: getConnectorHealthFailureStatus(runtime),
      message: "Connector health readiness checks could not be completed.",
      details: {
        error: error instanceof Error ? error.message : "Unknown readiness failure"
      }
    };
  }
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
    buildRequestIdentityCheck(params),
    buildAsyncExecutionCheck(params),
    buildConnectorHealthCheck(params)
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
    requestIdentity: getRequestIdentityRuntimeStatus(),
    databaseStatus: databaseConfigured
      ? await loadDatabaseSchemaStatus({
          databaseUrl: process.env.DATABASE_URL
        })
      : null,
    asyncExecution: await getAsyncExecutionCheckSnapshot(nodeEnv),
    connectorHealth: await getConnectorHealthCheckSnapshot(nodeEnv)
  });
}
