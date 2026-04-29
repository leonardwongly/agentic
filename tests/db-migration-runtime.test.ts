import { beforeEach, describe, expect, it } from "vitest";
import { REQUIRED_AUTH_RUNTIME_INDEXES, REQUIRED_AUTH_RUNTIME_TABLES } from "@agentic/db/auth-runtime-schema";
import { listMigrationFiles, runDatabaseMigrations, assertDatabaseSchemaReady } from "@agentic/db/migration-runtime";

type AppliedMigrationRow = {
  name: string;
  checksum: string;
  applied_at: string;
};

const REQUIRED_AUTH_RUNTIME_OBJECTS = new Set([
  "agentic_schema_migrations",
  ...REQUIRED_AUTH_RUNTIME_TABLES,
  ...REQUIRED_AUTH_RUNTIME_INDEXES
]);

class FakeMigrationClient {
  constructor(
    private readonly state: {
      metadataTableExists: boolean;
      appliedRows: AppliedMigrationRow[];
      executedQueries: string[];
      bootstrapSeen: boolean;
      schemaObjects: Set<string>;
    }
  ) {}

  async query(sql: string, params?: unknown[]) {
    const normalized = sql.trim();
    this.state.executedQueries.push(normalized);

    if (normalized === "BEGIN" || normalized === "COMMIT" || normalized === "ROLLBACK") {
      return { rows: [] };
    }

    if (normalized === "select 1") {
      return { rows: [{ "?column?": 1 }] };
    }

    if (normalized.includes("create table if not exists agentic_schema_migrations")) {
      this.state.metadataTableExists = true;
      this.state.schemaObjects.add("agentic_schema_migrations");
      return { rows: [] };
    }

    if (normalized.includes("create table if not exists agent_definitions")) {
      this.state.bootstrapSeen = true;
      return { rows: [] };
    }

    if (normalized.includes("select name, checksum, applied_at")) {
      return { rows: this.state.appliedRows };
    }

    if (normalized === "select to_regclass($1) as exists") {
      const objectName = String((params ?? [])[0] ?? "");
      expect(objectName).not.toMatch(/^public\./u);
      if (objectName === "agentic_schema_migrations") {
        return {
          rows: [{ exists: this.state.metadataTableExists ? objectName : null }]
        };
      }

      return {
        rows: [{ exists: this.state.schemaObjects.has(objectName) ? objectName : null }]
      };
    }

    if (normalized.includes("insert into agentic_schema_migrations")) {
      const [name, checksum] = (params ?? []) as [string, string];
      this.state.appliedRows.push({
        name,
        checksum,
        applied_at: new Date("2026-04-22T00:00:00.000Z").toISOString()
      });
      return { rows: [] };
    }

    if (
      normalized.includes("alter table agent_definitions add column if not exists actor_context jsonb") &&
      !this.state.bootstrapSeen
    ) {
      throw new Error('relation "agent_definitions" does not exist');
    }

    for (const objectName of REQUIRED_AUTH_RUNTIME_OBJECTS) {
      if (normalized.includes(objectName)) {
        this.state.schemaObjects.add(objectName);
      }
    }

    return { rows: [] };
  }

  release() {}
}

class FakeMigrationPool {
  readonly state = {
    metadataTableExists: false,
    appliedRows: [] as AppliedMigrationRow[],
    executedQueries: [] as string[],
    bootstrapSeen: false,
    schemaObjects: new Set<string>()
  };

  async query(sql: string, params?: unknown[]) {
    return new FakeMigrationClient(this.state).query(sql, params);
  }

  async connect() {
    return new FakeMigrationClient(this.state);
  }
}

describe("runDatabaseMigrations", () => {
  let pool: FakeMigrationPool;

  beforeEach(() => {
    pool = new FakeMigrationPool();
  });

  it("bootstraps legacy agent definitions before applying the initial migration on a fresh database", async () => {
    const status = await runDatabaseMigrations({
      pool: pool as never
    });

    expect(status.ready).toBe(true);
    expect(status.pendingMigrations).toEqual([]);
    expect(pool.state.bootstrapSeen).toBe(true);

    const bootstrapIndex = pool.state.executedQueries.findIndex((query) =>
      query.includes("create table if not exists agent_definitions")
    );
    const initMigrationIndex = pool.state.executedQueries.findIndex((query) =>
      query.includes("alter table agent_definitions add column if not exists actor_context jsonb")
    );

    expect(bootstrapIndex).toBeGreaterThanOrEqual(0);
    expect(initMigrationIndex).toBeGreaterThan(bootstrapIndex);
  });

  it("reports missing shared auth runtime objects even when migration metadata is current", async () => {
    const migrations = await listMigrationFiles();
    pool.state.metadataTableExists = true;
    pool.state.schemaObjects = new Set(REQUIRED_AUTH_RUNTIME_OBJECTS);
    pool.state.schemaObjects.delete("auth_revoked_sessions_expires_at_idx");
    pool.state.appliedRows = migrations.map((migration) => ({
      name: migration.name,
      checksum: migration.checksum,
      applied_at: "2026-04-23T00:00:00.000Z"
    }));

    await expect(assertDatabaseSchemaReady({ pool: pool as never })).rejects.toMatchObject({
      name: "DatabaseSchemaNotReadyError",
      status: expect.objectContaining({
        ready: false,
        failureReason: "required_schema_missing",
        requiredSchemaObjects: expect.objectContaining({
          missingIndexes: ["auth_revoked_sessions_expires_at_idx"]
        })
      })
    });
  });
});
