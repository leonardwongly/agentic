import { describe, expect, it } from "vitest";
import { assertSharedAuthStateSchemaReady } from "../apps/web/lib/shared-auth-state-db";

const REQUIRED_AUTH_RUNTIME_OBJECTS = new Set([
  "auth_session_rate_limits",
  "auth_revoked_sessions",
  "session_unlock_attempts",
  "auth_session_rate_limits_updated_at_idx",
  "auth_revoked_sessions_expires_at_idx",
  "session_unlock_attempts_last_seen_at_idx"
]);

class FakeSharedAuthQueryable {
  readonly queries: string[] = [];

  constructor(private readonly schemaObjects: Set<string>) {}

  async query(sql: string, params?: unknown[]) {
    const normalized = sql.trim();
    this.queries.push(normalized);

    if (normalized !== "select to_regclass($1) as exists") {
      throw new Error(`Unexpected query: ${normalized}`);
    }

    const objectName = String((params ?? [])[0] ?? "").replace(/^public\./u, "");
    return {
      rows: [{ exists: this.schemaObjects.has(objectName) ? objectName : null }]
    };
  }
}

describe("shared auth state database schema", () => {
  it("verifies required migration-managed tables and indexes without creating them at runtime", async () => {
    const queryable = new FakeSharedAuthQueryable(REQUIRED_AUTH_RUNTIME_OBJECTS);

    await expect(assertSharedAuthStateSchemaReady(queryable as never)).resolves.toBeUndefined();
    expect(queryable.queries).toHaveLength(6);
    expect(queryable.queries.some((query) => /create\s+(table|index)/iu.test(query))).toBe(false);
  });

  it("rejects missing shared auth runtime tables and indexes with actionable detail", async () => {
    const schemaObjects = new Set(REQUIRED_AUTH_RUNTIME_OBJECTS);
    schemaObjects.delete("auth_session_rate_limits");
    schemaObjects.delete("auth_session_rate_limits_updated_at_idx");
    const queryable = new FakeSharedAuthQueryable(schemaObjects);

    await expect(assertSharedAuthStateSchemaReady(queryable as never)).rejects.toThrow(
      /Missing: table:auth_session_rate_limits, index:auth_session_rate_limits_updated_at_idx/u
    );
  });
});
