import crypto from "node:crypto";
import { mkdir, readFile, rename, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import {
  ActionLogSchema,
  ActionIntentSchema,
  AgentDefinitionSchema,
  AgentMetricsSchema,
  ActorContextSchema,
  AutopilotEventBudgetSchema,
  AutopilotEventSchema,
  DEFAULT_AUTOPILOT_RELIABILITY_CONTROLS,
  AutopilotSettingsSchema,
  type ApprovalDecision,
  type ApprovalDecisionScope,
  ApprovalDecisionScopeSchema,
  ApprovalDecisionRecordSchema,
  ApprovalPreviewSchema,
  ApprovalRequestSchema,
  ArtifactSchema,
  type AutopilotEvent,
  type AutopilotEventDetails,
  type AutopilotEventBudget,
  type AutopilotEventKind,
  type AutopilotMode,
  type AutopilotSettings,
  BriefingPreferencesSchema,
  briefingTypeValues,
  CommitmentSchema,
  GoalBundlePageSchema,
  MemoryRecordPageSchema,
  AutopilotEventPageSchema,
  GoalBundleSchema,
  GoalSchema,
  GoalShareRecordSchema,
  GoalShareStatusSchema,
  GoalTemplateSchema,
  IntegrationAccountSchema,
  EncryptedSecretEnvelopeSchema,
  LlmCacheEntrySchema,
  JobKindSchema,
  JobRecordSchema,
  JobStatusSchema,
  type JobExecutionJournal,
  type JobStatus,
  IntegrationAccountPageSchema,
  MemoryRecordSchema,
  OperatorProductSchema,
  OperatorProductSelectionSchema,
  PrivacyOperationKindSchema,
  PrivacyOperationSchema,
  PrivacyOperationStatusSchema,
  ProviderCredentialSchema,
  ProviderCredentialSecretKindSchema,
  ProviderCredentialSecretRecordSchema,
  ProviderSideEffectRecordSchema,
  RiskClassSchema,
  SYSTEM_USER_ID,
  TaskSchema,
  WatcherSchema,
  WatcherPageSchema,
  WorkflowCanvasTemplateSchema,
  WorkflowStateSchema,
  WorkspaceGovernanceSchema,
  WorkspaceMemberSchema,
  WorkspaceSchema,
  WorkspaceSelectionSchema,
  clone,
  createSystemActorContext,
  deriveApprovalResponsibility,
  deriveAutopilotEventResponsibility,
  deriveGoalResponsibility,
  deriveJobRecoveryState,
  deriveTaskResponsibility,
  deriveWatcherResponsibility,
  nowIso,
  type ActionLog,
  type AgentDefinition,
  type AgentName,
  type AgentMetrics,
  type ActorContext,
  type ApprovalRequest,
  type Artifact,
  type AutopilotEventPage,
  type BriefingPreferences,
  type BriefingType,
  type Commitment,
  type CommitmentInboxBucket,
  type CommitmentInboxPage,
  type DashboardOperatingSections,
  EvidenceRecordSchema,
  type CommitmentUrgency,
  type EvidenceRecord,
  type Goal,
  type GoalBundle,
  type GoalBundlePage,
  type GoalShareRecord,
  type GoalShareStatus,
  type GoalTemplate,
  type IntegrationAccountPage,
  type IntegrationAccount,
  type LlmCacheEntry,
  type PrivacyOperation,
  type PrivacyOperationKind,
  type PrivacyOperationStatus,
  type Provider,
  type ProviderCredential,
  type ProviderCredentialSecretKind,
  type ProviderCredentialSecretRecord,
  type ProviderSideEffectRecord,
  type JobKind,
  type JobRecord,
  type MemoryRecord,
  type MemoryRecordPage,
  type NowQueue,
  type OperatorProduct,
  type OperatorProductSelection,
  type Task,
  type Watcher,
  type WatcherPage,
  type WorkflowCanvasTemplate,
  type Workspace,
  type WorkspaceGovernance,
  type WorkspaceMember,
  type WorkspaceSelection
} from "@agentic/contracts";
import { buildDefaultIntegrationAccounts } from "@agentic/integrations";
import { createMemoryRecord, getMemoryFreshness } from "@agentic/memory";
import { assertApprovalFollowUpJobOwner, buildApprovalResponseMutation } from "./approval-response-helpers";
import {
  buildFallbackApprovalActionIntent,
  buildFallbackApprovalPreview
} from "./approval-fallbacks";
import { isGoogleManagedIntegrationId, syncGoogleManagedIntegrations } from "./google-managed-integrations";
import { assertWorkspaceGovernanceStartupConfig, resolveWorkspaceGovernanceDefaultsFromEnv } from "./governance-defaults"; export { resolveWorkspaceGovernanceDefaultsFromEnv } from "./governance-defaults";
import { resolveBootstrapDisplayName, resolveBootstrapOwnerUserId, resolveDefaultTimezone } from "./repository-constants";
import { deriveAgentMetricsFromGoals } from "./agent-metrics";
import {
  buildPendingAutopilotEvent,
  buildSuppressedAutopilotEvent,
  countsTowardAutopilotBudget,
  evaluateAutopilotClaimControls
} from "./autopilot-event-claim-helpers";
import { defaultAgents, defaultOperatorProducts } from "./built-in-catalog";
import {
  buildCollectionPage,
  decodeCollectionCursor,
  encodeCollectionCursor,
  normalizeCollectionPageLimit,
  sortByCreatedDesc,
  CollectionPageQueryError
} from "./collection-pagination";
import {
  buildCommitmentInboxPage,
  buildDashboardDiagnostics,
  isOpenCommitment,
  mergeCommitments,
  sortCommitments,
  CommitmentInboxQueryError
} from "./commitment-helpers";
import { claimWatcherLeaseInRuntimeStore, type WatcherLeaseClaimParams } from "./watcher-lease-helpers";
import { assembleDashboardData } from "./dashboard-data";
import { appendGoalActionLogsToStore } from "./action-log-append";
import { buildBriefingHistory, buildDashboardControlPlane, buildNowQueue } from "./dashboard-control-plane";
import { buildDashboardOperationsTower, type DashboardOperationsTower } from "./dashboard-operations";
import { buildDashboardOperatingSections } from "./dashboard-operating-sections";
import { listContextPacketMemoryFromStore } from "./repository-context-packet-memory";
import {
  reserveProviderSideEffectInStore,
  updateProviderSideEffectInStore
} from "./provider-side-effect-ledger";
import { claimNextJobFromStore } from "./repository-job-claim";
import {
  assertRunningJobOwner, autopilotEventMatchesBudget, buildDeletedWorkspaceTombstone, buildJobLifecycleJournal,
  goalShareTerminalAt, isJobScopedToWorkspace, normalizeAutopilotEventDetails, resolveRetentionWindow,
  withAutopilotSuppression, workspaceGoalIdsFromStore
} from "./repository-runtime-helpers";
import {
  ApprovalMutationError,
  JobMutationError,
  type AgenticRepository,
  type AutopilotEventClaim,
  type CollectionPageParams,
  type DashboardControlPlane,
  type DashboardControlPlaneSection,
  type DashboardData,
  type DashboardDiagnostic,
  type DashboardDiagnostics,
  type GoalPageParams,
  type GoalShareListFilters,
  type JobConcurrencyLimits,
  type PrivacyOperationListFilters,
  type ReserveProviderSideEffectParams,
  type WatcherListFilters,
  type WatcherPageParams,
  type UpdateProviderSideEffectParams,
  type WorkspaceAuditExport,
  type WorkspaceDeleteParams,
  type WorkspaceRetentionParams
} from "./repository-types";
import { buildWorkspaceAuditExport } from "./workspace-audit-export";
import { acquireFileStoreLock } from "./file-store-lock";
const UserRecordSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  timezone: z.string().min(1),
  createdAt: z.string().datetime()
});

const PolicyRuleRecordSchema = z.object({
  id: z.string().min(1),
  userId: z.string().min(1),
  name: z.string().min(1),
  description: z.string().min(1),
  active: z.boolean(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime()
});

const RuntimeStoreSchema = z.object({
  version: z.literal(1),
  users: z.array(UserRecordSchema),
  goals: z.array(GoalSchema),
  workflows: z.array(WorkflowStateSchema),
  tasks: z.array(TaskSchema),
  memories: z.array(MemoryRecordSchema),
  approvals: z.array(ApprovalRequestSchema),
  actionLogs: z.array(ActionLogSchema),
  evidenceRecords: z.array(EvidenceRecordSchema).default([]),
  watchers: z.array(WatcherSchema),
  integrations: z.array(IntegrationAccountSchema),
  providerCredentials: z.array(ProviderCredentialSchema).default([]),
  providerCredentialSecrets: z.array(ProviderCredentialSecretRecordSchema).default([]),
  providerSideEffects: z.array(ProviderSideEffectRecordSchema).default([]),
  artifacts: z.array(ArtifactSchema),
  workspaces: z.array(WorkspaceSchema).default([]),
  workspaceMembers: z.array(WorkspaceMemberSchema).default([]),
  workspaceSelections: z.array(WorkspaceSelectionSchema).default([]),
  workspaceGovernance: z.array(WorkspaceGovernanceSchema).default([]),
  goalShares: z.array(GoalShareRecordSchema).default([]),
  privacyOperations: z.array(PrivacyOperationSchema).default([]),
  commitments: z.array(CommitmentSchema).default([]),
  policyRules: z.array(PolicyRuleRecordSchema),
  templates: z.array(GoalTemplateSchema).default([]),
  workflowTemplates: z.array(WorkflowCanvasTemplateSchema).default([]),
  autopilotSettings: z.array(AutopilotSettingsSchema).default([]),
  autopilotEvents: z.array(AutopilotEventSchema).default([]),
  jobs: z.array(JobRecordSchema).default([]),
  agents: z.array(AgentDefinitionSchema).default([]),
  agentMetrics: z.array(AgentMetricsSchema).default([]),
  briefingPreferences: z.array(BriefingPreferencesSchema).default([]),
  operatorProducts: z.array(OperatorProductSchema).default([]),
  operatorProductSelections: z.array(OperatorProductSelectionSchema).default([]),
  llmCache: z.array(LlmCacheEntrySchema).default([])
});

type RuntimeStore = z.infer<typeof RuntimeStoreSchema>;

export { CommitmentInboxQueryError, CollectionPageQueryError };
export { ApprovalMutationError, JobMutationError, type AgenticRepository, type AutopilotEventClaim, type CollectionPageParams, type DashboardCollectionPage, type DashboardCollectionPageParams, type DashboardCollectionSort, type DashboardControlPlane, type DashboardControlPlaneSection, type DashboardData, type DashboardDiagnostic, type DashboardDiagnosticTarget, type DashboardDiagnostics, type GoalPageParams, type GoalShareListFilters, type PrivacyOperationListFilters, type WatcherListFilters, type WatcherPageParams, type WorkspaceAuditExport, type WorkspaceDeleteParams, type WorkspaceRetentionParams } from "./repository-types";
export { resolveDashboardCockpitRollout, type DashboardCockpitRollout, type DashboardCockpitVariant } from "./dashboard-cockpit-rollout";
export { buildDashboardTraceability, type DashboardApprovalTrace, type DashboardMemoryProvenance, type DashboardTaskTrace, type DashboardTraceability, type DashboardWorkflowTrace } from "./dashboard-traceability";
export { buildExecutionProvenanceGraph } from "./provenance-graph";
export { buildDashboardSummary, type DashboardSummary, type DashboardSummaryLane } from "./dashboard-summary";
export { listDashboardActionLogsPage, listDashboardApprovalsPage, listDashboardArtifactsPage, listDashboardCommitmentsPage, listDashboardJobsPage, listDashboardMemoryPage } from "./dashboard-collection-page";
const SHARED_APPROVAL_OWNER_MESSAGE = "Only the workspace owner can respond to shared approvals.";

const STALLED_WORKFLOW_MS = 30 * 60 * 1000;
const APPROVAL_WAIT_SLA_MS = 6 * 60 * 60 * 1000;
const DASHBOARD_GOAL_LIMIT = 40;
const DASHBOARD_AUTOPILOT_EVENT_LIMIT = 24;
const DASHBOARD_MEMORY_LIMIT = 40;
const DASHBOARD_INTEGRATION_LIMIT = 24;
const DEFAULT_RUNTIME_STORE_PATH = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../.agentic/runtime-store.json");

function normalizeProvenanceCollectionLimit(value: number | undefined): number | null {
  return value === undefined ? null : Math.max(1, Math.min(Math.trunc(value), 500));
}

function resolveDefaultStorePath(): string {
  const configured = process.env.AGENTIC_RUNTIME_STORE_PATH?.trim();

  if (configured) {
    return path.resolve(configured);
  }

  return DEFAULT_RUNTIME_STORE_PATH;
}

function createEmptyStore(): RuntimeStore {
  return RuntimeStoreSchema.parse({
    version: 1,
    users: [],
    goals: [],
    workflows: [],
    tasks: [],
    memories: [],
    approvals: [],
    actionLogs: [],
    watchers: [],
    integrations: [],
    providerCredentials: [],
    providerCredentialSecrets: [],
    providerSideEffects: [],
    artifacts: [],
    workspaces: [],
    workspaceMembers: [],
    workspaceSelections: [],
    workspaceGovernance: [],
    goalShares: [],
    privacyOperations: [],
    commitments: [],
    policyRules: [],
    templates: [],
    workflowTemplates: [],
    autopilotSettings: [],
    autopilotEvents: [],
    jobs: [],
    agents: [],
    agentMetrics: [],
    briefingPreferences: [],
    operatorProducts: [],
    operatorProductSelections: [],
    llmCache: []
  });
}

function upsertById<T extends { id: string }>(items: T[], nextItem: T): T[] {
  return [...items.filter((item) => item.id !== nextItem.id), nextItem];
}

function upsertByKey<T>(items: T[], nextItem: T, getKey: (item: T) => string): T[] {
  const nextKey = getKey(nextItem);
  return [...items.filter((item) => getKey(item) !== nextKey), nextItem];
}

function integrationStoreKey(account: Pick<IntegrationAccount, "id" | "userId">): string {
  return `${account.userId}:${account.id}`;
}

function workspaceMemberStoreKey(member: Pick<WorkspaceMember, "workspaceId" | "userId">): string {
  return `${member.workspaceId}:${member.userId}`;
}

function providerCredentialStoreKey(credential: Pick<ProviderCredential, "id" | "userId">): string {
  return `${credential.userId}:${credential.id}`;
}

function providerCredentialSecretStoreKey(
  record: Pick<ProviderCredentialSecretRecord, "credentialId" | "kind" | "userId">
): string {
  return `${record.userId}:${record.credentialId}:${record.kind}`;
}

function goalShareFingerprintStoreKey(share: Pick<GoalShareRecord, "tokenFingerprint">): string {
  return share.tokenFingerprint.toLowerCase();
}

function uniqueById<T extends { id: string }>(items: T[]): T[] {
  const map = new Map<string, T>();

  for (const item of items) {
    map.set(item.id, item);
  }

  return [...map.values()];
}

function resolveAgentFromDefinitions(
  agents: AgentDefinition[],
  agentIdOrName: string,
  userId?: string
): AgentDefinition | null {
  const normalized = agentIdOrName.trim();

  if (!normalized) {
    return null;
  }

  const visibleAgents = userId
    ? agents.filter((agent) => agent.isBuiltIn || agent.userId === userId)
    : agents;

  return (
    visibleAgents.find((agent) => agent.id === normalized) ??
    visibleAgents.find((agent) => agent.name === normalized) ??
    null
  );
}

function normalizeApprovalDecisionScope(value: unknown): ApprovalDecisionScope | null {
  if (value === null || value === undefined) {
    return null;
  }

  const parsed = ApprovalDecisionScopeSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
}

function normalizeApprovalHistory(value: unknown): ApprovalRequest["history"] {
  const parsed = z.array(ApprovalDecisionRecordSchema).safeParse(value);
  return parsed.success ? parsed.data : [];
}

function defaultBriefingSchedules() {
  return briefingTypeValues.map((type, index) =>
    BriefingPreferencesSchema.shape.schedules.element.parse({
      type,
      enabled: type === "startup",
      time: ["08:00", "12:30", "09:00", "17:30", "18:00"][index]
    })
  );
}

function defaultBriefingPreferences(userId: string): BriefingPreferences {
  const timestamp = nowIso();
  return BriefingPreferencesSchema.parse({
    userId,
    timezone: resolveDefaultTimezone(),
    focus: "balanced",
    schedules: defaultBriefingSchedules(),
    createdAt: timestamp,
    updatedAt: timestamp
  });
}

function defaultUser(userId: string) {
  return UserRecordSchema.parse({
    id: userId,
    name: resolveBootstrapDisplayName(),
    timezone: resolveDefaultTimezone(),
    createdAt: nowIso()
  });
}

function defaultPolicyRules(userId: string) {
  const timestamp = nowIso();

  return [
    PolicyRuleRecordSchema.parse({
      id: "policy-risk-r3",
      userId,
      name: "Approval for external commitments",
      description: "Require approval before sending messages or changing calendar commitments.",
      active: true,
      createdAt: timestamp,
      updatedAt: timestamp
    }),
    PolicyRuleRecordSchema.parse({
      id: "policy-risk-r4",
      userId,
      name: "Block irreversible actions",
      description: "Block deletes and sensitive approvals until an explicit override exists.",
      active: true,
      createdAt: timestamp,
      updatedAt: timestamp
    })
  ];
}

function defaultMemories(userId: string): MemoryRecord[] {
  return [
    createMemoryRecord({
      userId,
      category: "working-style",
      memoryType: "confirmed",
      content: "The instance owner prefers auditable plans with explicit trade-offs, validation evidence, and exact run commands.",
      confidence: 0.99,
      source: "project-default",
      sensitivity: "internal",
      permissions: ["orchestrator", "workflow", "knowledge"]
    }),
    createMemoryRecord({
      userId,
      category: "product-scope",
      memoryType: "observed",
      content: "The current Agentic MVP targets a single trusted user and defaults to provider-neutral adapters.",
      confidence: 0.94,
      source: "project-default",
      sensitivity: "internal",
      permissions: ["orchestrator", "research", "workflow", "knowledge"]
    })
  ];
}

function defaultAutopilotSettings(userId: string): AutopilotSettings {
  const timestamp = nowIso();

  return AutopilotSettingsSchema.parse({
    userId,
    mode: "notify_only",
    debounceMinutes: 15,
    reliabilityControls: DEFAULT_AUTOPILOT_RELIABILITY_CONTROLS,
    actorContext: null,
    createdAt: timestamp,
    updatedAt: timestamp
  });
}

async function normalizeStore(raw: string): Promise<RuntimeStore> {
  return RuntimeStoreSchema.parse(JSON.parse(raw) as unknown);
}

function isStoreCorruptionError(error: unknown): boolean {
  return error instanceof SyntaxError || error instanceof z.ZodError;
}

function bundleFromStore(store: RuntimeStore, goalId: string): GoalBundle | null {
  const goal = store.goals.find((candidate) => candidate.id === goalId);

  if (!goal) {
    return null;
  }

  const workflow = store.workflows.find((candidate) => candidate.id === goal.workflowId);

  if (!workflow) {
    throw new Error(`Workflow ${goal.workflowId} is missing for goal ${goalId}.`);
  }

  return normalizeGoalBundleResponsibilities(
    GoalBundleSchema.parse({
      goal,
      workflow,
      tasks: store.tasks.filter((task) => task.goalId === goalId).sort((left, right) => left.createdAt.localeCompare(right.createdAt)),
      artifacts: store.artifacts.filter((artifact) => artifact.goalId === goalId).sort((left, right) => left.createdAt.localeCompare(right.createdAt)),
      approvals: store.approvals.filter((approval) => approval.goalId === goalId).sort((left, right) => left.createdAt.localeCompare(right.createdAt)),
      watchers: store.watchers.filter((watcher) => watcher.goalId === goalId).sort((left, right) => left.createdAt.localeCompare(right.createdAt)),
      actionLogs: store.actionLogs.filter((log) => log.goalId === goalId).sort((left, right) => left.createdAt.localeCompare(right.createdAt))
    })
  );
}

function normalizeGoalBundleResponsibilities(bundle: GoalBundle): GoalBundle {
  const validated = GoalBundleSchema.parse(bundle);
  const tasksById = new Map(validated.tasks.map((task) => [task.id, task] as const));
  const goalResponsibility = deriveGoalResponsibility({
    userId: validated.goal.userId,
    workspaceId: validated.goal.workspaceId
  });

  return GoalBundleSchema.parse({
    ...validated,
    goal: {
      ...validated.goal,
      // Goal-scoped responsibility remains derived until explicit reassignment flows exist.
      responsibility: goalResponsibility
    },
    tasks: validated.tasks.map((task) => ({
      ...task,
      responsibility: deriveTaskResponsibility({
        assignedAgent: task.assignedAgent,
        requiresApproval: task.requiresApproval,
        ownerUserId: validated.goal.userId,
        workspaceId: validated.goal.workspaceId
      })
    })),
    approvals: validated.approvals.map((approval) => ({
      ...approval,
      responsibility: deriveApprovalResponsibility({
        ownerUserId: validated.goal.userId,
        workspaceId: validated.goal.workspaceId,
        delegateAgent: tasksById.get(approval.taskId)?.assignedAgent ?? null
      })
    })),
    watchers: validated.watchers.map((watcher) => ({
      ...watcher,
      responsibility: deriveWatcherResponsibility({
        ownerUserId: validated.goal.userId,
        workspaceId: validated.goal.workspaceId,
        createdByUserId: watcher.actorContext?.subjectUserId ?? null,
        targetEntity: watcher.targetEntity
      })
    }))
  });
}

function normalizeWatcherForGoal(goal: GoalBundle["goal"], watcher: Watcher): Watcher {
  const validated = WatcherSchema.parse(watcher);

  return WatcherSchema.parse({
    ...validated,
    responsibility: deriveWatcherResponsibility({
      ownerUserId: goal.userId,
      workspaceId: goal.workspaceId,
      createdByUserId: validated.actorContext?.subjectUserId ?? null,
      targetEntity: validated.targetEntity
    })
  });
}

function normalizeAutopilotEvent(event: AutopilotEvent): AutopilotEvent {
  const validated = AutopilotEventSchema.parse(event);

  return AutopilotEventSchema.parse({
    ...validated,
    responsibility: deriveAutopilotEventResponsibility({
      userId: validated.userId,
      mode: validated.mode
    })
  });
}

function mergeGoalBundleIntoStore(store: RuntimeStore, bundle: GoalBundle): GoalBundle {
  const validated = normalizeGoalBundleResponsibilities(GoalBundleSchema.parse(bundle));
  const goalId = validated.goal.id;

  store.goals = upsertById(store.goals, validated.goal);
  store.workflows = upsertById(store.workflows, validated.workflow);
  store.tasks = store.tasks.filter((task) => task.goalId !== goalId);
  store.artifacts = store.artifacts.filter((artifact) => artifact.goalId !== goalId);
  store.approvals = store.approvals.filter((approval) => approval.goalId !== goalId);
  store.watchers = store.watchers.filter((watcher) => watcher.goalId !== goalId);
  store.actionLogs = store.actionLogs.filter((log) => log.goalId !== goalId);

  for (const task of validated.tasks) {
    store.tasks = upsertById(store.tasks, task);
  }

  for (const artifact of validated.artifacts) {
    store.artifacts = upsertById(store.artifacts, artifact);
  }

  for (const approval of validated.approvals) {
    store.approvals = upsertById(store.approvals, approval);
  }

  for (const watcher of validated.watchers) {
    store.watchers = upsertById(store.watchers, watcher);
  }

  store.actionLogs = uniqueById([...store.actionLogs, ...validated.actionLogs]);
  return validated;
}

function personalWorkspaceIdForUser(userId: string): string {
  return `workspace-personal-${userId}`;
}

function personalWorkspaceSlugForUser(userId: string): string {
  return userId === SYSTEM_USER_ID ? "personal" : `personal-${userId.toLowerCase()}`;
}

function defaultWorkspace(userId: string): Workspace {
  const timestamp = nowIso();

  return WorkspaceSchema.parse({
    id: personalWorkspaceIdForUser(userId),
    ownerUserId: userId,
    slug: personalWorkspaceSlugForUser(userId),
    name: "Personal Workspace",
    description: "Default workspace for personal planning and execution.",
    isPersonal: true,
    createdAt: timestamp,
    updatedAt: timestamp
  });
}

function defaultWorkspaceMember(workspaceId: string, userId: string): WorkspaceMember {
  const timestamp = nowIso();

  return WorkspaceMemberSchema.parse({
    id: `workspace-member-${workspaceId}-${userId}`,
    workspaceId,
    userId,
    role: "owner",
    joinedAt: timestamp,
    updatedAt: timestamp
  });
}

function defaultWorkspaceGovernance(workspaceId: string, updatedBy: string): WorkspaceGovernance {
  const timestamp = nowIso();

  return WorkspaceGovernanceSchema.parse({
    workspaceId,
    ...resolveWorkspaceGovernanceDefaultsFromEnv(),
    updatedBy,
    createdAt: timestamp,
    updatedAt: timestamp
  });
}

function parseActorContext(actor: ActorContext): ActorContext {
  return ActorContextSchema.parse(actor);
}

function subjectUserIdForActor(actor: ActorContext): string {
  return parseActorContext(actor).subjectUserId;
}

function governanceUpdatedByForActor(actor: ActorContext): string {
  const parsed = parseActorContext(actor);
  return parsed.initiator.userId ?? parsed.subjectUserId;
}

function workspaceIdsForUser(store: RuntimeStore, userId: string): Set<string> {
  return new Set(
    store.workspaceMembers
      .filter((member) => member.userId === userId)
      .map((member) => member.workspaceId)
  );
}

function isGoalVisibleToUser(goal: GoalBundle["goal"], workspaceIds: Set<string>, userId: string): boolean {
  if (goal.workspaceId) {
    return workspaceIds.has(goal.workspaceId);
  }

  return goal.userId === userId;
}

function visibleGoalsForUser(store: RuntimeStore, userId: string): GoalBundle["goal"][] {
  const workspaceIds = workspaceIdsForUser(store, userId);
  return store.goals.filter((goal) => isGoalVisibleToUser(goal, workspaceIds, userId));
}

function goalIdsForUser(store: RuntimeStore, userId: string): Set<string> {
  return new Set(visibleGoalsForUser(store, userId).map((goal) => goal.id));
}

function normalizeWorkspaceSelectionForUser(store: RuntimeStore, userId: string): WorkspaceSelection | null {
  const selection = store.workspaceSelections.find((candidate) => candidate.userId === userId) ?? null;

  if (!selection) {
    return null;
  }

  const workspaceIds = workspaceIdsForUser(store, userId);
  return workspaceIds.has(selection.workspaceId) ? selection : null;
}

function resolveActiveWorkspaceFromStore(store: RuntimeStore, userId: string): {
  activeWorkspace: Workspace | null;
  workspaceSelection: WorkspaceSelection | null;
} {
  const availableWorkspaces = listWorkspacesForUserFromStore(store, userId);
  const selected = normalizeWorkspaceSelectionForUser(store, userId);
  const activeWorkspace =
    availableWorkspaces.find((workspace) => workspace.id === selected?.workspaceId) ??
    availableWorkspaces.find((workspace) => workspace.isPersonal) ??
    availableWorkspaces[0] ??
    null;

  if (!activeWorkspace) {
    return {
      activeWorkspace: null,
      workspaceSelection: selected
    };
  }

  return {
    activeWorkspace,
    workspaceSelection:
      selected && selected.workspaceId === activeWorkspace.id
        ? selected
        : WorkspaceSelectionSchema.parse({
            userId,
            workspaceId: activeWorkspace.id,
            selectedAt: selected?.selectedAt ?? activeWorkspace.updatedAt,
            updatedAt: selected?.updatedAt ?? activeWorkspace.updatedAt
          })
  };
}

function listWorkspacesForUserFromStore(store: RuntimeStore, userId: string): Workspace[] {
  const visibleWorkspaceIds = workspaceIdsForUser(store, userId);

  return store.workspaces
    .filter((workspace) => visibleWorkspaceIds.has(workspace.id))
    .sort((left, right) => {
      if (left.isPersonal !== right.isPersonal) {
        return left.isPersonal ? -1 : 1;
      }

      return left.name.localeCompare(right.name);
    })
    .map((workspace) => WorkspaceSchema.parse(clone(workspace)));
}

function assertWorkspaceExistsInStore(store: RuntimeStore, workspaceId: string): Workspace {
  const workspace = store.workspaces.find((candidate) => candidate.id === workspaceId);

  if (!workspace) {
    throw new Error(`Workspace ${workspaceId} was not found.`);
  }

  return workspace;
}

function getWorkspaceMemberFromStore(store: RuntimeStore, workspaceId: string, userId: string): WorkspaceMember | null {
  return (
    store.workspaceMembers.find(
      (member) => member.workspaceId === workspaceId && member.userId === userId
    ) ?? null
  );
}

function assertWorkspaceMember(store: RuntimeStore, workspaceId: string, userId: string): WorkspaceMember {
  const member = getWorkspaceMemberFromStore(store, workspaceId, userId);

  if (!member) {
    throw new Error(`User ${userId} does not have access to workspace ${workspaceId}.`);
  }

  return member;
}

function assertWorkspaceOwner(store: RuntimeStore, workspaceId: string, userId: string): WorkspaceMember {
  const member = assertWorkspaceMember(store, workspaceId, userId);

  if (member.role !== "owner") {
    throw new Error(`User ${userId} cannot administer workspace ${workspaceId}.`);
  }

  return member;
}

function assertSharedApprovalResponder(
  store: RuntimeStore,
  goal: GoalBundle["goal"],
  userId: string,
  approvalId: string
): void {
  if (!goal.workspaceId) {
    return;
  }

  const member = getWorkspaceMemberFromStore(store, goal.workspaceId, userId);

  if (!member) {
    throw new ApprovalMutationError("not_found", `Approval ${approvalId} was not found.`);
  }

  if (member.role !== "owner") {
    throw new ApprovalMutationError("forbidden", SHARED_APPROVAL_OWNER_MESSAGE);
  }
}

function goalByIdFromStore(store: RuntimeStore, goalId: string): GoalBundle["goal"] | null {
  return store.goals.find((candidate) => candidate.id === goalId) ?? null;
}

function watcherByIdFromStore(store: RuntimeStore, watcherId: string): Watcher | null {
  return store.watchers.find((candidate) => candidate.id === watcherId) ?? null;
}

function isGoalIdVisibleToUser(
  store: RuntimeStore,
  goalId: string,
  workspaceIds: Set<string>,
  userId: string
): boolean {
  const goal = goalByIdFromStore(store, goalId);
  return goal ? isGoalVisibleToUser(goal, workspaceIds, userId) : false;
}

function isJobVisibleToUserInStore(
  store: RuntimeStore,
  job: JobRecord,
  workspaceIds: Set<string>,
  userId: string
): boolean {
  if (job.userId === userId) {
    return true;
  }
  switch (job.payload.type) {
    case "goal_create":
    case "goal_refine":
    case "briefing_create":
    case "template_run":
    case "approval_follow_up":
    case "approval_notification":
      return (
        (job.payload.workspaceId ? workspaceIds.has(job.payload.workspaceId) : false) ||
        isGoalIdVisibleToUser(store, job.payload.goalId, workspaceIds, userId)
      );
    case "public_share_view":
      return isGoalIdVisibleToUser(store, job.payload.goalId, workspaceIds, userId);
    case "privacy_operation":
    case "github_issue_intake":
      return job.payload.workspaceId ? workspaceIds.has(job.payload.workspaceId) : false;
    case "autopilot_process": {
      const watcher = watcherByIdFromStore(store, job.payload.sourceId);
      const goal = watcher ? goalByIdFromStore(store, watcher.goalId) : null;
      return goal?.workspaceId ? workspaceIds.has(goal.workspaceId) : false;
    }
    case "docs_render":
      return false;
  }
}

function isGoalShareVisibleToUser(store: RuntimeStore, share: GoalShareRecord, userId: string): boolean {
  const goal = goalByIdFromStore(store, share.goalId);

  if (!goal) {
    return false;
  }

  const workspaceIds = workspaceIdsForUser(store, userId);
  return isGoalVisibleToUser(goal, workspaceIds, userId);
}

function normalizeGoalShareFilters(filters?: GoalShareListFilters): GoalShareListFilters {
  return {
    userId: filters?.userId ?? SYSTEM_USER_ID,
    goalId: filters?.goalId,
    workspaceId: filters?.workspaceId,
    statuses: filters?.statuses?.map((status) => GoalShareStatusSchema.parse(status))
  };
}

function normalizePrivacyOperationFilters(filters?: PrivacyOperationListFilters): PrivacyOperationListFilters {
  return {
    userId: filters?.userId ?? SYSTEM_USER_ID,
    workspaceId: filters?.workspaceId,
    kinds: filters?.kinds?.map((kind) => PrivacyOperationKindSchema.parse(kind)),
    statuses: filters?.statuses?.map((status) => PrivacyOperationStatusSchema.parse(status))
  };
}

function isGoalInActiveWorkspaceScope(
  goal: Pick<Goal, "workspaceId" | "userId">,
  activeWorkspace: Workspace | null,
  userId: string
): boolean {
  if (!activeWorkspace) {
    return false;
  }

  if (goal.workspaceId) {
    return goal.workspaceId === activeWorkspace.id;
  }

  return activeWorkspace.isPersonal && goal.userId === userId;
}

function filterBundlesForWorkspace(
  bundles: GoalBundle[],
  activeWorkspace: Workspace | null,
  userId: string
): GoalBundle[] {
  return bundles.filter((bundle) => isGoalInActiveWorkspaceScope(bundle.goal, activeWorkspace, userId));
}

function listWorkspaceMembersForWorkspaceFromStore(store: RuntimeStore, workspaceId: string): WorkspaceMember[] {
  return store.workspaceMembers
    .filter((member) => member.workspaceId === workspaceId)
    .sort((left, right) => left.joinedAt.localeCompare(right.joinedAt))
    .map((member) => WorkspaceMemberSchema.parse(clone(member)));
}

export class FileRepository implements AgenticRepository {
  backend = "file" as const;
  private mutationQueue = Promise.resolve();

  constructor(private readonly storePath = resolveDefaultStorePath()) {}

  private async withMutationLock<T>(callback: () => Promise<T>): Promise<T> {
    const previous = this.mutationQueue;
    let releaseLock: (() => void) | undefined;

    this.mutationQueue = new Promise<void>((resolve) => {
      releaseLock = resolve;
    });

    await previous;

    let releaseFileLock: (() => Promise<void>) | undefined;

    try {
      releaseFileLock = await acquireFileStoreLock(this.storePath);
      return await callback();
    } finally {
      await releaseFileLock?.();
      releaseLock?.();
    }
  }

  private async readStore(): Promise<RuntimeStore> {
    try {
      return await normalizeStore(await readFile(this.storePath, "utf8"));
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);

      if (message.includes("ENOENT")) {
        const store = createEmptyStore();
        await this.writeStore(store);
        return store;
      }

      if (isStoreCorruptionError(error)) {
        throw new Error(`Runtime store at ${this.storePath} is corrupted. Restore or delete the file and retry.`);
      }

      throw error;
    }
  }

  private async writeStore(store: RuntimeStore): Promise<void> {
    const validated = RuntimeStoreSchema.parse(store);
    const directory = path.dirname(this.storePath);
    const tempPath = path.join(
      directory,
      `${path.basename(this.storePath)}.${process.pid}.${crypto.randomUUID()}.tmp`
    );

    await mkdir(directory, { recursive: true });
    try {
      await writeFile(tempPath, JSON.stringify(validated, null, 2), "utf8");
      await rename(tempPath, this.storePath);
    } catch (error) {
      await unlink(tempPath).catch(() => {});
      throw error;
    }
  }

  async seedDefaults(userId = resolveBootstrapOwnerUserId(SYSTEM_USER_ID)): Promise<void> {
    await this.withMutationLock(async () => {
      const store = await this.readStore();
      const personalWorkspace = defaultWorkspace(userId);

      if (!store.users.find((user) => user.id === userId)) {
        store.users.push(defaultUser(userId));
      }

      if (!store.workspaces.some((workspace) => workspace.id === personalWorkspace.id)) {
        store.workspaces.push(personalWorkspace);
      }

      if (!store.workspaceMembers.some((member) => member.workspaceId === personalWorkspace.id && member.userId === userId)) {
        store.workspaceMembers.push(defaultWorkspaceMember(personalWorkspace.id, userId));
      }

      if (!store.workspaceGovernance.some((governance) => governance.workspaceId === personalWorkspace.id)) {
        store.workspaceGovernance.push(defaultWorkspaceGovernance(personalWorkspace.id, userId));
      }

      const existingSelection = normalizeWorkspaceSelectionForUser(store, userId);

      if (!existingSelection) {
        store.workspaceSelections = upsertByKey(
          store.workspaceSelections,
          WorkspaceSelectionSchema.parse({
            userId,
            workspaceId: personalWorkspace.id,
            actorContext: createSystemActorContext(userId),
            selectedAt: nowIso(),
            updatedAt: nowIso()
          }),
          (selection) => selection.userId
        );
      }

      if (!store.integrations.some((integration) => integration.userId === userId)) {
        store.integrations.push(
          ...buildDefaultIntegrationAccounts(userId).map((integration) =>
            IntegrationAccountSchema.parse({
              ...integration,
              actorContext: createSystemActorContext(userId)
            })
          )
        );
      }

      if (!store.memories.some((memory) => memory.userId === userId)) {
        store.memories.push(...defaultMemories(userId));
      }

      if (!store.policyRules.some((rule) => rule.userId === userId)) {
        store.policyRules.push(...defaultPolicyRules(userId));
      }

      if (!store.briefingPreferences.some((preferences) => preferences.userId === userId)) {
        store.briefingPreferences.push(defaultBriefingPreferences(userId));
      }

      if (!store.autopilotSettings.some((settings) => settings.userId === userId)) {
        store.autopilotSettings.push(defaultAutopilotSettings(userId));
      }

      // Serialize seed writes so initial state cannot interleave with other mutations.
      if (!store.agents.some((agent) => agent.isBuiltIn && agent.userId === userId)) {
        store.agents.push(...defaultAgents(userId));
      }

      if (!store.operatorProducts.some((product) => product.userId === userId && product.isBuiltIn)) {
        store.operatorProducts.push(...defaultOperatorProducts(userId));
      }

      if (!store.operatorProductSelections.some((selection) => selection.userId === userId)) {
        const [defaultSelection] = defaultOperatorProducts(userId);
        store.operatorProductSelections.push(
          OperatorProductSelectionSchema.parse({
            userId,
            operatorProductId: defaultSelection.id,
            actorContext: createSystemActorContext(userId),
            selectedAt: nowIso(),
            updatedAt: nowIso()
          })
        );
      }

      await this.writeStore(store);
    });
  }

  async listWorkspaces(userId = SYSTEM_USER_ID): Promise<Workspace[]> {
    const store = await this.readStore();
    return listWorkspacesForUserFromStore(store, userId);
  }

  async saveWorkspace(workspace: Workspace, actor: ActorContext): Promise<Workspace> {
    return this.withMutationLock(async () => {
      const store = await this.readStore();
      const validated = WorkspaceSchema.parse(workspace);
      const actorUserId = subjectUserIdForActor(actor);
      const existing = store.workspaces.find((candidate) => candidate.id === validated.id) ?? null;
      const duplicateSlug = store.workspaces.find(
        (candidate) => candidate.slug === validated.slug && candidate.id !== validated.id
      );

      if (duplicateSlug) {
        throw new Error(`Workspace slug ${validated.slug} is already in use.`);
      }

      if (existing) {
        assertWorkspaceOwner(store, validated.id, actorUserId);
      } else if (validated.ownerUserId !== actorUserId) {
        throw new Error(`User ${actorUserId} cannot create workspace ${validated.id} for another owner.`);
      }

      store.workspaces = upsertById(store.workspaces, validated);

      if (!store.workspaceMembers.some((member) => member.workspaceId === validated.id && member.userId === validated.ownerUserId)) {
        store.workspaceMembers = upsertById(
          store.workspaceMembers,
          defaultWorkspaceMember(validated.id, validated.ownerUserId)
        );
      }

      if (!store.workspaceGovernance.some((governance) => governance.workspaceId === validated.id)) {
        store.workspaceGovernance = upsertByKey(
          store.workspaceGovernance,
          defaultWorkspaceGovernance(validated.id, governanceUpdatedByForActor(actor)),
          (governance) => governance.workspaceId
        );
      }

      await this.writeStore(store);
      return WorkspaceSchema.parse(clone(validated));
    });
  }

  async listWorkspaceMembers(workspaceId: string, userId = SYSTEM_USER_ID): Promise<WorkspaceMember[]> {
    const store = await this.readStore();
    assertWorkspaceMember(store, workspaceId, userId);
    return listWorkspaceMembersForWorkspaceFromStore(store, workspaceId);
  }

  async saveWorkspaceMember(member: WorkspaceMember, actor: ActorContext): Promise<WorkspaceMember> {
    return this.withMutationLock(async () => {
      const store = await this.readStore();
      const validated = WorkspaceMemberSchema.parse(member);
      const actorUserId = subjectUserIdForActor(actor);
      const workspace = assertWorkspaceExistsInStore(store, validated.workspaceId);
      assertWorkspaceOwner(store, validated.workspaceId, actorUserId);

      if (workspace.isPersonal && validated.userId !== workspace.ownerUserId) {
        throw new Error("Personal workspaces cannot add additional members.");
      }

      if (!store.users.some((user) => user.id === validated.userId)) {
        store.users.push(defaultUser(validated.userId));
      }

      store.workspaceMembers = upsertByKey(store.workspaceMembers, validated, workspaceMemberStoreKey);
      await this.writeStore(store);
      return WorkspaceMemberSchema.parse(clone(validated));
    });
  }

  async getWorkspaceSelection(userId = SYSTEM_USER_ID): Promise<WorkspaceSelection | null> {
    const store = await this.readStore();
    return normalizeWorkspaceSelectionForUser(store, userId);
  }

  async saveWorkspaceSelection(selection: WorkspaceSelection): Promise<WorkspaceSelection> {
    return this.withMutationLock(async () => {
      const store = await this.readStore();
      const validated = WorkspaceSelectionSchema.parse(selection);
      assertWorkspaceMember(store, validated.workspaceId, validated.userId);
      store.workspaceSelections = upsertByKey(store.workspaceSelections, validated, (item) => item.userId);
      await this.writeStore(store);
      return WorkspaceSelectionSchema.parse(clone(validated));
    });
  }

  async getWorkspaceGovernance(workspaceId: string, userId = SYSTEM_USER_ID): Promise<WorkspaceGovernance | null> {
    const store = await this.readStore();
    assertWorkspaceMember(store, workspaceId, userId);
    const governance = store.workspaceGovernance.find((candidate) => candidate.workspaceId === workspaceId) ?? null;
    return governance ? WorkspaceGovernanceSchema.parse(clone(governance)) : null;
  }

  async listGoalShares(filters?: GoalShareListFilters): Promise<GoalShareRecord[]> {
    const normalized = normalizeGoalShareFilters(filters);
    const store = await this.readStore();

    return [...store.goalShares]
      .filter((share) => {
        if (!isGoalShareVisibleToUser(store, share, normalized.userId ?? SYSTEM_USER_ID)) {
          return false;
        }

        if (normalized.goalId && share.goalId !== normalized.goalId) {
          return false;
        }

        if (normalized.workspaceId !== undefined && share.workspaceId !== normalized.workspaceId) {
          return false;
        }

        if (normalized.statuses?.length && !normalized.statuses.includes(share.status)) {
          return false;
        }

        return true;
      })
      .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))
      .map((share) => GoalShareRecordSchema.parse(clone(share)));
  }

  async getGoalShare(shareId: string, userId = SYSTEM_USER_ID): Promise<GoalShareRecord | null> {
    const store = await this.readStore();
    const share = store.goalShares.find((candidate) => candidate.id === shareId);

    if (!share || !isGoalShareVisibleToUser(store, share, userId)) {
      return null;
    }

    return GoalShareRecordSchema.parse(clone(share));
  }

  async getGoalShareByTokenFingerprint(tokenFingerprint: string): Promise<GoalShareRecord | null> {
    const store = await this.readStore();
    const normalizedFingerprint = goalShareFingerprintStoreKey({
      tokenFingerprint: tokenFingerprint.trim()
    });
    const share = store.goalShares.find(
      (candidate) => goalShareFingerprintStoreKey(candidate) === normalizedFingerprint
    );
    return share ? GoalShareRecordSchema.parse(clone(share)) : null;
  }

  async saveGoalShare(share: GoalShareRecord): Promise<GoalShareRecord> {
    return this.withMutationLock(async () => {
      const store = await this.readStore();
      const validated = GoalShareRecordSchema.parse({
        ...share,
        tokenFingerprint: goalShareFingerprintStoreKey(share)
      });
      const goal = goalByIdFromStore(store, validated.goalId);

      if (!goal) {
        throw new Error(`Goal ${validated.goalId} was not found.`);
      }

      if (!isGoalShareVisibleToUser(store, validated, validated.userId)) {
        throw new Error(`User ${validated.userId} cannot manage shares for goal ${validated.goalId}.`);
      }

      store.goalShares = upsertById(store.goalShares, validated);
      await this.writeStore(store);
      return GoalShareRecordSchema.parse(clone(validated));
    });
  }

  async listPrivacyOperations(filters?: PrivacyOperationListFilters): Promise<PrivacyOperation[]> {
    const normalized = normalizePrivacyOperationFilters(filters);
    const store = await this.readStore();

    return [...store.privacyOperations]
      .filter((operation) => {
        if (!getWorkspaceMemberFromStore(store, operation.workspaceId, normalized.userId ?? SYSTEM_USER_ID)) {
          return false;
        }

        if (normalized.workspaceId && operation.workspaceId !== normalized.workspaceId) {
          return false;
        }

        if (normalized.kinds?.length && !normalized.kinds.includes(operation.kind)) {
          return false;
        }

        if (normalized.statuses?.length && !normalized.statuses.includes(operation.status)) {
          return false;
        }

        return true;
      })
      .sort((left, right) => right.createdAt.localeCompare(left.createdAt))
      .map((operation) => PrivacyOperationSchema.parse(clone(operation)));
  }

  async getPrivacyOperation(operationId: string, userId = SYSTEM_USER_ID): Promise<PrivacyOperation | null> {
    const store = await this.readStore();
    const operation = store.privacyOperations.find((candidate) => candidate.id === operationId);

    if (!operation) {
      return null;
    }

    assertWorkspaceMember(store, operation.workspaceId, userId);
    return PrivacyOperationSchema.parse(clone(operation));
  }

  async savePrivacyOperation(operation: PrivacyOperation): Promise<PrivacyOperation> {
    return this.withMutationLock(async () => {
      const store = await this.readStore();
      const validated = PrivacyOperationSchema.parse(operation);
      assertWorkspaceMember(store, validated.workspaceId, validated.userId);
      store.privacyOperations = upsertById(store.privacyOperations, validated);
      await this.writeStore(store);
      return PrivacyOperationSchema.parse(clone(validated));
    });
  }

  async enforceWorkspaceRetention(params: WorkspaceRetentionParams): Promise<Record<string, unknown>> {
    return this.withMutationLock(async () => {
      const store = await this.readStore();
      const workspace = assertWorkspaceExistsInStore(store, params.workspaceId);
      assertWorkspaceOwner(store, params.workspaceId, params.userId);
      const { effectiveNow, effectiveNowMs, retentionCutoff, retentionCutoffMs } = resolveRetentionWindow(
        params.retentionDays,
        params.now
      );
      const goalIds = workspaceGoalIdsFromStore(store, workspace);
      let revokedSharesCount = 0;
      let purgedSharesCount = 0;

      store.goalShares = store.goalShares.flatMap((share) => {
        if (!goalIds.has(share.goalId)) {
          return [share];
        }

        const shareExpiresAtMs = Date.parse(share.expiresAt);
        const hasExpired = Number.isFinite(shareExpiresAtMs) && shareExpiresAtMs <= effectiveNowMs;
        const terminalAtMs = Date.parse(goalShareTerminalAt(share));
        const isPurgeEligible = Number.isFinite(terminalAtMs) && terminalAtMs <= retentionCutoffMs;

        if (share.status === "active" && hasExpired) {
          revokedSharesCount += 1;
          return [
            GoalShareRecordSchema.parse({
              ...share,
              status: "revoked",
              revokedAt: share.revokedAt ?? effectiveNow,
              updatedAt: effectiveNow
            })
          ];
        }

        if (isPurgeEligible) {
          purgedSharesCount += 1;
          return [];
        }

        return [share];
      });

      await this.writeStore(store);

      return {
        workspaceId: params.workspaceId,
        retentionDays: params.retentionDays,
        enforcedAt: effectiveNow,
        retentionCutoff,
        goalCount: goalIds.size,
        revokedSharesCount,
        purgedSharesCount,
        remainingShareCount: store.goalShares.filter((share) => goalIds.has(share.goalId)).length
      };
    });
  }

  async deleteWorkspaceData(params: WorkspaceDeleteParams): Promise<Record<string, unknown>> {
    return this.withMutationLock(async () => {
      const store = await this.readStore();
      const workspace = assertWorkspaceExistsInStore(store, params.workspaceId);
      assertWorkspaceOwner(store, params.workspaceId, params.userId);

      if (workspace.isPersonal) {
        throw new Error(`Workspace ${params.workspaceId} is personal and cannot be deleted.`);
      }

      const effectiveNow = params.now ? new Date(Date.parse(params.now)).toISOString() : nowIso();
      const tombstone = buildDeletedWorkspaceTombstone(workspace, params.operationId, effectiveNow);
      const goalIds = workspaceGoalIdsFromStore(store, workspace);
      const workflowIds = new Set(
        store.workflows
          .filter((workflow) => workflow.workspaceId === workspace.id || goalIds.has(workflow.goalId))
          .map((workflow) => workflow.id)
      );
      const approvalIds = new Set(
        store.approvals.filter((approval) => goalIds.has(approval.goalId)).map((approval) => approval.id)
      );
      const watcherIds = new Set(
        store.watchers.filter((watcher) => goalIds.has(watcher.goalId)).map((watcher) => watcher.id)
      );
      const providerCredentialIds = new Set(
        store.providerCredentials
          .filter((credential) => credential.workspaceId === workspace.id)
          .map((credential) => `${credential.userId}:${credential.id}`)
      );
      const preservedOperation = store.privacyOperations.find((operation) => operation.id === params.operationId) ?? null;

      const countAndFilter = <T>(items: T[], predicate: (item: T) => boolean) => {
        const nextItems = items.filter((item) => !predicate(item));
        return {
          nextItems,
          removedCount: items.length - nextItems.length
        };
      };

      const goalsResult = countAndFilter(store.goals, (goal) => goalIds.has(goal.id));
      const workflowsResult = countAndFilter(
        store.workflows,
        (workflow) => workflow.workspaceId === workspace.id || goalIds.has(workflow.goalId)
      );
      const tasksResult = countAndFilter(
        store.tasks,
        (task) => goalIds.has(task.goalId) || workflowIds.has(task.workflowId)
      );
      const approvalsResult = countAndFilter(store.approvals, (approval) => goalIds.has(approval.goalId));
      const actionLogsResult = countAndFilter(
        store.actionLogs,
        (log) => goalIds.has(log.goalId) || (log.workflowId ? workflowIds.has(log.workflowId) : false)
      );
      const evidenceRecordsResult = countAndFilter(
        store.evidenceRecords,
        (record) => goalIds.has(record.goalId) || approvalIds.has(record.approvalId)
      );
      const watchersResult = countAndFilter(store.watchers, (watcher) => goalIds.has(watcher.goalId));
      const artifactsResult = countAndFilter(store.artifacts, (artifact) => goalIds.has(artifact.goalId));
      const goalSharesResult = countAndFilter(
        store.goalShares,
        (share) => goalIds.has(share.goalId) || share.workspaceId === workspace.id
      );
      const commitmentsResult = countAndFilter(
        store.commitments,
        (commitment) =>
          (commitment.goalId ? goalIds.has(commitment.goalId) : false) ||
          (commitment.approvalId ? approvalIds.has(commitment.approvalId) : false)
      );
      const autopilotEventsResult = countAndFilter(
        store.autopilotEvents,
        (event) =>
          watcherIds.has(event.sourceId) || (event.resultGoalId ? goalIds.has(event.resultGoalId) : false)
      );
      const jobsResult = countAndFilter(store.jobs, (job) =>
        isJobScopedToWorkspace(job, {
          workspaceId: workspace.id,
          goalIds,
          watcherIds,
          preservedPrivacyOperationId: preservedOperation?.id
        })
      );
      const providerCredentialsResult = countAndFilter(
        store.providerCredentials,
        (credential) => credential.workspaceId === workspace.id
      );
      const providerCredentialSecretsResult = countAndFilter(
        store.providerCredentialSecrets,
        (secret) => providerCredentialIds.has(`${secret.userId}:${secret.credentialId}`)
      );
      const workspaceSelectionsResult = countAndFilter(
        store.workspaceSelections,
        (selection) => selection.workspaceId === workspace.id
      );
      const workspaceGovernanceResult = countAndFilter(
        store.workspaceGovernance,
        (governance) => governance.workspaceId === workspace.id
      );

      store.goals = goalsResult.nextItems;
      store.workflows = workflowsResult.nextItems;
      store.tasks = tasksResult.nextItems;
      store.approvals = approvalsResult.nextItems;
      store.actionLogs = actionLogsResult.nextItems;
      store.evidenceRecords = evidenceRecordsResult.nextItems;
      store.watchers = watchersResult.nextItems;
      store.artifacts = artifactsResult.nextItems;
      store.goalShares = goalSharesResult.nextItems;
      store.commitments = commitmentsResult.nextItems;
      store.autopilotEvents = autopilotEventsResult.nextItems;
      store.jobs = jobsResult.nextItems;
      store.providerCredentials = providerCredentialsResult.nextItems;
      store.providerCredentialSecrets = providerCredentialSecretsResult.nextItems;
      store.workspaceSelections = workspaceSelectionsResult.nextItems;
      store.workspaceGovernance = workspaceGovernanceResult.nextItems;
      store.workspaceMembers = store.workspaceMembers.filter(
        (member) => member.workspaceId !== workspace.id || member.userId === workspace.ownerUserId
      );
      store.workspaces = upsertById(store.workspaces, tombstone);

      await this.writeStore(store);

      return {
        workspaceId: workspace.id,
        deletedAt: effectiveNow,
        operationId: params.operationId,
        deletedGoalCount: goalsResult.removedCount,
        deletedWorkflowCount: workflowsResult.removedCount,
        deletedTaskCount: tasksResult.removedCount,
        deletedApprovalCount: approvalsResult.removedCount,
        deletedActionLogCount: actionLogsResult.removedCount,
        deletedEvidenceRecordCount: evidenceRecordsResult.removedCount,
        deletedWatcherCount: watchersResult.removedCount,
        deletedArtifactCount: artifactsResult.removedCount,
        deletedGoalShareCount: goalSharesResult.removedCount,
        deletedCommitmentCount: commitmentsResult.removedCount,
        deletedAutopilotEventCount: autopilotEventsResult.removedCount,
        deletedJobCount: jobsResult.removedCount,
        deletedProviderCredentialCount: providerCredentialsResult.removedCount,
        deletedProviderCredentialSecretCount: providerCredentialSecretsResult.removedCount,
        deletedWorkspaceSelectionCount: workspaceSelectionsResult.removedCount,
        deletedWorkspaceGovernanceCount: workspaceGovernanceResult.removedCount,
        retainedWorkspaceMemberCount: store.workspaceMembers.filter((member) => member.workspaceId === workspace.id).length,
        tombstonedWorkspaceSlug: tombstone.slug
      };
    });
  }

  async saveWorkspaceGovernance(governance: WorkspaceGovernance, actor: ActorContext): Promise<WorkspaceGovernance> {
    return this.withMutationLock(async () => {
      const store = await this.readStore();
      const validated = WorkspaceGovernanceSchema.parse(governance);
      const actorUserId = subjectUserIdForActor(actor);
      assertWorkspaceOwner(store, validated.workspaceId, actorUserId);
      store.workspaceGovernance = upsertByKey(store.workspaceGovernance, validated, (item) => item.workspaceId);
      await this.writeStore(store);
      return WorkspaceGovernanceSchema.parse(clone(validated));
    });
  }

  async exportWorkspaceAudit(workspaceId: string, userId = SYSTEM_USER_ID): Promise<WorkspaceAuditExport> {
    const store = await this.readStore();
    const workspace = assertWorkspaceExistsInStore(store, workspaceId);
    assertWorkspaceMember(store, workspaceId, userId);
    const members = listWorkspaceMembersForWorkspaceFromStore(store, workspaceId);
    const governance = store.workspaceGovernance.find((candidate) => candidate.workspaceId === workspaceId) ?? null;
    const goals = visibleGoalsForUser(store, userId)
      .filter((goal) => goal.workspaceId === workspaceId || (!goal.workspaceId && workspace.isPersonal && goal.userId === userId))
      .map((goal) => bundleFromStore(store, goal.id))
      .filter((bundle): bundle is GoalBundle => bundle !== null)
      .map((bundle) => GoalBundleSchema.parse(clone(bundle)));
    const goalIds = new Set(goals.map((bundle) => bundle.goal.id));
    const goalShares = store.goalShares
      .filter((share) => goalIds.has(share.goalId))
      .map((share) => GoalShareRecordSchema.parse(clone(share)));
    const privacyOperations = store.privacyOperations
      .filter((operation) => operation.workspaceId === workspaceId)
      .map((operation) => PrivacyOperationSchema.parse(clone(operation)));
    const auditExport = buildWorkspaceAuditExport({
      workspace,
      governance,
      members,
      goals,
      goalShares,
      privacyOperations
    });

    await this.savePrivacyOperation({
      id: `privacy-export-${crypto.randomUUID()}`,
      workspaceId,
      userId,
      kind: "workspace_export",
      status: "completed",
      requestedBy: userId,
      actorContext: createSystemActorContext(userId),
      jobId: null,
      details: {},
      result: {
        fileName: auditExport.fileName
      },
      startedAt: auditExport.generatedAt,
      completedAt: auditExport.generatedAt,
      error: null,
      createdAt: auditExport.generatedAt,
      updatedAt: auditExport.generatedAt
    });

    return auditExport;
  }

  async saveGoalBundle(bundle: GoalBundle): Promise<GoalBundle> {
    return this.withMutationLock(async () => {
      const store = await this.readStore();
      if (bundle.goal.workspaceId) {
        assertWorkspaceExistsInStore(store, bundle.goal.workspaceId);
      }
      const validated = mergeGoalBundleIntoStore(store, bundle);
      await this.writeStore(store);
      return GoalBundleSchema.parse(clone(validated));
    });
  }

  async appendGoalActionLogs(goalId: string, logs: ActionLog[]): Promise<ActionLog[]> {
    return this.withMutationLock(async () =>
      appendGoalActionLogsToStore(await this.readStore(), goalId, logs, (store) => this.writeStore(store)));
  }

  async respondToApproval(params: {
    approvalId: string;
    decision: Exclude<ApprovalDecision, "pending">;
    actor: ActorContext;
    scope?: ApprovalDecisionScope;
    rationale?: string | null;
  }): Promise<GoalBundle> {
    return this.withMutationLock(async () => {
      const actor = parseActorContext(params.actor);
      const userId = subjectUserIdForActor(actor);
      const store = await this.readStore();
      const goalIds = goalIdsForUser(store, userId);
      const approval = store.approvals.find(
        (candidate) => candidate.id === params.approvalId && goalIds.has(candidate.goalId)
      );

      if (!approval) {
        throw new ApprovalMutationError("not_found", `Approval ${params.approvalId} was not found.`);
      }

      if (approval.decision !== "pending") {
        throw new ApprovalMutationError("already_handled", `Approval ${params.approvalId} has already been handled.`);
      }

      if (Date.parse(approval.expiryAt) <= Date.now()) {
        throw new ApprovalMutationError("expired", `Approval ${params.approvalId} has expired and can no longer be actioned.`);
      }

      const bundle = bundleFromStore(store, approval.goalId);

      if (!bundle) {
        throw new ApprovalMutationError("not_found", `Approval ${params.approvalId} was not found.`);
      }

      assertSharedApprovalResponder(store, bundle.goal, userId, params.approvalId);
      const { updatedBundle, parsedBundle, evidenceRecord } = buildApprovalResponseMutation({
        bundle,
        approvalId: params.approvalId,
        decision: params.decision,
        actor,
        scope: params.scope,
        rationale: params.rationale
      });

      mergeGoalBundleIntoStore(store, updatedBundle);
      store.evidenceRecords = upsertById(store.evidenceRecords, evidenceRecord);
      await this.writeStore(store);
      return parsedBundle;
    });
  }

  async respondToApprovalAndEnqueueJob(params: {
    approvalId: string;
    decision: Exclude<ApprovalDecision, "pending">;
    actor: ActorContext;
    scope?: ApprovalDecisionScope;
    rationale?: string | null;
    buildJob: (bundle: GoalBundle) => JobRecord;
  }): Promise<{ bundle: GoalBundle; job: JobRecord }> {
    return this.withMutationLock(async () => {
      const actor = parseActorContext(params.actor);
      const userId = subjectUserIdForActor(actor);
      const store = await this.readStore();
      const goalIds = goalIdsForUser(store, userId);
      const approval = store.approvals.find(
        (candidate) => candidate.id === params.approvalId && goalIds.has(candidate.goalId)
      );

      if (!approval) {
        throw new ApprovalMutationError("not_found", `Approval ${params.approvalId} was not found.`);
      }

      if (approval.decision !== "pending") {
        throw new ApprovalMutationError("already_handled", `Approval ${params.approvalId} has already been handled.`);
      }

      if (Date.parse(approval.expiryAt) <= Date.now()) {
        throw new ApprovalMutationError("expired", `Approval ${params.approvalId} has expired and can no longer be actioned.`);
      }

      const bundle = bundleFromStore(store, approval.goalId);

      if (!bundle) {
        throw new ApprovalMutationError("not_found", `Approval ${params.approvalId} was not found.`);
      }

      assertSharedApprovalResponder(store, bundle.goal, userId, params.approvalId);
      const { updatedBundle, parsedBundle, evidenceRecord } = buildApprovalResponseMutation({
        bundle,
        approvalId: params.approvalId,
        decision: params.decision,
        actor,
        scope: params.scope,
        rationale: params.rationale
      });
      const validatedJob = JobRecordSchema.parse(params.buildJob(parsedBundle));
      assertApprovalFollowUpJobOwner(validatedJob, userId);
      const trimmedKey = validatedJob.idempotencyKey?.trim() || null;
      const existingJob = trimmedKey
        ? store.jobs.find((candidate) => candidate.userId === validatedJob.userId && candidate.idempotencyKey === trimmedKey)
        : null;
      const savedJob = existingJob
        ? JobRecordSchema.parse(clone(existingJob))
        : JobRecordSchema.parse({
            ...validatedJob,
            idempotencyKey: trimmedKey
          });

      mergeGoalBundleIntoStore(store, updatedBundle);
      store.evidenceRecords = upsertById(store.evidenceRecords, evidenceRecord);

      if (!existingJob) {
        store.jobs = upsertById(store.jobs, savedJob);
      }

      await this.writeStore(store);
      return {
        bundle: parsedBundle,
        job: JobRecordSchema.parse(clone(savedJob))
      };
    });
  }

  async getGoalBundle(goalId: string): Promise<GoalBundle | null> {
    const bundle = bundleFromStore(await this.readStore(), goalId);
    return bundle ? GoalBundleSchema.parse(clone(bundle)) : null;
  }

  async getGoalBundleForUser(goalId: string, userId = SYSTEM_USER_ID): Promise<GoalBundle | null> {
    const store = await this.readStore();
    const bundle = bundleFromStore(store, goalId);

    if (!bundle) {
      return null;
    }

    const workspaceIds = workspaceIdsForUser(store, userId);

    if (!isGoalVisibleToUser(bundle.goal, workspaceIds, userId)) {
      return null;
    }

    return GoalBundleSchema.parse(clone(bundle));
  }

  async listGoals(userId = SYSTEM_USER_ID): Promise<GoalBundle[]> {
    const store = await this.readStore();

    return sortByCreatedDesc(visibleGoalsForUser(store, userId))
      .map((goal) => bundleFromStore(store, goal.id))
      .filter((bundle): bundle is GoalBundle => bundle !== null)
      .map((bundle) => GoalBundleSchema.parse(clone(bundle)));
  }

  async listGoalsPage(params?: GoalPageParams): Promise<GoalBundlePage> {
    const userId = params?.userId ?? SYSTEM_USER_ID;
    const store = await this.readStore();
    const workspaceIds = workspaceIdsForUser(store, userId);
    const visibleGoals = store.goals.filter((goal) => {
      if (!isGoalVisibleToUser(goal, workspaceIds, userId)) {
        return false;
      }

      if (params?.workspaceId === undefined) {
        return true;
      }

      return goal.workspaceId === params.workspaceId;
    });
    const bundles = visibleGoals
      .map((goal) => bundleFromStore(store, goal.id))
      .filter((bundle): bundle is GoalBundle => bundle !== null)
      .map((bundle) => GoalBundleSchema.parse(clone(bundle)));

    return buildCollectionPage({
      items: bundles,
      limit: params?.limit,
      cursor: params?.cursor,
      getCursorKey: (bundle) => ({
        createdAt: bundle.goal.createdAt,
        id: bundle.goal.id
      }),
      parsePage: (page) => GoalBundlePageSchema.parse(page)
    });
  }

  async listApprovals(userId = SYSTEM_USER_ID): Promise<ApprovalRequest[]> {
    const store = await this.readStore();
    const goalIds = goalIdsForUser(store, userId);

    return sortByCreatedDesc(store.approvals.filter((approval) => goalIds.has(approval.goalId))).map((approval) =>
      ApprovalRequestSchema.parse(clone(approval))
    );
  }

  async listEvidenceRecords(params?: { userId?: string; goalId?: string; approvalId?: string; limit?: number }): Promise<EvidenceRecord[]> {
    const userId = params?.userId ?? SYSTEM_USER_ID;
    const store = await this.readStore();
    const goalIds = goalIdsForUser(store, userId);
    const limit = normalizeProvenanceCollectionLimit(params?.limit);

    const records = sortByCreatedDesc(
      store.evidenceRecords.filter((record) => {
        if (record.userId !== userId || !goalIds.has(record.goalId)) {
          return false;
        }

        if (params?.goalId && record.goalId !== params.goalId) {
          return false;
        }

        if (params?.approvalId && record.approvalId !== params.approvalId) {
          return false;
        }

        return true;
      })
    );

    return (limit === null ? records : records.slice(0, limit)).map((record) => EvidenceRecordSchema.parse(clone(record)));
  }

  async listCommitments(userId = SYSTEM_USER_ID): Promise<Commitment[]> {
    const store = await this.readStore();
    return sortCommitments(
      store.commitments
        .filter((commitment) => commitment.userId === userId)
        .map((commitment) => CommitmentSchema.parse(clone(commitment)))
    );
  }

  async listCommitmentInbox(params?: {
    userId?: string;
    bucket?: CommitmentInboxBucket;
    limit?: number;
    cursor?: string | null;
  }): Promise<CommitmentInboxPage> {
    const userId = params?.userId ?? SYSTEM_USER_ID;
    const [goals, approvals, persisted] = await Promise.all([
      this.listGoals(userId),
      this.listApprovals(userId),
      this.listCommitments(userId)
    ]);

    return buildCommitmentInboxPage({
      commitments: mergeCommitments({
        goals,
        approvals,
        persisted,
        userId
      }),
      bucket: params?.bucket,
      limit: params?.limit,
      cursor: params?.cursor
    });
  }

  async getCommitment(commitmentId: string, userId = SYSTEM_USER_ID): Promise<Commitment | null> {
    const dashboard = await this.getDashboardData(userId);
    const commitment = dashboard.commitments.find((candidate) => candidate.id === commitmentId);
    return commitment ? CommitmentSchema.parse(clone(commitment)) : null;
  }

  async saveCommitment(commitment: Commitment): Promise<Commitment> {
    return this.withMutationLock(async () => {
      const store = await this.readStore();
      const validated = CommitmentSchema.parse(commitment);
      store.commitments = upsertById(store.commitments, validated);
      await this.writeStore(store);
      return CommitmentSchema.parse(clone(validated));
    });
  }

  async deleteCommitment(commitmentId: string, userId = SYSTEM_USER_ID): Promise<void> {
    await this.withMutationLock(async () => {
      const store = await this.readStore();
      store.commitments = store.commitments.filter(
        (commitment) => !(commitment.id === commitmentId && commitment.userId === userId)
      );
      await this.writeStore(store);
    });
  }

  async getBriefingPreferences(userId = SYSTEM_USER_ID): Promise<BriefingPreferences> {
    const store = await this.readStore();
    const preferences = store.briefingPreferences.find((candidate) => candidate.userId === userId);
    return BriefingPreferencesSchema.parse(clone(preferences ?? defaultBriefingPreferences(userId)));
  }

  async saveBriefingPreferences(preferences: BriefingPreferences): Promise<BriefingPreferences> {
    return this.withMutationLock(async () => {
      const store = await this.readStore();
      const validated = BriefingPreferencesSchema.parse(preferences);
      store.briefingPreferences = upsertByKey(store.briefingPreferences, validated, (item) => item.userId);
      await this.writeStore(store);
      return BriefingPreferencesSchema.parse(clone(validated));
    });
  }

  async getAutopilotSettings(userId = SYSTEM_USER_ID): Promise<AutopilotSettings> {
    const store = await this.readStore();
    const settings = store.autopilotSettings.find((candidate) => candidate.userId === userId);
    return AutopilotSettingsSchema.parse(clone(settings ?? defaultAutopilotSettings(userId)));
  }

  async saveAutopilotSettings(settings: AutopilotSettings): Promise<AutopilotSettings> {
    return this.withMutationLock(async () => {
      const store = await this.readStore();
      const validated = AutopilotSettingsSchema.parse(settings);
      store.autopilotSettings = upsertByKey(store.autopilotSettings, validated, (item) => item.userId);
      await this.writeStore(store);
      return AutopilotSettingsSchema.parse(clone(validated));
    });
  }

  async listAutopilotEvents(userId = SYSTEM_USER_ID): Promise<AutopilotEvent[]> {
    const store = await this.readStore();
    return sortByCreatedDesc(store.autopilotEvents.filter((event) => event.userId === userId)).map((event) =>
      AutopilotEventSchema.parse(clone(event))
    );
  }

  async listAutopilotEventsPage(params?: CollectionPageParams): Promise<AutopilotEventPage> {
    const userId = params?.userId ?? SYSTEM_USER_ID;
    const store = await this.readStore();
    const events = store.autopilotEvents
      .filter((event) => event.userId === userId)
      .map((event) => AutopilotEventSchema.parse(clone(event)));

    return buildCollectionPage({
      items: events,
      limit: params?.limit,
      cursor: params?.cursor,
      getCursorKey: (event) => ({
        createdAt: event.createdAt,
        id: event.id
      }),
      parsePage: (page) => AutopilotEventPageSchema.parse(page)
    });
  }

  async claimAutopilotEvent(params: {
    userId?: string;
    kind: AutopilotEventKind;
    sourceId: string;
    idempotencyKey?: string | null;
    mode: AutopilotMode;
    summary: string;
    details?: AutopilotEventDetails | Record<string, unknown>;
    actorContext?: ActorContext | null;
    debounceMinutes: number;
    reliabilityControls?: AutopilotSettings["reliabilityControls"];
  }): Promise<AutopilotEventClaim> {
    return this.withMutationLock(async () => {
      const userId = params.userId ?? SYSTEM_USER_ID;
      const store = await this.readStore();
      const trimmedKey = params.idempotencyKey?.trim() || null;
      const normalizedDetails = normalizeAutopilotEventDetails(params.details);
      const reliabilityControls = params.reliabilityControls ?? DEFAULT_AUTOPILOT_RELIABILITY_CONTROLS;

      if (trimmedKey) {
        const existing = store.autopilotEvents.find(
          (event) => event.userId === userId && event.idempotencyKey === trimmedKey
        );

        if (existing) {
          return {
            outcome: "duplicate",
            event: AutopilotEventSchema.parse(clone(existing))
          };
        }
      }

      const windowCutoff = Date.now() - Math.max(params.debounceMinutes, reliabilityControls.budgetWindowMinutes) * 60 * 1000;
      const recentEvents = sortByCreatedDesc(
        store.autopilotEvents.filter(
          (event) => event.userId === userId && Date.parse(event.createdAt) >= windowCutoff
        )
      );
      const budget = normalizedDetails.budget ? AutopilotEventBudgetSchema.parse(normalizedDetails.budget) : null;
      if (budget) {
        const budgetCutoff = Date.now() - budget.windowMinutes * 60 * 1000;
        const observedCount = store.autopilotEvents.filter((event) =>
          autopilotEventMatchesBudget({
            event,
            userId,
            sourceId: params.sourceId,
            budget,
            cutoffMs: budgetCutoff
          })
        ).length;

        if (observedCount >= budget.maxEvents) {
          const ignoredEvent = AutopilotEventSchema.parse({
            ...buildPendingAutopilotEvent({
              userId,
              kind: params.kind,
              sourceId: params.sourceId,
              idempotencyKey: trimmedKey,
              mode: params.mode,
              summary: params.summary,
              actorContext: params.actorContext,
              details: withAutopilotSuppression(normalizedDetails, {
                outcome: "budget_exhausted",
                reason: `Budget ${budget.key} exhausted in the active window.`,
                budgetKey: budget.key,
                observedCount
              })
            }),
            status: "ignored",
            processedAt: nowIso()
          });
          store.autopilotEvents = upsertById(store.autopilotEvents, ignoredEvent);
          await this.writeStore(store);
          return {
            outcome: "ignored",
            event: AutopilotEventSchema.parse(clone(ignoredEvent))
          };
        }
      }

      const debounceCutoff = Date.now() - params.debounceMinutes * 60 * 1000;
      const recent = recentEvents.find((event) => {
        if (event.userId !== userId || event.kind !== params.kind || event.sourceId !== params.sourceId) {
          return false;
        }

        if (!countsTowardAutopilotBudget(event.status) && event.status !== "debounced") {
          return false;
        }

        return Date.parse(event.createdAt) >= debounceCutoff;
      });

      if (recent) {
        const debouncedEvent = AutopilotEventSchema.parse({
          ...buildPendingAutopilotEvent({
            userId,
            kind: params.kind,
            sourceId: params.sourceId,
            idempotencyKey: trimmedKey,
            mode: params.mode,
            summary: params.summary,
            actorContext: params.actorContext,
            details: withAutopilotSuppression(
              {
                ...normalizedDetails,
                debouncedByEventId: recent.id
              },
              {
                outcome: "debounced",
                reason: "Suppressed by debounce window.",
                relatedEventId: recent.id
              }
            )
          }),
          status: "debounced",
          processedAt: nowIso()
        });
        store.autopilotEvents = upsertById(store.autopilotEvents, debouncedEvent);
        await this.writeStore(store);
        return {
          outcome: "debounced",
          event: AutopilotEventSchema.parse(clone(debouncedEvent))
        };
      }

      const controlDecision = evaluateAutopilotClaimControls({
        recentEvents: recentEvents.filter(
          (event) => Date.parse(event.createdAt) >= Date.now() - reliabilityControls.budgetWindowMinutes * 60 * 1000
        ),
        reliabilityControls
      });

      if (controlDecision.outcome === "suppress") {
        const suppressedEvent = buildSuppressedAutopilotEvent({
          userId,
          kind: params.kind,
          sourceId: params.sourceId,
          idempotencyKey: trimmedKey,
          mode: params.mode,
          summary: params.summary,
          actorContext: params.actorContext,
          details: params.details,
          suppression: {
            reason: controlDecision.reason,
            budgetWindowMinutes: reliabilityControls.budgetWindowMinutes,
            recentBudgetedEventCount: controlDecision.recentBudgetedEventCount,
            maxEventsPerWindow: reliabilityControls.maxEventsPerWindow,
            pendingEventCount: controlDecision.pendingEventCount,
            maxPendingEvents: reliabilityControls.maxPendingEvents,
            consecutiveFailureCount: controlDecision.consecutiveFailureCount,
            maxConsecutiveFailures: reliabilityControls.maxConsecutiveFailures
          }
        });
        store.autopilotEvents = upsertById(store.autopilotEvents, suppressedEvent);
        await this.writeStore(store);
        return {
          outcome: "suppressed",
          event: AutopilotEventSchema.parse(clone(suppressedEvent))
        };
      }

      const claimed = buildPendingAutopilotEvent({
        userId,
        kind: params.kind,
        sourceId: params.sourceId,
        idempotencyKey: trimmedKey,
        mode: params.mode,
        summary: params.summary,
        actorContext: params.actorContext,
        details: withAutopilotSuppression(normalizedDetails, {
          outcome: "allowed"
        })
      });

      store.autopilotEvents = upsertById(store.autopilotEvents, claimed);
      await this.writeStore(store);
      return {
        outcome: "claimed",
        event: AutopilotEventSchema.parse(clone(claimed))
      };
    });
  }

  async saveAutopilotEvent(event: AutopilotEvent): Promise<AutopilotEvent> {
    return this.withMutationLock(async () => {
      const store = await this.readStore();
      const validated = normalizeAutopilotEvent(event);
      store.autopilotEvents = upsertById(store.autopilotEvents, validated);
      await this.writeStore(store);
      return AutopilotEventSchema.parse(clone(validated));
    });
  }

  async listJobs(params?: { userId?: string; kinds?: JobKind[]; statuses?: JobStatus[]; limit?: number }): Promise<JobRecord[]> {
    const store = await this.readStore();
    const kinds = params?.kinds?.map((kind) => JobKindSchema.parse(kind)) ?? [];
    const statuses = params?.statuses?.map((status) => JobStatusSchema.parse(status)) ?? [];
    const workspaceIds = params?.userId ? workspaceIdsForUser(store, params.userId) : null;
    const limit = normalizeProvenanceCollectionLimit(params?.limit);

    const jobs = sortByCreatedDesc(
      store.jobs.filter((job) => {
        if (
          params?.userId &&
          !isJobVisibleToUserInStore(store, job, workspaceIds ?? new Set<string>(), params.userId)
        ) {
          return false;
        }

        if (kinds.length > 0 && !kinds.includes(job.kind)) {
          return false;
        }

        if (statuses.length > 0 && !statuses.includes(job.status)) {
          return false;
        }

        return true;
      })
    );

    return (limit === null ? jobs : jobs.slice(0, limit)).map((job) => JobRecordSchema.parse(clone(job)));
  }

  async getJob(jobId: string, userId = SYSTEM_USER_ID): Promise<JobRecord | null> {
    const store = await this.readStore();
    const workspaceIds = workspaceIdsForUser(store, userId);
    const job = store.jobs.find(
      (candidate) => candidate.id === jobId && isJobVisibleToUserInStore(store, candidate, workspaceIds, userId)
    );
    return job ? JobRecordSchema.parse(clone(job)) : null;
  }

  async enqueueJob(job: JobRecord): Promise<JobRecord> {
    return this.withMutationLock(async () => {
      const store = await this.readStore();
      const validated = JobRecordSchema.parse(job);
      const trimmedKey = validated.idempotencyKey?.trim() || null;

      if (trimmedKey) {
        const existing = store.jobs.find(
          (candidate) => candidate.userId === validated.userId && candidate.idempotencyKey === trimmedKey
        );

        if (existing) {
          return JobRecordSchema.parse(clone(existing));
        }
      }

      store.jobs = upsertById(store.jobs, {
        ...validated,
        idempotencyKey: trimmedKey
      });
      await this.writeStore(store);
      return JobRecordSchema.parse(clone(validated));
    });
  }

  async claimNextJob(params: {
    userId?: string;
    kinds?: JobKind[];
    queue?: string;
    runnerId: string;
    leaseMs: number;
    now?: string;
    concurrencyLimits?: JobConcurrencyLimits;
  }): Promise<JobRecord | null> {
    return this.withMutationLock(async () => {
      const store = await this.readStore();
      const claimed = claimNextJobFromStore(store, params);
      if (!claimed) {
        return null;
      }
      store.jobs = upsertById(store.jobs, claimed);
      await this.writeStore(store);
      return JobRecordSchema.parse(clone(claimed));
    });
  }

  async completeJob(params: {
    jobId: string;
    runnerId: string;
    completedAt?: string;
  }): Promise<JobRecord> {
    return this.withMutationLock(async () => {
      const store = await this.readStore();
      const existing = store.jobs.find((job) => job.id === params.jobId);

      if (!existing) {
        throw new JobMutationError("not_found", `Job ${params.jobId} does not exist.`);
      }

      const completedAt = params.completedAt ?? nowIso();
      assertRunningJobOwner(existing, params.runnerId, completedAt);
      const completed = JobRecordSchema.parse({
        ...existing,
        status: "completed",
        leaseExpiresAt: null,
        completedAt,
        journal: buildJobLifecycleJournal({
          job: existing,
          status: "completed",
          at: completedAt,
          summary: `Job completed successfully on attempt ${existing.attemptCount}.`
        }),
        updatedAt: completedAt
      });
      store.jobs = upsertById(store.jobs, completed);
      await this.writeStore(store);
      return JobRecordSchema.parse(clone(completed));
    });
  }

  async retryJob(params: {
    jobId: string;
    runnerId: string;
    failedAt?: string;
    availableAt: string;
    error: string;
  }): Promise<JobRecord> {
    return this.withMutationLock(async () => {
      const store = await this.readStore();
      const existing = store.jobs.find((job) => job.id === params.jobId);

      if (!existing) {
        throw new JobMutationError("not_found", `Job ${params.jobId} does not exist.`);
      }

      const updatedAt = params.failedAt ?? nowIso();
      assertRunningJobOwner(existing, params.runnerId, updatedAt);
      const trimmedError = params.error.trim().slice(0, 1000);
      const retried = JobRecordSchema.parse({
        ...existing,
        status: "retrying",
        claimedBy: null,
        claimedAt: null,
        leaseExpiresAt: null,
        availableAt: params.availableAt,
        lastError: trimmedError,
        journal: buildJobLifecycleJournal({
          job: existing,
          status: "retrying",
          at: updatedAt,
          summary: `Attempt ${existing.attemptCount} failed and retry ${existing.attemptCount + 1} was scheduled.`,
          error: trimmedError,
          metadata: {
            nextAvailableAt: params.availableAt
          },
          retryCount: existing.attemptCount
        }),
        updatedAt
      });
      store.jobs = upsertById(store.jobs, retried);
      await this.writeStore(store);
      return JobRecordSchema.parse(clone(retried));
    });
  }

  async releaseExpiredJobLease(params: {
    jobId: string;
    releasedAt: string;
    availableAt: string;
    error: string;
  }): Promise<JobRecord> {
    return this.withMutationLock(async () => {
      const store = await this.readStore();
      const existing = store.jobs.find((job) => job.id === params.jobId);

      if (!existing) {
        throw new JobMutationError("not_found", `Job ${params.jobId} does not exist.`);
      }

      const releasedAtMs = Date.parse(params.releasedAt);
      const leaseExpiresAtMs = existing.leaseExpiresAt ? Date.parse(existing.leaseExpiresAt) : Number.NaN;

      if (
        existing.status !== "running" ||
        !existing.claimedBy ||
        !Number.isFinite(releasedAtMs) ||
        !Number.isFinite(leaseExpiresAtMs) ||
        leaseExpiresAtMs > releasedAtMs
      ) {
        throw new JobMutationError("not_running", `Job ${existing.id} does not have an expired worker lease.`);
      }

      const trimmedError = params.error.trim().slice(0, 1000);
      const released = JobRecordSchema.parse({
        ...existing,
        status: "retrying",
        claimedBy: null,
        claimedAt: null,
        leaseExpiresAt: null,
        availableAt: params.availableAt,
        lastError: trimmedError,
        journal: buildJobLifecycleJournal({
          job: existing,
          status: "retrying",
          at: params.releasedAt,
          summary: `Expired lease claimed by ${existing.claimedBy} was released for retry.`,
          error: trimmedError,
          metadata: {
            releasedClaimedBy: existing.claimedBy,
            recoveryAction: "release_expired_lease",
            nextAvailableAt: params.availableAt
          },
          retryCount: existing.attemptCount
        }),
        updatedAt: params.releasedAt
      });
      store.jobs = upsertById(store.jobs, released);
      await this.writeStore(store);
      return JobRecordSchema.parse(clone(released));
    });
  }

  async deadLetterJob(params: {
    jobId: string;
    runnerId: string;
    deadLetteredAt?: string;
    error: string;
  }): Promise<JobRecord> {
    return this.withMutationLock(async () => {
      const store = await this.readStore();
      const existing = store.jobs.find((job) => job.id === params.jobId);

      if (!existing) {
        throw new JobMutationError("not_found", `Job ${params.jobId} does not exist.`);
      }

      const deadLetteredAt = params.deadLetteredAt ?? nowIso();
      assertRunningJobOwner(existing, params.runnerId, deadLetteredAt);
      const trimmedError = params.error.trim().slice(0, 1000);
      const deadLettered = JobRecordSchema.parse({
        ...existing,
        status: "dead_letter",
        leaseExpiresAt: null,
        deadLetteredAt,
        lastError: trimmedError,
        journal: buildJobLifecycleJournal({
          job: existing,
          status: "dead_letter",
          at: deadLetteredAt,
          summary: `Job dead-lettered after ${existing.attemptCount}/${existing.maxAttempts} attempts.`,
          error: trimmedError,
          retryCount: existing.attemptCount
        }),
        updatedAt: deadLetteredAt
      });
      store.jobs = upsertById(store.jobs, deadLettered);
      await this.writeStore(store);
      return JobRecordSchema.parse(clone(deadLettered));
    });
  }
  async listMemory(userId = SYSTEM_USER_ID): Promise<MemoryRecord[]> {
    const store = await this.readStore();
    return sortByCreatedDesc(store.memories.filter((memory) => memory.userId === userId)).map((memory) =>
      MemoryRecordSchema.parse(clone(memory))
    );
  }

  async listContextPacketMemory(params: {
    userId: string;
    agent?: AgentName;
    agentId?: string;
    includeExpired?: boolean;
    allowedSensitivities?: string[];
    limit?: number;
    now?: number;
  }): Promise<MemoryRecord[]> {
    const store = await this.readStore();
    return listContextPacketMemoryFromStore(store.memories, params);
  }

  async listMemoryPage(params?: CollectionPageParams): Promise<MemoryRecordPage> {
    const userId = params?.userId ?? SYSTEM_USER_ID;
    const store = await this.readStore();
    const memories = store.memories
      .filter((memory) => memory.userId === userId)
      .map((memory) => MemoryRecordSchema.parse(clone(memory)));

    return buildCollectionPage({
      items: memories,
      limit: params?.limit,
      cursor: params?.cursor,
      getCursorKey: (memory) => ({
        createdAt: memory.createdAt,
        id: memory.id
      }),
      parsePage: (page) => MemoryRecordPageSchema.parse(page)
    });
  }

  async saveMemory(record: MemoryRecord): Promise<MemoryRecord> {
    return this.withMutationLock(async () => {
      const store = await this.readStore();
      const validated = MemoryRecordSchema.parse(record);
      store.memories = upsertById(store.memories, validated);
      await this.writeStore(store);
      return MemoryRecordSchema.parse(clone(validated));
    });
  }

  async saveEvidenceRecord(record: EvidenceRecord): Promise<EvidenceRecord> {
    return this.withMutationLock(async () => {
      const store = await this.readStore();
      const validated = EvidenceRecordSchema.parse(record);
      const goal = store.goals.find((candidate) => candidate.id === validated.goalId);

      if (!goal) {
        throw new Error(`Goal ${validated.goalId} was not found.`);
      }

      const workspaceIds = workspaceIdsForUser(store, validated.userId);

      if (!isGoalVisibleToUser(goal, workspaceIds, validated.userId)) {
        throw new Error(`User ${validated.userId} cannot persist evidence for goal ${validated.goalId}.`);
      }

      store.evidenceRecords = upsertById(store.evidenceRecords, validated);
      await this.writeStore(store);
      return EvidenceRecordSchema.parse(clone(validated));
    });
  }

  async listWatchers(filters?: WatcherListFilters): Promise<Watcher[]> {
    const store = await this.readStore();
    const userId = filters?.userId ?? SYSTEM_USER_ID;
    const goalIds = goalIdsForUser(store, userId);
    const watchers = store.watchers.filter((watcher) => {
      if (!goalIds.has(watcher.goalId)) {
        return false;
      }

      return filters?.goalId ? watcher.goalId === filters.goalId : true;
    });

    return sortByCreatedDesc(watchers).map((watcher) => {
      const goal = goalByIdFromStore(store, watcher.goalId);

      return goal
        ? normalizeWatcherForGoal(goal, watcher)
        : WatcherSchema.parse(clone(watcher));
    });
  }

  async listWatchersPage(params?: WatcherPageParams): Promise<WatcherPage> {
    const store = await this.readStore();
    const userId = params?.userId ?? SYSTEM_USER_ID;
    const goalIds = goalIdsForUser(store, userId);
    const watchers = store.watchers
      .filter((watcher) => {
        if (!goalIds.has(watcher.goalId)) {
          return false;
        }

        return params?.goalId ? watcher.goalId === params.goalId : true;
      })
      .map((watcher) => {
        const goal = goalByIdFromStore(store, watcher.goalId);

        return goal
          ? normalizeWatcherForGoal(goal, watcher)
          : WatcherSchema.parse(clone(watcher));
      });

    return buildCollectionPage({
      items: watchers,
      limit: params?.limit,
      cursor: params?.cursor,
      getCursorKey: (watcher) => ({
        createdAt: watcher.createdAt,
        id: watcher.id
      }),
      parsePage: (page) => WatcherPageSchema.parse(page)
    });
  }

  async claimWatcherLease(params: WatcherLeaseClaimParams): Promise<Watcher | null> {
    return this.withMutationLock(async () => {
      const store = await this.readStore();
      const leased = claimWatcherLeaseInRuntimeStore({ watchers: store.watchers, visibleGoalIds: goalIdsForUser(store, params.userId ?? SYSTEM_USER_ID), lease: params, normalizeWatcher: (watcher) => {
        const goal = goalByIdFromStore(store, watcher.goalId);
        return goal ? normalizeWatcherForGoal(goal, watcher) : WatcherSchema.parse(clone(watcher));
      } });
      if (leased) {
        await this.writeStore(store);
      }
      return leased;
    });
  }

  async saveWatcher(watcher: Watcher): Promise<Watcher> {
    return this.withMutationLock(async () => {
      const store = await this.readStore();
      const validated = WatcherSchema.parse(watcher);
      const goal = goalByIdFromStore(store, validated.goalId);

      if (!goal) {
        throw new Error(`Goal ${validated.goalId} was not found.`);
      }

      const normalized = normalizeWatcherForGoal(goal, validated);
      store.watchers = upsertById(store.watchers, normalized);
      await this.writeStore(store);
      return WatcherSchema.parse(clone(normalized));
    });
  }

  async listIntegrations(userId = SYSTEM_USER_ID): Promise<IntegrationAccount[]> {
    const store = await this.readStore();
    return sortByCreatedDesc(store.integrations.filter((integration) => integration.userId === userId)).map((integration) =>
      IntegrationAccountSchema.parse(clone(integration))
    );
  }

  async listIntegrationsPage(params?: CollectionPageParams): Promise<IntegrationAccountPage> {
    const userId = params?.userId ?? SYSTEM_USER_ID;
    const store = await this.readStore();
    const integrations = store.integrations
      .filter((integration) => integration.userId === userId)
      .map((integration) => IntegrationAccountSchema.parse(clone(integration)));

    return buildCollectionPage({
      items: integrations,
      limit: params?.limit,
      cursor: params?.cursor,
      getCursorKey: (integration) => ({
        createdAt: integration.createdAt,
        id: integration.id
      }),
      parsePage: (page) => IntegrationAccountPageSchema.parse(page)
    });
  }

  async upsertIntegration(account: IntegrationAccount): Promise<IntegrationAccount> {
    return this.withMutationLock(async () => {
      const store = await this.readStore();
      const validated = IntegrationAccountSchema.parse(account);
      store.integrations = upsertByKey(store.integrations, validated, integrationStoreKey);
      await this.writeStore(store);
      return IntegrationAccountSchema.parse(clone(validated));
    });
  }

  async listProviderCredentials(userId = SYSTEM_USER_ID): Promise<ProviderCredential[]> {
    const store = await this.readStore();
    return [...store.providerCredentials]
      .filter((credential) => credential.userId === userId)
      .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))
      .map((credential) => ProviderCredentialSchema.parse(clone(credential)));
  }

  async getProviderCredential(credentialId: string, userId = SYSTEM_USER_ID): Promise<ProviderCredential | null> {
    const store = await this.readStore();
    const credential = store.providerCredentials.find((candidate) => candidate.id === credentialId && candidate.userId === userId);
    return credential ? ProviderCredentialSchema.parse(clone(credential)) : null;
  }

  async saveProviderCredential(credential: ProviderCredential): Promise<ProviderCredential> {
    return this.withMutationLock(async () => {
      const store = await this.readStore();
      const validated = ProviderCredentialSchema.parse(credential);
      store.providerCredentials = upsertByKey(store.providerCredentials, validated, providerCredentialStoreKey);
      store.integrations = syncGoogleManagedIntegrations(store.integrations, validated);
      await this.writeStore(store);
      return ProviderCredentialSchema.parse(clone(validated));
    });
  }

  async getProviderCredentialSecret(
    credentialId: string,
    kind: ProviderCredentialSecretKind,
    userId = SYSTEM_USER_ID
  ): Promise<ProviderCredentialSecretRecord | null> {
    const store = await this.readStore();
    const record = store.providerCredentialSecrets.find(
      (candidate) => candidate.credentialId === credentialId && candidate.kind === kind && candidate.userId === userId
    );
    return record ? ProviderCredentialSecretRecordSchema.parse(clone(record)) : null;
  }

  async saveProviderCredentialSecret(record: ProviderCredentialSecretRecord): Promise<ProviderCredentialSecretRecord> {
    return this.withMutationLock(async () => {
      const store = await this.readStore();
      const validated = ProviderCredentialSecretRecordSchema.parse(record);
      const credential = store.providerCredentials.find(
        (candidate) => candidate.id === validated.credentialId && candidate.userId === validated.userId
      );

      if (!credential) {
        throw new Error(`Provider credential ${validated.credentialId} was not found for user ${validated.userId}.`);
      }

      store.providerCredentialSecrets = upsertByKey(
        store.providerCredentialSecrets,
        validated,
        providerCredentialSecretStoreKey
      );
      await this.writeStore(store);
      return ProviderCredentialSecretRecordSchema.parse(clone(validated));
    });
  }

  async reserveProviderSideEffect(params: ReserveProviderSideEffectParams): Promise<ProviderSideEffectRecord> {
    return this.withMutationLock(async () => {
      const store = await this.readStore();
      const record = reserveProviderSideEffectInStore(store, params);
      await this.writeStore(store);
      return record;
    });
  }

  async updateProviderSideEffect(params: UpdateProviderSideEffectParams): Promise<ProviderSideEffectRecord> {
    return this.withMutationLock(async () => {
      const store = await this.readStore();
      const record = updateProviderSideEffectInStore(store, params);
      await this.writeStore(store);
      return record;
    });
  }

  async listTemplates(userId = SYSTEM_USER_ID): Promise<GoalTemplate[]> {
    const store = await this.readStore();
    return sortByCreatedDesc(store.templates.filter((template) => template.userId === userId)).map((template) =>
      GoalTemplateSchema.parse(clone(template))
    );
  }

  async saveTemplate(template: GoalTemplate): Promise<GoalTemplate> {
    return this.withMutationLock(async () => {
      const store = await this.readStore();
      const validated = GoalTemplateSchema.parse(template);
      store.templates = upsertById(store.templates, validated);
      await this.writeStore(store);
      return GoalTemplateSchema.parse(clone(validated));
    });
  }

  async deleteTemplate(templateId: string): Promise<void> {
    await this.withMutationLock(async () => {
      const store = await this.readStore();
      store.templates = store.templates.filter((template) => template.id !== templateId);
      await this.writeStore(store);
    });
  }

  async listWorkflowTemplates(userId = SYSTEM_USER_ID): Promise<WorkflowCanvasTemplate[]> {
    const store = await this.readStore();
    return [...store.workflowTemplates]
      .filter((template) => template.userId === userId)
      .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))
      .map((template) => WorkflowCanvasTemplateSchema.parse(clone(template)));
  }

  async getWorkflowTemplate(templateId: string, userId = SYSTEM_USER_ID): Promise<WorkflowCanvasTemplate | null> {
    const store = await this.readStore();
    const template = store.workflowTemplates.find((candidate) => candidate.id === templateId && candidate.userId === userId);
    return template ? WorkflowCanvasTemplateSchema.parse(clone(template)) : null;
  }

  async saveWorkflowTemplate(template: WorkflowCanvasTemplate): Promise<WorkflowCanvasTemplate> {
    return this.withMutationLock(async () => {
      const store = await this.readStore();
      const validated = WorkflowCanvasTemplateSchema.parse(template);
      store.workflowTemplates = upsertById(store.workflowTemplates, validated);
      await this.writeStore(store);
      return WorkflowCanvasTemplateSchema.parse(clone(validated));
    });
  }

  async deleteWorkflowTemplate(templateId: string, userId = SYSTEM_USER_ID): Promise<void> {
    await this.withMutationLock(async () => {
      const store = await this.readStore();
      store.workflowTemplates = store.workflowTemplates.filter(
        (template) => !(template.id === templateId && template.userId === userId)
      );
      await this.writeStore(store);
    });
  }

  async listOperatorProducts(userId = SYSTEM_USER_ID): Promise<OperatorProduct[]> {
    const store = await this.readStore();
    const products = uniqueById([
      ...defaultOperatorProducts(userId),
      ...store.operatorProducts.filter((product) => product.userId === userId || product.isBuiltIn)
    ]);
    return products.map((product) => OperatorProductSchema.parse(clone(product)));
  }

  async getOperatorProductSelection(userId = SYSTEM_USER_ID): Promise<OperatorProductSelection | null> {
    const store = await this.readStore();
    const selection = store.operatorProductSelections.find((candidate) => candidate.userId === userId);
    return selection ? OperatorProductSelectionSchema.parse(clone(selection)) : null;
  }

  async saveOperatorProduct(product: OperatorProduct): Promise<OperatorProduct> {
    return this.withMutationLock(async () => {
      const store = await this.readStore();
      const validated = OperatorProductSchema.parse(product);
      store.operatorProducts = upsertById(store.operatorProducts, validated);
      await this.writeStore(store);
      return OperatorProductSchema.parse(clone(validated));
    });
  }

  async saveOperatorProductSelection(selection: OperatorProductSelection): Promise<OperatorProductSelection> {
    return this.withMutationLock(async () => {
      const store = await this.readStore();
      const validated = OperatorProductSelectionSchema.parse(selection);
      const product = store.operatorProducts.find(
        (candidate) =>
          candidate.id === validated.operatorProductId &&
          (candidate.userId === validated.userId || candidate.isBuiltIn)
      );

      if (!product) {
        throw new Error(`Operator product ${validated.operatorProductId} was not found.`);
      }

      store.operatorProductSelections = [
        ...store.operatorProductSelections.filter((candidate) => candidate.userId !== validated.userId),
        validated
      ];
      await this.writeStore(store);
      return OperatorProductSelectionSchema.parse(clone(validated));
    });
  }

  async listAgents(userId = SYSTEM_USER_ID): Promise<AgentDefinition[]> {
    const store = await this.readStore();
    const agents = store.agents.filter((agent) => agent.userId === userId || agent.isBuiltIn);
    return agents.map((agent) => AgentDefinitionSchema.parse(clone(agent)));
  }

  async getAgent(agentId: string, userId = SYSTEM_USER_ID): Promise<AgentDefinition | null> {
    const store = await this.readStore();
    const agent = resolveAgentFromDefinitions(store.agents, agentId, userId);
    return agent ? AgentDefinitionSchema.parse(clone(agent)) : null;
  }

  async saveAgent(agent: AgentDefinition): Promise<AgentDefinition> {
    return this.withMutationLock(async () => {
      const store = await this.readStore();
      const validated = AgentDefinitionSchema.parse(agent);
      store.agents = upsertById(store.agents, validated);
      await this.writeStore(store);
      return AgentDefinitionSchema.parse(clone(validated));
    });
  }

  async deleteAgent(agentId: string, userId = SYSTEM_USER_ID): Promise<void> {
    await this.withMutationLock(async () => {
      const store = await this.readStore();
      const agent = resolveAgentFromDefinitions(store.agents, agentId, userId);

      if (agent?.isBuiltIn) {
        throw new Error("Cannot delete a built-in agent");
      }

      if (!agent) {
        return;
      }

      store.agents = store.agents.filter((a) => a.id !== agent.id);
      store.agentMetrics = store.agentMetrics.filter((m) => m.agentId !== agent.id);
      await this.writeStore(store);
    });
  }

  async getAgentMetrics(
    agentId: string,
    period: "day" | "week" | "month" | "all" = "all",
    userId = SYSTEM_USER_ID
  ): Promise<AgentMetrics | null> {
    const store = await this.readStore();
    const agent = resolveAgentFromDefinitions(store.agents, agentId, userId);

    if (!agent) {
      return null;
    }

    const goals = sortByCreatedDesc(store.goals.filter((goal) => goal.userId === agent.userId))
      .map((goal) => bundleFromStore(store, goal.id))
      .filter((bundle): bundle is GoalBundle => bundle !== null);
    const storedMetrics =
      store.agentMetrics.find((metric) => metric.agentId === agent.id && metric.period === period) ?? null;

    return AgentMetricsSchema.parse(
      clone(
        deriveAgentMetricsFromGoals({
          agent,
          period,
          goals,
          evidenceRecords: store.evidenceRecords.filter((record) => record.userId === agent.userId),
          storedMetrics
        })
      )
    );
  }

  async saveAgentMetrics(metrics: AgentMetrics): Promise<AgentMetrics> {
    return this.withMutationLock(async () => {
      const store = await this.readStore();
      const validated = AgentMetricsSchema.parse(metrics);
      const key = `${validated.agentId}:${validated.period}`;
      const existingIndex = store.agentMetrics.findIndex((m) => `${m.agentId}:${m.period}` === key);

      if (existingIndex >= 0) {
        store.agentMetrics[existingIndex] = validated;
      } else {
        store.agentMetrics.push(validated);
      }

      await this.writeStore(store);
      return AgentMetricsSchema.parse(clone(validated));
    });
  }

  async getDashboardData(userId = SYSTEM_USER_ID): Promise<DashboardData> {
    const store = await this.readStore();
    const { activeWorkspace, workspaceSelection } = resolveActiveWorkspaceFromStore(store, userId);
    const workspaces = listWorkspacesForUserFromStore(store, userId);
    const goals = filterBundlesForWorkspace(
      sortByCreatedDesc(visibleGoalsForUser(store, userId))
        .map((goal) => bundleFromStore(store, goal.id))
        .filter((bundle): bundle is GoalBundle => bundle !== null)
        .map((bundle) => GoalBundleSchema.parse(clone(bundle))),
      activeWorkspace,
      userId
    ).slice(0, DASHBOARD_GOAL_LIMIT);
    const goalIds = new Set(goals.map((bundle) => bundle.goal.id));
    const approvals = sortByCreatedDesc(goals.flatMap((bundle) => bundle.approvals));
    const evidenceRecords = sortByCreatedDesc(
      store.evidenceRecords.filter((record) => record.userId === userId && goalIds.has(record.goalId))
    ).map((record) => EvidenceRecordSchema.parse(clone(record)));
    const watchers = sortByCreatedDesc(goals.flatMap((bundle) => bundle.watchers));
    const [
      commitments,
      briefingPreferences,
      autopilotSettings,
      autopilotEventsPage,
      memoryPage,
      integrationsPage,
      goalShares,
      jobs,
      providerCredentials
    ] =
      await Promise.all([
        this.listCommitments(userId),
        this.getBriefingPreferences(userId),
        this.getAutopilotSettings(userId),
        this.listAutopilotEventsPage({ userId, limit: DASHBOARD_AUTOPILOT_EVENT_LIMIT }),
        this.listMemoryPage({ userId, limit: DASHBOARD_MEMORY_LIMIT }),
        this.listIntegrationsPage({ userId, limit: DASHBOARD_INTEGRATION_LIMIT }),
        this.listGoalShares({ userId }),
        this.listJobs({
          userId,
          statuses: ["queued", "running", "retrying", "dead_letter"]
        }),
        this.listProviderCredentials(userId)
      ]);
    const workspaceMembers = activeWorkspace ? listWorkspaceMembersForWorkspaceFromStore(store, activeWorkspace.id) : [];
    const workspaceGovernance = activeWorkspace
      ? (store.workspaceGovernance.find((governance) => governance.workspaceId === activeWorkspace.id) ?? null)
      : null;
    const privacyOperations = activeWorkspace
      ? store.privacyOperations
          .filter((operation) => operation.workspaceId === activeWorkspace.id)
          .map((operation) => PrivacyOperationSchema.parse(clone(operation)))
      : [];
    return assembleDashboardData({
      userId,
      workspaces,
      activeWorkspace,
      workspaceSelection,
      workspaceMembers,
      workspaceGovernance,
      goalShares,
      privacyOperations,
      goals,
      approvals,
      evidenceRecords,
      commitments,
      briefingPreferences,
      autopilotSettings,
      autopilotEvents: autopilotEventsPage.items,
      memories: memoryPage.items,
      watchers,
      integrations: integrationsPage.items,
      jobs,
      providerCredentials,
      filterBundlesForWorkspace,
      mergeCommitments,
      buildDiagnostics: buildDashboardDiagnostics,
      buildOperations: buildDashboardOperationsTower,
      buildControlPlane: buildDashboardControlPlane,
      buildNowQueue,
      buildOperatingSections: buildDashboardOperatingSections,
      buildBriefingHistory,
      sortArtifacts: sortByCreatedDesc,
      sortActionLogs: sortByCreatedDesc
    });
  }

  async getLlmCache(key: string): Promise<LlmCacheEntry | null> {
    const store = await this.readStore();
    const entry = store.llmCache.find((candidate) => candidate.key === key);

    if (!entry || Date.parse(entry.expiresAt) <= Date.now()) {
      return null;
    }

    return LlmCacheEntrySchema.parse(clone(entry));
  }

  async setLlmCache(entry: LlmCacheEntry): Promise<void> {
    const validated = LlmCacheEntrySchema.parse(entry);

    await this.withMutationLock(async () => {
      const store = await this.readStore();
      store.llmCache = store.llmCache.filter((candidate) => candidate.key !== validated.key);
      store.llmCache.push(validated);
      await this.writeStore(store);
    });
  }
}
