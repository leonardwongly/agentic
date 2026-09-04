import { AGENTIC_SESSION_COOKIE, buildSessionToken, parseAuthorizedSessionToken } from "../apps/web/lib/auth";
import { GET as logoutRoute } from "../apps/web/app/logout/route";

describe("logout route", () => {
  const originalAccessKey = process.env.AGENTIC_ACCESS_KEY;
  const originalNodeEnv = process.env.NODE_ENV;

  afterEach(() => {
    process.env.AGENTIC_ACCESS_KEY = originalAccessKey;
    process.env.NODE_ENV = originalNodeEnv;
  });

  it("revokes the active session, clears the cookie, and redirects home", async () => {
    process.env.AGENTIC_ACCESS_KEY = "super-secret-key";
    process.env.NODE_ENV = "test";

    const token = buildSessionToken();
    await expect(parseAuthorizedSessionToken(token)).resolves.not.toBeNull();

    const response = await logoutRoute(
      new Request("http://localhost/logout", {
        headers: {
          cookie: `${AGENTIC_SESSION_COOKIE}=${token}`
        }
      })
    );

    expect(response.status).toBe(307);
    expect(response.headers.get("location")).toBe("http://localhost/");
    expect(response.headers.get("cache-control")).toBe("no-store, max-age=0, must-revalidate");
    expect(response.headers.get("set-cookie")).toContain(`${AGENTIC_SESSION_COOKIE}=`);
    expect(response.headers.get("set-cookie")).toContain("Max-Age=0");
    await expect(parseAuthorizedSessionToken(token)).resolves.toBeNull();
  });

  it("redirects home even when no session cookie is present", async () => {
    process.env.AGENTIC_ACCESS_KEY = "super-secret-key";
    process.env.NODE_ENV = "test";

    const response = await logoutRoute(new Request("http://localhost/logout"));

    expect(response.status).toBe(307);
    expect(response.headers.get("location")).toBe("http://localhost/");
    expect(response.headers.get("set-cookie")).toContain(`${AGENTIC_SESSION_COOKIE}=`);
    expect(response.headers.get("set-cookie")).toContain("Max-Age=0");
  });

  it("handles double-logout gracefully (revoking an already-revoked token)", async () => {
    process.env.AGENTIC_ACCESS_KEY = "super-secret-key";
    process.env.NODE_ENV = "test";

    const token = buildSessionToken();
    await expect(parseAuthorizedSessionToken(token)).resolves.not.toBeNull();

    // First logout revokes the token
    const firstResponse = await logoutRoute(
      new Request("http://localhost/logout", {
        headers: { cookie: `${AGENTIC_SESSION_COOKIE}=${token}` }
      })
    );
    expect(firstResponse.status).toBe(307);
    await expect(parseAuthorizedSessionToken(token)).resolves.toBeNull();

    // Second logout with the same (now-revoked) token should still redirect cleanly
    const secondResponse = await logoutRoute(
      new Request("http://localhost/logout", {
        headers: { cookie: `${AGENTIC_SESSION_COOKIE}=${token}` }
      })
    );
    expect(secondResponse.status).toBe(307);
    expect(secondResponse.headers.get("location")).toBe("http://localhost/");
    expect(secondResponse.headers.get("set-cookie")).toContain("Max-Age=0");
  });

  it("handles logout with a tampered/invalid session token without error", async () => {
    process.env.AGENTIC_ACCESS_KEY = "super-secret-key";
    process.env.NODE_ENV = "test";

    const response = await logoutRoute(
      new Request("http://localhost/logout", {
        headers: { cookie: `${AGENTIC_SESSION_COOKIE}=totally-invalid-token-value` }
      })
    );

    // Should still redirect and clear the cookie even if the token is garbage
    expect(response.status).toBe(307);
    expect(response.headers.get("location")).toBe("http://localhost/");
    expect(response.headers.get("set-cookie")).toContain("Max-Age=0");
  });

  it("handles logout with empty cookie value gracefully", async () => {
    process.env.AGENTIC_ACCESS_KEY = "super-secret-key";
    process.env.NODE_ENV = "test";

    const response = await logoutRoute(
      new Request("http://localhost/logout", {
        headers: { cookie: `${AGENTIC_SESSION_COOKIE}=; other=val` }
      })
    );

    expect(response.status).toBe(307);
    expect(response.headers.get("set-cookie")).toContain("Max-Age=0");
  });

  it("applies security headers to the logout redirect response", async () => {
    process.env.AGENTIC_ACCESS_KEY = "super-secret-key";
    process.env.NODE_ENV = "test";

    const response = await logoutRoute(new Request("http://localhost/logout"));

    expect(response.headers.get("x-content-type-options")).toBe("nosniff");
    expect(response.headers.get("x-frame-options")).toBe("DENY");
    expect(response.headers.get("referrer-policy")).toBe("no-referrer");
  });
});
