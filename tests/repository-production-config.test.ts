import { createRepository } from "@agentic/repository";

describe("repository production configuration", () => {
  const originalNodeEnv = process.env.NODE_ENV;
  const originalDatabaseUrl = process.env.DATABASE_URL;

  afterEach(() => {
    process.env.NODE_ENV = originalNodeEnv;
    process.env.DATABASE_URL = originalDatabaseUrl;
  });

  it("rejects the file-backed repository in production without DATABASE_URL", () => {
    process.env.NODE_ENV = "production";
    delete process.env.DATABASE_URL;

    expect(() => createRepository()).toThrow(/DATABASE_URL must be configured in production/);
  });

  it("still allows the file-backed repository outside production", () => {
    process.env.NODE_ENV = "test";
    delete process.env.DATABASE_URL;

    expect(() => createRepository()).not.toThrow();
  });

  it("honors an explicit file store path in tests even when DATABASE_URL is configured", () => {
    process.env.NODE_ENV = "test";
    process.env.DATABASE_URL = "postgres://agentic:agentic@localhost:5432/agentic";

    expect(() => createRepository({ storePath: "/tmp/agentic-test-store.json" })).not.toThrow();
  });
});
