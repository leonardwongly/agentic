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
  if (objectNames.length === 0) {
    return [];
  }

  const result = await queryable.query<{ name: string; exists: string | null }>(
    `
      select object_name as name, to_regclass(object_name) as exists
      from unnest($1::text[]) as object_names(object_name)
    `,
    [[...objectNames]]
  );
  const existsByName = new Map(result.rows.map((row) => [row.name, Boolean(row.exists)]));

  return objectNames.map((objectName) => ({
    name: objectName,
    exists: existsByName.get(objectName) ?? false
  }));
}

export async function getRequiredAuthRuntimeSchemaObjectStatus(
  queryable: SchemaObjectQueryable
): Promise<AuthRuntimeSchemaObjectStatus> {
  const requiredTables = [...REQUIRED_AUTH_RUNTIME_TABLES];
  const requiredIndexes = [...REQUIRED_AUTH_RUNTIME_INDEXES];
  const objectChecks = await getSchemaObjectChecks(queryable, [...requiredTables, ...requiredIndexes]);
  const missingObjects = new Set(objectChecks.filter((check) => !check.exists).map((check) => check.name));

  return {
    tables: requiredTables,
    indexes: requiredIndexes,
    missingTables: requiredTables.filter((objectName) => missingObjects.has(objectName)),
    missingIndexes: requiredIndexes.filter((objectName) => missingObjects.has(objectName))
  };
}
