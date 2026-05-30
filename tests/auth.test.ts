import {
  AGENTIC_SESSION_COOKIE,
  AGENTIC_ACCESS_KEY_HEADER,
  buildOAuthStateToken,
  buildSessionToken,
  checkSessionRateLimit,
  clearSessionCookie,
  createSessionCookie,
  getAuthMode,
  isAuthorizedSessionToken,
  parseAuthorizedOAuthStateToken,
  parseAuthorizedSessionToken,
  requireApiSession,
  revokeSessionToken,
  verifyAccessKey
} from "../apps/web/lib/auth";
import { resetAuthSessionStateStoreForTesting, setAuthSessionStateStoreForTesting, type AuthSessionStateStore } from "../apps/web/lib/auth-session-store";
import {
  clearFailedSessionUnlockAttempts,
  getSessionUnlockRateLimitStatus,
  recordFailedSessionUnlockAttempt
} from "../apps/web/lib/session-unlock-rate-limit";
import { getRequestClientIdentity, getRequestIdentityRuntimeStatus } from "../apps/web/lib/request-client-identity";
import {
  resetSessionUnlockStateStoreForTesting,
  setSessionUnlockStateStoreForTesting,
  type SessionUnlockStateStore
} from "../apps/web/lib/session-unlock-store";
import {
  getAuthRuntimeStateStatus,
  resetAuthRuntimeStateWarningsForTesting,
  validateAuthRuntimeState
} from "../apps/web/lib/auth-runtime-state";
import {
  createPostgresAuthSessionStateStore,
  createPostgresSessionUnlockStateStore
} from "../apps/web/lib/shared-auth-state-db";

describe("auth helpers", () => {
  const originalKey = process.env.AGENTIC_ACCESS_KEY;
  const originalNodeEnv = process.env.NODE_ENV;
  const originalRequireSharedAuthState = process.env.AGENTIC_REQUIRE_SHARED_AUTH_STATE;
  const originalDatabaseUrl = process.env.DATABASE_URL;
  const originalSharedAuthState = process.env.AGENTIC_SHARED_AUTH_STATE;
  const originalTrustProxyHeaders = process.env.AGENTIC_TRUST_PROXY_HEADERS;
  const originalTrustedClientIpHeader = process.env.AGENTIC_TRUSTED_CLIENT_IP_HEADER;
  const originalProxyHeaderOverwriteConfirmed = process.env.AGENTIC_PROXY_HEADER_OVERWRITE_CONFIRMED;
  const originalAllowProcessLocalAuthState = process.env.AGENTIC_ALLOW_PROCESS_LOCAL_AUTH_STATE;
  const originalEnableLocalDevKey = process.env.AGENTIC_ENABLE_LOCAL_DEV_KEY;
  const originalBootstrapUserId = process.env.AGENTIC_BOOTSTRAP_USER_ID;
  const databaseUrl = process.env.DATABASE_URL;
  const postgresIt = databaseUrl ? it : it.skip;

  function uniqueSharedStateKey(prefix: string): string {
    return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
  }

  afterEach(() => {
    process.env.AGENTIC_ACCESS_KEY = originalKey;
    process.env.NODE_ENV = originalNodeEnv;
    process.env.AGENTIC_REQUIRE_SHARED_AUTH_STATE = originalRequireSharedAuthState;
    process.env.DATABASE_URL = originalDatabaseUrl;
    process.env.AGENTIC_SHARED_AUTH_STATE = originalSharedAuthState;
    process.env.AGENTIC_TRUST_PROXY_HEADERS = originalTrustProxyHeaders;
    process.env.AGENTIC_TRUSTED_CLIENT_IP_HEADER = originalTrustedClientIpHeader;
    process.env.AGENTIC_PROXY_HEADER_OVERWRITE_CONFIRMED = originalProxyHeaderOverwriteConfirmed;
    process.env.AGENTIC_ALLOW_PROCESS_LOCAL_AUTH_STATE = originalAllowProcessLocalAuthState;
    if (originalEnableLocalDevKey === undefined) {
      delete process.env.AGENTIC_ENABLE_LOCAL_DEV_KEY;
    } else {
      process.env.AGENTIC_ENABLE_LOCAL_DEV_KEY = originalEnableLocalDevKey;
    }
    if (originalBootstrapUserId === undefined) {
      delete process.env.AGENTIC_BOOTSTRAP_USER_ID;
    } else {
      process.env.AGENTIC_BOOTSTRAP_USER_ID = originalBootstrapUserId;
    }
    resetAuthRuntimeStateWarningsForTesting();
    resetSessionUnlockStateStoreForTesting();
    resetAuthSessionStateStoreForTesting();
  });

  it("verifies a configured access key and derived session token", async () => {
    process.env.AGENTIC_ACCESS_KEY = "super-secret-key";
    process.env.NODE_ENV = "test";

    expect(verifyAccessKey("super-secret-key")).toBe(true);
    expect(verifyAccessKey("wrong-key")).toBe(false);

    const token = buildSessionToken();
    await expect(isAuthorizedSessionToken(token)).resolves.toBe(true);
    await expect(isAuthorizedSessionToken("not-a-token")).resolves.toBe(false);
    await expect(parseAuthorizedSessionToken(token)).resolves.toMatchObject({
      userId: "owner"
    });
  });

  it("binds access-key sessions to the configured bootstrap owner", async () => {
    process.env.AGENTIC_ACCESS_KEY = "super-secret-key";
    process.env.AGENTIC_BOOTSTRAP_USER_ID = "installer-admin";
    process.env.NODE_ENV = "test";

    const token = buildSessionToken();
    await expect(parseAuthorizedSessionToken(token, "installer-admin")).resolves.toMatchObject({
      userId: "installer-admin"
    });
    await expect(parseAuthorizedSessionToken(token, "owner")).resolves.toBeNull();
  });

  it("requires an explicit bootstrap owner for production session creation", () => {
    process.env.AGENTIC_ACCESS_KEY = "super-secret-key";
    process.env.NODE_ENV = "production";
    delete process.env.AGENTIC_BOOTSTRAP_USER_ID;

    expect(() => buildSessionToken()).toThrow(/AGENTIC_BOOTSTRAP_USER_ID must be configured/);
  });

  it("issues distinct signed session tokens and honors revocation", async () => {
    process.env.AGENTIC_ACCESS_KEY = "super-secret-key";
    process.env.NODE_ENV = "test";

    const firstToken = buildSessionToken();
    const secondToken = buildSessionToken();

    expect(firstToken).not.toBe(secondToken);
    await expect(isAuthorizedSessionToken(firstToken)).resolves.toBe(true);

    await revokeSessionToken(firstToken);

    await expect(isAuthorizedSessionToken(firstToken)).resolves.toBe(false);
    await expect(isAuthorizedSessionToken(secondToken)).resolves.toBe(true);
  });

  it("issues signed OAuth state tokens scoped to the expected user and workspace", () => {
    process.env.AGENTIC_ACCESS_KEY = "super-secret-key";
    process.env.NODE_ENV = "test";

    const token = buildOAuthStateToken({
      userId: "user-primary",
      workspaceId: "workspace-123"
    });
    const parsed = parseAuthorizedOAuthStateToken(token, "user-primary");

    expect(parsed).toMatchObject({
      userId: "user-primary",
      workspaceId: "workspace-123"
    });
    expect(parsed?.nonce).toBeTruthy();
  });

  it("rejects tampered OAuth state signatures", () => {
    process.env.AGENTIC_ACCESS_KEY = "super-secret-key";
    process.env.NODE_ENV = "test";

    const token = buildOAuthStateToken({
      userId: "user-primary",
      workspaceId: "workspace-123"
    });
    const [payload, signature] = token.split(".");
    const tampered = `${payload}.${signature.slice(0, -1)}${signature.endsWith("a") ? "b" : "a"}`;

    expect(parseAuthorizedOAuthStateToken(tampered, "user-primary")).toBeNull();
  });

  it("rejects OAuth state tokens presented for the wrong user", () => {
    process.env.AGENTIC_ACCESS_KEY = "super-secret-key";
    process.env.NODE_ENV = "test";

    const token = buildOAuthStateToken({
      userId: "user-primary",
      workspaceId: null
    });

    expect(parseAuthorizedOAuthStateToken(token, "user-secondary")).toBeNull();
  });

  it("supports swapping in a shared auth session state store boundary", async () => {
    process.env.AGENTIC_ACCESS_KEY = "super-secret-key";
    process.env.NODE_ENV = "test";

    const rateLimitAttempts = new Map<string, number>();
    const revokedSessionIds = new Map<string, number>();
    const store: AuthSessionStateStore = {
      scope: "shared",
      async checkRateLimit(key) {
        const nextAttempts = (rateLimitAttempts.get(key) ?? 0) + 1;
        rateLimitAttempts.set(key, nextAttempts);
        return {
          allowed: nextAttempts <= 10,
          retryAfterMs: nextAttempts <= 10 ? 0 : 300_000
        };
      },
      async clearRateLimit(key) {
        rateLimitAttempts.delete(key);
      },
      async revokeSession(sessionId, expiresAtMs) {
        revokedSessionIds.set(sessionId, expiresAtMs);
      },
      async isSessionRevoked(sessionId, now = Date.now()) {
        for (const [revokedId, expiresAtMs] of revokedSessionIds.entries()) {
          if (expiresAtMs <= now) {
            revokedSessionIds.delete(revokedId);
          }
        }

        return revokedSessionIds.has(sessionId);
      },
      async reset() {
        rateLimitAttempts.clear();
        revokedSessionIds.clear();
      }
    };

    setAuthSessionStateStoreForTesting(store);

    const token = buildSessionToken();
    const session = await parseAuthorizedSessionToken(token);

    expect(session).not.toBeNull();

    for (let index = 0; index < 10; index += 1) {
      await expect(checkSessionRateLimit("198.51.100.25")).resolves.toMatchObject({
        allowed: true
      });
    }

    await expect(checkSessionRateLimit("198.51.100.25")).resolves.toMatchObject({
      allowed: false
    });

    await revokeSessionToken(token);

    expect(revokedSessionIds.has(session!.sessionId)).toBe(true);
    await expect(isAuthorizedSessionToken(token)).resolves.toBe(false);
  });

  it("reports missing configuration in production without the development fallback", () => {
    delete process.env.AGENTIC_ACCESS_KEY;
    process.env.NODE_ENV = "production";

    const authMode = getAuthMode();

    expect(authMode.requiresConfiguredKey).toBe(true);
    expect(verifyAccessKey("agentic-local-dev-key")).toBe(false);
  });

  it("requires explicit opt-in before using the local development fallback key", () => {
    delete process.env.AGENTIC_ACCESS_KEY;
    delete process.env.AGENTIC_ENABLE_LOCAL_DEV_KEY;
    process.env.NODE_ENV = "development";

    expect(getAuthMode({ emitDevelopmentWarning: false })).toMatchObject({
      configured: false,
      usesDevelopmentFallback: false,
      requiresConfiguredKey: true
    });
    expect(verifyAccessKey("agentic-local-dev-key")).toBe(false);
  });

  it("can inspect auth mode without emitting the explicitly enabled development fallback warning", () => {
    const warningSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    delete process.env.AGENTIC_ACCESS_KEY;
    process.env.AGENTIC_ENABLE_LOCAL_DEV_KEY = "true";
    process.env.NODE_ENV = "development";

    const authMode = getAuthMode({ emitDevelopmentWarning: false });

    expect(authMode).toMatchObject({
      configured: true,
      usesDevelopmentFallback: true,
      requiresConfiguredKey: false
    });
    expect(warningSpy).not.toHaveBeenCalled();
    warningSpy.mockRestore();
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
      userId: "owner"
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
      userId: "owner"
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
    process.env.AGENTIC_BOOTSTRAP_USER_ID = "owner";
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

  it("throttles repeated failed unlock attempts for the same client", async () => {
    const request = new Request("http://localhost/api/session", {
      method: "POST",
      headers: {
        "user-agent": "vitest"
      }
    });

    for (let index = 0; index < 4; index += 1) {
      await expect(recordFailedSessionUnlockAttempt(request, 1_000 + index)).resolves.toMatchObject({
        throttled: false
      });
    }

    const throttled = await recordFailedSessionUnlockAttempt(request, 1_100);

    expect(throttled.throttled).toBe(true);
    expect(throttled.retryAfterSeconds).toBeGreaterThan(0);
    await expect(getSessionUnlockRateLimitStatus(request, 1_101)).resolves.toMatchObject({
      throttled: true
    });
  });

  it("ignores forwarded headers by default and falls back to a bounded request fingerprint", () => {
    const request = new Request("http://localhost/api/session", {
      method: "POST",
      headers: {
        "x-forwarded-for": "203.0.113.10, 198.51.100.8",
        "x-real-ip": "198.51.100.9",
        "cf-connecting-ip": "198.51.100.10",
        "user-agent": "  Agentic Test Client  ",
        "accept-language": "en-SG,en;q=0.9"
      }
    });

    const identity = getRequestClientIdentity(request);

    expect(identity).toMatchObject({
      source: "request-fingerprint"
    });
    expect(identity.key).toMatch(/^fp:\/api\/session:[0-9a-f]{24}$/);
  });

  it("uses a canonical trusted proxy IP when proxy headers are explicitly trusted", () => {
    process.env.AGENTIC_TRUST_PROXY_HEADERS = "true";
    process.env.AGENTIC_PROXY_HEADER_OVERWRITE_CONFIRMED = "true";
    process.env.AGENTIC_TRUSTED_CLIENT_IP_HEADER = "x-forwarded-for";

    const request = new Request("http://localhost/api/session", {
      method: "POST",
      headers: {
        "x-forwarded-for": "203.0.113.10",
        "x-real-ip": "198.51.100.9",
        "user-agent": "Agentic Test Client"
      }
    });

    expect(getRequestClientIdentity(request)).toEqual({
      key: "ip:203.0.113.10",
      source: "trusted-ip"
    });
  });

  it("reports request identity runtime warnings until trusted proxy headers are enabled", () => {
    process.env.NODE_ENV = "production";

    expect(getRequestIdentityRuntimeStatus()).toEqual({
      production: true,
      trustProxyHeaders: false,
      trustedClientIpHeader: null,
      proxyHeaderOverwriteConfirmed: false,
      identitySource: "request-fingerprint",
      warnings: [
        "Trusted proxy headers are disabled, so rate limits and abuse controls fall back to a coarse request fingerprint."
      ]
    });

    process.env.AGENTIC_TRUST_PROXY_HEADERS = "true";
    process.env.AGENTIC_PROXY_HEADER_OVERWRITE_CONFIRMED = "true";
    process.env.AGENTIC_TRUSTED_CLIENT_IP_HEADER = "x-forwarded-for";

    expect(getRequestIdentityRuntimeStatus()).toEqual({
      production: true,
      trustProxyHeaders: true,
      trustedClientIpHeader: "x-forwarded-for",
      proxyHeaderOverwriteConfirmed: true,
      identitySource: "trusted-ip",
      warnings: []
    });
  });

  it("falls back to request fingerprinting when trusted forwarded headers are malformed", () => {
    process.env.AGENTIC_TRUST_PROXY_HEADERS = "true";
    process.env.AGENTIC_PROXY_HEADER_OVERWRITE_CONFIRMED = "true";
    process.env.AGENTIC_TRUSTED_CLIENT_IP_HEADER = "x-forwarded-for";

    const request = new Request("http://localhost/api/session", {
      method: "POST",
      headers: {
        "x-forwarded-for": "not-an-ip, 203.0.113.10",
        "x-real-ip": "also-not-an-ip",
        "user-agent": "Agentic Test Client",
        "accept-language": "en-SG"
      }
    });

    const identity = getRequestClientIdentity(request);

    expect(identity).toMatchObject({
      source: "request-fingerprint"
    });
    expect(identity.key).toMatch(/^fp:\/api\/session:[0-9a-f]{24}$/);
  });

  it("supports swapping in a shared session unlock state store boundary", async () => {
    process.env.AGENTIC_TRUST_PROXY_HEADERS = "true";
    process.env.AGENTIC_PROXY_HEADER_OVERWRITE_CONFIRMED = "true";
    process.env.AGENTIC_TRUSTED_CLIENT_IP_HEADER = "x-forwarded-for";

    const forwardedIp = "203.0.113.19";
    const expectedKey = `ip:${forwardedIp}`;
    const seenKeys: string[] = [];
    let throttledUntil: number | null = null;

    const store: SessionUnlockStateStore = {
      scope: "shared",
      async getStatus(key, now = Date.now()) {
        seenKeys.push(`get:${key}`);
        if (throttledUntil === null || throttledUntil <= now) {
          return {
            throttled: false,
            retryAfterSeconds: 0
          };
        }

        return {
          throttled: true,
          retryAfterSeconds: Math.max(1, Math.ceil((throttledUntil - now) / 1000))
        };
      },
      async recordFailure(key, now = Date.now()) {
        seenKeys.push(`record:${key}`);
        throttledUntil = now + 60_000;
        return {
          throttled: true,
          retryAfterSeconds: 60
        };
      },
      async clear(key) {
        seenKeys.push(`clear:${key}`);
        throttledUntil = null;
      },
      async reset() {
        throttledUntil = null;
      }
    };

    setSessionUnlockStateStoreForTesting(store);

    const request = new Request("http://localhost/api/session", {
      method: "POST",
      headers: {
        "x-forwarded-for": forwardedIp
      }
    });

    await expect(getSessionUnlockRateLimitStatus(request, 10_000)).resolves.toEqual({
      throttled: false,
      retryAfterSeconds: 0
    });

    const throttled = await recordFailedSessionUnlockAttempt(request, 10_100);

    expect(throttled.throttled).toBe(true);
    expect(throttled.retryAfterSeconds).toBeGreaterThan(0);
    await expect(getSessionUnlockRateLimitStatus(request, 10_101)).resolves.toMatchObject({
      throttled: true
    });

    await clearFailedSessionUnlockAttempts(request);

    await expect(getSessionUnlockRateLimitStatus(request, 10_102)).resolves.toEqual({
      throttled: false,
      retryAfterSeconds: 0
    });
    expect(seenKeys).toEqual([
      `get:${expectedKey}`,
      `record:${expectedKey}`,
      `get:${expectedKey}`,
      `clear:${expectedKey}`,
      `get:${expectedKey}`
    ]);
  });

  it("clears the failed unlock window after a successful session creation", async () => {
    const request = new Request("http://localhost/api/session", {
      method: "POST",
      headers: {
        "user-agent": "Agentic Test Client"
      }
    });

    for (let index = 0; index < 4; index += 1) {
      await recordFailedSessionUnlockAttempt(request, 5_000 + index);
    }

    await clearFailedSessionUnlockAttempts(request);

    await expect(getSessionUnlockRateLimitStatus(request, 5_100)).resolves.toMatchObject({
      throttled: false
    });
    await expect(recordFailedSessionUnlockAttempt(request, 5_101)).resolves.toMatchObject({
      throttled: false
    });
  });

  it("reports process-local auth runtime state by default", () => {
    process.env.NODE_ENV = "test";
    delete process.env.AGENTIC_REQUIRE_SHARED_AUTH_STATE;
    delete process.env.AGENTIC_ALLOW_PROCESS_LOCAL_AUTH_STATE;

    expect(getAuthRuntimeStateStatus()).toMatchObject({
      production: false,
      requiresSharedState: false,
      sessionStateScope: "process-local",
      unlockStateScope: "process-local",
      sharedStateConfigured: false
    });
  });

  it("rejects production mode by default when auth runtime state is still process-local", () => {
    process.env.NODE_ENV = "production";
    delete process.env.AGENTIC_ALLOW_PROCESS_LOCAL_AUTH_STATE;

    expect(() => validateAuthRuntimeState()).toThrow(/Shared auth state is not configured for production/);
  });

  it("accepts strict production mode when shared auth runtime state is configured", () => {
    process.env.NODE_ENV = "production";
    delete process.env.AGENTIC_ALLOW_PROCESS_LOCAL_AUTH_STATE;

    const authStore: AuthSessionStateStore = {
      scope: "shared",
      async checkRateLimit() {
        return { allowed: true, retryAfterMs: 0 };
      },
      async clearRateLimit() {},
      async revokeSession() {},
      async isSessionRevoked() {
        return false;
      },
      async reset() {}
    };
    const unlockStore: SessionUnlockStateStore = {
      scope: "shared",
      async getStatus() {
        return {
          throttled: false,
          retryAfterSeconds: 0
        };
      },
      async recordFailure(_key, now = Date.now()) {
        return {
          throttled: true,
          retryAfterSeconds: Math.max(1, Math.ceil((now + 1_000 - now) / 1000))
        };
      },
      async clear() {},
      async reset() {}
    };

    setAuthSessionStateStoreForTesting(authStore);
    setSessionUnlockStateStoreForTesting(unlockStore);

    expect(() => validateAuthRuntimeState()).not.toThrow();
    expect(getAuthRuntimeStateStatus().sharedStateConfigured).toBe(true);
  });

  it("allows an explicit single-instance production exception when process-local auth state is intentional", () => {
    process.env.NODE_ENV = "production";
    process.env.AGENTIC_ALLOW_PROCESS_LOCAL_AUTH_STATE = "true";

    expect(() => validateAuthRuntimeState()).not.toThrow();
    expect(getAuthRuntimeStateStatus()).toMatchObject({
      requiresSharedState: false,
      allowsProcessLocalStateException: true
    });
  });

  it("defaults to shared auth runtime state when DATABASE_URL is configured", () => {
    process.env.NODE_ENV = "test";
    process.env.DATABASE_URL = "postgres://agentic:agentic@localhost:5432/agentic";
    process.env.AGENTIC_SHARED_AUTH_STATE = "true";

    resetSessionUnlockStateStoreForTesting();
    resetAuthSessionStateStoreForTesting();

    expect(getAuthRuntimeStateStatus()).toMatchObject({
      sessionStateScope: "shared",
      unlockStateScope: "shared",
      sharedStateConfigured: true
    });
  });

  postgresIt("shares session revocation across Postgres store instances and expires it deterministically", async () => {
    process.env.DATABASE_URL = databaseUrl;

    const primaryStore = createPostgresAuthSessionStateStore();
    const secondaryStore = createPostgresAuthSessionStateStore();
    const now = Date.now();
    const sessionId = uniqueSharedStateKey("revoked-session");

    await primaryStore.revokeSession(sessionId, now + 1_000);

    await expect(primaryStore.isSessionRevoked(sessionId, now + 100)).resolves.toBe(true);
    await expect(secondaryStore.isSessionRevoked(sessionId, now + 100)).resolves.toBe(true);
    await expect(secondaryStore.isSessionRevoked(sessionId, now + 1_001)).resolves.toBe(false);
    await expect(primaryStore.isSessionRevoked(sessionId, now + 1_001)).resolves.toBe(false);
  });

  postgresIt("applies shared session rate limiting atomically across Postgres-backed nodes", async () => {
    process.env.DATABASE_URL = databaseUrl;

    const primaryStore = createPostgresAuthSessionStateStore();
    const secondaryStore = createPostgresAuthSessionStateStore();
    const key = uniqueSharedStateKey("session-rate-limit");
    const now = Date.now();

    const attempts = await Promise.all(
      Array.from({ length: 11 }, (_, index) =>
        (index % 2 === 0 ? primaryStore : secondaryStore).checkRateLimit(key, now)
      )
    );

    expect(attempts.filter((result) => result.allowed)).toHaveLength(10);
    expect(attempts.filter((result) => !result.allowed)).toHaveLength(1);
    expect(attempts.find((result) => !result.allowed)?.retryAfterMs).toBeGreaterThan(0);
    await expect(primaryStore.checkRateLimit(key, now + 5 * 60_000 + 1)).resolves.toMatchObject({
      allowed: true,
      retryAfterMs: 0
    });
  });

  postgresIt("throttles shared session unlock attempts atomically across Postgres-backed nodes", async () => {
    process.env.DATABASE_URL = databaseUrl;

    const primaryStore = createPostgresSessionUnlockStateStore();
    const secondaryStore = createPostgresSessionUnlockStateStore();
    const key = uniqueSharedStateKey("unlock-throttle");
    const now = Date.now();

    const attempts = await Promise.all(
      Array.from({ length: 5 }, (_, index) =>
        (index % 2 === 0 ? primaryStore : secondaryStore).recordFailure(key, now)
      )
    );

    expect(attempts.filter((result) => !result.throttled)).toHaveLength(4);
    expect(attempts.filter((result) => result.throttled)).toHaveLength(1);
    await expect(secondaryStore.getStatus(key, now + 1)).resolves.toMatchObject({
      throttled: true
    });
    await expect(primaryStore.getStatus(key, now + 15 * 60_000 + 1)).resolves.toEqual({
      throttled: false,
      retryAfterSeconds: 0
    });
    await expect(primaryStore.recordFailure(key, now + 15 * 60_000 + 1)).resolves.toEqual({
      throttled: false,
      retryAfterSeconds: 0
    });
  });

  postgresIt("resets the shared unlock failure window after inactivity without carrying stale attempts forward", async () => {
    process.env.DATABASE_URL = databaseUrl;

    const primaryStore = createPostgresSessionUnlockStateStore();
    const secondaryStore = createPostgresSessionUnlockStateStore();
    const key = uniqueSharedStateKey("unlock-window");
    const now = Date.now();

    for (let attempt = 0; attempt < 4; attempt += 1) {
      await expect((attempt % 2 === 0 ? primaryStore : secondaryStore).recordFailure(key, now + attempt)).resolves.toEqual({
        throttled: false,
        retryAfterSeconds: 0
      });
    }

    await expect(secondaryStore.recordFailure(key, now + 10 * 60_000 + 1)).resolves.toEqual({
      throttled: false,
      retryAfterSeconds: 0
    });
    await expect(primaryStore.getStatus(key, now + 10 * 60_000 + 2)).resolves.toEqual({
      throttled: false,
      retryAfterSeconds: 0
    });
  });
});
