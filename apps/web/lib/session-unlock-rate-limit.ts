import { getSessionUnlockStateStore } from "./session-unlock-store";

type UnlockRateLimitStatus = {
  retryAfterSeconds: number;
  throttled: boolean;
};

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

function buildStatus(blockedUntil: number, now: number): UnlockRateLimitStatus {
  return {
    throttled: blockedUntil > now,
    retryAfterSeconds: Math.max(1, Math.ceil((blockedUntil - now) / 1000))
  };
}

export function getSessionUnlockRateLimitStatus(request: Request, now = Date.now()): UnlockRateLimitStatus {
  const record = getSessionUnlockStateStore().getRecord(getClientIdentifier(request), now);

  if (!record || record.blockedUntil <= now) {
    return {
      throttled: false,
      retryAfterSeconds: 0
    };
  }

  return buildStatus(record.blockedUntil, now);
}

export function recordFailedSessionUnlockAttempt(request: Request, now = Date.now()): UnlockRateLimitStatus {
  const nextRecord = getSessionUnlockStateStore().recordFailure(getClientIdentifier(request), now);

  if (nextRecord.blockedUntil > now) {
    return buildStatus(nextRecord.blockedUntil, now);
  }

  return {
    throttled: false,
    retryAfterSeconds: 0
  };
}

export function clearFailedSessionUnlockAttempts(request: Request) {
  getSessionUnlockStateStore().clear(getClientIdentifier(request));
}

export function resetSessionUnlockRateLimit() {
  getSessionUnlockStateStore().reset();
}
