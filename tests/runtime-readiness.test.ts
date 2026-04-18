import { buildWebReadinessReport } from "../apps/web/lib/runtime-readiness";
import type { AuthRuntimeStateStatus } from "../apps/web/lib/auth-runtime-state";
import type { DatabaseSchemaStatus } from "@agentic/db/schema-status";
import type { ReadinessCheck } from "../apps/web/lib/runtime-readiness";
import type { RequestIdentityRuntimeStatus } from "../apps/web/lib/request-client-identity";

function buildAuthRuntimeState(
  overrides?: Partial<AuthRuntimeStateStatus>
): AuthRuntimeStateStatus {
  return {
    production: false,
    requiresSharedState: false,
    sessionStateScope: "process-local",
    unlockStateScope: "process-local",
    sharedStateConfigured: false,
    allowsProcessLocalStateException: false,
    warnings: [
      "Session revocation and rate limiting are still process-local.",
      "Session unlock throttling is still process-local."
    ],
    ...overrides
  };
}

function buildAsyncExecutionCheck(overrides?: Partial<Omit<ReadinessCheck, "name">>): Omit<ReadinessCheck, "name"> {
  return {
    status: "pass",
    message: "Async execution backlog checks passed.",
    details: {
      queuedJobs: 0,
      retryingJobs: 0,
      runningJobs: 0,
      deadLetterJobs: 0,
      expiredLeases: 0,
      stalePendingJobs: 0,
      oldestPendingJobAgeSeconds: null,
      maxPendingJobAgeSeconds: 900
    },
    ...overrides
  };
}

function buildRequestIdentityStatus(
  overrides?: Partial<RequestIdentityRuntimeStatus>
): RequestIdentityRuntimeStatus {
  return {
    production: false,
    trustProxyHeaders: false,
    identitySource: "request-fingerprint",
    warnings: [
      "Trusted proxy headers are disabled, so rate limits and abuse controls fall back to a coarse request fingerprint."
    ],
    ...overrides
  };
}

function buildDatabaseStatus(
  overrides?: Partial<DatabaseSchemaStatus>
): DatabaseSchemaStatus {
  return {
    reachable: true,
    ready: true,
    failureReason: null,
    missingMetadataTable: false,
    appliedMigrations: ["0001_init.sql"],
    pendingMigrations: [],
    driftedMigrations: [],
    lastAppliedAt: "2026-04-17T00:00:00.000Z",
    ...overrides
  };
}

describe("runtime readiness", () => {
  it("fails closed in production when the access key, database, and shared auth state are not ready", () => {
    const report = buildWebReadinessReport({
      nodeEnv: "production",
      databaseConfigured: false,
      authMode: {
        requiresConfiguredKey: true,
        usesDevelopmentFallback: false,
        configured: false
      },
      authRuntimeState: buildAuthRuntimeState({
        production: true,
        requiresSharedState: true
      }),
      requestIdentity: buildRequestIdentityStatus({
        production: true
      }),
      asyncExecution: buildAsyncExecutionCheck({
        status: "fail",
        message: "Async execution requires attention: 1 stale pending job(s)."
      }),
      databaseStatus: null,
      generatedAt: "2026-04-17T00:00:00.000Z"
    });

    expect(report).toMatchObject({
      ok: false,
      status: "not_ready",
      runtime: "production",
      storageBackend: "file"
    });
    expect(report.checks).toEqual([
      expect.objectContaining({
        name: "access_key",
        status: "fail"
      }),
      expect.objectContaining({
        name: "database",
        status: "fail"
      }),
      expect.objectContaining({
        name: "auth_runtime_state",
        status: "fail"
      }),
      expect.objectContaining({
        name: "request_identity",
        status: "fail"
      }),
      expect.objectContaining({
        name: "async_execution",
        status: "fail"
      })
    ]);
  });

  it("permits non-production startup with explicit warnings", () => {
    const report = buildWebReadinessReport({
      nodeEnv: "development",
      databaseConfigured: false,
      authMode: {
        requiresConfiguredKey: false,
        usesDevelopmentFallback: true,
        configured: true
      },
      authRuntimeState: buildAuthRuntimeState(),
      requestIdentity: buildRequestIdentityStatus(),
      asyncExecution: buildAsyncExecutionCheck(),
      databaseStatus: null,
      generatedAt: "2026-04-17T00:00:00.000Z"
    });

    expect(report).toMatchObject({
      ok: true,
      status: "ready",
      runtime: "development",
      storageBackend: "file"
    });
    expect(report.checks).toEqual([
      expect.objectContaining({
        name: "access_key",
        status: "warn"
      }),
      expect.objectContaining({
        name: "database",
        status: "warn"
      }),
      expect.objectContaining({
        name: "auth_runtime_state",
        status: "pass"
      }),
      expect.objectContaining({
        name: "request_identity",
        status: "pass"
      }),
      expect.objectContaining({
        name: "async_execution",
        status: "pass"
      })
    ]);
  });

  it("reports ready when production dependencies are fully configured", () => {
    const report = buildWebReadinessReport({
      nodeEnv: "production",
      databaseConfigured: true,
      authMode: {
        requiresConfiguredKey: false,
        usesDevelopmentFallback: false,
        configured: true
      },
      authRuntimeState: buildAuthRuntimeState({
        production: true,
        requiresSharedState: true,
        sessionStateScope: "shared",
        unlockStateScope: "shared",
        sharedStateConfigured: true,
        allowsProcessLocalStateException: false,
        warnings: []
      }),
      requestIdentity: buildRequestIdentityStatus({
        production: true,
        trustProxyHeaders: true,
        identitySource: "trusted-ip",
        warnings: []
      }),
      asyncExecution: buildAsyncExecutionCheck(),
      databaseStatus: buildDatabaseStatus(),
      generatedAt: "2026-04-17T00:00:00.000Z"
    });

    expect(report).toMatchObject({
      ok: true,
      status: "ready",
      runtime: "production",
      storageBackend: "postgres"
    });
    expect(report.checks.every((check) => check.status === "pass")).toBe(true);
  });

  it("fails readiness when migrations are still pending", () => {
    const report = buildWebReadinessReport({
      nodeEnv: "production",
      databaseConfigured: true,
      authMode: {
        requiresConfiguredKey: false,
        usesDevelopmentFallback: false,
        configured: true
      },
      authRuntimeState: buildAuthRuntimeState({
        production: true,
        sessionStateScope: "shared",
        unlockStateScope: "shared",
        sharedStateConfigured: true,
        allowsProcessLocalStateException: false,
        warnings: []
      }),
      requestIdentity: buildRequestIdentityStatus({
        production: true,
        trustProxyHeaders: true,
        identitySource: "trusted-ip",
        warnings: []
      }),
      asyncExecution: buildAsyncExecutionCheck(),
      databaseStatus: buildDatabaseStatus({
        ready: false,
        failureReason: "pending_migrations",
        pendingMigrations: ["0002_add_indexes.sql"]
      }),
      generatedAt: "2026-04-17T00:00:00.000Z"
    });

    expect(report.ok).toBe(false);
    expect(report.status).toBe("not_ready");
    expect(report.checks).toContainEqual(
      expect.objectContaining({
        name: "database",
        status: "fail",
        details: expect.objectContaining({
          pendingMigrations: 1
        })
      })
    );
  });

  it("fails readiness when async execution has dead-lettered work", () => {
    const report = buildWebReadinessReport({
      nodeEnv: "production",
      databaseConfigured: true,
      authMode: {
        requiresConfiguredKey: false,
        usesDevelopmentFallback: false,
        configured: true
      },
      authRuntimeState: buildAuthRuntimeState({
        production: true,
        requiresSharedState: true,
        sessionStateScope: "shared",
        unlockStateScope: "shared",
        sharedStateConfigured: true,
        allowsProcessLocalStateException: false,
        warnings: []
      }),
      requestIdentity: buildRequestIdentityStatus({
        production: true,
        trustProxyHeaders: true,
        identitySource: "trusted-ip",
        warnings: []
      }),
      asyncExecution: buildAsyncExecutionCheck({
        status: "fail",
        message: "Async execution requires attention: 1 dead-letter job(s).",
        details: {
          queuedJobs: 0,
          retryingJobs: 0,
          runningJobs: 0,
          deadLetterJobs: 1,
          expiredLeases: 0,
          stalePendingJobs: 0,
          oldestPendingJobAgeSeconds: null,
          maxPendingJobAgeSeconds: 900
        }
      }),
      databaseStatus: buildDatabaseStatus(),
      generatedAt: "2026-04-17T00:00:00.000Z"
    });

    expect(report.ok).toBe(false);
    expect(report.checks).toContainEqual(
      expect.objectContaining({
        name: "async_execution",
        status: "fail",
        details: expect.objectContaining({
          deadLetterJobs: 1
        })
      })
    );
  });

  it("fails readiness in production when request identity still falls back to fingerprints", () => {
    const report = buildWebReadinessReport({
      nodeEnv: "production",
      databaseConfigured: true,
      authMode: {
        requiresConfiguredKey: false,
        usesDevelopmentFallback: false,
        configured: true
      },
      authRuntimeState: buildAuthRuntimeState({
        production: true,
        requiresSharedState: true,
        sessionStateScope: "shared",
        unlockStateScope: "shared",
        sharedStateConfigured: true,
        allowsProcessLocalStateException: false,
        warnings: []
      }),
      requestIdentity: buildRequestIdentityStatus({
        production: true,
        trustProxyHeaders: false,
        identitySource: "request-fingerprint"
      }),
      asyncExecution: buildAsyncExecutionCheck(),
      databaseStatus: buildDatabaseStatus(),
      generatedAt: "2026-04-17T00:00:00.000Z"
    });

    expect(report.ok).toBe(false);
    expect(report.checks).toContainEqual(
      expect.objectContaining({
        name: "request_identity",
        status: "fail",
        details: expect.objectContaining({
          identitySource: "request-fingerprint",
          trustProxyHeaders: false
        })
      })
    );
  });
});
