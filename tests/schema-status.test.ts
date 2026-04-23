import { describe, expect, it } from "vitest";
import { listMigrationFiles } from "@agentic/db/migration-runtime";
import { getDatabaseSchemaStatus } from "@agentic/db/schema-status";

type AppliedMigrationRow = {
  name: string;
  checksum: string;
  applied_at: string;
};

class FakeSchemaPool {
  constructor(
    private readonly state: {
      metadataTableExists: boolean;
      appliedRows: AppliedMigrationRow[];
    }
  ) {}

  async query(sql: string) {
    const normalized = sql.trim();

    if (normalized === "select 1") {
      return { rows: [{ "?column?": 1 }] };
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
      }))
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
});
