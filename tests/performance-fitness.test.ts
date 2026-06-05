import { mkdtemp, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { performance } from "node:perf_hooks";
import { DEFAULT_OWNER_USER_ID, ProviderCredentialSchema, createSystemActorContext } from "@agentic/contracts";
import { createRepository } from "@agentic/repository";
import { createSelfImprovementRepository } from "@agentic/self-improvement-memory";
import { createJobRecord } from "@agentic/execution";
import { enqueueDocsRenderJob, runWorkerRuntime } from "@agentic/worker-runtime";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AGENTIC_ACCESS_KEY_HEADER } from "../apps/web/lib/auth";
import { POST as briefingRoute } from "../apps/web/app/api/briefing/route";
import { POST as docsRenderRoute } from "../apps/web/app/api/docs/render/route";
import { POST as goalsCreateRoute } from "../apps/web/app/api/goals/route";

const ENQUEUE_ROUTE_BUDGET_MS = 250;
const DOCS_WORKER_BATCH_BUDGET_MS = 1_500;
const SMALL_QUEUE_BACKLOG_BUDGET_MS = 2_000;
const PUBLIC_READY_CACHE_P95_BUDGET_MS = 50;

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

async function writeLargeReadinessStore(storePath: string) {
  const now = "2026-04-16T04:00:00.000Z";
  const jobs = Array.from({ length: 10_000 }, (_, index) =>
    createJobRecord({
      id: `ready-large-job-${index}`,
      userId: DEFAULT_OWNER_USER_ID,
      kind: index % 2 === 0 ? "goal_create" : "docs_render",
      availableAt: "2026-04-16T03:59:00.000Z",
      payload:
        index % 2 === 0
          ? {
              type: "goal_create",
              goalId: `ready-large-goal-${index}`,
              workflowId: `ready-large-workflow-${index}`,
              request: "Synthetic readiness performance job.",
              workspaceId: null,
              agentId: null,
              metadata: {}
            }
          : {
              type: "docs_render",
              metadata: {}
            }
    })
  );
  const providerCredentials = Array.from({ length: 2_000 }, (_, index) =>
    ProviderCredentialSchema.parse({
      id: `google:global:ready-large-${index}`,
      userId: DEFAULT_OWNER_USER_ID,
      workspaceId: null,
      provider: "google",
      accountId: `ready-large-${index}`,
      accountEmail: `ready-large-${index}@example.com`,
      displayName: `Ready Large ${index}`,
      status: "connected",
      scopes: ["calendar.read"],
      lastValidatedAt: now,
      lastRotatedAt: null,
      lastRefreshAt: null,
      lastRefreshFailureAt: null,
      reconnectRequiredAt: null,
      revokedAt: null,
      expiresAt: null,
      metadata: {},
      actorContext: createSystemActorContext(DEFAULT_OWNER_USER_ID),
      createdAt: now,
      updatedAt: now
    })
  );

  await writeFile(
    storePath,
    JSON.stringify({
      version: 1,
      users: [],
      goals: [],
      workflows: [],
      tasks: [],
      memories: [],
      approvals: [],
      actionLogs: [],
      evidenceRecords: [],
      watchers: [],
      integrations: [],
      providerCredentials,
      providerCredentialSecrets: [],
      providerSideEffects: [],
      artifacts: [],
      workspaces: [],
      workspaceMembers: [],
      workspaceSelections: [],
      workspaceGovernance: [],
      goalShares: [],
      privacyOperations: [],
      commitments: [],
      policyRules: [],
      templates: [],
      workflowTemplates: [],
      autopilotSettings: [],
      autopilotEvents: [],
      jobs,
      agents: [],
      agentMetrics: [],
      briefingPreferences: [],
      operatorProducts: [],
      operatorProductSelections: []
    })
  );
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

  it("keeps cached public readiness p95 inside budget for large queue and credential sets", async () => {
    await writeLargeReadinessStore(process.env.AGENTIC_RUNTIME_STORE_PATH!);
    const { getPublicWebReadinessSummary, resetPublicWebReadinessCacheForTests } = await import(
      "../apps/web/lib/runtime-readiness"
    );
    resetPublicWebReadinessCacheForTests();

    await expect(getPublicWebReadinessSummary({
      ttlMs: 60_000
    })).resolves.toMatchObject({
      ok: true,
      status: "ready"
    });

    const durations: number[] = [];
    for (let index = 0; index < 25; index += 1) {
      durations.push(
        await measureDurationMs(async () => {
          await getPublicWebReadinessSummary({
            ttlMs: 60_000
          });
        })
      );
    }
    const p95 = [...durations].sort((left, right) => left - right)[Math.floor((durations.length - 1) * 0.95)] ?? 0;

    expect(p95).toBeLessThan(PUBLIC_READY_CACHE_P95_BUDGET_MS);
  });

  it("processes a small docs-render batch within the worker throughput budget", async () => {
    const repository = createRepository({
      storePath: process.env.AGENTIC_RUNTIME_STORE_PATH
    });
    const selfImprovementRepository = createSelfImprovementRepository({
      baseDir: await mkdtemp(path.join(os.tmpdir(), "agentic-performance-memory-"))
    });

    await Promise.all([
      repository.seedDefaults(DEFAULT_OWNER_USER_ID),
      selfImprovementRepository.seed()
    ]);

    for (let index = 0; index < 5; index += 1) {
      await enqueueDocsRenderJob({
        repository,
        userId: DEFAULT_OWNER_USER_ID,
        actorContext: createSystemActorContext(DEFAULT_OWNER_USER_ID),
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
      userId: DEFAULT_OWNER_USER_ID,
      kinds: ["docs_render"]
    });

    expect(jobs).toHaveLength(5);
    expect(jobs.every((job) => job.status === "completed")).toBe(true);
    expect(throughputDurationMs).toBeLessThan(DOCS_WORKER_BATCH_BUDGET_MS);
  });

  it("drains a small queue with bounded retry churn after a transient worker failure", async () => {
    const repository = createRepository({
      storePath: process.env.AGENTIC_RUNTIME_STORE_PATH
    });
    const selfImprovementRepository = createSelfImprovementRepository({
      baseDir: await mkdtemp(path.join(os.tmpdir(), "agentic-performance-memory-"))
    });

    await Promise.all([
      repository.seedDefaults(DEFAULT_OWNER_USER_ID),
      selfImprovementRepository.seed()
    ]);

    runDocsBuildMock
      .mockRejectedValueOnce(new Error("transient docs worker failure"))
      .mockResolvedValue({
        stdout: "docs ok",
        stderr: ""
      });

    for (let index = 0; index < 3; index += 1) {
      await enqueueDocsRenderJob({
        repository,
        userId: DEFAULT_OWNER_USER_ID,
        actorContext: createSystemActorContext(DEFAULT_OWNER_USER_ID),
        idempotencyKey: `performance-docs-retry-${index}`
      });
    }

    const throughputDurationMs = await measureDurationMs(async () => {
      await expect(
        runWorkerRuntime({
          repository,
          selfImprovementRepository,
          runnerId: "worker-performance-retry-fitness",
          maxJobs: 4,
          pollIntervalMs: 10,
          retryPolicy: {
            baseDelayMs: 10,
            factor: 1,
            maxDelayMs: 10
          }
        })
      ).resolves.toEqual({
        processedCount: 4,
        stopReason: "max_jobs"
      });
    });

    const jobs = await repository.listJobs({
      userId: DEFAULT_OWNER_USER_ID,
      kinds: ["docs_render"]
    });

    expect(runDocsBuildMock).toHaveBeenCalledTimes(4);
    expect(jobs).toHaveLength(3);
    expect(jobs.every((job) => job.status === "completed")).toBe(true);
    expect(jobs.filter((job) => job.attemptCount > 1)).toHaveLength(1);
    expect(Math.max(...jobs.map((job) => job.attemptCount))).toBeLessThanOrEqual(2);
    expect(throughputDurationMs).toBeLessThan(SMALL_QUEUE_BACKLOG_BUDGET_MS);
  });

  it("avoids duplicate execution when competing workers poll the same queued job", async () => {
    const repository = createRepository({
      storePath: process.env.AGENTIC_RUNTIME_STORE_PATH
    });
    const selfImprovementRepository = createSelfImprovementRepository({
      baseDir: await mkdtemp(path.join(os.tmpdir(), "agentic-performance-memory-"))
    });

    await Promise.all([
      repository.seedDefaults(DEFAULT_OWNER_USER_ID),
      selfImprovementRepository.seed()
    ]);

    runDocsBuildMock.mockImplementation(async () => {
      await new Promise((resolve) => setTimeout(resolve, 80));
      return {
        stdout: "docs ok",
        stderr: ""
      };
    });

    await enqueueDocsRenderJob({
      repository,
      userId: DEFAULT_OWNER_USER_ID,
      actorContext: createSystemActorContext(DEFAULT_OWNER_USER_ID),
      idempotencyKey: "performance-duplicate-execution"
    });

    const competingWorkerAbort = new AbortController();
    const abortTimer = setTimeout(() => {
      competingWorkerAbort.abort();
    }, 120);

    try {
      const [primaryWorker, competingWorker] = await Promise.all([
        runWorkerRuntime({
          repository,
          selfImprovementRepository,
          runnerId: "worker-performance-primary",
          maxJobs: 1,
          pollIntervalMs: 10
        }),
        runWorkerRuntime({
          repository,
          selfImprovementRepository,
          runnerId: "worker-performance-competing",
          signal: competingWorkerAbort.signal,
          pollIntervalMs: 10
        })
      ]);

      const jobs = await repository.listJobs({
        userId: DEFAULT_OWNER_USER_ID,
        kinds: ["docs_render"]
      });

      expect(primaryWorker).toEqual({
        processedCount: 1,
        stopReason: "max_jobs"
      });
      expect(competingWorker).toEqual({
        processedCount: 0,
        stopReason: "aborted"
      });
      expect(runDocsBuildMock).toHaveBeenCalledTimes(1);
      expect(jobs).toHaveLength(1);
      expect(jobs[0]).toMatchObject({
        status: "completed",
        attemptCount: 1
      });
    } finally {
      clearTimeout(abortTimer);
    }
  });
});
