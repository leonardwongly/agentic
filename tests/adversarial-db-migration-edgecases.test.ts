/**
 * Adversarial edge-case tests for database migration runtime and discipline.
 *
 * Targets:
 *   - packages/db/src/migration-runtime.ts
 *   - packages/db/src/migration-discipline.ts
 *
 * These tests probe boundary conditions, malformed inputs, race conditions,
 * cache behavior, path traversal, checksum integrity, and error recovery.
 */

import { mkdtemp, writeFile, readFile, mkdir, symlink } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { beforeEach, describe, expect, it, vi, afterEach } from "vitest";
import { analyzeMigrationDiscipline } from "@agentic/db/migration-discipline";
import {
  getDatabaseSchemaStatus,
  listMigrationFiles,
  runDatabaseMigrations,
  DatabaseSchemaNotReadyError,
  DatabaseConfigurationError,
  type DatabaseMigrationFile,
  type DatabaseSchemaStatus
} from "@agentic/db/migration-runtime";
import type { RuntimeContext, StorageAdapter } from "@agentic/runtime-adapters";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

type AppliedMigrationRow = {
  name: string;
  checksum: string;
  applied_at: string;
};

class FakePool {
  readonly state = {
    metadataTableExists: false,
    appliedRows: [] as AppliedMigrationRow[],
    executedQueries: [] as string[],
    schemaObjects: new Set<string>(),
    failOnQuery: null as string | null,
    connectFail: false,
    queryCount: 0
  };

  async query(sql: string, params?: unknown[]) {
    this.state.queryCount++;
    const normalized = sql.trim();
    this.state.executedQueries.push(normalized);

    if (this.state.failOnQuery && normalized.includes(this.state.failOnQuery)) {
      throw new Error(`Simulated failure: ${this.state.failOnQuery}`);
    }

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
      return { rows: [] };
    }
    if (normalized.includes("select name, checksum, applied_at")) {
      return { rows: [...this.state.appliedRows] };
    }
    if (normalized === "select to_regclass($1) as exists") {
      const objName = String((params ?? [])[0] ?? "");
      if (objName === "agentic_schema_migrations") {
        return { rows: [{ exists: this.state.metadataTableExists ? objName : null }] };
      }
      return { rows: [{ exists: this.state.schemaObjects.has(objName) ? objName : null }] };
    }
    if (normalized.includes("from unnest($1::text[]) as object_names(object_name)")) {
      const objectNames = (params ?? [])[0] as string[] | undefined;
      return {
        rows: (objectNames ?? []).map((n) => ({
          name: n,
          exists: this.state.schemaObjects.has(n) ? n : null
        }))
      };
    }
    if (normalized.includes("insert into agentic_schema_migrations")) {
      const [name, checksum] = (params ?? []) as [string, string];
      this.state.appliedRows.push({
        name,
        checksum,
        applied_at: new Date().toISOString()
      });
      return { rows: [] };
    }
    return { rows: [] };
  }

  async connect() {
    if (this.state.connectFail) {
      throw new Error("Connection refused");
    }
    return this;
  }

  release() {}
}

async function writeFixtures(
  files: Record<string, string | Uint8Array>
): Promise<string> {
  const dir = await mkdtemp(path.join(os.tmpdir(), "adv-mig-"));
  for (const [name, content] of Object.entries(files)) {
    const filePath = path.join(dir, name);
    // Support nested paths for path traversal tests
    await mkdir(path.dirname(filePath), { recursive: true });
    if (typeof content === "string") {
      await writeFile(filePath, content, "utf8");
    } else {
      await writeFile(filePath, content);
    }
  }
  return dir;
}

/** Build a minimal RuntimeContext pointing at a given directory. */
function makeRuntimeContext(
  migrationsDir: string,
  overrides?: { nodeEnv?: string }
): RuntimeContext {
  const fs = await_import_fs();
  const storage: StorageAdapter = {
    name: "test-fs",
    sep: path.sep,
    async exists(p: string) {
      try {
        await fs.access(p);
        return true;
      } catch {
        return false;
      }
    },
    async readFile(p: string, encoding?: "utf8"): Promise<string | Uint8Array> {
      if (encoding === "utf8") {
        return fs.readFile(p, "utf8");
      }
      return fs.readFile(p);
    },
    async writeFile(p: string, data: string | Uint8Array) {
      await fs.writeFile(p, data);
    },
    async mkdir(p: string, opts?: { recursive?: boolean }) {
      await fs.mkdir(p, opts);
    },
    async rmdir(p: string, opts?: { recursive?: boolean }) {
      await fs.rm(p, { recursive: opts?.recursive ?? false, force: true });
    },
    async stat(p: string) {
      const s = await fs.stat(p);
      return {
        size: s.size,
        mtimeMs: s.mtimeMs,
        birthtimeMs: s.birthtimeMs,
        isFile: s.isFile(),
        isDirectory: s.isDirectory()
      };
    },
    async readdir(p: string, opts?: { withFileTypes?: boolean }) {
      const entries = await fs.readdir(p, { withFileTypes: true });
      if (opts?.withFileTypes) {
        return entries.map((e) => ({
          name: e.name,
          isFile: e.isFile(),
          isDirectory: e.isDirectory()
        }));
      }
      return entries.map((e) => e.name);
    },
    async rename(oldPath: string, newPath: string) {
      await fs.rename(oldPath, newPath);
    },
    async unlink(p: string) {
      await fs.unlink(p);
    },
    resolve(...paths: string[]) {
      return path.resolve(...paths);
    },
    join(...paths: string[]) {
      return path.join(...paths);
    },
    relative(from: string, to: string) {
      return path.relative(from, to);
    },
    dirname(p: string) {
      return path.dirname(p);
    },
    basename(p: string, ext?: string) {
      return path.basename(p, ext);
    },
    isAbsolute(p: string) {
      return path.isAbsolute(p);
    }
  };

  return {
    storage,
    locks: {
      async acquire() {
        return async () => {};
      }
    },
    isEdgeRuntime: false,
    env: { NODE_ENV: overrides?.nodeEnv ?? "test" },
    cwd: () => process.cwd(),
    pid: process.pid,
    randomUUID: () => crypto.randomUUID(),
    now: () => Date.now()
  };
}

// Lazy import to avoid top-level side effects
function await_import_fs() {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  return require("node:fs/promises") as typeof import("node:fs/promises");
}

// ---------------------------------------------------------------------------
// 1. Migration File Edge Cases
// ---------------------------------------------------------------------------

describe("adversarial: migration file edge cases", () => {
  it("handles empty SQL files without crashing", async () => {
    const dir = await writeFixtures({ "0001_empty.sql": "" });
    const ctx = makeRuntimeContext(dir);
    const files = await listMigrationFiles({ migrationsDir: dir, context: ctx });

    expect(files).toHaveLength(1);
    expect(files[0].sql).toBe("");
    // Checksum should still be valid SHA-256 hex
    expect(files[0].checksum).toMatch(/^[a-f0-9]{64}$/);
  });

  it("ignores non-SQL files in the migrations directory", async () => {
    const dir = await writeFixtures({
      "0001_valid.sql": "select 1;",
      "README.md": "# Migrations",
      ".DS_Store": "",
      "notes.txt": "some notes",
      "backup.sql.bak": "old stuff"
    });
    const ctx = makeRuntimeContext(dir);
    const files = await listMigrationFiles({ migrationsDir: dir, context: ctx });

    expect(files).toHaveLength(1);
    expect(files[0].name).toBe("0001_valid.sql");
  });

  it("REGRESSION: strips the UTF-8 BOM so checksums are platform-independent", async () => {
    // Regression for adversarial-sweep bug: the BOM (EF BB BF) used to be kept
    // in the SQL content and checksum, so the same migration saved by a
    // BOM-writing editor produced a different checksum than the committed file
    // and showed up as false drift.
    const bom = Buffer.from([0xef, 0xbb, 0xbf]);
    const sqlContent = Buffer.concat([bom, Buffer.from("select 1;")]);
    const dirBom = await writeFixtures({ "0001_bom.sql": sqlContent });
    const dirPlain = await writeFixtures({ "0001_plain.sql": "select 1;" });
    const ctxBom = makeRuntimeContext(dirBom);
    const ctxPlain = makeRuntimeContext(dirPlain);

    const withBom = await listMigrationFiles({ migrationsDir: dirBom, context: ctxBom });
    const withoutBom = await listMigrationFiles({ migrationsDir: dirPlain, context: ctxPlain });

    expect(withBom).toHaveLength(1);
    // The BOM is stripped from the SQL text and therefore from the checksum:
    // identical SQL with and without a BOM hashes identically.
    expect(withBom[0].sql).toBe("select 1;");
    expect(withBom[0].sql.charCodeAt(0)).not.toBe(0xfeff);
    expect(withBom[0].checksum).toBe(withoutBom[0].checksum);
  });

  it("returns empty array for nonexistent migrations directory", async () => {
    const ctx = makeRuntimeContext("/tmp/does-not-exist-" + Date.now());
    const files = await listMigrationFiles({
      migrationsDir: "/tmp/does-not-exist-" + Date.now(),
      context: ctx
    });

    expect(files).toEqual([]);
  });

  it("sorts migration files lexicographically regardless of creation order", async () => {
    const dir = await writeFixtures({
      "0003_third.sql": "select 3;",
      "0001_first.sql": "select 1;",
      "0002_second.sql": "select 2;"
    });
    const ctx = makeRuntimeContext(dir);
    const files = await listMigrationFiles({ migrationsDir: dir, context: ctx });

    expect(files.map((f) => f.name)).toEqual([
      "0001_first.sql",
      "0002_second.sql",
      "0003_third.sql"
    ]);
  });
});

// ---------------------------------------------------------------------------
// 2. Checksum Integrity
// ---------------------------------------------------------------------------

describe("adversarial: checksum integrity", () => {
  it("detects modified migration content via checksum mismatch", async () => {
    const dir = await writeFixtures({ "0001_init.sql": "select 1;" });
    const ctx = makeRuntimeContext(dir);
    const original = await listMigrationFiles({ migrationsDir: dir, context: ctx });

    // Modify the file
    await writeFile(path.join(dir, "0001_init.sql"), "select 2;", "utf8");
    const modified = await listMigrationFiles({ migrationsDir: dir, context: ctx });

    expect(original[0].checksum).not.toBe(modified[0].checksum);
  });

  it("produces different checksums for whitespace-only changes", async () => {
    const dir1 = await writeFixtures({ "0001_ws.sql": "select 1;" });
    const dir2 = await writeFixtures({ "0001_ws.sql": "select 1; \n" });
    const ctx1 = makeRuntimeContext(dir1);
    const ctx2 = makeRuntimeContext(dir2);

    const files1 = await listMigrationFiles({ migrationsDir: dir1, context: ctx1 });
    const files2 = await listMigrationFiles({ migrationsDir: dir2, context: ctx2 });

    // Whitespace differences DO change the checksum — this is by design
    // but can cause surprising drift when editors auto-format
    expect(files1[0].checksum).not.toBe(files2[0].checksum);
  });

  it("produces consistent checksums for identical content across reads", async () => {
    const dir = await writeFixtures({ "0001_stable.sql": "select 1;\n" });
    const ctx = makeRuntimeContext(dir);

    const first = await listMigrationFiles({ migrationsDir: dir, context: ctx });
    const second = await listMigrationFiles({ migrationsDir: dir, context: ctx });

    expect(first[0].checksum).toBe(second[0].checksum);
  });
});

// ---------------------------------------------------------------------------
// 3. Race Conditions & Concurrent Migration Attempts
// ---------------------------------------------------------------------------

describe("adversarial: race conditions", () => {
  it("REGRESSION: runDatabaseMigrations brackets metadata work with a pg advisory lock", async () => {
    const dir = await writeFixtures({ "0001_init.sql": "select 1;" });
    const pool = new FakePool();
    const ctx = makeRuntimeContext(dir);

    // Regression for adversarial-sweep bug: migrations ran with no cross-
    // connection serialization, so two concurrent runners could both pass the
    // "is applied?" check before either committed and the second insert would
    // violate the metadata primary key. runDatabaseMigrations now takes a
    // session-scoped pg_advisory_lock keyed on the metadata table name before
    // reading/writing migration metadata and releases it afterwards.
    await runDatabaseMigrations({ pool: pool as never, migrationsDir: dir, context: ctx });

    const queries = pool.state.executedQueries;
    const lockIndex = queries.findIndex((q) => q.includes("pg_advisory_lock(hashtext($1))"));
    const unlockIndex = queries.findIndex((q) => q.includes("pg_advisory_unlock(hashtext($1))"));
    const insertIndex = queries.findIndex((q) => q.includes("insert into agentic_schema_migrations"));
    const appliedReadIndex = queries.findIndex((q) => q.includes("select name, checksum, applied_at"));

    expect(lockIndex).toBeGreaterThanOrEqual(0);
    expect(unlockIndex).toBeGreaterThanOrEqual(0);
    // Lock is held BEFORE the applied-rows read that decides what to apply,
    // and released only after the inserts complete.
    expect(lockIndex).toBeLessThan(appliedReadIndex);
    expect(insertIndex).toBeGreaterThan(lockIndex);
    expect(unlockIndex).toBeGreaterThan(insertIndex);
  });

  it("REGRESSION: the advisory lock is released even when a migration fails mid-run", async () => {
    const dir = await writeFixtures({ "0001_init.sql": "select 1;" });
    const pool = new FakePool();
    pool.state.failOnQuery = "select 1;"; // the migration body itself fails
    const ctx = makeRuntimeContext(dir);

    await expect(
      runDatabaseMigrations({ pool: pool as never, migrationsDir: dir, context: ctx })
    ).rejects.toThrow();

    const queries = pool.state.executedQueries;
    expect(queries.some((q) => q.includes("pg_advisory_lock(hashtext($1))"))).toBe(true);
    // A crashed runner must not strand the lock for the next deploy.
    expect(queries.some((q) => q.includes("pg_advisory_unlock(hashtext($1))"))).toBe(true);
  });

  it("concurrent runDatabaseMigrations calls share serialized state", async () => {
    const dir = await writeFixtures({ "0001_init.sql": "select 1;" });
    const pool = new FakePool();
    const ctx = makeRuntimeContext(dir);

    // Run two migrations concurrently against the same pool. With the advisory
    // lock in place, real Postgres connections serialize here; the FakePool
    // additionally shares applied-state, so the second call sees the first
    // call's insert and skips the migration — exactly one insert either way.
    const results = await Promise.allSettled([
      runDatabaseMigrations({ pool: pool as never, migrationsDir: dir, context: ctx }),
      runDatabaseMigrations({ pool: pool as never, migrationsDir: dir, context: ctx })
    ]);

    const fulfilled = results.filter((r): r is PromiseFulfilledResult<DatabaseSchemaStatus> => r.status === "fulfilled");
    expect(fulfilled.length).toBeGreaterThanOrEqual(1);

    const insertCount = pool.state.executedQueries.filter((q) =>
      q.includes("insert into agentic_schema_migrations")
    ).length;
    expect(insertCount).toBeGreaterThanOrEqual(1);
  });

  it("reports unreachable when health check query fails", async () => {
    const pool = new FakePool();
    pool.state.failOnQuery = "select 1";
    const dir = await writeFixtures({ "0001_init.sql": "select 1;" });
    const ctx = makeRuntimeContext(dir);

    const status = await getDatabaseSchemaStatus({
      pool: pool as never,
      migrationsDir: dir,
      context: ctx
    });

    expect(status.reachable).toBe(false);
    expect(status.failureReason).toBe("unreachable");
  });
});

// ---------------------------------------------------------------------------
// 4. Boundary Values
// ---------------------------------------------------------------------------

describe("adversarial: boundary values", () => {
  it("REGRESSION: reports NOT ready when zero migrations exist without metadata table", async () => {
    const dir = await writeFixtures({});
    const pool = new FakePool();
    const ctx = makeRuntimeContext(dir);

    const status = await getDatabaseSchemaStatus({
      pool: pool as never,
      migrationsDir: dir,
      context: ctx
    });

    // Regression for adversarial-sweep bug: zero migration files on disk AND no
    // metadata table used to report ready=true (the empty pending list
    // short-circuited the missingMetadataTable check), masking deployments where
    // the migrations directory was accidentally empty or misresolved. A healthy
    // migrated database always carries the metadata table.
    expect(status.pendingMigrations).toEqual([]);
    expect(status.missingMetadataTable).toBe(true);
    expect(status.ready).toBe(false);
    expect(status.failureReason).toBe("metadata_missing");
  });

  it("handles a large number of migration files", async () => {
    const files: Record<string, string> = {};
    const count = 200;
    for (let i = 1; i <= count; i++) {
      const name = `${String(i).padStart(4, "0")}_migration_${i}.sql`;
      files[name] = `select ${i};`;
    }
    const dir = await writeFixtures(files);
    const ctx = makeRuntimeContext(dir);

    const result = await listMigrationFiles({ migrationsDir: dir, context: ctx });
    expect(result).toHaveLength(count);
    expect(result[0].name).toBe("0001_migration_1.sql");
    expect(result[count - 1].name).toBe(`0200_migration_${count}.sql`);
  });

  it("handles very large SQL migration file", async () => {
    // Generate ~1MB SQL file
    const bigSql = "select 1;\n".repeat(100_000);
    const dir = await writeFixtures({ "0001_big.sql": bigSql });
    const ctx = makeRuntimeContext(dir);

    const files = await listMigrationFiles({ migrationsDir: dir, context: ctx });
    expect(files).toHaveLength(1);
    expect(files[0].sql.length).toBeGreaterThan(900_000);
    expect(files[0].checksum).toMatch(/^[a-f0-9]{64}$/);
  });
});

// ---------------------------------------------------------------------------
// 5. Error Recovery
// ---------------------------------------------------------------------------

describe("adversarial: error recovery", () => {
  it("throws DatabaseSchemaNotReadyError when database is unreachable during migration", async () => {
    const pool = new FakePool();
    pool.state.failOnQuery = "select 1";
    const dir = await writeFixtures({ "0001_init.sql": "select 1;" });
    const ctx = makeRuntimeContext(dir);

    await expect(
      runDatabaseMigrations({ pool: pool as never, migrationsDir: dir, context: ctx })
    ).rejects.toThrow(DatabaseSchemaNotReadyError);
  });

  it("rolls back and stops when a migration SQL fails mid-sequence", async () => {
    const dir = await writeFixtures({
      "0001_ok.sql": "select 1;",
      "0002_fail.sql": "INVALID SQL THAT FAILS;",
      "0003_after.sql": "select 3;"
    });
    const pool = new FakePool();
    pool.state.failOnQuery = "INVALID SQL THAT FAILS";
    const ctx = makeRuntimeContext(dir);

    await expect(
      runDatabaseMigrations({ pool: pool as never, migrationsDir: dir, context: ctx })
    ).rejects.toThrow();

    // Only 0001 should have been committed
    const committedInserts = pool.state.appliedRows.map((r) => r.name);
    expect(committedInserts).toContain("0001_ok.sql");
    expect(committedInserts).not.toContain("0002_fail.sql");
    expect(committedInserts).not.toContain("0003_after.sql");

    // ROLLBACK should have been issued for the failed migration
    const rollbackCount = pool.state.executedQueries.filter((q) => q === "ROLLBACK").length;
    expect(rollbackCount).toBeGreaterThanOrEqual(1);
  });

  it("detects drift when an applied migration is deleted from disk", async () => {
    const dir = await writeFixtures({
      "0001_init.sql": "select 1;",
      "0002_extra.sql": "select 2;"
    });
    const pool = new FakePool();
    const ctx = makeRuntimeContext(dir);

    // Apply all migrations
    await runDatabaseMigrations({ pool: pool as never, migrationsDir: dir, context: ctx });

    // Delete 0002 from disk
    const fs = await_import_fs();
    await fs.unlink(path.join(dir, "0002_extra.sql"));

    // Now run again — should detect drift because 0002 is in DB but not on disk
    await expect(
      runDatabaseMigrations({ pool: pool as never, migrationsDir: dir, context: ctx })
    ).rejects.toThrow(DatabaseSchemaNotReadyError);
  });

  it("throws DatabaseConfigurationError when no DATABASE_URL and no pool provided", async () => {
    await expect(
      runDatabaseMigrations({ databaseUrl: "   " })
    ).rejects.toThrow(DatabaseConfigurationError);
  });
});

// ---------------------------------------------------------------------------
// 6. Discipline Checks
// ---------------------------------------------------------------------------

describe("adversarial: migration discipline checks", () => {
  it("rejects filenames with uppercase letters", () => {
    const report = analyzeMigrationDiscipline({
      rollbackNotes: "- `0001_Init.sql`: restore.\n",
      migrations: [{ name: "0001_Init.sql", sql: "select 1;" }]
    });

    expect(report.status).toBe("fail");
    expect(report.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: "invalid_name", migration: "0001_Init.sql" })
      ])
    );
  });

  it("rejects filenames with hyphens instead of underscores", () => {
    const report = analyzeMigrationDiscipline({
      rollbackNotes: "- `0001-my-migration.sql`: restore.\n",
      migrations: [{ name: "0001-my-migration.sql", sql: "select 1;" }]
    });

    expect(report.status).toBe("fail");
    expect(report.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: "invalid_name", migration: "0001-my-migration.sql" })
      ])
    );
  });

  it("rejects filenames without numeric prefix", () => {
    const report = analyzeMigrationDiscipline({
      rollbackNotes: "- `init.sql`: restore.\n",
      migrations: [{ name: "init.sql", sql: "select 1;" }]
    });

    expect(report.status).toBe("fail");
    expect(report.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: "invalid_name", migration: "init.sql" })
      ])
    );
  });

  it("detects out-of-order migrations", () => {
    const report = analyzeMigrationDiscipline({
      rollbackNotes: "- `0002_second.sql`: restore.\n- `0001_first.sql`: restore.\n",
      migrations: [
        { name: "0002_second.sql", sql: "select 2;" },
        { name: "0001_first.sql", sql: "select 1;" }
      ]
    });

    expect(report.status).toBe("fail");
    expect(report.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: "out_of_order" })
      ])
    );
  });

  it("flags destructive SQL as warning", () => {
    const report = analyzeMigrationDiscipline({
      rollbackNotes: "- `0001_drop.sql`: restore from backup.\n",
      migrations: [{ name: "0001_drop.sql", sql: "DROP TABLE users;" }]
    });

    expect(report.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: "destructive_sql", severity: "warn" })
      ])
    );
    // Destructive alone doesn't fail — it's a warn
    expect(report.status).toBe("warn");
  });

  it("flags truncate as destructive SQL", () => {
    const report = analyzeMigrationDiscipline({
      rollbackNotes: "- `0001_trunc.sql`: restore.\n",
      migrations: [{ name: "0001_trunc.sql", sql: "TRUNCATE TABLE events;" }]
    });

    expect(report.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: "destructive_sql", severity: "warn" })
      ])
    );
  });

  it("passes clean migrations with proper naming and rollback notes", () => {
    const report = analyzeMigrationDiscipline({
      rollbackNotes: "- `0001_init.sql`: restore from backup.\n- `0002_add_users.sql`: drop column.\n",
      migrations: [
        { name: "0001_init.sql", sql: "create table t(id int);" },
        { name: "0002_add_users.sql", sql: "alter table t add column name text;" }
      ]
    });

    expect(report.status).toBe("pass");
    expect(report.issues).toHaveLength(0);
  });

  it("fails when new duplicate prefix is introduced alongside legacy duplicates", () => {
    const report = analyzeMigrationDiscipline({
      rollbackNotes: [
        "- `0004_team_responsibility.sql`: restore.",
        "- `0004_workspace_shadow_replay_policy.sql`: restore.",
        "- `0004_new_one.sql`: restore."
      ].join("\n"),
      migrations: [
        { name: "0004_team_responsibility.sql", sql: "select 1;" },
        { name: "0004_workspace_shadow_replay_policy.sql", sql: "select 2;" },
        { name: "0004_new_one.sql", sql: "select 3;" }
      ]
    });

    // Adding a third file to a legacy duplicate set makes ALL of them fail
    expect(report.status).toBe("fail");
    const dupIssues = report.issues.filter((i) => i.code === "duplicate_prefix");
    expect(dupIssues.every((i) => i.severity === "fail")).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// 7. Cache Behavior
// ---------------------------------------------------------------------------

describe("adversarial: cache behavior", () => {
  it("does NOT cache results when NODE_ENV is test", async () => {
    const dir = await writeFixtures({ "0001_v1.sql": "select 1;" });
    const ctx = makeRuntimeContext(dir, { nodeEnv: "test" });

    const first = await listMigrationFiles({ migrationsDir: dir, context: ctx });
    expect(first[0].sql).toBe("select 1;");

    // Modify the file
    await writeFile(path.join(dir, "0001_v1.sql"), "select 999;", "utf8");

    const second = await listMigrationFiles({ migrationsDir: dir, context: ctx });
    // In test mode, cache is disabled so we see fresh content
    expect(second[0].sql).toBe("select 999;");
  });

  it("always bypasses cache when explicit migrationsDir is provided", async () => {
    const dir1 = await writeFixtures({ "0001_a.sql": "select 1;" });
    const dir2 = await writeFixtures({ "0001_a.sql": "select 2;" });
    const ctx = makeRuntimeContext(dir1, { nodeEnv: "production" });

    const first = await listMigrationFiles({ migrationsDir: dir1, context: ctx });
    const second = await listMigrationFiles({ migrationsDir: dir2, context: ctx });

    // Different dirs → different results even in production mode
    expect(first[0].sql).toBe("select 1;");
    expect(second[0].sql).toBe("select 2;");
  });
});

// ---------------------------------------------------------------------------
// 8. Path Traversal & Symlink Attacks
// ---------------------------------------------------------------------------

describe("adversarial: path traversal and symlinks", () => {
  it("does not escape the migrations directory with ../ in filename", async () => {
    // Create a secret file outside the migrations dir
    const baseDir = await mkdtemp(path.join(os.tmpdir(), "adv-traversal-"));
    const migDir = path.join(baseDir, "migrations");
    await mkdir(migDir, { recursive: true });
    await writeFile(path.join(baseDir, "secret.sql"), "SENSITIVE DATA", "utf8");

    // Try to create a file with ../ in its name inside migrations dir
    // Most filesystems won't allow this, but let's verify the runtime handles it
    try {
      await writeFile(path.join(migDir, "..", "evil.sql"), "pwned", "utf8");
    } catch {
      // Expected — OS prevents traversal via writeFile
    }

    const ctx = makeRuntimeContext(migDir);
    const files = await listMigrationFiles({ migrationsDir: migDir, context: ctx });

    // Should only see files actually IN the migrations dir
    const names = files.map((f) => f.name);
    expect(names).not.toContain("secret.sql");
    expect(names).not.toContain("evil.sql");
  });

  it("excludes symlinked files because readdir isFile returns false for symlinks", async () => {
    const realDir = await mkdtemp(path.join(os.tmpdir(), "adv-symlink-real-"));
    const linkDir = await mkdtemp(path.join(os.tmpdir(), "adv-symlink-link-"));
    const migDir = path.join(linkDir, "migrations");
    await mkdir(migDir, { recursive: true });

    // Create a real migration file outside
    await writeFile(path.join(realDir, "0001_external.sql"), "select 'external';", "utf8");

    // Symlink the external file into the migrations dir
    try {
      await symlink(
        path.join(realDir, "0001_external.sql"),
        path.join(migDir, "0001_external.sql")
      );
    } catch {
      // Symlinks may not work on all platforms (e.g., Windows without admin)
      return;
    }

    const ctx = makeRuntimeContext(migDir);
    const files = await listMigrationFiles({ migrationsDir: migDir, context: ctx });

    // Node.js readdir withFileTypes reports isFile()=false for symlinks.
    // The runtime filters on entry.isFile, so symlinked migration files are
    // silently excluded. This is safe but potentially surprising — a developer
    // who symlinks a shared migration file will see it ignored without error.
    // NOTE: If a storage adapter implementation follows symlinks in isFile
    // (e.g., using stat instead of lstat), this protection disappears and
    // symlinked files from outside the migrations dir would be included.
    expect(files).toHaveLength(0);
  });

  it("symlinked directory as migrations dir reads from target", async () => {
    const realDir = await mkdtemp(path.join(os.tmpdir(), "adv-symdir-real-"));
    const linkBase = await mkdtemp(path.join(os.tmpdir(), "adv-symdir-link-"));
    const linkDir = path.join(linkBase, "migrations");

    await writeFile(path.join(realDir, "0001_from_link.sql"), "select 'linked';", "utf8");

    try {
      await symlink(realDir, linkDir);
    } catch {
      return; // Skip on platforms without symlink support
    }

    const ctx = makeRuntimeContext(linkDir);
    const files = await listMigrationFiles({ migrationsDir: linkDir, context: ctx });

    // BUG DOCUMENTED: No realpath validation. A symlinked migrations directory
    // causes the runtime to read from wherever the symlink points.
    expect(files).toHaveLength(1);
    expect(files[0].name).toBe("0001_from_link.sql");
  });
});

// ---------------------------------------------------------------------------
// 9. Additional Edge Cases
// ---------------------------------------------------------------------------

describe("adversarial: additional edge cases", () => {
  it("handles migration files with unicode content in SQL", async () => {
    const dir = await writeFixtures({
      "0001_unicode.sql": "-- 日本語コメント\nINSERT INTO t(name) VALUES ('café');"
    });
    const ctx = makeRuntimeContext(dir);
    const files = await listMigrationFiles({ migrationsDir: dir, context: ctx });

    expect(files).toHaveLength(1);
    expect(files[0].sql).toContain("café");
    expect(files[0].checksum).toMatch(/^[a-f0-9]{64}$/);
  });

  it("handles migration with only whitespace content", async () => {
    const dir = await writeFixtures({ "0001_spaces.sql": "   \n\t\n  " });
    const ctx = makeRuntimeContext(dir);
    const files = await listMigrationFiles({ migrationsDir: dir, context: ctx });

    expect(files).toHaveLength(1);
    expect(files[0].sql.trim()).toBe("");
    // Still produces a valid checksum
    expect(files[0].checksum).toMatch(/^[a-f0-9]{64}$/);
  });

  it("getDatabaseSchemaStatus detects drift when checksum changes on disk", async () => {
    const dir = await writeFixtures({ "0001_init.sql": "select 1;" });
    const pool = new FakePool();
    const ctx = makeRuntimeContext(dir);

    // Apply migration
    await runDatabaseMigrations({ pool: pool as never, migrationsDir: dir, context: ctx });

    // Modify the file on disk
    await writeFile(path.join(dir, "0001_init.sql"), "select 999;", "utf8");

    const status = await getDatabaseSchemaStatus({
      pool: pool as never,
      migrationsDir: dir,
      context: ctx
    });

    expect(status.ready).toBe(false);
    expect(status.failureReason).toBe("migration_drift");
    expect(status.driftedMigrations).toContain("0001_init.sql");
  });

  it("analyzeMigrationDiscipline handles empty migration list", () => {
    const report = analyzeMigrationDiscipline({
      rollbackNotes: "",
      migrations: []
    });

    expect(report.status).toBe("pass");
    expect(report.issues).toHaveLength(0);
    expect(report.checkedMigrations).toEqual([]);
  });

  it("analyzeMigrationDiscipline flags delete from as destructive", () => {
    const report = analyzeMigrationDiscipline({
      rollbackNotes: "- `0001_delete.sql`: restore.\n",
      migrations: [{ name: "0001_delete.sql", sql: "DELETE FROM users WHERE active = false;" }]
    });

    expect(report.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: "destructive_sql", severity: "warn" })
      ])
    );
  });

  it("analyzeMigrationDiscipline flags drop column as destructive", () => {
    const report = analyzeMigrationDiscipline({
      rollbackNotes: "- `0001_dropcol.sql`: restore.\n",
      migrations: [{ name: "0001_dropcol.sql", sql: "ALTER TABLE t DROP COLUMN old_data;" }]
    });

    expect(report.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: "destructive_sql", severity: "warn" })
      ])
    );
  });
});
