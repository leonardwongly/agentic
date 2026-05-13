import { AGENTIC_SESSION_COOKIE, buildSessionToken, parseAuthorizedSessionToken } from "../apps/web/lib/auth";
import { GET as logoutRoute } from "../apps/web/app/logout/route";

describe("logout route", () => {
  const originalAccessKey = process.env.AGENTIC_ACCESS_KEY;
  const originalNodeEnv = process.env.NODE_ENV;
  const originalPublicBaseUrl = process.env.AGENTIC_PUBLIC_BASE_URL;

  afterEach(() => {
    process.env.AGENTIC_ACCESS_KEY = originalAccessKey;
    process.env.NODE_ENV = originalNodeEnv;
    if (originalPublicBaseUrl === undefined) {
      delete process.env.AGENTIC_PUBLIC_BASE_URL;
    } else {
      process.env.AGENTIC_PUBLIC_BASE_URL = originalPublicBaseUrl;
    }
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

  it("uses the configured public base URL for redirects", async () => {
    process.env.AGENTIC_ACCESS_KEY = "super-secret-key";
    process.env.AGENTIC_PUBLIC_BASE_URL = "https://agentic.example.com";
    process.env.NODE_ENV = "test";

    const response = await logoutRoute(new Request("http://host-header.example/logout"));

    expect(response.status).toBe(307);
    expect(response.headers.get("location")).toBe("https://agentic.example.com/");
  });
});
