import { mkdtemp } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  AgentDefinitionSchema,
  SYSTEM_USER_ID,
  createHumanActorContext,
  createSystemActorContext,
  nowIso
} from "@agentic/contracts";
import { createRepository } from "@agentic/repository";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { POST as cloneAgentRoute } from "../apps/web/app/api/agents/[id]/clone/route";
import { GET as exportAgentRoute } from "../apps/web/app/api/agents/[id]/export/route";
import { GET as getAgentRoute, PUT as updateAgentRoute } from "../apps/web/app/api/agents/[id]/route";
import { POST as importAgentRoute } from "../apps/web/app/api/agents/import/route";
import { POST as createAgentRoute } from "../apps/web/app/api/agents/route";
import * as authModule from "../apps/web/lib/auth";
import { AGENTIC_ACCESS_KEY_HEADER } from "../apps/web/lib/auth";
import { resetSessionUnlockRateLimit } from "../apps/web/lib/session-unlock-rate-limit";
import { expectNoStoreHeaders } from "./route-test-helpers";

function buildAuthorizedJsonRequest(url: string, method: "POST" | "PATCH", body?: unknown): Request {
  return new Request(url, {
    method,
    headers: {
      "content-type": "application/json",
      [AGENTIC_ACCESS_KEY_HEADER]: "test-access-key"
    },
    body: body === undefined ? undefined : JSON.stringify(body)
  });
}

function buildAuthorizedGetRequest(url: string): Request {
  return new Request(url, {
    method: "GET",
    headers: {
      [AGENTIC_ACCESS_KEY_HEADER]: "test-access-key"
    }
  });
}

function buildCustomAgent(userId: string, id: string, name: string) {
  const timestamp = nowIso();
  return AgentDefinitionSchema.parse({
    id,
    userId,
    name,
    displayName: "Private Ops Agent",
    description: "Handles private operational workflows.",
    icon: "🧪",
    category: "custom",
    tags: ["ops"],
    systemPrompt: "Review operational signals and prepare structured next steps.",
    promptVariables: [],
    artifactType: "summary",
    behaviorConfig: {
      temperature: 0.4,
      maxTokens: 1200,
      topP: 1,
      frequencyPenalty: 0,
      presencePenalty: 0,
      responseStyle: "balanced",
      formality: "professional"
    },
    allowedCapabilities: ["read", "search"],
    blockedCapabilities: [],
    maxRiskClass: "R2",
    integrationPermissions: [],
    memoryPermissions: [],
    actorContext: null,
    isBuiltIn: false,
    parentAgentId: null,
    version: 1,
    status: "active",
    createdAt: timestamp,
    updatedAt: timestamp
  });
}

describe("agents routes", () => {
  const originalAccessKey = process.env.AGENTIC_ACCESS_KEY;
  const originalRuntimeStorePath = process.env.AGENTIC_RUNTIME_STORE_PATH;

  beforeEach(async () => {
    process.env.AGENTIC_ACCESS_KEY = "test-access-key";
    process.env.AGENTIC_RUNTIME_STORE_PATH = path.join(
      await mkdtemp(path.join(os.tmpdir(), "agentic-agents-route-")),
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

  it("stamps the system actor when creating a custom agent with the access key", async () => {
    const response = await createAgentRoute(
      buildAuthorizedJsonRequest("http://localhost/api/agents", "POST", {
        name: "ops-assistant",
        displayName: "Ops Assistant",
        description: "Coordinate operational follow-ups.",
        systemPrompt: "Summarize operational signals and prepare the next action plan."
      })
    );
    const payload = (await response.json()) as {
      agent: { id: string; actorContext: unknown };
    };

    const repository = createRepository({
      storePath: process.env.AGENTIC_RUNTIME_STORE_PATH
    });
    const persisted = await repository.getAgent(payload.agent.id, SYSTEM_USER_ID);

    expect(response.status).toBe(200);
    expectNoStoreHeaders(response);
    expect(payload.agent.actorContext).toEqual(createSystemActorContext(SYSTEM_USER_ID));
    expect(persisted?.actorContext).toEqual(createSystemActorContext(SYSTEM_USER_ID));
  });

  it("stamps the human actor when a session principal updates a custom agent", async () => {
    const repository = createRepository({
      storePath: process.env.AGENTIC_RUNTIME_STORE_PATH
    });
    const secondaryUserId = "user-secondary";

    await repository.seedDefaults(secondaryUserId);
    await repository.saveAgent(buildCustomAgent(secondaryUserId, "agent-session-update", "session-update"));
    Reflect.set(globalThis, "__agenticRepository", undefined);

    const requireApiSessionSpy = vi.spyOn(authModule, "requireApiSession").mockResolvedValue({
      authMethod: "session",
      userId: secondaryUserId,
      sessionId: "session-secondary",
      expiresAt: "2026-12-31T00:00:00.000Z"
    });

    let response: Response;
    let payload: { agent: { actorContext: unknown; version: number } };
    try {
      response = await updateAgentRoute(
        new Request("http://localhost/api/agents/agent-session-update", {
          method: "PUT",
          headers: {
            "content-type": "application/json"
          },
          body: JSON.stringify({
            displayName: "Session Updated Agent",
            description: "Updated privately through a session."
          })
        }),
        { params: Promise.resolve({ id: "agent-session-update" }) }
      );
      payload = (await response.json()) as { agent: { actorContext: unknown; version: number } };
    } finally {
      requireApiSessionSpy.mockRestore();
    }

    const persisted = await repository.getAgent("agent-session-update", secondaryUserId);

    expect(response.status).toBe(200);
    expect(payload.agent.actorContext).toEqual(createHumanActorContext(secondaryUserId, "session-secondary"));
    expect(payload.agent.version).toBe(2);
    expect(persisted?.actorContext).toEqual(createHumanActorContext(secondaryUserId, "session-secondary"));
    expect(persisted?.displayName).toBe("Session Updated Agent");
  });

  it("rejects non-operational integration and memory permission updates", async () => {
    const repository = createRepository({
      storePath: process.env.AGENTIC_RUNTIME_STORE_PATH
    });

    await repository.seedDefaults(SYSTEM_USER_ID);
    await repository.saveAgent(buildCustomAgent(SYSTEM_USER_ID, "agent-permission-update", "permission-update"));
    Reflect.set(globalThis, "__agenticRepository", undefined);

    const response = await updateAgentRoute(
      new Request("http://localhost/api/agents/agent-permission-update", {
        method: "PUT",
        headers: {
          "content-type": "application/json",
          [AGENTIC_ACCESS_KEY_HEADER]: "test-access-key"
        },
        body: JSON.stringify({
          integrationPermissions: [
            {
              integrationId: "gmail",
              permission: "full",
              allowedScopes: ["mail.send"]
            }
          ],
          memoryPermissions: [
            {
              category: "operator-notes",
              canRead: true,
              canWrite: true
            }
          ]
        })
      }),
      { params: Promise.resolve({ id: "agent-permission-update" }) }
    );
    const payload = (await response.json()) as { error?: string };
    const persisted = await repository.getAgent("agent-permission-update", SYSTEM_USER_ID);

    expect(response.status).toBe(400);
    expect(payload.error).toMatch(/unrecognized key/i);
    expect(persisted?.integrationPermissions).toEqual([]);
    expect(persisted?.memoryPermissions).toEqual([]);
  });

  it("stamps the human actor when a session principal clones a built-in agent", async () => {
    const repository = createRepository({
      storePath: process.env.AGENTIC_RUNTIME_STORE_PATH
    });
    const secondaryUserId = "user-secondary";

    await repository.seedDefaults(secondaryUserId);
    Reflect.set(globalThis, "__agenticRepository", undefined);

    const requireApiSessionSpy = vi.spyOn(authModule, "requireApiSession").mockResolvedValue({
      authMethod: "session",
      userId: secondaryUserId,
      sessionId: "session-secondary",
      expiresAt: "2026-12-31T00:00:00.000Z"
    });

    let response: Response;
    let payload: { agent: { id: string; actorContext: unknown; parentAgentId: string | null } };
    try {
      response = await cloneAgentRoute(
        new Request("http://localhost/api/agents/communications/clone", {
          method: "POST",
          headers: {
            "content-type": "application/json"
          },
          body: JSON.stringify({
            name: "communications-private",
            displayName: "Communications Private"
          })
        }),
        { params: Promise.resolve({ id: "communications" }) }
      );
      payload = (await response.json()) as {
        agent: { id: string; actorContext: unknown; parentAgentId: string | null };
      };
    } finally {
      requireApiSessionSpy.mockRestore();
    }

    const persisted = await repository.getAgent(payload.agent.id, secondaryUserId);

    expect(response.status).toBe(200);
    expect(payload.agent.actorContext).toEqual(createHumanActorContext(secondaryUserId, "session-secondary"));
    expect(payload.agent.parentAgentId).toBe("agent-builtin-communications");
    expect(persisted?.actorContext).toEqual(createHumanActorContext(secondaryUserId, "session-secondary"));
  });

  it("stamps the system actor when importing an agent definition", async () => {
    const response = await importAgentRoute(
      buildAuthorizedJsonRequest("http://localhost/api/agents/import", "POST", {
        exportData: {
          version: 1,
          exportedAt: nowIso(),
          agent: {
            id: "marketplace-agent-1",
            name: "marketplace-ops",
            displayName: "Marketplace Ops",
            description: "Imported from a shared catalog.",
            icon: "📦",
            category: "custom",
            tags: ["marketplace"],
            systemPrompt: "Analyze operator signals and produce a concise operating brief.",
            promptVariables: [],
            artifactType: "summary",
            behaviorConfig: {
              temperature: 0.3,
              maxTokens: 900,
              topP: 1,
              frequencyPenalty: 0,
              presencePenalty: 0,
              responseStyle: "balanced",
              formality: "professional"
            },
            allowedCapabilities: ["read", "search"],
            blockedCapabilities: [],
            maxRiskClass: "R2",
            integrationPermissions: [
              {
                integrationId: "gmail",
                permission: "full",
                allowedScopes: ["mail.send"]
              }
            ],
            memoryPermissions: [
              {
                category: "operator-notes",
                canRead: true,
                canWrite: true
              }
            ],
            parentAgentId: null,
            version: 3,
            status: "active"
          }
        }
      })
    );
    const payload = (await response.json()) as {
      agent: { id: string; actorContext: unknown; parentAgentId: string | null };
    };

    const repository = createRepository({
      storePath: process.env.AGENTIC_RUNTIME_STORE_PATH
    });
    const persisted = await repository.getAgent(payload.agent.id, SYSTEM_USER_ID);

    expect(response.status).toBe(200);
    expect(payload.agent.actorContext).toEqual(createSystemActorContext(SYSTEM_USER_ID));
    expect(payload.agent.parentAgentId).toBe("marketplace-agent-1");
    expect(persisted?.actorContext).toEqual(createSystemActorContext(SYSTEM_USER_ID));
    expect(persisted?.integrationPermissions).toEqual([]);
    expect(persisted?.memoryPermissions).toEqual([]);
  });

  it("returns 404 when the system principal requests another user's custom agent", async () => {
    const repository = createRepository({
      storePath: process.env.AGENTIC_RUNTIME_STORE_PATH
    });
    const secondaryUserId = "user-secondary";

    await repository.seedDefaults(secondaryUserId);
    await repository.saveAgent(buildCustomAgent(secondaryUserId, "agent-private-secondary", "private-secondary"));
    Reflect.set(globalThis, "__agenticRepository", undefined);

    const response = await getAgentRoute(buildAuthorizedGetRequest("http://localhost/api/agents/agent-private-secondary"), {
      params: Promise.resolve({ id: "agent-private-secondary" })
    });
    const payload = (await response.json()) as { error?: string };

    expect(response.status).toBe(404);
    expectNoStoreHeaders(response);
    expect(payload.error).toBe("Agent not found");
  });

  it("hides non-operational integration and memory permissions from exports", async () => {
    const repository = createRepository({
      storePath: process.env.AGENTIC_RUNTIME_STORE_PATH
    });
    const agent = AgentDefinitionSchema.parse({
      ...buildCustomAgent(SYSTEM_USER_ID, "agent-export-permissions", "export-permissions"),
      integrationPermissions: [
        {
          integrationId: "gmail",
          permission: "full",
          allowedScopes: ["mail.send"]
        }
      ],
      memoryPermissions: [
        {
          category: "operator-notes",
          canRead: true,
          canWrite: true
        }
      ]
    });

    await repository.seedDefaults(SYSTEM_USER_ID);
    await repository.saveAgent(agent);
    Reflect.set(globalThis, "__agenticRepository", undefined);

    const response = await exportAgentRoute(
      buildAuthorizedGetRequest("http://localhost/api/agents/agent-export-permissions/export"),
      { params: Promise.resolve({ id: "agent-export-permissions" }) }
    );
    const payload = (await response.json()) as {
      agent: {
        allowedCapabilities?: unknown[];
        maxRiskClass?: string;
        integrationPermissions?: unknown[];
        memoryPermissions?: unknown[];
      };
    };

    expect(response.status).toBe(200);
    expectNoStoreHeaders(response);
    expect(payload.agent.allowedCapabilities).toEqual(["read", "search"]);
    expect(payload.agent.maxRiskClass).toBe("R2");
    expect(payload.agent.integrationPermissions).toBeUndefined();
    expect(payload.agent.memoryPermissions).toBeUndefined();
  });
});
