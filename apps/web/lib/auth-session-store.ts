export type SessionRateLimitEntry = {
  attempts: number;
  windowStart: number;
  lockedUntil: number | null;
};

export type AuthSessionStateStore = {
  getRateLimitEntry(key: string): SessionRateLimitEntry | null;
  setRateLimitEntry(key: string, entry: SessionRateLimitEntry): void;
  deleteRateLimitEntry(key: string): void;
  revokeSession(sessionId: string, expiresAtMs: number): void;
  isSessionRevoked(sessionId: string, now?: number): boolean;
  reset(): void;
};

type StoredRateLimitEntry = {
  entry: SessionRateLimitEntry;
  touchedAt: number;
};

const STALE_RATE_LIMIT_ENTRY_TTL_MS = 10 * 60_000;
const MAX_TRACKED_RATE_LIMIT_ENTRIES = 2_048;

class InMemoryAuthSessionStateStore implements AuthSessionStateStore {
  private readonly rateLimits = new Map<string, StoredRateLimitEntry>();
  private readonly revokedSessionIds = new Map<string, number>();

  getRateLimitEntry(key: string): SessionRateLimitEntry | null {
    this.cleanupRateLimits();
    const stored = this.rateLimits.get(key);
    return stored ? { ...stored.entry } : null;
  }

  setRateLimitEntry(key: string, entry: SessionRateLimitEntry): void {
    this.cleanupRateLimits();
    this.rateLimits.set(key, {
      entry: { ...entry },
      touchedAt: Date.now()
    });

    this.trimRateLimits();
  }

  deleteRateLimitEntry(key: string): void {
    this.rateLimits.delete(key);
  }

  revokeSession(sessionId: string, expiresAtMs: number): void {
    this.cleanupRevokedSessions();
    this.revokedSessionIds.set(sessionId, expiresAtMs);
  }

  isSessionRevoked(sessionId: string, now = Date.now()): boolean {
    this.cleanupRevokedSessions(now);
    return this.revokedSessionIds.has(sessionId);
  }

  reset(): void {
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
