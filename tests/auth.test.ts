import {
  AGENTIC_SESSION_COOKIE,
  AGENTIC_ACCESS_KEY_HEADER,
  buildSessionToken,
  checkSessionRateLimit,
  clearSessionCookie,
  createSessionCookie,
  getAuthMode,
  isAuthorizedSessionToken,
  parseAuthorizedSessionToken,
  requireApiSession,
  revokeSessionToken,
  verifyAccessKey
} from "../apps/web/lib/auth";
import { resetAuthSessionStateStoreForTesting, setAuthSessionStateStoreForTesting, type AuthSessionStateStore } from "../apps/web/lib/auth-session-store";
import {
  clearFailedSessionUnlockAttempts,
  getSessionUnlockRateLimitStatus,
  recordFailedSessionUnlockAttempt,
  resetSessionUnlockRateLimit
} from "../apps/web/lib/session-unlock-rate-limit";

describe("auth helpers", () => {
  const originalKey = process.env.AGENTIC_ACCESS_KEY;
  const originalNodeEnv = process.env.NODE_ENV;

  afterEach(() => {
    process.env.AGENTIC_ACCESS_KEY = originalKey;
    process.env.NODE_ENV = originalNodeEnv;
    resetSessionUnlockRateLimit();
    resetAuthSessionStateStoreForTesting();
  });

  it("verifies a configured access key and derived session token", () => {
    process.env.AGENTIC_ACCESS_KEY = "super-secret-key";
    process.env.NODE_ENV = "test";

    expect(verifyAccessKey("super-secret-key")).toBe(true);
    expect(verifyAccessKey("wrong-key")).toBe(false);

    const token = buildSessionToken();
    expect(isAuthorizedSessionToken(token)).toBe(true);
    expect(isAuthorizedSessionToken("not-a-token")).toBe(false);
    expect(parseAuthorizedSessionToken(token)).toMatchObject({
      userId: "user-primary"
    });
  });

  it("issues distinct signed session tokens and honors revocation", () => {
    process.env.AGENTIC_ACCESS_KEY = "super-secret-key";
    process.env.NODE_ENV = "test";

    const firstToken = buildSessionToken();
    const secondToken = buildSessionToken();

    expect(firstToken).not.toBe(secondToken);
    expect(isAuthorizedSessionToken(firstToken)).toBe(true);

    revokeSessionToken(firstToken);

    expect(isAuthorizedSessionToken(firstToken)).toBe(false);
    expect(isAuthorizedSessionToken(secondToken)).toBe(true);
  });

  it("supports swapping in a shared auth session state store boundary", () => {
    process.env.AGENTIC_ACCESS_KEY = "super-secret-key";
    process.env.NODE_ENV = "test";

    const rateLimitEntries = new Map<string, { attempts: number; windowStart: number; lockedUntil: number | null }>();
    const revokedSessionIds = new Map<string, number>();
    const store: AuthSessionStateStore = {
      getRateLimitEntry(key) {
        const entry = rateLimitEntries.get(key);
        return entry ? { ...entry } : null;
      },
      setRateLimitEntry(key, entry) {
        rateLimitEntries.set(key, { ...entry });
      },
      deleteRateLimitEntry(key) {
        rateLimitEntries.delete(key);
      },
      revokeSession(sessionId, expiresAtMs) {
        revokedSessionIds.set(sessionId, expiresAtMs);
      },
      isSessionRevoked(sessionId, now = Date.now()) {
        for (const [revokedId, expiresAtMs] of revokedSessionIds.entries()) {
          if (expiresAtMs <= now) {
            revokedSessionIds.delete(revokedId);
          }
        }

        return revokedSessionIds.has(sessionId);
      },
      reset() {
        rateLimitEntries.clear();
        revokedSessionIds.clear();
      }
    };

    setAuthSessionStateStoreForTesting(store);

    const token = buildSessionToken();
    const session = parseAuthorizedSessionToken(token);

    expect(session).not.toBeNull();

    for (let index = 0; index < 10; index += 1) {
      expect(checkSessionRateLimit("198.51.100.25").allowed).toBe(true);
    }

    expect(checkSessionRateLimit("198.51.100.25")).toMatchObject({
      allowed: false
    });

    revokeSessionToken(token);

    expect(revokedSessionIds.has(session!.sessionId)).toBe(true);
    expect(isAuthorizedSessionToken(token)).toBe(false);
  });

  it("reports missing configuration in production without the development fallback", () => {
    delete process.env.AGENTIC_ACCESS_KEY;
    process.env.NODE_ENV = "production";

    const authMode = getAuthMode();

    expect(authMode.requiresConfiguredKey).toBe(true);
    expect(verifyAccessKey("agentic-local-dev-key")).toBe(false);
  });

  it("accepts the access-key header without touching the cookie store", async () => {
    process.env.AGENTIC_ACCESS_KEY = "super-secret-key";
    process.env.NODE_ENV = "test";

    await expect(
      requireApiSession(
        new Request("http://localhost/api/memory", {
          headers: {
            [AGENTIC_ACCESS_KEY_HEADER]: "super-secret-key"
          }
        })
      )
    ).resolves.toMatchObject({
      authMethod: "access_key",
      userId: "user-primary"
    });
  });

  it("accepts a valid session cookie from the request headers", async () => {
    process.env.AGENTIC_ACCESS_KEY = "super-secret-key";
    process.env.NODE_ENV = "test";

    await expect(
      requireApiSession(
        new Request("http://localhost/api/memory", {
          headers: {
            cookie: `${AGENTIC_SESSION_COOKIE}=${buildSessionToken()}`
          }
        })
      )
    ).resolves.toMatchObject({
      authMethod: "session",
      userId: "user-primary"
    });
  });

  it("rejects unauthorized requests with an auth error", async () => {
    process.env.AGENTIC_ACCESS_KEY = "super-secret-key";
    process.env.NODE_ENV = "test";

    await expect(requireApiSession(new Request("http://localhost/api/memory"))).rejects.toMatchObject({
      name: "AuthError",
      message: expect.stringContaining("Unauthorized")
    });
  });

  it("marks session cookies as secure-only in production", () => {
    process.env.AGENTIC_ACCESS_KEY = "super-secret-key";
    process.env.NODE_ENV = "production";

    const cookie = createSessionCookie();

    expect(cookie.options.httpOnly).toBe(true);
    expect(cookie.options.sameSite).toBe("lax");
    expect(cookie.options.secure).toBe(true);
    expect(cookie.options.path).toBe("/");
    expect(cookie.options.maxAge).toBeGreaterThan(0);
  });

  it("clears session cookies immediately in production", () => {
    process.env.AGENTIC_ACCESS_KEY = "super-secret-key";
    process.env.NODE_ENV = "production";

    const cookie = clearSessionCookie();

    expect(cookie.options.httpOnly).toBe(true);
    expect(cookie.options.sameSite).toBe("lax");
    expect(cookie.options.secure).toBe(true);
    expect(cookie.options.path).toBe("/");
    expect(cookie.options.maxAge).toBe(0);
  });

  it("throttles repeated failed unlock attempts for the same client", () => {
    const request = new Request("http://localhost/api/session", {
      method: "POST",
      headers: {
        "x-forwarded-for": "203.0.113.10",
        "user-agent": "vitest"
      }
    });

    for (let index = 0; index < 4; index += 1) {
      expect(recordFailedSessionUnlockAttempt(request, 1_000 + index).throttled).toBe(false);
    }

    const throttled = recordFailedSessionUnlockAttempt(request, 1_100);

    expect(throttled.throttled).toBe(true);
    expect(throttled.retryAfterSeconds).toBeGreaterThan(0);
    expect(getSessionUnlockRateLimitStatus(request, 1_101).throttled).toBe(true);
  });

  it("clears the failed unlock window after a successful session creation", () => {
    const request = new Request("http://localhost/api/session", {
      method: "POST",
      headers: {
        "x-forwarded-for": "203.0.113.11"
      }
    });

    for (let index = 0; index < 4; index += 1) {
      recordFailedSessionUnlockAttempt(request, 5_000 + index);
    }

    clearFailedSessionUnlockAttempts(request);

    expect(getSessionUnlockRateLimitStatus(request, 5_100).throttled).toBe(false);
    expect(recordFailedSessionUnlockAttempt(request, 5_101).throttled).toBe(false);
  });
});
