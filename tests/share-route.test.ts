import { mkdtemp } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { SYSTEM_USER_ID } from "@agentic/contracts";
import { createRepository, type AgenticRepository } from "@agentic/repository";
import { processUserRequest } from "@agentic/orchestrator";
import { buildDefaultIntegrationAccounts } from "@agentic/integrations";
import { AGENTIC_ACCESS_KEY_HEADER } from "../apps/web/lib/auth";
import { verifyGoalShareToken } from "../apps/web/lib/share";
import { POST as goalShareRoute } from "../apps/web/app/api/goals/[id]/share/route";
import { expectNoStoreHeaders } from "./route-test-helpers";

function createFakeRepository(overrides: Partial<AgenticRepository>): AgenticRepository {
  return {
    backend: "file",
    seedDefaults: async () => {},
    saveGoalBundle: async (bundle) => bundle,
    getGoalBundle: async () => null,
    getGoalBundleForUser: async () => null,
    listGoals: async () => [],
    listApprovals: async () => [],
    listMemory: async () => [],
    saveMemory: async (record) => record,
    listWatchers: async () => [],
    saveWatcher: async (watcher) => watcher,
    listIntegrations: async () => [],
    upsertIntegration: async (account) => account,
    getDashboardData: async () => ({
      goals: [],
      approvals: [],
      memories: [],
      watchers: [],
      integrations: [],
      latestArtifacts: [],
      actionLogs: []
    }),
    ...overrides
  };
}

describe("goal share route", () => {
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
      await mkdtemp(path.join(os.tmpdir(), "agentic-share-route-")),
      "runtime-store.json"
    );
    Reflect.set(globalThis, "__agenticRepository", undefined);
  });

  afterEach(() => {
    process.env.AGENTIC_ACCESS_KEY = originalAccessKey;
    process.env.AGENTIC_RUNTIME_STORE_PATH = originalRuntimeStorePath;
    Reflect.set(globalThis, "__agenticRepository", undefined);
  });

  it("creates a signed public share link and records a measurement log", async () => {
    const repository = createRepository({
      storePath: process.env.AGENTIC_RUNTIME_STORE_PATH
    });

    await repository.seedDefaults(SYSTEM_USER_ID);
    const bundle = await createGoalForUser(repository, SYSTEM_USER_ID, "Triage my inbox and prepare replies for important clients.");

    Reflect.set(globalThis, "__agenticRepository", undefined);

    const response = await goalShareRoute(
      new Request(`http://localhost/api/goals/${bundle.goal.id}/share`, {
        method: "POST",
        headers: {
          [AGENTIC_ACCESS_KEY_HEADER]: "test-access-key"
        }
      }),
      {
        params: Promise.resolve({ id: bundle.goal.id })
      }
    );
    const payload = (await response.json()) as { shareUrl: string; expiresAt: string };
    const token = payload.shareUrl.split("/share/")[1];
    const reloadedBundle = await createRepository({
      storePath: process.env.AGENTIC_RUNTIME_STORE_PATH
    }).getGoalBundle(bundle.goal.id);
    const createdLog = reloadedBundle?.actionLogs.find((log) => log.kind === "share.link_created");

    expect(response.status).toBe(200);
    expect(payload.shareUrl).toContain("/share/");
    expect(Date.parse(payload.expiresAt)).toBeGreaterThan(Date.now());
    expect(verifyGoalShareToken(decodeURIComponent(token) ?? "")).toMatchObject({
      goalId: bundle.goal.id
    });
    expect(createdLog).toBeDefined();
    expect(JSON.stringify(createdLog?.details ?? {})).not.toContain(decodeURIComponent(token) ?? "");
    expectNoStoreHeaders(response);
  });

  it("rejects unauthenticated goal share requests", async () => {
    const response = await goalShareRoute(
      new Request("http://localhost/api/goals/goal-123/share", {
        method: "POST"
      }),
      {
        params: Promise.resolve({ id: "goal-123" })
      }
    );
    const payload = (await response.json()) as { error?: string };

    expect(response.status).toBe(401);
    expect(payload.error).toContain("Unauthorized");
    expectNoStoreHeaders(response);
  });

  it("returns 404 when the goal does not exist for the user", async () => {
    const response = await goalShareRoute(
      new Request("http://localhost/api/goals/goal-missing/share", {
        method: "POST",
        headers: {
          [AGENTIC_ACCESS_KEY_HEADER]: "test-access-key"
        }
      }),
      {
        params: Promise.resolve({ id: "goal-missing" })
      }
    );
    const payload = (await response.json()) as { error?: string };

    expect(response.status).toBe(404);
    expect(payload.error).toContain("Goal goal-missing was not found.");
    expectNoStoreHeaders(response);
  });

  it("returns 404 when attempting to share another user's goal", async () => {
    const repository = createRepository({
      storePath: process.env.AGENTIC_RUNTIME_STORE_PATH
    });
    const secondaryUserId = "user-secondary";

    await repository.seedDefaults(SYSTEM_USER_ID);
    await repository.seedDefaults(secondaryUserId);

    const secondaryBundle = await createGoalForUser(repository, secondaryUserId, "Keep another user's planning private.");

    Reflect.set(globalThis, "__agenticRepository", undefined);

    const response = await goalShareRoute(
      new Request(`http://localhost/api/goals/${secondaryBundle.goal.id}/share`, {
        method: "POST",
        headers: {
          [AGENTIC_ACCESS_KEY_HEADER]: "test-access-key"
        }
      }),
      {
        params: Promise.resolve({ id: secondaryBundle.goal.id })
      }
    );
    const payload = (await response.json()) as { error?: string };

    expect(response.status).toBe(404);
    expect(payload.error).toContain(`Goal ${secondaryBundle.goal.id} was not found.`);
    expectNoStoreHeaders(response);
  });

  it("returns 500 when goal share persistence fails unexpectedly", async () => {
    const bundle = await processUserRequest({
      userId: SYSTEM_USER_ID,
      request: "Triage my inbox and prepare replies for important clients.",
      memories: [],
      integrations: buildDefaultIntegrationAccounts(SYSTEM_USER_ID)
    });

    Reflect.set(
      globalThis,
      "__agenticRepository",
      createFakeRepository({
        getGoalBundleForUser: async () => bundle,
        saveGoalBundle: async () => {
          throw new Error("database unavailable");
        }
      })
    );

    const response = await goalShareRoute(
      new Request(`http://localhost/api/goals/${bundle.goal.id}/share`, {
        method: "POST",
        headers: {
          [AGENTIC_ACCESS_KEY_HEADER]: "test-access-key"
        }
      }),
      {
        params: Promise.resolve({ id: bundle.goal.id })
      }
    );
    const payload = (await response.json()) as { error?: string };

    expect(response.status).toBe(500);
    expect(payload.error).toBe("Failed to create a goal share link.");
    expectNoStoreHeaders(response);
  });
});
