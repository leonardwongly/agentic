import { Pool, type PoolClient } from "pg";
import type { AuthSessionStateStore, SessionRateLimitStatus } from "./auth-session-store";
import type { SessionUnlockStateStore, UnlockRateLimitStatus } from "./session-unlock-store";

const RATE_LIMIT_WINDOW_MS = 60_000;
const RATE_LIMIT_MAX_ATTEMPTS = 10;
const RATE_LIMIT_LOCKOUT_MS = 5 * 60_000;
const STALE_RATE_LIMIT_ENTRY_TTL_MS = 10 * 60_000;

const UNLOCK_WINDOW_MS = 10 * 60 * 1000;
const UNLOCK_BLOCK_MS = 15 * 60 * 1000;
const MAX_FAILED_UNLOCK_ATTEMPTS = 5;
const STALE_UNLOCK_ENTRY_TTL_MS = Math.max(UNLOCK_WINDOW_MS, UNLOCK_BLOCK_MS) * 2;

const CLEANUP_INTERVAL_MS = 60_000;

const REQUIRED_SHARED_AUTH_STATE_TABLES = [
  "auth_session_rate_limits",
  "auth_revoked_sessions",
  "session_unlock_attempts"
] as const;

const REQUIRED_SHARED_AUTH_STATE_INDEXES = [
  "auth_session_rate_limits_updated_at_idx",
  "auth_revoked_sessions_expires_at_idx",
  "session_unlock_attempts_last_seen_at_idx"
] as const;

type Queryable = {
  query: Pool["query"];
};

declare global {
  // eslint-disable-next-line no-var
  var __agenticSharedAuthStatePool: Pool | undefined;
  // eslint-disable-next-line no-var
  var __agenticSharedAuthStateBootstrap: Promise<void> | undefined;
  // eslint-disable-next-line no-var
  var __agenticSharedAuthStateLastCleanupAt: number | undefined;
}

export class SharedAuthStateStoreError extends Error {
  constructor(message: string, cause?: unknown) {
    super(message, { cause });
    this.name = "SharedAuthStateStoreError";
  }
}

async function schemaObjectExists(queryable: Queryable, objectName: string): Promise<boolean> {
  const result = await queryable.query<{ exists: string | null }>("select to_regclass($1) as exists", [`public.${objectName}`]);
  return Boolean(result.rows[0]?.exists);
}

async function findMissingSharedAuthStateObjects(queryable: Queryable): Promise<{
  missingTables: string[];
  missingIndexes: string[];
}> {
  const tableChecks = await Promise.all(
    REQUIRED_SHARED_AUTH_STATE_TABLES.map(async (table) => ({
      name: table,
      exists: await schemaObjectExists(queryable, table)
    }))
  );
  const indexChecks = await Promise.all(
    REQUIRED_SHARED_AUTH_STATE_INDEXES.map(async (index) => ({
      name: index,
      exists: await schemaObjectExists(queryable, index)
    }))
  );

  return {
    missingTables: tableChecks.filter((check) => !check.exists).map((check) => check.name),
    missingIndexes: indexChecks.filter((check) => !check.exists).map((check) => check.name)
  };
}

export async function assertSharedAuthStateSchemaReady(queryable: Queryable = getSharedAuthStatePool()): Promise<void> {
  const missing = await findMissingSharedAuthStateObjects(queryable);

  if (missing.missingTables.length > 0 || missing.missingIndexes.length > 0) {
    const missingObjects = [
      ...missing.missingTables.map((name) => `table:${name}`),
      ...missing.missingIndexes.map((name) => `index:${name}`)
    ].join(", ");

    throw new SharedAuthStateStoreError(
      `Shared auth state schema is not ready. Run database migrations before enabling shared auth state. Missing: ${missingObjects}.`
    );
  }
}

function requireDatabaseUrl(): string {
  const url = process.env.DATABASE_URL?.trim();

  if (!url) {
    throw new SharedAuthStateStoreError("Shared auth state requires DATABASE_URL.");
  }

  return url;
}

function getSharedAuthStatePool(): Pool {
  globalThis.__agenticSharedAuthStatePool ??= new Pool({
    connectionString: requireDatabaseUrl(),
    application_name: "agentic-auth-state",
    connectionTimeoutMillis: 2_000,
    idleTimeoutMillis: 30_000,
    max: 10,
    query_timeout: 5_000,
    statement_timeout: 5_000
  });

  return globalThis.__agenticSharedAuthStatePool;
}

async function ensureSharedAuthStateSchemaReady(): Promise<void> {
  globalThis.__agenticSharedAuthStateBootstrap ??= getSharedAuthStatePool()
    .query("select 1")
    .then(() => assertSharedAuthStateSchemaReady())
    .catch((error) => {
      globalThis.__agenticSharedAuthStateBootstrap = undefined;
      if (error instanceof SharedAuthStateStoreError) {
        throw error;
      }

      throw new SharedAuthStateStoreError("Failed to verify shared auth state schema.", error);
    });

  return globalThis.__agenticSharedAuthStateBootstrap;
}

async function withTransaction<T>(callback: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await getSharedAuthStatePool().connect();

  try {
    await client.query("BEGIN");
    const result = await callback(client);
    await client.query("COMMIT");
    return result;
  } catch (error) {
    try {
      await client.query("ROLLBACK");
    } catch {
      // Preserve the original failure so callers see the causative error.
    }

    throw error;
  } finally {
    client.release();
  }
}

function toIsoString(timestampMs: number): string {
  return new Date(timestampMs).toISOString();
}

function parseNullableTimestamp(value: unknown): number | null {
  if (value === null || value === undefined) {
    return null;
  }

  if (value instanceof Date) {
    return value.getTime();
  }

  const parsed = Date.parse(String(value));
  return Number.isFinite(parsed) ? parsed : null;
}

async function maybeRunCleanup(now = Date.now()): Promise<void> {
  const lastCleanupAt = globalThis.__agenticSharedAuthStateLastCleanupAt ?? 0;

  if (now - lastCleanupAt < CLEANUP_INTERVAL_MS) {
    return;
  }

  globalThis.__agenticSharedAuthStateLastCleanupAt = now;
  const staleRateLimitBefore = new Date(now - STALE_RATE_LIMIT_ENTRY_TTL_MS).toISOString();
  const staleUnlockBefore = new Date(now - STALE_UNLOCK_ENTRY_TTL_MS).toISOString();
  const expiredBefore = new Date(now).toISOString();

  try {
    await withTransaction(async (client) => {
      await client.query("delete from auth_session_rate_limits where updated_at < $1", [staleRateLimitBefore]);
      await client.query("delete from auth_revoked_sessions where expires_at <= $1", [expiredBefore]);
      await client.query(
        `
          delete from session_unlock_attempts
          where blocked_until <= $1
            and last_seen_at < $2
        `,
        [expiredBefore, staleUnlockBefore]
      );
    });
  } catch (error) {
    throw new SharedAuthStateStoreError("Failed to clean up shared auth state.", error);
  }
}

class PostgresAuthSessionStateStore implements AuthSessionStateStore {
  readonly scope = "shared" as const;

  async checkRateLimit(key: string, now = Date.now()): Promise<SessionRateLimitStatus> {
    try {
      await ensureSharedAuthStateSchemaReady();
      await maybeRunCleanup(now);

      return await withTransaction(async (client) => {
        await client.query(
          `
            insert into auth_session_rate_limits (key, attempts, window_start, locked_until, updated_at)
            values ($1, 0, $2, null, $2)
            on conflict (key) do nothing
          `,
          [key, toIsoString(now)]
        );

        const result = await client.query<{
          attempts: number;
          window_start: string | Date;
          locked_until: string | Date | null;
        }>(
          `
            select attempts, window_start, locked_until
            from auth_session_rate_limits
            where key = $1
            for update
          `,
          [key]
        );

        const current = result.rows[0];
        const entry = {
          attempts: current?.attempts ?? 0,
          windowStart: parseNullableTimestamp(current?.window_start) ?? now,
          lockedUntil: parseNullableTimestamp(current?.locked_until)
        };

        if (entry.lockedUntil !== null) {
          if (now < entry.lockedUntil) {
            return {
              allowed: false,
              retryAfterMs: entry.lockedUntil - now
            };
          }

          entry.attempts = 0;
          entry.windowStart = now;
          entry.lockedUntil = null;
        }

        if (now - entry.windowStart > RATE_LIMIT_WINDOW_MS) {
          entry.attempts = 0;
          entry.windowStart = now;
        }

        entry.attempts += 1;

        if (entry.attempts > RATE_LIMIT_MAX_ATTEMPTS) {
          entry.lockedUntil = now + RATE_LIMIT_LOCKOUT_MS;
        }

        await client.query(
          `
            update auth_session_rate_limits
            set attempts = $2,
                window_start = $3,
                locked_until = $4,
                updated_at = $5
            where key = $1
          `,
          [
            key,
            entry.attempts,
            toIsoString(entry.windowStart),
            entry.lockedUntil === null ? null : toIsoString(entry.lockedUntil),
            toIsoString(now)
          ]
        );

        if (entry.lockedUntil !== null && now < entry.lockedUntil) {
          return {
            allowed: false,
            retryAfterMs: entry.lockedUntil - now
          };
        }

        return {
          allowed: true,
          retryAfterMs: 0
        };
      });
    } catch (error) {
      throw new SharedAuthStateStoreError("Failed to update shared session rate limiting state.", error);
    }
  }

  async clearRateLimit(key: string): Promise<void> {
    try {
      await ensureSharedAuthStateSchemaReady();
      await getSharedAuthStatePool().query("delete from auth_session_rate_limits where key = $1", [key]);
    } catch (error) {
      throw new SharedAuthStateStoreError("Failed to clear shared session rate limit state.", error);
    }
  }

  async revokeSession(sessionId: string, expiresAtMs: number): Promise<void> {
    try {
      await ensureSharedAuthStateSchemaReady();
      await maybeRunCleanup();
      await getSharedAuthStatePool().query(
        `
          insert into auth_revoked_sessions (session_id, expires_at, revoked_at)
          values ($1, $2, $3)
          on conflict (session_id) do update
            set expires_at = excluded.expires_at,
                revoked_at = excluded.revoked_at
        `,
        [sessionId, toIsoString(expiresAtMs), new Date().toISOString()]
      );
    } catch (error) {
      throw new SharedAuthStateStoreError("Failed to persist session revocation.", error);
    }
  }

  async isSessionRevoked(sessionId: string, now = Date.now()): Promise<boolean> {
    try {
      await ensureSharedAuthStateSchemaReady();
      await getSharedAuthStatePool().query(
        "delete from auth_revoked_sessions where session_id = $1 and expires_at <= $2",
        [sessionId, toIsoString(now)]
      );

      const result = await getSharedAuthStatePool().query("select 1 from auth_revoked_sessions where session_id = $1 limit 1", [sessionId]);
      return (result.rowCount ?? 0) > 0;
    } catch (error) {
      throw new SharedAuthStateStoreError("Failed to read session revocation state.", error);
    }
  }

  async reset(): Promise<void> {
    try {
      await ensureSharedAuthStateSchemaReady();
      await withTransaction(async (client) => {
        await client.query("delete from auth_session_rate_limits");
        await client.query("delete from auth_revoked_sessions");
      });
    } catch (error) {
      throw new SharedAuthStateStoreError("Failed to reset shared auth session state.", error);
    }
  }
}

class PostgresSessionUnlockStateStore implements SessionUnlockStateStore {
  readonly scope = "shared" as const;

  async getStatus(key: string, now = Date.now()): Promise<UnlockRateLimitStatus> {
    try {
      await ensureSharedAuthStateSchemaReady();
      await maybeRunCleanup(now);
      const result = await getSharedAuthStatePool().query<{ blocked_until: string | Date }>(
        "select blocked_until from session_unlock_attempts where key = $1",
        [key]
      );
      const blockedUntil = parseNullableTimestamp(result.rows[0]?.blocked_until);

      if (blockedUntil === null || blockedUntil <= now) {
        return {
          throttled: false,
          retryAfterSeconds: 0
        };
      }

      return {
        throttled: true,
        retryAfterSeconds: Math.max(1, Math.ceil((blockedUntil - now) / 1000))
      };
    } catch (error) {
      throw new SharedAuthStateStoreError("Failed to read shared unlock throttling state.", error);
    }
  }

  async recordFailure(key: string, now = Date.now()): Promise<UnlockRateLimitStatus> {
    try {
      await ensureSharedAuthStateSchemaReady();
      await maybeRunCleanup(now);

      return await withTransaction(async (client) => {
        await client.query(
          `
            insert into session_unlock_attempts (key, failures, first_failure_at, last_seen_at, blocked_until)
            values ($1, 0, $2, $2, $2)
            on conflict (key) do nothing
          `,
          [key, toIsoString(now)]
        );

        const result = await client.query<{
          failures: number;
          first_failure_at: string | Date;
          last_seen_at: string | Date;
          blocked_until: string | Date;
        }>(
          `
            select failures, first_failure_at, last_seen_at, blocked_until
            from session_unlock_attempts
            where key = $1
            for update
          `,
          [key]
        );

        const current = result.rows[0];
        const existing = current
          ? {
              failures: current.failures,
              firstFailureAt: parseNullableTimestamp(current.first_failure_at) ?? now,
              lastSeenAt: parseNullableTimestamp(current.last_seen_at) ?? now,
              blockedUntil: parseNullableTimestamp(current.blocked_until) ?? 0
            }
          : null;

        if (existing && existing.blockedUntil > now) {
          await client.query(
            "update session_unlock_attempts set last_seen_at = $2 where key = $1",
            [key, toIsoString(now)]
          );
          return {
            throttled: true,
            retryAfterSeconds: Math.max(1, Math.ceil((existing.blockedUntil - now) / 1000))
          };
        }

        const shouldResetWindow = !existing || now - existing.firstFailureAt > UNLOCK_WINDOW_MS;
        const firstFailureAt = shouldResetWindow ? now : existing.firstFailureAt;
        const failures = shouldResetWindow ? 1 : existing.failures + 1;
        const blockedUntil = failures >= MAX_FAILED_UNLOCK_ATTEMPTS ? now + UNLOCK_BLOCK_MS : 0;

        await client.query(
          `
            update session_unlock_attempts
            set failures = $2,
                first_failure_at = $3,
                last_seen_at = $4,
                blocked_until = $5
            where key = $1
          `,
          [
            key,
            failures,
            toIsoString(firstFailureAt),
            toIsoString(now),
            toIsoString(blockedUntil)
          ]
        );

        if (blockedUntil > now) {
          return {
            throttled: true,
            retryAfterSeconds: Math.max(1, Math.ceil((blockedUntil - now) / 1000))
          };
        }

        return {
          throttled: false,
          retryAfterSeconds: 0
        };
      });
    } catch (error) {
      throw new SharedAuthStateStoreError("Failed to update shared unlock throttling state.", error);
    }
  }

  async clear(key: string): Promise<void> {
    try {
      await ensureSharedAuthStateSchemaReady();
      await getSharedAuthStatePool().query("delete from session_unlock_attempts where key = $1", [key]);
    } catch (error) {
      throw new SharedAuthStateStoreError("Failed to clear shared unlock throttling state.", error);
    }
  }

  async reset(): Promise<void> {
    try {
      await ensureSharedAuthStateSchemaReady();
      await getSharedAuthStatePool().query("delete from session_unlock_attempts");
    } catch (error) {
      throw new SharedAuthStateStoreError("Failed to reset shared unlock throttling state.", error);
    }
  }
}

export function createPostgresAuthSessionStateStore(): AuthSessionStateStore {
  return new PostgresAuthSessionStateStore();
}

export function createPostgresSessionUnlockStateStore(): SessionUnlockStateStore {
  return new PostgresSessionUnlockStateStore();
}
