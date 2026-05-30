import { createRepository } from "@agentic/repository";
import { mkdtemp, readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { SYSTEM_USER_ID } from "@agentic/contracts";

describe("repository production configuration", () => {
  const originalNodeEnv = process.env.NODE_ENV;
  const originalDatabaseUrl = process.env.DATABASE_URL;
  const originalGovernanceProfile = process.env.AGENTIC_GOVERNANCE_DEFAULT_PROFILE;
  const originalAllowDemoGovernanceDefaults = process.env.AGENTIC_ALLOW_DEMO_GOVERNANCE_DEFAULTS;
  const originalBootstrapUserId = process.env.AGENTIC_BOOTSTRAP_USER_ID;
  const originalBootstrapDisplayName = process.env.AGENTIC_BOOTSTRAP_DISPLAY_NAME;
  const originalDefaultTimezone = process.env.AGENTIC_DEFAULT_TIMEZONE;

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
    restoreEnv("AGENTIC_BOOTSTRAP_USER_ID", originalBootstrapUserId);
    restoreEnv("AGENTIC_BOOTSTRAP_DISPLAY_NAME", originalBootstrapDisplayName);
    restoreEnv("AGENTIC_DEFAULT_TIMEZONE", originalDefaultTimezone);
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

    await repository.seedDefaults(SYSTEM_USER_ID);

    const persisted = JSON.parse(await readFile(storePath, "utf8")) as {
      users: Array<{ id: string }>;
    };

    expect(persisted.users.some((user) => user.id === SYSTEM_USER_ID)).toBe(true);
  });

  it("seeds neutral install-local owner defaults from bootstrap config", async () => {
    process.env.NODE_ENV = "test";
    process.env.AGENTIC_BOOTSTRAP_USER_ID = "installer-admin";
    process.env.AGENTIC_BOOTSTRAP_DISPLAY_NAME = "Installer Admin";
    process.env.AGENTIC_DEFAULT_TIMEZONE = "UTC";
    const storePath = path.join(await mkdtemp(path.join(os.tmpdir(), "agentic-repo-owner-")), "runtime-store.json");
    const repository = createRepository({ storePath });

    await repository.seedDefaults();

    const persisted = JSON.parse(await readFile(storePath, "utf8")) as {
      users: Array<{ id: string; name: string; timezone: string }>;
      memories: Array<{ content: string }>;
    };

    expect(persisted.users).toContainEqual(expect.objectContaining({
      id: "installer-admin",
      name: "Installer Admin",
      timezone: "UTC"
    }));
    expect(persisted.memories.map((memory) => memory.content).join("\n")).not.toMatch(/Leonard|Asia\/Singapore|user-primary/u);
  });

  it("keeps llm cache schema creation migration-managed", async () => {
    const [repositorySource, migrationSource] = await Promise.all([
      readFile(path.join(process.cwd(), "packages/repository/src/postgres-repository.ts"), "utf8"),
      readFile(path.join(process.cwd(), "packages/db/migrations/0012_llm_cache.sql"), "utf8")
    ]);

    expect(repositorySource).not.toMatch(/create\s+table\s+if\s+not\s+exists\s+llm_cache/iu);
    expect(migrationSource).toMatch(/create\s+table\s+if\s+not\s+exists\s+llm_cache/iu);
  });
});
