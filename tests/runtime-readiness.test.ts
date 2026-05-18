import { buildConnectorHealthCheckSnapshot, buildWebReadinessReport } from "../apps/web/lib/runtime-readiness";
import type { AuthRuntimeStateStatus } from "../apps/web/lib/auth-runtime-state";
import type { DatabaseSchemaStatus } from "@agentic/db/schema-status";
import type { ReadinessCheck } from "../apps/web/lib/runtime-readiness";
import type { RequestIdentityRuntimeStatus } from "../apps/web/lib/request-client-identity";
import type { ProviderCredential } from "@agentic/contracts";

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

function buildWorkerHeartbeatCheck(overrides?: Partial<Omit<ReadinessCheck, "name">>): Omit<ReadinessCheck, "name"> {
  return {
    status: "pass",
    message: "Worker heartbeat is fresh.",
    details: {
      configured: true,
      status: "running",
      ageSeconds: 5,
      staleAfterSeconds: 120,
      processedCount: 3,
      schedulerEnabled: true
    },
    ...overrides
  };
}

function buildConnectorHealthCheck(overrides?: Partial<Omit<ReadinessCheck, "name">>): Omit<ReadinessCheck, "name"> {
  return {
    status: "pass",
    message: "Connector health checks passed.",
    details: {
      totalCredentials: 0,
      connectedCredentials: 0,
      degradedCredentials: 0,
      reconnectRequiredCredentials: 0,
      refreshFailedCredentials: 0,
      revokedCredentials: 0,
      expiredCredentials: 0,
      validationStaleCredentials: 0,
      validationStaleAfterHours: 168
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
    trustedClientIpHeader: null,
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
    requiredSchemaObjects: {
      tables: ["auth_session_rate_limits", "auth_revoked_sessions", "session_unlock_attempts"],
      indexes: [
        "auth_session_rate_limits_updated_at_idx",
        "auth_revoked_sessions_expires_at_idx",
        "session_unlock_attempts_last_seen_at_idx"
      ],
      missingTables: [],
      missingIndexes: []
    },
    lastAppliedAt: "2026-04-17T00:00:00.000Z",
    ...overrides
  };
}

function buildProviderCredential(overrides?: Partial<ProviderCredential>): ProviderCredential {
  return {
    id: "google:global:acct-123",
    userId: "user-primary",
    workspaceId: null,
    provider: "google",
    accountId: "acct-123",
    accountEmail: "owner@example.com",
    displayName: "Owner",
    status: "connected",
    scopes: ["calendar.read"],
    lastValidatedAt: "2026-04-17T00:00:00.000Z",
    lastRotatedAt: null,
    lastRefreshAt: null,
    lastRefreshFailureAt: null,
    reconnectRequiredAt: null,
    revokedAt: null,
    expiresAt: null,
    metadata: {},
    actorContext: null,
    createdAt: "2026-04-17T00:00:00.000Z",
    updatedAt: "2026-04-17T00:00:00.000Z",
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
      connectorHealth: buildConnectorHealthCheck(),
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
      }),
      expect.objectContaining({
        name: "worker_heartbeat",
        status: "fail"
      }),
      expect.objectContaining({
        name: "connector_health",
        status: "pass"
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
      connectorHealth: buildConnectorHealthCheck(),
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
      }),
      expect.objectContaining({
        name: "worker_heartbeat",
        status: "warn"
      }),
      expect.objectContaining({
        name: "connector_health",
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
        trustedClientIpHeader: "x-forwarded-for",
        identitySource: "trusted-ip",
        warnings: []
      }),
      asyncExecution: buildAsyncExecutionCheck(),
      workerHeartbeat: buildWorkerHeartbeatCheck(),
      connectorHealth: buildConnectorHealthCheck(),
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
        trustedClientIpHeader: "x-forwarded-for",
        identitySource: "trusted-ip",
        warnings: []
      }),
      asyncExecution: buildAsyncExecutionCheck(),
      connectorHealth: buildConnectorHealthCheck(),
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

  it("fails readiness when shared auth runtime schema objects are missing", () => {
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
        trustedClientIpHeader: "x-forwarded-for",
        identitySource: "trusted-ip",
        warnings: []
      }),
      asyncExecution: buildAsyncExecutionCheck(),
      connectorHealth: buildConnectorHealthCheck(),
      databaseStatus: buildDatabaseStatus({
        ready: false,
        failureReason: "required_schema_missing",
        requiredSchemaObjects: {
          tables: ["auth_session_rate_limits", "auth_revoked_sessions", "session_unlock_attempts"],
          indexes: [
            "auth_session_rate_limits_updated_at_idx",
            "auth_revoked_sessions_expires_at_idx",
            "session_unlock_attempts_last_seen_at_idx"
          ],
          missingTables: ["auth_revoked_sessions"],
          missingIndexes: ["auth_revoked_sessions_expires_at_idx"]
        }
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
          missingAuthRuntimeTables: 1,
          missingAuthRuntimeIndexes: 1
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
        trustedClientIpHeader: "x-forwarded-for",
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
      connectorHealth: buildConnectorHealthCheck(),
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

  it("fails readiness in production when worker heartbeat is not configured", () => {
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
        trustedClientIpHeader: "x-forwarded-for",
        identitySource: "trusted-ip",
        warnings: []
      }),
      asyncExecution: buildAsyncExecutionCheck(),
      connectorHealth: buildConnectorHealthCheck(),
      databaseStatus: buildDatabaseStatus(),
      generatedAt: "2026-04-17T00:00:00.000Z"
    });

    expect(report.ok).toBe(false);
    expect(report.checks).toContainEqual(
      expect.objectContaining({
        name: "worker_heartbeat",
        status: "fail",
        message: expect.stringContaining("AGENTIC_WORKER_HEALTH_PATH"),
        details: {
          configured: false
        }
      })
    );
  });

  it("fails readiness in production when a configured worker heartbeat is stale", () => {
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
        trustedClientIpHeader: "x-forwarded-for",
        identitySource: "trusted-ip",
        warnings: []
      }),
      asyncExecution: buildAsyncExecutionCheck(),
      workerHeartbeat: {
        status: "fail",
        message: "Worker heartbeat is stale.",
        details: {
          configured: true,
          status: "running",
          ageSeconds: 300,
          staleAfterSeconds: 120,
          processedCount: 2,
          schedulerEnabled: true
        }
      },
      connectorHealth: buildConnectorHealthCheck(),
      databaseStatus: buildDatabaseStatus(),
      generatedAt: "2026-04-17T00:00:00.000Z"
    });

    expect(report.ok).toBe(false);
    expect(report.checks).toContainEqual(
      expect.objectContaining({
        name: "worker_heartbeat",
        status: "fail",
        details: expect.objectContaining({
          configured: true,
          schedulerEnabled: true
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
      connectorHealth: buildConnectorHealthCheck(),
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
          trustProxyHeaders: false,
          trustedClientIpHeader: null
        })
      })
    );
  });

  it("fails readiness in production when proxy trust lacks a canonical client IP header", () => {
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
        trustedClientIpHeader: null,
        identitySource: "request-fingerprint",
        warnings: [
          "Trusted proxy headers are enabled, but AGENTIC_TRUSTED_CLIENT_IP_HEADER must name one canonical client-IP header."
        ]
      }),
      asyncExecution: buildAsyncExecutionCheck(),
      connectorHealth: buildConnectorHealthCheck(),
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
          trustProxyHeaders: true,
          trustedClientIpHeader: null
        })
      })
    );
  });

  it("warns in production when connector validation or refresh health is degraded", () => {
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
        trustedClientIpHeader: "x-forwarded-for",
        identitySource: "trusted-ip",
        warnings: []
      }),
      asyncExecution: buildAsyncExecutionCheck(),
      workerHeartbeat: buildWorkerHeartbeatCheck(),
      connectorHealth: buildConnectorHealthCheck({
        status: "warn",
        message: "Connector health is degraded: 1 credential refresh failed recently, 1 credential validation is stale.",
        details: {
          totalCredentials: 2,
          connectedCredentials: 1,
          degradedCredentials: 2,
          reconnectRequiredCredentials: 0,
          refreshFailedCredentials: 1,
          revokedCredentials: 0,
          expiredCredentials: 0,
          validationStaleCredentials: 1,
          validationStaleAfterHours: 168
        }
      }),
      databaseStatus: buildDatabaseStatus(),
      generatedAt: "2026-04-17T00:00:00.000Z"
    });

    expect(report.ok).toBe(true);
    expect(report.status).toBe("ready");
    expect(report.checks).toContainEqual(
      expect.objectContaining({
        name: "connector_health",
        status: "warn",
        details: expect.objectContaining({
          refreshFailedCredentials: 1,
          validationStaleCredentials: 1
        })
      })
    );
  });

  it("fails readiness in production when connector access is blocked", () => {
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
        trustedClientIpHeader: "x-forwarded-for",
        identitySource: "trusted-ip",
        warnings: []
      }),
      asyncExecution: buildAsyncExecutionCheck(),
      connectorHealth: buildConnectorHealthCheck({
        status: "fail",
        message: "Connector health requires attention: 1 credential requires re-authentication, 1 credential is expired.",
        details: {
          totalCredentials: 2,
          connectedCredentials: 1,
          degradedCredentials: 2,
          reconnectRequiredCredentials: 1,
          refreshFailedCredentials: 0,
          revokedCredentials: 0,
          expiredCredentials: 1,
          validationStaleCredentials: 0,
          validationStaleAfterHours: 168
        }
      }),
      databaseStatus: buildDatabaseStatus(),
      generatedAt: "2026-04-17T00:00:00.000Z"
    });

    expect(report.ok).toBe(false);
    expect(report.status).toBe("not_ready");
    expect(report.checks).toContainEqual(
      expect.objectContaining({
        name: "connector_health",
        status: "fail",
        details: expect.objectContaining({
          reconnectRequiredCredentials: 1,
          expiredCredentials: 1
        })
      })
    );
  });

  it("classifies connector health snapshots without exposing credential identities", () => {
    const snapshot = buildConnectorHealthCheckSnapshot({
      runtime: "production",
      now: Date.parse("2026-04-18T00:00:00.000Z"),
      credentials: [
        buildProviderCredential({
          id: "cred-stale",
          lastValidatedAt: "2026-04-09T00:00:00.000Z"
        }),
        buildProviderCredential({
          id: "cred-refresh-failed",
          status: "refresh_failed"
        }),
        buildProviderCredential({
          id: "cred-reconnect",
          status: "reconnect_required"
        }),
        buildProviderCredential({
          id: "cred-expired",
          expiresAt: "2026-04-17T23:59:59.000Z"
        })
      ]
    });

    expect(snapshot.status).toBe("fail");
    expect(snapshot.message).toBe(
      "Connector health requires attention: 1 credential requires re-authentication, 1 credential is expired."
    );
    expect(snapshot.details).toEqual({
      totalCredentials: 4,
      connectedCredentials: 2,
      degradedCredentials: 4,
      reconnectRequiredCredentials: 1,
      refreshFailedCredentials: 1,
      revokedCredentials: 0,
      expiredCredentials: 1,
      validationStaleCredentials: 1,
      validationStaleAfterHours: 168
    });
  });
});
