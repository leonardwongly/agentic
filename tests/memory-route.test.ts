import { mkdtemp } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { SYSTEM_USER_ID, createSystemActorContext } from "@agentic/contracts";
import { createMemoryRecord } from "@agentic/memory";
import { createRepository } from "@agentic/repository";
import { AGENTIC_ACCESS_KEY_HEADER } from "../apps/web/lib/auth";
import { PATCH as memoryUpdateRoute } from "../apps/web/app/api/memory/[id]/route";

describe("memory update route", () => {
  const originalAccessKey = process.env.AGENTIC_ACCESS_KEY;
  const originalRuntimeStorePath = process.env.AGENTIC_RUNTIME_STORE_PATH;

  beforeEach(async () => {
    process.env.AGENTIC_ACCESS_KEY = "test-access-key";
    process.env.AGENTIC_RUNTIME_STORE_PATH = path.join(
      await mkdtemp(path.join(os.tmpdir(), "agentic-memory-route-")),
      "runtime-store.json"
    );
    Reflect.set(globalThis, "__agenticRepository", undefined);
  });

  afterEach(() => {
    process.env.AGENTIC_ACCESS_KEY = originalAccessKey;
    process.env.AGENTIC_RUNTIME_STORE_PATH = originalRuntimeStorePath;
    Reflect.set(globalThis, "__agenticRepository", undefined);
  });

  function buildPatchRequest(memoryId: string, body: unknown) {
    return new Request(`http://localhost/api/memory/${memoryId}`, {
      method: "PATCH",
      headers: {
        "content-type": "application/json",
        [AGENTIC_ACCESS_KEY_HEADER]: "test-access-key"
      },
      body: JSON.stringify(body)
    });
  }

  it("reviews stale memory and clears an expired review window", async () => {
    const repository = createRepository({
      storePath: process.env.AGENTIC_RUNTIME_STORE_PATH
    });

    await repository.seedDefaults(SYSTEM_USER_ID);

    const expiredMemory = createMemoryRecord({
      userId: SYSTEM_USER_ID,
      category: "preferences",
      memoryType: "observed",
      content: "Prefers concise follow-up drafts.",
      confidence: 0.82,
      source: "test-suite",
      reviewAt: "2024-01-01T00:00:00.000Z",
      expiryAt: "2024-01-02T00:00:00.000Z"
    });

    await repository.saveMemory(expiredMemory);
    Reflect.set(globalThis, "__agenticRepository", undefined);

    const before = Date.now();
    const response = await memoryUpdateRoute(buildPatchRequest(expiredMemory.id, { action: "review" }), {
      params: Promise.resolve({ id: expiredMemory.id })
    });
    const payload = (await response.json()) as {
      memory: {
        id: string;
        reviewAt: string | null;
        expiryAt: string | null;
        memoryType: string;
        actorContext: unknown;
      };
      dashboard: {
        diagnostics: {
          items: Array<{ kind: string }>;
        };
      };
    };

    expect(response.status).toBe(200);
    expect(payload.memory.id).toBe(expiredMemory.id);
    expect(payload.memory.memoryType).toBe("observed");
    expect(payload.memory.actorContext).toEqual(createSystemActorContext(SYSTEM_USER_ID));
    expect(payload.memory.expiryAt).toBeNull();
    expect(payload.memory.reviewAt).not.toBeNull();
    expect(Date.parse(payload.memory.reviewAt ?? "")).toBeGreaterThan(before);
    expect(payload.dashboard.diagnostics.items.some((item) => item.kind === "stale_memories")).toBe(false);

    const reloadedRepository = createRepository({
      storePath: process.env.AGENTIC_RUNTIME_STORE_PATH
    });
    const persisted = (await reloadedRepository.listMemory(SYSTEM_USER_ID)).find((memory) => memory.id === expiredMemory.id);
    expect(persisted?.actorContext).toEqual(createSystemActorContext(SYSTEM_USER_ID));
  });

  it("returns 404 when updating another user's memory", async () => {
    const repository = createRepository({
      storePath: process.env.AGENTIC_RUNTIME_STORE_PATH
    });
    const secondaryUserId = "user-secondary";

    await repository.seedDefaults(SYSTEM_USER_ID);
    await repository.seedDefaults(secondaryUserId);

    const otherUserMemory = createMemoryRecord({
      userId: secondaryUserId,
      category: "preferences",
      memoryType: "observed",
      content: "This belongs to another user.",
      confidence: 0.5,
      source: "test-suite"
    });

    await repository.saveMemory(otherUserMemory);
    Reflect.set(globalThis, "__agenticRepository", undefined);

    const response = await memoryUpdateRoute(buildPatchRequest(otherUserMemory.id, { action: "confirm" }), {
      params: Promise.resolve({ id: otherUserMemory.id })
    });
    const payload = (await response.json()) as { error?: string };

    expect(response.status).toBe(404);
    expect(payload.error).toContain(`Memory ${otherUserMemory.id} was not found.`);
  });
});
