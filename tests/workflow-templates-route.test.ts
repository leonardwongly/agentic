import { mkdtemp } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { DEFAULT_OWNER_USER_ID, createHumanActorContext, createSystemActorContext } from "@agentic/contracts";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { vi } from "vitest";
import { DELETE, GET as getWorkflowTemplateRoute, PUT } from "../apps/web/app/api/workflow-templates/[id]/route";
import { GET as listWorkflowTemplatesRoute, POST as createWorkflowTemplateRoute } from "../apps/web/app/api/workflow-templates/route";
import * as authModule from "../apps/web/lib/auth";
import { resetSessionUnlockRateLimit } from "../apps/web/lib/session-unlock-rate-limit";
import { AGENTIC_ACCESS_KEY_HEADER } from "../apps/web/lib/auth";
import { expectNoStoreHeaders } from "./route-test-helpers";

function buildAuthorizedGetRequest(url: string): Request {
  return new Request(url, {
    method: "GET",
    headers: {
      [AGENTIC_ACCESS_KEY_HEADER]: "test-access-key"
    }
  });
}

function buildAuthorizedJsonRequest(url: string, method: "POST" | "PUT" | "DELETE", body?: unknown): Request {
  return new Request(url, {
    method,
    headers: {
      "content-type": "application/json",
      [AGENTIC_ACCESS_KEY_HEADER]: "test-access-key"
    },
    body: body === undefined ? undefined : JSON.stringify(body)
  });
}

function buildAuthorizedJsonRequestWithIfMatch(
  url: string,
  method: "PUT" | "DELETE",
  ifMatch: string,
  body?: unknown
): Request {
  return new Request(url, {
    method,
    headers: {
      "content-type": "application/json",
      "if-match": `"${ifMatch}"`,
      [AGENTIC_ACCESS_KEY_HEADER]: "test-access-key"
    },
    body: body === undefined ? undefined : JSON.stringify(body)
  });
}

describe("workflow templates routes", () => {
  const originalAccessKey = process.env.AGENTIC_ACCESS_KEY;
  const originalRuntimeStorePath = process.env.AGENTIC_RUNTIME_STORE_PATH;

  beforeEach(async () => {
    process.env.AGENTIC_ACCESS_KEY = "test-access-key";
    process.env.AGENTIC_RUNTIME_STORE_PATH = path.join(
      await mkdtemp(path.join(os.tmpdir(), "agentic-workflow-template-routes-")),
      "runtime-store.json"
    );
    Reflect.set(globalThis, "__agenticRepository", undefined);
  });

  afterEach(async () => {
    process.env.AGENTIC_ACCESS_KEY = originalAccessKey;
    process.env.AGENTIC_RUNTIME_STORE_PATH = originalRuntimeStorePath;
    Reflect.set(globalThis, "__agenticRepository", undefined);
    await resetSessionUnlockRateLimit();
  });

  it("persists workflow templates across repository reloads and supports CRUD", async () => {
    const createResponse = await createWorkflowTemplateRoute(
      buildAuthorizedJsonRequest("http://localhost/api/workflow-templates", "POST", {
        name: "Daily triage",
        description: "Review all fresh signals before noon.",
        nodes: [
          {
            id: "trigger-1",
            type: "trigger",
            label: "Manual start",
            icon: "play",
            position: { x: 0, y: 0 },
            config: {}
          }
        ],
        edges: [],
        triggers: [
          {
            type: "manual",
            config: {}
          }
        ]
      })
    );
    const createdPayload = (await createResponse.json()) as {
      template: { id: string; name: string; description: string; actorContext: unknown; updatedAt: string };
    };

    expect(createResponse.status).toBe(201);
    expect(createdPayload.template.name).toBe("Daily triage");
    expect(createdPayload.template.actorContext).toEqual(createSystemActorContext(DEFAULT_OWNER_USER_ID));
    expectNoStoreHeaders(createResponse);

    const listResponse = await listWorkflowTemplatesRoute(buildAuthorizedGetRequest("http://localhost/api/workflow-templates"));
    const listPayload = (await listResponse.json()) as {
      templates: Array<{ id: string; name: string }>;
    };

    expect(listPayload.templates).toHaveLength(1);
    expect(listPayload.templates[0]?.id).toBe(createdPayload.template.id);

    Reflect.set(globalThis, "__agenticRepository", undefined);

    const persistedListResponse = await listWorkflowTemplatesRoute(
      buildAuthorizedGetRequest("http://localhost/api/workflow-templates")
    );
    const persistedListPayload = (await persistedListResponse.json()) as {
      templates: Array<{ id: string; name: string }>;
    };

    expect(persistedListPayload.templates).toHaveLength(1);
    expect(persistedListPayload.templates[0]?.id).toBe(createdPayload.template.id);

    const itemResponse = await getWorkflowTemplateRoute(
      buildAuthorizedGetRequest(`http://localhost/api/workflow-templates/${createdPayload.template.id}`),
      { params: Promise.resolve({ id: createdPayload.template.id }) }
    );
    const itemPayload = (await itemResponse.json()) as {
      template: { id: string; description: string };
    };

    expect(itemPayload.template.id).toBe(createdPayload.template.id);
    expect(itemPayload.template.description).toBe("Review all fresh signals before noon.");

    const updateResponse = await PUT(
      buildAuthorizedJsonRequestWithIfMatch(
        `http://localhost/api/workflow-templates/${createdPayload.template.id}`,
        "PUT",
        createdPayload.template.updatedAt,
        {
          description: "Review only urgent and blocked signals before noon."
        }
      ),
      { params: Promise.resolve({ id: createdPayload.template.id }) }
    );
    const updatePayload = (await updateResponse.json()) as {
      template: { description: string; actorContext: unknown; updatedAt: string };
    };

    expect(updatePayload.template.description).toBe("Review only urgent and blocked signals before noon.");
    expect(updatePayload.template.actorContext).toEqual(createSystemActorContext(DEFAULT_OWNER_USER_ID));

    const deleteResponse = await DELETE(
      buildAuthorizedJsonRequestWithIfMatch(
        `http://localhost/api/workflow-templates/${createdPayload.template.id}`,
        "DELETE",
        updatePayload.template.updatedAt
      ),
      { params: Promise.resolve({ id: createdPayload.template.id }) }
    );
    expect(deleteResponse.status).toBe(200);

    const emptyListResponse = await listWorkflowTemplatesRoute(
      buildAuthorizedGetRequest("http://localhost/api/workflow-templates")
    );
    const emptyListPayload = (await emptyListResponse.json()) as {
      templates: Array<{ id: string }>;
    };

    expect(emptyListPayload.templates).toHaveLength(0);
  });

  it("rejects workflow template updates without an If-Match precondition", async () => {
    const createResponse = await createWorkflowTemplateRoute(
      buildAuthorizedJsonRequest("http://localhost/api/workflow-templates", "POST", {
        name: "Guarded triage",
        nodes: [],
        edges: [],
        triggers: [{ type: "manual", config: {} }]
      })
    );
    const createdPayload = (await createResponse.json()) as {
      template: { id: string };
    };

    const updateResponse = await PUT(
      buildAuthorizedJsonRequest(`http://localhost/api/workflow-templates/${createdPayload.template.id}`, "PUT", {
        description: "Attempt without precondition."
      }),
      { params: Promise.resolve({ id: createdPayload.template.id }) }
    );
    const payload = (await updateResponse.json()) as { error?: string };

    expect(updateResponse.status).toBe(428);
    expect(payload.error).toContain("If-Match");
    expectNoStoreHeaders(updateResponse);
  });

  it("rejects stale workflow template update and delete preconditions", async () => {
    const createResponse = await createWorkflowTemplateRoute(
      buildAuthorizedJsonRequest("http://localhost/api/workflow-templates", "POST", {
        name: "Stale guarded triage",
        nodes: [],
        edges: [],
        triggers: [{ type: "manual", config: {} }]
      })
    );
    const createdPayload = (await createResponse.json()) as {
      template: { id: string; updatedAt: string };
    };

    const updateResponse = await PUT(
      buildAuthorizedJsonRequestWithIfMatch(
        `http://localhost/api/workflow-templates/${createdPayload.template.id}`,
        "PUT",
        "2026-01-01T00:00:00.000Z",
        { description: "Attempt with stale precondition." }
      ),
      { params: Promise.resolve({ id: createdPayload.template.id }) }
    );
    const updatePayload = (await updateResponse.json()) as { error?: string };

    expect(updateResponse.status).toBe(412);
    expect(updatePayload.error).toContain("changed before this action");
    expectNoStoreHeaders(updateResponse);

    const deleteResponse = await DELETE(
      buildAuthorizedJsonRequestWithIfMatch(
        `http://localhost/api/workflow-templates/${createdPayload.template.id}`,
        "DELETE",
        "2026-01-01T00:00:00.000Z"
      ),
      { params: Promise.resolve({ id: createdPayload.template.id }) }
    );
    const deletePayload = (await deleteResponse.json()) as { error?: string };

    expect(deleteResponse.status).toBe(412);
    expect(deletePayload.error).toContain("changed before this action");
    expectNoStoreHeaders(deleteResponse);
  });

  it("returns 404 for missing workflow templates", async () => {
    const response = await getWorkflowTemplateRoute(
      buildAuthorizedGetRequest("http://localhost/api/workflow-templates/missing-template"),
      { params: Promise.resolve({ id: "missing-template" }) }
    );
    const payload = (await response.json()) as { error?: string };

    expect(response.status).toBe(404);
    expect(payload.error).toContain("not found");
    expectNoStoreHeaders(response);
  });

  it("stamps the human actor when a session principal creates a workflow template", async () => {
    const secondaryUserId = "user-secondary";
    const requireApiSessionSpy = vi.spyOn(authModule, "requireApiSession").mockResolvedValue({
      authMethod: "session",
      userId: secondaryUserId,
      sessionId: "session-secondary",
      expiresAt: "2026-12-31T00:00:00.000Z"
    });

    let response: Response;
    let payload: { template: { actorContext: unknown } };
    try {
      response = await createWorkflowTemplateRoute(
        new Request("http://localhost/api/workflow-templates", {
          method: "POST",
          headers: {
            "content-type": "application/json"
          },
          body: JSON.stringify({
            name: "Private daily triage",
            description: "Review only my own urgent signals.",
            nodes: [
              {
                id: "trigger-1",
                type: "trigger",
                label: "Manual start",
                icon: "play",
                position: { x: 0, y: 0 },
                config: {}
              }
            ],
            edges: [],
            triggers: [
              {
                type: "manual",
                config: {}
              }
            ]
          })
        })
      );
      payload = (await response.json()) as { template: { actorContext: unknown } };
    } finally {
      requireApiSessionSpy.mockRestore();
    }

    expect(response.status).toBe(201);
    expect(payload.template.actorContext).toEqual(createHumanActorContext(secondaryUserId, "session-secondary"));
  });
});
