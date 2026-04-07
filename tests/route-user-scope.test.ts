import { SYSTEM_USER_ID } from "@agentic/contracts";
import { processUserRequest } from "@agentic/orchestrator";
import { buildDefaultIntegrationAccounts } from "@agentic/integrations";
import type { AgenticRepository, DashboardData } from "@agentic/repository";
import { createMemoryRecord } from "@agentic/memory";
import { AGENTIC_ACCESS_KEY_HEADER } from "../apps/web/lib/auth";
import { GET as integrationsRouteGet, POST as integrationsRoutePost } from "../apps/web/app/api/integrations/route";
import { POST as approvalResponseRoute } from "../apps/web/app/api/approvals/[id]/respond/route";

function buildAuthorizedJsonRequest(url: string, body: unknown): Request {
  return new Request(url, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      [AGENTIC_ACCESS_KEY_HEADER]: "test-access-key"
    },
    body: JSON.stringify(body)
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

describe("route user scoping", () => {
  const originalAccessKey = process.env.AGENTIC_ACCESS_KEY;

  beforeEach(() => {
    process.env.AGENTIC_ACCESS_KEY = "test-access-key";
    Reflect.set(globalThis, "__agenticRepository", undefined);
  });

  afterEach(() => {
    process.env.AGENTIC_ACCESS_KEY = originalAccessKey;
    Reflect.set(globalThis, "__agenticRepository", undefined);
  });

  it("passes the system user explicitly when listing and updating integrations", async () => {
    const integration = {
      ...buildDefaultIntegrationAccounts(SYSTEM_USER_ID)[0],
      id: "integration-local-notes"
    };
    const listIntegrationsCalls: Array<string | undefined> = [];
    const dashboardCalls: Array<string | undefined> = [];
    const updatedStatuses: string[] = [];

    Reflect.set(
      globalThis,
      "__agenticRepository",
      createFakeRepository({
        listIntegrations: async (userId) => {
          listIntegrationsCalls.push(userId);
          return [integration];
        },
        upsertIntegration: async (account) => {
          updatedStatuses.push(account.status);
          return account;
        },
        getDashboardData: async (userId) => {
          dashboardCalls.push(userId);
          return buildDashboardData();
        }
      })
    );

    const listResponse = await integrationsRouteGet(buildAuthorizedGetRequest("http://localhost/api/integrations"));
    const updateResponse = await integrationsRoutePost(
      buildAuthorizedJsonRequest("http://localhost/api/integrations", {
        id: integration.id,
        status: "disabled"
      })
    );

    expect(listResponse.status).toBe(200);
    expect(updateResponse.status).toBe(200);
    expect(listIntegrationsCalls).toEqual([SYSTEM_USER_ID, SYSTEM_USER_ID]);
    expect(dashboardCalls).toEqual([SYSTEM_USER_ID]);
    expect(updatedStatuses).toEqual(["disabled"]);
  });

  it("passes the system user explicitly when responding to approvals", async () => {
    const bundle = await processUserRequest({
      userId: SYSTEM_USER_ID,
      request: "Review my inbox and draft responses.",
      memories: [
        createMemoryRecord({
          userId: SYSTEM_USER_ID,
          category: "style",
          memoryType: "confirmed",
          content: "Use concise approval summaries.",
          confidence: 0.95,
          source: "test"
        })
      ],
      integrations: buildDefaultIntegrationAccounts(SYSTEM_USER_ID)
    });
    const approval = bundle.approvals[0];
    const listGoalsCalls: Array<string | undefined> = [];
    const dashboardCalls: Array<string | undefined> = [];
    const savedDecisions: string[] = [];

    expect(approval).toBeDefined();

    Reflect.set(
      globalThis,
      "__agenticRepository",
      createFakeRepository({
        listGoals: async (userId) => {
          listGoalsCalls.push(userId);
          return [bundle];
        },
        saveGoalBundle: async (updatedBundle) => {
          savedDecisions.push(updatedBundle.approvals.find((candidate) => candidate.id === approval.id)?.decision ?? "missing");
          return updatedBundle;
        },
        getDashboardData: async (userId) => {
          dashboardCalls.push(userId);
          return buildDashboardData();
        }
      })
    );

    const response = await approvalResponseRoute(
      buildAuthorizedJsonRequest(`http://localhost/api/approvals/${approval.id}/respond`, {
        decision: "approved"
      }),
      {
        params: Promise.resolve({ id: approval.id })
      }
    );

    expect(response.status).toBe(200);
    expect(listGoalsCalls).toEqual([SYSTEM_USER_ID]);
    expect(dashboardCalls).toEqual([SYSTEM_USER_ID]);
    expect(savedDecisions).toEqual(["approved"]);
  });
});
