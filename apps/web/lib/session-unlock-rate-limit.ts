const UNLOCK_WINDOW_MS = 10 * 60 * 1000;
const UNLOCK_BLOCK_MS = 15 * 60 * 1000;
const MAX_FAILED_UNLOCK_ATTEMPTS = 5;
const MAX_TRACKED_CLIENTS = 512;
const STALE_ENTRY_TTL_MS = Math.max(UNLOCK_WINDOW_MS, UNLOCK_BLOCK_MS) * 2;

type UnlockAttemptRecord = {
  blockedUntil: number;
  firstFailureAt: number;
  lastSeenAt: number;
  failures: number;
};

type UnlockRateLimitStatus = {
  retryAfterSeconds: number;
  throttled: boolean;
};

declare global {
  var __agenticSessionUnlockAttempts: Map<string, UnlockAttemptRecord> | undefined;
}

function getUnlockAttemptStore(): Map<string, UnlockAttemptRecord> {
  globalThis.__agenticSessionUnlockAttempts ??= new Map<string, UnlockAttemptRecord>();
  return globalThis.__agenticSessionUnlockAttempts;
}

function parseForwardedFor(header: string | null): string | null {
  if (!header) {
    return null;
  }

  const candidate = header
    .split(",")[0]
    ?.trim()
    .toLowerCase();

  return candidate || null;
}

function getClientIdentifier(request: Request): string {
  const forwardedFor = parseForwardedFor(request.headers.get("x-forwarded-for"));
  const realIp = request.headers.get("x-real-ip")?.trim().toLowerCase();
  const connectingIp = request.headers.get("cf-connecting-ip")?.trim().toLowerCase();
  const userAgent = request.headers.get("user-agent")?.trim().slice(0, 200).toLowerCase();

  return forwardedFor ?? realIp ?? connectingIp ?? `ua:${userAgent || "unknown"}`;
}

function cleanupUnlockAttemptStore(store: Map<string, UnlockAttemptRecord>, now: number) {
  for (const [key, record] of store.entries()) {
    const expired = record.blockedUntil <= now && now - record.lastSeenAt > STALE_ENTRY_TTL_MS;

    if (expired) {
      store.delete(key);
    }
  }

  if (store.size <= MAX_TRACKED_CLIENTS) {
    return;
  }

  const overflow = [...store.entries()]
    .sort((left, right) => left[1].lastSeenAt - right[1].lastSeenAt)
    .slice(0, store.size - MAX_TRACKED_CLIENTS);

  for (const [key] of overflow) {
    store.delete(key);
  }
}

function buildStatus(record: UnlockAttemptRecord, now: number): UnlockRateLimitStatus {
  return {
    throttled: record.blockedUntil > now,
    retryAfterSeconds: Math.max(1, Math.ceil((record.blockedUntil - now) / 1000))
  };
}

export function getSessionUnlockRateLimitStatus(request: Request, now = Date.now()): UnlockRateLimitStatus {
  const store = getUnlockAttemptStore();

  cleanupUnlockAttemptStore(store, now);

  const record = store.get(getClientIdentifier(request));

  if (!record || record.blockedUntil <= now) {
    return {
      throttled: false,
      retryAfterSeconds: 0
    };
  }

  return buildStatus(record, now);
}

export function recordFailedSessionUnlockAttempt(request: Request, now = Date.now()): UnlockRateLimitStatus {
  const store = getUnlockAttemptStore();
  const key = getClientIdentifier(request);
  const existing = store.get(key);

  cleanupUnlockAttemptStore(store, now);

  if (existing && existing.blockedUntil > now) {
    existing.lastSeenAt = now;
    return buildStatus(existing, now);
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

  store.set(key, nextRecord);

  if (nextRecord.blockedUntil > now) {
    return buildStatus(nextRecord, now);
  }

  return {
    throttled: false,
    retryAfterSeconds: 0
  };
}

export function clearFailedSessionUnlockAttempts(request: Request) {
  getUnlockAttemptStore().delete(getClientIdentifier(request));
}

export function resetSessionUnlockRateLimit() {
  getUnlockAttemptStore().clear();
}
