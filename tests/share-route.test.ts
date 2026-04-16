import { mkdtemp } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { SYSTEM_USER_ID, briefingTypeValues, createHumanActorContext, createSystemActorContext } from "@agentic/contracts";
import { createRepository, type AgenticRepository } from "@agentic/repository";
import { processUserRequest } from "@agentic/orchestrator";
import { buildDefaultIntegrationAccounts } from "@agentic/integrations";
import { vi } from "vitest";
import * as authModule from "../apps/web/lib/auth";
import { AGENTIC_ACCESS_KEY_HEADER } from "../apps/web/lib/auth";
import { verifyGoalShareToken } from "../apps/web/lib/share";
import { POST as goalShareRoute } from "../apps/web/app/api/goals/[id]/share/route";
import { expectNoStoreHeaders } from "./route-test-helpers";

function buildAutopilotSettings() {
  return {
    userId: SYSTEM_USER_ID,
    mode: "notify_only" as const,
    debounceMinutes: 15,
    createdAt: "2024-01-01T00:00:00.000Z",
    updatedAt: "2024-01-01T00:00:00.000Z"
  };
}

function createFakeRepository(overrides: Partial<AgenticRepository>): AgenticRepository {
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
    listWorkspaces: async () => [workspace],
    saveWorkspace: async (candidate) => candidate,
    listWorkspaceMembers: async () => [
      {
        id: `workspace-member-${workspace.id}-${SYSTEM_USER_ID}`,
        workspaceId: workspace.id,
        userId: SYSTEM_USER_ID,
        role: "owner",
        joinedAt: timestamp,
        updatedAt: timestamp
      }
    ],
    saveWorkspaceMember: async (member) => member,
    getWorkspaceSelection: async () => ({
      userId: SYSTEM_USER_ID,
      workspaceId: workspace.id,
      selectedAt: timestamp,
      updatedAt: timestamp
    }),
    saveWorkspaceSelection: async (selection) => selection,
    getWorkspaceGovernance: async () => ({
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
    }),
    saveWorkspaceGovernance: async (governance) => governance,
    exportWorkspaceAudit: async (workspaceId) => ({
      workspaceId,
      fileName: `${workspaceId}-audit.json`,
      contentType: "application/json",
      content: JSON.stringify({ workspaceId }),
      generatedAt: timestamp
    }),
    getBriefingPreferences: async () => ({
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
    }),
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
    getDashboardData: async () => ({
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
    }),
    listTemplates: async () => [],
    saveTemplate: async (template) => template,
    deleteTemplate: async () => {},
    listWorkflowTemplates: async () => [],
    getWorkflowTemplate: async () => null,
    saveWorkflowTemplate: async (template) => template,
    deleteWorkflowTemplate: async () => {},
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
    expect(createdLog?.details.actorContext).toEqual(createSystemActorContext(SYSTEM_USER_ID));
    expect(JSON.stringify(createdLog?.details ?? {})).not.toContain(decodeURIComponent(token) ?? "");
    expectNoStoreHeaders(response);
  });

  it("stamps session actor context onto share creation logs", async () => {
    const repository = createRepository({
      storePath: process.env.AGENTIC_RUNTIME_STORE_PATH
    });
    const secondaryUserId = "user-secondary";

    await repository.seedDefaults(secondaryUserId);
    const bundle = await createGoalForUser(repository, secondaryUserId, "Share my current planning context with a reviewer.");
    const requireApiSessionSpy = vi.spyOn(authModule, "requireApiSession").mockResolvedValue({
      authMethod: "session",
      userId: secondaryUserId,
      sessionId: "session-secondary",
      expiresAt: null
    });

    Reflect.set(globalThis, "__agenticRepository", undefined);

    try {
      const response = await goalShareRoute(
        new Request(`http://localhost/api/goals/${bundle.goal.id}/share`, {
          method: "POST"
        }),
        {
          params: Promise.resolve({ id: bundle.goal.id })
        }
      );
      const payload = (await response.json()) as { shareUrl: string };
      const reloadedBundle = await createRepository({
        storePath: process.env.AGENTIC_RUNTIME_STORE_PATH
      }).getGoalBundle(bundle.goal.id);
      const createdLog = reloadedBundle?.actionLogs.find((log) => log.kind === "share.link_created");

      expect(response.status).toBe(200);
      expect(payload.shareUrl).toContain("/share/");
      expect(createdLog?.details.actorContext).toEqual(createHumanActorContext(secondaryUserId, "session-secondary"));
      expectNoStoreHeaders(response);
    } finally {
      requireApiSessionSpy.mockRestore();
    }
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
