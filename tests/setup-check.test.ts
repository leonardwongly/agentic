import { describe, expect, it } from "vitest";
import { evaluateSetupEnvironment } from "../scripts/lib/setup-check";

describe("setup check", () => {
  it("warns but allows a minimal local file-backed setup", () => {
    const report = evaluateSetupEnvironment({}, { nodeVersion: "20.11.0" });

    expect(report.mode).toBe("development");
    expect(report.ok).toBe(true);
    expect(report.checks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: "access_key", status: "warn" }),
        expect.objectContaining({ id: "database", status: "warn" }),
        expect.objectContaining({ id: "auth_state", status: "warn" })
      ])
    );
  });

  it("fails production without required access key, database, and shared auth backing", () => {
    const report = evaluateSetupEnvironment({ NODE_ENV: "production" }, { nodeVersion: "20.11.0" });

    expect(report.mode).toBe("production");
    expect(report.ok).toBe(false);
    expect(report.checks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: "access_key", status: "fail" }),
        expect.objectContaining({ id: "database", status: "fail" }),
        expect.objectContaining({ id: "auth_state", status: "fail" })
      ])
    );
  });

  it("passes production with strong access key, Postgres, and complete optional credentials", () => {
    const report = evaluateSetupEnvironment(
      {
        NODE_ENV: "production",
        AGENTIC_ACCESS_KEY: "a".repeat(40),
        DATABASE_URL: "postgres://agentic:agentic@localhost:5432/agentic",
        GOOGLE_CLIENT_ID: "client",
        GOOGLE_CLIENT_SECRET: "secret",
        GOOGLE_REFRESH_TOKEN: "refresh",
        AGENTIC_PROVIDER_SECRET_KEY: "b".repeat(40)
      },
      { nodeVersion: "20.11.0" }
    );

    expect(report.ok).toBe(true);
    expect(report.checks.every((check) => check.status !== "fail")).toBe(true);
  });

  it("fails partial Google configuration because connect actions cannot work", () => {
    const report = evaluateSetupEnvironment(
      {
        GOOGLE_CLIENT_ID: "client"
      },
      { nodeVersion: "20.11.0" }
    );

    expect(report.ok).toBe(false);
    expect(report.checks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: "google", status: "fail" })
      ])
    );
  });
});
