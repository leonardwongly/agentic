import {
  AGENTIC_SESSION_COOKIE,
  AGENTIC_ACCESS_KEY_HEADER,
  buildSessionToken,
  clearSessionCookie,
  createSessionCookie,
  getAuthMode,
  isAuthorizedSessionToken,
  requireApiSession,
  verifyAccessKey
} from "../apps/web/lib/auth";
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
  });

  it("verifies a configured access key and derived session token", () => {
    process.env.AGENTIC_ACCESS_KEY = "super-secret-key";
    process.env.NODE_ENV = "test";

    expect(verifyAccessKey("super-secret-key")).toBe(true);
    expect(verifyAccessKey("wrong-key")).toBe(false);

    const token = buildSessionToken();
    expect(isAuthorizedSessionToken(token)).toBe(true);
    expect(isAuthorizedSessionToken("not-a-token")).toBe(false);
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
    ).resolves.toBeUndefined();
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
    ).resolves.toBeUndefined();
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
