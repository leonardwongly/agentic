import { mkdtemp, readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { SYSTEM_USER_ID, WatcherSchema, nowIso } from "@agentic/contracts";
import { createRepository } from "@agentic/repository";
import { processUserRequest } from "@agentic/orchestrator";

describe("repository", () => {
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

  it("persists a goal bundle to the file-backed store", async () => {
    const tempDir = await mkdtemp(path.join(os.tmpdir(), "agentic-repo-"));
    const storePath = path.join(tempDir, "runtime-store.json");
    const repository = createRepository({
      storePath
    });

    await repository.seedDefaults(SYSTEM_USER_ID);

    const bundle = await createGoalForUser(repository, SYSTEM_USER_ID, "Plan my week around focus time and meetings.");

    const reloaded = await repository.getGoalBundle(bundle.goal.id);
    const persisted = JSON.parse(await readFile(storePath, "utf8")) as { goals: Array<{ id: string }> };

    expect(reloaded?.goal.id).toBe(bundle.goal.id);
    expect(persisted.goals.some((goal) => goal.id === bundle.goal.id)).toBe(true);
  });

  const databaseUrl = process.env.DATABASE_URL;
  const postgresIt = databaseUrl ? it : it.skip;

  postgresIt("persists and reloads a goal bundle in Postgres when DATABASE_URL is configured", async () => {
    const repository = createRepository({
      databaseUrl
    });

    await repository.seedDefaults(SYSTEM_USER_ID);

    const bundle = await createGoalForUser(repository, SYSTEM_USER_ID, `Prepare a travel plan with approvals ${Date.now()}.`);

    const reloaded = await repository.getGoalBundle(bundle.goal.id);
    const dashboard = await repository.getDashboardData(SYSTEM_USER_ID);

    expect(reloaded?.goal.id).toBe(bundle.goal.id);
    expect(dashboard.goals.some((goalBundle) => goalBundle.goal.id === bundle.goal.id)).toBe(true);
  });

  it("rejects watchers that reference missing goals", async () => {
    const tempDir = await mkdtemp(path.join(os.tmpdir(), "agentic-repo-"));
    const storePath = path.join(tempDir, "runtime-store.json");
    const repository = createRepository({
      storePath
    });

    await repository.seedDefaults(SYSTEM_USER_ID);

    await expect(
      repository.saveWatcher(
        WatcherSchema.parse({
          id: "watcher-missing-goal",
          goalId: "goal-does-not-exist",
          targetEntity: "priority-inbox",
          condition: "urgent thread appears",
          frequency: "hourly",
          triggerAction: "notify me",
          sourceSystems: ["email"],
          status: "active",
          expiryAt: null,
          createdAt: nowIso(),
          updatedAt: nowIso()
        })
      )
    ).rejects.toThrow(/Goal goal-does-not-exist was not found/);
  });

  it("returns only watchers owned by the requested user", async () => {
    const tempDir = await mkdtemp(path.join(os.tmpdir(), "agentic-repo-"));
    const storePath = path.join(tempDir, "runtime-store.json");
    const repository = createRepository({
      storePath
    });
    const secondaryUserId = "user-secondary";

    await repository.seedDefaults(SYSTEM_USER_ID);
    await repository.seedDefaults(secondaryUserId);

    const primaryBundle = await createGoalForUser(repository, SYSTEM_USER_ID, "Protect my calendar planning workflow.");
    const secondaryBundle = await createGoalForUser(repository, secondaryUserId, "Track another user's inbox automation.");

    await repository.saveWatcher(
      WatcherSchema.parse({
        id: "watcher-primary",
        goalId: primaryBundle.goal.id,
        targetEntity: "calendar",
        condition: "focus time disappears",
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
        condition: "vip message arrives",
        frequency: "hourly",
        triggerAction: "draft reply",
        sourceSystems: ["email"],
        status: "active",
        expiryAt: null,
        createdAt: nowIso(),
        updatedAt: nowIso()
      })
    );

    const primaryWatchers = await repository.listWatchers({ userId: SYSTEM_USER_ID });
    const primaryDashboard = await repository.getDashboardData(SYSTEM_USER_ID);
    const unauthorizedGoalLookup = await repository.listWatchers({
      userId: SYSTEM_USER_ID,
      goalId: secondaryBundle.goal.id
    });

    expect(primaryWatchers.some((watcher) => watcher.id === "watcher-primary")).toBe(true);
    expect(primaryWatchers.every((watcher) => watcher.goalId === primaryBundle.goal.id)).toBe(true);
    expect(primaryWatchers.some((watcher) => watcher.id === "watcher-secondary")).toBe(false);
    expect(primaryDashboard.watchers.some((watcher) => watcher.id === "watcher-primary")).toBe(true);
    expect(primaryDashboard.watchers.every((watcher) => watcher.goalId === primaryBundle.goal.id)).toBe(true);
    expect(primaryDashboard.watchers.some((watcher) => watcher.id === "watcher-secondary")).toBe(false);
    expect(unauthorizedGoalLookup).toEqual([]);
  });

  it("returns null when loading a goal bundle owned by another user", async () => {
    const tempDir = await mkdtemp(path.join(os.tmpdir(), "agentic-repo-"));
    const storePath = path.join(tempDir, "runtime-store.json");
    const repository = createRepository({
      storePath
    });
    const secondaryUserId = "user-secondary";

    await repository.seedDefaults(SYSTEM_USER_ID);
    await repository.seedDefaults(secondaryUserId);

    const secondaryBundle = await createGoalForUser(repository, secondaryUserId, "Keep this planning workflow private.");

    const hiddenBundle = await repository.getGoalBundleForUser(secondaryBundle.goal.id, SYSTEM_USER_ID);
    const visibleBundle = await repository.getGoalBundleForUser(secondaryBundle.goal.id, secondaryUserId);

    expect(hiddenBundle).toBeNull();
    expect(visibleBundle?.goal.id).toBe(secondaryBundle.goal.id);
  });
});
