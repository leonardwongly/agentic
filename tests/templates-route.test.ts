import { mkdtemp } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { GoalTemplateSchema, SYSTEM_USER_ID, createHumanActorContext, createSystemActorContext, nowIso } from "@agentic/contracts";
import { createRepository } from "@agentic/repository";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DELETE as deleteTemplateRoute, PATCH as updateTemplateRoute } from "../apps/web/app/api/templates/[id]/route";
import { POST as runTemplateRoute } from "../apps/web/app/api/templates/[id]/run/route";
import { GET as listTemplatesRoute, POST as createTemplateRoute } from "../apps/web/app/api/templates/route";
import * as authModule from "../apps/web/lib/auth";
import { AGENTIC_ACCESS_KEY_HEADER } from "../apps/web/lib/auth";
import { resetSessionUnlockRateLimit } from "../apps/web/lib/session-unlock-rate-limit";
import { expectNoStoreHeaders } from "./route-test-helpers";

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
      bundle: { goal: { id: string } };
    };

    expect(runResponse.status).toBe(200);
    expect(runPayload.bundle.goal.id).toBeTruthy();

    const persistedListResponse = await listTemplatesRoute(buildAuthorizedGetRequest("http://localhost/api/templates"));
    const persistedListPayload = (await persistedListResponse.json()) as {
      templates: Array<{ id: string; actorContext: unknown; schedule: { lastRunAt: string | null } }>;
    };
    const persisted = persistedListPayload.templates.find((template) => template.id === createPayload.template.id);

    expect(persisted?.actorContext).toEqual(createSystemActorContext(SYSTEM_USER_ID));
    expect(persisted?.schedule.lastRunAt).toBeTruthy();
  });

  it("stamps the human actor when a session principal updates a template schedule", async () => {
    const repository = createRepository({
      storePath: process.env.AGENTIC_RUNTIME_STORE_PATH
    });
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
    const repository = createRepository({
      storePath: process.env.AGENTIC_RUNTIME_STORE_PATH
    });

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
    const repository = createRepository({
      storePath: process.env.AGENTIC_RUNTIME_STORE_PATH
    });

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
    const repository = createRepository({
      storePath: process.env.AGENTIC_RUNTIME_STORE_PATH
    });

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
