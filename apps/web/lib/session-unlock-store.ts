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

export type SessionUnlockStateStore = {
  scope: "process-local" | "shared";
  getRecord(key: string, now?: number): UnlockAttemptRecord | null;
  recordFailure(key: string, now?: number): UnlockAttemptRecord;
  clear(key: string): void;
  reset(): void;
};

class InMemorySessionUnlockStateStore implements SessionUnlockStateStore {
  readonly scope = "process-local" as const;
  private readonly attempts = new Map<string, UnlockAttemptRecord>();

  getRecord(key: string, now = Date.now()): UnlockAttemptRecord | null {
    this.cleanup(now);
    const record = this.attempts.get(key);
    return record ? { ...record } : null;
  }

  recordFailure(key: string, now = Date.now()): UnlockAttemptRecord {
    this.cleanup(now);

    const existing = this.attempts.get(key);

    if (existing && existing.blockedUntil > now) {
      const blockedRecord = {
        ...existing,
        lastSeenAt: now
      };

      this.attempts.set(key, blockedRecord);
      return { ...blockedRecord };
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
    return { ...nextRecord };
  }

  clear(key: string): void {
    this.attempts.delete(key);
  }

  reset(): void {
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
