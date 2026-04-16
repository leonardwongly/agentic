import { getSessionUnlockStateStore, type UnlockRateLimitStatus } from "./session-unlock-store";
import { getRequestClientKey } from "./request-client-identity";

export async function getSessionUnlockRateLimitStatus(request: Request, now = Date.now()): Promise<UnlockRateLimitStatus> {
  return getSessionUnlockStateStore().getStatus(getRequestClientKey(request), now);
}

export async function recordFailedSessionUnlockAttempt(request: Request, now = Date.now()): Promise<UnlockRateLimitStatus> {
  return getSessionUnlockStateStore().recordFailure(getRequestClientKey(request), now);
}

export async function clearFailedSessionUnlockAttempts(request: Request) {
  await getSessionUnlockStateStore().clear(getRequestClientKey(request));
}

export async function resetSessionUnlockRateLimit() {
  await getSessionUnlockStateStore().reset();
}
