import {
  DEFAULT_AUTOPILOT_RELIABILITY_CONTROLS,
  SYSTEM_USER_ID,
  briefingTypeValues,
  createHumanActorContext,
  nowIso,
  type ActorContext,
  type JobKind,
  type JobRecord,
  type JobStatus
} from "@agentic/contracts";
import { ApprovalMutationError, type AgenticRepository } from "@agentic/repository";
import { vi } from "vitest";
import { buildSlackApprovalToken } from "../apps/web/lib/slack-approvals";
import { expectOperationalNoStoreHeaders } from "./route-test-helpers";

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

const { verifySlackSignatureMock, updateMessageMock } = vi.hoisted(() => ({
  verifySlackSignatureMock: vi.fn(() => true),
  updateMessageMock: vi.fn(async () => undefined)
}));

vi.mock("@agentic/integrations", async () => {
  const actual = await vi.importActual<typeof import("@agentic/integrations")>("@agentic/integrations");

  return {
    ...actual,
    verifySlackSignature: verifySlackSignatureMock,
    updateMessage: updateMessageMock,
    isGmailReady: () => false,
    isCalendarReady: () => false,
    createDraft: vi.fn(),
    sendDraft: vi.fn(),
    listRecentEmails: vi.fn(),
    createEvent: vi.fn(),
    updateEvent: vi.fn(),
    listUpcomingEvents: vi.fn(),
    createLocalNote: vi.fn()
  };
});

vi.mock("../apps/web/lib/server", () => ({
  getSeededRepository: async () => Reflect.get(globalThis, "__agenticRepository") as AgenticRepository,
  getSeededSelfImprovementRepository: async () => ({
    appendEpisode: async () => undefined
  })
}));

import { POST as slackWebhookRoute } from "../apps/web/app/api/slack/webhook/route";

function createFakeJobStore() {
  const jobs = new Map<string, JobRecord>();

  const filterJobs = (params?: {
    userId?: string;
    kinds?: JobKind[];
    statuses?: JobStatus[];
  }) =>
    Array.from(jobs.values()).filter((job) => {
      if (params?.userId && job.userId !== params.userId) {
        return false;
      }

      if (params?.kinds?.length && !params.kinds.includes(job.kind)) {
        return false;
      }

      if (params?.statuses?.length && !params.statuses.includes(job.status)) {
        return false;
      }

      return true;
    });

  const getOwnedJob = (jobId: string, userId?: string) => {
    const job = jobs.get(jobId) ?? null;

    if (!job) {
      return null;
    }

    if (userId && job.userId !== userId) {
      return null;
    }

    return job;
  };

  return {
    async listJobs(params?: {
      userId?: string;
      kinds?: JobKind[];
      statuses?: JobStatus[];
    }) {
      return filterJobs(params);
    },
    async getJob(jobId: string, userId = SYSTEM_USER_ID) {
      return getOwnedJob(jobId, userId);
    },
    async enqueueJob(job: JobRecord) {
      if (job.idempotencyKey) {
        const existing = filterJobs({ userId: job.userId }).find(
          (candidate) => candidate.idempotencyKey === job.idempotencyKey
        );

        if (existing) {
          return existing;
        }
      }

      jobs.set(job.id, job);
      return job;
    },
    async claimNextJob(params: {
      userId?: string;
      kinds?: JobKind[];
      runnerId: string;
      leaseMs: number;
      now?: string;
    }) {
      const now = params.now ?? nowIso();
      const candidate = filterJobs({
        userId: params.userId ?? SYSTEM_USER_ID,
        kinds: params.kinds,
        statuses: ["queued", "retrying"]
      })
        .filter((job) => job.availableAt <= now)
        .sort((left, right) => left.availableAt.localeCompare(right.availableAt))[0];

      if (!candidate) {
        return null;
      }

      const leasedUntil = new Date(Date.parse(now) + params.leaseMs).toISOString();
      const claimed = {
        ...candidate,
        status: "running" as const,
        runnerId: params.runnerId,
        attemptCount: candidate.attemptCount + 1,
        startedAt: candidate.startedAt ?? now,
        leasedUntil,
        updatedAt: now
      };

      jobs.set(claimed.id, claimed);
      return claimed;
    },
    async completeJob(params: {
      jobId: string;
      runnerId: string;
      completedAt?: string;
    }) {
      const job = getOwnedJob(params.jobId);

      if (!job) {
        throw new Error(`Job ${params.jobId} was not found.`);
      }

      const completedAt = params.completedAt ?? nowIso();
      const completed = {
        ...job,
        status: "completed" as const,
        runnerId: null,
        leasedUntil: null,
        completedAt,
        updatedAt: completedAt
      };

      jobs.set(completed.id, completed);
      return completed;
    },
    async retryJob(params: {
      jobId: string;
      runnerId: string;
      availableAt: string;
      error: string;
    }) {
      const job = getOwnedJob(params.jobId);

      if (!job) {
        throw new Error(`Job ${params.jobId} was not found.`);
      }

      const retried = {
        ...job,
        status: "retrying" as const,
        runnerId: null,
        leasedUntil: null,
        availableAt: params.availableAt,
        lastError: params.error,
        updatedAt: params.availableAt
      };

      jobs.set(retried.id, retried);
      return retried;
    },
    async deadLetterJob(params: {
      jobId: string;
      runnerId: string;
      deadLetteredAt?: string;
      error: string;
    }) {
      const job = getOwnedJob(params.jobId);

      if (!job) {
        throw new Error(`Job ${params.jobId} was not found.`);
      }

      const deadLetteredAt = params.deadLetteredAt ?? nowIso();
      const deadLettered = {
        ...job,
        status: "dead_letter" as const,
        runnerId: null,
        leasedUntil: null,
        deadLetteredAt,
        lastError: params.error,
        updatedAt: deadLetteredAt
      };

      jobs.set(deadLettered.id, deadLettered);
      return deadLettered;
    }
  };
}

function buildSlackRequest(actionId: string, actionValue: string, slackUserId = "U123") {
  const payload = {
    type: "block_actions",
    actions: [
      {
        action_id: actionId,
        value: actionValue
      }
    ],
    user: { id: slackUserId },
    channel: { id: "C123" },
    message: { ts: "1710000000.000100" }
  };
  const body = new URLSearchParams({
    payload: JSON.stringify(payload)
  }).toString();

  return new Request("http://localhost/api/slack/webhook", {
    method: "POST",
    headers: {
      "content-type": "application/x-www-form-urlencoded",
      "x-slack-signature": "v0=fake",
      "x-slack-request-timestamp": `${Math.floor(Date.now() / 1000)}`
    },
    body
  });
}

function createFakeRepository(overrides: Partial<AgenticRepository>): AgenticRepository {
  const jobStore = createFakeJobStore();
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
      throw new Error("claimAutopilotEvent was not stubbed.");
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
    reserveProviderSideEffect: async () => { throw new Error("reserveProviderSideEffect was not stubbed."); },
    updateProviderSideEffect: async () => { throw new Error("updateProviderSideEffect was not stubbed."); },
    listTemplates: async () => [],
    saveTemplate: async (template) => template,
    deleteTemplate: async () => {},
    listWorkflowTemplates: async () => [],
    getWorkflowTemplate: async () => null,
    saveWorkflowTemplate: async (template) => template,
    deleteWorkflowTemplate: async () => {},
    listJobs: jobStore.listJobs,
    getJob: jobStore.getJob,
    enqueueJob: jobStore.enqueueJob,
    claimNextJob: jobStore.claimNextJob,
    completeJob: jobStore.completeJob,
    retryJob: jobStore.retryJob,
    deadLetterJob: jobStore.deadLetterJob,
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
        status: "healthy" as const,
        totalCount: 0,
        generatedAt: "2024-01-01T00:00:00.000Z",
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

describe("slack webhook route", () => {
  beforeEach(() => {
    verifySlackSignatureMock.mockReturnValue(true);
    updateMessageMock.mockClear();
    process.env.SLACK_SIGNING_SECRET = "test-signing-secret";
    process.env.SLACK_USER_MAP = "U123:user-slack,U999:user-other";
    Reflect.set(globalThis, "__agenticRepository", undefined);
  });

  afterEach(() => {
    delete process.env.SLACK_SIGNING_SECRET;
    delete process.env.SLACK_USER_MAP;
    Reflect.set(globalThis, "__agenticRepository", undefined);
  });

  it("rejects missing Slack signature headers before consuming the request body", async () => {
    const body = new URLSearchParams({
      payload: JSON.stringify({
        type: "block_actions",
        actions: [{ action_id: "approval_approve", value: "approval-token" }],
        user: { id: "U123" }
      })
    }).toString();
    const request = new Request("http://localhost/api/slack/webhook", {
      method: "POST",
      headers: {
        "content-type": "application/x-www-form-urlencoded"
      },
      body
    });

    const response = await slackWebhookRoute(request);

    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ error: "Missing Slack signature headers." });
    expect(await request.text()).toBe(body);
    expectOperationalNoStoreHeaders(response);
  });

  it("rejects oversized Slack webhook payloads before signature verification", async () => {
    const body = new URLSearchParams({
      payload: "x".repeat(256_001)
    }).toString();
    const request = new Request("http://localhost/api/slack/webhook", {
      method: "POST",
      headers: {
        "content-type": "application/x-www-form-urlencoded",
        "x-slack-signature": "v0=fake",
        "x-slack-request-timestamp": `${Math.floor(Date.now() / 1000)}`
      },
      body
    });

    const response = await slackWebhookRoute(request);

    expect(response.status).toBe(413);
    expect(await response.json()).toEqual({ error: "Slack webhook payload is too large." });
    expect(verifySlackSignatureMock).not.toHaveBeenCalled();
    expectOperationalNoStoreHeaders(response);
  });

  it("binds approve actions to the mapped Slack actor", async () => {
    const approvalCalls: Array<{
      approvalId: string;
      decision: string;
      actor: ActorContext;
      scope?: string;
      rationale?: string | null;
    }> = [];
    const repository = createFakeRepository({
      getGoalBundleForUser: async (goalId, userId) =>
        goalId === "goal-1" && userId === "user-slack"
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
    });

    Reflect.set(globalThis, "__agenticRepository", repository);

    const response = await slackWebhookRoute(
      buildSlackRequest(
        "approval_approve",
        buildSlackApprovalToken({
          approvalId: "approval-safe",
          goalId: "goal-1",
          workspaceId: "workspace-personal-system-user",
          expiresAt: "2099-01-01T00:00:00.000Z"
        })
      )
    );
    const payload = (await response.json()) as { ok?: boolean };

    expect(response.status).toBe(200);
    expect(payload.ok).toBe(true);
    expect(approvalCalls).toEqual([
      {
        approvalId: "approval-safe",
        decision: "approved",
        actor: createHumanActorContext("user-slack"),
        scope: "once",
        rationale: null
      }
    ]);
    await expect(repository.listJobs({ userId: "user-slack" })).resolves.toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: "approval_follow_up",
          status: "queued",
          payload: expect.objectContaining({
            type: "approval_follow_up",
            approvalId: "approval-safe",
            goalId: "goal-1",
            taskId: "task-1",
            decision: "approved"
          })
        }),
        expect.objectContaining({
          kind: "approval_notification",
          status: "queued",
          actorContext: expect.objectContaining({
            subjectUserId: "user-slack"
          }),
          payload: expect.objectContaining({
            type: "approval_notification",
            approvalId: "approval-safe",
            goalId: "goal-1",
            taskId: "task-1",
            decision: "approved",
            channel: "slack_receipt",
            slackChannelId: "C123",
            slackMessageTs: "1710000000.000100"
          })
        })
      ])
    );
    expect(updateMessageMock).not.toHaveBeenCalled();
  });

  it("queues follow-up jobs with the mapped Slack actor context", async () => {
    const saveMemory = vi.fn(async (record) => record);
    const repository = createFakeRepository({
      getGoalBundleForUser: async (goalId, userId) =>
        goalId === "goal-1" && userId === "user-slack"
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
                  toolCapabilities: ["draft", "send"],
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
      respondToApproval: async (input) => ({
        goal: {
          id: "goal-1",
          userId: input.actor.subjectUserId,
          request: "Review my inbox",
          title: "Review inbox",
          explanation: "Review inbox and draft responses.",
          intent: "communications-triage",
          status: "completed",
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
          status: "completed",
          checkpoint: "done",
          summary: "Completed after rejection.",
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
            state: "completed",
            priority: "P1",
            riskClass: "R3",
            needsApproval: true,
            requiresApproval: true,
            toolCapabilities: ["draft", "send"],
            dependsOn: [],
            artifactIds: [],
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
      }),
      saveGoalBundle: async (bundle) => bundle,
      saveMemory
    });

    Reflect.set(globalThis, "__agenticRepository", repository);

    const response = await slackWebhookRoute(
      buildSlackRequest(
        "approval_reject",
        buildSlackApprovalToken({
          approvalId: "approval-safe",
          goalId: "goal-1",
          workspaceId: "workspace-personal-system-user",
          expiresAt: "2099-01-01T00:00:00.000Z"
        })
      )
    );
    const payload = (await response.json()) as { ok?: boolean };
    const queuedJobs = await repository.listJobs({ userId: "user-slack" });

    expect(response.status).toBe(200);
    expect(payload.ok).toBe(true);
    expect(saveMemory).not.toHaveBeenCalled();
    expect(queuedJobs).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: "approval_follow_up",
          status: "queued",
          actorContext: expect.objectContaining({
            subjectUserId: "user-slack"
          }),
          payload: expect.objectContaining({
            type: "approval_follow_up",
            approvalId: "approval-safe",
            goalId: "goal-1",
            taskId: "task-1",
            decision: "rejected"
          })
        }),
        expect.objectContaining({
          kind: "approval_notification",
          status: "queued",
          actorContext: expect.objectContaining({
            subjectUserId: "user-slack"
          }),
          payload: expect.objectContaining({
            type: "approval_notification",
            approvalId: "approval-safe",
            goalId: "goal-1",
            taskId: "task-1",
            decision: "rejected",
            channel: "slack_receipt",
            slackChannelId: "C123",
            slackMessageTs: "1710000000.000100"
          })
        })
      ])
    );
    expect(updateMessageMock).not.toHaveBeenCalled();
  });

  it("rejects approvals from unmapped Slack actors", async () => {
    Reflect.set(
      globalThis,
      "__agenticRepository",
      createFakeRepository({})
    );

    const response = await slackWebhookRoute(
      buildSlackRequest(
        "approval_approve",
        buildSlackApprovalToken({
          approvalId: "approval-safe",
          goalId: "goal-1",
          workspaceId: "workspace-personal-system-user",
          expiresAt: "2099-01-01T00:00:00.000Z"
        }),
        "UNMAPPED"
      )
    );
    const payload = (await response.json()) as { error?: string };

    expect(response.status).toBe(403);
    expect(payload.error).toBe("Slack actor is not authorized for approvals.");
  });

  it("rejects expired approval action tokens", async () => {
    Reflect.set(
      globalThis,
      "__agenticRepository",
      createFakeRepository({})
    );

    const response = await slackWebhookRoute(
      buildSlackRequest(
        "approval_approve",
        buildSlackApprovalToken({
          approvalId: "approval-expired",
          goalId: "goal-1",
          workspaceId: "workspace-personal-system-user",
          expiresAt: "2000-01-01T00:00:00.000Z"
        })
      )
    );
    const payload = (await response.json()) as { error?: string };

    expect(response.status).toBe(401);
    expect(payload.error).toBe("Invalid or expired approval action.");
  });

  it("acknowledges duplicate approval actions without triggering Slack retries", async () => {
    Reflect.set(
      globalThis,
      "__agenticRepository",
      createFakeRepository({
        getGoalBundleForUser: async (goalId, userId) =>
          goalId === "goal-1" && userId === "user-slack"
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
                tasks: [],
                approvals: [
                  {
                    id: "approval-race",
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
        respondToApproval: async () => {
          throw new ApprovalMutationError("already_handled", "Approval approval-race has already been handled.");
        }
      })
    );

    const response = await slackWebhookRoute(
      buildSlackRequest(
        "approval_approve",
        buildSlackApprovalToken({
          approvalId: "approval-race",
          goalId: "goal-1",
          workspaceId: "workspace-personal-system-user",
          expiresAt: "2099-01-01T00:00:00.000Z"
        })
      )
    );
    const payload = (await response.json()) as { ok?: boolean; skipped?: boolean; reason?: string };

    expect(response.status).toBe(200);
    expect(payload).toEqual({
      ok: true,
      skipped: true,
      reason: "already_handled"
    });
    expect(updateMessageMock).not.toHaveBeenCalled();
  });

  it("acknowledges forbidden shared approval actions without triggering Slack retries", async () => {
    Reflect.set(
      globalThis,
      "__agenticRepository",
      createFakeRepository({
        getGoalBundleForUser: async () => ({
          goal: {
            id: "goal-1",
            workflowId: "workflow-1",
            userId: SYSTEM_USER_ID,
            title: "Handle shared approval",
            request: "Review shared team approval.",
            status: "active",
            workspaceId: "workspace-shared-team",
            createdAt: "2024-01-01T00:00:00.000Z",
            updatedAt: "2024-01-01T00:00:00.000Z"
          },
          workflow: {
            id: "workflow-1",
            userId: SYSTEM_USER_ID,
            status: "running",
            currentStep: "approval",
            checkpoint: "approval-safe",
            createdAt: "2024-01-01T00:00:00.000Z",
            updatedAt: "2024-01-01T00:00:00.000Z"
          },
          tasks: [
            {
              id: "task-1",
              goalId: "goal-1",
              title: "Send reply",
              description: "Send the drafted reply.",
              state: "pending",
              requiresApproval: true,
              createdAt: "2024-01-01T00:00:00.000Z",
              updatedAt: "2024-01-01T00:00:00.000Z"
            }
          ],
          approvals: [
            {
              id: "approval-forbidden",
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
        }),
        respondToApproval: async () => {
          throw new ApprovalMutationError("forbidden", "Only the workspace owner can respond to shared approvals.");
        }
      })
    );

    const response = await slackWebhookRoute(
      buildSlackRequest(
        "approval_approve",
        buildSlackApprovalToken({
          approvalId: "approval-forbidden",
          goalId: "goal-1",
          workspaceId: "workspace-shared-team",
          expiresAt: "2099-01-01T00:00:00.000Z"
        })
      )
    );
    const payload = (await response.json()) as { ok?: boolean; skipped?: boolean; reason?: string };
    const repository = Reflect.get(globalThis, "__agenticRepository") as AgenticRepository;

    expect(response.status).toBe(200);
    expect(payload).toEqual({
      ok: true,
      skipped: true,
      reason: "forbidden"
    });
    await expect(repository.listJobs({ userId: "user-slack" })).resolves.toEqual([]);
    expect(updateMessageMock).not.toHaveBeenCalled();
  });
});
