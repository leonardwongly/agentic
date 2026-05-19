import { mkdtemp } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { GoalTemplateSchema, SYSTEM_USER_ID, createHumanActorContext, createSystemActorContext, nowIso } from "@agentic/contracts";
import { createSelfImprovementRepository } from "@agentic/self-improvement-memory";
import { runWorkerRuntime } from "@agentic/worker-runtime";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DELETE as deleteTemplateRoute, PATCH as updateTemplateRoute } from "../apps/web/app/api/templates/[id]/route";
import { GET as templateJobRoute } from "../apps/web/app/api/templates/jobs/[id]/route";
import { POST as runTemplateRoute } from "../apps/web/app/api/templates/[id]/run/route";
import { GET as listTemplatesRoute, POST as createTemplateRoute } from "../apps/web/app/api/templates/route";
import * as authModule from "../apps/web/lib/auth";
import { AGENTIC_ACCESS_KEY_HEADER } from "../apps/web/lib/auth";
import {
  resetAuthSessionStateStoreForTesting,
  setAuthSessionStateStoreForTesting,
  type AuthSessionStateStore
} from "../apps/web/lib/auth-session-store";
import { resetSessionUnlockRateLimit } from "../apps/web/lib/session-unlock-rate-limit";
import { createRouteTestRepository, expectNoStoreHeaders } from "./route-test-helpers";

function buildAuthorizedGetRequest(url: string): Request {
  return new Request(url, {
    method: "GET",
    headers: {
      [AGENTIC_ACCESS_KEY_HEADER]: "test-access-key"
    }
  });
}

function buildAuthorizedJsonRequest(
  url: string,
  method: "POST" | "PATCH",
  body?: unknown,
  options?: { ifMatch?: string | null }
): Request {
  return new Request(url, {
    method,
    headers: {
      "content-type": "application/json",
      [AGENTIC_ACCESS_KEY_HEADER]: "test-access-key",
      ...(options?.ifMatch ? { "if-match": `"${options.ifMatch}"` } : {})
    },
    body: body === undefined ? undefined : JSON.stringify(body)
  });
}

function buildAuthorizedDeleteRequest(url: string, options?: { ifMatch?: string | null }): Request {
  return new Request(url, {
    method: "DELETE",
    headers: {
      [AGENTIC_ACCESS_KEY_HEADER]: "test-access-key",
      ...(options?.ifMatch ? { "if-match": `"${options.ifMatch}"` } : {})
    }
  });
}

describe("templates routes", () => {
  const originalAccessKey = process.env.AGENTIC_ACCESS_KEY;
  const originalRuntimeStorePath = process.env.AGENTIC_RUNTIME_STORE_PATH;

  async function processQueuedTemplateJobs(maxJobs = 1) {
    const repository = createRouteTestRepository();
    const selfImprovementRepository = createSelfImprovementRepository({
      baseDir: await mkdtemp(path.join(os.tmpdir(), "agentic-template-route-memory-"))
    });

    await Promise.all([
      repository.seedDefaults(SYSTEM_USER_ID),
      selfImprovementRepository.seed()
    ]);

    return runWorkerRuntime({
      repository,
      selfImprovementRepository,
      runnerId: "worker-template-route-test",
      maxJobs,
      pollIntervalMs: 50
    });
  }

  beforeEach(async () => {
    process.env.AGENTIC_ACCESS_KEY = "test-access-key";
    process.env.AGENTIC_RUNTIME_STORE_PATH = path.join(
      await mkdtemp(path.join(os.tmpdir(), "agentic-template-routes-")),
      "runtime-store.json"
    );
    Reflect.set(globalThis, "__agenticRepository", undefined);
    Reflect.set(globalThis, "__agenticSelfImprovementRepository", undefined);
  });

  afterEach(async () => {
    process.env.AGENTIC_ACCESS_KEY = originalAccessKey;
    process.env.AGENTIC_RUNTIME_STORE_PATH = originalRuntimeStorePath;
    Reflect.set(globalThis, "__agenticRepository", undefined);
    Reflect.set(globalThis, "__agenticSelfImprovementRepository", undefined);
    await resetSessionUnlockRateLimit();
    resetAuthSessionStateStoreForTesting();
  });

  it("stamps the system actor when creating and running a template with the access key", async () => {
    const createResponse = await createTemplateRoute(
      buildAuthorizedJsonRequest("http://localhost/api/templates", "POST", {
        name: "Daily inbox review",
        description: "Review fresh inbox signals before noon.",
        request: "Review my inbox and prepare the next response plan.",
        schedule: {
          enabled: true,
          cron: "0 9 * * *",
          timezone: "UTC"
        }
      })
    );
    const createPayload = (await createResponse.json()) as {
      template: { id: string; actorContext: unknown };
    };

    expect(createResponse.status).toBe(200);
    expect(createPayload.template.actorContext).toEqual(createSystemActorContext(SYSTEM_USER_ID));
    expectNoStoreHeaders(createResponse);

    const runResponse = await runTemplateRoute(
      buildAuthorizedJsonRequest(`http://localhost/api/templates/${createPayload.template.id}/run`, "POST"),
      { params: Promise.resolve({ id: createPayload.template.id }) }
    );
    const runPayload = (await runResponse.json()) as {
      job: { id: string; kind: string; status: string; templateId: string; goalId: string };
      statusUrl: string;
    };

    expect(runResponse.status).toBe(202);
    expect(runPayload.job.kind).toBe("template_run");
    expect(runPayload.job.status).toBe("queued");
    expect(runPayload.job.templateId).toBe(createPayload.template.id);
    expect(runPayload.statusUrl).toBe(`/api/templates/jobs/${runPayload.job.id}`);

    const queuedStatusResponse = await templateJobRoute(
      buildAuthorizedGetRequest(`http://localhost${runPayload.statusUrl}`),
      { params: Promise.resolve({ id: runPayload.job.id }) }
    );
    const queuedStatusPayload = (await queuedStatusResponse.json()) as {
      job: { id: string; status: string; templateId: string; goalId: string };
      result: null;
      error: null;
    };

    expect(queuedStatusResponse.status).toBe(202);
    expect(queuedStatusPayload.job.id).toBe(runPayload.job.id);
    expect(queuedStatusPayload.job.status).toBe("queued");
    expect(queuedStatusPayload.job.templateId).toBe(createPayload.template.id);
    expect(queuedStatusPayload.result).toBeNull();
    expect(queuedStatusPayload.error).toBeNull();

    const workerResult = await processQueuedTemplateJobs();
    const completedStatusResponse = await templateJobRoute(
      buildAuthorizedGetRequest(`http://localhost${runPayload.statusUrl}`),
      { params: Promise.resolve({ id: runPayload.job.id }) }
    );
    const completedStatusPayload = (await completedStatusResponse.json()) as {
      job: { id: string; status: string; templateId: string; goalId: string };
      result: { goalId: string; taskCount: number; completedTaskCount: number };
      error: null;
    };

    expect(workerResult).toEqual({
      processedCount: 1,
      stopReason: "max_jobs"
    });
    expect(completedStatusResponse.status).toBe(200);
    expect(completedStatusPayload.job.id).toBe(runPayload.job.id);
    expect(completedStatusPayload.job.status).toBe("completed");
    expect(completedStatusPayload.job.templateId).toBe(createPayload.template.id);
    expect(completedStatusPayload.result.goalId).toBe(runPayload.job.goalId);
    expect(completedStatusPayload.result.taskCount).toBeGreaterThan(0);
    expect(completedStatusPayload.result.completedTaskCount).toBe(0);
    expect(completedStatusPayload.error).toBeNull();

    const persistedListResponse = await listTemplatesRoute(buildAuthorizedGetRequest("http://localhost/api/templates"));
    const persistedListPayload = (await persistedListResponse.json()) as {
      templates: Array<{ id: string; actorContext: unknown; schedule: { lastRunAt: string | null } }>;
    };
    const persisted = persistedListPayload.templates.find((template) => template.id === createPayload.template.id);

    expect(persisted?.actorContext).toEqual(createSystemActorContext(SYSTEM_USER_ID));
    expect(persisted?.schedule.lastRunAt).toBeTruthy();
  });

  it("deduplicates retried template runs when the same idempotency key is reused", async () => {
    const createResponse = await createTemplateRoute(
      buildAuthorizedJsonRequest("http://localhost/api/templates", "POST", {
        name: "Retry-safe template",
        description: "Exercise template-run idempotency.",
        request: "Review the inbox and produce a durable plan."
      })
    );
    const createPayload = (await createResponse.json()) as {
      template: { id: string };
    };
    const buildRunRequest = () =>
      new Request(`http://localhost/api/templates/${createPayload.template.id}/run`, {
        method: "POST",
        headers: {
          [AGENTIC_ACCESS_KEY_HEADER]: "test-access-key",
          "x-idempotency-key": "template-run-retry-1"
        }
      });

    const firstResponse = await runTemplateRoute(buildRunRequest(), {
      params: Promise.resolve({ id: createPayload.template.id })
    });
    const secondResponse = await runTemplateRoute(buildRunRequest(), {
      params: Promise.resolve({ id: createPayload.template.id })
    });
    const firstPayload = (await firstResponse.json()) as {
      job: { id: string; templateId: string; goalId: string };
      statusUrl: string;
    };
    const secondPayload = (await secondResponse.json()) as {
      job: { id: string; templateId: string; goalId: string };
      statusUrl: string;
    };
    const repository = createRouteTestRepository();

    expect(firstResponse.status).toBe(202);
    expect(secondResponse.status).toBe(202);
    expect(secondPayload.job.id).toBe(firstPayload.job.id);
    expect(secondPayload.job.goalId).toBe(firstPayload.job.goalId);
    expect(secondPayload.job.templateId).toBe(firstPayload.job.templateId);
    expect(secondPayload.statusUrl).toBe(firstPayload.statusUrl);
    expect(await repository.listJobs({ userId: SYSTEM_USER_ID })).toHaveLength(1);
  });

  it("derives deterministic idempotency keys for duplicate template runs without a client key", async () => {
    const createResponse = await createTemplateRoute(
      buildAuthorizedJsonRequest("http://localhost/api/templates", "POST", {
        name: "Derived retry-safe template",
        description: "Exercise derived template-run idempotency.",
        request: "Review the inbox and produce a durable plan."
      })
    );
    const createPayload = (await createResponse.json()) as {
      template: { id: string };
    };
    const buildRunRequest = () =>
      new Request(`http://localhost/api/templates/${createPayload.template.id}/run`, {
        method: "POST",
        headers: {
          [AGENTIC_ACCESS_KEY_HEADER]: "test-access-key"
        }
      });

    const firstResponse = await runTemplateRoute(buildRunRequest(), {
      params: Promise.resolve({ id: createPayload.template.id })
    });
    const secondResponse = await runTemplateRoute(buildRunRequest(), {
      params: Promise.resolve({ id: createPayload.template.id })
    });
    const firstPayload = (await firstResponse.json()) as {
      job: { id: string; templateId: string; goalId: string };
      statusUrl: string;
    };
    const secondPayload = (await secondResponse.json()) as {
      job: { id: string; templateId: string; goalId: string };
      statusUrl: string;
    };
    const repository = createRouteTestRepository();
    const jobs = await repository.listJobs({ userId: SYSTEM_USER_ID });

    expect(firstResponse.status).toBe(202);
    expect(secondResponse.status).toBe(202);
    expect(secondPayload.job.id).toBe(firstPayload.job.id);
    expect(secondPayload.job.goalId).toBe(firstPayload.job.goalId);
    expect(secondPayload.job.templateId).toBe(firstPayload.job.templateId);
    expect(secondPayload.statusUrl).toBe(firstPayload.statusUrl);
    expect(jobs).toHaveLength(1);
    expect(jobs[0]?.idempotencyKey).toMatch(/^template-run:/);
  });

  it("allows manual template runs while a scheduled due window is still future-dated", async () => {
    const repository = createRouteTestRepository();
    const futureDueAt = new Date(Date.now() + 60 * 60_000).toISOString();

    await repository.seedDefaults(SYSTEM_USER_ID);
    await repository.saveTemplate(
      GoalTemplateSchema.parse({
        id: "template-manual-run-before-schedule",
        userId: SYSTEM_USER_ID,
        name: "Manual review before schedule",
        description: "Keep manual execution separate from scheduled autopilot due checks.",
        request: "Review the inbox now even though the scheduled run is later.",
        parameters: {},
        schedule: {
          enabled: true,
          cron: "0 9 * * *",
          timezone: "UTC",
          lastRunAt: null,
          nextRunAt: futureDueAt
        },
        actorContext: null,
        createdAt: nowIso(),
        updatedAt: nowIso()
      })
    );
    Reflect.set(globalThis, "__agenticRepository", undefined);

    const response = await runTemplateRoute(
      buildAuthorizedJsonRequest("http://localhost/api/templates/template-manual-run-before-schedule/run", "POST"),
      { params: Promise.resolve({ id: "template-manual-run-before-schedule" }) }
    );
    const payload = (await response.json()) as {
      job: { kind: string; templateId: string; status: string };
      statusUrl: string;
    };
    const jobs = await repository.listJobs({ userId: SYSTEM_USER_ID });

    expect(response.status).toBe(202);
    expect(payload.job).toMatchObject({
      kind: "template_run",
      templateId: "template-manual-run-before-schedule",
      status: "queued"
    });
    expect(payload.statusUrl).toContain("/api/templates/jobs/");
    expect(jobs).toHaveLength(1);
    expect(jobs[0]?.kind).toBe("template_run");
    await expect(repository.listAutopilotEvents(SYSTEM_USER_ID)).resolves.toHaveLength(0);
  });

  it("rate limits template runs with a route-scoped abuse key", async () => {
    const createResponse = await createTemplateRoute(
      buildAuthorizedJsonRequest("http://localhost/api/templates", "POST", {
        name: "Template rate limit",
        description: "Exercise abuse protection on template execution.",
        request: "Review the inbox and produce a durable execution plan."
      })
    );
    const createPayload = (await createResponse.json()) as {
      template: { id: string };
    };
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

    const response = await runTemplateRoute(
      new Request(`http://localhost/api/templates/${createPayload.template.id}/run`, {
        method: "POST",
        headers: {
          [AGENTIC_ACCESS_KEY_HEADER]: "test-access-key",
          "user-agent": "Agentic Template Rate Limit Test",
          "accept-language": "en-SG"
        }
      }),
      { params: Promise.resolve({ id: createPayload.template.id }) }
    );
    const payload = (await response.json()) as { error?: string };

    expect(response.status).toBe(429);
    expect(payload.error).toBe("Too many template run requests. Try again later.");
    expect(response.headers.get("retry-after")).toBe("30");
    expect(seenKeys).toHaveLength(1);
    expect(seenKeys[0]).toContain("template-run:user:");
    expect(seenKeys[0]).toContain(`:fp:/api/templates/${createPayload.template.id}/run:`);
  });

  it("stamps the human actor when a session principal updates a template schedule", async () => {
    const repository = createRouteTestRepository();
    const secondaryUserId = "user-secondary";

    await repository.seedDefaults(secondaryUserId);
    const savedTemplate = GoalTemplateSchema.parse({
        id: "template-session-update",
        userId: secondaryUserId,
        name: "Session template",
        description: "Keep a private daily review template.",
        request: "Review my inbox and summarize urgent items.",
        parameters: {},
        schedule: {
          enabled: false,
          cron: "",
          timezone: "UTC",
          lastRunAt: null,
          nextRunAt: null
        },
        actorContext: null,
        createdAt: nowIso(),
        updatedAt: nowIso()
      });
    await repository.saveTemplate(savedTemplate);
    Reflect.set(globalThis, "__agenticRepository", undefined);

    const requireApiSessionSpy = vi.spyOn(authModule, "requireApiSession").mockResolvedValue({
      authMethod: "session",
      userId: secondaryUserId,
      sessionId: "session-secondary",
      expiresAt: "2026-12-31T00:00:00.000Z"
    });

    let response: Response;
    let payload: { template: { actorContext: unknown } };
    try {
      response = await updateTemplateRoute(
        buildAuthorizedJsonRequest(
          "http://localhost/api/templates/template-session-update",
          "PATCH",
          {
            schedule: {
              enabled: true,
              cron: "0 11 * * *",
              timezone: "Asia/Singapore"
            }
          },
          { ifMatch: savedTemplate.updatedAt }
        ),
        { params: Promise.resolve({ id: "template-session-update" }) }
      );
      payload = (await response.json()) as { template: { actorContext: unknown } };
    } finally {
      requireApiSessionSpy.mockRestore();
    }

    const persisted = (await repository.listTemplates(secondaryUserId)).find(
      (template) => template.id === "template-session-update"
    );

    expect(response.status).toBe(200);
    expect(payload.template.actorContext).toEqual(createHumanActorContext(secondaryUserId, "session-secondary"));
    expect(persisted?.actorContext).toEqual(createHumanActorContext(secondaryUserId, "session-secondary"));
    expect(persisted?.schedule.nextRunAt).toBeTruthy();
  });

  it("rejects template schedule updates without an If-Match precondition", async () => {
    const repository = createRouteTestRepository();

    await repository.seedDefaults(SYSTEM_USER_ID);
    await repository.saveTemplate(
      GoalTemplateSchema.parse({
        id: "template-missing-precondition",
        userId: SYSTEM_USER_ID,
        name: "Missing precondition",
        description: "",
        request: "Review the inbox.",
        parameters: {},
        schedule: {
          enabled: false,
          cron: "",
          timezone: "UTC",
          lastRunAt: null,
          nextRunAt: null
        },
        actorContext: null,
        createdAt: nowIso(),
        updatedAt: nowIso()
      })
    );
    Reflect.set(globalThis, "__agenticRepository", undefined);

    const response = await updateTemplateRoute(
      buildAuthorizedJsonRequest("http://localhost/api/templates/template-missing-precondition", "PATCH", {
        schedule: {
          enabled: true,
          cron: "0 9 * * *",
          timezone: "UTC"
        }
      }),
      { params: Promise.resolve({ id: "template-missing-precondition" }) }
    );
    const payload = (await response.json()) as { error?: string };

    expect(response.status).toBe(428);
    expect(payload.error).toContain("If-Match");
  });

  it("rejects stale template schedule preconditions", async () => {
    const repository = createRouteTestRepository();

    await repository.seedDefaults(SYSTEM_USER_ID);
    await repository.saveTemplate(
      GoalTemplateSchema.parse({
        id: "template-stale-precondition",
        userId: SYSTEM_USER_ID,
        name: "Stale precondition",
        description: "",
        request: "Review the inbox.",
        parameters: {},
        schedule: {
          enabled: false,
          cron: "",
          timezone: "UTC",
          lastRunAt: null,
          nextRunAt: null
        },
        actorContext: null,
        createdAt: "2026-04-18T00:00:00.000Z",
        updatedAt: "2026-04-18T00:00:00.000Z"
      })
    );
    Reflect.set(globalThis, "__agenticRepository", undefined);

    const response = await updateTemplateRoute(
      buildAuthorizedJsonRequest(
        "http://localhost/api/templates/template-stale-precondition",
        "PATCH",
        {
          schedule: {
            enabled: true,
            cron: "0 9 * * *",
            timezone: "UTC"
          }
        },
        { ifMatch: "2026-01-01T00:00:00.000Z" }
      ),
      { params: Promise.resolve({ id: "template-stale-precondition" }) }
    );
    const payload = (await response.json()) as { error?: string };

    expect(response.status).toBe(412);
    expect(payload.error).toContain("changed before this action was applied");
  });

  it("requires an If-Match precondition when deleting templates", async () => {
    const repository = createRouteTestRepository();

    await repository.seedDefaults(SYSTEM_USER_ID);
    await repository.saveTemplate(
      GoalTemplateSchema.parse({
        id: "template-delete-precondition",
        userId: SYSTEM_USER_ID,
        name: "Delete precondition",
        description: "",
        request: "Review the inbox.",
        parameters: {},
        schedule: {
          enabled: false,
          cron: "",
          timezone: "UTC",
          lastRunAt: null,
          nextRunAt: null
        },
        actorContext: null,
        createdAt: nowIso(),
        updatedAt: nowIso()
      })
    );
    Reflect.set(globalThis, "__agenticRepository", undefined);

    const response = await deleteTemplateRoute(
      buildAuthorizedDeleteRequest("http://localhost/api/templates/template-delete-precondition"),
      { params: Promise.resolve({ id: "template-delete-precondition" }) }
    );
    const payload = (await response.json()) as { error?: string };

    expect(response.status).toBe(428);
    expect(payload.error).toContain("If-Match");
  });
});
