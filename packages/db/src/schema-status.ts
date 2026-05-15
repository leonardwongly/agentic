import { Pool, type PoolClient } from "pg";
import {
  getRequiredAuthRuntimeSchemaObjectStatus,
  REQUIRED_AUTH_RUNTIME_INDEXES,
  REQUIRED_AUTH_RUNTIME_TABLES,
  type AuthRuntimeSchemaObjectStatus
} from "./auth-runtime-schema";
import { CHECKED_IN_MIGRATIONS, type CheckedInMigration } from "./migration-manifest";

const SCHEMA_MIGRATIONS_TABLE = "agentic_schema_migrations";

type SchemaQueryable = Pick<Pool, "query"> | PoolClient;
type ExpectedMigration = CheckedInMigration;

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
  requiredSchemaObjects: AuthRuntimeSchemaObjectStatus;
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
  expectedMigrations?: readonly ExpectedMigration[];
}): Promise<DatabaseSchemaStatus> {
  const expectedMigrations = options?.expectedMigrations ?? CHECKED_IN_MIGRATIONS;

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

      const metadataTableResult = await queryable.query<{ exists: string | null }>("select to_regclass($1) as exists", [
        SCHEMA_MIGRATIONS_TABLE
      ]);
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
      const requiredSchemaObjects = await getRequiredAuthRuntimeSchemaObjectStatus(queryable);
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
