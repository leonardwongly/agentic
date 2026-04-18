import { mkdtemp } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { SYSTEM_USER_ID } from "@agentic/contracts";
import { createRepository } from "@agentic/repository";
import { createSelfImprovementRepository } from "@agentic/self-improvement-memory";
import { runWorkerRuntime } from "@agentic/worker-runtime";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GET as docsJobRoute } from "../apps/web/app/api/docs/jobs/[id]/route";
import { POST as docsRenderRoute } from "../apps/web/app/api/docs/render/route";
import { AGENTIC_ACCESS_KEY_HEADER } from "../apps/web/lib/auth";
import {
  resetAuthSessionStateStoreForTesting,
  setAuthSessionStateStoreForTesting,
  type AuthSessionStateStore
} from "../apps/web/lib/auth-session-store";
import { expectNoStoreHeaders } from "./route-test-helpers";

const { runDocsBuildMock } = vi.hoisted(() => ({
  runDocsBuildMock: vi.fn(async () => ({
    stdout: "docs ok",
    stderr: ""
  }))
}));

vi.mock("@agentic/docs-runtime", () => ({
  runDocsBuild: runDocsBuildMock
}));

function buildAuthorizedRequest(options?: { idempotencyKey?: string }) {
  return new Request("http://localhost/api/docs/render", {
    method: "POST",
    headers: {
      [AGENTIC_ACCESS_KEY_HEADER]: "test-access-key",
      ...(options?.idempotencyKey ? { "x-idempotency-key": options.idempotencyKey } : {})
    }
  });
}

function buildAuthorizedGetRequest(url: string) {
  return new Request(url, {
    method: "GET",
    headers: {
      [AGENTIC_ACCESS_KEY_HEADER]: "test-access-key"
    }
  });
}

describe("docs render route", () => {
  const originalAccessKey = process.env.AGENTIC_ACCESS_KEY;
  const originalRuntimeStorePath = process.env.AGENTIC_RUNTIME_STORE_PATH;

  async function processQueuedDocsJobs(options?: {
    maxJobs?: number;
    retryPolicy?: {
      baseDelayMs?: number;
      factor?: number;
      maxDelayMs?: number;
    };
  }) {
    const repository = createRepository({
      storePath: process.env.AGENTIC_RUNTIME_STORE_PATH
    });
    const selfImprovementRepository = createSelfImprovementRepository({
      baseDir: await mkdtemp(path.join(os.tmpdir(), "agentic-docs-route-memory-"))
    });

    await Promise.all([
      repository.seedDefaults(SYSTEM_USER_ID),
      selfImprovementRepository.seed()
    ]);

    return runWorkerRuntime({
      repository,
      selfImprovementRepository,
      runnerId: "worker-docs-route-test",
      maxJobs: options?.maxJobs ?? 1,
      pollIntervalMs: 50,
      retryPolicy: options?.retryPolicy
    });
  }

  beforeEach(async () => {
    process.env.AGENTIC_ACCESS_KEY = "test-access-key";
    process.env.AGENTIC_RUNTIME_STORE_PATH = path.join(
      await mkdtemp(path.join(os.tmpdir(), "agentic-docs-routes-")),
      "runtime-store.json"
    );
    Reflect.set(globalThis, "__agenticRepository", undefined);
    Reflect.set(globalThis, "__agenticSelfImprovementRepository", undefined);
    Reflect.set(globalThis, "__agenticDocsBuild", undefined);
    runDocsBuildMock.mockReset();
    runDocsBuildMock.mockResolvedValue({
      stdout: "docs ok",
      stderr: ""
    });
  });

  afterEach(() => {
    process.env.AGENTIC_ACCESS_KEY = originalAccessKey;
    process.env.AGENTIC_RUNTIME_STORE_PATH = originalRuntimeStorePath;
    Reflect.set(globalThis, "__agenticRepository", undefined);
    Reflect.set(globalThis, "__agenticSelfImprovementRepository", undefined);
    Reflect.set(globalThis, "__agenticDocsBuild", undefined);
    resetAuthSessionStateStoreForTesting();
  });

  it("queues docs builds and exposes a pollable status endpoint", async () => {
    const response = await docsRenderRoute(buildAuthorizedRequest());
    const payload = (await response.json()) as {
      job: { id: string; kind: string; status: string };
      statusUrl: string;
    };

    expect(response.status).toBe(202);
    expect(payload.job.kind).toBe("docs_render");
    expect(payload.job.status).toBe("queued");
    expect(payload.statusUrl).toBe(`/api/docs/jobs/${payload.job.id}`);
    expectNoStoreHeaders(response);

    const queuedStatusResponse = await docsJobRoute(
      buildAuthorizedGetRequest(`http://localhost${payload.statusUrl}`),
      { params: Promise.resolve({ id: payload.job.id }) }
    );
    const queuedStatusPayload = (await queuedStatusResponse.json()) as {
      job: { id: string; status: string };
      result: null;
      error: null;
    };

    expect(queuedStatusResponse.status).toBe(202);
    expect(queuedStatusPayload.job.id).toBe(payload.job.id);
    expect(queuedStatusPayload.job.status).toBe("queued");
    expect(queuedStatusPayload.result).toBeNull();
    expect(queuedStatusPayload.error).toBeNull();

    const workerResult = await processQueuedDocsJobs();
    const completedStatusResponse = await docsJobRoute(
      buildAuthorizedGetRequest(`http://localhost${payload.statusUrl}`),
      { params: Promise.resolve({ id: payload.job.id }) }
    );
    const completedStatusPayload = (await completedStatusResponse.json()) as {
      job: { id: string; status: string };
      result: { message: string };
      error: null;
    };

    expect(workerResult).toEqual({
      processedCount: 1,
      stopReason: "max_jobs"
    });
    expect(runDocsBuildMock).toHaveBeenCalledTimes(1);
    expect(completedStatusResponse.status).toBe(200);
    expect(completedStatusPayload.job.id).toBe(payload.job.id);
    expect(completedStatusPayload.job.status).toBe("completed");
    expect(completedStatusPayload.result.message).toBe("Rendered and validated build/agentic.docx.");
    expect(completedStatusPayload.error).toBeNull();
    expectNoStoreHeaders(completedStatusResponse);
  });

  it("deduplicates retried docs builds when the same idempotency key is reused", async () => {
    const firstResponse = await docsRenderRoute(buildAuthorizedRequest({ idempotencyKey: "docs-render-retry-1" }));
    const secondResponse = await docsRenderRoute(buildAuthorizedRequest({ idempotencyKey: "docs-render-retry-1" }));
    const firstPayload = (await firstResponse.json()) as {
      job: { id: string };
      statusUrl: string;
    };
    const secondPayload = (await secondResponse.json()) as {
      job: { id: string };
      statusUrl: string;
    };
    const repository = createRepository({
      storePath: process.env.AGENTIC_RUNTIME_STORE_PATH
    });

    await repository.seedDefaults(SYSTEM_USER_ID);

    expect(firstResponse.status).toBe(202);
    expect(secondResponse.status).toBe(202);
    expect(firstPayload.job.id).toBe(secondPayload.job.id);
    expect(firstPayload.statusUrl).toBe(secondPayload.statusUrl);
    expect(await repository.listJobs({ userId: SYSTEM_USER_ID })).toHaveLength(1);
  });

  it("does not leak raw docs-build internals after worker failure", async () => {
    runDocsBuildMock.mockRejectedValue(new Error("spawn /bin/node EACCES"));

    const response = await docsRenderRoute(buildAuthorizedRequest());
    const payload = (await response.json()) as {
      job: { id: string };
      statusUrl: string;
    };

    expect(response.status).toBe(202);

    const workerResult = await processQueuedDocsJobs({
      maxJobs: 3,
      retryPolicy: {
        baseDelayMs: 1,
        factor: 1,
        maxDelayMs: 1
      }
    });
    const failedStatusResponse = await docsJobRoute(
      buildAuthorizedGetRequest(`http://localhost${payload.statusUrl}`),
      { params: Promise.resolve({ id: payload.job.id }) }
    );
    const failedStatusPayload = (await failedStatusResponse.json()) as {
      job: { id: string; status: string };
      result: null;
      error: string;
    };

    expect(workerResult).toEqual({
      processedCount: 3,
      stopReason: "max_jobs"
    });
    expect(failedStatusResponse.status).toBe(200);
    expect(failedStatusPayload.job.id).toBe(payload.job.id);
    expect(failedStatusPayload.job.status).toBe("dead_letter");
    expect(failedStatusPayload.result).toBeNull();
    expect(failedStatusPayload.error).toBe("Document build failed. Retry the request or inspect worker logs.");
    expect(failedStatusPayload.error).not.toContain("spawn /bin/node EACCES");
    expectNoStoreHeaders(failedStatusResponse);
  });

  it("rate limits docs renders with a route-scoped abuse key", async () => {
    const seenKeys: string[] = [];
    const store: AuthSessionStateStore = {
      scope: "shared",
      async checkRateLimit(key) {
        seenKeys.push(key);
        return {
          allowed: false,
          retryAfterMs: 30_000
        };
      },
      async clearRateLimit() {},
      async revokeSession() {},
      async isSessionRevoked() {
        return false;
      },
      async reset() {}
    };

    setAuthSessionStateStoreForTesting(store);

    const response = await docsRenderRoute(
      new Request("http://localhost/api/docs/render", {
        method: "POST",
        headers: {
          [AGENTIC_ACCESS_KEY_HEADER]: "test-access-key",
          "user-agent": "Agentic Docs Rate Limit Test",
          "accept-language": "en-SG"
        }
      })
    );
    const payload = (await response.json()) as { error?: string };

    expect(response.status).toBe(429);
    expect(payload.error).toBe("Too many document render requests. Try again later.");
    expect(response.headers.get("retry-after")).toBe("30");
    expect(seenKeys).toHaveLength(1);
    expect(seenKeys[0]).toContain("docs-render:user:");
    expect(seenKeys[0]).toContain(":fp:/api/docs/render:");
  });
});
