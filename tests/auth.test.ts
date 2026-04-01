import {
  AGENTIC_SESSION_COOKIE,
  AGENTIC_ACCESS_KEY_HEADER,
  buildSessionToken,
  getAuthMode,
  isAuthorizedSessionToken,
  requireApiSession,
  verifyAccessKey
} from "../apps/web/lib/auth";

describe("auth helpers", () => {
  const originalKey = process.env.AGENTIC_ACCESS_KEY;
  const originalNodeEnv = process.env.NODE_ENV;

  afterEach(() => {
    process.env.AGENTIC_ACCESS_KEY = originalKey;
    process.env.NODE_ENV = originalNodeEnv;
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
});
