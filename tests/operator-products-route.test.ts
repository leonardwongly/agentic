import { mkdtemp } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { SYSTEM_USER_ID, createSystemActorContext, nowIso } from "@agentic/contracts";
import { createRepository } from "@agentic/repository";
import { GET as operatorProductsRouteGet, POST as operatorProductsRoutePost } from "../apps/web/app/api/operator-products/route";
import { AGENTIC_ACCESS_KEY_HEADER } from "../apps/web/lib/auth";
import { expectNoStoreHeaders } from "./route-test-helpers";

describe("operator products route", () => {
  const originalAccessKey = process.env.AGENTIC_ACCESS_KEY;
  const originalRuntimeStorePath = process.env.AGENTIC_RUNTIME_STORE_PATH;

  function buildAuthorizedRequest(url: string, method: "GET" | "POST", body?: unknown) {
    return new Request(url, {
      method,
      headers: {
        ...(body ? { "content-type": "application/json" } : {}),
        [AGENTIC_ACCESS_KEY_HEADER]: "test-access-key"
      },
      body: body ? JSON.stringify(body) : undefined
    });
  }

  beforeEach(async () => {
    process.env.AGENTIC_ACCESS_KEY = "test-access-key";
    process.env.AGENTIC_RUNTIME_STORE_PATH = path.join(
      await mkdtemp(path.join(os.tmpdir(), "agentic-operator-products-route-")),
      "runtime-store.json"
    );
    Reflect.set(globalThis, "__agenticRepository", undefined);
  });

  afterEach(() => {
    process.env.AGENTIC_ACCESS_KEY = originalAccessKey;
    process.env.AGENTIC_RUNTIME_STORE_PATH = originalRuntimeStorePath;
    Reflect.set(globalThis, "__agenticRepository", undefined);
  });

  it("returns the seeded operator product catalog and default selection", async () => {
    const response = await operatorProductsRouteGet(buildAuthorizedRequest("http://localhost/api/operator-products", "GET"));
    const payload = (await response.json()) as {
      products: Array<{
        id: string;
        slug: string;
        recommendedTemplateIds: string[];
        recommendedIntegrations: Array<{ system: string }>;
      }>;
      selection: { operatorProductId: string } | null;
      agents: Array<{ id: string; name: string; allowedCapabilities: string[]; maxRiskClass: string }>;
      templates: Array<{ id: string; name: string }>;
    };
    const communicationsAgent = payload.agents.find((agent) => agent.name === "communications");
    const calendarAgent = payload.agents.find((agent) => agent.name === "calendar");
    const communicationsProduct = payload.products.find((product) => product.slug === "communications-operator");

    expect(response.status).toBe(200);
    expectNoStoreHeaders(response);
    expect(communicationsProduct).toBeDefined();
    expect(payload.selection).not.toBeNull();
    expect(payload.selection?.actorContext).toEqual(createSystemActorContext(SYSTEM_USER_ID));
    expect(payload.agents.some((agent) => agent.id === "agent-builtin-communications")).toBe(true);
    expect(communicationsProduct?.recommendedTemplateIds).toContain("template-builtin-inbox-triage");
    expect(communicationsProduct?.recommendedIntegrations.map((integration) => integration.system)).toEqual(
      expect.arrayContaining(["local-notes", "gmail", "google-calendar"])
    );
    expect(payload.templates).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "template-builtin-inbox-triage",
          name: "Inbox triage and follow-up prep"
        })
      ])
    );
    expect(communicationsAgent).toMatchObject({
      allowedCapabilities: ["read", "search", "draft", "send"],
      maxRiskClass: "R3"
    });
    expect(calendarAgent).toMatchObject({
      allowedCapabilities: ["read", "search", "schedule", "update"],
      maxRiskClass: "R3"
    });
    expect(Array.isArray(payload.templates)).toBe(true);
  });

  it("updates the selected operator product for the authenticated user", async () => {
    const repository = createRepository({
      storePath: process.env.AGENTIC_RUNTIME_STORE_PATH
    });

    await repository.seedDefaults(SYSTEM_USER_ID);
    const [seededProduct] = await repository.listOperatorProducts(SYSTEM_USER_ID);

    await repository.saveOperatorProduct({
      ...seededProduct,
      id: "operator-product-custom",
      slug: "custom-operator",
      name: "Custom Operator",
      isBuiltIn: false,
      createdAt: nowIso(),
      updatedAt: nowIso()
    });

    Reflect.set(globalThis, "__agenticRepository", undefined);

    const response = await operatorProductsRoutePost(
      buildAuthorizedRequest("http://localhost/api/operator-products", "POST", {
        operatorProductId: "operator-product-custom"
      })
    );
    const payload = (await response.json()) as {
      selection: { operatorProductId: string; actorContext: unknown };
      products: Array<{ id: string }>;
    };
    const persistedSelection = await repository.getOperatorProductSelection(SYSTEM_USER_ID);

    expect(response.status).toBe(200);
    expectNoStoreHeaders(response);
    expect(payload.selection.operatorProductId).toBe("operator-product-custom");
    expect(payload.selection.actorContext).toEqual(createSystemActorContext(SYSTEM_USER_ID));
    expect(payload.products.some((product) => product.id === "operator-product-custom")).toBe(true);
    expect(persistedSelection?.actorContext).toEqual(createSystemActorContext(SYSTEM_USER_ID));
  });

  it("returns 404 when selecting another user's custom operator product", async () => {
    const repository = createRepository({
      storePath: process.env.AGENTIC_RUNTIME_STORE_PATH
    });
    const secondaryUserId = "user-secondary";

    await repository.seedDefaults(SYSTEM_USER_ID);
    await repository.seedDefaults(secondaryUserId);

    const [seededProduct] = await repository.listOperatorProducts(secondaryUserId);

    await repository.saveOperatorProduct({
      ...seededProduct,
      id: "operator-product-secondary",
      userId: secondaryUserId,
      slug: "secondary-operator",
      name: "Secondary Operator",
      isBuiltIn: false,
      createdAt: nowIso(),
      updatedAt: nowIso()
    });

    Reflect.set(globalThis, "__agenticRepository", undefined);

    const response = await operatorProductsRoutePost(
      buildAuthorizedRequest("http://localhost/api/operator-products", "POST", {
        operatorProductId: "operator-product-secondary"
      })
    );
    const payload = (await response.json()) as { error?: string };

    expect(response.status).toBe(404);
    expectNoStoreHeaders(response);
    expect(payload.error).toContain("operator-product-secondary");
  });
});
