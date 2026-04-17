import crypto from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { assertDatabaseSchemaReady, runDatabaseMigrations } from "@agentic/db";
import { Pool, type PoolClient } from "pg";
import { z } from "zod";
import {
  ActionLogSchema,
  ActionIntentSchema,
  AgentDefinitionSchema,
  AgentMetricsSchema,
  ActorContextSchema,
  AutopilotEventSchema,
  AutopilotSettingsSchema,
  type ApprovalDecision,
  type ApprovalDecisionScope,
  ApprovalDecisionScopeSchema,
  ApprovalDecisionRecordSchema,
  ApprovalPreviewSchema,
  ApprovalRequestSchema,
  ArtifactSchema,
  type AutopilotEvent,
  type AutopilotEventKind,
  type AutopilotMode,
  type AutopilotSettings,
  BriefingHistoryItemSchema,
  BriefingPreferencesSchema,
  briefingTypeValues,
  CommitmentSchema,
  DEFAULT_COLLECTION_PAGE_LIMIT,
  DEFAULT_COMMITMENT_INBOX_BUCKET,
  DEFAULT_COMMITMENT_INBOX_LIMIT,
  GoalBundlePageSchema,
  MAX_COMMITMENT_INBOX_LIMIT,
  MAX_COLLECTION_PAGE_LIMIT,
  MemoryRecordPageSchema,
  AutopilotEventPageSchema,
  commitmentInboxBucketValues,
  GoalBundleSchema,
  GoalSchema,
  GoalShareRecordSchema,
  GoalShareStatusSchema,
  GoalTemplateSchema,
  IntegrationAccountSchema,
  EncryptedSecretEnvelopeSchema,
  JobKindSchema,
  JobRecordSchema,
  JobStatusSchema,
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
  nowIso,
  type ActionLog,
  type AgentDefinition,
  type AgentMetrics,
  type ActorContext,
  type ApprovalRequest,
  type Artifact,
  type AutopilotEventPage,
  type BriefingHistoryItem,
  type BriefingPreferences,
  type BriefingType,
  type Commitment,
  type CommitmentInboxBucket,
  type CommitmentInboxPage,
  type DashboardOperatingSections,
  EvidenceRecordSchema,
  type CommitmentSuggestedAction,
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
  type PrivacyOperation,
  type PrivacyOperationKind,
  type PrivacyOperationStatus,
  type Provider,
  type ProviderCredential,
  type ProviderCredentialSecretKind,
  type ProviderCredentialSecretRecord,
  type JobKind,
  type JobRecord,
  type JobStatus,
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
import { respondToApproval as applyApprovalResponse } from "@agentic/orchestrator";
import { deriveAgentMetricsFromGoals } from "./agent-metrics";
import { assembleDashboardData } from "./dashboard-data";
import { buildDashboardOperatingSections } from "./dashboard-operating-sections";

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
  operatorProductSelections: z.array(OperatorProductSelectionSchema).default([])
});

type RuntimeStore = z.infer<typeof RuntimeStoreSchema>;

export type DashboardData = {
  workspaces: Workspace[];
  activeWorkspace: Workspace | null;
  workspaceSelection: WorkspaceSelection | null;
  workspaceMembers: WorkspaceMember[];
  workspaceGovernance: WorkspaceGovernance | null;
  goalShares: GoalShareRecord[];
  privacyOperations: PrivacyOperation[];
  controlPlane: DashboardControlPlane;
  operatingSections: DashboardOperatingSections;
  nowQueue: NowQueue;
  goals: GoalBundle[];
  approvals: ApprovalRequest[];
  commitments: Commitment[];
  briefingPreferences: BriefingPreferences;
  briefingHistory: BriefingHistoryItem[];
  autopilotSettings: AutopilotSettings;
  autopilotEvents: AutopilotEvent[];
  memories: MemoryRecord[];
  watchers: Watcher[];
  integrations: IntegrationAccount[];
  latestArtifacts: Artifact[];
  actionLogs: ActionLog[];
  diagnostics: DashboardDiagnostics;
};

export type DashboardDiagnosticKind =
  | "expired_approvals"
  | "stale_memories"
  | "stuck_workflows"
  | "orphan_watchers";

export type DashboardDiagnosticSeverity = "warning" | "critical";

export type DashboardDiagnosticSection = "goals" | "approvals" | "memory" | "watchers";

export type DashboardControlPlaneKey = "workspace" | "commitments" | "automation" | "execution" | "trust";

export type DashboardControlPlaneStatus = "healthy" | "attention" | "critical" | "idle";

export type DashboardControlPlaneSection = {
  key: DashboardControlPlaneKey;
  title: string;
  description: string;
  status: DashboardControlPlaneStatus;
  targetSection: string;
  targetItemId?: string;
  stats: string[];
  highlights: string[];
};

export type DashboardControlPlane = {
  generatedAt: string;
  sections: DashboardControlPlaneSection[];
};

export type DashboardDiagnosticTarget = {
  section: DashboardDiagnosticSection;
  itemId?: string;
  label: string;
  action?: "review_memory" | "pause_watcher";
  actionLabel?: string;
};

export type WorkspaceAuditExport = {
  workspaceId: string;
  fileName: string;
  contentType: string;
  content: string;
  generatedAt: string;
};

export type DashboardDiagnostic = {
  kind: DashboardDiagnosticKind;
  title: string;
  count: number;
  severity: DashboardDiagnosticSeverity;
  reasons: string[];
  targets: DashboardDiagnosticTarget[];
};

export type DashboardDiagnostics = {
  status: "healthy" | "warning" | "critical";
  totalCount: number;
  generatedAt: string;
  items: DashboardDiagnostic[];
};

export type WatcherListFilters = {
  userId?: string;
  goalId?: string;
};

export type GoalShareListFilters = {
  userId?: string;
  goalId?: string;
  workspaceId?: string | null;
  statuses?: GoalShareStatus[];
};

export type PrivacyOperationListFilters = {
  userId?: string;
  workspaceId?: string;
  kinds?: PrivacyOperationKind[];
  statuses?: PrivacyOperationStatus[];
};

export type CollectionPageParams = {
  userId?: string;
  limit?: number;
  cursor?: string | null;
};

export type GoalPageParams = CollectionPageParams & {
  workspaceId?: string | null;
};

export type WatcherPageParams = CollectionPageParams & {
  goalId?: string;
};

export type WorkspaceRetentionParams = {
  workspaceId: string;
  userId: string;
  retentionDays: number;
  now?: string;
};

export type WorkspaceDeleteParams = {
  workspaceId: string;
  userId: string;
  operationId: string;
  now?: string;
};

export type AutopilotEventClaim =
  | {
      outcome: "claimed";
      event: AutopilotEvent;
    }
  | {
      outcome: "duplicate" | "debounced";
      event: AutopilotEvent;
    };

export class JobMutationError extends Error {
  constructor(
    public readonly code: "not_found" | "not_running" | "not_owner",
    message: string
  ) {
    super(message);
    this.name = "JobMutationError";
  }
}

export class ApprovalMutationError extends Error {
  constructor(
    public readonly code: "not_found" | "already_handled" | "expired",
    message: string
  ) {
    super(message);
    this.name = "ApprovalMutationError";
  }
}

export class CommitmentInboxQueryError extends Error {
  constructor(
    public readonly code: "invalid_cursor",
    message: string
  ) {
    super(message);
    this.name = "CommitmentInboxQueryError";
  }
}

export class CollectionPageQueryError extends Error {
  constructor(
    public readonly code: "invalid_cursor",
    message: string
  ) {
    super(message);
    this.name = "CollectionPageQueryError";
  }
}

export type AgenticRepository = {
  backend: "file" | "postgres";
  seedDefaults(userId?: string): Promise<void>;
  listWorkspaces(userId?: string): Promise<Workspace[]>;
  saveWorkspace(workspace: Workspace, actor: ActorContext): Promise<Workspace>;
  listWorkspaceMembers(workspaceId: string, userId?: string): Promise<WorkspaceMember[]>;
  saveWorkspaceMember(member: WorkspaceMember, actor: ActorContext): Promise<WorkspaceMember>;
  getWorkspaceSelection(userId?: string): Promise<WorkspaceSelection | null>;
  saveWorkspaceSelection(selection: WorkspaceSelection): Promise<WorkspaceSelection>;
  getWorkspaceGovernance(workspaceId: string, userId?: string): Promise<WorkspaceGovernance | null>;
  saveWorkspaceGovernance(governance: WorkspaceGovernance, actor: ActorContext): Promise<WorkspaceGovernance>;
  listGoalShares(filters?: GoalShareListFilters): Promise<GoalShareRecord[]>;
  getGoalShare(shareId: string, userId?: string): Promise<GoalShareRecord | null>;
  getGoalShareByTokenFingerprint(tokenFingerprint: string): Promise<GoalShareRecord | null>;
  saveGoalShare(share: GoalShareRecord): Promise<GoalShareRecord>;
  listPrivacyOperations(filters?: PrivacyOperationListFilters): Promise<PrivacyOperation[]>;
  getPrivacyOperation(operationId: string, userId?: string): Promise<PrivacyOperation | null>;
  savePrivacyOperation(operation: PrivacyOperation): Promise<PrivacyOperation>;
  enforceWorkspaceRetention(params: WorkspaceRetentionParams): Promise<Record<string, unknown>>;
  deleteWorkspaceData(params: WorkspaceDeleteParams): Promise<Record<string, unknown>>;
  exportWorkspaceAudit(workspaceId: string, userId?: string): Promise<WorkspaceAuditExport>;
  saveGoalBundle(bundle: GoalBundle): Promise<GoalBundle>;
  respondToApproval(params: {
    approvalId: string;
    decision: Exclude<ApprovalDecision, "pending">;
    actor: ActorContext;
    scope?: ApprovalDecisionScope;
    rationale?: string | null;
  }): Promise<GoalBundle>;
  getGoalBundle(goalId: string): Promise<GoalBundle | null>;
  getGoalBundleForUser(goalId: string, userId?: string): Promise<GoalBundle | null>;
  listGoals(userId?: string): Promise<GoalBundle[]>;
  listGoalsPage(params?: GoalPageParams): Promise<GoalBundlePage>;
  listApprovals(userId?: string): Promise<ApprovalRequest[]>;
  listEvidenceRecords(params?: {
    userId?: string;
    goalId?: string;
    approvalId?: string;
  }): Promise<EvidenceRecord[]>;
  listCommitments(userId?: string): Promise<Commitment[]>;
  listCommitmentInbox(params?: {
    userId?: string;
    bucket?: CommitmentInboxBucket;
    limit?: number;
    cursor?: string | null;
  }): Promise<CommitmentInboxPage>;
  getCommitment(commitmentId: string, userId?: string): Promise<Commitment | null>;
  saveCommitment(commitment: Commitment): Promise<Commitment>;
  deleteCommitment(commitmentId: string, userId?: string): Promise<void>;
  getBriefingPreferences(userId?: string): Promise<BriefingPreferences>;
  saveBriefingPreferences(preferences: BriefingPreferences): Promise<BriefingPreferences>;
  getAutopilotSettings(userId?: string): Promise<AutopilotSettings>;
  saveAutopilotSettings(settings: AutopilotSettings): Promise<AutopilotSettings>;
  listAutopilotEvents(userId?: string): Promise<AutopilotEvent[]>;
  listAutopilotEventsPage(params?: CollectionPageParams): Promise<AutopilotEventPage>;
  claimAutopilotEvent(params: {
    userId?: string;
    kind: AutopilotEventKind;
    sourceId: string;
    idempotencyKey?: string | null;
    mode: AutopilotMode;
    summary: string;
    details?: Record<string, unknown>;
    actorContext?: ActorContext | null;
    debounceMinutes: number;
  }): Promise<AutopilotEventClaim>;
  saveAutopilotEvent(event: AutopilotEvent): Promise<AutopilotEvent>;
  listJobs(params?: {
    userId?: string;
    kinds?: JobKind[];
    statuses?: JobStatus[];
  }): Promise<JobRecord[]>;
  getJob(jobId: string, userId?: string): Promise<JobRecord | null>;
  enqueueJob(job: JobRecord): Promise<JobRecord>;
  claimNextJob(params: {
    userId?: string;
    kinds?: JobKind[];
    runnerId: string;
    leaseMs: number;
    now?: string;
  }): Promise<JobRecord | null>;
  completeJob(params: {
    jobId: string;
    runnerId: string;
    completedAt?: string;
  }): Promise<JobRecord>;
  retryJob(params: {
    jobId: string;
    runnerId: string;
    availableAt: string;
    error: string;
  }): Promise<JobRecord>;
  deadLetterJob(params: {
    jobId: string;
    runnerId: string;
    deadLetteredAt?: string;
    error: string;
  }): Promise<JobRecord>;
  listMemory(userId?: string): Promise<MemoryRecord[]>;
  listMemoryPage(params?: CollectionPageParams): Promise<MemoryRecordPage>;
  saveMemory(record: MemoryRecord): Promise<MemoryRecord>;
  saveEvidenceRecord(record: EvidenceRecord): Promise<EvidenceRecord>;
  listWatchers(filters?: WatcherListFilters): Promise<Watcher[]>;
  listWatchersPage(params?: WatcherPageParams): Promise<WatcherPage>;
  saveWatcher(watcher: Watcher): Promise<Watcher>;
  listIntegrations(userId?: string): Promise<IntegrationAccount[]>;
  listIntegrationsPage(params?: CollectionPageParams): Promise<IntegrationAccountPage>;
  upsertIntegration(account: IntegrationAccount): Promise<IntegrationAccount>;
  listProviderCredentials(userId?: string): Promise<ProviderCredential[]>;
  getProviderCredential(credentialId: string, userId?: string): Promise<ProviderCredential | null>;
  saveProviderCredential(credential: ProviderCredential): Promise<ProviderCredential>;
  getProviderCredentialSecret(
    credentialId: string,
    kind: ProviderCredentialSecretKind,
    userId?: string
  ): Promise<ProviderCredentialSecretRecord | null>;
  saveProviderCredentialSecret(record: ProviderCredentialSecretRecord): Promise<ProviderCredentialSecretRecord>;
  listTemplates(userId?: string): Promise<GoalTemplate[]>;
  saveTemplate(template: GoalTemplate): Promise<GoalTemplate>;
  deleteTemplate(templateId: string): Promise<void>;
  listWorkflowTemplates(userId?: string): Promise<WorkflowCanvasTemplate[]>;
  getWorkflowTemplate(templateId: string, userId?: string): Promise<WorkflowCanvasTemplate | null>;
  saveWorkflowTemplate(template: WorkflowCanvasTemplate): Promise<WorkflowCanvasTemplate>;
  deleteWorkflowTemplate(templateId: string, userId?: string): Promise<void>;
  getDashboardData(userId?: string): Promise<DashboardData>;
  // Agent Management
  listAgents(userId?: string): Promise<AgentDefinition[]>;
  getAgent(agentId: string, userId?: string): Promise<AgentDefinition | null>;
  saveAgent(agent: AgentDefinition): Promise<AgentDefinition>;
  deleteAgent(agentId: string, userId?: string): Promise<void>;
  getAgentMetrics(agentId: string, period?: "day" | "week" | "month" | "all", userId?: string): Promise<AgentMetrics | null>;
  saveAgentMetrics(metrics: AgentMetrics): Promise<AgentMetrics>;
  listOperatorProducts(userId?: string): Promise<OperatorProduct[]>;
  getOperatorProductSelection(userId?: string): Promise<OperatorProductSelection | null>;
  saveOperatorProduct(product: OperatorProduct): Promise<OperatorProduct>;
  saveOperatorProductSelection(selection: OperatorProductSelection): Promise<OperatorProductSelection>;
};

const STALLED_WORKFLOW_MS = 30 * 60 * 1000;
const APPROVAL_WAIT_SLA_MS = 6 * 60 * 60 * 1000;
const DASHBOARD_GOAL_LIMIT = 40;
const DASHBOARD_AUTOPILOT_EVENT_LIMIT = 24;
const DASHBOARD_MEMORY_LIMIT = 40;
const DASHBOARD_INTEGRATION_LIMIT = 24;

function resolveDefaultStorePath(): string {
  const configured = process.env.AGENTIC_RUNTIME_STORE_PATH?.trim();

  if (configured) {
    return path.resolve(configured);
  }

  return path.join(/* turbopackIgnore: true */ process.cwd(), ".agentic", "runtime-store.json");
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
    operatorProductSelections: []
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

const GOOGLE_MANAGED_INTEGRATION_IDS = ["gmail", "google-calendar"] as const;

function buildGoogleManagedIntegrationStatus(status: ProviderCredential["status"]): IntegrationAccount["status"] {
  return status === "connected" ? "ready" : "manual";
}

function buildGoogleManagedIntegrationMetadata(credential: ProviderCredential): Record<string, unknown> {
  return {
    provider: "google",
    managed: true,
    providerCredentialId: credential.id,
    providerCredentialStatus: credential.status,
    workspaceId: credential.workspaceId,
    accountId: credential.accountId,
    accountEmail: credential.accountEmail,
    displayName: credential.displayName
  };
}

function syncGoogleManagedIntegrations(
  integrations: IntegrationAccount[],
  credential: ProviderCredential
): IntegrationAccount[] {
  if (credential.provider !== "google") {
    return integrations;
  }

  const defaults = buildDefaultIntegrationAccounts(credential.userId);
  let nextIntegrations = [...integrations];

  for (const integrationId of GOOGLE_MANAGED_INTEGRATION_IDS) {
    const defaultIntegration = defaults.find((candidate) => candidate.id === integrationId);

    if (!defaultIntegration) {
      continue;
    }

    const existing =
      nextIntegrations.find((candidate) => candidate.userId === credential.userId && candidate.id === integrationId) ?? null;

    const managedIntegration = IntegrationAccountSchema.parse({
      ...(existing ?? defaultIntegration),
      userId: credential.userId,
      status: buildGoogleManagedIntegrationStatus(credential.status),
      metadata: {
        ...defaultIntegration.metadata,
        ...(existing?.metadata ?? {}),
        ...buildGoogleManagedIntegrationMetadata(credential)
      },
      actorContext: credential.actorContext,
      createdAt: existing?.createdAt ?? defaultIntegration.createdAt,
      updatedAt: credential.updatedAt
    });

    nextIntegrations = upsertByKey(nextIntegrations, managedIntegration, integrationStoreKey);
  }

  return nextIntegrations;
}

function uniqueById<T extends { id: string }>(items: T[]): T[] {
  const map = new Map<string, T>();

  for (const item of items) {
    map.set(item.id, item);
  }

  return [...map.values()];
}

const CollectionCursorSchema = z.object({
  createdAt: z.string().datetime(),
  id: z.string().min(1)
});

type CollectionCursor = z.infer<typeof CollectionCursorSchema>;

function compareCreatedDescKeys(left: CollectionCursor, right: CollectionCursor): number {
  const createdComparison = right.createdAt.localeCompare(left.createdAt);
  return createdComparison !== 0 ? createdComparison : right.id.localeCompare(left.id);
}

function compareCreatedAscKeys(left: CollectionCursor, right: CollectionCursor): number {
  const createdComparison = left.createdAt.localeCompare(right.createdAt);
  return createdComparison !== 0 ? createdComparison : left.id.localeCompare(right.id);
}

function normalizeCollectionPageLimit(limit?: number): number {
  if (limit === undefined) {
    return DEFAULT_COLLECTION_PAGE_LIMIT;
  }

  const normalized = Math.trunc(limit);

  if (!Number.isFinite(normalized) || normalized < 1 || normalized > MAX_COLLECTION_PAGE_LIMIT) {
    return DEFAULT_COLLECTION_PAGE_LIMIT;
  }

  return normalized;
}

function encodeCollectionCursor(cursor: CollectionCursor): string {
  return Buffer.from(JSON.stringify(CollectionCursorSchema.parse(cursor)), "utf8").toString("base64url");
}

function decodeCollectionCursor(cursor?: string | null): CollectionCursor | null {
  if (!cursor) {
    return null;
  }

  try {
    const parsed = JSON.parse(Buffer.from(cursor, "base64url").toString("utf8")) as unknown;
    return CollectionCursorSchema.parse(parsed);
  } catch {
    throw new CollectionPageQueryError("invalid_cursor", "Collection page cursor is invalid.");
  }
}

function isItemAfterCursor(cursor: CollectionCursor, candidate: CollectionCursor): boolean {
  if (candidate.createdAt !== cursor.createdAt) {
    return candidate.createdAt.localeCompare(cursor.createdAt) < 0;
  }

  return candidate.id.localeCompare(cursor.id) < 0;
}

function sortByCreatedDesc<T extends { createdAt: string; id?: string }>(items: T[]): T[] {
  return [...items].sort((left, right) =>
    compareCreatedDescKeys(
      { createdAt: left.createdAt, id: left.id ?? "" },
      { createdAt: right.createdAt, id: right.id ?? "" }
    )
  );
}

function sortByCreatedAsc<T extends { createdAt: string; id?: string }>(items: T[]): T[] {
  return [...items].sort((left, right) =>
    compareCreatedAscKeys(
      { createdAt: left.createdAt, id: left.id ?? "" },
      { createdAt: right.createdAt, id: right.id ?? "" }
    )
  );
}

function buildCollectionPage<TItem, TPage>(params: {
  items: TItem[];
  limit?: number;
  cursor?: string | null;
  getCursorKey: (item: TItem) => CollectionCursor;
  parsePage: (page: {
    items: TItem[];
    limit: number;
    nextCursor: string | null;
    generatedAt: string;
  }) => TPage;
}): TPage {
  const limit = normalizeCollectionPageLimit(params.limit);
  const cursor = decodeCollectionCursor(params.cursor);
  const sorted = [...params.items].sort((left, right) =>
    compareCreatedDescKeys(params.getCursorKey(left), params.getCursorKey(right))
  );
  const filtered = cursor
    ? sorted.filter((item) => isItemAfterCursor(cursor, params.getCursorKey(item)))
    : sorted;
  const pageItems = filtered.slice(0, limit);
  const nextCursor =
    filtered.length > limit ? encodeCollectionCursor(params.getCursorKey(pageItems[pageItems.length - 1]!)) : null;

  return params.parsePage({
    items: pageItems,
    limit,
    nextCursor,
    generatedAt: nowIso()
  });
}

function pluralize(count: number, noun: string): string {
  return `${count} ${noun}${count === 1 ? "" : "s"}`;
}

function formatCount(count: number, singular: string, plural: string): string {
  return `${count} ${count === 1 ? singular : plural}`;
}

function formatAgeAgo(timestamp: string, now: number): string {
  const parsed = Date.parse(timestamp);

  if (!Number.isFinite(parsed)) {
    return "recently";
  }

  const deltaMs = Math.max(0, now - parsed);
  const minutes = Math.floor(deltaMs / (60 * 1000));

  if (minutes < 1) {
    return "just now";
  }

  if (minutes < 60) {
    return `${minutes}m ago`;
  }

  const hours = Math.floor(minutes / 60);

  if (hours < 48) {
    return `${hours}h ago`;
  }

  return `${Math.floor(hours / 24)}d ago`;
}

function parseTimestampMs(timestamp: string | null | undefined): number | null {
  if (!timestamp) {
    return null;
  }

  const parsed = Date.parse(timestamp);
  return Number.isFinite(parsed) ? parsed : null;
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

function inferApprovalActionTypeFromRequestedAction(requestedAction: string): ApprovalRequest["preview"]["actionType"] {
  const normalized = requestedAction.toLowerCase();

  if (/\bdelete|remove|erase\b/.test(normalized)) {
    return "delete";
  }

  if (/\bsend|reply|email|message\b/.test(normalized)) {
    return "send";
  }

  if (/\bschedule|calendar|meeting|event\b/.test(normalized)) {
    return "schedule";
  }

  if (/\bupdate|revise|modify\b/.test(normalized)) {
    return "update";
  }

  if (/\bcreate|open|add|capture\b/.test(normalized)) {
    return "create";
  }

  if (/\bdraft|prepare\b/.test(normalized)) {
    return "draft";
  }

  return "artifact-only";
}

function buildFallbackApprovalPreview(approval: {
  title: string;
  requestedAction: string;
  riskClass: ApprovalRequest["riskClass"];
}): ApprovalRequest["preview"] {
  const actionType = inferApprovalActionTypeFromRequestedAction(approval.requestedAction);

  return ApprovalPreviewSchema.parse({
    actionType,
    summary: approval.requestedAction,
    target: approval.title.replace(/\s+requires approval$/u, "") || "Pending action",
    changes: [
      {
        label: "Requested action",
        before: "Pending user review",
        after: approval.requestedAction
      }
    ],
    impact: {
      affectedPeople: actionType === "send" ? ["external recipients"] : [],
      affectedSystems:
        actionType === "send"
          ? ["email"]
          : actionType === "schedule"
            ? ["calendar"]
            : actionType === "create" || actionType === "update" || actionType === "delete"
              ? ["workspace"]
              : [],
      permissions: [],
      rollback: actionType === "delete" ? "not_supported" : actionType === "draft" || actionType === "artifact-only" ? "supported" : "manual"
    }
  });
}

function buildFallbackApprovalActionIntent(approval: {
  title: string;
  requestedAction: string;
  preview?: ApprovalRequest["preview"] | null;
}): ApprovalRequest["actionIntent"] {
  const actionType = approval.preview?.actionType ?? inferApprovalActionTypeFromRequestedAction(approval.requestedAction);

  return ActionIntentSchema.parse({
    type: "manual_review",
    actionType,
    summary: approval.requestedAction,
    reason: "This approval does not include a typed execution payload and requires manual review before any side effect.",
    artifactIds: []
  });
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

function commitmentIdForGoal(goalId: string): string {
  return `commitment-goal-${goalId}`;
}

function commitmentIdForApproval(approvalId: string): string {
  return `commitment-approval-${approvalId}`;
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
    timezone: process.env.TZ ?? "Asia/Singapore",
    focus: "balanced",
    schedules: defaultBriefingSchedules(),
    createdAt: timestamp,
    updatedAt: timestamp
  });
}

function inferBriefingType(intent: string): BriefingType | null {
  if (intent === "morning-briefing") {
    return "startup";
  }

  if (!intent.startsWith("briefing:")) {
    return null;
  }

  const type = intent.slice("briefing:".length);
  return briefingTypeValues.includes(type as BriefingType) ? (type as BriefingType) : null;
}

function buildBriefingHistory(goals: GoalBundle[]): BriefingHistoryItem[] {
  return goals
    .flatMap((bundle) => {
      const type = inferBriefingType(bundle.goal.intent);

      if (!type) {
        return [];
      }

      const latestArtifact = sortByCreatedDesc(bundle.artifacts)[0] ?? null;
      return [
        BriefingHistoryItemSchema.parse({
          goalId: bundle.goal.id,
          type,
          title: bundle.goal.title,
          status: bundle.goal.status,
          summary: bundle.goal.explanation,
          generatedAt: bundle.goal.createdAt,
          updatedAt: bundle.goal.updatedAt,
          artifactId: latestArtifact?.id ?? null,
          artifactTitle: latestArtifact?.title ?? null
        })
      ];
    })
    .sort((left, right) => right.generatedAt.localeCompare(left.generatedAt))
    .slice(0, 8);
}

const riskClassWeight: Record<NonNullable<Commitment["riskClass"]>, number> = {
  R1: 1,
  R2: 2,
  R3: 3,
  R4: 4
};

function maxRiskClass(
  values: Array<Commitment["riskClass"] | Task["riskClass"] | ApprovalRequest["riskClass"] | null | undefined>
): Commitment["riskClass"] {
  let strongest: Commitment["riskClass"] = null;

  for (const value of values) {
    if (!value) {
      continue;
    }

    if (!strongest || riskClassWeight[value] > riskClassWeight[strongest]) {
      strongest = value;
    }
  }

  return strongest;
}

function deriveCommitmentUrgency(commitment: Pick<Commitment, "status" | "dueAt" | "confidence" | "riskClass">, now: number): CommitmentUrgency {
  const dueAtMs = parseTimestampMs(commitment.dueAt);

  if (
    commitment.status === "needs-review" ||
    commitment.status === "stale" ||
    (dueAtMs !== null && dueAtMs <= now + 6 * 60 * 60 * 1000)
  ) {
    return "immediate";
  }

  if (
    commitment.status === "blocked" ||
    commitment.confidence < 0.75 ||
    commitment.riskClass === "R4" ||
    (dueAtMs !== null && dueAtMs <= now + 24 * 60 * 60 * 1000)
  ) {
    return "today";
  }

  if (
    commitment.status === "pending" ||
    commitment.status === "scheduled" ||
    (dueAtMs !== null && dueAtMs <= now + 72 * 60 * 60 * 1000)
  ) {
    return "soon";
  }

  return "later";
}

function deriveFallbackSuggestedAction(commitment: Commitment): CommitmentSuggestedAction | null {
  const primaryEvidence = commitment.evidence[0];

  if (!primaryEvidence) {
    return null;
  }

  if (primaryEvidence.section === "approvals") {
    return {
      kind: "review_approval",
      label: "Review approval",
      section: primaryEvidence.section,
      itemId: primaryEvidence.itemId
    };
  }

  return {
    kind: commitment.status === "blocked" ? "resolve_blocker" : "review_source",
    label: commitment.status === "blocked" ? "Inspect workflow" : "Review source",
    section: primaryEvidence.section,
    itemId: primaryEvidence.itemId
  };
}

function enrichCommitment(commitment: Commitment, now: number): Commitment {
  return CommitmentSchema.parse({
    ...commitment,
    urgency: commitment.urgency ?? deriveCommitmentUrgency(commitment, now),
    provenanceSummary:
      commitment.provenanceSummary?.trim() ||
      (commitment.sourceKind === "approval"
        ? "Derived from a pending approval gate before execution."
        : "Derived from active goal execution."),
    suggestedNextAction: commitment.suggestedNextAction ?? deriveFallbackSuggestedAction(commitment)
  });
}

function buildGoalCommitment(bundle: GoalBundle, now: number): Commitment | null {
  if (bundle.goal.status === "completed") {
    return null;
  }

  const pendingApprovals = bundle.approvals.filter((approval) => approval.decision === "pending");
  const blockedTasks = bundle.tasks.filter((task) => task.state === "blocked" || task.state === "failed");
  const waitingTasks = bundle.tasks.filter((task) => task.state === "waiting");
  const dueAt = pendingApprovals.reduce<string | null>((soonest, approval) => {
    if (!soonest) {
      return approval.expiryAt;
    }

    return approval.expiryAt.localeCompare(soonest) < 0 ? approval.expiryAt : soonest;
  }, null);
  const status =
    pendingApprovals.length > 0
      ? "needs-review"
      : blockedTasks.length > 0 || waitingTasks.length > 0 || bundle.goal.status === "waiting"
        ? "blocked"
        : bundle.goal.status === "planned"
          ? "scheduled"
          : "pending";

  const summaryParts = [
    pendingApprovals.length > 0 ? `${pluralize(pendingApprovals.length, "approval")} waiting` : null,
    blockedTasks.length > 0 ? `${pluralize(blockedTasks.length, "task")} blocked or failed` : null,
    waitingTasks.length > 0 ? `${pluralize(waitingTasks.length, "task")} waiting` : null,
    pendingApprovals.length === 0 && blockedTasks.length === 0 && waitingTasks.length === 0
      ? bundle.goal.explanation
      : null
  ].filter((part): part is string => part !== null);
  const riskClass = maxRiskClass([
    ...pendingApprovals.map((approval) => approval.riskClass),
    ...bundle.tasks
      .filter((task) => task.state !== "completed")
      .map((task) => task.riskClass)
  ]);
  const urgency = deriveCommitmentUrgency(
    {
      status,
      dueAt,
      confidence: bundle.goal.confidence,
      riskClass
    },
    now
  );

  return CommitmentSchema.parse({
    id: commitmentIdForGoal(bundle.goal.id),
    userId: bundle.goal.userId,
    title: bundle.goal.title,
    summary: summaryParts.join(" · "),
    status,
    sourceKind: "goal",
    sourceId: bundle.goal.id,
    goalId: bundle.goal.id,
    approvalId: null,
    dueAt,
    urgency,
    riskClass,
    confidence: bundle.goal.confidence,
    provenanceSummary:
      pendingApprovals.length > 0
        ? `Derived from goal execution and ${pluralize(pendingApprovals.length, "pending approval")}.`
        : blockedTasks.length > 0 || waitingTasks.length > 0 || bundle.goal.status === "waiting"
          ? "Derived from goal execution and active workflow blockers."
          : "Derived from active goal execution.",
    suggestedNextAction:
      pendingApprovals.length > 0
        ? {
            kind: "review_approval",
            label: pendingApprovals.length === 1 ? "Review approval" : "Review approvals",
            section: "approvals",
            itemId: pendingApprovals[0]!.id
          }
        : {
            kind: blockedTasks.length > 0 || waitingTasks.length > 0 || bundle.goal.status === "waiting" ? "resolve_blocker" : "continue_goal",
            label:
              blockedTasks.length > 0 || waitingTasks.length > 0 || bundle.goal.status === "waiting"
                ? "Inspect workflow"
                : "Continue workflow",
            section: "goals",
            itemId: bundle.goal.id
          },
    evidence: [
      {
        section: "goals",
        itemId: bundle.goal.id,
        label: bundle.goal.title
      }
    ],
    createdAt: bundle.goal.createdAt,
    updatedAt: bundle.goal.updatedAt
  });
}

function buildApprovalCommitment(
  approval: ApprovalRequest,
  goalTitleById: Map<string, string>,
  userId: string,
  now: number
): Commitment | null {
  if (approval.decision !== "pending") {
    return null;
  }

  const isExpired = Date.parse(approval.expiryAt) <= now;
  const goalTitle = goalTitleById.get(approval.goalId) ?? approval.goalId;
  const status = isExpired ? "stale" : "needs-review";
  const urgency = deriveCommitmentUrgency(
    {
      status,
      dueAt: approval.expiryAt,
      confidence: 0.98,
      riskClass: approval.riskClass
    },
    now
  );

  return CommitmentSchema.parse({
    id: commitmentIdForApproval(approval.id),
    userId,
    title: approval.title,
    summary: `${approval.requestedAction} for ${goalTitle}`,
    status,
    sourceKind: "approval",
    sourceId: approval.id,
    goalId: approval.goalId,
    approvalId: approval.id,
    dueAt: approval.expiryAt,
    urgency,
    riskClass: approval.riskClass,
    confidence: 0.98,
    provenanceSummary: "Derived from a pending approval gate before execution.",
    suggestedNextAction: {
      kind: "review_approval",
      label: "Review approval",
      section: "approvals",
      itemId: approval.id
    },
    evidence: [
      {
        section: "approvals",
        itemId: approval.id,
        label: approval.title
      },
      {
        section: "goals",
        itemId: approval.goalId,
        label: goalTitle
      }
    ],
    createdAt: approval.createdAt,
    updatedAt: approval.respondedAt ?? approval.createdAt
  });
}

function sortCommitments(commitments: Commitment[]): Commitment[] {
  const statusWeight: Record<Commitment["status"], number> = {
    "needs-review": 0,
    stale: 1,
    blocked: 2,
    pending: 3,
    scheduled: 4,
    completed: 5,
    dismissed: 6
  };

  return [...commitments].sort((left, right) => {
    const leftWeight = statusWeight[left.status];
    const rightWeight = statusWeight[right.status];

    if (leftWeight !== rightWeight) {
      return leftWeight - rightWeight;
    }

    const leftDueAt = left.dueAt ?? "9999-12-31T23:59:59.999Z";
    const rightDueAt = right.dueAt ?? "9999-12-31T23:59:59.999Z";

    if (leftDueAt !== rightDueAt) {
      return leftDueAt.localeCompare(rightDueAt);
    }

    return right.updatedAt.localeCompare(left.updatedAt);
  });
}

function isOpenCommitment(commitment: Commitment): boolean {
  return commitment.status !== "completed" && commitment.status !== "dismissed";
}

function isUrgentCommitment(commitment: Commitment, now: number): boolean {
  if (!isOpenCommitment(commitment)) {
    return false;
  }

  if (commitment.status === "needs-review" || commitment.status === "stale") {
    return true;
  }

  if (!commitment.dueAt) {
    return false;
  }

  return Date.parse(commitment.dueAt) <= now + 24 * 60 * 60 * 1000;
}

function isDueSoonCommitment(commitment: Commitment, now: number): boolean {
  if (!isOpenCommitment(commitment) || isUrgentCommitment(commitment, now) || !commitment.dueAt) {
    return false;
  }

  const dueAt = Date.parse(commitment.dueAt);
  return dueAt <= now + 72 * 60 * 60 * 1000;
}

function isWaitingOnOthersCommitment(commitment: Commitment): boolean {
  return commitment.status === "scheduled" || commitment.status === "blocked";
}

function isUnresolvedCommitment(commitment: Commitment): boolean {
  return commitment.status === "pending" || commitment.status === "needs-review" || commitment.status === "stale";
}

function isLowConfidenceCommitment(commitment: Commitment): boolean {
  return isOpenCommitment(commitment) && commitment.confidence < 0.75;
}

function matchesCommitmentInboxBucket(
  commitment: Commitment,
  bucket: CommitmentInboxBucket,
  now: number
): boolean {
  switch (bucket) {
    case "all":
      return true;
    case "unresolved":
      return isUnresolvedCommitment(commitment);
    case "urgent":
      return isUrgentCommitment(commitment, now);
    case "due_soon":
      return isDueSoonCommitment(commitment, now);
    case "waiting_on_others":
      return isWaitingOnOthersCommitment(commitment);
    case "low_confidence":
      return isLowConfidenceCommitment(commitment);
    case "completed":
      return commitment.status === "completed";
  }
}

function encodeCommitmentInboxCursor(offset: number): string {
  return Buffer.from(JSON.stringify({ offset }), "utf8").toString("base64url");
}

function decodeCommitmentInboxCursor(cursor: string): number {
  try {
    const payload = JSON.parse(Buffer.from(cursor, "base64url").toString("utf8")) as { offset?: unknown };
    if (typeof payload.offset !== "number" || !Number.isInteger(payload.offset) || payload.offset < 0) {
      throw new CommitmentInboxQueryError("invalid_cursor", "The commitment inbox cursor is invalid.");
    }

    return payload.offset;
  } catch (error) {
    if (error instanceof CommitmentInboxQueryError) {
      throw error;
    }

    throw new CommitmentInboxQueryError("invalid_cursor", "The commitment inbox cursor is invalid.");
  }
}

function buildCommitmentInboxPage(params: {
  commitments: Commitment[];
  bucket?: CommitmentInboxBucket;
  limit?: number;
  cursor?: string | null;
  now?: number;
}): CommitmentInboxPage {
  const bucket = params.bucket ?? DEFAULT_COMMITMENT_INBOX_BUCKET;
  const limit = Math.min(Math.max(params.limit ?? DEFAULT_COMMITMENT_INBOX_LIMIT, 1), MAX_COMMITMENT_INBOX_LIMIT);
  const now = params.now ?? Date.now();
  const startIndex = params.cursor ? decodeCommitmentInboxCursor(params.cursor) : 0;
  const counts = Object.fromEntries(
    commitmentInboxBucketValues.map((bucketValue) => [
      bucketValue,
      params.commitments.filter((commitment) => matchesCommitmentInboxBucket(commitment, bucketValue, now)).length
    ])
  ) as Record<CommitmentInboxBucket, number>;
  const filtered = params.commitments.filter((commitment) => matchesCommitmentInboxBucket(commitment, bucket, now));

  if (startIndex > filtered.length) {
    throw new CommitmentInboxQueryError("invalid_cursor", "The commitment inbox cursor is invalid.");
  }

  const items = filtered.slice(startIndex, startIndex + limit);
  const nextCursor = startIndex + items.length < filtered.length ? encodeCommitmentInboxCursor(startIndex + items.length) : null;

  return {
    bucket,
    items: items.map((commitment) => CommitmentSchema.parse(clone(commitment))),
    counts,
    totalCount: filtered.length,
    limit,
    nextCursor,
    generatedAt: new Date(now).toISOString()
  };
}

function mergeCommitments(params: {
  goals: GoalBundle[];
  approvals: ApprovalRequest[];
  persisted: Commitment[];
  userId: string;
  now?: number;
}): Commitment[] {
  const now = params.now ?? Date.now();
  const goalTitleById = new Map(params.goals.map((bundle) => [bundle.goal.id, bundle.goal.title]));
  const derived = [
    ...params.goals.map((bundle) => buildGoalCommitment(bundle, now)),
    ...params.approvals.map((approval) => buildApprovalCommitment(approval, goalTitleById, params.userId, now))
  ].filter((commitment): commitment is Commitment => commitment !== null);
  const persistedById = new Map(
    params.persisted
      .filter((commitment) => commitment.userId === params.userId)
      .map((commitment) => [commitment.id, commitment] as const)
  );

  const merged = derived.map((commitment) => {
    const persisted = persistedById.get(commitment.id);

    if (!persisted) {
      return commitment;
    }

    return CommitmentSchema.parse({
      ...commitment,
      status:
        persisted.status === "completed" || persisted.status === "dismissed"
          ? persisted.status
          : commitment.status,
      updatedAt:
        persisted.status === "completed" || persisted.status === "dismissed"
          ? persisted.updatedAt
      : commitment.updatedAt
    });
  });

  const derivedIds = new Set(derived.map((commitment) => commitment.id));
  const persistedOnly = params.persisted.filter(
    (commitment) => commitment.userId === params.userId && !derivedIds.has(commitment.id)
  );

  return sortCommitments([...merged, ...persistedOnly]).map((commitment) => enrichCommitment(commitment, now));
}

function buildDashboardDiagnostics(params: {
  goals: GoalBundle[];
  approvals: ApprovalRequest[];
  memories: MemoryRecord[];
  watchers: Watcher[];
  now?: number;
}): DashboardDiagnostics {
  const now = params.now ?? Date.now();
  const goalTitleById = new Map(params.goals.map((bundle) => [bundle.goal.id, bundle.goal.title]));
  const goalStatusById = new Map(params.goals.map((bundle) => [bundle.goal.id, bundle.goal.status]));

  const expiredApprovals = params.approvals.filter((approval) => {
    if (approval.decision !== "pending") {
      return false;
    }

    return Date.parse(approval.expiryAt) <= now;
  });

  const staleMemories = params.memories.flatMap((record) => {
    const freshness = getMemoryFreshness(record, now);
    return freshness === "fresh"
      ? []
      : [{
          id: record.id,
          category: record.category,
          content: record.content,
          freshness
        }];
  });

  const staleMemoryCounts = staleMemories.reduce<Record<string, number>>((counts, freshness) => {
    counts[freshness.freshness] = (counts[freshness.freshness] ?? 0) + 1;
    return counts;
  }, {});

  const stuckWorkflows = params.goals
    .map((bundle) => {
      const blockedTasks = bundle.tasks.filter((task) => task.state === "blocked");
      const failedTasks = bundle.tasks.filter((task) => task.state === "failed");
      const pendingApprovals = bundle.approvals.filter((approval) => approval.decision === "pending");
      const latestProgressAt = [
        parseTimestampMs(bundle.goal.updatedAt),
        parseTimestampMs(bundle.workflow.updatedAt),
        ...bundle.tasks.map((task) => parseTimestampMs(task.updatedAt)),
        ...bundle.approvals.map((approval) => parseTimestampMs(approval.respondedAt ?? approval.createdAt))
      ].reduce<number | null>((latest, candidate) => {
        if (candidate === null) {
          return latest;
        }

        return latest === null ? candidate : Math.max(latest, candidate);
      }, null);
      const oldestPendingApproval = pendingApprovals.reduce<ApprovalRequest | null>((oldest, approval) => {
        if (!oldest) {
          return approval;
        }

        return Date.parse(approval.createdAt) < Date.parse(oldest.createdAt) ? approval : oldest;
      }, null);
      const reasons = [
        failedTasks.length > 0 ? pluralize(failedTasks.length, "failed task") : null,
        blockedTasks.length > 0 ? pluralize(blockedTasks.length, "blocked task") : null,
        oldestPendingApproval && now - Date.parse(oldestPendingApproval.createdAt) >= APPROVAL_WAIT_SLA_MS
          ? `${pluralize(pendingApprovals.length, "pending approval")} waiting since ${formatAgeAgo(oldestPendingApproval.createdAt, now)}`
          : null,
        blockedTasks.length === 0 &&
        failedTasks.length === 0 &&
        bundle.goal.status !== "completed" &&
        latestProgressAt !== null &&
        now - latestProgressAt >= STALLED_WORKFLOW_MS
          ? `last progress ${formatAgeAgo(new Date(latestProgressAt).toISOString(), now)}`
          : null
      ].filter((reason): reason is string => reason !== null);

      if (reasons.length === 0) {
        return null;
      }

      return {
        goalId: bundle.goal.id,
        title: bundle.goal.title,
        reasons
      };
    })
    .filter((bundle): bundle is NonNullable<typeof bundle> => bundle !== null);

  const orphanWatchers = params.watchers.filter((watcher) => {
    if (watcher.status !== "active") {
      return false;
    }

    return goalStatusById.get(watcher.goalId) === "completed";
  });

  const items: DashboardDiagnostic[] = [];

  if (expiredApprovals.length > 0) {
    items.push({
      kind: "expired_approvals",
      title: "Expired approvals",
      count: expiredApprovals.length,
      severity: "critical",
      reasons: expiredApprovals
        .slice(0, 3)
        .map(
          (approval) =>
            `${approval.title} for ${goalTitleById.get(approval.goalId) ?? approval.goalId} expired ${formatAgeAgo(approval.expiryAt, now)}`
        ),
      targets: expiredApprovals.slice(0, 3).map((approval) => ({
        section: "approvals",
        itemId: approval.id,
        label: approval.title
      }))
    });
  }

  if (staleMemories.length > 0) {
    items.push({
      kind: "stale_memories",
      title: "Stale memories",
      count: staleMemories.length,
      severity: "warning",
      reasons: [
        staleMemoryCounts.review_due ? `${pluralize(staleMemoryCounts.review_due, "memory")} overdue for review` : null,
        staleMemoryCounts.expired ? `${pluralize(staleMemoryCounts.expired, "memory")} expired` : null,
        staleMemoryCounts.low_confidence ? `${pluralize(staleMemoryCounts.low_confidence, "memory")} low confidence` : null
      ].filter((reason): reason is string => reason !== null),
      targets: staleMemories.slice(0, 3).map((memory) => ({
        section: "memory",
        itemId: memory.id,
        label: `${memory.category}: ${memory.content.slice(0, 36)}${memory.content.length > 36 ? "..." : ""}`,
        action: "review_memory" as const,
        actionLabel: "Review"
      }))
    });
  }

  if (stuckWorkflows.length > 0) {
    items.push({
      kind: "stuck_workflows",
      title: "Stuck workflows",
      count: stuckWorkflows.length,
      severity: "critical",
      reasons: stuckWorkflows.slice(0, 3).map((workflow) => `${workflow.title}: ${workflow.reasons.join(", ")}`),
      targets: stuckWorkflows.slice(0, 3).map((workflow) => ({
        section: "goals",
        itemId: workflow.goalId,
        label: workflow.title
      }))
    });
  }

  if (orphanWatchers.length > 0) {
    items.push({
      kind: "orphan_watchers",
      title: "Active watchers on completed goals",
      count: orphanWatchers.length,
      severity: "warning",
      reasons: orphanWatchers
        .slice(0, 3)
        .map((watcher) => `${watcher.targetEntity} watcher is still active for ${goalTitleById.get(watcher.goalId) ?? watcher.goalId}`),
      targets: orphanWatchers.slice(0, 3).map((watcher) => ({
        section: "watchers",
        itemId: watcher.id,
        label: watcher.targetEntity,
        action: "pause_watcher" as const,
        actionLabel: "Pause"
      }))
    });
  }

  const status = items.some((item) => item.severity === "critical")
    ? "critical"
    : items.length > 0
      ? "warning"
      : "healthy";

  return {
    status,
    totalCount: items.reduce((total, item) => total + item.count, 0),
    generatedAt: new Date(now).toISOString(),
    items
  };
}

function buildNowQueue(params: {
  commitments: Commitment[];
  diagnostics: DashboardDiagnostics;
  now?: number;
}): NowQueue {
  const now = params.now ?? Date.now();
  const diagnosticTitlesByGoalId = new Map<string, string[]>();
  const diagnosticTitlesByApprovalId = new Map<string, string[]>();

  for (const diagnostic of params.diagnostics.items) {
    for (const target of diagnostic.targets) {
      if (!target.itemId) {
        continue;
      }

      if (target.section === "goals") {
        diagnosticTitlesByGoalId.set(target.itemId, [
          ...(diagnosticTitlesByGoalId.get(target.itemId) ?? []),
          diagnostic.title
        ]);
      }

      if (target.section === "approvals") {
        diagnosticTitlesByApprovalId.set(target.itemId, [
          ...(diagnosticTitlesByApprovalId.get(target.itemId) ?? []),
          diagnostic.title
        ]);
      }
    }
  }

  const urgencyWeight: Record<CommitmentUrgency, number> = {
    immediate: 400,
    today: 300,
    soon: 200,
    later: 100
  };
  const statusWeight: Record<Commitment["status"], number> = {
    "needs-review": 80,
    stale: 70,
    blocked: 55,
    pending: 40,
    scheduled: 25,
    completed: 0,
    dismissed: 0
  };

  const items = params.commitments
    .filter((commitment) => isOpenCommitment(commitment))
    .map((commitment) => {
      const reasons = [
        commitment.sourceKind === "approval" && commitment.status === "needs-review"
          ? "Approval review is required before execution can continue."
          : null,
        commitment.sourceKind === "approval" && commitment.status === "stale"
          ? "Approval has expired and needs review before execution can continue."
          : null,
        commitment.status === "needs-review" ? "Requires review before execution can continue." : null,
        commitment.status === "stale" ? "The underlying obligation is stale and needs intervention." : null,
        commitment.status === "blocked" ? "Execution is blocked or waiting on another dependency." : null,
        commitment.confidence < 0.75 ? "Confidence is low; verify before acting." : null,
        commitment.dueAt ? `Due ${formatAgeAgo(commitment.dueAt, now)}.` : null,
        ...(diagnosticTitlesByGoalId.get(commitment.goalId ?? "") ?? []).map((title) => `${title} is affecting this workflow.`),
        ...(diagnosticTitlesByApprovalId.get(commitment.approvalId ?? "") ?? []).map((title) => `${title} is affecting this approval.`)
      ].filter((reason): reason is string => reason !== null);
      const score =
        urgencyWeight[commitment.urgency] +
        statusWeight[commitment.status] +
        (commitment.sourceKind === "approval" ? 35 : 0) +
        (commitment.riskClass ? riskClassWeight[commitment.riskClass] * 10 : 0) +
        (commitment.confidence < 0.75 ? 20 : 0) +
        reasons.length * 5;

      return {
        commitment,
        reasons,
        score
      };
    })
    .sort((left, right) => {
      if (left.score !== right.score) {
        return right.score - left.score;
      }

      const leftDueAt = left.commitment.dueAt ?? "9999-12-31T23:59:59.999Z";
      const rightDueAt = right.commitment.dueAt ?? "9999-12-31T23:59:59.999Z";

      if (leftDueAt !== rightDueAt) {
        return leftDueAt.localeCompare(rightDueAt);
      }

      return right.commitment.updatedAt.localeCompare(left.commitment.updatedAt);
    });

  return {
    generatedAt: new Date(now).toISOString(),
    totalCount: items.length,
    items: items.slice(0, 5).map(({ commitment, reasons }) => ({
      commitmentId: commitment.id,
      title: commitment.title,
      summary: commitment.summary,
      status: commitment.status,
      urgency: commitment.urgency,
      riskClass: commitment.riskClass,
      confidence: commitment.confidence,
      dueAt: commitment.dueAt,
      reasons: reasons.slice(0, 3),
      suggestedNextAction: commitment.suggestedNextAction
    }))
  };
}

function buildDashboardControlPlane(params: {
  activeWorkspace: Workspace | null;
  workspaceMembers: WorkspaceMember[];
  workspaceGovernance: WorkspaceGovernance | null;
  goals: GoalBundle[];
  approvals: ApprovalRequest[];
  evidenceRecords: EvidenceRecord[];
  commitments: Commitment[];
  autopilotSettings: AutopilotSettings;
  autopilotEvents: AutopilotEvent[];
  memories: MemoryRecord[];
  watchers: Watcher[];
  integrations: IntegrationAccount[];
  diagnostics: DashboardDiagnostics;
}): DashboardControlPlane {
  const freshnessNow = Date.parse(params.diagnostics.generatedAt);
  const openCommitments = params.commitments.filter(
    (commitment) => commitment.status !== "completed" && commitment.status !== "dismissed"
  );
  const needsReviewCommitments = openCommitments.filter(
    (commitment) => commitment.status === "needs-review" || commitment.status === "stale"
  );
  const blockedCommitments = openCommitments.filter((commitment) => commitment.status === "blocked");
  const failedEvents = params.autopilotEvents.filter((event) => event.status === "failed");
  const pendingEvents = params.autopilotEvents.filter((event) => event.status === "pending");
  const activeWatchers = params.watchers.filter((watcher) => watcher.status === "active");
  const openGoals = params.goals.filter((bundle) => bundle.goal.status !== "completed");
  const runningGoals = openGoals.filter((bundle) => bundle.goal.status === "running");
  const pendingApprovals = params.approvals.filter((approval) => approval.decision === "pending");
  const respondedApprovals = params.approvals.filter((approval) => approval.decision !== "pending");
  const staleMemories = params.memories.filter((record) => getMemoryFreshness(record, freshnessNow) !== "fresh");
  const readyIntegrations = params.integrations.filter((integration) => integration.status === "ready");
  const tracedApprovalIds = new Set(params.evidenceRecords.map((record) => record.approvalId));
  const tracedApprovals = respondedApprovals.filter((approval) => tracedApprovalIds.has(approval.id));
  const missingEvidenceApprovals = respondedApprovals.filter((approval) => !tracedApprovalIds.has(approval.id));
  const executionDiagnosticTarget =
    params.diagnostics.items.find(
      (item) => item.kind === "stuck_workflows" || item.kind === "expired_approvals"
    )?.targets[0] ?? null;
  const trustDiagnosticTarget = params.diagnostics.items[0]?.targets[0] ?? null;

  const sections: DashboardControlPlaneSection[] = [
    {
      key: "workspace",
      title: "Workspace",
      description: params.activeWorkspace
        ? `${params.activeWorkspace.name} is the active operating surface for goals, approvals, and governance.`
        : "No workspace is currently active.",
      status: params.activeWorkspace ? "healthy" : "idle",
      targetSection: "workspaces",
      stats: [
        `${pluralize(params.workspaceMembers.length, "member")}`,
        `${pluralize(readyIntegrations.length, "ready integration")}`,
        `Approval ${params.workspaceGovernance?.approvalMode.replaceAll("_", " ") ?? "risk based"}`
      ],
      highlights: [
        params.workspaceGovernance ? `Max auto-run ${params.workspaceGovernance.maxAutoRunRiskClass}` : null,
        readyIntegrations[0] ? `${readyIntegrations[0].name} connected` : null
      ].filter((highlight): highlight is string => highlight !== null)
    },
    {
      key: "commitments",
      title: "Now",
      description: "Open commitments and pending reviews that define the immediate operator queue.",
      status:
        needsReviewCommitments.length > 0
          ? "critical"
          : blockedCommitments.length > 0 || openCommitments.length > 0
            ? "attention"
            : "idle",
      targetSection: "commitments",
      stats: [
        `${pluralize(openCommitments.length, "open commitment")}`,
        `${pluralize(needsReviewCommitments.length, "needs-review item")}`,
        `${pluralize(blockedCommitments.length, "blocked item")}`
      ],
      highlights: openCommitments.slice(0, 3).map((commitment) => commitment.title)
    },
    {
      key: "automation",
      title: "Automation",
      description: `Autopilot is currently ${params.autopilotSettings.mode.replaceAll("_", " ")} with watcher-driven execution signals.`,
      status:
        failedEvents.length > 0
          ? "critical"
          : params.autopilotSettings.mode === "auto_run" || pendingEvents.length > 0 || activeWatchers.length > 0
            ? "attention"
            : "healthy",
      targetSection: "autopilot",
      stats: [
        `Mode ${params.autopilotSettings.mode.replaceAll("_", " ")}`,
        `${pluralize(activeWatchers.length, "active watcher")}`,
        `${pluralize(failedEvents.length, "failed event")}`
      ],
      highlights: [
        failedEvents[0]?.summary ?? null,
        pendingEvents[0]?.summary ?? null,
        params.autopilotSettings.mode === "auto_run" ? "Auto-run is enabled." : null
      ].filter((highlight): highlight is string => highlight !== null)
    },
    {
      key: "execution",
      title: "Execution",
      description: "Workflow execution health across active goals, task progress, and approval bottlenecks.",
      status:
        executionDiagnosticTarget
          ? "critical"
          : pendingApprovals.length > 0 || openGoals.length > 0
            ? "attention"
            : "healthy",
      targetSection: executionDiagnosticTarget?.section ?? "goals",
      targetItemId: executionDiagnosticTarget?.itemId,
      stats: [
        `${pluralize(openGoals.length, "active goal")}`,
        `${pluralize(runningGoals.length, "running goal")}`,
        `${pluralize(pendingApprovals.length, "pending approval")}`
      ],
      highlights:
        executionDiagnosticTarget
          ? params.diagnostics.items
              .filter((item) => item.kind === "stuck_workflows" || item.kind === "expired_approvals")
              .flatMap((item) => item.reasons)
              .slice(0, 3)
          : openGoals.slice(0, 3).map((bundle) => bundle.goal.title)
    },
    {
      key: "trust",
      title: "Trust",
      description: "Trust posture across approvals, memory freshness, and workspace governance controls.",
      status:
        params.diagnostics.status === "critical"
          ? "critical"
          : params.diagnostics.status === "warning"
            ? "attention"
            : "healthy",
      targetSection: trustDiagnosticTarget?.section ?? "governance",
      targetItemId: trustDiagnosticTarget?.itemId,
      stats: [
        `${pluralize(params.diagnostics.totalCount, "reliability signal")}`,
        respondedApprovals.length > 0
          ? `${tracedApprovals.length}/${respondedApprovals.length} approvals traced`
          : formatCount(staleMemories.length, "stale memory", "stale memories"),
        `Max auto ${params.workspaceGovernance?.maxAutoRunRiskClass ?? "R1"}`
      ],
      highlights:
        params.diagnostics.totalCount > 0
          ? params.diagnostics.items.flatMap((item) => item.reasons).slice(0, 3)
          : missingEvidenceApprovals.length > 0
            ? missingEvidenceApprovals.slice(0, 3).map((approval) => `Missing evidence lineage for ${approval.title}.`)
            : ["No active trust or reliability regressions."]
    }
  ];

  return {
    generatedAt: params.diagnostics.generatedAt,
    sections
  };
}

function defaultUser(userId: string) {
  return UserRecordSchema.parse({
    id: userId,
    name: "Leonard",
    timezone: process.env.TZ ?? "Asia/Singapore",
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
      content: "Leonard prefers concise, auditable plans with explicit trade-offs and exact run commands.",
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

  return GoalBundleSchema.parse({
    goal,
    workflow,
    tasks: store.tasks.filter((task) => task.goalId === goalId).sort((left, right) => left.createdAt.localeCompare(right.createdAt)),
    artifacts: store.artifacts.filter((artifact) => artifact.goalId === goalId).sort((left, right) => left.createdAt.localeCompare(right.createdAt)),
    approvals: store.approvals.filter((approval) => approval.goalId === goalId).sort((left, right) => left.createdAt.localeCompare(right.createdAt)),
    watchers: store.watchers.filter((watcher) => watcher.goalId === goalId).sort((left, right) => left.createdAt.localeCompare(right.createdAt)),
    actionLogs: store.actionLogs.filter((log) => log.goalId === goalId).sort((left, right) => left.createdAt.localeCompare(right.createdAt))
  });
}

function mergeGoalBundleIntoStore(store: RuntimeStore, bundle: GoalBundle): GoalBundle {
  const validated = GoalBundleSchema.parse(bundle);
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

function assertGoalExistsInStore(store: RuntimeStore, goalId: string): void {
  if (!store.goals.some((goal) => goal.id === goalId)) {
    throw new Error(`Goal ${goalId} was not found.`);
  }
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
    approvalMode: "risk_based",
    requireAuditExports: false,
    maxAutoRunRiskClass: "R1",
    externalSendRequiresApproval: true,
    calendarWriteRequiresApproval: true,
    retentionDays: 365,
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

function goalByIdFromStore(store: RuntimeStore, goalId: string): GoalBundle["goal"] | null {
  return store.goals.find((candidate) => candidate.id === goalId) ?? null;
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

function buildWorkspaceAuditExport(params: {
  workspace: Workspace;
  governance: WorkspaceGovernance | null;
  members: WorkspaceMember[];
  goals: GoalBundle[];
  goalShares: GoalShareRecord[];
  privacyOperations: PrivacyOperation[];
}): WorkspaceAuditExport {
  const generatedAt = nowIso();

  return {
    workspaceId: params.workspace.id,
    fileName: `${params.workspace.slug}-audit-${generatedAt.slice(0, 10)}.json`,
    contentType: "application/json",
    generatedAt,
    content: JSON.stringify(
      {
        generatedAt,
        workspace: params.workspace,
        governance: params.governance,
        members: params.members,
        goalShares: params.goalShares,
        privacyOperations: params.privacyOperations,
        goals: params.goals.map((bundle) => ({
          goal: bundle.goal,
          workflow: bundle.workflow,
          tasks: bundle.tasks,
          approvals: bundle.approvals,
          watchers: bundle.watchers,
          artifacts: bundle.artifacts,
          actionLogs: bundle.actionLogs
        }))
      },
      null,
      2
    )
  };
}

const DAY_IN_MS = 24 * 60 * 60 * 1000;

function resolveRetentionWindow(retentionDays: number, now = nowIso()): {
  effectiveNow: string;
  effectiveNowMs: number;
  retentionCutoff: string;
  retentionCutoffMs: number;
} {
  if (!Number.isInteger(retentionDays) || retentionDays < 0) {
    throw new Error(`Retention days must be a non-negative integer. Received ${retentionDays}.`);
  }

  const effectiveNowMs = Date.parse(now);

  if (!Number.isFinite(effectiveNowMs)) {
    throw new Error(`Invalid retention clock value: ${now}.`);
  }

  const retentionCutoffMs = effectiveNowMs - retentionDays * DAY_IN_MS;

  return {
    effectiveNow: new Date(effectiveNowMs).toISOString(),
    effectiveNowMs,
    retentionCutoff: new Date(retentionCutoffMs).toISOString(),
    retentionCutoffMs
  };
}

function isGoalOwnedByWorkspace(goal: GoalBundle["goal"], workspace: Workspace): boolean {
  if (goal.workspaceId) {
    return goal.workspaceId === workspace.id;
  }

  return workspace.isPersonal && goal.userId === workspace.ownerUserId;
}

function workspaceGoalIdsFromStore(store: RuntimeStore, workspace: Workspace): Set<string> {
  return new Set(store.goals.filter((goal) => isGoalOwnedByWorkspace(goal, workspace)).map((goal) => goal.id));
}

function goalShareTerminalAt(share: Pick<GoalShareRecord, "expiresAt" | "revokedAt">): string {
  return share.revokedAt ?? share.expiresAt;
}

function buildDeletedWorkspaceTombstone(workspace: Workspace, operationId: string, now = nowIso()): Workspace {
  const shortWorkspaceId = workspace.id.replace(/[^a-z0-9]/gi, "").slice(0, 24).toLowerCase() || "workspace";
  const shortOperationId = operationId.replace(/[^a-z0-9]/gi, "").slice(0, 8).toLowerCase() || "deleted";
  const slug = `deleted-${shortWorkspaceId}-${shortOperationId}`.slice(0, 120);

  return WorkspaceSchema.parse({
    ...workspace,
    slug,
    name: `Deleted workspace ${workspace.id.slice(0, 8)}`,
    description: `Deleted on ${now} by privacy operation ${operationId}.`,
    updatedAt: now
  });
}

function isJobScopedToWorkspace(
  job: JobRecord,
  params: {
    workspaceId: string;
    goalIds: ReadonlySet<string>;
    watcherIds: ReadonlySet<string>;
    preservedPrivacyOperationId?: string;
  }
): boolean {
  switch (job.payload.type) {
    case "goal_create":
      return job.payload.workspaceId === params.workspaceId || params.goalIds.has(job.payload.goalId);
    case "autopilot_process":
      return params.watcherIds.has(job.payload.sourceId);
    case "privacy_operation":
      return (
        job.payload.workspaceId === params.workspaceId &&
        job.payload.operationId !== params.preservedPrivacyOperationId
      );
    default:
      return false;
  }
}

function buildPendingAutopilotEvent(params: {
  userId: string;
  kind: AutopilotEventKind;
  sourceId: string;
  idempotencyKey?: string | null;
  mode: AutopilotMode;
  summary: string;
  details?: Record<string, unknown>;
  actorContext?: ActorContext | null;
}): AutopilotEvent {
  return AutopilotEventSchema.parse({
    id: crypto.randomUUID(),
    userId: params.userId,
    kind: params.kind,
    sourceId: params.sourceId,
    idempotencyKey: params.idempotencyKey ?? null,
    mode: params.mode,
    summary: params.summary,
    status: "pending",
    details: params.details ?? {},
    actorContext: params.actorContext ?? null,
    createdAt: nowIso(),
    processedAt: null,
    resultGoalId: null,
    error: null
  });
}

function sortJobsForClaim(items: JobRecord[]): JobRecord[] {
  return [...items].sort((left, right) => {
    const availableOrder = left.availableAt.localeCompare(right.availableAt);
    if (availableOrder !== 0) {
      return availableOrder;
    }

    return left.createdAt.localeCompare(right.createdAt);
  });
}

function isJobClaimable(job: JobRecord, now: number): boolean {
  if (job.status === "queued" || job.status === "retrying") {
    return Date.parse(job.availableAt) <= now;
  }

  if (job.status === "running" && job.leaseExpiresAt) {
    return Date.parse(job.leaseExpiresAt) <= now;
  }

  return false;
}

function claimJobRecord(job: JobRecord, runnerId: string, leaseMs: number, claimedAt: string): JobRecord {
  return JobRecordSchema.parse({
    ...job,
    status: "running",
    attemptCount: job.attemptCount + 1,
    claimedBy: runnerId,
    claimedAt,
    lastAttemptAt: claimedAt,
    leaseExpiresAt: new Date(Date.parse(claimedAt) + leaseMs).toISOString(),
    completedAt: null,
    deadLetteredAt: null,
    updatedAt: claimedAt
  });
}

function assertRunningJobOwner(job: JobRecord, runnerId: string): void {
  if (job.status !== "running") {
    throw new JobMutationError("not_running", `Job ${job.id} is not currently running.`);
  }

  if (job.claimedBy !== runnerId) {
    throw new JobMutationError("not_owner", `Job ${job.id} is claimed by another worker.`);
  }
}

function buildApprovalEvidenceRecord(params: {
  actor: ActorContext;
  previousBundle: GoalBundle;
  updatedBundle: GoalBundle;
  originalApproval: ApprovalRequest;
}): EvidenceRecord {
  const updatedApproval = params.updatedBundle.approvals.find(
    (candidate) => candidate.id === params.originalApproval.id
  );
  const updatedTask = params.updatedBundle.tasks.find(
    (candidate) => candidate.id === params.originalApproval.taskId
  );

  if (!updatedApproval) {
    throw new Error(`Approval ${params.originalApproval.id} is missing after response processing.`);
  }

  if (!updatedTask) {
    throw new Error(`Task ${params.originalApproval.taskId} is missing after response processing.`);
  }

  if (updatedApproval.decision === "pending" || !updatedApproval.respondedAt || !updatedApproval.decisionScope) {
    throw new Error(`Approval ${params.originalApproval.id} did not persist a complete response state.`);
  }

  const previousLogIds = new Set(params.previousBundle.actionLogs.map((log) => log.id));
  const actionLogIds = params.updatedBundle.actionLogs
    .filter((log) => !previousLogIds.has(log.id))
    .map((log) => log.id);
  const artifactIds =
    updatedApproval.actionIntent?.type === "manual_review" ? updatedApproval.actionIntent.artifactIds : [];

  return EvidenceRecordSchema.parse({
    id: crypto.randomUUID(),
    userId: subjectUserIdForActor(params.actor),
    goalId: params.updatedBundle.goal.id,
    taskId: params.originalApproval.taskId,
    approvalId: params.originalApproval.id,
    sourceKind: "approval_response",
    sourceId: params.originalApproval.id,
    sourceSummary: `${updatedApproval.decision === "approved" ? "Approved" : "Rejected"} "${params.originalApproval.title}".`,
    riskClass: params.originalApproval.riskClass,
    requestedAction: params.originalApproval.requestedAction,
    requestRationale: params.originalApproval.rationale,
    requiresApproval: true,
    decision: updatedApproval.decision,
    decisionScope: updatedApproval.decisionScope,
    decisionRationale: updatedApproval.decisionRationale,
    respondedAt: updatedApproval.respondedAt,
    resultingTaskState: updatedTask.state,
    resultingGoalStatus: params.updatedBundle.goal.status,
    actionLogIds,
    artifactIds,
    memoryIds: [],
    actorContext: parseActorContext(params.actor),
    createdAt: updatedApproval.respondedAt,
    updatedAt: updatedApproval.respondedAt
  });
}

// Built-in agent definitions to seed into the database
function defaultAgents(userId: string): AgentDefinition[] {
  const timestamp = nowIso();
  
  const builtInAgents: Array<{ name: string; displayName: string; description: string; systemPrompt: string; artifactType: "summary" | "brief" | "checklist" | "draft" | "explanation"; category: "productivity" | "communication" | "research" | "scheduling" | "finance" | "development" | "creative" | "administrative" | "custom" }> = [
    {
      name: "communications",
      displayName: "Communications Agent",
      description: "Triage communications, draft replies, and prepare escalation notes",
      systemPrompt: "You are a communications triage specialist. You analyze inbound messages, identify urgency and sender context, draft replies, and prepare escalation notes. Be concise and actionable. Output sender-aware guidance with clear priority rankings.",
      artifactType: "summary",
      category: "communication"
    },
    {
      name: "calendar",
      displayName: "Calendar Agent",
      description: "Review schedules, detect conflicts, and recommend reschedules",
      systemPrompt: "You are a calendar and scheduling analyst. You review existing commitments, detect conflicts, identify overload windows, and recommend reschedule candidates. Output a structured brief with time-block analysis.",
      artifactType: "brief",
      category: "scheduling"
    },
    {
      name: "workflow",
      displayName: "Workflow Agent",
      description: "Decompose requests into action items with checkpoints",
      systemPrompt: "You are a workflow planner. You decompose requests into concrete, ordered action items with checkpoints and reminders. Output a structured checklist with dependencies and resumable checkpoints.",
      artifactType: "checklist",
      category: "productivity"
    },
    {
      name: "research",
      displayName: "Research Agent",
      description: "Gather evidence, compare options, and surface risks",
      systemPrompt: "You are a research analyst. You gather evidence, compare options, surface risks and assumptions, and separate confirmed facts from inferences. Output a structured brief with sourced findings.",
      artifactType: "brief",
      category: "research"
    },
    {
      name: "knowledge",
      displayName: "Knowledge Agent",
      description: "Surface relevant preferences and contextual background",
      systemPrompt: "You are a knowledge retrieval specialist. You surface relevant preferences, standing instructions, and contextual background. Prioritize confirmed information over inferred. Output a structured explanation.",
      artifactType: "explanation",
      category: "research"
    },
    {
      name: "travel",
      displayName: "Travel Agent",
      description: "Assemble itineraries, checklists, and travel assessments",
      systemPrompt: "You are a travel preparation specialist. You assemble itineraries, checklists, booking confirmations, and travel risk assessments. Output a comprehensive travel brief.",
      artifactType: "brief",
      category: "administrative"
    },
    {
      name: "personal-admin",
      displayName: "Personal Admin Agent",
      description: "Handle routine personal tasks and life logistics",
      systemPrompt: "You are a personal administration specialist. You handle routine personal tasks, document organization, and life logistics. Output an actionable summary.",
      artifactType: "summary",
      category: "administrative"
    },
    {
      name: "finance-support",
      displayName: "Finance Agent",
      description: "Track expenses and prepare budget summaries",
      systemPrompt: "You are a finance operations specialist. You track expenses, prepare budget summaries, and flag financial action items. Output a structured financial brief.",
      artifactType: "brief",
      category: "finance"
    },
    {
      name: "orchestrator",
      displayName: "Orchestrator Agent",
      description: "Coordinate between agents and ensure workflow coherence",
      systemPrompt: "You are a meta-orchestrator. You coordinate between specialized agents, resolve conflicts, and ensure workflow coherence. Output a coordination summary.",
      artifactType: "summary",
      category: "productivity"
    }
  ];

  return builtInAgents.map((agent) =>
    AgentDefinitionSchema.parse({
      id: `agent-builtin-${agent.name}`,
      userId,
      name: agent.name,
      displayName: agent.displayName,
      description: agent.description,
      icon: getAgentIcon(agent.category),
      category: agent.category,
      tags: ["built-in"],
      systemPrompt: agent.systemPrompt,
      promptVariables: [],
      artifactType: agent.artifactType,
      behaviorConfig: {
        temperature: 0.7,
        maxTokens: 1500,
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
      isBuiltIn: true,
      parentAgentId: null,
      version: 1,
      status: "active",
      createdAt: timestamp,
      updatedAt: timestamp
    })
  );
}

function defaultOperatorProducts(userId: string): OperatorProduct[] {
  const timestamp = nowIso();

  return [
    OperatorProductSchema.parse({
      id: "operator-product-communications",
      userId,
      slug: "communications-operator",
      name: "Communications Operator",
      tagline: "Run inbox, follow-up, and escalation workflows from one control surface.",
      description:
        "Packages the communications, workflow, knowledge, and calendar agents into one operator product focused on triage, response drafting, escalation handling, and timing-sensitive follow-ups.",
      icon: "✉️",
      recommendedAgentIds: [
        "agent-builtin-communications",
        "agent-builtin-workflow",
        "agent-builtin-knowledge",
        "agent-builtin-calendar"
      ],
      recommendedTemplateIds: [],
      recommendedIntegrations: [
        {
          system: "local-notes",
          label: "Local notes",
          readiness: "ready",
          description: "Capture standing instructions, relationship context, and reusable reply patterns."
        },
        {
          system: "gmail",
          label: "Email connector",
          readiness: "recommended",
          description: "Pull recent threads and push drafted responses into a real communications queue."
        },
        {
          system: "google-calendar",
          label: "Calendar connector",
          readiness: "recommended",
          description: "Use meeting load and deadlines to prioritize outbound communication work."
        }
      ],
      kpis: [
        {
          id: "inbox-latency",
          label: "Inbox response latency",
          description: "Measure time from inbound message to approved outbound draft.",
          metric: "Median approval-to-draft turnaround"
        },
        {
          id: "escalation-coverage",
          label: "Escalation coverage",
          description: "Track whether high-risk threads get summarized with clear next steps.",
          metric: "Escalation briefs per critical thread"
        },
        {
          id: "follow-up-closure",
          label: "Follow-up closure",
          description: "Keep open threads and promised replies visible until resolved.",
          metric: "Commitments closed within SLA"
        }
      ],
      onboardingSteps: [
        {
          id: "notes-context",
          title: "Capture communication preferences",
          description: "Store tone, escalation style, and sender-specific guidance in memory.",
          actionLabel: "Review memory"
        },
        {
          id: "template-seeding",
          title: "Seed repeatable communication workflows",
          description: "Create reusable triage and follow-up templates before high-volume usage.",
          actionLabel: "Load templates"
        },
        {
          id: "connector-readiness",
          title: "Connect real communication systems",
          description: "Move from mock integrations to live inbox and calendar sources.",
          actionLabel: "Review integrations"
        }
      ],
      isBuiltIn: true,
      status: "active",
      createdAt: timestamp,
      updatedAt: timestamp
    })
  ];
}

function getAgentIcon(category: string): string {
  const icons: Record<string, string> = {
    communication: "📨",
    scheduling: "📅",
    research: "🔍",
    productivity: "✅",
    finance: "💰",
    administrative: "🏠",
    development: "💻",
    creative: "🎨",
    custom: "🤖"
  };
  return icons[category] || "🤖";
}

class FileRepository implements AgenticRepository {
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

    try {
      return await callback();
    } finally {
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
    const tempPath = `${this.storePath}.tmp`;

    await mkdir(directory, { recursive: true });
    await writeFile(tempPath, JSON.stringify(validated, null, 2), "utf8");
    await rename(tempPath, this.storePath);
  }

  async seedDefaults(userId = SYSTEM_USER_ID): Promise<void> {
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

      store.workspaceMembers = upsertById(store.workspaceMembers, validated);
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

        if (isPurgeEligible) {
          purgedSharesCount += 1;
          return [];
        }

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

  async saveWorkspaceGovernance(
    governance: WorkspaceGovernance,
    actor: ActorContext
  ): Promise<WorkspaceGovernance> {
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

    return buildWorkspaceAuditExport({
      workspace,
      governance,
      members,
      goals,
      goalShares,
      privacyOperations
    });
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

      const originalApproval = bundle.approvals.find((candidate) => candidate.id === params.approvalId);

      if (!originalApproval) {
        throw new ApprovalMutationError("not_found", `Approval ${params.approvalId} was not found.`);
      }

      const updatedBundle = applyApprovalResponse({
        bundle,
        approvalId: params.approvalId,
        decision: params.decision,
        actor,
        scope: params.scope,
        rationale: params.rationale
      });
      const evidenceRecord = buildApprovalEvidenceRecord({
        actor,
        previousBundle: bundle,
        updatedBundle,
        originalApproval
      });

      mergeGoalBundleIntoStore(store, updatedBundle);
      store.evidenceRecords = upsertById(store.evidenceRecords, evidenceRecord);
      await this.writeStore(store);
      return GoalBundleSchema.parse(clone(updatedBundle));
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

  async listEvidenceRecords(params?: {
    userId?: string;
    goalId?: string;
    approvalId?: string;
  }): Promise<EvidenceRecord[]> {
    const userId = params?.userId ?? SYSTEM_USER_ID;
    const store = await this.readStore();
    const goalIds = goalIdsForUser(store, userId);

    return sortByCreatedDesc(
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
    ).map((record) => EvidenceRecordSchema.parse(clone(record)));
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
    details?: Record<string, unknown>;
    actorContext?: ActorContext | null;
    debounceMinutes: number;
  }): Promise<AutopilotEventClaim> {
    return this.withMutationLock(async () => {
      const userId = params.userId ?? SYSTEM_USER_ID;
      const store = await this.readStore();
      const trimmedKey = params.idempotencyKey?.trim() || null;

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

      const debounceCutoff = Date.now() - params.debounceMinutes * 60 * 1000;
      const recent = store.autopilotEvents.find((event) => {
        if (event.userId !== userId || event.kind !== params.kind || event.sourceId !== params.sourceId) {
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
            details: {
              ...(params.details ?? {}),
              debouncedByEventId: recent.id
            }
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

      const claimed = buildPendingAutopilotEvent({
        userId,
        kind: params.kind,
        sourceId: params.sourceId,
        idempotencyKey: trimmedKey,
        mode: params.mode,
        summary: params.summary,
        actorContext: params.actorContext,
        details: params.details
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
      const validated = AutopilotEventSchema.parse(event);
      store.autopilotEvents = upsertById(store.autopilotEvents, validated);
      await this.writeStore(store);
      return AutopilotEventSchema.parse(clone(validated));
    });
  }

  async listJobs(params?: {
    userId?: string;
    kinds?: JobKind[];
    statuses?: JobStatus[];
  }): Promise<JobRecord[]> {
    const store = await this.readStore();
    const kinds = params?.kinds?.map((kind) => JobKindSchema.parse(kind)) ?? [];
    const statuses = params?.statuses?.map((status) => JobStatusSchema.parse(status)) ?? [];

    return sortByCreatedDesc(
      store.jobs.filter((job) => {
        if (params?.userId && job.userId !== params.userId) {
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
    ).map((job) => JobRecordSchema.parse(clone(job)));
  }

  async getJob(jobId: string, userId = SYSTEM_USER_ID): Promise<JobRecord | null> {
    const store = await this.readStore();
    const job = store.jobs.find((candidate) => candidate.id === jobId && candidate.userId === userId);
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
    runnerId: string;
    leaseMs: number;
    now?: string;
  }): Promise<JobRecord | null> {
    return this.withMutationLock(async () => {
      const store = await this.readStore();
      const claimedAt = params.now ?? nowIso();
      const kinds = params.kinds?.map((kind) => JobKindSchema.parse(kind)) ?? [];
      const claimable = sortJobsForClaim(
        store.jobs.filter((job) => {
          if (params.userId && job.userId !== params.userId) {
            return false;
          }

          if (kinds.length > 0 && !kinds.includes(job.kind)) {
            return false;
          }

          return isJobClaimable(job, Date.parse(claimedAt));
        })
      )[0];

      if (!claimable) {
        return null;
      }

      const claimed = claimJobRecord(claimable, params.runnerId, params.leaseMs, claimedAt);
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

      assertRunningJobOwner(existing, params.runnerId);
      const completedAt = params.completedAt ?? nowIso();
      const completed = JobRecordSchema.parse({
        ...existing,
        status: "completed",
        leaseExpiresAt: null,
        completedAt,
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
    availableAt: string;
    error: string;
  }): Promise<JobRecord> {
    return this.withMutationLock(async () => {
      const store = await this.readStore();
      const existing = store.jobs.find((job) => job.id === params.jobId);

      if (!existing) {
        throw new JobMutationError("not_found", `Job ${params.jobId} does not exist.`);
      }

      assertRunningJobOwner(existing, params.runnerId);
      const updatedAt = nowIso();
      const retried = JobRecordSchema.parse({
        ...existing,
        status: "retrying",
        claimedBy: null,
        claimedAt: null,
        leaseExpiresAt: null,
        availableAt: params.availableAt,
        lastError: params.error.trim().slice(0, 1000),
        updatedAt
      });
      store.jobs = upsertById(store.jobs, retried);
      await this.writeStore(store);
      return JobRecordSchema.parse(clone(retried));
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

      assertRunningJobOwner(existing, params.runnerId);
      const deadLetteredAt = params.deadLetteredAt ?? nowIso();
      const deadLettered = JobRecordSchema.parse({
        ...existing,
        status: "dead_letter",
        leaseExpiresAt: null,
        deadLetteredAt,
        lastError: params.error.trim().slice(0, 1000),
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

    return sortByCreatedDesc(watchers).map((watcher) => WatcherSchema.parse(clone(watcher)));
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
      .map((watcher) => WatcherSchema.parse(clone(watcher)));

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

  async saveWatcher(watcher: Watcher): Promise<Watcher> {
    return this.withMutationLock(async () => {
      const store = await this.readStore();
      const validated = WatcherSchema.parse(watcher);
      assertGoalExistsInStore(store, validated.goalId);
      store.watchers = upsertById(store.watchers, validated);
      await this.writeStore(store);
      return WatcherSchema.parse(clone(validated));
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
    const [commitments, briefingPreferences, autopilotSettings, autopilotEventsPage, memoryPage, integrationsPage, goalShares] =
      await Promise.all([
        this.listCommitments(userId),
        this.getBriefingPreferences(userId),
        this.getAutopilotSettings(userId),
        this.listAutopilotEventsPage({ userId, limit: DASHBOARD_AUTOPILOT_EVENT_LIMIT }),
        this.listMemoryPage({ userId, limit: DASHBOARD_MEMORY_LIMIT }),
        this.listIntegrationsPage({ userId, limit: DASHBOARD_INTEGRATION_LIMIT }),
        this.listGoalShares({ userId })
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
      filterBundlesForWorkspace,
      mergeCommitments,
      buildDiagnostics: buildDashboardDiagnostics,
      buildControlPlane: buildDashboardControlPlane,
      buildNowQueue,
      buildOperatingSections: buildDashboardOperatingSections,
      buildBriefingHistory,
      sortArtifacts: sortByCreatedDesc,
      sortActionLogs: sortByCreatedDesc
    });
  }
}

class PostgresRepository implements AgenticRepository {
  backend = "postgres" as const;
  private readonly pool: Pool;
  private readonly ready: Promise<void>;

  constructor(
    url: string,
    options?: {
      autoMigrate?: boolean;
    }
  ) {
    this.pool = new Pool({ connectionString: url });
    this.ready = options?.autoMigrate
      ? runDatabaseMigrations({ pool: this.pool }).then(() => undefined)
      : assertDatabaseSchemaReady({ pool: this.pool }).then(() => undefined);
  }

  private async withTransaction<T>(callback: (client: PoolClient) => Promise<T>): Promise<T> {
    await this.ready;
    const client = await this.pool.connect();

    try {
      await client.query("BEGIN");
      const result = await callback(client);
      await client.query("COMMIT");
      return result;
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  private async saveMemoryWithClient(client: PoolClient, record: MemoryRecord): Promise<void> {
    const memory = MemoryRecordSchema.parse(record);
    await client.query(
      `
        insert into memory_records (
          id, user_id, category, memory_type, content, confidence, source, sensitivity, permissions, actor_context, review_at, expiry_at, created_at, updated_at
        )
        values ($1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb, $10::jsonb, $11, $12, $13, $14)
        on conflict (id) do update
        set category = excluded.category,
            memory_type = excluded.memory_type,
            content = excluded.content,
            confidence = excluded.confidence,
            source = excluded.source,
            sensitivity = excluded.sensitivity,
            permissions = excluded.permissions,
            actor_context = excluded.actor_context,
            review_at = excluded.review_at,
            expiry_at = excluded.expiry_at,
            updated_at = excluded.updated_at
      `,
      [
        memory.id,
        memory.userId,
        memory.category,
        memory.memoryType,
        memory.content,
        memory.confidence,
        memory.source,
        memory.sensitivity,
        JSON.stringify(memory.permissions),
        JSON.stringify(memory.actorContext),
        memory.reviewAt,
        memory.expiryAt,
        memory.createdAt,
        memory.updatedAt
      ]
    );
  }

  private async saveEvidenceRecordWithClient(client: PoolClient, record: EvidenceRecord): Promise<void> {
    const evidence = EvidenceRecordSchema.parse(record);
    await client.query(
      `
        insert into evidence_records (
          id, user_id, goal_id, task_id, approval_id, source_kind, source_id, source_summary, risk_class, requested_action,
          request_rationale, requires_approval, decision, decision_scope, decision_rationale, responded_at,
          resulting_task_state, resulting_goal_status, action_log_ids, artifact_ids, memory_ids, created_at, updated_at
        )
        values (
          $1, $2, $3, $4, $5, $6, $7, $8, $9, $10,
          $11, $12, $13, $14, $15, $16,
          $17, $18, $19::jsonb, $20::jsonb, $21::jsonb, $22, $23
        )
        on conflict (id) do update
        set user_id = excluded.user_id,
            goal_id = excluded.goal_id,
            task_id = excluded.task_id,
            approval_id = excluded.approval_id,
            source_kind = excluded.source_kind,
            source_id = excluded.source_id,
            source_summary = excluded.source_summary,
            risk_class = excluded.risk_class,
            requested_action = excluded.requested_action,
            request_rationale = excluded.request_rationale,
            requires_approval = excluded.requires_approval,
            decision = excluded.decision,
            decision_scope = excluded.decision_scope,
            decision_rationale = excluded.decision_rationale,
            responded_at = excluded.responded_at,
            resulting_task_state = excluded.resulting_task_state,
            resulting_goal_status = excluded.resulting_goal_status,
            action_log_ids = excluded.action_log_ids,
            artifact_ids = excluded.artifact_ids,
            memory_ids = excluded.memory_ids,
            updated_at = excluded.updated_at
      `,
      [
        evidence.id,
        evidence.userId,
        evidence.goalId,
        evidence.taskId,
        evidence.approvalId,
        evidence.sourceKind,
        evidence.sourceId,
        evidence.sourceSummary,
        evidence.riskClass,
        evidence.requestedAction,
        evidence.requestRationale,
        evidence.requiresApproval,
        evidence.decision,
        evidence.decisionScope,
        evidence.decisionRationale,
        evidence.respondedAt,
        evidence.resultingTaskState,
        evidence.resultingGoalStatus,
        JSON.stringify(evidence.actionLogIds),
        JSON.stringify(evidence.artifactIds),
        JSON.stringify(evidence.memoryIds),
        evidence.createdAt,
        evidence.updatedAt
      ]
    );
  }

  private async saveIntegrationWithClient(client: PoolClient, account: IntegrationAccount): Promise<void> {
    const integration = IntegrationAccountSchema.parse(account);
    await client.query(
      `
        insert into integration_accounts (
          id, user_id, name, system, status, scopes, capabilities, metadata, actor_context, created_at, updated_at
        )
        values ($1, $2, $3, $4, $5, $6::jsonb, $7::jsonb, $8::jsonb, $9::jsonb, $10, $11)
        on conflict (user_id, id) do update
        set name = excluded.name,
            system = excluded.system,
            status = excluded.status,
            scopes = excluded.scopes,
            capabilities = excluded.capabilities,
            metadata = excluded.metadata,
            actor_context = excluded.actor_context,
            updated_at = excluded.updated_at
      `,
      [
        integration.id,
        integration.userId,
        integration.name,
        integration.system,
        integration.status,
        JSON.stringify(integration.scopes),
        JSON.stringify(integration.capabilities),
        JSON.stringify(integration.metadata),
        JSON.stringify(integration.actorContext),
        integration.createdAt,
        integration.updatedAt
      ]
    );
  }

  private async saveProviderCredentialWithClient(client: PoolClient, credential: ProviderCredential): Promise<void> {
    const validated = ProviderCredentialSchema.parse(credential);
    await client.query(
      `
        insert into provider_credentials (
          id,
          user_id,
          workspace_id,
          provider,
          account_id,
          account_email,
          display_name,
          status,
          scopes,
          last_validated_at,
          last_rotated_at,
          last_refresh_at,
          last_refresh_failure_at,
          reconnect_required_at,
          revoked_at,
          expires_at,
          metadata,
          actor_context,
          created_at,
          updated_at
        )
        values (
          $1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb, $10, $11, $12, $13, $14, $15, $16, $17::jsonb, $18::jsonb, $19, $20
        )
        on conflict (user_id, id) do update
        set workspace_id = excluded.workspace_id,
            provider = excluded.provider,
            account_id = excluded.account_id,
            account_email = excluded.account_email,
            display_name = excluded.display_name,
            status = excluded.status,
            scopes = excluded.scopes,
            last_validated_at = excluded.last_validated_at,
            last_rotated_at = excluded.last_rotated_at,
            last_refresh_at = excluded.last_refresh_at,
            last_refresh_failure_at = excluded.last_refresh_failure_at,
            reconnect_required_at = excluded.reconnect_required_at,
            revoked_at = excluded.revoked_at,
            expires_at = excluded.expires_at,
            metadata = excluded.metadata,
            actor_context = excluded.actor_context,
            updated_at = excluded.updated_at
      `,
      [
        validated.id,
        validated.userId,
        validated.workspaceId,
        validated.provider,
        validated.accountId,
        validated.accountEmail,
        validated.displayName,
        validated.status,
        JSON.stringify(validated.scopes),
        validated.lastValidatedAt,
        validated.lastRotatedAt,
        validated.lastRefreshAt,
        validated.lastRefreshFailureAt,
        validated.reconnectRequiredAt,
        validated.revokedAt,
        validated.expiresAt,
        JSON.stringify(validated.metadata),
        JSON.stringify(validated.actorContext),
        validated.createdAt,
        validated.updatedAt
      ]
    );

  }

  private async saveProviderCredentialSecretWithClient(client: PoolClient, record: ProviderCredentialSecretRecord): Promise<void> {
    const validated = ProviderCredentialSecretRecordSchema.parse(record);
    await client.query(
      `
        insert into provider_credential_secrets (
          credential_id, user_id, kind, secret, created_at, updated_at
        )
        values ($1, $2, $3, $4::jsonb, $5, $6)
        on conflict (user_id, credential_id, kind) do update
        set secret = excluded.secret,
            updated_at = excluded.updated_at
      `,
      [
        validated.credentialId,
        validated.userId,
        validated.kind,
        JSON.stringify(validated.secret),
        validated.createdAt,
        validated.updatedAt
      ]
    );
  }

  private mapAgentRow(row: Record<string, unknown>): AgentDefinition {
    return AgentDefinitionSchema.parse({
      id: row.id,
      userId: row.user_id,
      name: row.name,
      displayName: row.display_name,
      description: row.description,
      icon: row.icon,
      category: row.category,
      tags: Array.isArray(row.tags) ? row.tags : [],
      systemPrompt: row.system_prompt,
      promptVariables: Array.isArray(row.prompt_variables) ? row.prompt_variables : [],
      artifactType: row.artifact_type,
      behaviorConfig: (row.behavior_config as Record<string, unknown> | null) ?? {},
      allowedCapabilities: Array.isArray(row.allowed_capabilities) ? row.allowed_capabilities : [],
      blockedCapabilities: Array.isArray(row.blocked_capabilities) ? row.blocked_capabilities : [],
      maxRiskClass: row.max_risk_class,
      integrationPermissions: Array.isArray(row.integration_permissions) ? row.integration_permissions : [],
      memoryPermissions: Array.isArray(row.memory_permissions) ? row.memory_permissions : [],
      actorContext: row.actor_context ? ActorContextSchema.parse(row.actor_context) : null,
      isBuiltIn: Boolean(row.is_built_in),
      parentAgentId: typeof row.parent_agent_id === "string" ? row.parent_agent_id : null,
      version: Number(row.version),
      status: row.status,
      createdAt: new Date(row.created_at as string | Date).toISOString(),
      updatedAt: new Date(row.updated_at as string | Date).toISOString()
    });
  }

  private mapOperatorProductRow(row: Record<string, unknown>): OperatorProduct {
    return OperatorProductSchema.parse({
      id: row.id,
      userId: row.user_id,
      slug: row.slug,
      name: row.name,
      tagline: row.tagline,
      description: row.description,
      icon: row.icon,
      recommendedAgentIds: Array.isArray(row.recommended_agent_ids) ? row.recommended_agent_ids : [],
      recommendedTemplateIds: Array.isArray(row.recommended_template_ids) ? row.recommended_template_ids : [],
      recommendedIntegrations: Array.isArray(row.recommended_integrations) ? row.recommended_integrations : [],
      kpis: Array.isArray(row.kpis) ? row.kpis : [],
      onboardingSteps: Array.isArray(row.onboarding_steps) ? row.onboarding_steps : [],
      isBuiltIn: Boolean(row.is_built_in),
      status: row.status,
      createdAt: new Date(row.created_at as string | Date).toISOString(),
      updatedAt: new Date(row.updated_at as string | Date).toISOString()
    });
  }

  private mapOperatorProductSelectionRow(row: Record<string, unknown>): OperatorProductSelection {
    return OperatorProductSelectionSchema.parse({
      userId: row.user_id,
      operatorProductId: row.operator_product_id,
      actorContext: (row.actor_context as Record<string, unknown> | null | undefined) ?? null,
      selectedAt: new Date(row.selected_at as string | Date).toISOString(),
      updatedAt: new Date(row.updated_at as string | Date).toISOString()
    });
  }

  private mapAgentMetricsRow(row: Record<string, unknown>): AgentMetrics {
    return AgentMetricsSchema.parse({
      agentId: row.agent_id,
      period: row.period,
      periodStart: new Date(row.period_start as string | Date).toISOString(),
      periodEnd: new Date(row.period_end as string | Date).toISOString(),
      tasksTotal: Number(row.tasks_total),
      tasksCompleted: Number(row.tasks_completed),
      tasksFailed: Number(row.tasks_failed),
      tasksBlocked: Number(row.tasks_blocked),
      approvalsRequested: Number(row.approvals_requested),
      approvalsApproved: Number(row.approvals_approved),
      approvalsRejected: Number(row.approvals_rejected),
      averageConfidence: row.average_confidence === null ? 0 : Number(row.average_confidence),
      averageExecutionTimeMs: row.average_execution_time_ms === null ? 0 : Number(row.average_execution_time_ms),
      artifactsProduced: Number(row.artifacts_produced),
      artifactsByType: (row.artifacts_by_type as Record<string, number> | null) ?? {},
      errorCount: Number(row.error_count),
      lastErrorAt: row.last_error_at ? new Date(row.last_error_at as string | Date).toISOString() : null,
      lastErrorMessage: typeof row.last_error_message === "string" ? row.last_error_message : null,
      feedbackCount: Number(row.feedback_count),
      userCorrectionCount:
        row.user_correction_count === undefined || row.user_correction_count === null
          ? 0
          : Number(row.user_correction_count),
      postApprovalFailureCount:
        row.post_approval_failure_count === undefined || row.post_approval_failure_count === null
          ? 0
          : Number(row.post_approval_failure_count),
      averageRating: row.average_rating === null ? null : Number(row.average_rating),
      successRate: row.success_rate === null ? 0 : Number(row.success_rate),
      approvalRate: row.approval_rate === null ? 0 : Number(row.approval_rate),
      correctionRate: row.correction_rate === undefined || row.correction_rate === null ? 0 : Number(row.correction_rate),
      postApprovalFailureRate:
        row.post_approval_failure_rate === undefined || row.post_approval_failure_rate === null
          ? 0
          : Number(row.post_approval_failure_rate),
      updatedAt: new Date(row.updated_at as string | Date).toISOString()
    });
  }

  private async saveAgentMetricsWithClient(client: PoolClient, metrics: AgentMetrics): Promise<void> {
    const validated = AgentMetricsSchema.parse(metrics);
    await client.query(
      `
        insert into agent_metrics (
          agent_id, period, period_start, period_end, tasks_total, tasks_completed, tasks_failed, tasks_blocked,
          approvals_requested, approvals_approved, approvals_rejected, average_confidence, average_execution_time_ms,
          artifacts_produced, artifacts_by_type, error_count, last_error_at, last_error_message, feedback_count,
          user_correction_count, post_approval_failure_count, average_rating, success_rate, approval_rate,
          correction_rate, post_approval_failure_rate, updated_at
        )
        values (
          $1, $2, $3, $4, $5, $6, $7, $8,
          $9, $10, $11, $12, $13,
          $14, $15::jsonb, $16, $17, $18, $19,
          $20, $21, $22, $23, $24, $25, $26
        )
        on conflict (agent_id, period) do update
        set period_start = excluded.period_start,
            period_end = excluded.period_end,
            tasks_total = excluded.tasks_total,
            tasks_completed = excluded.tasks_completed,
            tasks_failed = excluded.tasks_failed,
            tasks_blocked = excluded.tasks_blocked,
            approvals_requested = excluded.approvals_requested,
            approvals_approved = excluded.approvals_approved,
            approvals_rejected = excluded.approvals_rejected,
            average_confidence = excluded.average_confidence,
            average_execution_time_ms = excluded.average_execution_time_ms,
            artifacts_produced = excluded.artifacts_produced,
            artifacts_by_type = excluded.artifacts_by_type,
            error_count = excluded.error_count,
            last_error_at = excluded.last_error_at,
            last_error_message = excluded.last_error_message,
            feedback_count = excluded.feedback_count,
            user_correction_count = excluded.user_correction_count,
            post_approval_failure_count = excluded.post_approval_failure_count,
            average_rating = excluded.average_rating,
            success_rate = excluded.success_rate,
            approval_rate = excluded.approval_rate,
            correction_rate = excluded.correction_rate,
            post_approval_failure_rate = excluded.post_approval_failure_rate,
            updated_at = excluded.updated_at
      `,
      [
        validated.agentId,
        validated.period,
        validated.periodStart,
        validated.periodEnd,
        validated.tasksTotal,
        validated.tasksCompleted,
        validated.tasksFailed,
        validated.tasksBlocked,
        validated.approvalsRequested,
        validated.approvalsApproved,
        validated.approvalsRejected,
        validated.averageConfidence,
        validated.averageExecutionTimeMs,
        validated.artifactsProduced,
        JSON.stringify(validated.artifactsByType),
        validated.errorCount,
        validated.lastErrorAt,
        validated.lastErrorMessage,
        validated.feedbackCount,
        validated.userCorrectionCount,
        validated.postApprovalFailureCount,
        validated.averageRating,
        validated.successRate,
        validated.approvalRate,
        validated.correctionRate,
        validated.postApprovalFailureRate,
        validated.updatedAt
      ]
    );
  }

  private async saveAgentWithClient(client: PoolClient, agent: AgentDefinition): Promise<void> {
    const validated = AgentDefinitionSchema.parse(agent);
    await client.query(
      `
        insert into agent_definitions (
          id, user_id, name, display_name, description, icon, category, tags, system_prompt, prompt_variables,
          artifact_type, behavior_config, allowed_capabilities, blocked_capabilities, max_risk_class,
          integration_permissions, memory_permissions, actor_context, is_built_in, parent_agent_id, version, status, created_at, updated_at
        )
        values (
          $1, $2, $3, $4, $5, $6, $7, $8::jsonb, $9, $10::jsonb,
          $11, $12::jsonb, $13::jsonb, $14::jsonb, $15,
          $16::jsonb, $17::jsonb, $18::jsonb, $19, $20, $21, $22, $23, $24
        )
        on conflict (id) do update
        set user_id = excluded.user_id,
            name = excluded.name,
            display_name = excluded.display_name,
            description = excluded.description,
            icon = excluded.icon,
            category = excluded.category,
            tags = excluded.tags,
            system_prompt = excluded.system_prompt,
            prompt_variables = excluded.prompt_variables,
            artifact_type = excluded.artifact_type,
            behavior_config = excluded.behavior_config,
            allowed_capabilities = excluded.allowed_capabilities,
            blocked_capabilities = excluded.blocked_capabilities,
            max_risk_class = excluded.max_risk_class,
            integration_permissions = excluded.integration_permissions,
            memory_permissions = excluded.memory_permissions,
            actor_context = excluded.actor_context,
            is_built_in = excluded.is_built_in,
            parent_agent_id = excluded.parent_agent_id,
            version = excluded.version,
            status = excluded.status,
            updated_at = excluded.updated_at
      `,
      [
        validated.id,
        validated.userId,
        validated.name,
        validated.displayName,
        validated.description,
        validated.icon,
        validated.category,
        JSON.stringify(validated.tags),
        validated.systemPrompt,
        JSON.stringify(validated.promptVariables),
        validated.artifactType,
        JSON.stringify(validated.behaviorConfig),
        JSON.stringify(validated.allowedCapabilities),
        JSON.stringify(validated.blockedCapabilities),
        validated.maxRiskClass,
        JSON.stringify(validated.integrationPermissions),
        JSON.stringify(validated.memoryPermissions),
        JSON.stringify(validated.actorContext),
        validated.isBuiltIn,
        validated.parentAgentId,
        validated.version,
        validated.status,
        validated.createdAt,
        validated.updatedAt
      ]
    );
  }

  private async saveOperatorProductWithClient(client: PoolClient, product: OperatorProduct): Promise<void> {
    const validated = OperatorProductSchema.parse(product);
    await client.query(
      `
        insert into operator_products (
          id, user_id, slug, name, tagline, description, icon, recommended_agent_ids, recommended_template_ids,
          recommended_integrations, kpis, onboarding_steps, is_built_in, status, created_at, updated_at
        )
        values (
          $1, $2, $3, $4, $5, $6, $7, $8::jsonb, $9::jsonb,
          $10::jsonb, $11::jsonb, $12::jsonb, $13, $14, $15, $16
        )
        on conflict (id) do update
        set user_id = excluded.user_id,
            slug = excluded.slug,
            name = excluded.name,
            tagline = excluded.tagline,
            description = excluded.description,
            icon = excluded.icon,
            recommended_agent_ids = excluded.recommended_agent_ids,
            recommended_template_ids = excluded.recommended_template_ids,
            recommended_integrations = excluded.recommended_integrations,
            kpis = excluded.kpis,
            onboarding_steps = excluded.onboarding_steps,
            is_built_in = excluded.is_built_in,
            status = excluded.status,
            updated_at = excluded.updated_at
      `,
      [
        validated.id,
        validated.userId,
        validated.slug,
        validated.name,
        validated.tagline,
        validated.description,
        validated.icon,
        JSON.stringify(validated.recommendedAgentIds),
        JSON.stringify(validated.recommendedTemplateIds),
        JSON.stringify(validated.recommendedIntegrations),
        JSON.stringify(validated.kpis),
        JSON.stringify(validated.onboardingSteps),
        validated.isBuiltIn,
        validated.status,
        validated.createdAt,
        validated.updatedAt
      ]
    );
  }

  private async saveOperatorProductSelectionWithClient(
    client: PoolClient,
    selection: OperatorProductSelection
  ): Promise<void> {
    const validated = OperatorProductSelectionSchema.parse(selection);
    await client.query(
      `
        insert into operator_product_selections (
          user_id, operator_product_id, actor_context, selected_at, updated_at
        )
        values ($1, $2, $3::jsonb, $4, $5)
        on conflict (user_id) do update
        set operator_product_id = excluded.operator_product_id,
            actor_context = excluded.actor_context,
            selected_at = excluded.selected_at,
            updated_at = excluded.updated_at
      `,
      [
        validated.userId,
        validated.operatorProductId,
        JSON.stringify(validated.actorContext),
        validated.selectedAt,
        validated.updatedAt
      ]
    );
  }

  private async saveBriefingPreferencesWithClient(client: PoolClient, preferences: BriefingPreferences): Promise<void> {
    const validated = BriefingPreferencesSchema.parse(preferences);
    await client.query(
      `
        insert into briefing_preferences (
          user_id, timezone, focus, schedules, actor_context, created_at, updated_at
        )
        values ($1, $2, $3, $4::jsonb, $5::jsonb, $6, $7)
        on conflict (user_id) do update
        set timezone = excluded.timezone,
            focus = excluded.focus,
            schedules = excluded.schedules,
            actor_context = excluded.actor_context,
            updated_at = excluded.updated_at
      `,
      [
        validated.userId,
        validated.timezone,
        validated.focus,
        JSON.stringify(validated.schedules),
        JSON.stringify(validated.actorContext),
        validated.createdAt,
        validated.updatedAt
      ]
    );
  }

  private async saveTemplateWithClient(client: PoolClient, template: GoalTemplate): Promise<void> {
    const validated = GoalTemplateSchema.parse(template);
    await client.query(
      `
        insert into goal_templates (
          id, user_id, name, description, request, parameters, schedule, actor_context, created_at, updated_at
        )
        values ($1, $2, $3, $4, $5, $6::jsonb, $7::jsonb, $8::jsonb, $9, $10)
        on conflict (id) do update
        set user_id = excluded.user_id,
            name = excluded.name,
            description = excluded.description,
            request = excluded.request,
            parameters = excluded.parameters,
            schedule = excluded.schedule,
            actor_context = excluded.actor_context,
            updated_at = excluded.updated_at
      `,
      [
        validated.id,
        validated.userId,
        validated.name,
        validated.description,
        validated.request,
        JSON.stringify(validated.parameters),
        JSON.stringify(validated.schedule),
        JSON.stringify(validated.actorContext),
        validated.createdAt,
        validated.updatedAt
      ]
    );
  }

  private async saveWorkflowTemplateWithClient(client: PoolClient, template: WorkflowCanvasTemplate): Promise<void> {
    const validated = WorkflowCanvasTemplateSchema.parse(template);
    await client.query(
      `
        insert into workflow_templates (
          id, user_id, name, description, nodes, edges, triggers, actor_context, created_at, updated_at
        )
        values ($1, $2, $3, $4, $5::jsonb, $6::jsonb, $7::jsonb, $8::jsonb, $9, $10)
        on conflict (id) do update
        set user_id = excluded.user_id,
            name = excluded.name,
            description = excluded.description,
            nodes = excluded.nodes,
            edges = excluded.edges,
            triggers = excluded.triggers,
            actor_context = excluded.actor_context,
            updated_at = excluded.updated_at
      `,
      [
        validated.id,
        validated.userId,
        validated.name,
        validated.description,
        JSON.stringify(validated.nodes),
        JSON.stringify(validated.edges),
        JSON.stringify(validated.triggers),
        JSON.stringify(validated.actorContext),
        validated.createdAt,
        validated.updatedAt
      ]
    );
  }

  private async saveAutopilotSettingsWithClient(client: PoolClient, settings: AutopilotSettings): Promise<void> {
    const validated = AutopilotSettingsSchema.parse(settings);
    await client.query(
      `
        insert into autopilot_settings (
          user_id, mode, debounce_minutes, actor_context, created_at, updated_at
        )
        values ($1, $2, $3, $4::jsonb, $5, $6)
        on conflict (user_id) do update
        set mode = excluded.mode,
            debounce_minutes = excluded.debounce_minutes,
            actor_context = excluded.actor_context,
            updated_at = excluded.updated_at
      `,
      [
        validated.userId,
        validated.mode,
        validated.debounceMinutes,
        JSON.stringify(validated.actorContext),
        validated.createdAt,
        validated.updatedAt
      ]
    );
  }

  private async saveAutopilotEventWithClient(client: PoolClient, event: AutopilotEvent): Promise<void> {
    const validated = AutopilotEventSchema.parse(event);
    await client.query(
      `
        insert into autopilot_events (
          id, user_id, kind, source_id, idempotency_key, mode, summary, status, details, actor_context, created_at, processed_at, result_goal_id, error
        )
        values ($1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb, $10::jsonb, $11, $12, $13, $14)
        on conflict (id) do update
        set user_id = excluded.user_id,
            kind = excluded.kind,
            source_id = excluded.source_id,
            idempotency_key = excluded.idempotency_key,
            mode = excluded.mode,
            summary = excluded.summary,
            status = excluded.status,
            details = excluded.details,
            actor_context = excluded.actor_context,
            processed_at = excluded.processed_at,
            result_goal_id = excluded.result_goal_id,
            error = excluded.error
      `,
      [
        validated.id,
        validated.userId,
        validated.kind,
        validated.sourceId,
        validated.idempotencyKey,
        validated.mode,
        validated.summary,
        validated.status,
        JSON.stringify(validated.details),
        JSON.stringify(validated.actorContext),
        validated.createdAt,
        validated.processedAt,
        validated.resultGoalId,
        validated.error
      ]
    );
  }

  private async saveJobWithClient(client: PoolClient, job: JobRecord): Promise<void> {
    const validated = JobRecordSchema.parse(job);
    await client.query(
      `
        insert into jobs (
          id, user_id, kind, status, idempotency_key, payload, actor_context, max_attempts, attempt_count,
          claimed_by, last_attempt_at, claimed_at, lease_expires_at, available_at, completed_at, dead_lettered_at,
          last_error, created_at, updated_at
        )
        values (
          $1, $2, $3, $4, $5, $6::jsonb, $7::jsonb, $8, $9,
          $10, $11, $12, $13, $14, $15, $16,
          $17, $18, $19
        )
        on conflict (id) do update
        set user_id = excluded.user_id,
            kind = excluded.kind,
            status = excluded.status,
            idempotency_key = excluded.idempotency_key,
            payload = excluded.payload,
            actor_context = excluded.actor_context,
            max_attempts = excluded.max_attempts,
            attempt_count = excluded.attempt_count,
            claimed_by = excluded.claimed_by,
            last_attempt_at = excluded.last_attempt_at,
            claimed_at = excluded.claimed_at,
            lease_expires_at = excluded.lease_expires_at,
            available_at = excluded.available_at,
            completed_at = excluded.completed_at,
            dead_lettered_at = excluded.dead_lettered_at,
            last_error = excluded.last_error,
            updated_at = excluded.updated_at
      `,
      [
        validated.id,
        validated.userId,
        validated.kind,
        validated.status,
        validated.idempotencyKey,
        JSON.stringify(validated.payload),
        JSON.stringify(validated.actorContext),
        validated.maxAttempts,
        validated.attemptCount,
        validated.claimedBy,
        validated.lastAttemptAt,
        validated.claimedAt,
        validated.leaseExpiresAt,
        validated.availableAt,
        validated.completedAt,
        validated.deadLetteredAt,
        validated.lastError,
        validated.createdAt,
        validated.updatedAt
      ]
    );
  }

  private mapTemplateRow(row: Record<string, unknown>): GoalTemplate {
    return GoalTemplateSchema.parse({
      id: row.id,
      userId: row.user_id,
      name: row.name,
      description: row.description,
      request: row.request,
      parameters: row.parameters ?? {},
      schedule: row.schedule ?? {},
      actorContext: row.actor_context ? ActorContextSchema.parse(row.actor_context) : null,
      createdAt: new Date(row.created_at as string | number | Date).toISOString(),
      updatedAt: new Date(row.updated_at as string | number | Date).toISOString()
    });
  }

  private mapWorkflowTemplateRow(row: Record<string, unknown>): WorkflowCanvasTemplate {
    return WorkflowCanvasTemplateSchema.parse({
      id: row.id,
      userId: row.user_id,
      name: row.name,
      description: row.description,
      nodes: row.nodes ?? [],
      edges: row.edges ?? [],
      triggers: row.triggers ?? [],
      actorContext: row.actor_context ? ActorContextSchema.parse(row.actor_context) : null,
      createdAt: new Date(row.created_at as string | number | Date).toISOString(),
      updatedAt: new Date(row.updated_at as string | number | Date).toISOString()
    });
  }

  private mapAutopilotEventRow(row: Record<string, unknown>): AutopilotEvent {
    return AutopilotEventSchema.parse({
      id: row.id,
      userId: row.user_id,
      kind: row.kind,
      sourceId: row.source_id,
      idempotencyKey: typeof row.idempotency_key === "string" ? row.idempotency_key : null,
      mode: row.mode,
      summary: row.summary,
      status: row.status,
      details: row.details ?? {},
      actorContext: row.actor_context ? ActorContextSchema.parse(row.actor_context) : null,
      createdAt: new Date(row.created_at as string | number | Date).toISOString(),
      processedAt: row.processed_at ? new Date(row.processed_at as string | number | Date).toISOString() : null,
      resultGoalId: typeof row.result_goal_id === "string" ? row.result_goal_id : null,
      error: typeof row.error === "string" ? row.error : null
    });
  }

  private mapGoalRow(row: Record<string, unknown>): GoalBundle["goal"] {
    return GoalSchema.parse({
      id: row.id,
      userId: row.user_id,
      workspaceId: typeof row.workspace_id === "string" ? row.workspace_id : null,
      workflowId: row.workflow_id,
      title: row.title,
      request: row.request,
      intent: row.intent,
      status: row.status,
      confidence: Number(row.confidence),
      explanation: row.explanation,
      createdAt: new Date(row.created_at as string | number | Date).toISOString(),
      updatedAt: new Date(row.updated_at as string | number | Date).toISOString()
    });
  }

  private mapWorkflowStateRow(row: Record<string, unknown>): GoalBundle["workflow"] {
    return WorkflowStateSchema.parse({
      id: row.id,
      goalId: row.goal_id,
      workspaceId: typeof row.workspace_id === "string" ? row.workspace_id : null,
      status: row.status,
      currentStep: row.current_step,
      checkpoint: typeof row.checkpoint === "string" ? row.checkpoint : null,
      createdAt: new Date(row.created_at as string | number | Date).toISOString(),
      updatedAt: new Date(row.updated_at as string | number | Date).toISOString()
    });
  }

  private mapTaskRow(row: Record<string, unknown>): Task {
    return TaskSchema.parse({
      id: row.id,
      goalId: row.goal_id,
      workflowId: row.workflow_id,
      title: row.title,
      summary: row.summary,
      assignedAgent: row.assigned_agent,
      state: row.state,
      riskClass: row.risk_class,
      requiresApproval: Boolean(row.requires_approval),
      dependsOn: row.depends_on ?? [],
      toolCapabilities: row.tool_capabilities ?? [],
      artifactIds: row.artifact_ids ?? [],
      createdAt: new Date(row.created_at as string | number | Date).toISOString(),
      updatedAt: new Date(row.updated_at as string | number | Date).toISOString()
    });
  }

  private mapArtifactRow(row: Record<string, unknown>): Artifact {
    return ArtifactSchema.parse({
      id: row.id,
      goalId: row.goal_id,
      taskId: typeof row.task_id === "string" ? row.task_id : undefined,
      artifactType: row.artifact_type,
      title: row.title,
      content: row.content,
      metadata: row.metadata ?? {},
      createdAt: new Date(row.created_at as string | number | Date).toISOString()
    });
  }

  private mapApprovalRow(row: Record<string, unknown>): ApprovalRequest {
    const title = typeof row.title === "string" ? row.title : "";
    const requestedAction = typeof row.requested_action === "string" ? row.requested_action : "";
    const parsedActionIntent = ActionIntentSchema.safeParse(row.action_intent);
    const actionIntent = parsedActionIntent.success ? parsedActionIntent.data : null;
    const parsedPreview = ApprovalPreviewSchema.safeParse(row.preview);
    const preview = parsedPreview.success ? parsedPreview.data : null;
    const parsedRiskClass = RiskClassSchema.safeParse(row.risk_class);
    const riskClass = parsedRiskClass.success ? parsedRiskClass.data : "R2";

    return ApprovalRequestSchema.parse({
      id: row.id,
      goalId: row.goal_id,
      taskId: row.task_id,
      title,
      rationale: row.rationale,
      riskClass,
      decision: row.decision,
      requestedAction,
      actionIntent:
        actionIntent ??
        buildFallbackApprovalActionIntent({
          title,
          requestedAction,
          preview
        }),
      preview: preview ?? buildFallbackApprovalPreview({
        title,
        requestedAction,
        riskClass
      }),
      decisionScope: normalizeApprovalDecisionScope(row.decision_scope),
      decisionRationale: typeof row.decision_rationale === "string" ? row.decision_rationale : null,
      history: normalizeApprovalHistory(row.history),
      createdAt: new Date(row.created_at as string | number | Date).toISOString(),
      expiryAt: new Date(row.expiry_at as string | number | Date).toISOString(),
      respondedAt: row.responded_at ? new Date(row.responded_at as string | number | Date).toISOString() : null
    });
  }

  private mapWatcherRow(row: Record<string, unknown>): Watcher {
    return WatcherSchema.parse({
      id: row.id,
      goalId: row.goal_id,
      targetEntity: row.target_entity,
      condition: row.condition,
      frequency: row.frequency,
      triggerAction: row.trigger_action,
      sourceSystems: row.source_systems ?? [],
      status: row.status,
      expiryAt: row.expiry_at ? new Date(row.expiry_at as string | number | Date).toISOString() : null,
      actorContext: row.actor_context ? ActorContextSchema.parse(row.actor_context) : null,
      createdAt: new Date(row.created_at as string | number | Date).toISOString(),
      updatedAt: new Date(row.updated_at as string | number | Date).toISOString()
    });
  }

  private mapActionLogRow(row: Record<string, unknown>): ActionLog {
    return ActionLogSchema.parse({
      id: row.id,
      goalId: row.goal_id,
      taskId: typeof row.task_id === "string" ? row.task_id : undefined,
      workflowId: typeof row.workflow_id === "string" ? row.workflow_id : undefined,
      actor: row.actor,
      kind: row.kind,
      message: row.message,
      details: row.details ?? {},
      createdAt: new Date(row.created_at as string | number | Date).toISOString()
    });
  }

  private mapJobRow(row: Record<string, unknown>): JobRecord {
    return JobRecordSchema.parse({
      id: row.id,
      userId: row.user_id,
      kind: row.kind,
      status: row.status,
      idempotencyKey: typeof row.idempotency_key === "string" ? row.idempotency_key : null,
      payload: row.payload,
      actorContext: row.actor_context ? ActorContextSchema.parse(row.actor_context) : null,
      maxAttempts: row.max_attempts,
      attemptCount: row.attempt_count,
      claimedBy: typeof row.claimed_by === "string" ? row.claimed_by : null,
      lastAttemptAt: row.last_attempt_at ? new Date(row.last_attempt_at as string | number | Date).toISOString() : null,
      claimedAt: row.claimed_at ? new Date(row.claimed_at as string | number | Date).toISOString() : null,
      leaseExpiresAt: row.lease_expires_at ? new Date(row.lease_expires_at as string | number | Date).toISOString() : null,
      availableAt: new Date(row.available_at as string | number | Date).toISOString(),
      completedAt: row.completed_at ? new Date(row.completed_at as string | number | Date).toISOString() : null,
      deadLetteredAt: row.dead_lettered_at ? new Date(row.dead_lettered_at as string | number | Date).toISOString() : null,
      lastError: typeof row.last_error === "string" ? row.last_error : null,
      createdAt: new Date(row.created_at as string | number | Date).toISOString(),
      updatedAt: new Date(row.updated_at as string | number | Date).toISOString()
    });
  }

  private mapEvidenceRecordRow(row: Record<string, unknown>): EvidenceRecord {
    return EvidenceRecordSchema.parse({
      id: row.id,
      userId: row.user_id,
      goalId: row.goal_id,
      taskId: row.task_id,
      approvalId: row.approval_id,
      sourceKind: row.source_kind,
      sourceId: row.source_id,
      sourceSummary: row.source_summary,
      riskClass: row.risk_class,
      requestedAction: row.requested_action,
      requestRationale: row.request_rationale,
      requiresApproval: Boolean(row.requires_approval),
      decision: row.decision,
      decisionScope: row.decision_scope,
      decisionRationale: typeof row.decision_rationale === "string" ? row.decision_rationale : null,
      respondedAt: new Date(row.responded_at as string | number | Date).toISOString(),
      resultingTaskState: row.resulting_task_state,
      resultingGoalStatus: row.resulting_goal_status,
      actionLogIds: row.action_log_ids ?? [],
      artifactIds: row.artifact_ids ?? [],
      memoryIds: row.memory_ids ?? [],
      createdAt: new Date(row.created_at as string | number | Date).toISOString(),
      updatedAt: new Date(row.updated_at as string | number | Date).toISOString()
    });
  }

  private mapWorkspaceRow(row: Record<string, unknown>): Workspace {
    return WorkspaceSchema.parse({
      id: row.id,
      ownerUserId: row.owner_user_id,
      slug: row.slug,
      name: row.name,
      description: typeof row.description === "string" ? row.description : "",
      isPersonal: Boolean(row.is_personal),
      createdAt: new Date(row.created_at as string | number | Date).toISOString(),
      updatedAt: new Date(row.updated_at as string | number | Date).toISOString()
    });
  }

  private mapWorkspaceMemberRow(row: Record<string, unknown>): WorkspaceMember {
    return WorkspaceMemberSchema.parse({
      id: row.id,
      workspaceId: row.workspace_id,
      userId: row.user_id,
      role: row.role,
      joinedAt: new Date(row.joined_at as string | number | Date).toISOString(),
      updatedAt: new Date(row.updated_at as string | number | Date).toISOString()
    });
  }

  private mapWorkspaceSelectionRow(row: Record<string, unknown>): WorkspaceSelection {
    return WorkspaceSelectionSchema.parse({
      userId: row.user_id,
      workspaceId: row.workspace_id,
      actorContext: row.actor_context ? ActorContextSchema.parse(row.actor_context) : null,
      selectedAt: new Date(row.selected_at as string | number | Date).toISOString(),
      updatedAt: new Date(row.updated_at as string | number | Date).toISOString()
    });
  }

  private mapWorkspaceGovernanceRow(row: Record<string, unknown>): WorkspaceGovernance {
    return WorkspaceGovernanceSchema.parse({
      workspaceId: row.workspace_id,
      approvalMode: row.approval_mode,
      requireAuditExports: Boolean(row.require_audit_exports),
      maxAutoRunRiskClass: row.max_auto_run_risk_class,
      externalSendRequiresApproval: Boolean(row.external_send_requires_approval),
      calendarWriteRequiresApproval: Boolean(row.calendar_write_requires_approval),
      retentionDays: Number(row.retention_days),
      updatedBy: row.updated_by,
      createdAt: new Date(row.created_at as string | number | Date).toISOString(),
      updatedAt: new Date(row.updated_at as string | number | Date).toISOString()
    });
  }

  private async saveWorkspaceWithClient(client: PoolClient, workspace: Workspace): Promise<void> {
    const validated = WorkspaceSchema.parse(workspace);
    await client.query(
      `
        insert into workspaces (
          id, owner_user_id, slug, name, description, is_personal, created_at, updated_at
        )
        values ($1, $2, $3, $4, $5, $6, $7, $8)
        on conflict (id) do update
        set owner_user_id = excluded.owner_user_id,
            slug = excluded.slug,
            name = excluded.name,
            description = excluded.description,
            is_personal = excluded.is_personal,
            updated_at = excluded.updated_at
      `,
      [
        validated.id,
        validated.ownerUserId,
        validated.slug,
        validated.name,
        validated.description,
        validated.isPersonal,
        validated.createdAt,
        validated.updatedAt
      ]
    );
  }

  private async saveWorkspaceMemberWithClient(client: PoolClient, member: WorkspaceMember): Promise<void> {
    const validated = WorkspaceMemberSchema.parse(member);
    await client.query(
      `
        insert into workspace_members (
          id, workspace_id, user_id, role, joined_at, updated_at
        )
        values ($1, $2, $3, $4, $5, $6)
        on conflict (id) do update
        set workspace_id = excluded.workspace_id,
            user_id = excluded.user_id,
            role = excluded.role,
            joined_at = excluded.joined_at,
            updated_at = excluded.updated_at
      `,
      [
        validated.id,
        validated.workspaceId,
        validated.userId,
        validated.role,
        validated.joinedAt,
        validated.updatedAt
      ]
    );
  }

  private async saveWorkspaceSelectionWithClient(client: PoolClient, selection: WorkspaceSelection): Promise<void> {
    const validated = WorkspaceSelectionSchema.parse(selection);
    await client.query(
      `
        insert into workspace_selections (
          user_id, workspace_id, actor_context, selected_at, updated_at
        )
        values ($1, $2, $3, $4, $5)
        on conflict (user_id) do update
        set workspace_id = excluded.workspace_id,
            actor_context = excluded.actor_context,
            selected_at = excluded.selected_at,
            updated_at = excluded.updated_at
      `,
      [
        validated.userId,
        validated.workspaceId,
        JSON.stringify(validated.actorContext),
        validated.selectedAt,
        validated.updatedAt
      ]
    );
  }

  private async saveWorkspaceGovernanceWithClient(client: PoolClient, governance: WorkspaceGovernance): Promise<void> {
    const validated = WorkspaceGovernanceSchema.parse(governance);
    await client.query(
      `
        insert into workspace_governance (
          workspace_id, approval_mode, require_audit_exports, max_auto_run_risk_class, external_send_requires_approval,
          calendar_write_requires_approval, retention_days, updated_by, created_at, updated_at
        )
        values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
        on conflict (workspace_id) do update
        set approval_mode = excluded.approval_mode,
            require_audit_exports = excluded.require_audit_exports,
            max_auto_run_risk_class = excluded.max_auto_run_risk_class,
            external_send_requires_approval = excluded.external_send_requires_approval,
            calendar_write_requires_approval = excluded.calendar_write_requires_approval,
            retention_days = excluded.retention_days,
            updated_by = excluded.updated_by,
            updated_at = excluded.updated_at
      `,
      [
        validated.workspaceId,
        validated.approvalMode,
        validated.requireAuditExports,
        validated.maxAutoRunRiskClass,
        validated.externalSendRequiresApproval,
        validated.calendarWriteRequiresApproval,
        validated.retentionDays,
        validated.updatedBy,
        validated.createdAt,
        validated.updatedAt
      ]
    );
  }

  private mapGoalShareRow(row: Record<string, unknown>): GoalShareRecord {
    return GoalShareRecordSchema.parse({
      id: row.id,
      goalId: row.goal_id,
      userId: row.user_id,
      workspaceId: typeof row.workspace_id === "string" ? row.workspace_id : null,
      tokenFingerprint: row.token_fingerprint,
      status: row.status,
      actorContext: row.actor_context ? ActorContextSchema.parse(row.actor_context) : null,
      expiresAt: new Date(row.expires_at as string | number | Date).toISOString(),
      lastViewedAt: row.last_viewed_at ? new Date(row.last_viewed_at as string | number | Date).toISOString() : null,
      revokedAt: row.revoked_at ? new Date(row.revoked_at as string | number | Date).toISOString() : null,
      createdAt: new Date(row.created_at as string | number | Date).toISOString(),
      updatedAt: new Date(row.updated_at as string | number | Date).toISOString()
    });
  }

  private mapPrivacyOperationRow(row: Record<string, unknown>): PrivacyOperation {
    return PrivacyOperationSchema.parse({
      id: row.id,
      workspaceId: row.workspace_id,
      userId: row.user_id,
      kind: row.kind,
      status: row.status,
      requestedBy: row.requested_by,
      actorContext: row.actor_context ? ActorContextSchema.parse(row.actor_context) : null,
      jobId: typeof row.job_id === "string" ? row.job_id : null,
      details: (row.details as Record<string, unknown> | null) ?? {},
      result: (row.result as Record<string, unknown> | null) ?? {},
      startedAt: row.started_at ? new Date(row.started_at as string | number | Date).toISOString() : null,
      completedAt: row.completed_at ? new Date(row.completed_at as string | number | Date).toISOString() : null,
      error: typeof row.error === "string" ? row.error : null,
      createdAt: new Date(row.created_at as string | number | Date).toISOString(),
      updatedAt: new Date(row.updated_at as string | number | Date).toISOString()
    });
  }

  private async saveGoalShareWithClient(client: PoolClient, share: GoalShareRecord): Promise<void> {
    const validated = GoalShareRecordSchema.parse({
      ...share,
      tokenFingerprint: goalShareFingerprintStoreKey(share)
    });
    await client.query(
      `
        insert into goal_shares (
          id, goal_id, user_id, workspace_id, token_fingerprint, status, actor_context,
          expires_at, last_viewed_at, revoked_at, created_at, updated_at
        )
        values ($1, $2, $3, $4, $5, $6, $7::jsonb, $8, $9, $10, $11, $12)
        on conflict (id) do update
        set goal_id = excluded.goal_id,
            user_id = excluded.user_id,
            workspace_id = excluded.workspace_id,
            token_fingerprint = excluded.token_fingerprint,
            status = excluded.status,
            actor_context = excluded.actor_context,
            expires_at = excluded.expires_at,
            last_viewed_at = excluded.last_viewed_at,
            revoked_at = excluded.revoked_at,
            updated_at = excluded.updated_at
      `,
      [
        validated.id,
        validated.goalId,
        validated.userId,
        validated.workspaceId,
        validated.tokenFingerprint,
        validated.status,
        JSON.stringify(validated.actorContext),
        validated.expiresAt,
        validated.lastViewedAt,
        validated.revokedAt,
        validated.createdAt,
        validated.updatedAt
      ]
    );
  }

  private async savePrivacyOperationWithClient(client: PoolClient, operation: PrivacyOperation): Promise<void> {
    const validated = PrivacyOperationSchema.parse(operation);
    await client.query(
      `
        insert into privacy_operations (
          id, workspace_id, user_id, kind, status, requested_by, actor_context, job_id, details, result,
          started_at, completed_at, error, created_at, updated_at
        )
        values (
          $1, $2, $3, $4, $5, $6, $7::jsonb, $8, $9::jsonb, $10::jsonb,
          $11, $12, $13, $14, $15
        )
        on conflict (id) do update
        set workspace_id = excluded.workspace_id,
            user_id = excluded.user_id,
            kind = excluded.kind,
            status = excluded.status,
            requested_by = excluded.requested_by,
            actor_context = excluded.actor_context,
            job_id = excluded.job_id,
            details = excluded.details,
            result = excluded.result,
            started_at = excluded.started_at,
            completed_at = excluded.completed_at,
            error = excluded.error,
            updated_at = excluded.updated_at
      `,
      [
        validated.id,
        validated.workspaceId,
        validated.userId,
        validated.kind,
        validated.status,
        validated.requestedBy,
        JSON.stringify(validated.actorContext),
        validated.jobId,
        JSON.stringify(validated.details),
        JSON.stringify(validated.result),
        validated.startedAt,
        validated.completedAt,
        validated.error,
        validated.createdAt,
        validated.updatedAt
      ]
    );
  }

  private async listGoalSharesWithClient(
    client: Pick<PoolClient, "query">,
    filters?: GoalShareListFilters
  ): Promise<GoalShareRecord[]> {
    const normalized = normalizeGoalShareFilters(filters);
    const values: unknown[] = [normalized.userId ?? SYSTEM_USER_ID];
    const predicates = [
      `(
        (g.workspace_id is null and g.user_id = $1)
        or wm.user_id is not null
      )`
    ];

    if (normalized.goalId) {
      values.push(normalized.goalId);
      predicates.push(`gs.goal_id = $${values.length}`);
    }

    if (normalized.workspaceId !== undefined) {
      if (normalized.workspaceId === null) {
        predicates.push("gs.workspace_id is null");
      } else {
        values.push(normalized.workspaceId);
        predicates.push(`gs.workspace_id = $${values.length}`);
      }
    }

    if (normalized.statuses?.length) {
      values.push(normalized.statuses);
      predicates.push(`gs.status = any($${values.length}::text[])`);
    }

    const result = await client.query(
      `
        select gs.*
        from goal_shares gs
        join goals g on g.id = gs.goal_id
        left join workspace_members wm on wm.workspace_id = g.workspace_id and wm.user_id = $1
        where ${predicates.join(" and ")}
        order by gs.updated_at desc
      `,
      values
    );

    return result.rows.map((row) => this.mapGoalShareRow(row));
  }

  private async getGoalShareWithClient(
    client: Pick<PoolClient, "query">,
    shareId: string,
    userId = SYSTEM_USER_ID
  ): Promise<GoalShareRecord | null> {
    const result = await client.query(
      `
        select gs.*
        from goal_shares gs
        join goals g on g.id = gs.goal_id
        left join workspace_members wm on wm.workspace_id = g.workspace_id and wm.user_id = $2
        where gs.id = $1
          and (
            (g.workspace_id is null and g.user_id = $2)
            or wm.user_id is not null
          )
        limit 1
      `,
      [shareId, userId]
    );

    return result.rows[0] ? this.mapGoalShareRow(result.rows[0]) : null;
  }

  private async getGoalShareByTokenFingerprintWithClient(
    client: Pick<PoolClient, "query">,
    tokenFingerprint: string
  ): Promise<GoalShareRecord | null> {
    const normalizedFingerprint = goalShareFingerprintStoreKey({
      tokenFingerprint: tokenFingerprint.trim()
    });
    const result = await client.query(
      `
        select *
        from goal_shares
        where token_fingerprint = $1
        limit 1
      `,
      [normalizedFingerprint]
    );

    return result.rows[0] ? this.mapGoalShareRow(result.rows[0]) : null;
  }

  private async listPrivacyOperationsWithClient(
    client: Pick<PoolClient, "query">,
    filters?: PrivacyOperationListFilters
  ): Promise<PrivacyOperation[]> {
    const normalized = normalizePrivacyOperationFilters(filters);
    const values: unknown[] = [normalized.userId ?? SYSTEM_USER_ID];
    const predicates = ["wm.user_id is not null"];

    if (normalized.workspaceId) {
      values.push(normalized.workspaceId);
      predicates.push(`po.workspace_id = $${values.length}`);
    }

    if (normalized.kinds?.length) {
      values.push(normalized.kinds);
      predicates.push(`po.kind = any($${values.length}::text[])`);
    }

    if (normalized.statuses?.length) {
      values.push(normalized.statuses);
      predicates.push(`po.status = any($${values.length}::text[])`);
    }

    const result = await client.query(
      `
        select po.*
        from privacy_operations po
        join workspace_members wm on wm.workspace_id = po.workspace_id and wm.user_id = $1
        where ${predicates.join(" and ")}
        order by po.created_at desc
      `,
      values
    );

    return result.rows.map((row) => this.mapPrivacyOperationRow(row));
  }

  private async getPrivacyOperationWithClient(
    client: Pick<PoolClient, "query">,
    operationId: string,
    userId = SYSTEM_USER_ID
  ): Promise<PrivacyOperation | null> {
    const result = await client.query(
      `
        select po.*
        from privacy_operations po
        join workspace_members wm on wm.workspace_id = po.workspace_id and wm.user_id = $2
        where po.id = $1
        limit 1
      `,
      [operationId, userId]
    );

    return result.rows[0] ? this.mapPrivacyOperationRow(result.rows[0]) : null;
  }

  private async getWorkspaceByIdWithClient(
    client: Pick<PoolClient, "query">,
    workspaceId: string
  ): Promise<Workspace | null> {
    const result = await client.query("select * from workspaces where id = $1 limit 1", [workspaceId]);
    return Number(result.rowCount ?? 0) === 0 ? null : this.mapWorkspaceRow(result.rows[0]);
  }

  private async getWorkspaceMemberWithClient(
    client: Pick<PoolClient, "query">,
    workspaceId: string,
    userId: string
  ): Promise<WorkspaceMember | null> {
    const result = await client.query(
      `
        select *
        from workspace_members
        where workspace_id = $1 and user_id = $2
        limit 1
      `,
      [workspaceId, userId]
    );

    return Number(result.rowCount ?? 0) === 0 ? null : this.mapWorkspaceMemberRow(result.rows[0]);
  }

  private async assertWorkspaceMemberWithClient(
    client: Pick<PoolClient, "query">,
    workspaceId: string,
    userId: string
  ): Promise<WorkspaceMember> {
    const member = await this.getWorkspaceMemberWithClient(client, workspaceId, userId);

    if (!member) {
      throw new Error(`User ${userId} does not have access to workspace ${workspaceId}.`);
    }

    return member;
  }

  private async assertWorkspaceOwnerWithClient(
    client: Pick<PoolClient, "query">,
    workspaceId: string,
    userId: string
  ): Promise<WorkspaceMember> {
    const member = await this.assertWorkspaceMemberWithClient(client, workspaceId, userId);

    if (member.role !== "owner") {
      throw new Error(`User ${userId} cannot administer workspace ${workspaceId}.`);
    }

    return member;
  }

  private async listWorkspacesForUserWithClient(
    client: Pick<PoolClient, "query">,
    userId: string
  ): Promise<Workspace[]> {
    const result = await client.query(
      `
        select w.*
        from workspaces w
        join workspace_members wm on wm.workspace_id = w.id
        where wm.user_id = $1
        order by w.is_personal desc, w.name asc
      `,
      [userId]
    );

    return result.rows.map((row) => this.mapWorkspaceRow(row));
  }

  private async listWorkspaceMembersForWorkspaceWithClient(
    client: Pick<PoolClient, "query">,
    workspaceId: string
  ): Promise<WorkspaceMember[]> {
    const result = await client.query(
      `
        select *
        from workspace_members
        where workspace_id = $1
        order by joined_at asc
      `,
      [workspaceId]
    );

    return result.rows.map((row) => this.mapWorkspaceMemberRow(row));
  }

  private async getWorkspaceSelectionWithClient(
    client: Pick<PoolClient, "query">,
    userId: string
  ): Promise<WorkspaceSelection | null> {
    const result = await client.query(
      `
        select ws.*
        from workspace_selections ws
        join workspace_members wm on wm.workspace_id = ws.workspace_id and wm.user_id = ws.user_id
        where ws.user_id = $1
        limit 1
      `,
      [userId]
    );

    return Number(result.rowCount ?? 0) === 0 ? null : this.mapWorkspaceSelectionRow(result.rows[0]);
  }

  private async getWorkspaceGovernanceWithClient(
    client: Pick<PoolClient, "query">,
    workspaceId: string
  ): Promise<WorkspaceGovernance | null> {
    const result = await client.query(
      `
        select *
        from workspace_governance
        where workspace_id = $1
        limit 1
      `,
      [workspaceId]
    );

    return Number(result.rowCount ?? 0) === 0 ? null : this.mapWorkspaceGovernanceRow(result.rows[0]);
  }

  private async resolveActiveWorkspaceWithClient(
    client: Pick<PoolClient, "query">,
    userId: string
  ): Promise<{
    workspaces: Workspace[];
    activeWorkspace: Workspace | null;
    workspaceSelection: WorkspaceSelection | null;
  }> {
    const [workspaces, selection] = await Promise.all([
      this.listWorkspacesForUserWithClient(client, userId),
      this.getWorkspaceSelectionWithClient(client, userId)
    ]);
    const activeWorkspace =
      workspaces.find((workspace) => workspace.id === selection?.workspaceId) ??
      workspaces.find((workspace) => workspace.isPersonal) ??
      workspaces[0] ??
      null;

    if (!activeWorkspace) {
      return {
        workspaces,
        activeWorkspace: null,
        workspaceSelection: selection
      };
    }

    return {
      workspaces,
      activeWorkspace,
      workspaceSelection:
        selection && selection.workspaceId === activeWorkspace.id
          ? selection
          : WorkspaceSelectionSchema.parse({
              userId,
              workspaceId: activeWorkspace.id,
              selectedAt: selection?.selectedAt ?? activeWorkspace.updatedAt,
              updatedAt: selection?.updatedAt ?? activeWorkspace.updatedAt
            })
    };
  }

  private async mapGoalBundlesWithClient(
    client: Pick<PoolClient, "query">,
    goalIds: string[]
  ): Promise<GoalBundle[]> {
    const uniqueGoalIds = [...new Set(goalIds.filter((goalId) => goalId.trim().length > 0))];

    if (uniqueGoalIds.length === 0) {
      return [];
    }

    const goalResult = await client.query("select * from goals where id = any($1::text[])", [uniqueGoalIds]);
    const goals = goalResult.rows.map((row) => this.mapGoalRow(row));

    if (goals.length === 0) {
      return [];
    }

    const workflowIds = [...new Set(goals.map((goal) => goal.workflowId))];
    const [workflowResult, tasksResult, artifactsResult, approvalsResult, watchersResult, logsResult] = await Promise.all([
      client.query("select * from workflows where id = any($1::text[])", [workflowIds]),
      client.query(
        "select * from tasks where goal_id = any($1::text[]) order by goal_id asc, created_at asc, id asc",
        [uniqueGoalIds]
      ),
      client.query(
        "select * from artifacts where goal_id = any($1::text[]) order by goal_id asc, created_at asc, id asc",
        [uniqueGoalIds]
      ),
      client.query(
        "select * from approval_requests where goal_id = any($1::text[]) order by goal_id asc, created_at asc, id asc",
        [uniqueGoalIds]
      ),
      client.query(
        "select * from watchers where goal_id = any($1::text[]) order by goal_id asc, created_at asc, id asc",
        [uniqueGoalIds]
      ),
      client.query(
        "select * from action_logs where goal_id = any($1::text[]) order by goal_id asc, created_at asc, id asc",
        [uniqueGoalIds]
      )
    ]);

    const goalsById = new Map(goals.map((goal) => [goal.id, goal] as const));
    const workflowsById = new Map(
      workflowResult.rows.map((row) => {
        const workflow = this.mapWorkflowStateRow(row);
        return [workflow.id, workflow] as const;
      })
    );
    const tasksByGoalId = new Map<string, Task[]>();
    const artifactsByGoalId = new Map<string, Artifact[]>();
    const approvalsByGoalId = new Map<string, ApprovalRequest[]>();
    const watchersByGoalId = new Map<string, Watcher[]>();
    const logsByGoalId = new Map<string, ActionLog[]>();

    for (const row of tasksResult.rows) {
      const task = this.mapTaskRow(row);
      const existing = tasksByGoalId.get(task.goalId) ?? [];
      existing.push(task);
      tasksByGoalId.set(task.goalId, existing);
    }

    for (const row of artifactsResult.rows) {
      const artifact = this.mapArtifactRow(row);
      const existing = artifactsByGoalId.get(artifact.goalId) ?? [];
      existing.push(artifact);
      artifactsByGoalId.set(artifact.goalId, existing);
    }

    for (const row of approvalsResult.rows) {
      const approval = this.mapApprovalRow(row);
      const existing = approvalsByGoalId.get(approval.goalId) ?? [];
      existing.push(approval);
      approvalsByGoalId.set(approval.goalId, existing);
    }

    for (const row of watchersResult.rows) {
      const watcher = this.mapWatcherRow(row);
      const existing = watchersByGoalId.get(watcher.goalId) ?? [];
      existing.push(watcher);
      watchersByGoalId.set(watcher.goalId, existing);
    }

    for (const row of logsResult.rows) {
      const log = this.mapActionLogRow(row);
      const existing = logsByGoalId.get(log.goalId) ?? [];
      existing.push(log);
      logsByGoalId.set(log.goalId, existing);
    }

    return uniqueGoalIds.flatMap((goalId) => {
      const goal = goalsById.get(goalId);

      if (!goal) {
        return [];
      }

      const workflow = workflowsById.get(goal.workflowId);

      if (!workflow) {
        throw new Error(`Workflow ${goal.workflowId} is missing for goal ${goalId}.`);
      }

      return [
        GoalBundleSchema.parse({
          goal,
          workflow,
          tasks: tasksByGoalId.get(goalId) ?? [],
          artifacts: artifactsByGoalId.get(goalId) ?? [],
          approvals: approvalsByGoalId.get(goalId) ?? [],
          watchers: watchersByGoalId.get(goalId) ?? [],
          actionLogs: logsByGoalId.get(goalId) ?? []
        })
      ];
    });
  }

  private async mapGoalBundleWithClient(client: Pick<PoolClient, "query">, goalId: string): Promise<GoalBundle | null> {
    const [bundle] = await this.mapGoalBundlesWithClient(client, [goalId]);
    return bundle ?? null;
  }

  private async listEvidenceRecordsForGoalIdsWithClient(
    client: Pick<PoolClient, "query">,
    params: {
      userId: string;
      goalIds: string[];
    }
  ): Promise<EvidenceRecord[]> {
    const uniqueGoalIds = [...new Set(params.goalIds.filter((goalId) => goalId.trim().length > 0))];

    if (uniqueGoalIds.length === 0) {
      return [];
    }

    const result = await client.query(
      `
        select er.*
        from evidence_records er
        join goals g on g.id = er.goal_id
        left join workspace_members wm on wm.workspace_id = g.workspace_id and wm.user_id = $1
        where er.user_id = $1
          and er.goal_id = any($2::text[])
          and (
            (g.workspace_id is null and g.user_id = $1)
            or wm.user_id is not null
          )
        order by er.created_at desc, er.id desc
      `,
      [params.userId, uniqueGoalIds]
    );

    return result.rows.map((row) => this.mapEvidenceRecordRow(row));
  }

  private async listDashboardGoalBundlesWithClient(
    client: Pick<PoolClient, "query">,
    params: {
      userId: string;
      activeWorkspace: Workspace | null;
      limit: number;
    }
  ): Promise<GoalBundle[]> {
    if (!params.activeWorkspace) {
      return [];
    }

    const values: unknown[] = [params.userId, params.activeWorkspace.id, params.limit];
    const predicates = [
      `(
        (g.workspace_id is null and g.user_id = $1)
        or wm.user_id is not null
      )`,
      params.activeWorkspace.isPersonal
        ? `(g.workspace_id = $2 or (g.workspace_id is null and g.user_id = $1))`
        : `g.workspace_id = $2`
    ];
    const result = await client.query(
      `
        select g.id
        from goals g
        left join workspace_members wm on wm.workspace_id = g.workspace_id and wm.user_id = $1
        where ${predicates.join(" and ")}
        order by g.created_at desc, g.id desc
        limit $3
      `,
      values
    );

    return this.mapGoalBundlesWithClient(
      client,
      result.rows.map((row) => String(row.id))
    );
  }

  private async upsertGoalBundle(client: PoolClient, bundle: GoalBundle): Promise<void> {
    const validated = GoalBundleSchema.parse(bundle);

    await client.query(
      `
        insert into workflows (id, goal_id, workspace_id, status, current_step, checkpoint, created_at, updated_at)
        values ($1, $2, $3, $4, $5, $6, $7, $8)
        on conflict (id) do update
        set goal_id = excluded.goal_id,
            workspace_id = excluded.workspace_id,
            status = excluded.status,
            current_step = excluded.current_step,
            checkpoint = excluded.checkpoint,
            updated_at = excluded.updated_at
      `,
      [
        validated.workflow.id,
        validated.workflow.goalId,
        validated.workflow.workspaceId,
        validated.workflow.status,
        validated.workflow.currentStep,
        validated.workflow.checkpoint,
        validated.workflow.createdAt,
        validated.workflow.updatedAt
      ]
    );

    await client.query(
      `
        insert into goals (id, user_id, workspace_id, workflow_id, title, request, intent, status, confidence, explanation, created_at, updated_at)
        values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
        on conflict (id) do update
        set user_id = excluded.user_id,
            workspace_id = excluded.workspace_id,
            workflow_id = excluded.workflow_id,
            title = excluded.title,
            request = excluded.request,
            intent = excluded.intent,
            status = excluded.status,
            confidence = excluded.confidence,
            explanation = excluded.explanation,
            updated_at = excluded.updated_at
      `,
      [
        validated.goal.id,
        validated.goal.userId,
        validated.goal.workspaceId,
        validated.goal.workflowId,
        validated.goal.title,
        validated.goal.request,
        validated.goal.intent,
        validated.goal.status,
        validated.goal.confidence,
        validated.goal.explanation,
        validated.goal.createdAt,
        validated.goal.updatedAt
      ]
    );

    await client.query("delete from action_logs where goal_id = $1", [validated.goal.id]);
    await client.query("delete from approval_requests where goal_id = $1", [validated.goal.id]);
    await client.query("delete from artifacts where goal_id = $1", [validated.goal.id]);
    await client.query("delete from watchers where goal_id = $1", [validated.goal.id]);
    await client.query("delete from tasks where goal_id = $1", [validated.goal.id]);

    for (const task of validated.tasks) {
      await client.query(
        `
          insert into tasks (
            id, goal_id, workflow_id, title, summary, assigned_agent, state, risk_class, requires_approval,
            depends_on, tool_capabilities, artifact_ids, created_at, updated_at
          )
          values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10::jsonb, $11::jsonb, $12::jsonb, $13, $14)
          on conflict (id) do update
          set goal_id = excluded.goal_id,
              workflow_id = excluded.workflow_id,
              title = excluded.title,
              summary = excluded.summary,
              assigned_agent = excluded.assigned_agent,
              state = excluded.state,
              risk_class = excluded.risk_class,
              requires_approval = excluded.requires_approval,
              depends_on = excluded.depends_on,
              tool_capabilities = excluded.tool_capabilities,
              artifact_ids = excluded.artifact_ids,
              updated_at = excluded.updated_at
        `,
        [
          task.id,
          task.goalId,
          task.workflowId,
          task.title,
          task.summary,
          task.assignedAgent,
          task.state,
          task.riskClass,
          task.requiresApproval,
          JSON.stringify(task.dependsOn),
          JSON.stringify(task.toolCapabilities),
          JSON.stringify(task.artifactIds),
          task.createdAt,
          task.updatedAt
        ]
      );
    }

    for (const artifact of validated.artifacts) {
      await client.query(
        `
          insert into artifacts (id, goal_id, task_id, artifact_type, title, content, metadata, created_at)
          values ($1, $2, $3, $4, $5, $6, $7::jsonb, $8)
          on conflict (id) do update
          set goal_id = excluded.goal_id,
              task_id = excluded.task_id,
              artifact_type = excluded.artifact_type,
              title = excluded.title,
              content = excluded.content,
              metadata = excluded.metadata
        `,
        [
          artifact.id,
          artifact.goalId,
          artifact.taskId ?? null,
          artifact.artifactType,
          artifact.title,
          artifact.content,
          JSON.stringify(artifact.metadata),
          artifact.createdAt
        ]
      );
    }

    for (const approval of validated.approvals) {
      await client.query(
        `
          insert into approval_requests (
            id, goal_id, task_id, title, rationale, risk_class, decision, requested_action, action_intent, preview,
            decision_scope, decision_rationale, history, created_at, expiry_at, responded_at
          )
          values ($1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb, $10::jsonb, $11, $12, $13::jsonb, $14, $15, $16)
          on conflict (id) do update
          set goal_id = excluded.goal_id,
              task_id = excluded.task_id,
              title = excluded.title,
              rationale = excluded.rationale,
              risk_class = excluded.risk_class,
              decision = excluded.decision,
              requested_action = excluded.requested_action,
              action_intent = excluded.action_intent,
              preview = excluded.preview,
              decision_scope = excluded.decision_scope,
              decision_rationale = excluded.decision_rationale,
              history = excluded.history,
              expiry_at = excluded.expiry_at,
              responded_at = excluded.responded_at
        `,
        [
          approval.id,
          approval.goalId,
          approval.taskId,
          approval.title,
          approval.rationale,
          approval.riskClass,
          approval.decision,
          approval.requestedAction,
          approval.actionIntent ? JSON.stringify(approval.actionIntent) : null,
          JSON.stringify(approval.preview),
          approval.decisionScope,
          approval.decisionRationale,
          JSON.stringify(approval.history),
          approval.createdAt,
          approval.expiryAt,
          approval.respondedAt
        ]
      );
    }

    for (const watcher of validated.watchers) {
      await client.query(
        `
          insert into watchers (
            id, goal_id, target_entity, condition, frequency, trigger_action, source_systems, status, expiry_at, actor_context, created_at, updated_at
          )
          values ($1, $2, $3, $4, $5, $6, $7::jsonb, $8, $9, $10::jsonb, $11, $12)
          on conflict (id) do update
          set goal_id = excluded.goal_id,
              target_entity = excluded.target_entity,
              condition = excluded.condition,
              frequency = excluded.frequency,
              trigger_action = excluded.trigger_action,
              source_systems = excluded.source_systems,
              status = excluded.status,
              expiry_at = excluded.expiry_at,
              actor_context = excluded.actor_context,
              updated_at = excluded.updated_at
        `,
        [
          watcher.id,
          watcher.goalId,
          watcher.targetEntity,
          watcher.condition,
          watcher.frequency,
          watcher.triggerAction,
          JSON.stringify(watcher.sourceSystems),
          watcher.status,
          watcher.expiryAt,
          JSON.stringify(watcher.actorContext),
          watcher.createdAt,
          watcher.updatedAt
        ]
      );
    }

    for (const log of validated.actionLogs) {
      await client.query(
        `
          insert into action_logs (id, goal_id, task_id, workflow_id, actor, kind, message, details, created_at)
          values ($1, $2, $3, $4, $5, $6, $7, $8::jsonb, $9)
          on conflict (id) do nothing
        `,
        [
          log.id,
          log.goalId,
          log.taskId,
          log.workflowId,
          log.actor,
          log.kind,
          log.message,
          JSON.stringify(log.details),
          log.createdAt
        ]
      );
    }
  }

  private async mapGoalBundle(goalId: string): Promise<GoalBundle | null> {
    await this.ready;
    const client = await this.pool.connect();

    try {
      return this.mapGoalBundleWithClient(client, goalId);
    } finally {
      client.release();
    }
  }

  async seedDefaults(userId = SYSTEM_USER_ID): Promise<void> {
    await this.withTransaction(async (client) => {
      const user = defaultUser(userId);
      const personalWorkspace = defaultWorkspace(userId);
      await client.query(
        `
          insert into users (id, name, created_at)
          values ($1, $2, $3)
          on conflict (id) do nothing
        `,
        [user.id, user.name, user.createdAt]
      );

      await this.saveWorkspaceWithClient(client, personalWorkspace);
      await this.saveWorkspaceMemberWithClient(client, defaultWorkspaceMember(personalWorkspace.id, userId));

      const existingGovernance = await client.query(
        "select 1 from workspace_governance where workspace_id = $1 limit 1",
        [personalWorkspace.id]
      );

      if (Number(existingGovernance.rowCount ?? 0) === 0) {
        await this.saveWorkspaceGovernanceWithClient(client, defaultWorkspaceGovernance(personalWorkspace.id, userId));
      }

      const existingSelection = await client.query(
        "select 1 from workspace_selections where user_id = $1 limit 1",
        [userId]
      );

      if (Number(existingSelection.rowCount ?? 0) === 0) {
        await this.saveWorkspaceSelectionWithClient(
          client,
          WorkspaceSelectionSchema.parse({
            userId,
            workspaceId: personalWorkspace.id,
            actorContext: createSystemActorContext(userId),
            selectedAt: nowIso(),
            updatedAt: nowIso()
          })
        );
      }

      for (const memory of defaultMemories(userId)) {
        await this.saveMemoryWithClient(client, memory);
      }

      for (const integration of buildDefaultIntegrationAccounts(userId).map((candidate) =>
        IntegrationAccountSchema.parse({
          ...candidate,
          actorContext: createSystemActorContext(userId)
        })
      )) {
        await this.saveIntegrationWithClient(client, integration);
      }

      for (const rule of defaultPolicyRules(userId)) {
        await client.query(
          `
            insert into policy_rules (id, user_id, name, description, active, created_at, updated_at)
            values ($1, $2, $3, $4, $5, $6, $7)
            on conflict (id) do update
            set name = excluded.name,
                description = excluded.description,
                active = excluded.active,
                updated_at = excluded.updated_at
          `,
          [rule.id, rule.userId, rule.name, rule.description, rule.active, rule.createdAt, rule.updatedAt]
        );
      }

      const preferencesResult = await client.query(
        "select 1 from briefing_preferences where user_id = $1 limit 1",
        [userId]
      );

      if (Number(preferencesResult.rowCount ?? 0) === 0) {
        await this.saveBriefingPreferencesWithClient(client, defaultBriefingPreferences(userId));
      }

      const autopilotResult = await client.query(
        "select 1 from autopilot_settings where user_id = $1 limit 1",
        [userId]
      );

      if (Number(autopilotResult.rowCount ?? 0) === 0) {
        await this.saveAutopilotSettingsWithClient(client, defaultAutopilotSettings(userId));
      }

      const existingBuiltIns = await client.query(
        "select id from agent_definitions where user_id = $1 and is_built_in = true limit 1",
        [userId]
      );

      if (Number(existingBuiltIns.rowCount ?? 0) === 0) {
        for (const agent of defaultAgents(userId)) {
          await this.saveAgentWithClient(client, agent);
        }
      }

      const existingProducts = await client.query(
        "select count(*)::int as count from operator_products where user_id = $1",
        [userId]
      );

      if (Number(existingProducts.rows[0]?.count ?? 0) === 0) {
        for (const product of defaultOperatorProducts(userId)) {
          await this.saveOperatorProductWithClient(client, product);
        }
      }

      const existingProductSelection = await client.query(
        "select 1 from operator_product_selections where user_id = $1 limit 1",
        [userId]
      );

      if (Number(existingProductSelection.rowCount ?? 0) === 0) {
        const [defaultSelection] = defaultOperatorProducts(userId);
        await this.saveOperatorProductSelectionWithClient(
          client,
          OperatorProductSelectionSchema.parse({
            userId,
            operatorProductId: defaultSelection.id,
            actorContext: createSystemActorContext(userId),
            selectedAt: nowIso(),
            updatedAt: nowIso()
          })
        );
      }
    });
  }

  async listWorkspaces(userId = SYSTEM_USER_ID): Promise<Workspace[]> {
    await this.ready;
    const client = await this.pool.connect();

    try {
      return (await this.listWorkspacesForUserWithClient(client, userId)).map((workspace) => WorkspaceSchema.parse(clone(workspace)));
    } finally {
      client.release();
    }
  }

  async saveWorkspace(workspace: Workspace, actor: ActorContext): Promise<Workspace> {
    const validated = WorkspaceSchema.parse(workspace);
    const actorUserId = subjectUserIdForActor(actor);

    await this.withTransaction(async (client) => {
      const duplicateSlugResult = await client.query(
        `
          select id
          from workspaces
          where slug = $1 and id <> $2
          limit 1
        `,
        [validated.slug, validated.id]
      );

      if (Number(duplicateSlugResult.rowCount ?? 0) > 0) {
        throw new Error(`Workspace slug ${validated.slug} is already in use.`);
      }

      const existing = await this.getWorkspaceByIdWithClient(client, validated.id);

      if (existing) {
        await this.assertWorkspaceOwnerWithClient(client, validated.id, actorUserId);
      } else if (validated.ownerUserId !== actorUserId) {
        throw new Error(`User ${actorUserId} cannot create workspace ${validated.id} for another owner.`);
      }

      await client.query(
        `
          insert into users (id, name, created_at)
          values ($1, $2, $3)
          on conflict (id) do nothing
        `,
        [validated.ownerUserId, validated.ownerUserId, validated.createdAt]
      );

      await this.saveWorkspaceWithClient(client, validated);
      await this.saveWorkspaceMemberWithClient(client, defaultWorkspaceMember(validated.id, validated.ownerUserId));

      const governance = await this.getWorkspaceGovernanceWithClient(client, validated.id);

      if (!governance) {
        await this.saveWorkspaceGovernanceWithClient(
          client,
          defaultWorkspaceGovernance(validated.id, governanceUpdatedByForActor(actor))
        );
      }
    });

    return WorkspaceSchema.parse(clone(validated));
  }

  async listWorkspaceMembers(workspaceId: string, userId = SYSTEM_USER_ID): Promise<WorkspaceMember[]> {
    await this.ready;
    const client = await this.pool.connect();

    try {
      await this.assertWorkspaceMemberWithClient(client, workspaceId, userId);
      const members = await this.listWorkspaceMembersForWorkspaceWithClient(client, workspaceId);
      return members.map((member) => WorkspaceMemberSchema.parse(clone(member)));
    } finally {
      client.release();
    }
  }

  async saveWorkspaceMember(member: WorkspaceMember, actor: ActorContext): Promise<WorkspaceMember> {
    const validated = WorkspaceMemberSchema.parse(member);
    const actorUserId = subjectUserIdForActor(actor);

    await this.withTransaction(async (client) => {
      const workspace = await this.getWorkspaceByIdWithClient(client, validated.workspaceId);

      if (!workspace) {
        throw new Error(`Workspace ${validated.workspaceId} was not found.`);
      }

      await this.assertWorkspaceOwnerWithClient(client, validated.workspaceId, actorUserId);

      if (workspace.isPersonal && validated.userId !== workspace.ownerUserId) {
        throw new Error("Personal workspaces cannot add additional members.");
      }

      await client.query(
        `
          insert into users (id, name, created_at)
          values ($1, $2, $3)
          on conflict (id) do nothing
        `,
        [validated.userId, validated.userId, validated.joinedAt]
      );

      await this.saveWorkspaceMemberWithClient(client, validated);
    });

    return WorkspaceMemberSchema.parse(clone(validated));
  }

  async getWorkspaceSelection(userId = SYSTEM_USER_ID): Promise<WorkspaceSelection | null> {
    await this.ready;
    const client = await this.pool.connect();

    try {
      const selection = await this.getWorkspaceSelectionWithClient(client, userId);
      return selection ? WorkspaceSelectionSchema.parse(clone(selection)) : null;
    } finally {
      client.release();
    }
  }

  async saveWorkspaceSelection(selection: WorkspaceSelection): Promise<WorkspaceSelection> {
    const validated = WorkspaceSelectionSchema.parse(selection);

    await this.withTransaction(async (client) => {
      await this.assertWorkspaceMemberWithClient(client, validated.workspaceId, validated.userId);
      await this.saveWorkspaceSelectionWithClient(client, validated);
    });

    return WorkspaceSelectionSchema.parse(clone(validated));
  }

  async getWorkspaceGovernance(workspaceId: string, userId = SYSTEM_USER_ID): Promise<WorkspaceGovernance | null> {
    await this.ready;
    const client = await this.pool.connect();

    try {
      await this.assertWorkspaceMemberWithClient(client, workspaceId, userId);
      const governance = await this.getWorkspaceGovernanceWithClient(client, workspaceId);
      return governance ? WorkspaceGovernanceSchema.parse(clone(governance)) : null;
    } finally {
      client.release();
    }
  }

  async listGoalShares(filters?: GoalShareListFilters): Promise<GoalShareRecord[]> {
    await this.ready;
    const client = await this.pool.connect();

    try {
      return (await this.listGoalSharesWithClient(client, filters)).map((share) => GoalShareRecordSchema.parse(clone(share)));
    } finally {
      client.release();
    }
  }

  async getGoalShare(shareId: string, userId = SYSTEM_USER_ID): Promise<GoalShareRecord | null> {
    await this.ready;
    const client = await this.pool.connect();

    try {
      const share = await this.getGoalShareWithClient(client, shareId, userId);
      return share ? GoalShareRecordSchema.parse(clone(share)) : null;
    } finally {
      client.release();
    }
  }

  async getGoalShareByTokenFingerprint(tokenFingerprint: string): Promise<GoalShareRecord | null> {
    await this.ready;
    const client = await this.pool.connect();

    try {
      const share = await this.getGoalShareByTokenFingerprintWithClient(client, tokenFingerprint);
      return share ? GoalShareRecordSchema.parse(clone(share)) : null;
    } finally {
      client.release();
    }
  }

  async saveGoalShare(share: GoalShareRecord): Promise<GoalShareRecord> {
    const validated = GoalShareRecordSchema.parse({
      ...share,
      tokenFingerprint: goalShareFingerprintStoreKey(share)
    });

    await this.withTransaction(async (client) => {
      const goalResult = await client.query(
        `
          select id, user_id, workspace_id
          from goals
          where id = $1
          limit 1
        `,
        [validated.goalId]
      );

      if (!goalResult.rows[0]) {
        throw new Error(`Goal ${validated.goalId} was not found.`);
      }

      const goalRow = goalResult.rows[0];

      if (typeof goalRow.workspace_id === "string") {
        await this.assertWorkspaceMemberWithClient(client, goalRow.workspace_id, validated.userId);
      } else if (goalRow.user_id !== validated.userId) {
        throw new Error(`User ${validated.userId} cannot manage shares for goal ${validated.goalId}.`);
      }

      await this.saveGoalShareWithClient(client, validated);
    });

    return GoalShareRecordSchema.parse(clone(validated));
  }

  async listPrivacyOperations(filters?: PrivacyOperationListFilters): Promise<PrivacyOperation[]> {
    await this.ready;
    const client = await this.pool.connect();

    try {
      return (await this.listPrivacyOperationsWithClient(client, filters)).map((operation) =>
        PrivacyOperationSchema.parse(clone(operation))
      );
    } finally {
      client.release();
    }
  }

  async getPrivacyOperation(operationId: string, userId = SYSTEM_USER_ID): Promise<PrivacyOperation | null> {
    await this.ready;
    const client = await this.pool.connect();

    try {
      const operation = await this.getPrivacyOperationWithClient(client, operationId, userId);
      return operation ? PrivacyOperationSchema.parse(clone(operation)) : null;
    } finally {
      client.release();
    }
  }

  async savePrivacyOperation(operation: PrivacyOperation): Promise<PrivacyOperation> {
    const validated = PrivacyOperationSchema.parse(operation);

    await this.withTransaction(async (client) => {
      await this.assertWorkspaceMemberWithClient(client, validated.workspaceId, validated.userId);
      await this.savePrivacyOperationWithClient(client, validated);
    });

    return PrivacyOperationSchema.parse(clone(validated));
  }

  async enforceWorkspaceRetention(params: WorkspaceRetentionParams): Promise<Record<string, unknown>> {
    return this.withTransaction(async (client) => {
      const workspace = await this.getWorkspaceByIdWithClient(client, params.workspaceId);

      if (!workspace) {
        throw new Error(`Workspace ${params.workspaceId} was not found.`);
      }

      await this.assertWorkspaceOwnerWithClient(client, params.workspaceId, params.userId);

      const { effectiveNow, retentionCutoff } = resolveRetentionWindow(params.retentionDays, params.now);
      const goalValues: unknown[] = [workspace.id];
      const goalPredicates = ["workspace_id = $1"];

      if (workspace.isPersonal) {
        goalValues.push(workspace.ownerUserId);
        goalPredicates.push("(workspace_id is null and user_id = $2)");
      }

      const goalIds = (
        await client.query(
          `
            select id
            from goals
            where ${goalPredicates.join(" or ")}
          `,
          goalValues
        )
      ).rows.map((row) => row.id as string);

      if (goalIds.length === 0) {
        return {
          workspaceId: params.workspaceId,
          retentionDays: params.retentionDays,
          enforcedAt: effectiveNow,
          retentionCutoff,
          goalCount: 0,
          revokedSharesCount: 0,
          purgedSharesCount: 0,
          remainingShareCount: 0
        };
      }

      const revokedResult = await client.query(
        `
          update goal_shares
          set status = 'revoked',
              revoked_at = coalesce(revoked_at, $2),
              updated_at = $2
          where goal_id = any($1::text[])
            and status = 'active'
            and expires_at <= $2
        `,
        [goalIds, effectiveNow]
      );
      const purgedResult = await client.query(
        `
          delete from goal_shares
          where goal_id = any($1::text[])
            and coalesce(revoked_at, expires_at) <= $2
        `,
        [goalIds, retentionCutoff]
      );
      const remainingResult = await client.query(
        `
          select count(*)::int as count
          from goal_shares
          where goal_id = any($1::text[])
        `,
        [goalIds]
      );

      return {
        workspaceId: params.workspaceId,
        retentionDays: params.retentionDays,
        enforcedAt: effectiveNow,
        retentionCutoff,
        goalCount: goalIds.length,
        revokedSharesCount: Number(revokedResult.rowCount ?? 0),
        purgedSharesCount: Number(purgedResult.rowCount ?? 0),
        remainingShareCount: Number(remainingResult.rows[0]?.count ?? 0)
      };
    });
  }

  async deleteWorkspaceData(params: WorkspaceDeleteParams): Promise<Record<string, unknown>> {
    return this.withTransaction(async (client) => {
      const workspace = await this.getWorkspaceByIdWithClient(client, params.workspaceId);

      if (!workspace) {
        throw new Error(`Workspace ${params.workspaceId} was not found.`);
      }

      await this.assertWorkspaceOwnerWithClient(client, params.workspaceId, params.userId);

      if (workspace.isPersonal) {
        throw new Error(`Workspace ${params.workspaceId} is personal and cannot be deleted.`);
      }

      const effectiveNow = params.now ? new Date(Date.parse(params.now)).toISOString() : nowIso();
      const tombstone = buildDeletedWorkspaceTombstone(workspace, params.operationId, effectiveNow);
      const goalIds = (
        await client.query(
          `
            select id
            from goals
            where workspace_id = $1
          `,
          [workspace.id]
        )
      ).rows.map((row) => row.id as string);
      const workflowIds = (
        await client.query(
          `
            select id
            from workflows
            where workspace_id = $1
               or goal_id = any($2::text[])
          `,
          [workspace.id, goalIds]
        )
      ).rows.map((row) => row.id as string);
      const approvalIds = (
        await client.query(
          `
            select id
            from approval_requests
            where goal_id = any($1::text[])
          `,
          [goalIds]
        )
      ).rows.map((row) => row.id as string);
      const watcherIds = (
        await client.query(
          `
            select id
            from watchers
            where goal_id = any($1::text[])
          `,
          [goalIds]
        )
      ).rows.map((row) => row.id as string);
      const credentialKeys = (
        await client.query(
          `
            select user_id, id
            from provider_credentials
            where workspace_id = $1
          `,
          [workspace.id]
        )
      ).rows.map((row) => `${row.user_id as string}:${row.id as string}`);

      const evidenceRecordsResult = await client.query(
        `
          delete from evidence_records
          where goal_id = any($1::text[])
             or approval_id = any($2::text[])
        `,
        [goalIds, approvalIds]
      );
      const commitmentsResult = await client.query(
        `
          delete from commitments
          where goal_id = any($1::text[])
             or approval_id = any($2::text[])
        `,
        [goalIds, approvalIds]
      );
      const autopilotEventsResult = await client.query(
        `
          delete from autopilot_events
          where source_id = any($1::text[])
             or result_goal_id = any($2::text[])
        `,
        [watcherIds, goalIds]
      );
      const jobsResult = await client.query(
        `
          delete from jobs
          where (
            payload ->> 'type' = 'goal_create'
            and (
              payload ->> 'workspaceId' = $1
              or payload ->> 'goalId' = any($2::text[])
            )
          ) or (
            payload ->> 'type' = 'autopilot_process'
            and payload ->> 'sourceId' = any($3::text[])
          ) or (
            payload ->> 'type' = 'privacy_operation'
            and payload ->> 'workspaceId' = $1
            and payload ->> 'operationId' <> $4
          )
        `,
        [workspace.id, goalIds, watcherIds, params.operationId]
      );
      const providerCredentialSecretsResult = await client.query(
        `
          delete from provider_credential_secrets
          where (user_id || ':' || credential_id) = any($1::text[])
        `,
        [credentialKeys]
      );
      const providerCredentialsResult = await client.query(
        `
          delete from provider_credentials
          where workspace_id = $1
        `,
        [workspace.id]
      );
      const goalSharesResult = await client.query(
        `
          delete from goal_shares
          where goal_id = any($1::text[])
             or workspace_id = $2
        `,
        [goalIds, workspace.id]
      );
      const actionLogsResult = await client.query(
        `
          delete from action_logs
          where goal_id = any($1::text[])
             or workflow_id = any($2::text[])
        `,
        [goalIds, workflowIds]
      );
      const artifactsResult = await client.query(
        `
          delete from artifacts
          where goal_id = any($1::text[])
        `,
        [goalIds]
      );
      const watchersResult = await client.query(
        `
          delete from watchers
          where goal_id = any($1::text[])
        `,
        [goalIds]
      );
      const approvalsResult = await client.query(
        `
          delete from approval_requests
          where goal_id = any($1::text[])
        `,
        [goalIds]
      );
      const tasksResult = await client.query(
        `
          delete from tasks
          where goal_id = any($1::text[])
             or workflow_id = any($2::text[])
        `,
        [goalIds, workflowIds]
      );
      const workflowsResult = await client.query(
        `
          delete from workflows
          where workspace_id = $1
             or goal_id = any($2::text[])
        `,
        [workspace.id, goalIds]
      );
      const goalsResult = await client.query(
        `
          delete from goals
          where id = any($1::text[])
        `,
        [goalIds]
      );
      const workspaceSelectionsResult = await client.query(
        `
          delete from workspace_selections
          where workspace_id = $1
        `,
        [workspace.id]
      );
      const workspaceGovernanceResult = await client.query(
        `
          delete from workspace_governance
          where workspace_id = $1
        `,
        [workspace.id]
      );
      await client.query(
        `
          delete from workspace_members
          where workspace_id = $1
            and user_id <> $2
        `,
        [workspace.id, workspace.ownerUserId]
      );
      await this.saveWorkspaceWithClient(client, tombstone);
      const retainedMembersResult = await client.query(
        `
          select count(*)::int as count
          from workspace_members
          where workspace_id = $1
        `,
        [workspace.id]
      );

      return {
        workspaceId: workspace.id,
        deletedAt: effectiveNow,
        operationId: params.operationId,
        deletedGoalCount: Number(goalsResult.rowCount ?? 0),
        deletedWorkflowCount: Number(workflowsResult.rowCount ?? 0),
        deletedTaskCount: Number(tasksResult.rowCount ?? 0),
        deletedApprovalCount: Number(approvalsResult.rowCount ?? 0),
        deletedActionLogCount: Number(actionLogsResult.rowCount ?? 0),
        deletedEvidenceRecordCount: Number(evidenceRecordsResult.rowCount ?? 0),
        deletedWatcherCount: Number(watchersResult.rowCount ?? 0),
        deletedArtifactCount: Number(artifactsResult.rowCount ?? 0),
        deletedGoalShareCount: Number(goalSharesResult.rowCount ?? 0),
        deletedCommitmentCount: Number(commitmentsResult.rowCount ?? 0),
        deletedAutopilotEventCount: Number(autopilotEventsResult.rowCount ?? 0),
        deletedJobCount: Number(jobsResult.rowCount ?? 0),
        deletedProviderCredentialCount: Number(providerCredentialsResult.rowCount ?? 0),
        deletedProviderCredentialSecretCount: Number(providerCredentialSecretsResult.rowCount ?? 0),
        deletedWorkspaceSelectionCount: Number(workspaceSelectionsResult.rowCount ?? 0),
        deletedWorkspaceGovernanceCount: Number(workspaceGovernanceResult.rowCount ?? 0),
        retainedWorkspaceMemberCount: Number(retainedMembersResult.rows[0]?.count ?? 0),
        tombstonedWorkspaceSlug: tombstone.slug
      };
    });
  }

  async saveWorkspaceGovernance(
    governance: WorkspaceGovernance,
    actor: ActorContext
  ): Promise<WorkspaceGovernance> {
    const validated = WorkspaceGovernanceSchema.parse(governance);
    const actorUserId = subjectUserIdForActor(actor);

    await this.withTransaction(async (client) => {
      await this.assertWorkspaceOwnerWithClient(client, validated.workspaceId, actorUserId);
      await this.saveWorkspaceGovernanceWithClient(client, validated);
    });

    return WorkspaceGovernanceSchema.parse(clone(validated));
  }

  async exportWorkspaceAudit(workspaceId: string, userId = SYSTEM_USER_ID): Promise<WorkspaceAuditExport> {
    await this.ready;
    const client = await this.pool.connect();

    try {
      await this.assertWorkspaceMemberWithClient(client, workspaceId, userId);
      const workspace = await this.getWorkspaceByIdWithClient(client, workspaceId);

      if (!workspace) {
        throw new Error(`Workspace ${workspaceId} was not found.`);
      }

      const [governance, members] = await Promise.all([
        this.getWorkspaceGovernanceWithClient(client, workspaceId),
        this.listWorkspaceMembersForWorkspaceWithClient(client, workspaceId)
      ]);
      const goalValues: unknown[] = [workspaceId];
      const goalPredicates = ["workspace_id = $1"];

      if (workspace.isPersonal) {
        goalValues.push(userId);
        goalPredicates.push(`(workspace_id is null and user_id = $2)`);
      }

      const goalsResult = await client.query(
        `
          select id
          from goals
          where ${goalPredicates.join(" or ")}
          order by created_at desc
        `,
        goalValues
      );
      const goals = (
        await Promise.all(goalsResult.rows.map((row) => this.mapGoalBundleWithClient(client, row.id as string)))
      )
        .filter((bundle): bundle is GoalBundle => bundle !== null)
        .map((bundle) => GoalBundleSchema.parse(clone(bundle)));
      const goalIds = goals.map((bundle) => bundle.goal.id);
      const goalShares =
        goalIds.length > 0
          ? (
              await client.query(
                `
                  select *
                  from goal_shares
                  where goal_id = any($1::text[])
                  order by updated_at desc
                `,
                [goalIds]
              )
            ).rows.map((row) => this.mapGoalShareRow(row))
          : [];
      const privacyOperations = (
        await client.query(
          `
            select *
            from privacy_operations
            where workspace_id = $1
            order by created_at desc
          `,
          [workspaceId]
        )
      ).rows.map((row) => this.mapPrivacyOperationRow(row));

      return buildWorkspaceAuditExport({
        workspace,
        governance,
        members,
        goals,
        goalShares,
        privacyOperations
      });
    } finally {
      client.release();
    }
  }

  async saveGoalBundle(bundle: GoalBundle): Promise<GoalBundle> {
    const validated = GoalBundleSchema.parse(bundle);
    await this.withTransaction(async (client) => {
      if (validated.goal.workspaceId) {
        const workspace = await this.getWorkspaceByIdWithClient(client, validated.goal.workspaceId);

        if (!workspace) {
          throw new Error(`Workspace ${validated.goal.workspaceId} was not found.`);
        }
      }

      await this.upsertGoalBundle(client, validated);
    });
    return GoalBundleSchema.parse(clone(validated));
  }

  async respondToApproval(params: {
    approvalId: string;
    decision: Exclude<ApprovalDecision, "pending">;
    actor: ActorContext;
    scope?: ApprovalDecisionScope;
    rationale?: string | null;
  }): Promise<GoalBundle> {
    const actor = parseActorContext(params.actor);
    const userId = subjectUserIdForActor(actor);

    return this.withTransaction(async (client) => {
      const approvalResult = await client.query(
        `
          select a.id, a.goal_id, a.decision, a.expiry_at
          from approval_requests a
          join goals g on g.id = a.goal_id
          left join workspace_members wm on wm.workspace_id = g.workspace_id and wm.user_id = $2
          where a.id = $1
            and (
              (g.workspace_id is null and g.user_id = $2)
              or wm.user_id is not null
            )
          for update
        `,
        [params.approvalId, userId]
      );

      if (Number(approvalResult.rowCount ?? 0) === 0) {
        throw new ApprovalMutationError("not_found", `Approval ${params.approvalId} was not found.`);
      }

      const approvalRow = approvalResult.rows[0];

      if (approvalRow.decision !== "pending") {
        throw new ApprovalMutationError("already_handled", `Approval ${params.approvalId} has already been handled.`);
      }

      if (new Date(approvalRow.expiry_at).getTime() <= Date.now()) {
        throw new ApprovalMutationError("expired", `Approval ${params.approvalId} has expired and can no longer be actioned.`);
      }

      const bundle = await this.mapGoalBundleWithClient(client, approvalRow.goal_id);

      if (!bundle) {
        throw new ApprovalMutationError("not_found", `Approval ${params.approvalId} was not found.`);
      }

      const originalApproval = bundle.approvals.find((candidate) => candidate.id === params.approvalId);

      if (!originalApproval) {
        throw new ApprovalMutationError("not_found", `Approval ${params.approvalId} was not found.`);
      }

      const updatedBundle = applyApprovalResponse({
        bundle,
        approvalId: params.approvalId,
        decision: params.decision,
        actor,
        scope: params.scope,
        rationale: params.rationale
      });
      const evidenceRecord = buildApprovalEvidenceRecord({
        actor,
        previousBundle: bundle,
        updatedBundle,
        originalApproval
      });

      await this.upsertGoalBundle(client, updatedBundle);
      await this.saveEvidenceRecordWithClient(client, evidenceRecord);
      return GoalBundleSchema.parse(clone(updatedBundle));
    });
  }

  async getGoalBundle(goalId: string): Promise<GoalBundle | null> {
    const bundle = await this.mapGoalBundle(goalId);
    return bundle ? GoalBundleSchema.parse(clone(bundle)) : null;
  }

  async getGoalBundleForUser(goalId: string, userId = SYSTEM_USER_ID): Promise<GoalBundle | null> {
    await this.ready;
    const result = await this.pool.query(
      `
        select g.id
        from goals g
        left join workspace_members wm on wm.workspace_id = g.workspace_id and wm.user_id = $2
        where g.id = $1
          and (
            (g.workspace_id is null and g.user_id = $2)
            or wm.user_id is not null
          )
        limit 1
      `,
      [goalId, userId]
    );

    if (Number(result.rowCount ?? 0) === 0) {
      return null;
    }

    const bundle = await this.mapGoalBundle(goalId);
    return bundle ? GoalBundleSchema.parse(clone(bundle)) : null;
  }

  async listGoals(userId = SYSTEM_USER_ID): Promise<GoalBundle[]> {
    await this.ready;
    const client = await this.pool.connect();

    try {
      const result = await client.query(
        `
          select distinct g.id, g.created_at
          from goals g
          left join workspace_members wm on wm.workspace_id = g.workspace_id and wm.user_id = $1
          where (
            (g.workspace_id is null and g.user_id = $1)
            or wm.user_id is not null
          )
          order by g.created_at desc, g.id desc
        `,
        [userId]
      );
      const bundles = await this.mapGoalBundlesWithClient(
        client,
        result.rows.map((row) => String(row.id))
      );

      return bundles.map((bundle) => GoalBundleSchema.parse(clone(bundle)));
    } finally {
      client.release();
    }
  }

  async listGoalsPage(params?: GoalPageParams): Promise<GoalBundlePage> {
    await this.ready;
    const userId = params?.userId ?? SYSTEM_USER_ID;
    const limit = normalizeCollectionPageLimit(params?.limit);
    const cursor = decodeCollectionCursor(params?.cursor ?? null);
    const client = await this.pool.connect();

    try {
      const values: unknown[] = [userId];
      const predicates = [
        `(
          (g.workspace_id is null and g.user_id = $1)
          or wm.user_id is not null
        )`
      ];

      if (params?.workspaceId !== undefined) {
        if (params.workspaceId === null) {
          predicates.push("g.workspace_id is null");
        } else {
          values.push(params.workspaceId);
          predicates.push(`g.workspace_id = $${values.length}`);
        }
      }

      if (cursor) {
        values.push(cursor.createdAt, cursor.id);
        const createdAtIndex = values.length - 1;
        const idIndex = values.length;
        predicates.push(`(g.created_at < $${createdAtIndex} or (g.created_at = $${createdAtIndex} and g.id < $${idIndex}))`);
      }

      values.push(limit + 1);
      const limitIndex = values.length;
      const result = await client.query(
        `
          select distinct g.id, g.created_at
          from goals g
          left join workspace_members wm on wm.workspace_id = g.workspace_id and wm.user_id = $1
          where ${predicates.join(" and ")}
          order by g.created_at desc, g.id desc
          limit $${limitIndex}
        `,
        values
      );
      const pageRows = result.rows.slice(0, limit);
      const bundles = await this.mapGoalBundlesWithClient(
        client,
        pageRows.map((row) => String(row.id))
      );
      const bundlesById = new Map(bundles.map((bundle) => [bundle.goal.id, bundle] as const));
      const items = pageRows
        .map((row) => bundlesById.get(String(row.id)) ?? null)
        .filter((bundle): bundle is GoalBundle => bundle !== null)
        .map((bundle) => GoalBundleSchema.parse(clone(bundle)));
      const lastRow = pageRows.at(-1);

      return GoalBundlePageSchema.parse({
        items,
        nextCursor:
          result.rows.length > limit && lastRow
            ? encodeCollectionCursor({
                createdAt: new Date(lastRow.created_at).toISOString(),
                id: String(lastRow.id)
              })
            : null
      });
    } finally {
      client.release();
    }
  }

  async listApprovals(userId = SYSTEM_USER_ID): Promise<ApprovalRequest[]> {
    await this.ready;
    const result = await this.pool.query(
      `
        select a.*
        from approval_requests a
        join goals g on g.id = a.goal_id
        left join workspace_members wm on wm.workspace_id = g.workspace_id and wm.user_id = $1
        where (g.workspace_id is null and g.user_id = $1)
           or wm.user_id is not null
        order by a.created_at desc
      `,
      [userId]
    );

    return result.rows.map((row) => this.mapApprovalRow(row as Record<string, unknown>));
  }

  async listEvidenceRecords(params?: {
    userId?: string;
    goalId?: string;
    approvalId?: string;
  }): Promise<EvidenceRecord[]> {
    await this.ready;
    const userId = params?.userId ?? SYSTEM_USER_ID;
    const values: string[] = [userId];
    let index = values.length + 1;
    let filters = "";

    if (params?.goalId) {
      values.push(params.goalId);
      filters += ` and er.goal_id = $${index++}`;
    }

    if (params?.approvalId) {
      values.push(params.approvalId);
      filters += ` and er.approval_id = $${index++}`;
    }

    const result = await this.pool.query(
      `
        select er.*
        from evidence_records er
        join goals g on g.id = er.goal_id
        left join workspace_members wm on wm.workspace_id = g.workspace_id and wm.user_id = $1
        where (
          (g.workspace_id is null and g.user_id = $1)
          or wm.user_id is not null
        )
        ${filters}
        order by er.created_at desc
      `,
      values
    );

    return result.rows.map((row) => this.mapEvidenceRecordRow(row));
  }

  async listCommitments(userId = SYSTEM_USER_ID): Promise<Commitment[]> {
    await this.ready;
    const result = await this.pool.query(
      `
        select *
        from commitments
        where user_id = $1
        order by updated_at desc
      `,
      [userId]
    );

    return sortCommitments(
      result.rows.map((row) =>
        CommitmentSchema.parse({
          id: row.id,
          userId: row.user_id,
          title: row.title,
          summary: row.summary,
          status: row.status,
          sourceKind: row.source_kind,
          sourceId: row.source_id,
          goalId: row.goal_id ?? null,
          approvalId: row.approval_id ?? null,
          dueAt: row.due_at ? new Date(row.due_at).toISOString() : null,
          actorContext: row.actor_context ? ActorContextSchema.parse(row.actor_context) : null,
          confidence: Number(row.confidence),
          evidence: row.evidence ?? [],
          createdAt: new Date(row.created_at).toISOString(),
          updatedAt: new Date(row.updated_at).toISOString()
        })
      )
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
    const validated = CommitmentSchema.parse(commitment);

    await this.withTransaction(async (client) => {
      await client.query(
        `
          insert into commitments (
            id, user_id, title, summary, status, source_kind, source_id, goal_id, approval_id, due_at, actor_context, confidence, evidence, created_at, updated_at
          )
          values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11::jsonb, $12, $13::jsonb, $14, $15)
          on conflict (id) do update
          set user_id = excluded.user_id,
              title = excluded.title,
              summary = excluded.summary,
              status = excluded.status,
              source_kind = excluded.source_kind,
              source_id = excluded.source_id,
              goal_id = excluded.goal_id,
              approval_id = excluded.approval_id,
              due_at = excluded.due_at,
              actor_context = excluded.actor_context,
              confidence = excluded.confidence,
              evidence = excluded.evidence,
              updated_at = excluded.updated_at
        `,
        [
          validated.id,
          validated.userId,
          validated.title,
          validated.summary,
          validated.status,
          validated.sourceKind,
          validated.sourceId,
          validated.goalId,
          validated.approvalId,
          validated.dueAt,
          JSON.stringify(validated.actorContext),
          validated.confidence,
          JSON.stringify(validated.evidence),
          validated.createdAt,
          validated.updatedAt
        ]
      );
    });

    return CommitmentSchema.parse(clone(validated));
  }

  async deleteCommitment(commitmentId: string, userId = SYSTEM_USER_ID): Promise<void> {
    await this.withTransaction(async (client) => {
      await client.query("delete from commitments where id = $1 and user_id = $2", [commitmentId, userId]);
    });
  }

  async getBriefingPreferences(userId = SYSTEM_USER_ID): Promise<BriefingPreferences> {
    await this.ready;
    const result = await this.pool.query("select * from briefing_preferences where user_id = $1 limit 1", [userId]);

    if (Number(result.rowCount ?? 0) === 0) {
      return BriefingPreferencesSchema.parse(clone(defaultBriefingPreferences(userId)));
    }

    const row = result.rows[0];
    return BriefingPreferencesSchema.parse({
      userId: row.user_id,
      timezone: row.timezone,
      focus: row.focus,
      schedules: row.schedules ?? defaultBriefingSchedules(),
      actorContext: row.actor_context ? ActorContextSchema.parse(row.actor_context) : null,
      createdAt: new Date(row.created_at).toISOString(),
      updatedAt: new Date(row.updated_at).toISOString()
    });
  }

  async saveBriefingPreferences(preferences: BriefingPreferences): Promise<BriefingPreferences> {
    const validated = BriefingPreferencesSchema.parse(preferences);
    await this.withTransaction((client) => this.saveBriefingPreferencesWithClient(client, validated));
    return BriefingPreferencesSchema.parse(clone(validated));
  }

  async getAutopilotSettings(userId = SYSTEM_USER_ID): Promise<AutopilotSettings> {
    await this.ready;
    const result = await this.pool.query("select * from autopilot_settings where user_id = $1 limit 1", [userId]);

    if (Number(result.rowCount ?? 0) === 0) {
      return AutopilotSettingsSchema.parse(clone(defaultAutopilotSettings(userId)));
    }

    const row = result.rows[0];
    return AutopilotSettingsSchema.parse({
      userId: row.user_id,
      mode: row.mode,
      debounceMinutes: Number(row.debounce_minutes),
      actorContext: row.actor_context ? ActorContextSchema.parse(row.actor_context) : null,
      createdAt: new Date(row.created_at).toISOString(),
      updatedAt: new Date(row.updated_at).toISOString()
    });
  }

  async saveAutopilotSettings(settings: AutopilotSettings): Promise<AutopilotSettings> {
    const validated = AutopilotSettingsSchema.parse(settings);
    await this.withTransaction((client) => this.saveAutopilotSettingsWithClient(client, validated));
    return AutopilotSettingsSchema.parse(clone(validated));
  }

  async listAutopilotEvents(userId = SYSTEM_USER_ID): Promise<AutopilotEvent[]> {
    await this.ready;
    const result = await this.pool.query(
      "select * from autopilot_events where user_id = $1 order by created_at desc, id desc",
      [userId]
    );

    return result.rows.map((row) => this.mapAutopilotEventRow(row));
  }

  async listAutopilotEventsPage(params?: CollectionPageParams): Promise<AutopilotEventPage> {
    await this.ready;
    const userId = params?.userId ?? SYSTEM_USER_ID;
    const limit = normalizeCollectionPageLimit(params?.limit);
    const cursor = decodeCollectionCursor(params?.cursor ?? null);
    const values: unknown[] = [userId];
    let cursorClause = "";

    if (cursor) {
      values.push(cursor.createdAt, cursor.id);
      const createdAtIndex = values.length - 1;
      const idIndex = values.length;
      cursorClause = ` and (created_at < $${createdAtIndex} or (created_at = $${createdAtIndex} and id < $${idIndex}))`;
    }

    values.push(limit + 1);
    const limitIndex = values.length;
    const result = await this.pool.query(
      `
        select *
        from autopilot_events
        where user_id = $1${cursorClause}
        order by created_at desc, id desc
        limit $${limitIndex}
      `,
      values
    );
    const items = result.rows.slice(0, limit).map((row) => this.mapAutopilotEventRow(row));
    const last = items.at(-1);

    return AutopilotEventPageSchema.parse({
      items,
      nextCursor:
        result.rows.length > limit && last
          ? encodeCollectionCursor({
              createdAt: last.createdAt,
              id: last.id
            })
          : null
    });
  }

  async claimAutopilotEvent(params: {
    userId?: string;
    kind: AutopilotEventKind;
    sourceId: string;
    idempotencyKey?: string | null;
    mode: AutopilotMode;
    summary: string;
    details?: Record<string, unknown>;
    actorContext?: ActorContext | null;
    debounceMinutes: number;
  }): Promise<AutopilotEventClaim> {
    const userId = params.userId ?? SYSTEM_USER_ID;
    const trimmedKey = params.idempotencyKey?.trim() || null;

    return this.withTransaction(async (client) => {
      await client.query("select pg_advisory_xact_lock(hashtext($1))", [
        `${userId}:${params.kind}:${params.sourceId}`
      ]);

      if (trimmedKey) {
        const existingResult = await client.query(
          `
            select *
            from autopilot_events
            where user_id = $1 and idempotency_key = $2
            limit 1
          `,
          [userId, trimmedKey]
        );

        if (existingResult.rows.length > 0) {
          return {
            outcome: "duplicate",
            event: this.mapAutopilotEventRow(existingResult.rows[0])
          };
        }
      }

      const debounceCutoff = new Date(Date.now() - params.debounceMinutes * 60 * 1000).toISOString();
      const recentResult = await client.query(
        `
          select *
          from autopilot_events
          where user_id = $1
            and kind = $2
            and source_id = $3
            and created_at >= $4
          order by created_at desc
          limit 1
        `,
        [userId, params.kind, params.sourceId, debounceCutoff]
      );

      if (recentResult.rows.length > 0) {
        const recent = this.mapAutopilotEventRow(recentResult.rows[0]);
        const debouncedEvent = AutopilotEventSchema.parse({
          ...buildPendingAutopilotEvent({
            userId,
            kind: params.kind,
            sourceId: params.sourceId,
            idempotencyKey: trimmedKey,
            mode: params.mode,
            summary: params.summary,
            actorContext: params.actorContext,
            details: {
              ...(params.details ?? {}),
              debouncedByEventId: recent.id
            }
          }),
          status: "debounced",
          processedAt: nowIso()
        });

        await this.saveAutopilotEventWithClient(client, debouncedEvent);
        return {
          outcome: "debounced",
          event: AutopilotEventSchema.parse(clone(debouncedEvent))
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
        details: params.details
      });

      await this.saveAutopilotEventWithClient(client, claimed);
      return {
        outcome: "claimed",
        event: AutopilotEventSchema.parse(clone(claimed))
      };
    });
  }

  async saveAutopilotEvent(event: AutopilotEvent): Promise<AutopilotEvent> {
    const validated = AutopilotEventSchema.parse(event);
    await this.withTransaction((client) => this.saveAutopilotEventWithClient(client, validated));
    return AutopilotEventSchema.parse(clone(validated));
  }

  async listJobs(params?: {
    userId?: string;
    kinds?: JobKind[];
    statuses?: JobStatus[];
  }): Promise<JobRecord[]> {
    await this.ready;
    const values: unknown[] = [];
    const predicates: string[] = [];

    if (params?.userId) {
      values.push(params.userId);
      predicates.push(`user_id = $${values.length}`);
    }

    if (params?.kinds?.length) {
      values.push(params.kinds.map((kind) => JobKindSchema.parse(kind)));
      predicates.push(`kind = any($${values.length}::text[])`);
    }

    if (params?.statuses?.length) {
      values.push(params.statuses.map((status) => JobStatusSchema.parse(status)));
      predicates.push(`status = any($${values.length}::text[])`);
    }

    const whereClause = predicates.length > 0 ? `where ${predicates.join(" and ")}` : "";
    const result = await this.pool.query(
      `
        select *
        from jobs
        ${whereClause}
        order by created_at desc
      `,
      values
    );

    return result.rows.map((row) => this.mapJobRow(row));
  }

  async getJob(jobId: string, userId = SYSTEM_USER_ID): Promise<JobRecord | null> {
    await this.ready;
    const result = await this.pool.query("select * from jobs where id = $1 and user_id = $2 limit 1", [jobId, userId]);
    return result.rows[0] ? this.mapJobRow(result.rows[0]) : null;
  }

  async enqueueJob(job: JobRecord): Promise<JobRecord> {
    const validated = JobRecordSchema.parse(job);
    const trimmedKey = validated.idempotencyKey?.trim() || null;

    return this.withTransaction(async (client) => {
      if (trimmedKey) {
        await client.query("select pg_advisory_xact_lock(hashtext($1))", [`job:${validated.userId}:${trimmedKey}`]);
        const existing = await client.query(
          `
            select *
            from jobs
            where user_id = $1 and idempotency_key = $2
            limit 1
          `,
          [validated.userId, trimmedKey]
        );

        if (existing.rows[0]) {
          return this.mapJobRow(existing.rows[0]);
        }
      }

      await this.saveJobWithClient(client, {
        ...validated,
        idempotencyKey: trimmedKey
      });
      return JobRecordSchema.parse(
        clone({
          ...validated,
          idempotencyKey: trimmedKey
        })
      );
    });
  }

  async claimNextJob(params: {
    userId?: string;
    kinds?: JobKind[];
    runnerId: string;
    leaseMs: number;
    now?: string;
  }): Promise<JobRecord | null> {
    return this.withTransaction(async (client) => {
      const claimedAt = params.now ?? nowIso();
      const kinds = params.kinds?.map((kind) => JobKindSchema.parse(kind)) ?? [];
      const values: unknown[] = [claimedAt];
      const predicates = [
        `(
          (status in ('queued', 'retrying') and available_at <= $1)
          or (status = 'running' and lease_expires_at is not null and lease_expires_at <= $1)
        )`
      ];

      if (params.userId) {
        values.push(params.userId);
        predicates.push(`user_id = $${values.length}`);
      }

      if (kinds.length > 0) {
        values.push(kinds);
        predicates.push(`kind = any($${values.length}::text[])`);
      }

      const result = await client.query(
        `
          select *
          from jobs
          where ${predicates.join(" and ")}
          order by available_at asc, created_at asc
          limit 1
          for update skip locked
        `,
        values
      );

      if (!result.rows[0]) {
        return null;
      }

      const claimed = claimJobRecord(this.mapJobRow(result.rows[0]), params.runnerId, params.leaseMs, claimedAt);
      await this.saveJobWithClient(client, claimed);
      return JobRecordSchema.parse(clone(claimed));
    });
  }

  async completeJob(params: {
    jobId: string;
    runnerId: string;
    completedAt?: string;
  }): Promise<JobRecord> {
    return this.withTransaction(async (client) => {
      const result = await client.query("select * from jobs where id = $1 limit 1 for update", [params.jobId]);

      if (!result.rows[0]) {
        throw new JobMutationError("not_found", `Job ${params.jobId} does not exist.`);
      }

      const existing = this.mapJobRow(result.rows[0]);
      assertRunningJobOwner(existing, params.runnerId);
      const completedAt = params.completedAt ?? nowIso();
      const completed = JobRecordSchema.parse({
        ...existing,
        status: "completed",
        leaseExpiresAt: null,
        completedAt,
        updatedAt: completedAt
      });
      await this.saveJobWithClient(client, completed);
      return JobRecordSchema.parse(clone(completed));
    });
  }

  async retryJob(params: {
    jobId: string;
    runnerId: string;
    availableAt: string;
    error: string;
  }): Promise<JobRecord> {
    return this.withTransaction(async (client) => {
      const result = await client.query("select * from jobs where id = $1 limit 1 for update", [params.jobId]);

      if (!result.rows[0]) {
        throw new JobMutationError("not_found", `Job ${params.jobId} does not exist.`);
      }

      const existing = this.mapJobRow(result.rows[0]);
      assertRunningJobOwner(existing, params.runnerId);
      const retried = JobRecordSchema.parse({
        ...existing,
        status: "retrying",
        claimedBy: null,
        claimedAt: null,
        leaseExpiresAt: null,
        availableAt: params.availableAt,
        lastError: params.error.trim().slice(0, 1000),
        updatedAt: nowIso()
      });
      await this.saveJobWithClient(client, retried);
      return JobRecordSchema.parse(clone(retried));
    });
  }

  async deadLetterJob(params: {
    jobId: string;
    runnerId: string;
    deadLetteredAt?: string;
    error: string;
  }): Promise<JobRecord> {
    return this.withTransaction(async (client) => {
      const result = await client.query("select * from jobs where id = $1 limit 1 for update", [params.jobId]);

      if (!result.rows[0]) {
        throw new JobMutationError("not_found", `Job ${params.jobId} does not exist.`);
      }

      const existing = this.mapJobRow(result.rows[0]);
      assertRunningJobOwner(existing, params.runnerId);
      const deadLetteredAt = params.deadLetteredAt ?? nowIso();
      const deadLettered = JobRecordSchema.parse({
        ...existing,
        status: "dead_letter",
        leaseExpiresAt: null,
        deadLetteredAt,
        lastError: params.error.trim().slice(0, 1000),
        updatedAt: deadLetteredAt
      });
      await this.saveJobWithClient(client, deadLettered);
      return JobRecordSchema.parse(clone(deadLettered));
    });
  }

  async listMemory(userId = SYSTEM_USER_ID): Promise<MemoryRecord[]> {
    await this.ready;
    const result = await this.pool.query("select * from memory_records where user_id = $1 order by created_at desc, id desc", [userId]);

    return result.rows.map((row) =>
      MemoryRecordSchema.parse({
        id: row.id,
        userId: row.user_id,
        category: row.category,
        memoryType: row.memory_type,
        content: row.content,
        confidence: Number(row.confidence),
        source: row.source,
        sensitivity: row.sensitivity,
        permissions: row.permissions ?? [],
        actorContext: row.actor_context ? ActorContextSchema.parse(row.actor_context) : null,
        reviewAt: row.review_at ? new Date(row.review_at).toISOString() : null,
        expiryAt: row.expiry_at ? new Date(row.expiry_at).toISOString() : null,
        createdAt: new Date(row.created_at).toISOString(),
        updatedAt: new Date(row.updated_at).toISOString()
      })
    );
  }

  async listMemoryPage(params?: CollectionPageParams): Promise<MemoryRecordPage> {
    await this.ready;
    const userId = params?.userId ?? SYSTEM_USER_ID;
    const limit = normalizeCollectionPageLimit(params?.limit);
    const cursor = decodeCollectionCursor(params?.cursor ?? null);
    const values: unknown[] = [userId];
    let cursorClause = "";

    if (cursor) {
      values.push(cursor.createdAt, cursor.id);
      const createdAtIndex = values.length - 1;
      const idIndex = values.length;
      cursorClause = ` and (created_at < $${createdAtIndex} or (created_at = $${createdAtIndex} and id < $${idIndex}))`;
    }

    values.push(limit + 1);
    const limitIndex = values.length;
    const result = await this.pool.query(
      `
        select *
        from memory_records
        where user_id = $1${cursorClause}
        order by created_at desc, id desc
        limit $${limitIndex}
      `,
      values
    );
    const items = result.rows.slice(0, limit).map((row) =>
      MemoryRecordSchema.parse({
        id: row.id,
        userId: row.user_id,
        category: row.category,
        memoryType: row.memory_type,
        content: row.content,
        confidence: Number(row.confidence),
        source: row.source,
        sensitivity: row.sensitivity,
        permissions: row.permissions ?? [],
        actorContext: row.actor_context ? ActorContextSchema.parse(row.actor_context) : null,
        reviewAt: row.review_at ? new Date(row.review_at).toISOString() : null,
        expiryAt: row.expiry_at ? new Date(row.expiry_at).toISOString() : null,
        createdAt: new Date(row.created_at).toISOString(),
        updatedAt: new Date(row.updated_at).toISOString()
      })
    );
    const last = items.at(-1);

    return MemoryRecordPageSchema.parse({
      items,
      nextCursor:
        result.rows.length > limit && last
          ? encodeCollectionCursor({
              createdAt: last.createdAt,
              id: last.id
            })
          : null
    });
  }

  async saveMemory(record: MemoryRecord): Promise<MemoryRecord> {
    await this.withTransaction((client) => this.saveMemoryWithClient(client, record));
    return MemoryRecordSchema.parse(clone(record));
  }

  async saveEvidenceRecord(record: EvidenceRecord): Promise<EvidenceRecord> {
    const validated = EvidenceRecordSchema.parse(record);

    await this.withTransaction(async (client) => {
      const goalResult = await client.query(
        `
          select g.id
          from goals g
          left join workspace_members wm on wm.workspace_id = g.workspace_id and wm.user_id = $2
          where g.id = $1
            and (
              (g.workspace_id is null and g.user_id = $2)
              or wm.user_id is not null
            )
          limit 1
        `,
        [validated.goalId, validated.userId]
      );

      if (Number(goalResult.rowCount ?? 0) === 0) {
        throw new Error(`User ${validated.userId} cannot persist evidence for goal ${validated.goalId}.`);
      }

      await this.saveEvidenceRecordWithClient(client, validated);
    });

    return EvidenceRecordSchema.parse(clone(validated));
  }

  async listWatchers(filters?: WatcherListFilters): Promise<Watcher[]> {
    await this.ready;
    const userId = filters?.userId ?? SYSTEM_USER_ID;
    const values: string[] = [userId];
    let goalClause = "";

    if (filters?.goalId) {
      values.push(filters.goalId);
      goalClause = " and w.goal_id = $2";
    }

    const result = await this.pool.query(
      `
        select w.*
        from watchers w
        join goals g on g.id = w.goal_id
        left join workspace_members wm on wm.workspace_id = g.workspace_id and wm.user_id = $1
        where (
          (g.workspace_id is null and g.user_id = $1)
          or wm.user_id is not null
        )${goalClause}
        order by w.created_at desc, w.id desc
      `,
      values
    );

    return result.rows.map((row) =>
      WatcherSchema.parse({
        id: row.id,
        goalId: row.goal_id,
        targetEntity: row.target_entity,
        condition: row.condition,
        frequency: row.frequency,
        triggerAction: row.trigger_action,
        sourceSystems: row.source_systems ?? [],
        status: row.status,
        expiryAt: row.expiry_at ? new Date(row.expiry_at).toISOString() : null,
        actorContext: row.actor_context ? ActorContextSchema.parse(row.actor_context) : null,
        createdAt: new Date(row.created_at).toISOString(),
        updatedAt: new Date(row.updated_at).toISOString()
      })
    );
  }

  async listWatchersPage(params?: WatcherPageParams): Promise<WatcherPage> {
    await this.ready;
    const userId = params?.userId ?? SYSTEM_USER_ID;
    const limit = normalizeCollectionPageLimit(params?.limit);
    const cursor = decodeCollectionCursor(params?.cursor ?? null);
    const values: unknown[] = [userId];
    const predicates = [
      `(
        (g.workspace_id is null and g.user_id = $1)
        or wm.user_id is not null
      )`
    ];

    if (params?.goalId) {
      values.push(params.goalId);
      predicates.push(`w.goal_id = $${values.length}`);
    }

    if (cursor) {
      values.push(cursor.createdAt, cursor.id);
      const createdAtIndex = values.length - 1;
      const idIndex = values.length;
      predicates.push(`(w.created_at < $${createdAtIndex} or (w.created_at = $${createdAtIndex} and w.id < $${idIndex}))`);
    }

    values.push(limit + 1);
    const limitIndex = values.length;
    const result = await this.pool.query(
      `
        select w.*
        from watchers w
        join goals g on g.id = w.goal_id
        left join workspace_members wm on wm.workspace_id = g.workspace_id and wm.user_id = $1
        where ${predicates.join(" and ")}
        order by w.created_at desc, w.id desc
        limit $${limitIndex}
      `,
      values
    );
    const items = result.rows.slice(0, limit).map((row) => this.mapWatcherRow(row));
    const last = items.at(-1);

    return WatcherPageSchema.parse({
      items,
      nextCursor:
        result.rows.length > limit && last
          ? encodeCollectionCursor({
              createdAt: last.createdAt,
              id: last.id
            })
          : null
    });
  }

  async saveWatcher(watcher: Watcher): Promise<Watcher> {
    const validated = WatcherSchema.parse(watcher);

    await this.withTransaction(async (client) => {
      const goalResult = await client.query("select 1 from goals where id = $1 limit 1", [validated.goalId]);

      if (Number(goalResult.rowCount ?? 0) === 0) {
        throw new Error(`Goal ${validated.goalId} was not found.`);
      }

      await client.query(
        `
          insert into watchers (
            id, goal_id, target_entity, condition, frequency, trigger_action, source_systems, status, expiry_at, actor_context, created_at, updated_at
          )
          values ($1, $2, $3, $4, $5, $6, $7::jsonb, $8, $9, $10::jsonb, $11, $12)
          on conflict (id) do update
          set goal_id = excluded.goal_id,
              target_entity = excluded.target_entity,
              condition = excluded.condition,
              frequency = excluded.frequency,
              trigger_action = excluded.trigger_action,
              source_systems = excluded.source_systems,
              status = excluded.status,
              expiry_at = excluded.expiry_at,
              actor_context = excluded.actor_context,
              updated_at = excluded.updated_at
        `,
        [
          validated.id,
          validated.goalId,
          validated.targetEntity,
          validated.condition,
          validated.frequency,
          validated.triggerAction,
          JSON.stringify(validated.sourceSystems),
          validated.status,
          validated.expiryAt,
          JSON.stringify(validated.actorContext),
          validated.createdAt,
          validated.updatedAt
        ]
      );
    });

    return WatcherSchema.parse(clone(validated));
  }

  async listIntegrations(userId = SYSTEM_USER_ID): Promise<IntegrationAccount[]> {
    await this.ready;
    const result = await this.pool.query("select * from integration_accounts where user_id = $1 order by created_at desc, id desc", [userId]);

    return result.rows.map((row) =>
      IntegrationAccountSchema.parse({
        id: row.id,
        userId: row.user_id,
        name: row.name,
        system: row.system,
        status: row.status,
        scopes: row.scopes ?? [],
        capabilities: row.capabilities ?? [],
        metadata: row.metadata ?? {},
        actorContext: row.actor_context ? ActorContextSchema.parse(row.actor_context) : null,
        createdAt: new Date(row.created_at).toISOString(),
        updatedAt: new Date(row.updated_at).toISOString()
      })
    );
  }

  async listIntegrationsPage(params?: CollectionPageParams): Promise<IntegrationAccountPage> {
    await this.ready;
    const userId = params?.userId ?? SYSTEM_USER_ID;
    const limit = normalizeCollectionPageLimit(params?.limit);
    const cursor = decodeCollectionCursor(params?.cursor ?? null);
    const values: unknown[] = [userId];
    let cursorClause = "";

    if (cursor) {
      values.push(cursor.createdAt, cursor.id);
      const createdAtIndex = values.length - 1;
      const idIndex = values.length;
      cursorClause = ` and (created_at < $${createdAtIndex} or (created_at = $${createdAtIndex} and id < $${idIndex}))`;
    }

    values.push(limit + 1);
    const limitIndex = values.length;
    const result = await this.pool.query(
      `
        select *
        from integration_accounts
        where user_id = $1${cursorClause}
        order by created_at desc, id desc
        limit $${limitIndex}
      `,
      values
    );
    const items = result.rows.slice(0, limit).map((row) =>
      IntegrationAccountSchema.parse({
        id: row.id,
        userId: row.user_id,
        name: row.name,
        system: row.system,
        status: row.status,
        scopes: row.scopes ?? [],
        capabilities: row.capabilities ?? [],
        metadata: row.metadata ?? {},
        actorContext: row.actor_context ? ActorContextSchema.parse(row.actor_context) : null,
        createdAt: new Date(row.created_at).toISOString(),
        updatedAt: new Date(row.updated_at).toISOString()
      })
    );
    const last = items.at(-1);

    return IntegrationAccountPageSchema.parse({
      items,
      nextCursor:
        result.rows.length > limit && last
          ? encodeCollectionCursor({
              createdAt: last.createdAt,
              id: last.id
            })
          : null
    });
  }

  async upsertIntegration(account: IntegrationAccount): Promise<IntegrationAccount> {
    await this.withTransaction((client) => this.saveIntegrationWithClient(client, account));
    return IntegrationAccountSchema.parse(clone(account));
  }

  async listProviderCredentials(userId = SYSTEM_USER_ID): Promise<ProviderCredential[]> {
    await this.ready;
    const result = await this.pool.query(
      "select * from provider_credentials where user_id = $1 order by updated_at desc, created_at desc",
      [userId]
    );

    return result.rows.map((row) =>
      ProviderCredentialSchema.parse({
        id: row.id,
        userId: row.user_id,
        workspaceId: row.workspace_id,
        provider: row.provider,
        accountId: row.account_id,
        accountEmail: row.account_email,
        displayName: row.display_name,
        status: row.status,
        scopes: row.scopes ?? [],
        lastValidatedAt: row.last_validated_at ? new Date(row.last_validated_at).toISOString() : null,
        lastRotatedAt: row.last_rotated_at ? new Date(row.last_rotated_at).toISOString() : null,
        lastRefreshAt: row.last_refresh_at ? new Date(row.last_refresh_at).toISOString() : null,
        lastRefreshFailureAt: row.last_refresh_failure_at ? new Date(row.last_refresh_failure_at).toISOString() : null,
        reconnectRequiredAt: row.reconnect_required_at ? new Date(row.reconnect_required_at).toISOString() : null,
        revokedAt: row.revoked_at ? new Date(row.revoked_at).toISOString() : null,
        expiresAt: row.expires_at ? new Date(row.expires_at).toISOString() : null,
        metadata: row.metadata ?? {},
        actorContext: row.actor_context ? ActorContextSchema.parse(row.actor_context) : null,
        createdAt: new Date(row.created_at).toISOString(),
        updatedAt: new Date(row.updated_at).toISOString()
      })
    );
  }

  async getProviderCredential(credentialId: string, userId = SYSTEM_USER_ID): Promise<ProviderCredential | null> {
    await this.ready;
    const result = await this.pool.query("select * from provider_credentials where user_id = $1 and id = $2 limit 1", [
      userId,
      credentialId
    ]);
    const row = result.rows[0];

    if (!row) {
      return null;
    }

    return ProviderCredentialSchema.parse({
      id: row.id,
      userId: row.user_id,
      workspaceId: row.workspace_id,
      provider: row.provider,
      accountId: row.account_id,
      accountEmail: row.account_email,
      displayName: row.display_name,
      status: row.status,
      scopes: row.scopes ?? [],
      lastValidatedAt: row.last_validated_at ? new Date(row.last_validated_at).toISOString() : null,
      lastRotatedAt: row.last_rotated_at ? new Date(row.last_rotated_at).toISOString() : null,
      lastRefreshAt: row.last_refresh_at ? new Date(row.last_refresh_at).toISOString() : null,
      lastRefreshFailureAt: row.last_refresh_failure_at ? new Date(row.last_refresh_failure_at).toISOString() : null,
      reconnectRequiredAt: row.reconnect_required_at ? new Date(row.reconnect_required_at).toISOString() : null,
      revokedAt: row.revoked_at ? new Date(row.revoked_at).toISOString() : null,
      expiresAt: row.expires_at ? new Date(row.expires_at).toISOString() : null,
      metadata: row.metadata ?? {},
      actorContext: row.actor_context ? ActorContextSchema.parse(row.actor_context) : null,
      createdAt: new Date(row.created_at).toISOString(),
      updatedAt: new Date(row.updated_at).toISOString()
    });
  }

  async saveProviderCredential(credential: ProviderCredential): Promise<ProviderCredential> {
    const validated = ProviderCredentialSchema.parse(credential);
    await this.withTransaction(async (client) => {
      await this.saveProviderCredentialWithClient(client, validated);
      const existingIntegrations = await client.query("select * from integration_accounts where user_id = $1", [validated.userId]);
      const managedIntegrations = syncGoogleManagedIntegrations(
        existingIntegrations.rows.map((row) =>
          IntegrationAccountSchema.parse({
            id: row.id,
            userId: row.user_id,
            name: row.name,
            system: row.system,
            status: row.status,
            scopes: row.scopes ?? [],
            capabilities: row.capabilities ?? [],
            metadata: row.metadata ?? {},
            actorContext: row.actor_context ? ActorContextSchema.parse(row.actor_context) : null,
            createdAt: new Date(row.created_at).toISOString(),
            updatedAt: new Date(row.updated_at).toISOString()
          })
        ),
        validated
      ).filter((integration) => integration.userId === validated.userId && GOOGLE_MANAGED_INTEGRATION_IDS.includes(integration.id as (typeof GOOGLE_MANAGED_INTEGRATION_IDS)[number]));

      for (const integration of managedIntegrations) {
        await this.saveIntegrationWithClient(client, integration);
      }
    });
    return ProviderCredentialSchema.parse(clone(validated));
  }

  async getProviderCredentialSecret(
    credentialId: string,
    kind: ProviderCredentialSecretKind,
    userId = SYSTEM_USER_ID
  ): Promise<ProviderCredentialSecretRecord | null> {
    await this.ready;
    const result = await this.pool.query(
      "select * from provider_credential_secrets where user_id = $1 and credential_id = $2 and kind = $3 limit 1",
      [userId, credentialId, kind]
    );
    const row = result.rows[0];

    if (!row) {
      return null;
    }

    return ProviderCredentialSecretRecordSchema.parse({
      credentialId: row.credential_id,
      userId: row.user_id,
      kind: row.kind,
      secret: EncryptedSecretEnvelopeSchema.parse(row.secret),
      createdAt: new Date(row.created_at).toISOString(),
      updatedAt: new Date(row.updated_at).toISOString()
    });
  }

  async saveProviderCredentialSecret(record: ProviderCredentialSecretRecord): Promise<ProviderCredentialSecretRecord> {
    const validated = ProviderCredentialSecretRecordSchema.parse(record);
    await this.withTransaction(async (client) => {
      const credential = await client.query("select 1 from provider_credentials where user_id = $1 and id = $2 limit 1", [
        validated.userId,
        validated.credentialId
      ]);

      if (credential.rowCount === 0) {
        throw new Error(`Provider credential ${validated.credentialId} was not found for user ${validated.userId}.`);
      }

      await this.saveProviderCredentialSecretWithClient(client, validated);
    });
    return ProviderCredentialSecretRecordSchema.parse(clone(validated));
  }

  async listTemplates(userId = SYSTEM_USER_ID): Promise<GoalTemplate[]> {
    await this.ready;
    const result = await this.pool.query(
      "select * from goal_templates where user_id = $1 order by created_at desc",
      [userId]
    );

    return result.rows.map((row) => this.mapTemplateRow(row));
  }

  async saveTemplate(template: GoalTemplate): Promise<GoalTemplate> {
    const validated = GoalTemplateSchema.parse(template);
    await this.withTransaction((client) => this.saveTemplateWithClient(client, validated));
    return GoalTemplateSchema.parse(clone(validated));
  }

  async deleteTemplate(templateId: string): Promise<void> {
    await this.withTransaction(async (client) => {
      await client.query("delete from goal_templates where id = $1", [templateId]);
    });
  }

  async listWorkflowTemplates(userId = SYSTEM_USER_ID): Promise<WorkflowCanvasTemplate[]> {
    await this.ready;
    const result = await this.pool.query(
      "select * from workflow_templates where user_id = $1 order by updated_at desc, created_at desc",
      [userId]
    );

    return result.rows.map((row) => this.mapWorkflowTemplateRow(row));
  }

  async getWorkflowTemplate(templateId: string, userId = SYSTEM_USER_ID): Promise<WorkflowCanvasTemplate | null> {
    await this.ready;
    const result = await this.pool.query(
      "select * from workflow_templates where id = $1 and user_id = $2 limit 1",
      [templateId, userId]
    );
    return result.rows[0] ? this.mapWorkflowTemplateRow(result.rows[0]) : null;
  }

  async saveWorkflowTemplate(template: WorkflowCanvasTemplate): Promise<WorkflowCanvasTemplate> {
    const validated = WorkflowCanvasTemplateSchema.parse(template);
    await this.withTransaction((client) => this.saveWorkflowTemplateWithClient(client, validated));
    return WorkflowCanvasTemplateSchema.parse(clone(validated));
  }

  async deleteWorkflowTemplate(templateId: string, userId = SYSTEM_USER_ID): Promise<void> {
    await this.withTransaction(async (client) => {
      await client.query("delete from workflow_templates where id = $1 and user_id = $2", [templateId, userId]);
    });
  }

  async listOperatorProducts(userId = SYSTEM_USER_ID): Promise<OperatorProduct[]> {
    await this.ready;
    const result = await this.pool.query(
      `
        select *
        from operator_products
        where user_id = $1 or is_built_in = true
        order by is_built_in desc, created_at asc
      `,
      [userId]
    );
    const merged = uniqueById([
      ...defaultOperatorProducts(userId),
      ...result.rows.map((row) => this.mapOperatorProductRow(row))
    ]);

    return merged.map((product) => OperatorProductSchema.parse(clone(product)));
  }

  async getOperatorProductSelection(userId = SYSTEM_USER_ID): Promise<OperatorProductSelection | null> {
    await this.ready;
    const result = await this.pool.query(
      `
        select *
        from operator_product_selections
        where user_id = $1
        limit 1
      `,
      [userId]
    );

    if (Number(result.rowCount ?? 0) === 0) {
      return null;
    }

    return this.mapOperatorProductSelectionRow(result.rows[0]);
  }

  async saveOperatorProduct(product: OperatorProduct): Promise<OperatorProduct> {
    const validated = OperatorProductSchema.parse(product);
    await this.withTransaction((client) => this.saveOperatorProductWithClient(client, validated));
    return OperatorProductSchema.parse(clone(validated));
  }

  async saveOperatorProductSelection(selection: OperatorProductSelection): Promise<OperatorProductSelection> {
    const validated = OperatorProductSelectionSchema.parse(selection);
    await this.withTransaction(async (client) => {
      const productResult = await client.query(
        `
          select 1
          from operator_products
          where id = $1 and (user_id = $2 or is_built_in = true)
          limit 1
        `,
        [validated.operatorProductId, validated.userId]
      );

      if (Number(productResult.rowCount ?? 0) === 0) {
        throw new Error(`Operator product ${validated.operatorProductId} was not found.`);
      }

      await this.saveOperatorProductSelectionWithClient(client, validated);
    });

    return OperatorProductSelectionSchema.parse(clone(validated));
  }

  async listAgents(userId = SYSTEM_USER_ID): Promise<AgentDefinition[]> {
    await this.ready;
    const result = await this.pool.query(
      `
        select *
        from agent_definitions
        where user_id = $1 or is_built_in = true
        order by is_built_in desc, created_at asc
      `,
      [userId]
    );
    const merged = uniqueById([
      ...defaultAgents(userId),
      ...result.rows.map((row) => this.mapAgentRow(row))
    ]);

    return merged.map((agent) => AgentDefinitionSchema.parse(clone(agent)));
  }

  async getAgent(agentId: string, userId = SYSTEM_USER_ID): Promise<AgentDefinition | null> {
    const agents = await this.listAgents(userId);
    const agent = resolveAgentFromDefinitions(agents, agentId, userId);
    return agent ? AgentDefinitionSchema.parse(clone(agent)) : null;
  }

  async saveAgent(agent: AgentDefinition): Promise<AgentDefinition> {
    const validated = AgentDefinitionSchema.parse(agent);
    await this.withTransaction((client) => this.saveAgentWithClient(client, validated));
    return AgentDefinitionSchema.parse(clone(validated));
  }

  async deleteAgent(agentId: string, userId = SYSTEM_USER_ID): Promise<void> {
    const agent = await this.getAgent(agentId, userId);

    if (agent?.isBuiltIn) {
      throw new Error("Cannot delete a built-in agent");
    }

    if (!agent) {
      return;
    }

    await this.withTransaction(async (client) => {
      await client.query("delete from agent_metrics where agent_id = $1", [agent.id]);
      await client.query("delete from agent_definitions where id = $1", [agent.id]);
    });
  }

  async getAgentMetrics(
    agentId: string,
    period: "day" | "week" | "month" | "all" = "all",
    userId = SYSTEM_USER_ID
  ): Promise<AgentMetrics | null> {
    const agent = await this.getAgent(agentId, userId);

    if (!agent) {
      return null;
    }

    const [goals, storedMetrics] = await Promise.all([
      this.listGoals(agent.userId),
      this.withTransaction(async (client) => {
        const result = await client.query(
          "select * from agent_metrics where agent_id = $1 and period = $2 limit 1",
          [agent.id, period]
        );
        return result.rows[0] ? this.mapAgentMetricsRow(result.rows[0]) : null;
      })
    ]);
    const evidenceRecords = await this.listEvidenceRecords({ userId: agent.userId });

    return AgentMetricsSchema.parse(
      clone(
        deriveAgentMetricsFromGoals({
          agent,
          period,
          goals,
          evidenceRecords,
          storedMetrics
        })
      )
    );
  }

  async saveAgentMetrics(metrics: AgentMetrics): Promise<AgentMetrics> {
    const validated = AgentMetricsSchema.parse(metrics);
    await this.withTransaction((client) => this.saveAgentMetricsWithClient(client, validated));
    return AgentMetricsSchema.parse(clone(validated));
  }

  async getDashboardData(userId = SYSTEM_USER_ID): Promise<DashboardData> {
    const [
      commitments,
      briefingPreferences,
      autopilotSettings,
      autopilotEventsPage,
      memoryPage,
      integrationsPage
    ] = await Promise.all([
      this.listCommitments(userId),
      this.getBriefingPreferences(userId),
      this.getAutopilotSettings(userId),
      this.listAutopilotEventsPage({ userId, limit: DASHBOARD_AUTOPILOT_EVENT_LIMIT }),
      this.listMemoryPage({ userId, limit: DASHBOARD_MEMORY_LIMIT }),
      this.listIntegrationsPage({ userId, limit: DASHBOARD_INTEGRATION_LIMIT })
    ]);
    const client = await this.pool.connect();
    let activeWorkspace: Workspace | null = null;
    let workspaceSelection: WorkspaceSelection | null = null;
    let workspaceMembers: WorkspaceMember[] = [];
    let workspaceGovernance: WorkspaceGovernance | null = null;
    let goalShares: GoalShareRecord[] = [];
    let privacyOperations: PrivacyOperation[] = [];
    let workspaces: Workspace[] = [];
    let goals: GoalBundle[] = [];
    let approvals: ApprovalRequest[] = [];
    let evidenceRecords: EvidenceRecord[] = [];
    let watchers: Watcher[] = [];

    try {
      const resolved = await this.resolveActiveWorkspaceWithClient(client, userId);
      workspaces = resolved.workspaces;
      activeWorkspace = resolved.activeWorkspace;
      workspaceSelection = resolved.workspaceSelection;
      goalShares = await this.listGoalSharesWithClient(client, { userId });
      goals = await this.listDashboardGoalBundlesWithClient(client, {
        userId,
        activeWorkspace,
        limit: DASHBOARD_GOAL_LIMIT
      });
      approvals = sortByCreatedDesc(goals.flatMap((bundle) => bundle.approvals));
      watchers = sortByCreatedDesc(goals.flatMap((bundle) => bundle.watchers));
      evidenceRecords =
        goals.length > 0
          ? await this.listEvidenceRecordsForGoalIdsWithClient(client, {
              userId,
              goalIds: goals.map((bundle) => bundle.goal.id)
            })
          : [];

      if (activeWorkspace) {
        [workspaceMembers, workspaceGovernance, privacyOperations] = await Promise.all([
          this.listWorkspaceMembersForWorkspaceWithClient(client, activeWorkspace.id),
          this.getWorkspaceGovernanceWithClient(client, activeWorkspace.id),
          this.listPrivacyOperationsWithClient(client, {
            userId,
            workspaceId: activeWorkspace.id
          })
        ]);
      }
    } finally {
      client.release();
    }

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
      filterBundlesForWorkspace,
      mergeCommitments,
      buildDiagnostics: buildDashboardDiagnostics,
      buildControlPlane: buildDashboardControlPlane,
      buildNowQueue,
      buildOperatingSections: buildDashboardOperatingSections,
      buildBriefingHistory,
      sortArtifacts: sortByCreatedDesc,
      sortActionLogs: sortByCreatedDesc
    });
  }
}

export function createRepository(options?: { storePath?: string; databaseUrl?: string }): AgenticRepository {
  const databaseUrl = options?.databaseUrl ?? process.env.DATABASE_URL;

  if (databaseUrl) {
    return new PostgresRepository(databaseUrl, {
      autoMigrate: shouldAutoMigratePostgresSchema()
    });
  }

  if (process.env.NODE_ENV === "production") {
    throw new Error(
      "DATABASE_URL must be configured in production. The file-backed repository is development-only."
    );
  }

  return new FileRepository(options?.storePath);
}

function shouldAutoMigratePostgresSchema(): boolean {
  const configured = process.env.AGENTIC_AUTO_MIGRATE?.trim().toLowerCase();

  if (configured === "true") {
    return true;
  }

  if (configured === "false") {
    return false;
  }

  return process.env.NODE_ENV === "test";
}
