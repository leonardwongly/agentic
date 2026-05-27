import { mkdtemp } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  AgentDefinitionSchema,
  DEFAULT_OWNER_USER_ID,
  createSystemActorContext,
  nowIso
} from "@agentic/contracts";
import { createMemoryRecord } from "@agentic/memory";
import { createRepository } from "@agentic/repository";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { GET as getAgentMemoriesRoute, POST as postAgentMemoriesRoute } from "../apps/web/app/api/agents/[id]/memories/route";
import { AGENTIC_ACCESS_KEY_HEADER } from "../apps/web/lib/auth";
import { expectNoStoreHeaders } from "./route-test-helpers";

function buildAuthorizedGetRequest(url: string) {
  return new Request(url, {
    method: "GET",
    headers: {
      [AGENTIC_ACCESS_KEY_HEADER]: "test-access-key"
    }
  });
}

function buildAuthorizedPostRequest(url: string, body: unknown) {
  return new Request(url, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      [AGENTIC_ACCESS_KEY_HEADER]: "test-access-key"
    },
    body: JSON.stringify(body)
  });
}

function buildCustomAgent(userId: string, id: string, name: string) {
  const timestamp = nowIso();
  return AgentDefinitionSchema.parse({
    id,
    userId,
    name,
    displayName: "Memory Agent",
    description: "Maintains agent-scoped memory.",
    icon: "🧠",
    category: "custom",
    tags: ["memory"],
    systemPrompt: "Capture and retrieve agent-specific memory safely.",
    promptVariables: [],
    artifactType: "summary",
    behaviorConfig: {
      temperature: 0.2,
      maxTokens: 800,
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

describe("agent memory route", () => {
  const originalAccessKey = process.env.AGENTIC_ACCESS_KEY;
  const originalRuntimeStorePath = process.env.AGENTIC_RUNTIME_STORE_PATH;

  beforeEach(async () => {
    process.env.AGENTIC_ACCESS_KEY = "test-access-key";
    process.env.AGENTIC_RUNTIME_STORE_PATH = path.join(
      await mkdtemp(path.join(os.tmpdir(), "agentic-agent-memory-route-")),
      "runtime-store.json"
    );
    Reflect.set(globalThis, "__agenticRepository", undefined);
  });

  afterEach(() => {
    process.env.AGENTIC_ACCESS_KEY = originalAccessKey;
    process.env.AGENTIC_RUNTIME_STORE_PATH = originalRuntimeStorePath;
    Reflect.set(globalThis, "__agenticRepository", undefined);
  });

  it("lists only memories owned by the requested agent", async () => {
    const repository = createRepository({
      storePath: process.env.AGENTIC_RUNTIME_STORE_PATH
    });
    const primaryAgent = buildCustomAgent(DEFAULT_OWNER_USER_ID, "agent-memory-primary", "memory-primary");
    const secondaryAgent = buildCustomAgent(DEFAULT_OWNER_USER_ID, "agent-memory-secondary", "memory-secondary");

    await repository.seedDefaults(DEFAULT_OWNER_USER_ID);
    await repository.saveAgent(primaryAgent);
    await repository.saveAgent(secondaryAgent);
    await repository.saveMemory(
      createMemoryRecord({
        userId: DEFAULT_OWNER_USER_ID,
        category: "history",
        memoryType: "observed",
        content: "Primary agent observed an escalation.",
        confidence: 0.8,
        source: "test-suite",
        agentId: primaryAgent.id,
        agentScope: "agent-only"
      })
    );
    await repository.saveMemory(
      createMemoryRecord({
        userId: DEFAULT_OWNER_USER_ID,
        category: "history",
        memoryType: "observed",
        content: "Secondary agent handled a retry.",
        confidence: 0.81,
        source: "test-suite",
        agentId: secondaryAgent.id,
        agentScope: "agent-only"
      })
    );
    await repository.saveMemory(
      createMemoryRecord({
        userId: DEFAULT_OWNER_USER_ID,
        category: "history",
        memoryType: "observed",
        content: "Global memory should stay out of the agent-scoped list.",
        confidence: 0.9,
        source: "test-suite"
      })
    );
    Reflect.set(globalThis, "__agenticRepository", undefined);

    const response = await getAgentMemoriesRoute(
      buildAuthorizedGetRequest("http://localhost/api/agents/agent-memory-primary/memories"),
      {
        params: Promise.resolve({ id: primaryAgent.id })
      }
    );
    const payload = (await response.json()) as {
      agent: { id: string };
      memories: Array<{ id: string; content: string; agentId: string | null }>;
    };

    expect(response.status).toBe(200);
    expect(payload.agent.id).toBe(primaryAgent.id);
    expect(payload.memories).toHaveLength(1);
    expect(payload.memories[0]?.content).toContain("Primary agent");
    expect(payload.memories[0]?.agentId).toBe(primaryAgent.id);
    expectNoStoreHeaders(response);
  });

  it("creates an agent-scoped memory and persists actor context", async () => {
    const repository = createRepository({
      storePath: process.env.AGENTIC_RUNTIME_STORE_PATH
    });
    const agent = buildCustomAgent(DEFAULT_OWNER_USER_ID, "agent-memory-post", "memory-post");

    await repository.seedDefaults(DEFAULT_OWNER_USER_ID);
    await repository.saveAgent(agent);
    Reflect.set(globalThis, "__agenticRepository", undefined);

    const response = await postAgentMemoriesRoute(
      buildAuthorizedPostRequest("http://localhost/api/agents/agent-memory-post/memories", {
        category: "workflow",
        content: "Escalate repeat failures to the operations lead.",
        memoryType: "confirmed",
        agentScope: "agent-preferred"
      }),
      {
        params: Promise.resolve({ id: agent.id })
      }
    );
    const payload = (await response.json()) as {
      memory: {
        agentId: string | null;
        agentScope: string;
        actorContext: unknown;
        confidence: number;
      };
      memories: Array<{ agentId: string | null }>;
    };

    const reloadedRepository = createRepository({
      storePath: process.env.AGENTIC_RUNTIME_STORE_PATH
    });
    const persisted = (await reloadedRepository.listMemory(DEFAULT_OWNER_USER_ID)).find(
      (memory) => memory.content === "Escalate repeat failures to the operations lead."
    );

    expect(response.status).toBe(200);
    expect(payload.memory.agentId).toBe(agent.id);
    expect(payload.memory.agentScope).toBe("agent-preferred");
    expect(payload.memory.confidence).toBe(0.92);
    expect(payload.memory.actorContext).toEqual(createSystemActorContext(DEFAULT_OWNER_USER_ID));
    expect(payload.memories).toHaveLength(1);
    expect(persisted?.agentId).toBe(agent.id);
    expect(persisted?.agentScope).toBe("agent-preferred");
    expect(persisted?.actorContext).toEqual(createSystemActorContext(DEFAULT_OWNER_USER_ID));
    expectNoStoreHeaders(response);
  });

  it("rejects unknown fields in create requests", async () => {
    const repository = createRepository({
      storePath: process.env.AGENTIC_RUNTIME_STORE_PATH
    });
    const agent = buildCustomAgent(DEFAULT_OWNER_USER_ID, "agent-memory-validation", "memory-validation");

    await repository.seedDefaults(DEFAULT_OWNER_USER_ID);
    await repository.saveAgent(agent);
    Reflect.set(globalThis, "__agenticRepository", undefined);

    const response = await postAgentMemoriesRoute(
      buildAuthorizedPostRequest("http://localhost/api/agents/agent-memory-validation/memories", {
        category: "workflow",
        content: "Unexpected fields should be rejected.",
        extra: "nope"
      }),
      {
        params: Promise.resolve({ id: agent.id })
      }
    );
    const payload = (await response.json()) as { error?: string };

    expect(response.status).toBe(400);
    expect(payload.error).toContain("Unrecognized key");
    expectNoStoreHeaders(response);
  });

  it("rejects attempts to make agent route memory global", async () => {
    const repository = createRepository({
      storePath: process.env.AGENTIC_RUNTIME_STORE_PATH
    });
    const agent = buildCustomAgent(DEFAULT_OWNER_USER_ID, "agent-memory-global-scope", "memory-global-scope");

    await repository.seedDefaults(DEFAULT_OWNER_USER_ID);
    await repository.saveAgent(agent);
    Reflect.set(globalThis, "__agenticRepository", undefined);

    const response = await postAgentMemoriesRoute(
      buildAuthorizedPostRequest("http://localhost/api/agents/agent-memory-global-scope/memories", {
        category: "workflow",
        content: "This should not be promoted into global memory from an agent route.",
        agentScope: "global"
      }),
      {
        params: Promise.resolve({ id: agent.id })
      }
    );
    const payload = (await response.json()) as { error?: string };

    expect(response.status).toBe(400);
    expect(payload.error).toContain("Agent memory scope must remain agent-scoped");
    expectNoStoreHeaders(response);
  });

  it("returns 404 for agents outside the current user's scope", async () => {
    const repository = createRepository({
      storePath: process.env.AGENTIC_RUNTIME_STORE_PATH
    });

    await repository.seedDefaults(DEFAULT_OWNER_USER_ID);
    await repository.seedDefaults("user-secondary");
    await repository.saveAgent(buildCustomAgent("user-secondary", "agent-memory-private", "memory-private"));
    Reflect.set(globalThis, "__agenticRepository", undefined);

    const response = await getAgentMemoriesRoute(
      buildAuthorizedGetRequest("http://localhost/api/agents/agent-memory-private/memories"),
      {
        params: Promise.resolve({ id: "agent-memory-private" })
      }
    );
    const payload = (await response.json()) as { error?: string };

    expect(response.status).toBe(404);
    expect(payload.error).toBe("Agent not found");
    expectNoStoreHeaders(response);
  });
});
