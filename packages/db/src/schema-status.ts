import crypto from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Pool, type PoolClient } from "pg";

const DEFAULT_MIGRATIONS_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "migrations");
const SCHEMA_MIGRATIONS_TABLE = "agentic_schema_migrations";
const REQUIRED_AUTH_RUNTIME_TABLES = [
  "auth_session_rate_limits",
  "auth_revoked_sessions",
  "session_unlock_attempts"
] as const;
const REQUIRED_AUTH_RUNTIME_INDEXES = [
  "auth_session_rate_limits_updated_at_idx",
  "auth_revoked_sessions_expires_at_idx",
  "session_unlock_attempts_last_seen_at_idx"
] as const;

type SchemaQueryable = Pick<Pool, "query"> | PoolClient;

type ExpectedMigration = {
  name: string;
  checksum: string;
};

export type DatabaseSchemaStatus = {
  reachable: boolean;
  ready: boolean;
  failureReason:
    | "unreachable"
    | "metadata_missing"
    | "pending_migrations"
    | "migration_drift"
    | "required_schema_missing"
    | null;
  missingMetadataTable: boolean;
  appliedMigrations: string[];
  pendingMigrations: string[];
  driftedMigrations: string[];
  requiredSchemaObjects: {
    tables: string[];
    indexes: string[];
    missingTables: string[];
    missingIndexes: string[];
  };
  lastAppliedAt: string | null;
};

export class DatabaseConfigurationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DatabaseConfigurationError";
  }
}

function createEmptySchemaStatus(overrides?: Partial<DatabaseSchemaStatus>): DatabaseSchemaStatus {
  return {
    reachable: true,
    ready: false,
    failureReason: null,
    missingMetadataTable: false,
    appliedMigrations: [],
    pendingMigrations: [],
    driftedMigrations: [],
    requiredSchemaObjects: {
      tables: [...REQUIRED_AUTH_RUNTIME_TABLES],
      indexes: [...REQUIRED_AUTH_RUNTIME_INDEXES],
      missingTables: [],
      missingIndexes: []
    },
    lastAppliedAt: null,
    ...overrides
  };
}

function resolveMigrationsDir(migrationsDir?: string): string {
  return path.resolve(migrationsDir ?? DEFAULT_MIGRATIONS_DIR);
}

function hashMigration(sql: string): string {
  return crypto.createHash("sha256").update(sql, "utf8").digest("hex");
}

async function listExpectedMigrations(options?: { migrationsDir?: string }): Promise<ExpectedMigration[]> {
  const migrationsDir = resolveMigrationsDir(options?.migrationsDir);
  const entries = await readdir(migrationsDir, { withFileTypes: true });
  const migrationNames = entries
    .filter((entry) => entry.isFile() && entry.name.endsWith(".sql"))
    .map((entry) => entry.name)
    .sort((left, right) => left.localeCompare(right));

  return Promise.all(
    migrationNames.map(async (name) => {
      const sql = await readFile(path.join(migrationsDir, name), "utf8");

      return {
        name,
        checksum: hashMigration(sql)
      };
    })
  );
}

async function withSchemaQueryable<T>(
  params: { databaseUrl?: string; pool?: Pool },
  callback: (queryable: SchemaQueryable) => Promise<T>
): Promise<T> {
  if (params.pool) {
    return callback(params.pool);
  }

  const databaseUrl = params.databaseUrl?.trim();

  if (!databaseUrl) {
    throw new DatabaseConfigurationError("DATABASE_URL must be configured for database operations.");
  }

  const pool = new Pool({ connectionString: databaseUrl });

  try {
    return await callback(pool);
  } finally {
    await pool.end();
  }
}

async function loadAppliedMigrationRows(
  queryable: SchemaQueryable
): Promise<Array<{ name: string; checksum: string; appliedAt: string }>> {
  const result = await queryable.query<{
    name: string;
    checksum: string;
    applied_at: string | Date;
  }>(`
    select name, checksum, applied_at
    from ${SCHEMA_MIGRATIONS_TABLE}
    order by name asc
  `);

  return result.rows.map((row) => ({
    name: row.name,
    checksum: row.checksum,
    appliedAt: new Date(row.applied_at).toISOString()
  }));
}

async function schemaObjectExists(queryable: SchemaQueryable, objectName: string): Promise<boolean> {
  const result = await queryable.query<{ exists: string | null }>("select to_regclass($1) as exists", [`public.${objectName}`]);
  return Boolean(result.rows[0]?.exists);
}

async function getRequiredSchemaObjectStatus(queryable: SchemaQueryable): Promise<DatabaseSchemaStatus["requiredSchemaObjects"]> {
  const tableChecks = await Promise.all(
    REQUIRED_AUTH_RUNTIME_TABLES.map(async (table) => ({
      name: table,
      exists: await schemaObjectExists(queryable, table)
    }))
  );
  const indexChecks = await Promise.all(
    REQUIRED_AUTH_RUNTIME_INDEXES.map(async (index) => ({
      name: index,
      exists: await schemaObjectExists(queryable, index)
    }))
  );

  return {
    tables: [...REQUIRED_AUTH_RUNTIME_TABLES],
    indexes: [...REQUIRED_AUTH_RUNTIME_INDEXES],
    missingTables: tableChecks.filter((check) => !check.exists).map((check) => check.name),
    missingIndexes: indexChecks.filter((check) => !check.exists).map((check) => check.name)
  };
}

function summarizeDatabaseSchemaStatus(params: {
  missingMetadataTable: boolean;
  pendingMigrations: string[];
  driftedMigrations: string[];
  requiredSchemaObjects?: DatabaseSchemaStatus["requiredSchemaObjects"];
}): Pick<DatabaseSchemaStatus, "ready" | "failureReason"> {
  if (params.driftedMigrations.length > 0) {
    return {
      ready: false,
      failureReason: "migration_drift"
    };
  }

  if (params.pendingMigrations.length > 0) {
    return {
      ready: false,
      failureReason: params.missingMetadataTable ? "metadata_missing" : "pending_migrations"
    };
  }

  if (
    params.requiredSchemaObjects &&
    (params.requiredSchemaObjects.missingTables.length > 0 || params.requiredSchemaObjects.missingIndexes.length > 0)
  ) {
    return {
      ready: false,
      failureReason: "required_schema_missing"
    };
  }

  return {
    ready: true,
    failureReason: null
  };
}

export async function getDatabaseSchemaStatus(options?: {
  databaseUrl?: string;
  pool?: Pool;
  migrationsDir?: string;
}): Promise<DatabaseSchemaStatus> {
  const expectedMigrations = await listExpectedMigrations({
    migrationsDir: options?.migrationsDir
  });

  return withSchemaQueryable(
    {
      databaseUrl: options?.databaseUrl,
      pool: options?.pool
    },
    async (queryable) => {
      try {
        await queryable.query("select 1");
      } catch {
        return createEmptySchemaStatus({
          reachable: false,
          failureReason: "unreachable"
        });
      }

      const metadataTableResult = await queryable.query<{ exists: string | null }>(
        `select to_regclass('public.${SCHEMA_MIGRATIONS_TABLE}') as exists`
      );
      const metadataTableExists = Boolean(metadataTableResult.rows[0]?.exists);

      if (!metadataTableExists) {
        const pendingMigrations = expectedMigrations.map((migration) => migration.name);
        const summary = summarizeDatabaseSchemaStatus({
          missingMetadataTable: true,
          pendingMigrations,
          driftedMigrations: []
        });

        return createEmptySchemaStatus({
          ...summary,
          missingMetadataTable: true,
          pendingMigrations
        });
      }

      const appliedRows = await loadAppliedMigrationRows(queryable);
      const requiredSchemaObjects = await getRequiredSchemaObjectStatus(queryable);
      const appliedByName = new Map(appliedRows.map((row) => [row.name, row]));
      const expectedMigrationNames = new Set(expectedMigrations.map((migration) => migration.name));
      const pendingMigrations: string[] = [];
      const driftedMigrations: string[] = [];

      for (const migration of expectedMigrations) {
        const applied = appliedByName.get(migration.name);

        if (!applied) {
          pendingMigrations.push(migration.name);
          continue;
        }

        if (applied.checksum !== migration.checksum) {
          driftedMigrations.push(migration.name);
        }
      }

      for (const applied of appliedRows) {
        if (!expectedMigrationNames.has(applied.name)) {
          driftedMigrations.push(applied.name);
        }
      }

      const summary = summarizeDatabaseSchemaStatus({
        missingMetadataTable: false,
        pendingMigrations,
        driftedMigrations,
        requiredSchemaObjects
      });

      return createEmptySchemaStatus({
        ...summary,
        missingMetadataTable: false,
        appliedMigrations: appliedRows.map((row) => row.name),
        pendingMigrations,
        driftedMigrations,
        requiredSchemaObjects,
        lastAppliedAt: appliedRows.length > 0 ? appliedRows[appliedRows.length - 1]?.appliedAt ?? null : null
      });
    }
  );
}
