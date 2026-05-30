import { AGENTIC_SESSION_COOKIE, buildSessionToken, parseAuthorizedSessionToken } from "../apps/web/lib/auth";
import { GET as logoutGetRoute, POST as logoutPostRoute } from "../apps/web/app/logout/route";

describe("logout route", () => {
  const originalAccessKey = process.env.AGENTIC_ACCESS_KEY;
  const originalNodeEnv = process.env.NODE_ENV;

  afterEach(() => {
    process.env.AGENTIC_ACCESS_KEY = originalAccessKey;
    process.env.NODE_ENV = originalNodeEnv;
  });

  it("revokes the active session on same-origin POST, clears the cookie, and redirects home", async () => {
    process.env.AGENTIC_ACCESS_KEY = "super-secret-key";
    process.env.NODE_ENV = "test";

    const token = buildSessionToken();
    await expect(parseAuthorizedSessionToken(token)).resolves.not.toBeNull();

    const response = await logoutPostRoute(
      new Request("http://localhost/logout", {
        method: "POST",
        headers: {
          cookie: `${AGENTIC_SESSION_COOKIE}=${token}`,
          origin: "http://localhost",
          "sec-fetch-site": "same-origin"
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

  it("does not revoke sessions on GET logout navigation", async () => {
    process.env.AGENTIC_ACCESS_KEY = "super-secret-key";
    process.env.NODE_ENV = "test";

    const token = buildSessionToken();
    const response = await logoutGetRoute(
      new Request("http://localhost/logout", {
        headers: {
          cookie: `${AGENTIC_SESSION_COOKIE}=${token}`
        }
      })
    );

    expect(response.status).toBe(307);
    expect(response.headers.get("location")).toBe("http://localhost/");
    expect(response.headers.get("set-cookie")).toBeNull();
    await expect(parseAuthorizedSessionToken(token)).resolves.not.toBeNull();
  });

  it("redirects home on POST even when no session cookie is present", async () => {
    process.env.AGENTIC_ACCESS_KEY = "super-secret-key";
    process.env.NODE_ENV = "test";

    const response = await logoutPostRoute(
      new Request("http://localhost/logout", {
        method: "POST",
        headers: {
          origin: "http://localhost",
          "sec-fetch-site": "same-origin"
        }
      })
    );

    expect(response.status).toBe(307);
    expect(response.headers.get("location")).toBe("http://localhost/");
    expect(response.headers.get("set-cookie")).toContain(`${AGENTIC_SESSION_COOKIE}=`);
    expect(response.headers.get("set-cookie")).toContain("Max-Age=0");
  });

  it("rejects cross-site POST logout attempts without revoking the session", async () => {
    process.env.AGENTIC_ACCESS_KEY = "super-secret-key";
    process.env.NODE_ENV = "test";

    const token = buildSessionToken();
    const response = await logoutPostRoute(
      new Request("http://localhost/logout", {
        method: "POST",
        headers: {
          cookie: `${AGENTIC_SESSION_COOKIE}=${token}`,
          origin: "https://attacker.example",
          "sec-fetch-site": "cross-site"
        }
      })
    );

    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({ error: "Logout must be submitted from the same site." });
    await expect(parseAuthorizedSessionToken(token)).resolves.not.toBeNull();
  });
});
