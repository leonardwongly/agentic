import { SYSTEM_USER_ID } from "@agentic/contracts";
import type { AgenticRepository, DashboardData } from "@agentic/repository";
import { vi } from "vitest";
import { AGENTIC_ACCESS_KEY_HEADER } from "../apps/web/lib/auth";

const { runDocsBuildMock } = vi.hoisted(() => ({
  runDocsBuildMock: vi.fn(async () => ({
    stdout: "docs ok",
    stderr: ""
  }))
}));

vi.mock("../apps/web/lib/server", () => ({
  getSeededRepository: async () => Reflect.get(globalThis, "__agenticRepository") as AgenticRepository,
  runDocsBuild: runDocsBuildMock
}));

import { POST as docsRenderRoute } from "../apps/web/app/api/docs/render/route";

function buildAuthorizedRequest() {
  return new Request("http://localhost/api/docs/render", {
    method: "POST",
    headers: {
      [AGENTIC_ACCESS_KEY_HEADER]: "test-access-key"
    }
  });
}

function buildDashboardData(): DashboardData {
  return {
    goals: [],
    approvals: [],
    memories: [],
    watchers: [],
    integrations: [],
    latestArtifacts: [],
    actionLogs: []
  };
}

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
    getDashboardData: async () => buildDashboardData(),
    ...overrides
  };
}

describe("docs render route", () => {
  const originalAccessKey = process.env.AGENTIC_ACCESS_KEY;

  beforeEach(() => {
    process.env.AGENTIC_ACCESS_KEY = "test-access-key";
    runDocsBuildMock.mockClear();
    Reflect.set(
      globalThis,
      "__agenticRepository",
      createFakeRepository({
        getDashboardData: async () => buildDashboardData()
      })
    );
  });

  afterEach(() => {
    process.env.AGENTIC_ACCESS_KEY = originalAccessKey;
    Reflect.set(globalThis, "__agenticRepository", undefined);
  });

  it("passes the system user explicitly when refreshing the dashboard", async () => {
    const dashboardCalls: Array<string | undefined> = [];

    Reflect.set(
      globalThis,
      "__agenticRepository",
      createFakeRepository({
        getDashboardData: async (userId) => {
          dashboardCalls.push(userId);
          return buildDashboardData();
        }
      })
    );

    const response = await docsRenderRoute(buildAuthorizedRequest());

    expect(response.status).toBe(200);
    expect(runDocsBuildMock).toHaveBeenCalledTimes(1);
    expect(dashboardCalls).toEqual([SYSTEM_USER_ID]);
  });
});
