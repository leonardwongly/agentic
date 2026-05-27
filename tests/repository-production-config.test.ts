import { createRepository } from "@agentic/repository";
import { mkdtemp, readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { DEFAULT_OWNER_USER_ID } from "@agentic/contracts";

describe("repository production configuration", () => {
  const originalNodeEnv = process.env.NODE_ENV;
  const originalDatabaseUrl = process.env.DATABASE_URL;
  const originalGovernanceProfile = process.env.AGENTIC_GOVERNANCE_DEFAULT_PROFILE;
  const originalAllowDemoGovernanceDefaults = process.env.AGENTIC_ALLOW_DEMO_GOVERNANCE_DEFAULTS;

  function restoreEnv(name: string, value: string | undefined) {
    if (value === undefined) {
      delete process.env[name];
      return;
    }

    process.env[name] = value;
  }

  afterEach(() => {
    restoreEnv("NODE_ENV", originalNodeEnv);
    restoreEnv("DATABASE_URL", originalDatabaseUrl);
    restoreEnv("AGENTIC_GOVERNANCE_DEFAULT_PROFILE", originalGovernanceProfile);
    restoreEnv("AGENTIC_ALLOW_DEMO_GOVERNANCE_DEFAULTS", originalAllowDemoGovernanceDefaults);
  });

  it("rejects the file-backed repository in production without DATABASE_URL", () => {
    process.env.NODE_ENV = "production";
    delete process.env.DATABASE_URL;
    delete process.env.AGENTIC_GOVERNANCE_DEFAULT_PROFILE;

    expect(() => createRepository()).toThrow(/DATABASE_URL must be configured in production/);
  });

  it("rejects demo governance defaults at production startup unless explicitly allowed", () => {
    process.env.NODE_ENV = "production";
    process.env.DATABASE_URL = "postgres:///agentic-production";
    process.env.AGENTIC_GOVERNANCE_DEFAULT_PROFILE = "demo";
    delete process.env.AGENTIC_ALLOW_DEMO_GOVERNANCE_DEFAULTS;

    expect(() => createRepository()).toThrow(/AGENTIC_GOVERNANCE_DEFAULT_PROFILE=demo is not allowed in production/);
  });

  it("allows demo governance defaults only when production startup opts in explicitly", () => {
    process.env.NODE_ENV = "production";
    process.env.DATABASE_URL = "postgres:///agentic-production";
    process.env.AGENTIC_GOVERNANCE_DEFAULT_PROFILE = "demo";
    process.env.AGENTIC_ALLOW_DEMO_GOVERNANCE_DEFAULTS = "true";

    expect(() => createRepository()).not.toThrow();
  });

  it("still allows the file-backed repository outside production", () => {
    process.env.NODE_ENV = "test";
    delete process.env.DATABASE_URL;
    delete process.env.AGENTIC_GOVERNANCE_DEFAULT_PROFILE;

    expect(() => createRepository()).not.toThrow();
  });

  it("prefers an explicit storePath over an ambient DATABASE_URL outside production", async () => {
    process.env.NODE_ENV = "test";
    process.env.DATABASE_URL = "postgres:///agentic-should-not-be-used";
    delete process.env.AGENTIC_GOVERNANCE_DEFAULT_PROFILE;
    const storePath = path.join(await mkdtemp(path.join(os.tmpdir(), "agentic-repo-config-")), "runtime-store.json");
    const repository = createRepository({
      storePath
    });

    await repository.seedDefaults(DEFAULT_OWNER_USER_ID);

    const persisted = JSON.parse(await readFile(storePath, "utf8")) as {
      users: Array<{ id: string }>;
    };

    expect(persisted.users.some((user) => user.id === DEFAULT_OWNER_USER_ID)).toBe(true);
  });
});
