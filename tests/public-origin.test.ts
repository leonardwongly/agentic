import { afterEach, describe, expect, it } from "vitest";
import { PublicOriginConfigurationError, buildPublicUrl, getPublicBaseUrl } from "../apps/web/lib/public-origin";

describe("public origin resolution", () => {
  const originalPublicBaseUrl = process.env.AGENTIC_PUBLIC_BASE_URL;
  const originalNodeEnv = process.env.NODE_ENV;

  afterEach(() => {
    if (originalPublicBaseUrl === undefined) {
      delete process.env.AGENTIC_PUBLIC_BASE_URL;
    } else {
      process.env.AGENTIC_PUBLIC_BASE_URL = originalPublicBaseUrl;
    }
    process.env.NODE_ENV = originalNodeEnv;
  });

  it("uses AGENTIC_PUBLIC_BASE_URL for absolute URLs instead of request host headers", () => {
    process.env.AGENTIC_PUBLIC_BASE_URL = "https://agentic.example.com";
    process.env.NODE_ENV = "production";

    expect(buildPublicUrl("http://host-header.example/api/goals/goal-1/share", "/share/token").toString()).toBe(
      "https://agentic.example.com/share/token"
    );
  });

  it("falls back to request origin outside production", () => {
    delete process.env.AGENTIC_PUBLIC_BASE_URL;
    process.env.NODE_ENV = "test";

    expect(getPublicBaseUrl("http://localhost:3000/api/ready").toString()).toBe("http://localhost:3000/");
  });

  it("fails closed in production without a configured public base URL", () => {
    delete process.env.AGENTIC_PUBLIC_BASE_URL;
    process.env.NODE_ENV = "production";

    expect(() => getPublicBaseUrl("http://localhost:3000/api/ready")).toThrow(PublicOriginConfigurationError);
  });

  it.each([
    "ftp://agentic.example.com",
    "https://user:pass@agentic.example.com",
    "https://agentic.example.com/app",
    "https://agentic.example.com?next=/"
  ])("rejects unsafe public base URL %s", (candidate) => {
    process.env.AGENTIC_PUBLIC_BASE_URL = candidate;
    process.env.NODE_ENV = "production";

    expect(() => getPublicBaseUrl("http://localhost:3000/api/ready")).toThrow(PublicOriginConfigurationError);
  });

  describe("adversarial public origin edge cases", () => {
    it("rejects javascript: protocol URLs", () => {
      process.env.AGENTIC_PUBLIC_BASE_URL = "javascript:alert(1)";
      process.env.NODE_ENV = "production";

      expect(() => getPublicBaseUrl("http://localhost:3000/api/ready")).toThrow(PublicOriginConfigurationError);
    });

    it("rejects data: protocol URLs", () => {
      process.env.AGENTIC_PUBLIC_BASE_URL = "data:text/html,<script>alert(1)</script>";
      process.env.NODE_ENV = "production";

      expect(() => getPublicBaseUrl("http://localhost:3000/api/ready")).toThrow(PublicOriginConfigurationError);
    });

    it("rejects URLs with hash fragments", () => {
      process.env.AGENTIC_PUBLIC_BASE_URL = "https://agentic.example.com#fragment";
      process.env.NODE_ENV = "production";

      expect(() => getPublicBaseUrl("http://localhost:3000/api/ready")).toThrow(PublicOriginConfigurationError);
    });

    it("rejects completely invalid URLs", () => {
      process.env.AGENTIC_PUBLIC_BASE_URL = "not-a-url-at-all";
      process.env.NODE_ENV = "production";

      expect(() => getPublicBaseUrl("http://localhost:3000/api/ready")).toThrow(PublicOriginConfigurationError);
    });

    it("rejects empty string in production", () => {
      process.env.AGENTIC_PUBLIC_BASE_URL = "";
      process.env.NODE_ENV = "production";

      // Empty string is falsy, so it falls through to the production check
      expect(() => getPublicBaseUrl("http://localhost:3000/api/ready")).toThrow(PublicOriginConfigurationError);
    });

    it("strips trailing slash from valid base URL", () => {
      process.env.AGENTIC_PUBLIC_BASE_URL = "https://agentic.example.com/";
      process.env.NODE_ENV = "production";

      const url = buildPublicUrl("http://internal.local/api/test", "/share/token");
      expect(url.toString()).toBe("https://agentic.example.com/share/token");
    });

    it("buildPublicUrl strips query and hash from the pathname argument", () => {
      process.env.AGENTIC_PUBLIC_BASE_URL = "https://agentic.example.com";
      process.env.NODE_ENV = "production";

      // Even if pathname contains query/hash, they should be stripped
      const url = buildPublicUrl("http://internal.local/api/test", "/share/token?evil=1#hash");
      expect(url.search).toBe("");
      expect(url.hash).toBe("");
      expect(url.pathname).toBe("/share/token");
    });

    it("allows http: protocol in non-production for local development", () => {
      process.env.AGENTIC_PUBLIC_BASE_URL = "http://localhost:3000";
      process.env.NODE_ENV = "test";

      expect(getPublicBaseUrl("http://localhost:3000/api/test").toString()).toBe("http://localhost:3000/");
    });

    it("throws when no request URL is available and no base URL is configured in non-production", () => {
      delete process.env.AGENTIC_PUBLIC_BASE_URL;
      process.env.NODE_ENV = "test";

      expect(() => getPublicBaseUrl()).toThrow(PublicOriginConfigurationError);
    });
  });
});
