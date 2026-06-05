import {
  createRepository,
  type AgenticRepository,
  type JobReadinessSummary,
  type ProviderCredentialReadinessSummary
} from "@agentic/repository";
import type { ProviderCredential } from "@agentic/contracts";
import { logWarn, recordHistogram } from "@agentic/observability";
import {
  resolveWorkerConcurrencyPolicy,
  readFileWorkerRuntimeHealthSnapshot,
  type WorkerConcurrencyPolicy,
  type WorkerRuntimeHealthSnapshot
} from "@agentic/worker-runtime";
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
    | "worker_concurrency"
    | "worker_heartbeat"
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

export type PublicWebReadinessSummary = {
  ok: boolean;
  status: WebReadinessReport["status"];
  generatedAt: string;
  details: "/api/ready/details";
};

type AuthModeSnapshot = ReturnType<typeof getAuthMode>;
type AsyncExecutionCheckSnapshot = Omit<ReadinessCheck, "name">;
type ConnectorHealthCheckSnapshot = Omit<ReadinessCheck, "name">;
type WorkerConcurrencyCheckSnapshot = Omit<ReadinessCheck, "name">;
type WorkerHeartbeatCheckSnapshot = Omit<ReadinessCheck, "name">;

type ReadinessEvaluationParams = {
  generatedAt?: string;
  nodeEnv?: string;
  databaseConfigured: boolean;
  authMode: AuthModeSnapshot;
  authRuntimeState: AuthRuntimeStateStatus;
  requestIdentity: RequestIdentityRuntimeStatus;
  databaseStatus: DatabaseSchemaStatus | null;
  asyncExecution: AsyncExecutionCheckSnapshot;
  workerConcurrency?: WorkerConcurrencyCheckSnapshot;
  workerHeartbeat?: WorkerHeartbeatCheckSnapshot;
  connectorHealth: ConnectorHealthCheckSnapshot;
};

const DEFAULT_MAX_PENDING_JOB_AGE_MS = 15 * 60 * 1000;
const DEFAULT_PROVIDER_VALIDATION_STALE_MS = 7 * 24 * 60 * 60 * 1000;
const DEFAULT_WORKER_HEARTBEAT_STALE_MS = 2 * 60 * 1000;
const DEFAULT_PUBLIC_READINESS_CACHE_TTL_MS = 5_000;
const READINESS_WARNING_DURATION_MS = 250;
let readinessRepository: AgenticRepository | null = null;
let publicReadinessCache: {
  summary: PublicWebReadinessSummary;
  expiresAtMs: number;
} | null = null;

function getReadinessRepository(): AgenticRepository {
  if (readinessRepository) {
    return readinessRepository;
  }

  readinessRepository = createRepository();
  return readinessRepository;
}

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

  if (runtime === "production" && params.requestIdentity.identitySource !== "trusted-ip") {
    return {
      name: "request_identity",
      status: "fail",
      message:
        "Trusted proxy headers and a canonical client-IP header must be configured in production so abuse controls can key off canonical client IPs.",
      details: {
        identitySource: params.requestIdentity.identitySource,
        trustProxyHeaders: params.requestIdentity.trustProxyHeaders,
        trustedClientIpHeader: params.requestIdentity.trustedClientIpHeader
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
        trustedClientIpHeader: params.requestIdentity.trustedClientIpHeader,
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
      trustProxyHeaders: params.requestIdentity.trustProxyHeaders,
      trustedClientIpHeader: params.requestIdentity.trustedClientIpHeader
    }
  };
}

function buildAsyncExecutionCheck(params: ReadinessEvaluationParams): ReadinessCheck {
  return {
    name: "async_execution",
    ...params.asyncExecution
  };
}

function buildWorkerConcurrencyCheck(params: ReadinessEvaluationParams): ReadinessCheck {
  return {
    name: "worker_concurrency",
    ...(params.workerConcurrency ?? buildWorkerConcurrencyCheckSnapshot(resolveWorkerConcurrencyPolicy({
      nodeEnv: params.nodeEnv
    })))
  };
}

function buildWorkerHeartbeatCheck(params: ReadinessEvaluationParams): ReadinessCheck {
  return {
    name: "worker_heartbeat",
    ...(params.workerHeartbeat ?? buildMissingWorkerHeartbeatCheck(normalizeRuntime(params.nodeEnv)))
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

function getWorkerHeartbeatFailureStatus(runtime: WebReadinessReport["runtime"]): ReadinessCheck["status"] {
  return runtime === "production" ? "fail" : "warn";
}

function buildMissingWorkerHeartbeatCheck(runtime: WebReadinessReport["runtime"]): WorkerHeartbeatCheckSnapshot {
  return {
    status: getWorkerHeartbeatFailureStatus(runtime),
    message:
      runtime === "production"
        ? "Worker heartbeat is not configured; set AGENTIC_WORKER_HEALTH_PATH so readiness can verify the worker process."
        : "Worker heartbeat is not configured; readiness is using durable queue state only.",
    details: {
      configured: false
    }
  };
}

function buildWorkerConcurrencyDetails(policy: WorkerConcurrencyPolicy): ReadinessCheck["details"] {
  return {
    constrained: policy.constrained,
    source: policy.source,
    explicitlyConfigured: policy.explicitlyConfigured,
    maxRunningPerKind: policy.limits?.maxRunningPerKind ?? null,
    maxRunningPerUser: policy.limits?.maxRunningPerUser ?? null,
    maxRunningPerConcurrencyKey: policy.limits?.maxRunningPerConcurrencyKey ?? null
  };
}

export function buildWorkerConcurrencyCheckSnapshot(
  policy: WorkerConcurrencyPolicy
): WorkerConcurrencyCheckSnapshot {
  if (!policy.constrained) {
    return {
      status: "pass",
      message: "Worker concurrency is unconstrained for non-production startup.",
      details: buildWorkerConcurrencyDetails(policy)
    };
  }

  return {
    status: "pass",
    message:
      policy.source === "production-defaults"
        ? "Worker concurrency uses production-safe default limits."
        : "Worker concurrency limits are explicitly configured.",
    details: buildWorkerConcurrencyDetails(policy)
  };
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

export function buildConnectorHealthCheckSnapshotFromSummary(params: {
  summary: ProviderCredentialReadinessSummary;
  runtime: WebReadinessReport["runtime"];
}): ConnectorHealthCheckSnapshot {
  const details = {
    ...params.summary,
    validationStaleAfterHours: Math.floor(DEFAULT_PROVIDER_VALIDATION_STALE_MS / (60 * 60 * 1000))
  };

  if (params.summary.totalCredentials === 0) {
    return {
      status: "pass",
      message: "No provider credentials are configured, so connector-health checks are idle.",
      details
    };
  }

  const criticalIssues: string[] = [];

  if (params.summary.reconnectRequiredCredentials > 0) {
    criticalIssues.push(
      formatCountLabel(
        params.summary.reconnectRequiredCredentials,
        "credential requires re-authentication",
        "credentials require re-authentication"
      )
    );
  }

  if (params.summary.revokedCredentials > 0) {
    criticalIssues.push(formatCountLabel(params.summary.revokedCredentials, "credential was revoked", "credentials were revoked"));
  }

  if (params.summary.expiredCredentials > 0) {
    criticalIssues.push(formatCountLabel(params.summary.expiredCredentials, "credential is expired", "credentials are expired"));
  }

  if (criticalIssues.length > 0) {
    return {
      status: getConnectorHealthFailureStatus(params.runtime),
      message: `Connector health requires attention: ${criticalIssues.join(", ")}.`,
      details
    };
  }

  const warnings: string[] = [];

  if (params.summary.refreshFailedCredentials > 0) {
    warnings.push(
      formatCountLabel(
        params.summary.refreshFailedCredentials,
        "credential refresh failed recently",
        "credentials refresh failed recently"
      )
    );
  }

  if (params.summary.validationStaleCredentials > 0) {
    warnings.push(
      formatCountLabel(
        params.summary.validationStaleCredentials,
        "credential validation is stale",
        "credentials validation is stale"
      )
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
    const repository = getReadinessRepository();
    const summary = await repository.getProviderCredentialReadinessSummary({
      validationStaleMs: DEFAULT_PROVIDER_VALIDATION_STALE_MS
    });
    return buildConnectorHealthCheckSnapshotFromSummary({
      summary,
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

export function buildAsyncExecutionCheckSnapshotFromSummary(params: {
  summary: JobReadinessSummary;
  runtime: WebReadinessReport["runtime"];
  maxPendingJobAgeMs?: number;
}): AsyncExecutionCheckSnapshot {
  const maxPendingJobAgeMs = params.maxPendingJobAgeMs ?? DEFAULT_MAX_PENDING_JOB_AGE_MS;
  const details = {
    queuedJobs: params.summary.queuedJobs,
    retryingJobs: params.summary.retryingJobs,
    runningJobs: params.summary.runningJobs,
    deadLetterJobs: params.summary.deadLetterJobs,
    expiredLeases: params.summary.expiredLeases,
    stalePendingJobs: params.summary.stalePendingJobs,
    oldestPendingJobAgeSeconds:
      params.summary.oldestPendingJobAgeMs === null ? null : Math.floor(params.summary.oldestPendingJobAgeMs / 1000),
    maxPendingJobAgeSeconds: Math.floor(maxPendingJobAgeMs / 1000)
  };

  if (params.summary.deadLetterJobs > 0 || params.summary.expiredLeases > 0 || params.summary.stalePendingJobs > 0) {
    const issues: string[] = [];

    if (params.summary.deadLetterJobs > 0) {
      issues.push(`${params.summary.deadLetterJobs} dead-letter job(s)`);
    }

    if (params.summary.expiredLeases > 0) {
      issues.push(`${params.summary.expiredLeases} expired worker lease(s)`);
    }

    if (params.summary.stalePendingJobs > 0) {
      issues.push(`${params.summary.stalePendingJobs} stale pending job(s)`);
    }

    return {
      status: getAsyncExecutionFailureStatus(params.runtime),
      message: `Async execution requires attention: ${issues.join(", ")}.`,
      details
    };
  }

  return {
    status: "pass",
    message: "Async execution backlog checks passed.",
    details
  };
}

async function getAsyncExecutionCheckSnapshot(nodeEnv: string | undefined): Promise<AsyncExecutionCheckSnapshot> {
  const runtime = normalizeRuntime(nodeEnv);
  const maxPendingJobAgeMs = getMaxPendingJobAgeMs();

  try {
    const repository = getReadinessRepository();
    const summary = await repository.getJobReadinessSummary({
      maxPendingJobAgeMs,
      now: new Date().toISOString()
    });
    return buildAsyncExecutionCheckSnapshotFromSummary({
      summary,
      runtime,
      maxPendingJobAgeMs
    });
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

function getWorkerHeartbeatStaleMs(): number {
  const configured = Number.parseInt(process.env.AGENTIC_READY_WORKER_HEARTBEAT_STALE_MS ?? "", 10);

  if (Number.isFinite(configured) && configured > 0) {
    return configured;
  }

  return DEFAULT_WORKER_HEARTBEAT_STALE_MS;
}

function buildWorkerHeartbeatDetails(params: {
  heartbeat: WorkerRuntimeHealthSnapshot;
  ageMs: number;
  staleAfterMs: number;
}) {
  return {
    configured: true,
    runnerId: params.heartbeat.runnerId,
    status: params.heartbeat.status,
    pid: params.heartbeat.pid,
    ageSeconds: Number.isFinite(params.ageMs) ? Math.floor(params.ageMs / 1000) : null,
    staleAfterSeconds: Math.floor(params.staleAfterMs / 1000),
    processedCount: params.heartbeat.processedCount,
    schedulerEnabled: params.heartbeat.scheduler.enabled,
    schedulerLastDecisionCount: params.heartbeat.scheduler.lastDecisionCount
  };
}

async function getWorkerHeartbeatCheckSnapshot(nodeEnv: string | undefined): Promise<WorkerHeartbeatCheckSnapshot> {
  const runtime = normalizeRuntime(nodeEnv);
  const healthPath = process.env.AGENTIC_WORKER_HEALTH_PATH?.trim();

  if (!healthPath) {
    return buildMissingWorkerHeartbeatCheck(runtime);
  }

  try {
    const heartbeat = await readFileWorkerRuntimeHealthSnapshot(healthPath);

    if (!heartbeat) {
      return {
        status: getWorkerHeartbeatFailureStatus(runtime),
        message: "Worker heartbeat could not be loaded.",
        details: {
          configured: true
        }
      };
    }

    const updatedAt = Date.parse(heartbeat.updatedAt);
    const staleAfterMs = getWorkerHeartbeatStaleMs();
    const ageMs = Number.isFinite(updatedAt) ? Math.max(0, Date.now() - updatedAt) : Number.POSITIVE_INFINITY;
    const details = buildWorkerHeartbeatDetails({
      heartbeat,
      ageMs,
      staleAfterMs
    });

    if (heartbeat.status === "error") {
      return {
        status: getWorkerHeartbeatFailureStatus(runtime),
        message: "Worker heartbeat reports an error state.",
        details
      };
    }

    if (!Number.isFinite(ageMs) || ageMs > staleAfterMs) {
      return {
        status: getWorkerHeartbeatFailureStatus(runtime),
        message: "Worker heartbeat is stale.",
        details
      };
    }

    return {
      status: "pass",
      message: "Worker heartbeat is fresh.",
      details
    };
  } catch (error) {
    return {
      status: getWorkerHeartbeatFailureStatus(runtime),
      message: "Worker heartbeat readiness checks could not be completed.",
      details: {
        configured: true,
        error: error instanceof Error ? error.message : "Unknown readiness failure"
      }
    };
  }
}

function toPublicReadinessSummary(report: WebReadinessReport): PublicWebReadinessSummary {
  return {
    ok: report.ok,
    status: report.status,
    generatedAt: report.generatedAt,
    details: "/api/ready/details"
  };
}

async function measureReadiness<T>(mode: "public" | "details", callback: () => Promise<T>): Promise<T> {
  const startedAt = Date.now();

  try {
    return await callback();
  } finally {
    const durationMs = Date.now() - startedAt;
    recordHistogram("web.readiness.duration_ms", durationMs, {
      mode
    });

    if (durationMs > READINESS_WARNING_DURATION_MS) {
      logWarn("web.readiness.slow_probe", {
        mode,
        durationMs,
        warningThresholdMs: READINESS_WARNING_DURATION_MS
      });
    }
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
    buildWorkerConcurrencyCheck(params),
    buildWorkerHeartbeatCheck(params),
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

export function resetPublicWebReadinessCacheForTests() {
  publicReadinessCache = null;
}

export async function getPublicWebReadinessSummary(options?: {
  now?: number;
  ttlMs?: number;
}): Promise<PublicWebReadinessSummary> {
  const now = options?.now ?? Date.now();
  const ttlMs = options?.ttlMs ?? DEFAULT_PUBLIC_READINESS_CACHE_TTL_MS;

  if (publicReadinessCache && publicReadinessCache.expiresAtMs > now) {
    return publicReadinessCache.summary;
  }

  try {
    const summary = await measureReadiness("public", async () => toPublicReadinessSummary(await getWebReadinessReport()));
    if (publicReadinessCache && !publicReadinessCache.summary.ok && !summary.ok) {
      publicReadinessCache = {
        summary: publicReadinessCache.summary,
        expiresAtMs: now + ttlMs
      };
      return publicReadinessCache.summary;
    }

    publicReadinessCache = {
      summary,
      expiresAtMs: now + ttlMs
    };
    return summary;
  } catch (error) {
    if (publicReadinessCache && !publicReadinessCache.summary.ok) {
      logWarn("web.readiness.stale_not_ready_snapshot", {
        error: error instanceof Error ? error.message : "Unknown readiness refresh failure"
      });
      return publicReadinessCache.summary;
    }

    const summary: PublicWebReadinessSummary = {
      ok: false,
      status: "not_ready",
      generatedAt: new Date(now).toISOString(),
      details: "/api/ready/details"
    };
    publicReadinessCache = {
      summary,
      expiresAtMs: now + ttlMs
    };
    return summary;
  }
}

export async function getWebReadinessReport(): Promise<WebReadinessReport> {
  const databaseConfigured = Boolean(process.env.DATABASE_URL?.trim());
  const nodeEnv = process.env.NODE_ENV;

  return measureReadiness("details", async () =>
    buildWebReadinessReport({
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
      workerConcurrency: buildWorkerConcurrencyCheckSnapshot(
        resolveWorkerConcurrencyPolicy({
          nodeEnv
        })
      ),
      workerHeartbeat: await getWorkerHeartbeatCheckSnapshot(nodeEnv),
      connectorHealth: await getConnectorHealthCheckSnapshot(nodeEnv)
    })
  );
}
