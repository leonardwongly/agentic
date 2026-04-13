import { createPostgresAuthSessionStateStore } from "./shared-auth-state-db";
import { shouldUseSharedAuthState } from "./shared-auth-state-config";

export type SessionRateLimitEntry = {
  attempts: number;
  windowStart: number;
  lockedUntil: number | null;
};

export type SessionRateLimitStatus = {
  allowed: boolean;
  retryAfterMs: number;
};

export type AuthSessionStateStore = {
  scope: "process-local" | "shared";
  checkRateLimit(key: string, now?: number): Promise<SessionRateLimitStatus>;
  clearRateLimit(key: string): Promise<void>;
  revokeSession(sessionId: string, expiresAtMs: number): Promise<void>;
  isSessionRevoked(sessionId: string, now?: number): Promise<boolean>;
  reset(): Promise<void>;
};

type StoredRateLimitEntry = {
  entry: SessionRateLimitEntry;
  touchedAt: number;
};

const STALE_RATE_LIMIT_ENTRY_TTL_MS = 10 * 60_000;
const MAX_TRACKED_RATE_LIMIT_ENTRIES = 2_048;

class InMemoryAuthSessionStateStore implements AuthSessionStateStore {
  readonly scope = "process-local" as const;
  private readonly rateLimits = new Map<string, StoredRateLimitEntry>();
  private readonly revokedSessionIds = new Map<string, number>();

  async checkRateLimit(key: string, now = Date.now()): Promise<SessionRateLimitStatus> {
    this.cleanupRateLimits(now);
    const entry: SessionRateLimitEntry = this.rateLimits.get(key)?.entry ?? {
      attempts: 0,
      windowStart: now,
      lockedUntil: null
    };

    if (entry.lockedUntil !== null) {
      if (now < entry.lockedUntil) {
        return { allowed: false, retryAfterMs: entry.lockedUntil - now };
      }

      entry.attempts = 0;
      entry.windowStart = now;
      entry.lockedUntil = null;
    }

    if (now - entry.windowStart > 60_000) {
      entry.attempts = 0;
      entry.windowStart = now;
    }

    entry.attempts += 1;
    this.rateLimits.set(key, {
      entry: { ...entry },
      touchedAt: now
    });
    this.trimRateLimits();

    if (entry.attempts > 10) {
      entry.lockedUntil = now + 5 * 60_000;
      this.rateLimits.set(key, {
        entry: { ...entry },
        touchedAt: now
      });
      return {
        allowed: false,
        retryAfterMs: 5 * 60_000
      };
    }

    return { allowed: true, retryAfterMs: 0 };
  }

  async clearRateLimit(key: string): Promise<void> {
    this.rateLimits.delete(key);
  }

  async revokeSession(sessionId: string, expiresAtMs: number): Promise<void> {
    this.cleanupRevokedSessions();
    this.revokedSessionIds.set(sessionId, expiresAtMs);
  }

  async isSessionRevoked(sessionId: string, now = Date.now()): Promise<boolean> {
    this.cleanupRevokedSessions(now);
    return this.revokedSessionIds.has(sessionId);
  }

  async reset(): Promise<void> {
    this.rateLimits.clear();
    this.revokedSessionIds.clear();
  }

  private cleanupRateLimits(now = Date.now()) {
    for (const [key, stored] of this.rateLimits.entries()) {
      if (now - stored.touchedAt > STALE_RATE_LIMIT_ENTRY_TTL_MS) {
        this.rateLimits.delete(key);
      }
    }
  }

  private trimRateLimits() {
    if (this.rateLimits.size <= MAX_TRACKED_RATE_LIMIT_ENTRIES) {
      return;
    }

    const overflow = [...this.rateLimits.entries()]
      .sort((left, right) => left[1].touchedAt - right[1].touchedAt)
      .slice(0, this.rateLimits.size - MAX_TRACKED_RATE_LIMIT_ENTRIES);

    for (const [key] of overflow) {
      this.rateLimits.delete(key);
    }
  }

  private cleanupRevokedSessions(now = Date.now()) {
    for (const [sessionId, expiresAtMs] of this.revokedSessionIds.entries()) {
      if (expiresAtMs <= now) {
        this.revokedSessionIds.delete(sessionId);
      }
    }
  }
}

declare global {
  var __agenticAuthSessionStateStore: AuthSessionStateStore | undefined;
}

function createDefaultAuthSessionStateStore(): AuthSessionStateStore {
  if (shouldUseSharedAuthState()) {
    return createPostgresAuthSessionStateStore();
  }

  return new InMemoryAuthSessionStateStore();
}

export function getAuthSessionStateStore(): AuthSessionStateStore {
  globalThis.__agenticAuthSessionStateStore ??= createDefaultAuthSessionStateStore();
  return globalThis.__agenticAuthSessionStateStore;
}

export function setAuthSessionStateStoreForTesting(store: AuthSessionStateStore): void {
  globalThis.__agenticAuthSessionStateStore = store;
}

export function resetAuthSessionStateStoreForTesting(): void {
  globalThis.__agenticAuthSessionStateStore = createDefaultAuthSessionStateStore();
}
