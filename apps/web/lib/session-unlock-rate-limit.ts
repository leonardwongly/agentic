import { getSessionUnlockStateStore, type UnlockRateLimitStatus } from "./session-unlock-store";

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

export async function getSessionUnlockRateLimitStatus(request: Request, now = Date.now()): Promise<UnlockRateLimitStatus> {
  return getSessionUnlockStateStore().getStatus(getClientIdentifier(request), now);
}

export async function recordFailedSessionUnlockAttempt(request: Request, now = Date.now()): Promise<UnlockRateLimitStatus> {
  return getSessionUnlockStateStore().recordFailure(getClientIdentifier(request), now);
}

export async function clearFailedSessionUnlockAttempts(request: Request) {
  await getSessionUnlockStateStore().clear(getClientIdentifier(request));
}

export async function resetSessionUnlockRateLimit() {
  await getSessionUnlockStateStore().reset();
}
