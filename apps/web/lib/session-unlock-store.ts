import { createPostgresSessionUnlockStateStore } from "./shared-auth-state-db";
import { shouldUseSharedAuthState } from "./shared-auth-state-config";

const UNLOCK_WINDOW_MS = 10 * 60 * 1000;
const UNLOCK_BLOCK_MS = 15 * 60 * 1000;
const MAX_FAILED_UNLOCK_ATTEMPTS = 5;
const MAX_TRACKED_CLIENTS = 512;
const STALE_ENTRY_TTL_MS = Math.max(UNLOCK_WINDOW_MS, UNLOCK_BLOCK_MS) * 2;

export type UnlockAttemptRecord = {
  blockedUntil: number;
  firstFailureAt: number;
  lastSeenAt: number;
  failures: number;
};

export type UnlockRateLimitStatus = {
  retryAfterSeconds: number;
  throttled: boolean;
};

export type SessionUnlockStateStore = {
  scope: "process-local" | "shared";
  getStatus(key: string, now?: number): Promise<UnlockRateLimitStatus>;
  recordFailure(key: string, now?: number): Promise<UnlockRateLimitStatus>;
  clear(key: string): Promise<void>;
  reset(): Promise<void>;
};

class InMemorySessionUnlockStateStore implements SessionUnlockStateStore {
  readonly scope = "process-local" as const;
  private readonly attempts = new Map<string, UnlockAttemptRecord>();

  async getStatus(key: string, now = Date.now()): Promise<UnlockRateLimitStatus> {
    this.cleanup(now);
    const record = this.attempts.get(key);

    if (!record || record.blockedUntil <= now) {
      return {
        throttled: false,
        retryAfterSeconds: 0
      };
    }

    return {
      throttled: true,
      retryAfterSeconds: Math.max(1, Math.ceil((record.blockedUntil - now) / 1000))
    };
  }

  async recordFailure(key: string, now = Date.now()): Promise<UnlockRateLimitStatus> {
    this.cleanup(now);

    const existing = this.attempts.get(key);

    if (existing && existing.blockedUntil > now) {
      const blockedRecord = {
        ...existing,
        lastSeenAt: now
      };

      this.attempts.set(key, blockedRecord);
      return {
        throttled: true,
        retryAfterSeconds: Math.max(1, Math.ceil((blockedRecord.blockedUntil - now) / 1000))
      };
    }

    const shouldResetWindow = !existing || now - existing.firstFailureAt > UNLOCK_WINDOW_MS;
    const nextRecord: UnlockAttemptRecord = shouldResetWindow
      ? {
          blockedUntil: 0,
          firstFailureAt: now,
          lastSeenAt: now,
          failures: 1
        }
      : {
          blockedUntil: 0,
          firstFailureAt: existing.firstFailureAt,
          lastSeenAt: now,
          failures: existing.failures + 1
        };

    if (nextRecord.failures >= MAX_FAILED_UNLOCK_ATTEMPTS) {
      nextRecord.blockedUntil = now + UNLOCK_BLOCK_MS;
    }

    this.attempts.set(key, nextRecord);

    if (nextRecord.blockedUntil > now) {
      return {
        throttled: true,
        retryAfterSeconds: Math.max(1, Math.ceil((nextRecord.blockedUntil - now) / 1000))
      };
    }

    return {
      throttled: false,
      retryAfterSeconds: 0
    };
  }

  async clear(key: string): Promise<void> {
    this.attempts.delete(key);
  }

  async reset(): Promise<void> {
    this.attempts.clear();
  }

  private cleanup(now: number): void {
    for (const [key, record] of this.attempts.entries()) {
      const expired = record.blockedUntil <= now && now - record.lastSeenAt > STALE_ENTRY_TTL_MS;

      if (expired) {
        this.attempts.delete(key);
      }
    }

    if (this.attempts.size <= MAX_TRACKED_CLIENTS) {
      return;
    }

    const overflow = [...this.attempts.entries()]
      .sort((left, right) => left[1].lastSeenAt - right[1].lastSeenAt)
      .slice(0, this.attempts.size - MAX_TRACKED_CLIENTS);

    for (const [key] of overflow) {
      this.attempts.delete(key);
    }
  }
}

declare global {
  var __agenticSessionUnlockStateStore: SessionUnlockStateStore | undefined;
}

function createDefaultSessionUnlockStateStore(): SessionUnlockStateStore {
  if (shouldUseSharedAuthState()) {
    return createPostgresSessionUnlockStateStore();
  }

  return new InMemorySessionUnlockStateStore();
}

export function getSessionUnlockStateStore(): SessionUnlockStateStore {
  globalThis.__agenticSessionUnlockStateStore ??= createDefaultSessionUnlockStateStore();
  return globalThis.__agenticSessionUnlockStateStore;
}

export function setSessionUnlockStateStoreForTesting(store: SessionUnlockStateStore): void {
  globalThis.__agenticSessionUnlockStateStore = store;
}

export function resetSessionUnlockStateStoreForTesting(): void {
  globalThis.__agenticSessionUnlockStateStore = createDefaultSessionUnlockStateStore();
}
