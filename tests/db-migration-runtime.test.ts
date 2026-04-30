import { mkdtemp, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import { analyzeMigrationDiscipline } from "@agentic/db/migration-discipline";
import { getDatabaseSchemaStatus, runDatabaseMigrations } from "@agentic/db/migration-runtime";

type AppliedMigrationRow = {
  name: string;
  checksum: string;
  applied_at: string;
};

class FakeMigrationClient {
  constructor(
    private readonly state: {
      metadataTableExists: boolean;
      appliedRows: AppliedMigrationRow[];
      executedQueries: string[];
      bootstrapSeen: boolean;
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
      return { rows: [] };
    }

    if (normalized.includes("create table if not exists agent_definitions")) {
      this.state.bootstrapSeen = true;
      return { rows: [] };
    }

    if (normalized.includes("select name, checksum, applied_at")) {
      return { rows: this.state.appliedRows };
    }

    if (normalized.includes("select to_regclass('public.agentic_schema_migrations') as exists")) {
      return {
        rows: [{ exists: this.state.metadataTableExists ? "agentic_schema_migrations" : null }]
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

    return { rows: [] };
  }

  release() {}
}

class FakeMigrationPool {
  readonly state = {
    metadataTableExists: false,
    appliedRows: [] as AppliedMigrationRow[],
    executedQueries: [] as string[],
    bootstrapSeen: false
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

  it("reports fresh databases as metadata-missing with pending migrations", async () => {
    const migrationsDir = await writeMigrationFixtures(["0001_init.sql", "0002_queue.sql"]);

    const status = await getDatabaseSchemaStatus({
      pool: pool as never,
      migrationsDir
    });

    expect(status).toMatchObject({
      ready: false,
      failureReason: "metadata_missing",
      missingMetadataTable: true,
      pendingMigrations: ["0001_init.sql", "0002_queue.sql"]
    });
  });

  it("distinguishes ready existing schemas from partial migration state", async () => {
    const migrationsDir = await writeMigrationFixtures(["0001_init.sql", "0002_queue.sql"]);

    await runDatabaseMigrations({
      pool: pool as never,
      migrationsDir
    });

    await expect(
      getDatabaseSchemaStatus({
        pool: pool as never,
        migrationsDir
      })
    ).resolves.toMatchObject({
      ready: true,
      failureReason: null,
      pendingMigrations: []
    });

    await writeFile(path.join(migrationsDir, "0003_policy.sql"), "select 3;\n");

    await expect(
      getDatabaseSchemaStatus({
        pool: pool as never,
        migrationsDir
      })
    ).resolves.toMatchObject({
      ready: false,
      failureReason: "pending_migrations",
      pendingMigrations: ["0003_policy.sql"]
    });
  });

  it("fails migration discipline checks for malformed names, new duplicate prefixes, and missing rollback notes", () => {
    const report = analyzeMigrationDiscipline({
      rollbackNotes: "- `0001_init.sql`: restore from backup.\n",
      migrations: [
        { name: "0001_init.sql", sql: "select 1;" },
        { name: "0002-good.sql", sql: "select 2;" },
        { name: "0003_policy.sql", sql: "select 3;" },
        { name: "0003_more_policy.sql", sql: "select 4;" }
      ]
    });

    expect(report.status).toBe("fail");
    expect(report.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: "invalid_name", migration: "0002-good.sql", severity: "fail" }),
        expect.objectContaining({ code: "duplicate_prefix", migration: "0003_policy.sql", severity: "fail" }),
        expect.objectContaining({ code: "missing_rollback_note", migration: "0003_more_policy.sql", severity: "fail" })
      ])
    );
  });

  it("tolerates documented legacy duplicate prefixes as warnings while keeping the gate non-failing", () => {
    const report = analyzeMigrationDiscipline({
      rollbackNotes: [
        "- `0004_team_responsibility.sql`: restore from backup.",
        "- `0004_workspace_shadow_replay_policy.sql`: restore from backup."
      ].join("\n"),
      migrations: [
        { name: "0004_team_responsibility.sql", sql: "select 1;" },
        { name: "0004_workspace_shadow_replay_policy.sql", sql: "select 2;" }
      ]
    });

    expect(report.status).toBe("warn");
    expect(report.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: "duplicate_prefix", severity: "warn" })
      ])
    );
  });

  it("fails new duplicate migrations even when they reuse a legacy duplicate prefix", () => {
    const report = analyzeMigrationDiscipline({
      rollbackNotes: [
        "- `0005_bundle_child_sort_order.sql`: restore from backup.",
        "- `0005_governance_default_deny.sql`: restore from backup.",
        "- `0005_new_change.sql`: restore from backup."
      ].join("\n"),
      migrations: [
        { name: "0005_bundle_child_sort_order.sql", sql: "select 1;" },
        { name: "0005_governance_default_deny.sql", sql: "select 2;" },
        { name: "0005_new_change.sql", sql: "select 3;" }
      ]
    });

    expect(report.status).toBe("fail");
    expect(report.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: "duplicate_prefix", migration: "0005_new_change.sql", severity: "fail" })
      ])
    );
  });
});

async function writeMigrationFixtures(names: string[]): Promise<string> {
  const migrationsDir = await mkdtemp(path.join(os.tmpdir(), "agentic-migrations-"));

  await Promise.all(names.map((name, index) => writeFile(path.join(migrationsDir, name), `select ${index + 1};\n`)));

  return migrationsDir;
}
