import { mkdtemp } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  AGENTIC_ACCESS_KEY_HEADER,
  AGENTIC_MACHINE_TOKEN_HEADER,
  AGENTIC_MACHINE_TOKENS_ENV,
  hashMachineTokenSecret
} from "../apps/web/lib/auth";
import { POST as workerTickRoute } from "../apps/web/app/api/worker/tick/route";

describe("worker tick route auth", () => {
  const originalAccessKey = process.env.AGENTIC_ACCESS_KEY;
  const originalMachineTokens = process.env[AGENTIC_MACHINE_TOKENS_ENV];
  const originalRuntimeStorePath = process.env.AGENTIC_RUNTIME_STORE_PATH;
  const originalDatabaseUrl = process.env.DATABASE_URL;

  beforeEach(async () => {
    process.env.AGENTIC_ACCESS_KEY = "test-access-key";
    delete process.env.DATABASE_URL;
    delete process.env[AGENTIC_MACHINE_TOKENS_ENV];
    process.env.AGENTIC_RUNTIME_STORE_PATH = path.join(
      await mkdtemp(path.join(os.tmpdir(), "agentic-worker-tick-")),
      "runtime-store.json"
    );
    Reflect.set(globalThis, "__agenticRepository", undefined);
    Reflect.set(globalThis, "__agenticSelfImprovementRepository", undefined);
  });

  afterEach(() => {
    process.env.AGENTIC_ACCESS_KEY = originalAccessKey;
    if (originalMachineTokens === undefined) {
      delete process.env[AGENTIC_MACHINE_TOKENS_ENV];
    } else {
      process.env[AGENTIC_MACHINE_TOKENS_ENV] = originalMachineTokens;
    }
    if (originalDatabaseUrl === undefined) {
      delete process.env.DATABASE_URL;
    } else {
      process.env.DATABASE_URL = originalDatabaseUrl;
    }
    process.env.AGENTIC_RUNTIME_STORE_PATH = originalRuntimeStorePath;
    Reflect.set(globalThis, "__agenticRepository", undefined);
    Reflect.set(globalThis, "__agenticSelfImprovementRepository", undefined);
  });

  function configureMachineToken(params: { scopes?: string[]; routeGroups?: string[] } = {}) {
    process.env[AGENTIC_MACHINE_TOKENS_ENV] = JSON.stringify([
      {
        id: "worker-tick-bot",
        subject: "scheduled worker tick",
        userId: "owner",
        tokenHash: hashMachineTokenSecret("tick-secret"),
        scopes: params.scopes ?? ["worker:tick"],
        routeGroups: params.routeGroups ?? ["worker"],
        expiresAt: "2099-01-01T00:00:00.000Z"
      }
    ]);
  }

  function tickRequest(headers: Record<string, string>) {
    return workerTickRoute(
      new Request("http://localhost/api/worker/tick", {
        method: "POST",
        headers: { "content-type": "application/json", ...headers },
        body: JSON.stringify({ maxJobs: 1, maxDurationMs: 2000 })
      })
    );
  }

  it("rejects anonymous requests", async () => {
    const response = await tickRequest({});
    expect(response.status).toBe(401);
  });

  it("rejects the global bootstrap access key", async () => {
    const response = await tickRequest({ [AGENTIC_ACCESS_KEY_HEADER]: "test-access-key" });
    const payload = (await response.json()) as { error: string };
    expect(response.status).toBe(401);
    expect(payload.error).toContain("Bootstrap access key is not allowed");
  });

  it("rejects a machine token outside the worker route group", async () => {
    configureMachineToken({ routeGroups: ["automation"] });
    const response = await tickRequest({ [AGENTIC_MACHINE_TOKEN_HEADER]: "tick-secret" });
    expect(response.status).toBe(401);
  });

  it("rejects a machine token without the worker:tick scope", async () => {
    configureMachineToken({ scopes: ["jobs:create"] });
    const response = await tickRequest({ [AGENTIC_MACHINE_TOKEN_HEADER]: "tick-secret" });
    expect(response.status).toBe(401);
  });

  it("accepts a scoped worker:tick machine token and drains the queue", async () => {
    configureMachineToken();
    const response = await tickRequest({ [AGENTIC_MACHINE_TOKEN_HEADER]: "tick-secret" });
    const payload = (await response.json()) as {
      tick: { stopReason: string; processedCount: number; runnerId: string };
    };
    expect(response.status).toBe(200);
    expect(payload.tick.stopReason).toBe("drained");
    expect(payload.tick.processedCount).toBe(0);
  });
});
