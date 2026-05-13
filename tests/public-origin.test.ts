import { describe, expect, it } from "vitest";
import {
  PublicOriginConfigurationError,
  buildPublicUrl,
  getPublicBaseUrl
} from "../apps/web/lib/public-origin";

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
});
