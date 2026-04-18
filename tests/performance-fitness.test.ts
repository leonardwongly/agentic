import { mkdtemp } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { performance } from "node:perf_hooks";
import { SYSTEM_USER_ID, createSystemActorContext } from "@agentic/contracts";
import { createRepository } from "@agentic/repository";
import { createSelfImprovementRepository } from "@agentic/self-improvement-memory";
import { enqueueDocsRenderJob, runWorkerRuntime } from "@agentic/worker-runtime";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AGENTIC_ACCESS_KEY_HEADER } from "../apps/web/lib/auth";
import { POST as briefingRoute } from "../apps/web/app/api/briefing/route";
import { POST as docsRenderRoute } from "../apps/web/app/api/docs/render/route";
import { POST as goalsCreateRoute } from "../apps/web/app/api/goals/route";

const ENQUEUE_ROUTE_BUDGET_MS = 250;
const DOCS_WORKER_BATCH_BUDGET_MS = 1_500;

const { runDocsBuildMock } = vi.hoisted(() => ({
  runDocsBuildMock: vi.fn(async () => ({
    stdout: "docs ok",
    stderr: ""
  }))
}));

vi.mock("@agentic/docs-runtime", () => ({
  runDocsBuild: runDocsBuildMock
}));

async function measureDurationMs(callback: () => Promise<void>) {
  const startedAt = performance.now();
  await callback();
  return performance.now() - startedAt;
}

function buildAuthorizedRequest(url: string, init?: RequestInit) {
  return new Request(url, {
    ...init,
    headers: {
      [AGENTIC_ACCESS_KEY_HEADER]: "test-access-key",
      ...(init?.headers ?? {})
    }
  });
}

describe("performance fitness", () => {
  const originalAccessKey = process.env.AGENTIC_ACCESS_KEY;
  const originalRuntimeStorePath = process.env.AGENTIC_RUNTIME_STORE_PATH;

  beforeEach(async () => {
    process.env.AGENTIC_ACCESS_KEY = "test-access-key";
    process.env.AGENTIC_RUNTIME_STORE_PATH = path.join(
      await mkdtemp(path.join(os.tmpdir(), "agentic-performance-fitness-")),
      "runtime-store.json"
    );
    Reflect.set(globalThis, "__agenticRepository", undefined);
    Reflect.set(globalThis, "__agenticSelfImprovementRepository", undefined);
  });

  afterEach(() => {
    process.env.AGENTIC_ACCESS_KEY = originalAccessKey;
    process.env.AGENTIC_RUNTIME_STORE_PATH = originalRuntimeStorePath;
    Reflect.set(globalThis, "__agenticRepository", undefined);
    Reflect.set(globalThis, "__agenticSelfImprovementRepository", undefined);
    vi.restoreAllMocks();
    runDocsBuildMock.mockReset();
    runDocsBuildMock.mockResolvedValue({
      stdout: "docs ok",
      stderr: ""
    });
  });

  it("keeps queued endpoint latency inside the enqueue budget", async () => {
    await goalsCreateRoute(
      buildAuthorizedRequest("http://localhost/api/goals", {
        method: "POST",
        headers: {
          "content-type": "application/json"
        },
        body: JSON.stringify({
          request: "Warm the queued goal creation path."
        })
      })
    );
    await briefingRoute(
        buildAuthorizedRequest("http://localhost/api/briefing", {
          method: "POST",
          headers: {
            "content-type": "application/json"
          },
          body: JSON.stringify({
            type: "startup"
          })
        })
      );
    await docsRenderRoute(
      buildAuthorizedRequest("http://localhost/api/docs/render", {
        method: "POST"
      })
    );

    const goalDurationMs = await measureDurationMs(async () => {
      const response = await goalsCreateRoute(
        buildAuthorizedRequest("http://localhost/api/goals", {
          method: "POST",
          headers: {
            "content-type": "application/json"
          },
          body: JSON.stringify({
            request: "Queue a goal creation latency sanity check."
          })
        })
      );

      expect(response.status).toBe(202);
    });
    const briefingDurationMs = await measureDurationMs(async () => {
      const response = await briefingRoute(
        buildAuthorizedRequest("http://localhost/api/briefing", {
          method: "POST",
          headers: {
            "content-type": "application/json"
          },
          body: JSON.stringify({
            type: "startup"
          })
        })
      );

      expect(response.status).toBe(202);
    });
    const docsDurationMs = await measureDurationMs(async () => {
      const response = await docsRenderRoute(
        buildAuthorizedRequest("http://localhost/api/docs/render", {
          method: "POST"
        })
      );

      expect(response.status).toBe(202);
    });

    expect(goalDurationMs).toBeLessThan(ENQUEUE_ROUTE_BUDGET_MS);
    expect(briefingDurationMs).toBeLessThan(ENQUEUE_ROUTE_BUDGET_MS);
    expect(docsDurationMs).toBeLessThan(ENQUEUE_ROUTE_BUDGET_MS);
  });

  it("processes a small docs-render batch within the worker throughput budget", async () => {
    const repository = createRepository({
      storePath: process.env.AGENTIC_RUNTIME_STORE_PATH
    });
    const selfImprovementRepository = createSelfImprovementRepository({
      baseDir: await mkdtemp(path.join(os.tmpdir(), "agentic-performance-memory-"))
    });

    await Promise.all([
      repository.seedDefaults(SYSTEM_USER_ID),
      selfImprovementRepository.seed()
    ]);

    for (let index = 0; index < 5; index += 1) {
      await enqueueDocsRenderJob({
        repository,
        userId: SYSTEM_USER_ID,
        actorContext: createSystemActorContext(SYSTEM_USER_ID),
        idempotencyKey: `performance-docs-batch-${index}`
      });
    }

    const throughputDurationMs = await measureDurationMs(async () => {
      await expect(
        runWorkerRuntime({
          repository,
          selfImprovementRepository,
          runnerId: "worker-performance-fitness",
          maxJobs: 5,
          pollIntervalMs: 10
        })
      ).resolves.toEqual({
        processedCount: 5,
        stopReason: "max_jobs"
      });
    });

    const jobs = await repository.listJobs({
      userId: SYSTEM_USER_ID,
      kinds: ["docs_render"]
    });

    expect(jobs).toHaveLength(5);
    expect(jobs.every((job) => job.status === "completed")).toBe(true);
    expect(throughputDurationMs).toBeLessThan(DOCS_WORKER_BATCH_BUDGET_MS);
  });
});
