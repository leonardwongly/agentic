import { mkdtemp } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  DEFAULT_AUTOPILOT_RELIABILITY_CONTROLS,
  SYSTEM_USER_ID,
  briefingTypeValues,
  createHumanActorContext,
  createSystemActorContext
} from "@agentic/contracts";
import { createRepository, type AgenticRepository } from "@agentic/repository";
import { processUserRequest } from "@agentic/orchestrator";
import { buildDefaultIntegrationAccounts } from "@agentic/integrations";
import { vi } from "vitest";
import * as authModule from "../apps/web/lib/auth";
import { AGENTIC_ACCESS_KEY_HEADER } from "../apps/web/lib/auth";
import { verifyGoalShareToken } from "../apps/web/lib/share";
import { GOAL_SHARE_MUTATION_DENIED_REASON } from "../apps/web/lib/workspace-role-permissions";
import { DELETE as revokeGoalShareRoute, POST as goalShareRoute } from "../apps/web/app/api/goals/[id]/share/route";
import { createRouteTestRepository, expectNoStoreHeaders } from "./route-test-helpers";

function buildAutopilotSettings() {
  return {
    userId: SYSTEM_USER_ID,
    mode: "notify_only" as const,
    debounceMinutes: 15,
    reliabilityControls: DEFAULT_AUTOPILOT_RELIABILITY_CONTROLS,
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
    listProviderCredentials: async () => [],
    getProviderCredential: async () => null,
    saveProviderCredential: async (credential) => credential,
    getProviderCredentialSecret: async () => null,
    saveProviderCredentialSecret: async (record) => record,
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
        roleView: {
          role: "owner",
          label: "Owner view",
          summary: "Owners should clear blockers first.",
          focusAreas: ["Keep the queue moving."],
          prioritizedSectionKeys: ["now", "execution", "trust"]
        },
        teamWorkflow: {
          mode: "owner_control",
          label: "Owner-controlled team workflow",
          summary: "Owners are the policy authority and should keep delegation and approvals bounded.",
          visibilityLabel: "Full queue, approval, and governance visibility",
          queueMetrics: ["0 collaborators", "0 pending approvals", "0 urgent queue items"],
          ownershipAssignments: [],
          queues: [],
          controls: [],
          auditCoverage: {
            required: false,
            status: "healthy",
            summary: "Audit exports are optional right now, and the export route remains available for review and compliance.",
            latestStatus: null,
            latestCompletedAt: null
          },
          actionBoundaries: ["Owners can manage membership, governance posture, and approval decisions."],
          handoffGuidance: ["Route execution triage to editors and keep final policy decisions with the owner boundary."],
          permissions: {
            manageMembers: {
              allowed: true,
              reason: "Owners can change workspace membership."
            },
            editGovernance: {
              allowed: true,
              reason: "Owners can change workspace governance posture."
            },
            exportAudit: {
              allowed: true,
              reason: "Workspace members can export audit evidence."
            },
            managePrivacyOperations: {
              allowed: true,
              reason: "Owners can run privacy lifecycle operations."
            }
          },
          escalationTargetRole: null,
          slaStatus: "healthy",
          slaSummary: "Shared approvals and queue ownership are currently inside the expected response window."
        },
        nextBestAction: {
          kind: "review_now",
          label: "Inspect the live queue",
          summary: "The operator shell is clear enough to inspect the live queue.",
          status: "healthy",
          targetSection: "now",
          role: "owner"
        },
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
    request: string,
    workspaceId?: string | null
  ) {
    const bundle = await processUserRequest({
      userId,
      request,
      workspaceId,
      memories: await repository.listMemory(userId),
      integrations: await repository.listIntegrations(userId)
    });

    await repository.saveGoalBundle(bundle);
    return bundle;
  }

  async function createSharedWorkspace(
    repository: ReturnType<typeof createRepository>,
    ownerUserId: string,
    memberUserId: string
  ) {
    const ownerActor = createSystemActorContext(ownerUserId);
    const workspaceId = "workspace-shared-goal-share";

    await repository.saveWorkspace(
      {
        id: workspaceId,
        ownerUserId,
        slug: "shared-goal-share",
        name: "Shared Goal Share Workspace",
        description: "Shared workspace for share-link permission tests.",
        isPersonal: false,
        createdAt: "2026-04-22T00:00:00.000Z",
        updatedAt: "2026-04-22T00:00:00.000Z"
      },
      ownerActor
    );
    await repository.saveWorkspaceMember(
      {
        id: "workspace-member-shared-goal-share-owner",
        workspaceId,
        userId: ownerUserId,
        role: "owner",
        joinedAt: "2026-04-22T00:00:00.000Z",
        updatedAt: "2026-04-22T00:00:00.000Z"
      },
      ownerActor
    );

    return {
      workspaceId,
      addMember: async (role: "editor" | "viewer") =>
        repository.saveWorkspaceMember(
          {
            id: `workspace-member-shared-goal-share-${memberUserId}-${role}`,
            workspaceId,
            userId: memberUserId,
            role,
            joinedAt: "2026-04-22T00:00:00.000Z",
            updatedAt: "2026-04-22T00:00:00.000Z"
          },
          ownerActor
        )
    };
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
    const repository = createRouteTestRepository();

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
    const reloadedBundle = await createRouteTestRepository().getGoalBundle(bundle.goal.id);
    const shares = await createRouteTestRepository().listGoalShares({ goalId: bundle.goal.id, userId: SYSTEM_USER_ID });
    const createdLog = reloadedBundle?.actionLogs.find((log) => log.kind === "share.link_created");

    expect(response.status).toBe(200);
    expect(payload.shareUrl).toContain("/share/");
    expect(Date.parse(payload.expiresAt)).toBeGreaterThan(Date.now());
    expect(shares).toHaveLength(1);
    expect(verifyGoalShareToken(decodeURIComponent(token) ?? "")).toMatchObject({
      shareId: shares[0]?.id,
      goalId: bundle.goal.id
    });
    expect(createdLog).toBeDefined();
    expect(createdLog?.details.actorContext).toEqual(createSystemActorContext(SYSTEM_USER_ID));
    expect(JSON.stringify(createdLog?.details ?? {})).not.toContain(decodeURIComponent(token) ?? "");
    expectNoStoreHeaders(response);
  });

  it("stamps session actor context onto share creation logs", async () => {
    const repository = createRouteTestRepository();
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
      const reloadedBundle = await createRouteTestRepository().getGoalBundle(bundle.goal.id);
      const createdLog = reloadedBundle?.actionLogs.find((log) => log.kind === "share.link_created");

      expect(response.status).toBe(200);
      expect(payload.shareUrl).toContain("/share/");
      expect(createdLog?.details.actorContext).toEqual(createHumanActorContext(secondaryUserId, "session-secondary"));
      expectNoStoreHeaders(response);
    } finally {
      requireApiSessionSpy.mockRestore();
    }
  }, 10_000);

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
    const repository = createRouteTestRepository();
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

  it("allows editors in a shared workspace to create goal share links", async () => {
    const repository = createRouteTestRepository();
    const ownerUserId = "workspace-owner";
    const editorUserId = "workspace-editor";
    const requireApiSessionSpy = vi.spyOn(authModule, "requireApiSession").mockResolvedValue({
      authMethod: "session",
      userId: editorUserId,
      sessionId: "session-workspace-editor",
      expiresAt: null
    });

    try {
      await repository.seedDefaults(ownerUserId);
      await repository.seedDefaults(editorUserId);
      const workspace = await createSharedWorkspace(repository, ownerUserId, editorUserId);

      await workspace.addMember("editor");
      await repository.saveWorkspaceSelection({
        userId: editorUserId,
        workspaceId: workspace.workspaceId,
        selectedAt: "2026-04-22T00:00:00.000Z",
        updatedAt: "2026-04-22T00:00:00.000Z"
      });

      const bundle = await createGoalForUser(
        repository,
        ownerUserId,
        "Share shared workspace planning with an execution reviewer.",
        workspace.workspaceId
      );

      Reflect.set(globalThis, "__agenticRepository", undefined);

      const response = await goalShareRoute(
        new Request(`http://localhost/api/goals/${bundle.goal.id}/share`, {
          method: "POST"
        }),
        {
          params: Promise.resolve({ id: bundle.goal.id })
        }
      );
      const payload = (await response.json()) as { shareUrl?: string; error?: string };

      expect(response.status).toBe(200);
      expect(payload.shareUrl).toContain("/share/");
      expectNoStoreHeaders(response);
    } finally {
      requireApiSessionSpy.mockRestore();
    }
  });

  it("returns 403 when a viewer tries to create a shared goal share link", async () => {
    const repository = createRouteTestRepository();
    const ownerUserId = "workspace-owner";
    const viewerUserId = "workspace-viewer";
    const requireApiSessionSpy = vi.spyOn(authModule, "requireApiSession").mockResolvedValue({
      authMethod: "session",
      userId: viewerUserId,
      sessionId: "session-workspace-viewer",
      expiresAt: null
    });

    try {
      await repository.seedDefaults(ownerUserId);
      await repository.seedDefaults(viewerUserId);
      const workspace = await createSharedWorkspace(repository, ownerUserId, viewerUserId);

      await workspace.addMember("viewer");
      await repository.saveWorkspaceSelection({
        userId: viewerUserId,
        workspaceId: workspace.workspaceId,
        selectedAt: "2026-04-22T00:00:00.000Z",
        updatedAt: "2026-04-22T00:00:00.000Z"
      });

      const bundle = await createGoalForUser(
        repository,
        ownerUserId,
        "Keep the queue visible without granting share-link mutation authority.",
        workspace.workspaceId
      );

      Reflect.set(globalThis, "__agenticRepository", undefined);

      const response = await goalShareRoute(
        new Request(`http://localhost/api/goals/${bundle.goal.id}/share`, {
          method: "POST"
        }),
        {
          params: Promise.resolve({ id: bundle.goal.id })
        }
      );
      const payload = (await response.json()) as { error?: string };
      const shares = await repository.listGoalShares({
        goalId: bundle.goal.id,
        userId: ownerUserId
      });

      expect(response.status).toBe(403);
      expect(payload.error).toBe(GOAL_SHARE_MUTATION_DENIED_REASON);
      expect(shares).toHaveLength(0);
      expectNoStoreHeaders(response);
    } finally {
      requireApiSessionSpy.mockRestore();
    }
  });

  it("revokes an existing public share link and records a revoke log", async () => {
    const repository = createRouteTestRepository();

    await repository.seedDefaults(SYSTEM_USER_ID);
    const bundle = await createGoalForUser(repository, SYSTEM_USER_ID, "Share the current planning context with a reviewer.");
    const shareResponse = await goalShareRoute(
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
    const sharePayload = (await shareResponse.json()) as { shareId: string };

    const revokeResponse = await revokeGoalShareRoute(
      new Request(`http://localhost/api/goals/${bundle.goal.id}/share`, {
        method: "DELETE",
        headers: {
          "content-type": "application/json",
          [AGENTIC_ACCESS_KEY_HEADER]: "test-access-key"
        },
        body: JSON.stringify({
          shareId: sharePayload.shareId
        })
      }),
      {
        params: Promise.resolve({ id: bundle.goal.id })
      }
    );
    const revokedShare = await repository.getGoalShare(sharePayload.shareId, SYSTEM_USER_ID);
    const reloadedBundle = await repository.getGoalBundle(bundle.goal.id);
    const revokedLog = reloadedBundle?.actionLogs.find((log) => log.kind === "share.link_revoked");

    expect(revokeResponse.status).toBe(200);
    expect(revokedShare).toMatchObject({
      id: sharePayload.shareId,
      status: "revoked"
    });
    expect(revokedShare?.revokedAt).not.toBeNull();
    expect(revokedLog?.details.shareId).toBe(sharePayload.shareId);
    expectNoStoreHeaders(revokeResponse);
  });

  it("returns 403 when a viewer tries to revoke a shared goal share link", async () => {
    const repository = createRouteTestRepository();
    const ownerUserId = SYSTEM_USER_ID;
    const viewerUserId = "workspace-viewer";

    await repository.seedDefaults(ownerUserId);
    await repository.seedDefaults(viewerUserId);
    const workspace = await createSharedWorkspace(repository, ownerUserId, viewerUserId);

    await workspace.addMember("viewer");
    const bundle = await createGoalForUser(
      repository,
      ownerUserId,
      "Share the execution context, then verify viewers cannot revoke it.",
      workspace.workspaceId
    );
    const shareResponse = await goalShareRoute(
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
    const sharePayload = (await shareResponse.json()) as { shareId: string };
    const requireApiSessionSpy = vi.spyOn(authModule, "requireApiSession").mockResolvedValue({
      authMethod: "session",
      userId: viewerUserId,
      sessionId: "session-workspace-viewer",
      expiresAt: null
    });

    try {
      const revokeResponse = await revokeGoalShareRoute(
        new Request(`http://localhost/api/goals/${bundle.goal.id}/share`, {
          method: "DELETE",
          headers: {
            "content-type": "application/json"
          },
          body: JSON.stringify({
            shareId: sharePayload.shareId
          })
        }),
        {
          params: Promise.resolve({ id: bundle.goal.id })
        }
      );
      const payload = (await revokeResponse.json()) as { error?: string };
      const share = await repository.getGoalShare(sharePayload.shareId, ownerUserId);

      expect(revokeResponse.status).toBe(403);
      expect(payload.error).toBe(GOAL_SHARE_MUTATION_DENIED_REASON);
      expect(share?.status).toBe("active");
      expectNoStoreHeaders(revokeResponse);
    } finally {
      requireApiSessionSpy.mockRestore();
    }
  });
});
