import { createRepository } from "@agentic/repository";
import { mkdtemp, readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { SYSTEM_USER_ID } from "@agentic/contracts";

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

  it("prefers an explicit storePath over an ambient DATABASE_URL outside production", async () => {
    process.env.NODE_ENV = "test";
    process.env.DATABASE_URL = "postgres:///agentic-should-not-be-used";
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
});
