import { mkdtemp } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { DELETE, GET as getWorkflowTemplateRoute, PUT } from "../apps/web/app/api/workflow-templates/[id]/route";
import { GET as listWorkflowTemplatesRoute, POST as createWorkflowTemplateRoute } from "../apps/web/app/api/workflow-templates/route";
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
      template: { id: string; name: string; description: string };
    };

    expect(createResponse.status).toBe(201);
    expect(createdPayload.template.name).toBe("Daily triage");
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
      buildAuthorizedJsonRequest(`http://localhost/api/workflow-templates/${createdPayload.template.id}`, "PUT", {
        description: "Review only urgent and blocked signals before noon."
      }),
      { params: Promise.resolve({ id: createdPayload.template.id }) }
    );
    const updatePayload = (await updateResponse.json()) as {
      template: { description: string };
    };

    expect(updatePayload.template.description).toBe("Review only urgent and blocked signals before noon.");

    const deleteResponse = await DELETE(
      buildAuthorizedJsonRequest(`http://localhost/api/workflow-templates/${createdPayload.template.id}`, "DELETE"),
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
});
