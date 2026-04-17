import { mkdtemp } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { SYSTEM_USER_ID } from "@agentic/contracts";
import { createRepository } from "@agentic/repository";
import { createSelfImprovementRepository } from "@agentic/self-improvement-memory";
import { runWorkerRuntime } from "@agentic/worker-runtime";
import { vi } from "vitest";
import * as authModule from "../apps/web/lib/auth";
import { AGENTIC_ACCESS_KEY_HEADER } from "../apps/web/lib/auth";
import { GET as briefingJobRoute } from "../apps/web/app/api/briefing/jobs/[id]/route";
import { POST as briefingRoute } from "../apps/web/app/api/briefing/route";

describe("briefing route", () => {
  const originalAccessKey = process.env.AGENTIC_ACCESS_KEY;
  const originalRuntimeStorePath = process.env.AGENTIC_RUNTIME_STORE_PATH;

  async function processQueuedBriefingJobs(maxJobs = 1) {
    const repository = createRepository({
      storePath: process.env.AGENTIC_RUNTIME_STORE_PATH
    });
    const selfImprovementRepository = createSelfImprovementRepository({
      baseDir: await mkdtemp(path.join(os.tmpdir(), "agentic-briefing-route-memory-"))
    });

    await Promise.all([
      repository.seedDefaults(SYSTEM_USER_ID),
      selfImprovementRepository.seed()
    ]);

    return runWorkerRuntime({
      repository,
      selfImprovementRepository,
      runnerId: "worker-briefing-route-test",
      maxJobs,
      pollIntervalMs: 50
    });
  }

  beforeEach(async () => {
    process.env.AGENTIC_ACCESS_KEY = "test-access-key";
    process.env.AGENTIC_RUNTIME_STORE_PATH = path.join(
      await mkdtemp(path.join(os.tmpdir(), "agentic-briefing-route-")),
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
  });

  it("queues briefing creation, exposes a pollable status route, and completes through the worker runtime", async () => {
    const repository = createRepository({
      storePath: process.env.AGENTIC_RUNTIME_STORE_PATH
    });

    await repository.seedDefaults(SYSTEM_USER_ID);
    const current = await repository.getBriefingPreferences(SYSTEM_USER_ID);
    await repository.saveBriefingPreferences({
      ...current,
      focus: "urgent",
      timezone: "America/New_York"
    });
    Reflect.set(globalThis, "__agenticRepository", undefined);

    const createResponse = await briefingRoute(
      new Request("http://localhost/api/briefing", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          [AGENTIC_ACCESS_KEY_HEADER]: "test-access-key"
        },
        body: JSON.stringify({ type: "midday" })
      })
    );
    const createPayload = (await createResponse.json()) as {
      job: {
        id: string;
        kind: string;
        status: string;
        goalId: string;
        briefingType: string;
      };
      statusUrl: string;
    };

    expect(createResponse.status).toBe(202);
    expect(createPayload.job.kind).toBe("briefing_create");
    expect(createPayload.job.status).toBe("queued");
    expect(createPayload.job.briefingType).toBe("midday");
    expect(createPayload.statusUrl).toBe(`/api/briefing/jobs/${createPayload.job.id}`);
    expect(await repository.listGoals(SYSTEM_USER_ID)).toHaveLength(0);
    expect(await repository.listJobs({ userId: SYSTEM_USER_ID })).toHaveLength(1);

    const queuedStatusResponse = await briefingJobRoute(
      new Request(`http://localhost${createPayload.statusUrl}`, {
        method: "GET",
        headers: {
          [AGENTIC_ACCESS_KEY_HEADER]: "test-access-key"
        }
      }),
      {
        params: Promise.resolve({ id: createPayload.job.id })
      }
    );
    const queuedStatusPayload = (await queuedStatusResponse.json()) as {
      job: { id: string; status: string; goalId: string; briefingType: string };
      result: null;
      error: null;
    };

    expect(queuedStatusResponse.status).toBe(202);
    expect(queuedStatusPayload.job.id).toBe(createPayload.job.id);
    expect(queuedStatusPayload.job.status).toBe("queued");
    expect(queuedStatusPayload.job.briefingType).toBe("midday");
    expect(queuedStatusPayload.result).toBeNull();
    expect(queuedStatusPayload.error).toBeNull();

    const workerResult = await processQueuedBriefingJobs();
    const completedStatusResponse = await briefingJobRoute(
      new Request(`http://localhost${createPayload.statusUrl}`, {
        method: "GET",
        headers: {
          [AGENTIC_ACCESS_KEY_HEADER]: "test-access-key"
        }
      }),
      {
        params: Promise.resolve({ id: createPayload.job.id })
      }
    );
    const completedStatusPayload = (await completedStatusResponse.json()) as {
      job: { id: string; status: string; goalId: string; briefingType: string };
      result: {
        goalId: string;
        taskCount: number;
        completedTaskCount: number;
      };
      error: null;
    };
    const persistedBundle = await repository.getGoalBundleForUser(createPayload.job.goalId, SYSTEM_USER_ID);
    const dashboard = await repository.getDashboardData(SYSTEM_USER_ID);

    expect(workerResult).toEqual({
      processedCount: 1,
      stopReason: "max_jobs"
    });
    expect(completedStatusResponse.status).toBe(200);
    expect(completedStatusPayload.job.id).toBe(createPayload.job.id);
    expect(completedStatusPayload.job.status).toBe("completed");
    expect(completedStatusPayload.job.briefingType).toBe("midday");
    expect(completedStatusPayload.result.goalId).toBe(createPayload.job.goalId);
    expect(completedStatusPayload.result.taskCount).toBeGreaterThan(0);
    expect(completedStatusPayload.result.completedTaskCount).toBeGreaterThan(0);
    expect(completedStatusPayload.error).toBeNull();
    expect(persistedBundle?.goal.intent).toBe("briefing:midday");
    expect(persistedBundle?.goal.title).toContain("Midday drift check");
    expect(persistedBundle?.goal.explanation).toContain("urgent");
    expect(dashboard.briefingHistory).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          goalId: createPayload.job.goalId,
          type: "midday"
        })
      ])
    );
  });

  it("defaults empty requests to a startup briefing job", async () => {
    const repository = createRepository({
      storePath: process.env.AGENTIC_RUNTIME_STORE_PATH
    });

    await repository.seedDefaults(SYSTEM_USER_ID);
    Reflect.set(globalThis, "__agenticRepository", undefined);

    const response = await briefingRoute(
      new Request("http://localhost/api/briefing", {
        method: "POST",
        headers: {
          [AGENTIC_ACCESS_KEY_HEADER]: "test-access-key"
        }
      })
    );
    const payload = (await response.json()) as {
      job: { id: string; kind: string; status: string; briefingType: string };
      statusUrl: string;
    };

    expect(response.status).toBe(202);
    expect(payload.job.kind).toBe("briefing_create");
    expect(payload.job.status).toBe("queued");
    expect(payload.job.briefingType).toBe("startup");
    expect(payload.statusUrl).toBe(`/api/briefing/jobs/${payload.job.id}`);
  });

  it("uses the session principal when resolving queued briefing ownership", async () => {
    const repository = createRepository({
      storePath: process.env.AGENTIC_RUNTIME_STORE_PATH
    });
    const secondaryUserId = "user-secondary";

    await repository.seedDefaults(SYSTEM_USER_ID);
    await repository.seedDefaults(secondaryUserId);

    await repository.saveBriefingPreferences({
      ...(await repository.getBriefingPreferences(SYSTEM_USER_ID)),
      focus: "urgent"
    });
    await repository.saveBriefingPreferences({
      ...(await repository.getBriefingPreferences(secondaryUserId)),
      focus: "deep",
      timezone: "Europe/London"
    });
    Reflect.set(globalThis, "__agenticRepository", undefined);

    const requireApiSessionSpy = vi.spyOn(authModule, "requireApiSession").mockResolvedValue({
      authMethod: "session",
      userId: secondaryUserId,
      sessionId: "session-secondary",
      expiresAt: "2026-12-31T00:00:00.000Z"
    });

    try {
      const response = await briefingRoute(
        new Request("http://localhost/api/briefing", {
          method: "POST",
          headers: {
            "content-type": "application/json"
          },
          body: JSON.stringify({ type: "midday" })
        })
      );
      const payload = (await response.json()) as {
        job: { id: string; kind: string; goalId: string; briefingType: string };
      };

      expect(response.status).toBe(202);
      expect(payload.job.kind).toBe("briefing_create");
      expect(payload.job.briefingType).toBe("midday");

      await processQueuedBriefingJobs();

      const reloadedRepository = createRepository({
        storePath: process.env.AGENTIC_RUNTIME_STORE_PATH
      });
      const persistedBundle = await reloadedRepository.getGoalBundleForUser(payload.job.goalId, secondaryUserId);

      expect(persistedBundle?.goal.userId).toBe(secondaryUserId);
      expect(persistedBundle?.goal.intent).toBe("briefing:midday");
      expect(persistedBundle?.goal.explanation).toContain("deep");
      expect(persistedBundle?.goal.explanation).not.toContain("urgent");
    } finally {
      requireApiSessionSpy.mockRestore();
    }
  });

  it("rejects non-json bodies when a request payload is supplied", async () => {
    const response = await briefingRoute(
      new Request("http://localhost/api/briefing", {
        method: "POST",
        headers: {
          "content-type": "text/plain",
          [AGENTIC_ACCESS_KEY_HEADER]: "test-access-key"
        },
        body: "midday"
      })
    );
    const payload = (await response.json()) as { error?: string };

    expect(response.status).toBe(415);
    expect(payload.error?.toLowerCase()).toContain("content-type");
  });

  it("rejects malformed briefing idempotency keys", async () => {
    const response = await briefingRoute(
      new Request("http://localhost/api/briefing", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          [AGENTIC_ACCESS_KEY_HEADER]: "test-access-key",
          "x-idempotency-key": "bad key"
        },
        body: JSON.stringify({ type: "midday" })
      })
    );
    const payload = (await response.json()) as { error?: string };

    expect(response.status).toBe(400);
    expect(payload.error).toContain("x-idempotency-key");
  });
});
