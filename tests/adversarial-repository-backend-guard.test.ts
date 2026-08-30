import { afterEach, describe, expect, it } from "vitest";
import { createRepository } from "@agentic/repository";

const ORIGINAL_DATABASE_URL = process.env.DATABASE_URL;
const ORIGINAL_NODE_ENV = process.env.NODE_ENV;
const ORIGINAL_OPT_IN = process.env.AGENTIC_ALLOW_REMOTE_DEV_DATABASE_URL;

function restore(name: string, value: string | undefined) {
  if (value === undefined) {
    delete process.env[name];
  } else {
    process.env[name] = value;
  }
}

afterEach(() => {
  restore("DATABASE_URL", ORIGINAL_DATABASE_URL);
  restore("NODE_ENV", ORIGINAL_NODE_ENV);
  restore("AGENTIC_ALLOW_REMOTE_DEV_DATABASE_URL", ORIGINAL_OPT_IN);
});

// `createRepository()` with an ambient DATABASE_URL proceeds to construct a PostgresRepository,
// which is lazy (no connection at construction). The "allowed" cases still wrap in try/catch so
// the assertion is only ever about the guard message, never about Postgres pool setup.
function expectNoGuardRefusal(create: () => unknown) {
  try {
    create();
  } catch (error) {
    expect(String(error)).not.toMatch(/Refusing to connect/);
  }
}

describe("adversarial repository backend guard", () => {
  it("refuses an ambient remote DATABASE_URL outside production", () => {
    process.env.NODE_ENV = "development";
    process.env.DATABASE_URL = "postgres://user:pass@db.example.com:5432/app";
    delete process.env.AGENTIC_ALLOW_REMOTE_DEV_DATABASE_URL;

    expect(() => createRepository()).toThrow(/Refusing to connect/);
  });

  it("allows the same remote URL when the operator explicitly opts in", () => {
    process.env.NODE_ENV = "development";
    process.env.DATABASE_URL = "postgres://user:pass@db.example.com:5432/app";
    process.env.AGENTIC_ALLOW_REMOTE_DEV_DATABASE_URL = "true";

    expectNoGuardRefusal(() => createRepository());
  });

  it("allows localhost ambient URLs in development", () => {
    process.env.NODE_ENV = "development";
    process.env.DATABASE_URL = "postgres://user:pass@localhost:5432/app";
    delete process.env.AGENTIC_ALLOW_REMOTE_DEV_DATABASE_URL;

    expectNoGuardRefusal(() => createRepository());
  });

  it("never guards an explicitly-passed databaseUrl (tests, parity suite)", () => {
    process.env.NODE_ENV = "development";
    process.env.DATABASE_URL = "postgres://user:pass@db.example.com:5432/app";

    expectNoGuardRefusal(() => createRepository({ databaseUrl: "postgres://user:pass@localhost:5432/test" }));
  });

  it("never guards production", () => {
    process.env.NODE_ENV = "production";
    process.env.DATABASE_URL = "postgres://user:pass@db.example.com:5432/app";
    delete process.env.AGENTIC_ALLOW_REMOTE_DEV_DATABASE_URL;

    expectNoGuardRefusal(() => createRepository());
  });
});
