import type { QueryResult, QueryResultRow } from "pg";

export const REQUIRED_AUTH_RUNTIME_TABLES = [
  "auth_session_rate_limits",
  "auth_revoked_sessions",
  "session_unlock_attempts"
] as const;

export const REQUIRED_AUTH_RUNTIME_INDEXES = [
  "auth_session_rate_limits_updated_at_idx",
  "auth_revoked_sessions_expires_at_idx",
  "session_unlock_attempts_last_seen_at_idx"
] as const;

export type AuthRuntimeSchemaObjectStatus = {
  tables: string[];
  indexes: string[];
  missingTables: string[];
  missingIndexes: string[];
};

export type SchemaObjectQueryable = {
  query: <T extends QueryResultRow = QueryResultRow>(text: string, values?: unknown[]) => Promise<QueryResult<T>>;
};

export async function schemaObjectExists(queryable: SchemaObjectQueryable, objectName: string): Promise<boolean> {
  const result = await queryable.query<{ exists: string | null }>("select to_regclass($1) as exists", [objectName]);
  return Boolean(result.rows[0]?.exists);
}

export async function getSchemaObjectChecks(
  queryable: SchemaObjectQueryable,
  objectNames: readonly string[]
): Promise<Array<{ name: string; exists: boolean }>> {
  return Promise.all(
    objectNames.map(async (objectName) => ({
      name: objectName,
      exists: await schemaObjectExists(queryable, objectName)
    }))
  );
}

export async function getRequiredAuthRuntimeSchemaObjectStatus(
  queryable: SchemaObjectQueryable
): Promise<AuthRuntimeSchemaObjectStatus> {
  const tableChecks = await getSchemaObjectChecks(queryable, REQUIRED_AUTH_RUNTIME_TABLES);
  const indexChecks = await getSchemaObjectChecks(queryable, REQUIRED_AUTH_RUNTIME_INDEXES);

  return {
    tables: [...REQUIRED_AUTH_RUNTIME_TABLES],
    indexes: [...REQUIRED_AUTH_RUNTIME_INDEXES],
    missingTables: tableChecks.filter((check) => !check.exists).map((check) => check.name),
    missingIndexes: indexChecks.filter((check) => !check.exists).map((check) => check.name)
  };
}
