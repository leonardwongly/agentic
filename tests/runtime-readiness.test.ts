import { buildWebReadinessReport } from "../apps/web/lib/runtime-readiness";
import type { AuthRuntimeStateStatus } from "../apps/web/lib/auth-runtime-state";
import type { DatabaseSchemaStatus } from "@agentic/db";

function buildAuthRuntimeState(
  overrides?: Partial<AuthRuntimeStateStatus>
): AuthRuntimeStateStatus {
  return {
    production: false,
    requiresSharedState: false,
    sessionStateScope: "process-local",
    unlockStateScope: "process-local",
    sharedStateConfigured: false,
    warnings: [
      "Session revocation and rate limiting are still process-local.",
      "Session unlock throttling is still process-local."
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
        warnings: []
      }),
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
        warnings: []
      }),
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
});
