import type { EvidenceRecord } from "@agentic/contracts";
import { SYSTEM_USER_ID, WatcherSchema, briefingTypeValues } from "@agentic/contracts";
import { processUserRequest } from "@agentic/orchestrator";
import { buildDefaultIntegrationAccounts } from "@agentic/integrations";
import { ApprovalMutationError, type AgenticRepository, type DashboardData } from "@agentic/repository";
import { createMemoryRecord } from "@agentic/memory";
import type { SelfImprovementRepository } from "@agentic/self-improvement-memory";
import { AGENTIC_ACCESS_KEY_HEADER } from "../apps/web/lib/auth";
import { GET as integrationsRouteGet, POST as integrationsRoutePost } from "../apps/web/app/api/integrations/route";
import { POST as approvalResponseRoute } from "../apps/web/app/api/approvals/[id]/respond/route";
import { PATCH as commitmentUpdateRoute } from "../apps/web/app/api/commitments/[id]/route";
import { GET as governanceRouteGet, POST as governanceRoutePost } from "../apps/web/app/api/governance/route";
import { GET as governanceAuditRouteGet } from "../apps/web/app/api/governance/audit/route";
import { PATCH as memoryUpdateRoute } from "../apps/web/app/api/memory/[id]/route";
import { PATCH as watcherUpdateRoute } from "../apps/web/app/api/watchers/[id]/route";
import { GET as workspacesRouteGet, POST as workspacesRoutePost } from "../apps/web/app/api/workspaces/route";

function buildAutopilotSettings() {
  return {
    userId: SYSTEM_USER_ID,
    mode: "notify_only" as const,
    debounceMinutes: 15,
    createdAt: "2024-01-01T00:00:00.000Z",
    updatedAt: "2024-01-01T00:00:00.000Z"
  };
}

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

function buildAuthorizedPatchRequest(url: string, body: unknown): Request {
  return new Request(url, {
    method: "PATCH",
    headers: {
      "content-type": "application/json",
      [AGENTIC_ACCESS_KEY_HEADER]: "test-access-key"
    },
    body: JSON.stringify(body)
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
      throw new Error("respondToApproval was not stubbed.");
    },
    getGoalBundle: async () => null,
    getGoalBundleForUser: async () => null,
    listGoals: async () => [],
    listApprovals: async () => [],
    listEvidenceRecords: async () => [],
    listCommitments: async () => [],
    listCommitmentInbox: async () => ({
      bucket: "unresolved",
      items: [],
      counts: {
        all: 0,
        unresolved: 0,
        urgent: 0,
        due_soon: 0,
        waiting_on_others: 0,
        low_confidence: 0,
        completed: 0
      },
      totalCount: 0,
      limit: 8,
      nextCursor: null,
      generatedAt: "2024-01-01T00:00:00.000Z"
    }),
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
      throw new Error("claimAutopilotEvent was not stubbed.");
    },
    saveAutopilotEvent: async (event) => event,
    listMemory: async () => [],
    saveMemory: async (record) => record,
    saveEvidenceRecord: async (record) => record,
    listWatchers: async () => [],
    saveWatcher: async (watcher) => watcher,
    listIntegrations: async () => [],
    upsertIntegration: async (account) => account,
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

describe("route user scoping", () => {
  const originalAccessKey = process.env.AGENTIC_ACCESS_KEY;

  function buildFakeSelfImprovementRepository(onAppendEpisode?: (episodeId: string) => void): SelfImprovementRepository {
    return {
      baseDir: "/tmp/agentic-self-improvement-test",
      seed: async () => {},
      readSemanticPatterns: async () => ({ version: 1, patterns: {} }),
      getSemanticPattern: async () => null,
      upsertSemanticPattern: async (pattern) => pattern,
      appendEpisode: async (episode) => {
        onAppendEpisode?.(episode.id);
        return episode;
      },
      getEpisode: async () => null,
      listEpisodes: async () => [],
      readWorkingMemory: async () => ({
        currentSession: null,
        lastError: null,
        sessionEnd: null
      }),
      writeCurrentSession: async (session) => session,
      writeLastError: async (error) => error,
      writeSessionEnd: async (snapshot) => snapshot,
      clearWorkingMemory: async () => {}
    };
  }

  beforeEach(() => {
    process.env.AGENTIC_ACCESS_KEY = "test-access-key";
    Reflect.set(globalThis, "__agenticRepository", undefined);
    Reflect.set(globalThis, "__agenticSelfImprovementRepository", undefined);
  });

  afterEach(() => {
    process.env.AGENTIC_ACCESS_KEY = originalAccessKey;
    Reflect.set(globalThis, "__agenticRepository", undefined);
    Reflect.set(globalThis, "__agenticSelfImprovementRepository", undefined);
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
    const listPayload = await listResponse.json();
    const updatePayload = await updateResponse.json();

    expect(listResponse.status).toBe(200);
    expect(updateResponse.status).toBe(200);
    expect(listIntegrationsCalls).toEqual([SYSTEM_USER_ID, SYSTEM_USER_ID]);
    expect(dashboardCalls).toEqual([SYSTEM_USER_ID]);
    expect(updatedStatuses).toEqual(["disabled"]);
    expect(listPayload.integrations).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: integration.id,
          readiness: expect.objectContaining({
            tier: "draft-grade"
          })
        })
      ])
    );
    expect(updatePayload.integration).toEqual(
      expect.objectContaining({
        id: integration.id,
        readiness: expect.objectContaining({
          tier: "experimental"
        })
      })
    );
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
    const approvalCalls: Array<string | undefined> = [];
    const dashboardCalls: Array<string | undefined> = [];
    const resolvedDecisions: string[] = [];
    const resolvedScopes: Array<string | undefined> = [];
    const resolvedRationales: Array<string | null | undefined> = [];
    const savedMemories: string[] = [];
    const savedMemoryIds: string[] = [];
    const savedEvidence: EvidenceRecord[] = [];
    const appendedEpisodes: string[] = [];

    expect(approval).toBeDefined();

    Reflect.set(globalThis, "__agenticSelfImprovementRepository", buildFakeSelfImprovementRepository((episodeId) => {
      appendedEpisodes.push(episodeId);
    }));

    Reflect.set(
      globalThis,
      "__agenticRepository",
      createFakeRepository({
        respondToApproval: async ({ userId, decision, scope, rationale }) => {
          approvalCalls.push(userId);
          resolvedDecisions.push(decision);
          resolvedScopes.push(scope);
          resolvedRationales.push(rationale);
          return {
            ...bundle,
            approvals: bundle.approvals.map((candidate) =>
              candidate.id === approval.id
                ? {
                    ...candidate,
                    decision,
                    decisionScope: scope ?? null,
                    decisionRationale: rationale ?? null,
                    history: [
                      ...candidate.history,
                      {
                        decision,
                        scope: scope ?? "once",
                        rationale: rationale ?? null,
                        actor: SYSTEM_USER_ID,
                        createdAt: "2024-01-01T00:00:00.000Z"
                      }
                    ],
                    respondedAt: "2024-01-01T00:00:00.000Z"
                  }
                : candidate
            )
          };
        },
        listEvidenceRecords: async () => [
          {
            id: "evidence-approval-1",
            userId: SYSTEM_USER_ID,
            goalId: bundle.goal.id,
            taskId: approval.taskId,
            approvalId: approval.id,
            sourceKind: "approval_response",
            sourceId: approval.id,
            sourceSummary: `Approved "${approval.title}".`,
            riskClass: approval.riskClass,
            requestedAction: approval.requestedAction,
            requestRationale: approval.rationale,
            requiresApproval: true,
            decision: "approved",
            decisionScope: "similar_24h",
            decisionRationale: "This pattern is safe for similar outbound replies.",
            respondedAt: "2024-01-01T00:00:00.000Z",
            resultingTaskState: "completed",
            resultingGoalStatus: "completed",
            actionLogIds: [],
            artifactIds: [],
            memoryIds: [],
            createdAt: "2024-01-01T00:00:00.000Z",
            updatedAt: "2024-01-01T00:00:00.000Z"
          }
        ],
        getDashboardData: async (userId) => {
          dashboardCalls.push(userId);
          return buildDashboardData();
        },
        saveMemory: async (record) => {
          savedMemories.push(record.content);
          savedMemoryIds.push(record.id);
          return record;
        },
        saveEvidenceRecord: async (record) => {
          savedEvidence.push(record);
          return record;
        }
      })
    );

    const response = await approvalResponseRoute(
      buildAuthorizedJsonRequest(`http://localhost/api/approvals/${approval.id}/respond`, {
        decision: "approved",
        scope: "similar_24h",
        rationale: "This pattern is safe for similar outbound replies."
      }),
      {
        params: Promise.resolve({ id: approval.id })
      }
    );

    expect(response.status).toBe(200);
    expect(approvalCalls).toEqual([SYSTEM_USER_ID]);
    expect(dashboardCalls).toEqual([SYSTEM_USER_ID]);
    expect(resolvedDecisions).toEqual(["approved"]);
    expect(resolvedScopes).toEqual(["similar_24h"]);
    expect(resolvedRationales).toEqual(["This pattern is safe for similar outbound replies."]);
    expect(savedMemories.length).toBeGreaterThan(0);
    expect(appendedEpisodes.length).toBeGreaterThan(0);
    expect(savedEvidence).toHaveLength(1);
    expect(savedEvidence[0]).toMatchObject({
      approvalId: approval.id,
      memoryIds: expect.arrayContaining(savedMemoryIds)
    });
    expect(savedEvidence[0]?.actionLogIds.length ?? 0).toBeGreaterThan(0);
  });

  it("returns 409 when another client already handled the approval", async () => {
    Reflect.set(
      globalThis,
      "__agenticRepository",
      createFakeRepository({
        respondToApproval: async () => {
          throw new ApprovalMutationError("already_handled", "Approval approval-race has already been handled.");
        }
      })
    );

    const response = await approvalResponseRoute(
      buildAuthorizedJsonRequest("http://localhost/api/approvals/approval-race/respond", {
        decision: "approved"
      }),
      {
        params: Promise.resolve({ id: "approval-race" })
      }
    );
    const payload = (await response.json()) as { error?: string };

    expect(response.status).toBe(409);
    expect(payload.error).toContain("already been handled");
  });

  it("passes the system user explicitly when updating memories", async () => {
    const memory = createMemoryRecord({
      userId: SYSTEM_USER_ID,
      category: "preferences",
      memoryType: "observed",
      content: "Prefers concise follow-ups.",
      confidence: 0.68,
      source: "test-suite"
    });
    const listMemoryCalls: Array<string | undefined> = [];
    const dashboardCalls: Array<string | undefined> = [];
    const savedMemories: Array<{ id: string; memoryType: string; confidence: number }> = [];

    Reflect.set(
      globalThis,
      "__agenticRepository",
      createFakeRepository({
        listMemory: async (userId) => {
          listMemoryCalls.push(userId);
          return [memory];
        },
        saveMemory: async (record) => {
          savedMemories.push({
            id: record.id,
            memoryType: record.memoryType,
            confidence: record.confidence
          });
          return record;
        },
        getDashboardData: async (userId) => {
          dashboardCalls.push(userId);
          return buildDashboardData();
        }
      })
    );

    const response = await memoryUpdateRoute(
      buildAuthorizedPatchRequest(`http://localhost/api/memory/${memory.id}`, {
        action: "confirm"
      }),
      {
        params: Promise.resolve({ id: memory.id })
      }
    );

    expect(response.status).toBe(200);
    expect(listMemoryCalls).toEqual([SYSTEM_USER_ID]);
    expect(dashboardCalls).toEqual([SYSTEM_USER_ID]);
    expect(savedMemories).toEqual([
      {
        id: memory.id,
        memoryType: "confirmed",
        confidence: 0.92
      }
    ]);
  });

  it("passes the system user explicitly when updating watchers", async () => {
    const watcher = WatcherSchema.parse({
      id: "watcher-1",
      goalId: "goal-1",
      targetEntity: "priority inbox",
      condition: "vip mail arrives",
      frequency: "hourly",
      triggerAction: "notify me",
      sourceSystems: ["email"],
      status: "active",
      expiryAt: null,
      createdAt: "2024-01-01T00:00:00.000Z",
      updatedAt: "2024-01-01T00:00:00.000Z"
    });
    const listWatcherCalls: Array<string | undefined> = [];
    const dashboardCalls: Array<string | undefined> = [];
    const savedStatuses: string[] = [];

    Reflect.set(
      globalThis,
      "__agenticRepository",
      createFakeRepository({
        listWatchers: async (filters) => {
          listWatcherCalls.push(filters?.userId);
          return [watcher];
        },
        saveWatcher: async (candidate) => {
          savedStatuses.push(candidate.status);
          return candidate;
        },
        getDashboardData: async (userId) => {
          dashboardCalls.push(userId);
          return buildDashboardData();
        }
      })
    );

    const response = await watcherUpdateRoute(
      buildAuthorizedPatchRequest(`http://localhost/api/watchers/${watcher.id}`, {
        action: "pause"
      }),
      {
        params: Promise.resolve({ id: watcher.id })
      }
    );

    expect(response.status).toBe(200);
    expect(listWatcherCalls).toEqual([SYSTEM_USER_ID]);
    expect(dashboardCalls).toEqual([SYSTEM_USER_ID]);
    expect(savedStatuses).toEqual(["paused"]);
  });

  it("passes the system user explicitly when updating commitments", async () => {
    const commitment = {
      id: "commitment-goal-1",
      userId: SYSTEM_USER_ID,
      title: "Close the goal loop",
      summary: "1 approval waiting",
      status: "pending" as const,
      sourceKind: "goal" as const,
      sourceId: "goal-1",
      goalId: "goal-1",
      approvalId: null,
      dueAt: null,
      confidence: 0.91,
      evidence: [
        {
          section: "goals" as const,
          itemId: "goal-1",
          label: "Close the goal loop"
        }
      ],
      createdAt: "2024-01-01T00:00:00.000Z",
      updatedAt: "2024-01-01T00:00:00.000Z"
    };
    const commitmentCalls: Array<{ id: string; userId: string | undefined }> = [];
    const dashboardCalls: Array<string | undefined> = [];
    const savedStatuses: string[] = [];
    const deletedCalls: Array<{ id: string; userId: string | undefined }> = [];

    Reflect.set(
      globalThis,
      "__agenticRepository",
      createFakeRepository({
        getCommitment: async (id, userId) => {
          commitmentCalls.push({ id, userId });
          return commitment;
        },
        saveCommitment: async (candidate) => {
          savedStatuses.push(candidate.status);
          return candidate;
        },
        deleteCommitment: async (id, userId) => {
          deletedCalls.push({ id, userId });
        },
        getDashboardData: async (userId) => {
          dashboardCalls.push(userId);
          return buildDashboardData();
        }
      })
    );

    const completeResponse = await commitmentUpdateRoute(
      buildAuthorizedPatchRequest(`http://localhost/api/commitments/${commitment.id}`, {
        action: "complete"
      }),
      {
        params: Promise.resolve({ id: commitment.id })
      }
    );
    const reopenResponse = await commitmentUpdateRoute(
      buildAuthorizedPatchRequest(`http://localhost/api/commitments/${commitment.id}`, {
        action: "reopen"
      }),
      {
        params: Promise.resolve({ id: commitment.id })
      }
    );

    expect(completeResponse.status).toBe(200);
    expect(reopenResponse.status).toBe(200);
    expect(commitmentCalls).toEqual([
      { id: commitment.id, userId: SYSTEM_USER_ID },
      { id: commitment.id, userId: SYSTEM_USER_ID }
    ]);
    expect(savedStatuses).toEqual(["completed"]);
    expect(deletedCalls).toEqual([{ id: commitment.id, userId: SYSTEM_USER_ID }]);
    expect(dashboardCalls).toEqual([SYSTEM_USER_ID, SYSTEM_USER_ID]);
  });

  it("passes the system user explicitly when listing and mutating workspaces", async () => {
    const workspaceCalls: Array<string | undefined> = [];
    const selectionCalls: Array<string | undefined> = [];
    const memberCalls: Array<string | undefined> = [];
    const governanceCalls: Array<string | undefined> = [];
    const savedWorkspaceActors: Array<string | undefined> = [];
    const savedMemberActors: Array<string | undefined> = [];
    const dashboardCalls: Array<string | undefined> = [];

    Reflect.set(
      globalThis,
      "__agenticRepository",
      createFakeRepository({
        listWorkspaces: async (userId) => {
          workspaceCalls.push(userId);
          return buildDashboardData().workspaces;
        },
        getWorkspaceSelection: async (userId) => {
          selectionCalls.push(userId);
          return buildDashboardData().workspaceSelection;
        },
        listWorkspaceMembers: async (_workspaceId, userId) => {
          memberCalls.push(userId);
          return buildDashboardData().workspaceMembers;
        },
        getWorkspaceGovernance: async (_workspaceId, userId) => {
          governanceCalls.push(userId);
          return buildDashboardData().workspaceGovernance;
        },
        saveWorkspace: async (workspace, actorUserId) => {
          savedWorkspaceActors.push(actorUserId);
          return workspace;
        },
        saveWorkspaceMember: async (member, actorUserId) => {
          savedMemberActors.push(actorUserId);
          return member;
        },
        getDashboardData: async (userId) => {
          dashboardCalls.push(userId);
          return buildDashboardData();
        }
      })
    );

    const listResponse = await workspacesRouteGet(buildAuthorizedGetRequest("http://localhost/api/workspaces"));
    const createResponse = await workspacesRoutePost(
      buildAuthorizedJsonRequest("http://localhost/api/workspaces", {
        action: "create",
        name: "Shared Planning"
      })
    );

    expect(listResponse.status).toBe(200);
    expect(createResponse.status).toBe(200);
    expect(workspaceCalls).toEqual([]);
    expect(selectionCalls).toEqual([]);
    expect(memberCalls).toEqual([]);
    expect(governanceCalls).toEqual([]);
    expect(savedWorkspaceActors).toEqual([SYSTEM_USER_ID]);
    expect(savedMemberActors).toEqual([SYSTEM_USER_ID]);
    expect(dashboardCalls).toEqual([SYSTEM_USER_ID, SYSTEM_USER_ID]);
  });

  it("passes the system user explicitly when updating governance and exporting audits", async () => {
    const governanceCalls: Array<string | undefined> = [];
    const savedGovernanceActors: Array<string | undefined> = [];
    const auditCalls: Array<{ workspaceId: string; userId: string | undefined }> = [];
    const dashboardCalls: Array<string | undefined> = [];

    Reflect.set(
      globalThis,
      "__agenticRepository",
      createFakeRepository({
        getWorkspaceGovernance: async (_workspaceId, userId) => {
          governanceCalls.push(userId);
          return buildDashboardData().workspaceGovernance;
        },
        saveWorkspaceGovernance: async (governance, actorUserId) => {
          savedGovernanceActors.push(actorUserId);
          return governance;
        },
        exportWorkspaceAudit: async (workspaceId, userId) => {
          auditCalls.push({ workspaceId, userId });
          return {
            workspaceId,
            fileName: `${workspaceId}-audit.json`,
            contentType: "application/json",
            content: JSON.stringify({ workspaceId, exportedBy: userId }),
            generatedAt: "2024-01-01T00:00:00.000Z"
          };
        },
        getDashboardData: async (userId) => {
          dashboardCalls.push(userId);
          return buildDashboardData();
        }
      })
    );

    const getResponse = await governanceRouteGet(buildAuthorizedGetRequest("http://localhost/api/governance"));
    const postResponse = await governanceRoutePost(
      buildAuthorizedJsonRequest("http://localhost/api/governance", {
        approvalMode: "always_review",
        retentionDays: 90
      })
    );
    const auditResponse = await governanceAuditRouteGet(buildAuthorizedGetRequest("http://localhost/api/governance/audit"));

    expect(getResponse.status).toBe(200);
    expect(postResponse.status).toBe(200);
    expect(auditResponse.status).toBe(200);
    expect(governanceCalls).toEqual([SYSTEM_USER_ID]);
    expect(savedGovernanceActors).toEqual([SYSTEM_USER_ID]);
    expect(dashboardCalls).toEqual([SYSTEM_USER_ID, SYSTEM_USER_ID, SYSTEM_USER_ID, SYSTEM_USER_ID]);
    expect(auditCalls).toEqual([
      {
        workspaceId: buildDashboardData().activeWorkspace!.id,
        userId: SYSTEM_USER_ID
      }
    ]);
  });
});
