import { mkdtemp } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { SYSTEM_USER_ID, WatcherSchema, nowIso } from "@agentic/contracts";
import { createRepository } from "@agentic/repository";
import { processUserRequest } from "@agentic/orchestrator";
import { AGENTIC_ACCESS_KEY_HEADER } from "../apps/web/lib/auth";
import { GET as listWatchersRoute, POST as watchersRoute } from "../apps/web/app/api/watchers/route";

describe("watchers route", () => {
  const originalAccessKey = process.env.AGENTIC_ACCESS_KEY;
  const originalRuntimeStorePath = process.env.AGENTIC_RUNTIME_STORE_PATH;

  async function createGoalForUser(
    repository: ReturnType<typeof createRepository>,
    userId: string,
    request: string
  ) {
    const bundle = processUserRequest({
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
});
