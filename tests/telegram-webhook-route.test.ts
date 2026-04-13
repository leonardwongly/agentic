import { SYSTEM_USER_ID, briefingTypeValues, createHumanActorContext, type ActorContext } from "@agentic/contracts";
import { ApprovalMutationError, type AgenticRepository } from "@agentic/repository";
import { vi } from "vitest";
import { createTelegramApprovalActions, resetTelegramApprovalActionStoreForTests } from "../apps/web/lib/telegram-approvals";

function buildAutopilotSettings() {
  return {
    userId: SYSTEM_USER_ID,
    mode: "notify_only" as const,
    debounceMinutes: 15,
    createdAt: "2024-01-01T00:00:00.000Z",
    updatedAt: "2024-01-01T00:00:00.000Z"
  };
}

const { answerTelegramCallbackQueryMock, updateTelegramMessageMock } = vi.hoisted(() => ({
  answerTelegramCallbackQueryMock: vi.fn(async () => ({ ok: true })),
  updateTelegramMessageMock: vi.fn(async () => ({ ok: true }))
}));

vi.mock("@agentic/integrations", () => ({
  answerTelegramCallbackQuery: answerTelegramCallbackQueryMock,
  updateTelegramMessage: updateTelegramMessageMock,
  verifyTelegramWebhookSecret: (candidate: string) => candidate === "telegram-secret",
  isGmailReady: () => false,
  isCalendarReady: () => false,
  createDraft: vi.fn(),
  sendDraft: vi.fn(),
  listRecentEmails: vi.fn(),
  createEvent: vi.fn(),
  updateEvent: vi.fn(),
  listUpcomingEvents: vi.fn(),
  createLocalNote: vi.fn()
}));

vi.mock("../apps/web/lib/server", () => ({
  getSeededRepository: async () => Reflect.get(globalThis, "__agenticRepository") as AgenticRepository,
  getSeededSelfImprovementRepository: async () => ({
    appendEpisode: async () => undefined
  })
}));

import { POST as telegramWebhookRoute } from "../apps/web/app/api/telegram/webhook/route";

function buildTelegramRequest(callbackData: string, telegramUserId = "123", chatId = "-100123456"): Request {
  return new Request("http://localhost/api/telegram/webhook", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-telegram-bot-api-secret-token": "telegram-secret"
    },
    body: JSON.stringify({
      update_id: 1,
      callback_query: {
        id: "callback-1",
        from: { id: telegramUserId },
        data: callbackData,
        message: {
          message_id: 77,
          chat: {
            id: chatId
          }
        }
      }
    })
  });
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
      throw new Error("respondToApproval was not stubbed.");
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
      createdAt: timestamp,
      updatedAt: timestamp
    }),
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
        createdAt: timestamp,
        updatedAt: timestamp
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
        status: "healthy" as const,
        totalCount: 0,
        generatedAt: timestamp,
        items: []
      }
    }),
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

describe("telegram webhook route", () => {
  beforeEach(() => {
    process.env.TELEGRAM_WEBHOOK_SECRET = "telegram-secret";
    process.env.TELEGRAM_USER_MAP = "123:user-telegram";
    delete process.env.DATABASE_URL;
    Reflect.set(globalThis, "__agenticRepository", undefined);
    resetTelegramApprovalActionStoreForTests();
    answerTelegramCallbackQueryMock.mockClear();
    updateTelegramMessageMock.mockClear();
  });

  afterEach(() => {
    delete process.env.TELEGRAM_WEBHOOK_SECRET;
    delete process.env.TELEGRAM_USER_MAP;
    delete process.env.DATABASE_URL;
    Reflect.set(globalThis, "__agenticRepository", undefined);
    resetTelegramApprovalActionStoreForTests();
  });

  it("binds approve actions to the mapped Telegram actor", async () => {
    const actions = await createTelegramApprovalActions({
      approvalId: "approval-safe",
      goalId: "goal-1",
      workspaceId: "workspace-personal-system-user",
      expiresAt: "2099-01-01T00:00:00.000Z"
    });
    const approvalCalls: Array<{
      approvalId: string;
      decision: string;
      actor: ActorContext;
      scope?: string;
      rationale?: string | null;
    }> = [];

    Reflect.set(
      globalThis,
      "__agenticRepository",
      createFakeRepository({
        getGoalBundleForUser: async (goalId, userId) =>
          goalId === "goal-1" && userId === "user-telegram"
            ? {
                goal: {
                  id: "goal-1",
                  userId,
                  request: "Review my inbox",
                  title: "Review inbox",
                  explanation: "Review inbox and draft responses.",
                  intent: "communications-triage",
                  status: "running",
                  workspaceId: "workspace-personal-system-user",
                  workflowId: "workflow-1",
                  confidence: 0.84,
                  createdAt: "2024-01-01T00:00:00.000Z",
                  updatedAt: "2024-01-01T00:00:00.000Z"
                },
                workflow: {
                  id: "workflow-1",
                  goalId: "goal-1",
                  workspaceId: "workspace-personal-system-user",
                  status: "running",
                  currentStep: "Awaiting approval",
                  checkpoint: "approval-gate",
                  createdAt: "2024-01-01T00:00:00.000Z",
                  updatedAt: "2024-01-01T00:00:00.000Z"
                },
                tasks: [
                  {
                    id: "task-1",
                    goalId: "goal-1",
                    workflowId: "workflow-1",
                    title: "Draft reply",
                    summary: "Prepare an external response.",
                    assignedAgent: "communications",
                    state: "waiting",
                    priority: "P1",
                    riskClass: "R3",
                    needsApproval: true,
                    requiresApproval: true,
                    toolCapabilities: ["send"],
                    dependsOn: [],
                    artifactIds: [],
                    createdAt: "2024-01-01T00:00:00.000Z",
                    updatedAt: "2024-01-01T00:00:00.000Z"
                  }
                ],
                approvals: [
                  {
                    id: "approval-safe",
                    goalId: "goal-1",
                    taskId: "task-1",
                    title: "Send reply",
                    rationale: "External email send.",
                    riskClass: "R3",
                    decision: "pending",
                    requestedAction: "Send the drafted reply",
                    preview: {
                      actionType: "send",
                      target: "customer@example.com",
                      summary: "Send the drafted reply to the customer.",
                      changes: [],
                      impact: {
                        affectedPeople: ["customer@example.com"],
                        affectedSystems: ["email"],
                        permissions: ["send"],
                        rollback: "manual"
                      }
                    },
                    decisionScope: null,
                    decisionRationale: null,
                    history: [],
                    createdAt: "2024-01-01T00:00:00.000Z",
                    expiryAt: "2099-01-01T00:00:00.000Z",
                    respondedAt: null
                  }
                ],
                artifacts: [],
                memories: [],
                watchers: [],
                actionLogs: []
              }
            : null,
        respondToApproval: async (input) => {
          approvalCalls.push({
            approvalId: input.approvalId,
            decision: input.decision,
            actor: input.actor,
            scope: input.scope,
            rationale: input.rationale
          });
          return {
            goal: {
              id: "goal-1",
              userId: input.actor.subjectUserId,
              request: "Review my inbox",
              title: "Review inbox",
              explanation: "Review inbox and draft responses.",
              intent: "communications-triage",
              status: "running",
              createdAt: "2024-01-01T00:00:00.000Z",
              updatedAt: "2024-01-01T00:00:00.000Z"
            },
            workflow: {
              id: "workflow-1",
              goalId: "goal-1",
              status: "running",
              checkpoint: "approval-gate",
              summary: "Waiting on approval.",
              createdAt: "2024-01-01T00:00:00.000Z",
              updatedAt: "2024-01-01T00:00:00.000Z"
            },
            tasks: [
              {
                id: "task-1",
                goalId: "goal-1",
                title: "Draft reply",
                summary: "Prepare an external response.",
                state: "completed",
                priority: "P1",
                needsApproval: true,
                createdAt: "2024-01-01T00:00:00.000Z",
                updatedAt: "2024-01-01T00:00:00.000Z"
              }
            ],
            approvals: [
              {
                id: input.approvalId,
                goalId: "goal-1",
                taskId: "task-1",
                title: "Send reply",
                rationale: "External email send.",
                riskClass: "R3",
                decision: input.decision,
                requestedAction: "Send the drafted reply",
                preview: {},
                decisionScope: input.scope ?? null,
                decisionRationale: input.rationale ?? null,
                history: [
                  {
                    decision: input.decision,
                    scope: input.scope ?? "once",
                    rationale: input.rationale ?? null,
                    actor: input.actor.executor.userId ?? input.actor.executor.label,
                    actorContext: input.actor,
                    createdAt: "2024-01-01T00:00:00.000Z"
                  }
                ],
                createdAt: "2024-01-01T00:00:00.000Z",
                expiryAt: null,
                respondedAt: "2024-01-01T00:00:00.000Z"
              }
            ],
            artifacts: [],
            memories: [],
            watchers: [],
            actionLogs: []
          };
        },
        saveGoalBundle: async (bundle) => bundle
      })
    );

    const response = await telegramWebhookRoute(buildTelegramRequest(actions.approveActionId));
    const payload = (await response.json()) as { ok?: boolean };

    expect(response.status).toBe(200);
    expect(payload.ok).toBe(true);
    expect(approvalCalls).toEqual([
      {
        approvalId: "approval-safe",
        decision: "approved",
        actor: createHumanActorContext("user-telegram"),
        scope: "once",
        rationale: null
      }
    ]);
    expect(answerTelegramCallbackQueryMock).toHaveBeenCalledWith({
      callbackQueryId: "callback-1",
      text: "Approval recorded.",
      showAlert: false
    });
    expect(updateTelegramMessageMock).toHaveBeenCalledWith({
      chatId: "-100123456",
      messageId: 77,
      text: "\u2705 Approved: Draft reply"
    });
  });

  it("rejects approvals from unmapped Telegram actors", async () => {
    const actions = await createTelegramApprovalActions({
      approvalId: "approval-safe",
      goalId: "goal-1",
      workspaceId: "workspace-personal-system-user",
      expiresAt: "2099-01-01T00:00:00.000Z"
    });

    Reflect.set(globalThis, "__agenticRepository", createFakeRepository({}));

    const response = await telegramWebhookRoute(buildTelegramRequest(actions.approveActionId, "999"));
    const payload = (await response.json()) as { ok?: boolean; skipped?: boolean; reason?: string };

    expect(response.status).toBe(200);
    expect(payload).toEqual({
      ok: true,
      skipped: true,
      reason: "unauthorized_actor"
    });
    expect(answerTelegramCallbackQueryMock).toHaveBeenCalledWith({
      callbackQueryId: "callback-1",
      text: "You are not authorized for this approval.",
      showAlert: true
    });
  });

  it("acknowledges already handled Telegram actions without retry loops", async () => {
    const actions = await createTelegramApprovalActions({
      approvalId: "approval-safe",
      goalId: "goal-1",
      workspaceId: "workspace-personal-system-user",
      expiresAt: "2099-01-01T00:00:00.000Z"
    });

    Reflect.set(
      globalThis,
      "__agenticRepository",
      createFakeRepository({
        getGoalBundleForUser: async () => ({
          goal: {
            id: "goal-1",
            userId: "user-telegram",
            request: "Review my inbox",
            title: "Review inbox",
            explanation: "Review inbox and draft responses.",
            intent: "communications-triage",
            status: "running",
            workspaceId: "workspace-personal-system-user",
            workflowId: "workflow-1",
            confidence: 0.84,
            createdAt: "2024-01-01T00:00:00.000Z",
            updatedAt: "2024-01-01T00:00:00.000Z"
          },
          workflow: {
            id: "workflow-1",
            goalId: "goal-1",
            workspaceId: "workspace-personal-system-user",
            status: "running",
            currentStep: "Awaiting approval",
            checkpoint: "approval-gate",
            createdAt: "2024-01-01T00:00:00.000Z",
            updatedAt: "2024-01-01T00:00:00.000Z"
          },
          tasks: [
            {
              id: "task-1",
              goalId: "goal-1",
              workflowId: "workflow-1",
              title: "Draft reply",
              summary: "Prepare an external response.",
              assignedAgent: "communications",
              state: "waiting",
              priority: "P1",
              riskClass: "R3",
              needsApproval: true,
              requiresApproval: true,
              toolCapabilities: ["send"],
              dependsOn: [],
              artifactIds: [],
              createdAt: "2024-01-01T00:00:00.000Z",
              updatedAt: "2024-01-01T00:00:00.000Z"
            }
          ],
          approvals: [
            {
              id: "approval-safe",
              goalId: "goal-1",
              taskId: "task-1",
              title: "Send reply",
              rationale: "External email send.",
              riskClass: "R3",
              decision: "pending",
              requestedAction: "Send the drafted reply",
              preview: {},
              decisionScope: null,
              decisionRationale: null,
              history: [],
              createdAt: "2024-01-01T00:00:00.000Z",
              expiryAt: "2099-01-01T00:00:00.000Z",
              respondedAt: null
            }
          ],
          artifacts: [],
          memories: [],
          watchers: [],
          actionLogs: []
        }),
        respondToApproval: async () => {
          throw new ApprovalMutationError("already_handled", "Approval approval-safe has already been handled.");
        }
      })
    );

    const response = await telegramWebhookRoute(buildTelegramRequest(actions.approveActionId));
    const payload = (await response.json()) as { ok?: boolean; skipped?: boolean; reason?: string };

    expect(response.status).toBe(200);
    expect(payload).toEqual({
      ok: true,
      skipped: true,
      reason: "already_handled"
    });
    expect(answerTelegramCallbackQueryMock).toHaveBeenCalledWith({
      callbackQueryId: "callback-1",
      text: "This approval was already handled.",
      showAlert: false
    });
  });
});
