import { describe, expect, it } from "vitest";
import { listMigrationFiles } from "@agentic/db/migration-runtime";
import { getDatabaseSchemaStatus } from "@agentic/db/schema-status";

type AppliedMigrationRow = {
  name: string;
  checksum: string;
  applied_at: string;
};

const REQUIRED_AUTH_RUNTIME_OBJECTS = new Set([
  "agentic_schema_migrations",
  "auth_session_rate_limits",
  "auth_revoked_sessions",
  "session_unlock_attempts",
  "auth_session_rate_limits_updated_at_idx",
  "auth_revoked_sessions_expires_at_idx",
  "session_unlock_attempts_last_seen_at_idx"
]);

class FakeSchemaPool {
  constructor(
    private readonly state: {
      metadataTableExists: boolean;
      appliedRows: AppliedMigrationRow[];
      schemaObjects?: Set<string>;
    }
  ) {}

  async query(sql: string, params?: unknown[]) {
    const normalized = sql.trim();

    if (normalized === "select 1") {
      return { rows: [{ "?column?": 1 }] };
    }

    if (normalized === "select to_regclass($1) as exists") {
      const objectName = String((params ?? [])[0] ?? "").replace(/^public\./u, "");
      return {
        rows: [{ exists: this.state.schemaObjects?.has(objectName) ? objectName : null }]
      };
    }

    if (normalized.includes("select to_regclass('public.agentic_schema_migrations') as exists")) {
      return {
        rows: [{ exists: this.state.metadataTableExists ? "agentic_schema_migrations" : null }]
      };
    }

    if (normalized.includes("select name, checksum, applied_at")) {
      return { rows: this.state.appliedRows };
    }

    throw new Error(`Unexpected query: ${normalized}`);
  }
}

describe("schema status", () => {
  it("accepts the full checked-in migration set without reporting drift", async () => {
    const migrations = await listMigrationFiles();
    const pool = new FakeSchemaPool({
      metadataTableExists: true,
      appliedRows: migrations.map((migration) => ({
        name: migration.name,
        checksum: migration.checksum,
        applied_at: "2026-04-23T00:00:00.000Z"
      })),
      schemaObjects: REQUIRED_AUTH_RUNTIME_OBJECTS
    });

    await expect(
      getDatabaseSchemaStatus({
        pool: pool as never
      })
    ).resolves.toMatchObject({
      reachable: true,
      ready: true,
      failureReason: null,
      pendingMigrations: [],
      driftedMigrations: []
    });
  });

  it("fails status when migration metadata is current but shared auth runtime objects are missing", async () => {
    const migrations = await listMigrationFiles();
    const schemaObjects = new Set(REQUIRED_AUTH_RUNTIME_OBJECTS);
    schemaObjects.delete("session_unlock_attempts");
    schemaObjects.delete("session_unlock_attempts_last_seen_at_idx");
    const pool = new FakeSchemaPool({
      metadataTableExists: true,
      appliedRows: migrations.map((migration) => ({
        name: migration.name,
        checksum: migration.checksum,
        applied_at: "2026-04-23T00:00:00.000Z"
      })),
      schemaObjects
    });

    await expect(
      getDatabaseSchemaStatus({
        pool: pool as never
      })
    ).resolves.toMatchObject({
      reachable: true,
      ready: false,
      failureReason: "required_schema_missing",
      pendingMigrations: [],
      driftedMigrations: [],
      requiredSchemaObjects: {
        missingTables: ["session_unlock_attempts"],
        missingIndexes: ["session_unlock_attempts_last_seen_at_idx"]
      }
    });
  });
});
