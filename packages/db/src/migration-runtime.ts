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
const LEGACY_AGENT_DEFINITIONS_BOOTSTRAP_SQL = `
  create table if not exists agent_definitions (
    id text primary key,
    user_id text not null,
    name text not null,
    display_name text not null,
    description text not null,
    icon text not null,
    category text not null,
    tags jsonb not null default '[]'::jsonb,
    system_prompt text not null,
    prompt_variables jsonb not null default '[]'::jsonb,
    artifact_type text not null,
    behavior_config jsonb not null default '{}'::jsonb,
    allowed_capabilities jsonb not null default '[]'::jsonb,
    blocked_capabilities jsonb not null default '[]'::jsonb,
    max_risk_class text not null,
    integration_permissions jsonb not null default '[]'::jsonb,
    memory_permissions jsonb not null default '[]'::jsonb,
    actor_context jsonb,
    is_built_in boolean not null default false,
    parent_agent_id text,
    version integer not null,
    status text not null,
    created_at timestamptz not null,
    updated_at timestamptz not null
  );

  create unique index if not exists agent_definitions_user_name_idx
    on agent_definitions (user_id, name);
`;

type MigrationQueryable = Pick<Pool, "query"> | PoolClient;

export type DatabaseMigrationFile = {
  name: string;
  absolutePath: string;
  checksum: string;
  sql: string;
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

export class DatabaseSchemaNotReadyError extends Error {
  constructor(
    message: string,
    public readonly status: DatabaseSchemaStatus
  ) {
    super(message);
    this.name = "DatabaseSchemaNotReadyError";
  }
}

function resolveMigrationsDir(migrationsDir?: string): string {
  return path.resolve(migrationsDir ?? DEFAULT_MIGRATIONS_DIR);
}

function hashMigration(sql: string): string {
  return crypto.createHash("sha256").update(sql, "utf8").digest("hex");
}

function isPoolClient(queryable: MigrationQueryable): queryable is PoolClient {
  return typeof (queryable as PoolClient).release === "function";
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

async function withMigrationQueryable<T>(
  params: { databaseUrl?: string; pool?: Pool },
  callback: (queryable: MigrationQueryable) => Promise<T>
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

async function ensureMigrationMetadataTable(queryable: MigrationQueryable): Promise<void> {
  await queryable.query(`
    create table if not exists ${SCHEMA_MIGRATIONS_TABLE} (
      name text primary key,
      checksum text not null,
      applied_at timestamptz not null default now()
    )
  `);
}

async function ensureLegacyMigrationBootstrapTables(queryable: MigrationQueryable): Promise<void> {
  // `0001_init.sql` alters `agent_definitions` before it creates the table. Bootstrap the
  // final table shape first so fresh databases can apply the legacy migration without drift.
  await queryable.query(LEGACY_AGENT_DEFINITIONS_BOOTSTRAP_SQL);
}

async function loadAppliedMigrationRows(
  queryable: MigrationQueryable
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

async function schemaObjectExists(queryable: MigrationQueryable, objectName: string): Promise<boolean> {
  const result = await queryable.query<{ exists: string | null }>("select to_regclass($1) as exists", [`public.${objectName}`]);
  return Boolean(result.rows[0]?.exists);
}

async function getRequiredSchemaObjectStatus(queryable: MigrationQueryable): Promise<DatabaseSchemaStatus["requiredSchemaObjects"]> {
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

function buildSchemaNotReadyMessage(status: DatabaseSchemaStatus): string {
  switch (status.failureReason) {
    case "unreachable":
      return "Database is unreachable.";
    case "metadata_missing":
    case "pending_migrations":
      return "Database schema is not ready. Run database migrations before starting the application.";
    case "migration_drift":
      return "Database migration metadata does not match the checked-in migration files.";
    case "required_schema_missing":
      return "Database schema is missing required runtime tables or indexes. Run database migrations before starting the application.";
    default:
      return "Database schema is not ready.";
  }
}

export async function listMigrationFiles(options?: { migrationsDir?: string }): Promise<DatabaseMigrationFile[]> {
  const migrationsDir = resolveMigrationsDir(options?.migrationsDir);
  const entries = await readdir(migrationsDir, { withFileTypes: true });
  const migrationNames = entries
    .filter((entry) => entry.isFile() && entry.name.endsWith(".sql"))
    .map((entry) => entry.name)
    .sort((left, right) => left.localeCompare(right));

  return Promise.all(
    migrationNames.map(async (name) => {
      const absolutePath = path.join(migrationsDir, name);
      const sql = await readFile(absolutePath, "utf8");

      return {
        name,
        absolutePath,
        checksum: hashMigration(sql),
        sql
      };
    })
  );
}

export async function getDatabaseSchemaStatus(options?: {
  databaseUrl?: string;
  pool?: Pool;
  migrationsDir?: string;
}): Promise<DatabaseSchemaStatus> {
  const migrationFiles = await listMigrationFiles({ migrationsDir: options?.migrationsDir });

  return withMigrationQueryable(
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
        const pendingMigrations = migrationFiles.map((migration) => migration.name);
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
      const migrationNames = new Set(migrationFiles.map((migration) => migration.name));
      const pendingMigrations: string[] = [];
      const driftedMigrations: string[] = [];

      for (const migration of migrationFiles) {
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
        if (!migrationNames.has(applied.name)) {
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
        appliedMigrations: appliedRows.map((row) => row.name),
        pendingMigrations,
        driftedMigrations: Array.from(new Set(driftedMigrations)).sort((left, right) => left.localeCompare(right)),
        requiredSchemaObjects,
        lastAppliedAt: appliedRows.length > 0 ? appliedRows[appliedRows.length - 1]!.appliedAt : null
      });
    }
  );
}

export async function assertDatabaseSchemaReady(options?: {
  databaseUrl?: string;
  pool?: Pool;
  migrationsDir?: string;
}): Promise<DatabaseSchemaStatus> {
  const status = await getDatabaseSchemaStatus(options);

  if (!status.ready) {
    throw new DatabaseSchemaNotReadyError(buildSchemaNotReadyMessage(status), status);
  }

  return status;
}

export async function runDatabaseMigrations(options?: {
  databaseUrl?: string;
  pool?: Pool;
  migrationsDir?: string;
}): Promise<DatabaseSchemaStatus> {
  const migrationFiles = await listMigrationFiles({ migrationsDir: options?.migrationsDir });

  await withMigrationQueryable(
    {
      databaseUrl: options?.databaseUrl,
      pool: options?.pool
    },
    async (queryable) => {
      try {
        await queryable.query("select 1");
      } catch {
        throw new DatabaseSchemaNotReadyError(
          "Database is unreachable.",
          createEmptySchemaStatus({
            reachable: false,
            failureReason: "unreachable"
          })
        );
      }

      await ensureMigrationMetadataTable(queryable);
      await ensureLegacyMigrationBootstrapTables(queryable);
      const appliedRows = await loadAppliedMigrationRows(queryable);
      const appliedByName = new Map(appliedRows.map((row) => [row.name, row]));

      for (const applied of appliedRows) {
        if (!migrationFiles.some((migration) => migration.name === applied.name)) {
          throw new DatabaseSchemaNotReadyError(
            "Database migration metadata does not match the checked-in migration files.",
            createEmptySchemaStatus({
              driftedMigrations: [applied.name],
              failureReason: "migration_drift"
            })
          );
        }
      }

      for (const migration of migrationFiles) {
        const applied = appliedByName.get(migration.name);

        if (applied) {
          if (applied.checksum !== migration.checksum) {
            throw new DatabaseSchemaNotReadyError(
              "Database migration metadata does not match the checked-in migration files.",
              createEmptySchemaStatus({
                driftedMigrations: [migration.name],
                failureReason: "migration_drift"
              })
            );
          }

          continue;
        }

        const client = "connect" in queryable ? await queryable.connect() : queryable;

        try {
          await client.query("BEGIN");
          await client.query(migration.sql);
          await client.query(
            `
              insert into ${SCHEMA_MIGRATIONS_TABLE} (name, checksum)
              values ($1, $2)
            `,
            [migration.name, migration.checksum]
          );
          await client.query("COMMIT");
        } catch (error) {
          await client.query("ROLLBACK");
          throw error;
        } finally {
          if (isPoolClient(client)) {
            client.release();
          }
        }
      }
    }
  );

  return getDatabaseSchemaStatus(options);
}
