import { describe, expect, it } from "vitest";
import type { DatabaseSchemaStatus } from "@agentic/db/migration-runtime";
import { validateProductionBootstrap } from "../scripts/lib/production-bootstrap-check";

const BASE_ENV = {
  NODE_ENV: "production",
  AGENTIC_BOOTSTRAP_TARGET_NAME: "render-production",
  DATABASE_URL: "postgres://agentic:secret@db.example.com:5432/agentic",
  AGENTIC_ACCESS_KEY: "production-access-key",
  AGENTIC_REQUIRE_SHARED_AUTH_STATE: "true",
  AGENTIC_TRUST_PROXY_HEADERS: "true",
  AGENTIC_TRUSTED_CLIENT_IP_HEADER: "x-forwarded-for",
  AGENTIC_WORKER_HEALTH_PATH: "/var/lib/agentic/worker-health.json"
};

function buildDatabaseStatus(overrides?: Partial<DatabaseSchemaStatus>): DatabaseSchemaStatus {
  return {
    reachable: true,
    ready: true,
    failureReason: null,
    missingMetadataTable: false,
    appliedMigrations: ["0001_init.sql", "0008_shared_auth_runtime_state.sql"],
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
    lastAppliedAt: "2026-05-18T00:00:00.000Z",
    ...overrides
  };
}

describe("production bootstrap check", () => {
  it("accepts production Postgres shared-auth bootstrap evidence without leaking secrets", () => {
    const report = validateProductionBootstrap({
      env: BASE_ENV,
      databaseStatus: buildDatabaseStatus()
    });

    expect(report.ok).toBe(true);
    expect(report.targetName).toBe("render-production");
    expect(report.storageBackend).toBe("postgres");
    expect(report.database).toMatchObject({
      checked: true,
      configured: true,
      ready: true,
      appliedMigrationCount: 2,
      pendingMigrations: [],
      missingRequiredTables: [],
      missingRequiredIndexes: []
    });
    expect(report.checks.map((check) => [check.name, check.status])).toEqual([
      ["runtime", "pass"],
      ["database_url", "pass"],
      ["database_schema", "pass"],
      ["shared_auth_state", "pass"],
      ["process_local_auth_exception", "pass"],
      ["access_key", "pass"],
      ["proxy_trust", "pass"],
      ["client_ip_header", "pass"],
      ["worker_concurrency", "pass"],
      ["worker_heartbeat", "pass"]
    ]);

    const serialized = JSON.stringify(report);
    expect(serialized).not.toContain("secret@");
    expect(serialized).not.toContain("production-access-key");
  });

  it("supports static-only preflight while making the missing live database proof explicit", () => {
    const report = validateProductionBootstrap({
      env: BASE_ENV,
      staticOnly: true
    });

    expect(report.ok).toBe(true);
    expect(report.staticOnly).toBe(true);
    expect(report.database).toMatchObject({
      checked: false,
      ready: null,
      failureReason: "not_checked"
    });
    expect(report.checks).toContainEqual(
      expect.objectContaining({
        name: "database_schema",
        status: "warn",
        message: expect.stringContaining("Live database schema check skipped")
      })
    );
  });

  it("fails closed when production would use file storage or process-local auth state", () => {
    const report = validateProductionBootstrap({
      env: {
        ...BASE_ENV,
        DATABASE_URL: "",
        AGENTIC_REQUIRE_SHARED_AUTH_STATE: "false",
        AGENTIC_ALLOW_PROCESS_LOCAL_AUTH_STATE: "true"
      }
    });

    expect(report.ok).toBe(false);
    expect(report.storageBackend).toBe("file");
    expect(report.checks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          name: "database_url",
          status: "fail"
        }),
        expect.objectContaining({
          name: "shared_auth_state",
          status: "fail"
        }),
        expect.objectContaining({
          name: "process_local_auth_exception",
          status: "fail"
        })
      ])
    );
  });

  it("fails when the target database has pending migrations or missing shared auth runtime objects", () => {
    const report = validateProductionBootstrap({
      env: BASE_ENV,
      databaseStatus: buildDatabaseStatus({
        ready: false,
        failureReason: "required_schema_missing",
        pendingMigrations: ["0009_next.sql"],
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
      })
    });

    expect(report.ok).toBe(false);
    expect(report.database).toMatchObject({
      checked: true,
      ready: false,
      failureReason: "required_schema_missing",
      pendingMigrations: ["0009_next.sql"],
      missingRequiredTables: ["auth_revoked_sessions"],
      missingRequiredIndexes: ["auth_revoked_sessions_expires_at_idx"]
    });
    expect(report.checks).toContainEqual(
      expect.objectContaining({
        name: "database_schema",
        status: "fail",
        details: expect.objectContaining({
          failureReason: "required_schema_missing"
        })
      })
    );
  });

  it("fails closed on missing production boundary controls", () => {
    const report = validateProductionBootstrap({
      env: {
        ...BASE_ENV,
        NODE_ENV: "development",
        AGENTIC_ACCESS_KEY: "",
        AGENTIC_TRUST_PROXY_HEADERS: "false",
        AGENTIC_TRUSTED_CLIENT_IP_HEADER: "x-client-ip",
        AGENTIC_WORKER_HEALTH_PATH: "worker-health.json"
      },
      databaseStatus: buildDatabaseStatus()
    });

    expect(report.ok).toBe(false);
    expect(report.checks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: "runtime", status: "fail" }),
        expect.objectContaining({ name: "access_key", status: "fail" }),
        expect.objectContaining({ name: "proxy_trust", status: "fail" }),
        expect.objectContaining({ name: "client_ip_header", status: "fail" }),
        expect.objectContaining({ name: "worker_concurrency", status: "pass" }),
        expect.objectContaining({ name: "worker_heartbeat", status: "fail" })
      ])
    );
  });

  it("fails on invalid production worker concurrency configuration", () => {
    const report = validateProductionBootstrap({
      env: {
        ...BASE_ENV,
        AGENTIC_WORKER_MAX_RUNNING_PER_CONCURRENCY_KEY: "0"
      },
      databaseStatus: buildDatabaseStatus()
    });

    expect(report.ok).toBe(false);
    expect(report.checks).toContainEqual(
      expect.objectContaining({
        name: "worker_concurrency",
        status: "fail",
        message: "Worker concurrency limits are invalid.",
        details: expect.objectContaining({
          error: expect.stringContaining("AGENTIC_WORKER_MAX_RUNNING_PER_CONCURRENCY_KEY")
        })
      })
    );
  });
});
