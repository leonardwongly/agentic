import { beforeEach, describe, expect, it } from "vitest";
import { runDatabaseMigrations } from "@agentic/db/migration-runtime";

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
});
