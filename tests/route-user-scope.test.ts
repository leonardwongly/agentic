import type { EvidenceRecord, JobKind, JobRecord, JobStatus } from "@agentic/contracts";
import {
  DEFAULT_AUTOPILOT_RELIABILITY_CONTROLS,
  AgentDefinitionSchema,
  AgentMetricsSchema,
  DEFAULT_OWNER_USER_ID,
  WatcherSchema,
  briefingTypeValues,
  createSystemActorContext,
  nowIso,
  type ActorContext
} from "@agentic/contracts";
import { processUserRequest } from "@agentic/orchestrator";
import { buildDefaultIntegrationAccounts } from "@agentic/integrations";
import { ApprovalMutationError, type AgenticRepository, type DashboardData } from "@agentic/repository";
import { createMemoryRecord } from "@agentic/memory";
import type { SelfImprovementRepository } from "@agentic/self-improvement-memory";
import { vi } from "vitest";
import { AGENTIC_ACCESS_KEY_HEADER, AGENTIC_SESSION_COOKIE, buildSessionToken } from "../apps/web/lib/auth";
import { GET as integrationsRouteGet, POST as integrationsRoutePost } from "../apps/web/app/api/integrations/route";
import { POST as approvalResponseRoute } from "../apps/web/app/api/approvals/[id]/respond/route";
import { POST as briefingSchedulePostRoute } from "../apps/web/app/api/briefing/schedule/route";
import { PATCH as commitmentUpdateRoute } from "../apps/web/app/api/commitments/[id]/route";
import { GET as governanceRouteGet, POST as governanceRoutePost } from "../apps/web/app/api/governance/route";
import { GET as governanceAuditRouteGet } from "../apps/web/app/api/governance/audit/route";
import { PATCH as memoryUpdateRoute } from "../apps/web/app/api/memory/[id]/route";
import { POST as operatorProductsRoutePost } from "../apps/web/app/api/operator-products/route";
import { PATCH as watcherUpdateRoute } from "../apps/web/app/api/watchers/[id]/route";
import { GET as workspacesRouteGet, POST as workspacesRoutePost } from "../apps/web/app/api/workspaces/route";
import { GET as getAgentMetricsRoute } from "../apps/web/app/api/agents/[id]/metrics/route";
import { DELETE as deleteAgentRoute, GET as getAgentRoute, PUT as updateAgentRoute } from "../apps/web/app/api/agents/[id]/route";

function buildAutopilotSettings() {
  return {
    userId: DEFAULT_OWNER_USER_ID,
    mode: "notify_only" as const,
    debounceMinutes: 15,
    reliabilityControls: DEFAULT_AUTOPILOT_RELIABILITY_CONTROLS,
    actorContext: null,
    createdAt: "2024-01-01T00:00:00.000Z",
    updatedAt: "2024-01-01T00:00:00.000Z"
  };
}

function buildAuthorizedJsonRequest(url: string, body: unknown, headers?: Record<string, string>): Request {
  return new Request(url, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      [AGENTIC_ACCESS_KEY_HEADER]: "test-access-key",
      ...headers
    },
    body: JSON.stringify(body)
  });
}

function buildSessionJsonRequest(url: string, body: unknown, headers?: Record<string, string>): Request {
  return new Request(url, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      cookie: `${AGENTIC_SESSION_COOKIE}=${buildSessionToken(DEFAULT_OWNER_USER_ID)}`,
      ...headers
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

function buildAuthorizedPatchRequestWithIfMatch(url: string, updatedAt: string, body: unknown): Request {
  return new Request(url, {
    method: "PATCH",
    headers: {
      "content-type": "application/json",
      [AGENTIC_ACCESS_KEY_HEADER]: "test-access-key",
      "if-match": `"${updatedAt}"`
    },
    body: JSON.stringify(body)
  });
}

function buildDashboardData(): DashboardData {
  const timestamp = "2024-01-01T00:00:00.000Z";
  const workspace = {
    id: "workspace-personal-system-user",
    ownerUserId: DEFAULT_OWNER_USER_ID,
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
      userId: DEFAULT_OWNER_USER_ID,
      workspaceId: workspace.id,
      selectedAt: timestamp,
      updatedAt: timestamp
    },
    workspaceMembers: [
      {
        id: `workspace-member-${workspace.id}-${DEFAULT_OWNER_USER_ID}`,
        workspaceId: workspace.id,
        userId: DEFAULT_OWNER_USER_ID,
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
      shadowReplayPolicy: {
        enabled: true,
        promotionMode: "validated_autonomy",
        rollbackOutcome: "allowed_with_confirmation",
        minimumMatchedEpisodes: 3,
        minimumPrecision: 0.8,
        maximumNegativeOutcomeRate: 0.15,
        maximumFailureCostRate: 0.2
      },
      retentionDays: 365,
      updatedBy: DEFAULT_OWNER_USER_ID,
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
      userId: DEFAULT_OWNER_USER_ID,
      timezone: "UTC",
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

function buildAgentDefinition() {
  const timestamp = nowIso();

  return AgentDefinitionSchema.parse({
    id: "agent-private-ops",
    userId: DEFAULT_OWNER_USER_ID,
    name: "private-ops",
    displayName: "Private Ops",
    description: "Handles private operational workflows.",
    icon: "ops",
    category: "custom",
    tags: ["ops"],
    systemPrompt: "Review operational signals and prepare the next action plan.",
    promptVariables: [],
    artifactType: "summary",
    behaviorConfig: {
      temperature: 0.4,
      maxTokens: 1200,
      topP: 1,
      frequencyPenalty: 0,
      presencePenalty: 0,
      responseStyle: "balanced",
      formality: "professional"
    },
    allowedCapabilities: ["read", "search"],
    blockedCapabilities: [],
    maxRiskClass: "R2",
    integrationPermissions: [],
    memoryPermissions: [],
    actorContext: null,
    isBuiltIn: false,
    parentAgentId: null,
    version: 1,
    status: "active",
    createdAt: timestamp,
    updatedAt: timestamp
  });
}

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
    async getJob(jobId: string, userId = DEFAULT_OWNER_USER_ID) {
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
        userId: params.userId ?? DEFAULT_OWNER_USER_ID,
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

      if (job.runnerId && job.runnerId !== params.runnerId) {
        throw new Error(`Job ${params.jobId} is claimed by another worker.`);
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

      if (job.runnerId && job.runnerId !== params.runnerId) {
        throw new Error(`Job ${params.jobId} is claimed by another worker.`);
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

      if (job.runnerId && job.runnerId !== params.runnerId) {
        throw new Error(`Job ${params.jobId} is claimed by another worker.`);
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

function createFakeRepository(overrides: Partial<AgenticRepository>): AgenticRepository {
  const jobStore = createFakeJobStore();

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
      throw new Error("claimAutopilotEvent was not stubbed.");
    },
    saveAutopilotEvent: async (event) => event,
    listJobs: jobStore.listJobs,
    getJob: jobStore.getJob,
    enqueueJob: jobStore.enqueueJob,
    claimNextJob: jobStore.claimNextJob,
    completeJob: jobStore.completeJob,
    retryJob: jobStore.retryJob,
    deadLetterJob: jobStore.deadLetterJob,
    listMemory: async () => [],
    saveMemory: async (record) => record,
    saveEvidenceRecord: async (record) => record,
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
    const integration = buildDefaultIntegrationAccounts(DEFAULT_OWNER_USER_ID).find(
      (candidate) => candidate.id === "local-notes"
    )!;
    const listIntegrationsCalls: Array<string | undefined> = [];
    const dashboardCalls: Array<string | undefined> = [];
    const updatedStatuses: string[] = [];
    const savedAccounts: Array<{ actorContext: ActorContext | null; status: string; userId: string }> = [];

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
          savedAccounts.push({
            actorContext: account.actorContext ?? null,
            status: account.status,
            userId: account.userId
          });
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
    expect(listIntegrationsCalls).toEqual([DEFAULT_OWNER_USER_ID, DEFAULT_OWNER_USER_ID]);
    expect(dashboardCalls).toEqual([DEFAULT_OWNER_USER_ID]);
    expect(updatedStatuses).toEqual(["disabled"]);
    expect(savedAccounts).toEqual([
      {
        actorContext: createSystemActorContext(DEFAULT_OWNER_USER_ID),
        status: "disabled",
        userId: DEFAULT_OWNER_USER_ID
      }
    ]);
    expect(listPayload.integrations).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: integration.id,
          readiness: expect.objectContaining({
            tier: "autonomous-grade"
          })
        })
      ])
    );
    expect(updatePayload.integration).toEqual(
      expect.objectContaining({
        id: integration.id,
        actorContext: createSystemActorContext(DEFAULT_OWNER_USER_ID),
        readiness: expect.objectContaining({
          tier: "experimental"
        })
      })
    );
  });

  it("passes the system user explicitly when responding to approvals", async () => {
    const bundle = await processUserRequest({
      userId: DEFAULT_OWNER_USER_ID,
      request: "Review my inbox and draft responses.",
      memories: [
        createMemoryRecord({
          userId: DEFAULT_OWNER_USER_ID,
          category: "style",
          memoryType: "confirmed",
          content: "Use concise approval summaries.",
          confidence: 0.95,
          source: "test"
        })
      ],
      integrations: buildDefaultIntegrationAccounts(DEFAULT_OWNER_USER_ID)
    });
    const approval = bundle.approvals[0];
    const approvalCalls: ActorContext[] = [];
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
        respondToApproval: async ({ actor, decision, scope, rationale }) => {
          approvalCalls.push(actor);
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
                        actor: DEFAULT_OWNER_USER_ID,
                        actorContext: createSystemActorContext(DEFAULT_OWNER_USER_ID),
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
            userId: DEFAULT_OWNER_USER_ID,
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
            actorContext: createSystemActorContext(DEFAULT_OWNER_USER_ID),
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
    const payload = (await response.json()) as {
      job: {
        id: string;
        kind: string;
        status: string;
        approvalId: string;
      };
      statusUrl: string;
    };
    const repository = Reflect.get(globalThis, "__agenticRepository") as AgenticRepository;
    const queuedJobs = await repository.listJobs({ userId: DEFAULT_OWNER_USER_ID });

    expect(response.status).toBe(202);
    expect(approvalCalls).toEqual([createSystemActorContext(DEFAULT_OWNER_USER_ID)]);
    expect(dashboardCalls).toEqual([DEFAULT_OWNER_USER_ID]);
    expect(resolvedDecisions).toEqual(["approved"]);
    expect(resolvedScopes).toEqual(["similar_24h"]);
    expect(resolvedRationales).toEqual(["This pattern is safe for similar outbound replies."]);
    expect(payload.job.kind).toBe("approval_follow_up");
    expect(payload.job.status).toBe("queued");
    expect(payload.job.approvalId).toBe(approval.id);
    expect(payload.statusUrl).toBe(`/api/approvals/jobs/${payload.job.id}`);
    expect(queuedJobs).toHaveLength(1);
    expect(queuedJobs[0]).toMatchObject({
      id: payload.job.id,
      kind: "approval_follow_up",
      status: "queued"
    });
    expect(savedMemories).toEqual([]);
    expect(savedMemoryIds).toEqual([]);
    expect(appendedEpisodes).toEqual([]);
    expect(savedEvidence).toEqual([]);
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

  it("returns 404 and does not enqueue work when the approval is outside the caller scope", async () => {
    Reflect.set(
      globalThis,
      "__agenticRepository",
      createFakeRepository({
        respondToApproval: async () => {
          throw new ApprovalMutationError("not_found", "Approval approval-hidden was not found.");
        }
      })
    );

    const response = await approvalResponseRoute(
      buildAuthorizedJsonRequest("http://localhost/api/approvals/approval-hidden/respond", {
        decision: "approved",
        scope: "similar_24h",
        rationale: "This should fail closed because the approval is not visible."
      }),
      {
        params: Promise.resolve({ id: "approval-hidden" })
      }
    );
    const payload = (await response.json()) as { error?: string };
    const repository = Reflect.get(globalThis, "__agenticRepository") as AgenticRepository;
    const queuedJobs = await repository.listJobs({ userId: DEFAULT_OWNER_USER_ID });

    expect(response.status).toBe(404);
    expect(payload.error).toContain("was not found");
    expect(queuedJobs).toEqual([]);
  });

  it("returns 403 and does not enqueue work when a non-owner responds to a shared approval", async () => {
    Reflect.set(
      globalThis,
      "__agenticRepository",
      createFakeRepository({
        respondToApproval: async () => {
          throw new ApprovalMutationError("forbidden", "Only the workspace owner can respond to shared approvals.");
        }
      })
    );

    const response = await approvalResponseRoute(
      buildAuthorizedJsonRequest("http://localhost/api/approvals/approval-shared/respond", {
        decision: "approved",
        scope: "once",
        rationale: "Editors should not be allowed to clear shared-team approvals."
      }),
      {
        params: Promise.resolve({ id: "approval-shared" })
      }
    );
    const payload = (await response.json()) as { error?: string };
    const repository = Reflect.get(globalThis, "__agenticRepository") as AgenticRepository;
    const queuedJobs = await repository.listJobs({ userId: DEFAULT_OWNER_USER_ID });

    expect(response.status).toBe(403);
    expect(payload.error).toBe("Only the workspace owner can respond to shared approvals.");
    expect(queuedJobs).toEqual([]);
  });

  it("returns 403 when a non-owner tries to add a workspace member", async () => {
    const saveWorkspaceMember = vi.fn(async (member) => member);

    Reflect.set(
      globalThis,
      "__agenticRepository",
      createFakeRepository({
        listWorkspaces: async () => [
          {
            id: "workspace-shared-editor",
            ownerUserId: "workspace-owner",
            slug: "shared-editor",
            name: "Shared Editor Workspace",
            description: "Editors should not be able to change membership.",
            isPersonal: false,
            createdAt: "2024-01-01T00:00:00.000Z",
            updatedAt: "2024-01-01T00:00:00.000Z"
          }
        ],
        saveWorkspaceMember
      })
    );

    const response = await workspacesRoutePost(
      buildAuthorizedJsonRequest("http://localhost/api/workspaces", {
        action: "add_member",
        workspaceId: "workspace-shared-editor",
        userId: "new-collaborator@example.com",
        role: "viewer"
      })
    );
    const payload = (await response.json()) as { error?: string };

    expect(response.status).toBe(403);
    expect(payload.error).toBe("Only the workspace owner can manage members.");
    expect(saveWorkspaceMember).not.toHaveBeenCalled();
  });

  it("passes the system user explicitly when updating memories", async () => {
    const memory = createMemoryRecord({
      userId: DEFAULT_OWNER_USER_ID,
      category: "preferences",
      memoryType: "observed",
      content: "Prefers concise follow-ups.",
      confidence: 0.68,
      source: "test-suite"
    });
    const listMemoryCalls: Array<string | undefined> = [];
    const dashboardCalls: Array<string | undefined> = [];
    const savedMemories: Array<{
      id: string;
      memoryType: string;
      confidence: number;
      actorContext: ActorContext | null;
    }> = [];

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
            confidence: record.confidence,
            actorContext: record.actorContext
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
    expect(listMemoryCalls).toEqual([DEFAULT_OWNER_USER_ID]);
    expect(dashboardCalls).toEqual([DEFAULT_OWNER_USER_ID]);
    expect(savedMemories).toEqual([
      {
        id: memory.id,
        memoryType: "confirmed",
        confidence: 0.92,
        actorContext: createSystemActorContext(DEFAULT_OWNER_USER_ID)
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
    const savedActors: Array<ActorContext | null> = [];

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
          savedActors.push(candidate.actorContext);
          return candidate;
        },
        getGoalBundleForUser: async () =>
          ({
            goal: {
              id: watcher.goalId,
              workspaceId: null
            }
          }) as Awaited<ReturnType<AgenticRepository["getGoalBundleForUser"]>>,
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
    expect(listWatcherCalls).toEqual([DEFAULT_OWNER_USER_ID]);
    expect(dashboardCalls).toEqual([DEFAULT_OWNER_USER_ID]);
    expect(savedStatuses).toEqual(["paused"]);
    expect(savedActors).toEqual([createSystemActorContext(DEFAULT_OWNER_USER_ID)]);
  });

  it("passes the system user explicitly when selecting operator products", async () => {
    const selectionCalls: Array<{
      userId: string;
      operatorProductId: string;
      actorContext: ActorContext | null;
      selectedAt: string;
    }> = [];
    const dashboardCalls: Array<string | undefined> = [];

    Reflect.set(
      globalThis,
      "__agenticRepository",
      createFakeRepository({
        listOperatorProducts: async (userId) => [
          {
            id: "operator-product-custom",
            userId,
            slug: "custom-operator",
            name: "Custom Operator",
            tagline: "Custom operator",
            description: "Custom operator for regression coverage.",
            icon: "ops",
            recommendedAgentIds: [],
            recommendedTemplateIds: [],
            recommendedIntegrations: [],
            kpis: [],
            onboardingSteps: [],
            isBuiltIn: false,
            status: "active",
            createdAt: "2024-01-01T00:00:00.000Z",
            updatedAt: "2024-01-01T00:00:00.000Z"
          }
        ],
        getOperatorProductSelection: async () => null,
        saveOperatorProductSelection: async (selection) => {
          selectionCalls.push({
            userId: selection.userId,
            operatorProductId: selection.operatorProductId,
            actorContext: selection.actorContext,
            selectedAt: selection.selectedAt
          });
          return selection;
        },
        getDashboardData: async (userId) => {
          dashboardCalls.push(userId);
          return buildDashboardData();
        }
      })
    );

    const response = await operatorProductsRoutePost(
      buildAuthorizedJsonRequest("http://localhost/api/operator-products", {
        operatorProductId: "operator-product-custom"
      })
    );

    expect(response.status).toBe(200);
    expect(selectionCalls).toHaveLength(1);
    expect(selectionCalls[0]).toMatchObject({
      userId: DEFAULT_OWNER_USER_ID,
      operatorProductId: "operator-product-custom",
      actorContext: createSystemActorContext(DEFAULT_OWNER_USER_ID)
    });
    expect(new Date(selectionCalls[0]!.selectedAt).toString()).not.toBe("Invalid Date");
    expect(dashboardCalls).toEqual([]);
  });

  it("passes the system user explicitly when updating commitments", async () => {
    const commitment = {
      id: "commitment-goal-1",
      userId: DEFAULT_OWNER_USER_ID,
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
    const savedCommitments: Array<{ status: string; actorContext: ActorContext | null }> = [];
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
          savedCommitments.push({
            status: candidate.status,
            actorContext: candidate.actorContext
          });
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
      buildAuthorizedPatchRequestWithIfMatch(
        `http://localhost/api/commitments/${commitment.id}`,
        commitment.updatedAt,
        {
          action: "complete"
        }
      ),
      {
        params: Promise.resolve({ id: commitment.id })
      }
    );
    const reopenResponse = await commitmentUpdateRoute(
      buildAuthorizedPatchRequestWithIfMatch(
        `http://localhost/api/commitments/${commitment.id}`,
        commitment.updatedAt,
        {
          action: "reopen"
        }
      ),
      {
        params: Promise.resolve({ id: commitment.id })
      }
    );

    expect(completeResponse.status).toBe(200);
    expect(reopenResponse.status).toBe(200);
    expect(commitmentCalls).toEqual([
      { id: commitment.id, userId: DEFAULT_OWNER_USER_ID },
      { id: commitment.id, userId: DEFAULT_OWNER_USER_ID }
    ]);
    expect(savedCommitments).toEqual([
      {
        status: "completed",
        actorContext: createSystemActorContext(DEFAULT_OWNER_USER_ID)
      }
    ]);
    expect(deletedCalls).toEqual([{ id: commitment.id, userId: DEFAULT_OWNER_USER_ID }]);
    expect(dashboardCalls).toEqual([DEFAULT_OWNER_USER_ID, DEFAULT_OWNER_USER_ID]);
  });

  it("passes the system user explicitly when reading, updating, deleting, and measuring agents", async () => {
    const agent = buildAgentDefinition();
    const getAgentCalls: Array<{ id: string; userId: string | undefined }> = [];
    const metricsCalls: Array<{ id: string; period: string; userId: string | undefined }> = [];
    const savedAgents: Array<{ version: number; actorContext: ActorContext | null; displayName: string }> = [];
    const deletedCalls: Array<{ id: string; userId: string | undefined }> = [];
    const dashboardCalls: Array<string | undefined> = [];

    Reflect.set(
      globalThis,
      "__agenticRepository",
      createFakeRepository({
        getAgent: async (id, userId) => {
          getAgentCalls.push({ id, userId });
          return agent;
        },
        saveAgent: async (candidate) => {
          savedAgents.push({
            version: candidate.version,
            actorContext: candidate.actorContext,
            displayName: candidate.displayName
          });
          return candidate;
        },
        deleteAgent: async (id, userId) => {
          deletedCalls.push({ id, userId });
        },
        getAgentMetrics: async (id, period, userId) => {
          metricsCalls.push({ id, period, userId });
          return AgentMetricsSchema.parse({
            agentId: id,
            period,
            periodStart: "2024-01-01T00:00:00.000Z",
            periodEnd: "2024-01-08T00:00:00.000Z",
            tasksTotal: 1,
            tasksCompleted: 1,
            tasksFailed: 0,
            tasksBlocked: 0,
            approvalsRequested: 0,
            approvalsApproved: 0,
            approvalsRejected: 0,
            averageConfidence: 0.9,
            averageExecutionTimeMs: 125,
            artifactsProduced: 1,
            artifactsByType: { summary: 1 },
            errorCount: 0,
            lastErrorAt: null,
            lastErrorMessage: null,
            feedbackCount: 0,
            userCorrectionCount: 0,
            postApprovalFailureCount: 0,
            averageRating: null,
            successRate: 1,
            approvalRate: 0,
            correctionRate: 0,
            postApprovalFailureRate: 0,
            updatedAt: "2024-01-08T00:00:00.000Z"
          });
        },
        getDashboardData: async (userId) => {
          dashboardCalls.push(userId);
          return buildDashboardData();
        }
      })
    );

    const detailResponse = await getAgentRoute(buildAuthorizedGetRequest(`http://localhost/api/agents/${agent.id}`), {
      params: Promise.resolve({ id: agent.id })
    });
    const updateResponse = await updateAgentRoute(
      new Request(`http://localhost/api/agents/${agent.id}`, {
        method: "PUT",
        headers: {
          "content-type": "application/json",
          [AGENTIC_ACCESS_KEY_HEADER]: "test-access-key"
        },
        body: JSON.stringify({
          displayName: "Private Ops Updated"
        })
      }),
      {
        params: Promise.resolve({ id: agent.id })
      }
    );
    const metricsResponse = await getAgentMetricsRoute(
      buildAuthorizedGetRequest(`http://localhost/api/agents/${agent.id}/metrics?period=week`),
      {
        params: Promise.resolve({ id: agent.id })
      }
    );
    const deleteResponse = await deleteAgentRoute(
      new Request(`http://localhost/api/agents/${agent.id}`, {
        method: "DELETE",
        headers: {
          [AGENTIC_ACCESS_KEY_HEADER]: "test-access-key"
        }
      }),
      {
        params: Promise.resolve({ id: agent.id })
      }
    );

    expect(detailResponse.status).toBe(200);
    expect(updateResponse.status).toBe(200);
    expect(metricsResponse.status).toBe(200);
    expect(deleteResponse.status).toBe(200);
    expect(getAgentCalls).toEqual([
      { id: agent.id, userId: DEFAULT_OWNER_USER_ID },
      { id: agent.id, userId: DEFAULT_OWNER_USER_ID },
      { id: agent.id, userId: DEFAULT_OWNER_USER_ID },
      { id: agent.id, userId: DEFAULT_OWNER_USER_ID }
    ]);
    expect(savedAgents).toEqual([
      {
        version: 2,
        actorContext: createSystemActorContext(DEFAULT_OWNER_USER_ID),
        displayName: "Private Ops Updated"
      }
    ]);
    expect(metricsCalls).toEqual([
      {
        id: agent.id,
        period: "week",
        userId: DEFAULT_OWNER_USER_ID
      }
    ]);
    expect(deletedCalls).toEqual([{ id: agent.id, userId: DEFAULT_OWNER_USER_ID }]);
    expect(dashboardCalls).toEqual([DEFAULT_OWNER_USER_ID, DEFAULT_OWNER_USER_ID]);
  });

  it("passes the system user explicitly when updating briefing preferences", async () => {
    const preferencesCalls: Array<string | undefined> = [];
    const dashboardCalls: Array<string | undefined> = [];
    const savedActors: Array<ActorContext | null> = [];

    Reflect.set(
      globalThis,
      "__agenticRepository",
      createFakeRepository({
        getBriefingPreferences: async (userId) => {
          preferencesCalls.push(userId);
          return buildDashboardData().briefingPreferences;
        },
        saveBriefingPreferences: async (preferences) => {
          savedActors.push(preferences.actorContext);
          return preferences;
        },
        getDashboardData: async (userId) => {
          dashboardCalls.push(userId);
          return buildDashboardData();
        }
      })
    );

    const response = await briefingSchedulePostRoute(
      buildAuthorizedJsonRequest("http://localhost/api/briefing/schedule", {
        timezone: "America/Los_Angeles",
        focus: "deep",
        schedules: briefingTypeValues.map((type, index) => ({
          type,
          enabled: true,
          time: `${String(8 + index).padStart(2, "0")}:15`
        }))
      })
    );

    expect(response.status).toBe(200);
    expect(preferencesCalls).toEqual([DEFAULT_OWNER_USER_ID]);
    expect(savedActors).toEqual([createSystemActorContext(DEFAULT_OWNER_USER_ID)]);
    expect(dashboardCalls).toEqual([DEFAULT_OWNER_USER_ID]);
  });

  it("passes the system user explicitly when listing and mutating workspaces", async () => {
    const workspaceCalls: Array<string | undefined> = [];
    const selectionCalls: Array<string | undefined> = [];
    const memberCalls: Array<string | undefined> = [];
    const governanceCalls: Array<string | undefined> = [];
    const savedWorkspaceActors: ActorContext[] = [];
    const savedMemberActors: ActorContext[] = [];
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
        saveWorkspace: async (workspace, actor) => {
          savedWorkspaceActors.push(actor);
          return workspace;
        },
        saveWorkspaceMember: async (member, actor) => {
          savedMemberActors.push(actor);
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
    expect(savedWorkspaceActors).toEqual([createSystemActorContext(DEFAULT_OWNER_USER_ID)]);
    expect(savedMemberActors).toEqual([createSystemActorContext(DEFAULT_OWNER_USER_ID)]);
    expect(dashboardCalls).toEqual([DEFAULT_OWNER_USER_ID, DEFAULT_OWNER_USER_ID]);
  });

  it("stamps the system actor on workspace selection updates", async () => {
    const selectionCalls: Array<{
      userId: string;
      workspaceId: string;
      actorContext: ActorContext | null;
    }> = [];

    Reflect.set(
      globalThis,
      "__agenticRepository",
      createFakeRepository({
        saveWorkspaceSelection: async (selection) => {
          selectionCalls.push({
            userId: selection.userId,
            workspaceId: selection.workspaceId,
            actorContext: selection.actorContext
          });
          return selection;
        }
      })
    );

    const response = await workspacesRoutePost(
      buildAuthorizedJsonRequest("http://localhost/api/workspaces", {
        action: "select",
        workspaceId: "workspace-personal-system-user"
      })
    );

    expect(response.status).toBe(200);
    expect(selectionCalls).toEqual([
      {
        userId: DEFAULT_OWNER_USER_ID,
        workspaceId: "workspace-personal-system-user",
        actorContext: createSystemActorContext(DEFAULT_OWNER_USER_ID)
      }
    ]);
  });

  it("passes the system user explicitly when updating governance and exporting audits", async () => {
    const governanceCalls: Array<string | undefined> = [];
    const savedGovernanceActors: ActorContext[] = [];
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
        saveWorkspaceGovernance: async (governance, actor) => {
          savedGovernanceActors.push(actor);
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
    const currentGovernance = buildDashboardData().workspaceGovernance!;
    const postResponse = await governanceRoutePost(
      buildSessionJsonRequest("http://localhost/api/governance", {
        approvalMode: "always_review",
        retentionDays: 90
      }, {
        "if-match": `"${currentGovernance.updatedAt}"`
      })
    );
    const auditResponse = await governanceAuditRouteGet(buildAuthorizedGetRequest("http://localhost/api/governance/audit"));

    expect(getResponse.status).toBe(200);
    expect(postResponse.status).toBe(200);
    expect(auditResponse.status).toBe(200);
    expect(governanceCalls).toEqual([DEFAULT_OWNER_USER_ID]);
    expect(savedGovernanceActors).toEqual([
      expect.objectContaining({
        subjectUserId: DEFAULT_OWNER_USER_ID,
        sessionId: expect.any(String),
        initiator: expect.objectContaining({
          kind: "human",
          userId: DEFAULT_OWNER_USER_ID
        }),
        executor: expect.objectContaining({
          kind: "human",
          userId: DEFAULT_OWNER_USER_ID
        })
      })
    ]);
    expect(dashboardCalls).toEqual([DEFAULT_OWNER_USER_ID, DEFAULT_OWNER_USER_ID, DEFAULT_OWNER_USER_ID, DEFAULT_OWNER_USER_ID]);
    expect(auditCalls).toEqual([
      {
        workspaceId: buildDashboardData().activeWorkspace!.id,
        userId: DEFAULT_OWNER_USER_ID
      }
    ]);
  });
});
