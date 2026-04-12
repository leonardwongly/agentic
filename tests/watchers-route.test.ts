import { mkdtemp } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { SYSTEM_USER_ID, WatcherSchema, nowIso } from "@agentic/contracts";
import { createRepository } from "@agentic/repository";
import { processUserRequest } from "@agentic/orchestrator";
import { vi } from "vitest";
import * as authModule from "../apps/web/lib/auth";
import { AGENTIC_ACCESS_KEY_HEADER } from "../apps/web/lib/auth";
import { GET as listWatchersRoute, POST as watchersRoute } from "../apps/web/app/api/watchers/route";
import { PATCH as watcherUpdateRoute } from "../apps/web/app/api/watchers/[id]/route";

describe("watchers route", () => {
  const originalAccessKey = process.env.AGENTIC_ACCESS_KEY;
  const originalRuntimeStorePath = process.env.AGENTIC_RUNTIME_STORE_PATH;

  async function createGoalForUser(
    repository: ReturnType<typeof createRepository>,
    userId: string,
    request: string
  ) {
    const bundle = await processUserRequest({
      userId,
      request,
      memories: await repository.listMemory(userId),
      integrations: await repository.listIntegrations(userId)
    });

    await repository.saveGoalBundle(bundle);
    return bundle;
  }

  beforeEach(async () => {
    process.env.AGENTIC_ACCESS_KEY = "test-access-key";
    process.env.AGENTIC_RUNTIME_STORE_PATH = path.join(
      await mkdtemp(path.join(os.tmpdir(), "agentic-watchers-route-")),
      "runtime-store.json"
    );
    Reflect.set(globalThis, "__agenticRepository", undefined);
  });

  afterEach(() => {
    process.env.AGENTIC_ACCESS_KEY = originalAccessKey;
    process.env.AGENTIC_RUNTIME_STORE_PATH = originalRuntimeStorePath;
    Reflect.set(globalThis, "__agenticRepository", undefined);
  });

  function buildAuthorizedPatchRequest(watcherId: string, body: unknown) {
    return new Request(`http://localhost/api/watchers/${watcherId}`, {
      method: "PATCH",
      headers: {
        "content-type": "application/json",
        [AGENTIC_ACCESS_KEY_HEADER]: "test-access-key"
      },
      body: JSON.stringify(body)
    });
  }

  it("returns 404 when creating a watcher for a missing goal", async () => {
    const response = await watchersRoute(
      new Request("http://localhost/api/watchers", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          [AGENTIC_ACCESS_KEY_HEADER]: "test-access-key"
        },
        body: JSON.stringify({
          goalId: "goal-does-not-exist",
          targetEntity: "priority-inbox",
          condition: "urgent thread appears",
          frequency: "hourly",
          triggerAction: "notify me"
        })
      })
    );
    const payload = (await response.json()) as { error?: string };

    expect(response.status).toBe(404);
    expect(payload.error).toContain("Goal goal-does-not-exist was not found.");
  });

  it("returns 404 when creating a watcher for another user's goal", async () => {
    const repository = createRepository({
      storePath: process.env.AGENTIC_RUNTIME_STORE_PATH
    });
    const secondaryUserId = "user-secondary";

    await repository.seedDefaults(SYSTEM_USER_ID);
    await repository.seedDefaults(secondaryUserId);

    const secondaryBundle = await createGoalForUser(repository, secondaryUserId, "Watch someone else's private workflow.");

    Reflect.set(globalThis, "__agenticRepository", undefined);

    const response = await watchersRoute(
      new Request("http://localhost/api/watchers", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          [AGENTIC_ACCESS_KEY_HEADER]: "test-access-key"
        },
        body: JSON.stringify({
          goalId: secondaryBundle.goal.id,
          targetEntity: "priority-inbox",
          condition: "urgent thread appears",
          frequency: "hourly",
          triggerAction: "notify me"
        })
      })
    );
    const payload = (await response.json()) as { error?: string };

    expect(response.status).toBe(404);
    expect(payload.error).toContain(`Goal ${secondaryBundle.goal.id} was not found.`);
  });

  it("lists only watchers for the authenticated user's goals", async () => {
    const repository = createRepository({
      storePath: process.env.AGENTIC_RUNTIME_STORE_PATH
    });
    const secondaryUserId = "user-secondary";

    await repository.seedDefaults(SYSTEM_USER_ID);
    await repository.seedDefaults(secondaryUserId);

    const primaryBundle = await createGoalForUser(repository, SYSTEM_USER_ID, "Watch my calendar for conflicts.");
    const secondaryBundle = await createGoalForUser(repository, secondaryUserId, "Watch another user's inbox.");

    await repository.saveWatcher(
      WatcherSchema.parse({
        id: "watcher-primary",
        goalId: primaryBundle.goal.id,
        targetEntity: "calendar",
        condition: "focus block changes",
        frequency: "hourly",
        triggerAction: "notify me",
        sourceSystems: ["calendar"],
        status: "active",
        expiryAt: null,
        createdAt: nowIso(),
        updatedAt: nowIso()
      })
    );

    await repository.saveWatcher(
      WatcherSchema.parse({
        id: "watcher-secondary",
        goalId: secondaryBundle.goal.id,
        targetEntity: "inbox",
        condition: "vip mail arrives",
        frequency: "hourly",
        triggerAction: "draft reply",
        sourceSystems: ["email"],
        status: "active",
        expiryAt: null,
        createdAt: nowIso(),
        updatedAt: nowIso()
      })
    );

    Reflect.set(globalThis, "__agenticRepository", undefined);

    const response = await listWatchersRoute(
      new Request("http://localhost/api/watchers", {
        method: "GET",
        headers: {
          [AGENTIC_ACCESS_KEY_HEADER]: "test-access-key"
        }
      })
    );
    const payload = (await response.json()) as { watchers: Array<{ id: string; goalId: string }> };

    expect(response.status).toBe(200);
    expect(payload.watchers.some((watcher) => watcher.id === "watcher-primary")).toBe(true);
    expect(payload.watchers.every((watcher) => watcher.goalId === primaryBundle.goal.id)).toBe(true);
    expect(payload.watchers.some((watcher) => watcher.id === "watcher-secondary")).toBe(false);
  });

  it("uses the session principal instead of the system user when listing watchers", async () => {
    const repository = createRepository({
      storePath: process.env.AGENTIC_RUNTIME_STORE_PATH
    });
    const secondaryUserId = "user-secondary";

    await repository.seedDefaults(SYSTEM_USER_ID);
    await repository.seedDefaults(secondaryUserId);

    const primaryBundle = await createGoalForUser(repository, SYSTEM_USER_ID, "Watch my calendar for conflicts.");
    const secondaryBundle = await createGoalForUser(repository, secondaryUserId, "Watch my own inbox.");

    await repository.saveWatcher(
      WatcherSchema.parse({
        id: "watcher-system-only",
        goalId: primaryBundle.goal.id,
        targetEntity: "calendar",
        condition: "focus block changes",
        frequency: "hourly",
        triggerAction: "notify me",
        sourceSystems: ["calendar"],
        status: "active",
        expiryAt: null,
        createdAt: nowIso(),
        updatedAt: nowIso()
      })
    );

    await repository.saveWatcher(
      WatcherSchema.parse({
        id: "watcher-session-user",
        goalId: secondaryBundle.goal.id,
        targetEntity: "inbox",
        condition: "vip mail arrives",
        frequency: "hourly",
        triggerAction: "draft reply",
        sourceSystems: ["email"],
        status: "active",
        expiryAt: null,
        createdAt: nowIso(),
        updatedAt: nowIso()
      })
    );

    Reflect.set(globalThis, "__agenticRepository", undefined);

    const requireApiSessionSpy = vi.spyOn(authModule, "requireApiSession").mockResolvedValue({
      authMethod: "session",
      userId: secondaryUserId,
      sessionId: "session-secondary",
      expiresAt: "2026-12-31T00:00:00.000Z"
    });

    let response: Response;
    let payload: { watchers: Array<{ id: string; goalId: string }> };
    try {
      response = await listWatchersRoute(
        new Request("http://localhost/api/watchers", {
          method: "GET"
        })
      );
      payload = (await response.json()) as { watchers: Array<{ id: string; goalId: string }> };
    } finally {
      requireApiSessionSpy.mockRestore();
    }

    expect(response.status).toBe(200);
    expect(payload.watchers).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "watcher-session-user",
          goalId: secondaryBundle.goal.id
        })
      ])
    );
    expect(payload.watchers.some((watcher) => watcher.id === "watcher-system-only")).toBe(false);
    expect(payload.watchers.some((watcher) => watcher.goalId === primaryBundle.goal.id)).toBe(false);
  });

  it("pauses an active watcher and returns refreshed dashboard data", async () => {
    const repository = createRepository({
      storePath: process.env.AGENTIC_RUNTIME_STORE_PATH
    });

    await repository.seedDefaults(SYSTEM_USER_ID);

    const bundle = await createGoalForUser(repository, SYSTEM_USER_ID, "Watch my inbox for priority threads.");
    const watcher = WatcherSchema.parse({
      id: "watcher-active",
      goalId: bundle.goal.id,
      targetEntity: "priority inbox",
      condition: "vip mail arrives",
      frequency: "hourly",
      triggerAction: "notify me",
      sourceSystems: ["email"],
      status: "active",
      expiryAt: null,
      createdAt: nowIso(),
      updatedAt: nowIso()
    });

    await repository.saveWatcher(watcher);
    Reflect.set(globalThis, "__agenticRepository", undefined);

    const response = await watcherUpdateRoute(buildAuthorizedPatchRequest(watcher.id, { action: "pause" }), {
      params: Promise.resolve({ id: watcher.id })
    });
    const payload = (await response.json()) as {
      watcher: { id: string; status: string };
      dashboard: { watchers: Array<{ id: string; status: string }> };
    };

    expect(response.status).toBe(200);
    expect(payload.watcher).toMatchObject({
      id: watcher.id,
      status: "paused"
    });
    expect(payload.dashboard.watchers).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: watcher.id,
          status: "paused"
        })
      ])
    );
  });

  it("returns 404 when updating another user's watcher", async () => {
    const repository = createRepository({
      storePath: process.env.AGENTIC_RUNTIME_STORE_PATH
    });
    const secondaryUserId = "user-secondary";

    await repository.seedDefaults(SYSTEM_USER_ID);
    await repository.seedDefaults(secondaryUserId);

    const secondaryBundle = await createGoalForUser(repository, secondaryUserId, "Watch another user's inbox.");
    const secondaryWatcher = WatcherSchema.parse({
      id: "watcher-secondary-private",
      goalId: secondaryBundle.goal.id,
      targetEntity: "priority inbox",
      condition: "urgent thread appears",
      frequency: "hourly",
      triggerAction: "notify me",
      sourceSystems: ["email"],
      status: "active",
      expiryAt: null,
      createdAt: nowIso(),
      updatedAt: nowIso()
    });

    await repository.saveWatcher(secondaryWatcher);
    Reflect.set(globalThis, "__agenticRepository", undefined);

    const response = await watcherUpdateRoute(buildAuthorizedPatchRequest(secondaryWatcher.id, { action: "pause" }), {
      params: Promise.resolve({ id: secondaryWatcher.id })
    });
    const payload = (await response.json()) as { error?: string };

    expect(response.status).toBe(404);
    expect(payload.error).toContain(`Watcher ${secondaryWatcher.id} was not found.`);
  });
});
