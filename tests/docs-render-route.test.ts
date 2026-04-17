import { SYSTEM_USER_ID, briefingTypeValues } from "@agentic/contracts";
import type { AgenticRepository, DashboardData } from "@agentic/repository";
import { vi } from "vitest";
import { AGENTIC_ACCESS_KEY_HEADER } from "../apps/web/lib/auth";
import { expectNoStoreHeaders } from "./route-test-helpers";

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

function buildAutopilotSettings() {
  return {
    userId: SYSTEM_USER_ID,
    mode: "notify_only" as const,
    debounceMinutes: 15,
    createdAt: "2024-01-01T00:00:00.000Z",
    updatedAt: "2024-01-01T00:00:00.000Z"
  };
}

function buildAuthorizedRequest() {
  return new Request("http://localhost/api/docs/render", {
    method: "POST",
    headers: {
      [AGENTIC_ACCESS_KEY_HEADER]: "test-access-key"
    }
  });
}

function buildDashboardData(): DashboardData {
  const timestamp = "2024-01-01T00:00:00.000Z";
  const workspace = {
    id: "workspace-personal-system-user",
    ownerUserId: SYSTEM_USER_ID,
    slug: "personal-system-user",
    name: "Personal Workspace",
    description: "Default workspace for test coverage.",
    isPersonal: true,
    createdAt: timestamp,
    updatedAt: timestamp
  };

  return {
    workspaces: [workspace],
    activeWorkspace: workspace,
    workspaceSelection: {
      userId: SYSTEM_USER_ID,
      workspaceId: workspace.id,
      selectedAt: timestamp,
      updatedAt: timestamp
    },
    workspaceMembers: [
      {
        id: `workspace-member-${workspace.id}-${SYSTEM_USER_ID}`,
        workspaceId: workspace.id,
        userId: SYSTEM_USER_ID,
        role: "owner",
        joinedAt: timestamp,
        updatedAt: timestamp
      }
    ],
    workspaceGovernance: {
      workspaceId: workspace.id,
      approvalMode: "risk_based",
      requireAuditExports: false,
      maxAutoRunRiskClass: "R1",
      externalSendRequiresApproval: true,
      calendarWriteRequiresApproval: true,
      retentionDays: 365,
      updatedBy: SYSTEM_USER_ID,
      createdAt: timestamp,
      updatedAt: timestamp
    },
    controlPlane: {
      generatedAt: timestamp,
      sections: [
        {
          key: "workspace",
          title: "Workspace",
          description: "Personal workspace is active.",
          status: "healthy",
          targetSection: "workspaces",
          stats: ["1 member", "0 ready integrations", "Approval risk based"],
          highlights: ["Max auto-run R1"]
        }
      ]
    },
    operatingSections: {
      generatedAt: timestamp,
      sections: [
        {
          key: "now",
          title: "Now",
          description: "The immediate queue is clear.",
          status: "healthy",
          targetSection: "now",
          metrics: ["0 ready items"],
          highlights: []
        }
      ]
    },
    nowQueue: {
      generatedAt: timestamp,
      totalCount: 0,
      items: []
    },
    goals: [],
    approvals: [],
    commitments: [],
    goalShares: [],
    privacyOperations: [],
    briefingPreferences: {
      userId: SYSTEM_USER_ID,
      timezone: "Asia/Singapore",
      focus: "balanced",
      schedules: briefingTypeValues.map((type, index) => ({
        type,
        enabled: index === 0,
        time: `${String(8 + index).padStart(2, "0")}:00`
      })),
      createdAt: "2024-01-01T00:00:00.000Z",
      updatedAt: "2024-01-01T00:00:00.000Z"
    },
    autopilotSettings: buildAutopilotSettings(),
    autopilotEvents: [],
    briefingHistory: [],
    memories: [],
    watchers: [],
    integrations: [],
    latestArtifacts: [],
    actionLogs: [],
    diagnostics: {
      status: "healthy",
      totalCount: 0,
      generatedAt: "2024-01-01T00:00:00.000Z",
      items: []
    }
  };
}

function createFakeRepository(overrides: Partial<AgenticRepository>): AgenticRepository {
  return {
    backend: "file",
    seedDefaults: async () => {},
    saveGoalBundle: async (bundle) => bundle,
    respondToApproval: async () => {
      throw new Error("respondToApproval is not used in this test.");
    },
    getGoalBundle: async () => null,
    getGoalBundleForUser: async () => null,
    listGoals: async () => [],
    listApprovals: async () => [],
    listCommitments: async () => [],
    getCommitment: async () => null,
    saveCommitment: async (commitment) => commitment,
    deleteCommitment: async () => {},
    listWorkspaces: async () => buildDashboardData().workspaces,
    saveWorkspace: async (workspace) => workspace,
    listWorkspaceMembers: async () => buildDashboardData().workspaceMembers,
    saveWorkspaceMember: async (member) => member,
    getWorkspaceSelection: async () => buildDashboardData().workspaceSelection,
    saveWorkspaceSelection: async (selection) => selection,
    getWorkspaceGovernance: async () => buildDashboardData().workspaceGovernance,
    saveWorkspaceGovernance: async (governance) => governance,
    listGoalShares: async () => [],
    getGoalShare: async () => null,
    getGoalShareByTokenFingerprint: async () => null,
    saveGoalShare: async (share) => share,
    listPrivacyOperations: async () => [],
    getPrivacyOperation: async () => null,
    savePrivacyOperation: async (operation) => operation,
    enforceWorkspaceRetention: async () => ({}),
    deleteWorkspaceData: async () => ({}),
    exportWorkspaceAudit: async (workspaceId) => ({
      workspaceId,
      fileName: `${workspaceId}-audit.json`,
      contentType: "application/json",
      content: JSON.stringify({ workspaceId }),
      generatedAt: "2024-01-01T00:00:00.000Z"
    }),
    getBriefingPreferences: async () => buildDashboardData().briefingPreferences,
    saveBriefingPreferences: async (preferences) => preferences,
    getAutopilotSettings: async () => buildAutopilotSettings(),
    saveAutopilotSettings: async (settings) => settings,
    listAutopilotEvents: async () => [],
    claimAutopilotEvent: async () => {
      throw new Error("claimAutopilotEvent is not used in this test.");
    },
    saveAutopilotEvent: async (event) => event,
    listMemory: async () => [],
    saveMemory: async (record) => record,
    listWatchers: async () => [],
    saveWatcher: async (watcher) => watcher,
    listIntegrations: async () => [],
    upsertIntegration: async (account) => account,
    listProviderCredentials: async () => [],
    getProviderCredential: async () => null,
    saveProviderCredential: async (credential) => credential,
    getProviderCredentialSecret: async () => null,
    saveProviderCredentialSecret: async (record) => record,
    listTemplates: async () => [],
    saveTemplate: async (template) => template,
    deleteTemplate: async () => {},
    listWorkflowTemplates: async () => [],
    getWorkflowTemplate: async () => null,
    saveWorkflowTemplate: async (template) => template,
    deleteWorkflowTemplate: async () => {},
    getDashboardData: async () => buildDashboardData(),
    listOperatorProducts: async () => [],
    getOperatorProductSelection: async () => null,
    saveOperatorProduct: async (product) => product,
    saveOperatorProductSelection: async (selection) => selection,
    listAgents: async () => [],
    getAgent: async () => null,
    saveAgent: async (agent) => agent,
    deleteAgent: async () => {},
    getAgentMetrics: async () => null,
    saveAgentMetrics: async (metrics) => metrics,
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
    expectNoStoreHeaders(response);
  });

  it("does not leak raw docs-build internals on failures", async () => {
    runDocsBuildMock.mockImplementationOnce(async () => {
      throw new Error("spawn /bin/node EACCES");
    });

    const response = await docsRenderRoute(buildAuthorizedRequest());
    const payload = (await response.json()) as { error?: string };

    expect(response.status).toBe(500);
    expect(payload.error).toBe("Failed to render the document.");
    expectNoStoreHeaders(response);
  });
});
