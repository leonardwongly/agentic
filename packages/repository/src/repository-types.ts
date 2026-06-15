import type {
  ActionLog,
  AgentDefinition,
  AgentName,
  AgentMetrics,
  ActorContext,
  ApprovalDecision,
  ApprovalDecisionScope,
  ApprovalRequest,
  Artifact,
  AutopilotEvent,
  AutopilotEventKind,
  AutopilotEventPage,
  AutopilotMode,
  AutopilotSettings,
  BriefingHistoryItem,
  BriefingPreferences,
  Commitment,
  CommitmentInboxBucket,
  CommitmentInboxPage,
  DashboardOperatingSections,
  EvidenceRecord,
  GoalBundle,
  GoalBundlePage,
  GoalShareRecord,
  GoalShareStatus,
  GoalTemplate,
  IntegrationAccount,
  IntegrationAccountPage,
  JobKind,
  JobRecord,
  JobStatus,
  MemoryRecord,
  MemoryRecordPage,
  NowQueue,
  OperatorProduct,
  OperatorProductSelection,
  PrivacyOperation,
  PrivacyOperationKind,
  PrivacyOperationStatus,
  ProviderCredential,
  ProviderCredentialSecretKind,
  ProviderCredentialSecretRecord,
  ProviderSideEffectRecord,
  ProviderSideEffectStatus,
  RiskClass,
  Watcher,
  WatcherPage,
  WorkerRuntimeHealthSnapshot,
  WorkflowCanvasTemplate,
  Workspace,
  WorkspaceGovernance,
  WorkspaceMember,
  WorkspaceSelection
} from "@agentic/contracts";
import type { JobConcurrencyLimits as ExecutionJobConcurrencyLimits } from "@agentic/execution";
import type { GovernanceConformanceReport } from "@agentic/policy";
import type { DashboardCockpitRollout } from "./dashboard-cockpit-rollout";
import type { DashboardOperationsTower } from "./dashboard-operations";
import type { DashboardTraceability } from "./dashboard-traceability";
import type { WatcherLeaseClaimParams } from "./watcher-lease-helpers";

export type JobConcurrencyLimits = ExecutionJobConcurrencyLimits;

export type JobReadinessSummary = {
  queuedJobs: number;
  retryingJobs: number;
  runningJobs: number;
  deadLetterJobs: number;
  expiredLeases: number;
  stalePendingJobs: number;
  oldestPendingJobAgeMs: number | null;
};

export type ProviderCredentialReadinessSummary = {
  totalCredentials: number;
  connectedCredentials: number;
  degradedCredentials: number;
  reconnectRequiredCredentials: number;
  refreshFailedCredentials: number;
  revokedCredentials: number;
  expiredCredentials: number;
  validationStaleCredentials: number;
};

export type DashboardData = {
  workspaces: Workspace[];
  activeWorkspace: Workspace | null;
  workspaceSelection: WorkspaceSelection | null;
  workspaceMembers: WorkspaceMember[];
  workspaceGovernance: WorkspaceGovernance | null;
  governanceConformance?: GovernanceConformanceReport | null;
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
  traceability: DashboardTraceability;
  cockpitRollout: DashboardCockpitRollout;
  operations?: DashboardOperationsTower;
};

export type DashboardDiagnosticKind =
  | "expired_approvals"
  | "stale_memories"
  | "context_conflicts"
  | "stuck_workflows"
  | "orphan_watchers"
  | "async_execution_issues"
  | "connector_degradation";

export type DashboardDiagnosticSeverity = "warning" | "critical";

export type DashboardDiagnosticSection =
  | "goals"
  | "approvals"
  | "memory"
  | "watchers"
  | "operations";

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

export type DashboardCollectionSort =
  | "created_desc"
  | "created_asc"
  | "updated_desc"
  | "updated_asc"
  | "title_asc"
  | "title_desc";

export type DashboardCollectionPage<TItem> = {
  items: TItem[];
  totalCount: number;
  limit: number;
  nextCursor: string | null;
  generatedAt: string;
};

export type DashboardCollectionPageParams = CollectionPageParams & {
  q?: string;
  sort?: DashboardCollectionSort;
  status?: string;
  riskClass?: RiskClass;
  bucket?: CommitmentInboxBucket;
  kind?: string;
  kinds?: JobKind[];
  statuses?: JobStatus[];
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

export type ReserveProviderSideEffectParams = {
  userId: string;
  workspaceId?: string | null;
  goalId: string;
  taskId: string;
  adapter: ProviderSideEffectRecord["adapter"];
  operation: ProviderSideEffectRecord["operation"];
  idempotencyKey: string;
  sideEffectTarget: string;
  metadata?: Record<string, unknown>;
  now?: string;
};

export type UpdateProviderSideEffectParams = {
  id: string;
  status: Exclude<ProviderSideEffectStatus, "reserved">;
  providerRef?: string | null;
  detail?: string | null;
  error?: string | null;
  metadata?: Record<string, unknown>;
  now?: string;
};

export type AutopilotEventClaim =
  | {
      outcome: "ignored";
      event: AutopilotEvent;
    }
  | {
      outcome: "claimed";
      event: AutopilotEvent;
    }
  | {
      outcome: "duplicate" | "debounced" | "suppressed";
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
    public readonly code: "not_found" | "already_handled" | "expired" | "forbidden",
    message: string
  ) {
    super(message);
    this.name = "ApprovalMutationError";
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
  appendGoalActionLogs(goalId: string, logs: ActionLog[]): Promise<ActionLog[]>;
  respondToApproval(params: {
    approvalId: string;
    decision: Exclude<ApprovalDecision, "pending">;
    actor: ActorContext;
    scope?: ApprovalDecisionScope;
    rationale?: string | null;
  }): Promise<GoalBundle>;
  respondToApprovalAndEnqueueJob?(params: {
    approvalId: string;
    decision: Exclude<ApprovalDecision, "pending">;
    actor: ActorContext;
    scope?: ApprovalDecisionScope;
    rationale?: string | null;
    buildJob: (bundle: GoalBundle) => JobRecord;
  }): Promise<{ bundle: GoalBundle; job: JobRecord }>;
  getGoalBundle(goalId: string): Promise<GoalBundle | null>;
  getGoalBundleForUser(goalId: string, userId?: string): Promise<GoalBundle | null>;
  listGoals(userId?: string): Promise<GoalBundle[]>;
  listGoalsPage(params?: GoalPageParams): Promise<GoalBundlePage>;
  listApprovals(userId?: string): Promise<ApprovalRequest[]>;
  listEvidenceRecords(params?: {
    userId?: string;
    goalId?: string;
    approvalId?: string;
    limit?: number;
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
    reliabilityControls?: AutopilotSettings["reliabilityControls"];
  }): Promise<AutopilotEventClaim>;
  saveAutopilotEvent(event: AutopilotEvent): Promise<AutopilotEvent>;
  listJobs(params?: {
    userId?: string;
    kinds?: JobKind[];
    statuses?: JobStatus[];
    limit?: number;
  }): Promise<JobRecord[]>;
  getJobReadinessSummary(params?: {
    now?: string;
    maxPendingJobAgeMs?: number;
  }): Promise<JobReadinessSummary>;
  getJob(jobId: string, userId?: string): Promise<JobRecord | null>;
  enqueueJob(job: JobRecord): Promise<JobRecord>;
  claimNextJob(params: {
    userId?: string;
    kinds?: JobKind[];
    queue?: string;
    runnerId: string;
    leaseMs: number;
    now?: string;
    concurrencyLimits?: JobConcurrencyLimits;
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
  cancelJobsForGoal(params: {
    goalId: string;
    userId?: string;
    reason?: string;
    now?: string;
  }): Promise<JobRecord[]>;
  listMemory(userId?: string): Promise<MemoryRecord[]>;
  listContextPacketMemory(params: {
    userId: string;
    agent?: AgentName;
    agentId?: string;
    includeExpired?: boolean;
    allowedSensitivities?: string[];
    limit?: number;
    now?: number;
  }): Promise<MemoryRecord[]>;
  listMemoryPage(params?: CollectionPageParams): Promise<MemoryRecordPage>;
  saveMemory(record: MemoryRecord): Promise<MemoryRecord>;
  saveEvidenceRecord(record: EvidenceRecord): Promise<EvidenceRecord>;
  listWatchers(filters?: WatcherListFilters): Promise<Watcher[]>;
  listWatchersPage(params?: WatcherPageParams): Promise<WatcherPage>;
  claimWatcherLease(params: WatcherLeaseClaimParams): Promise<Watcher | null>;
  saveWatcher(watcher: Watcher): Promise<Watcher>;
  listIntegrations(userId?: string): Promise<IntegrationAccount[]>;
  listIntegrationsPage(params?: CollectionPageParams): Promise<IntegrationAccountPage>;
  upsertIntegration(account: IntegrationAccount): Promise<IntegrationAccount>;
  listProviderCredentials(userId?: string): Promise<ProviderCredential[]>;
  getProviderCredentialReadinessSummary(params?: {
    userId?: string;
    now?: string;
    validationStaleMs?: number;
  }): Promise<ProviderCredentialReadinessSummary>;
  getProviderCredential(credentialId: string, userId?: string): Promise<ProviderCredential | null>;
  saveProviderCredential(credential: ProviderCredential): Promise<ProviderCredential>;
  getProviderCredentialSecret(
    credentialId: string,
    kind: ProviderCredentialSecretKind,
    userId?: string
  ): Promise<ProviderCredentialSecretRecord | null>;
  saveProviderCredentialSecret(record: ProviderCredentialSecretRecord): Promise<ProviderCredentialSecretRecord>;
  reserveProviderSideEffect(params: ReserveProviderSideEffectParams): Promise<ProviderSideEffectRecord>;
  updateProviderSideEffect(params: UpdateProviderSideEffectParams): Promise<ProviderSideEffectRecord>;
  listTemplates(userId?: string): Promise<GoalTemplate[]>;
  saveTemplate(template: GoalTemplate): Promise<GoalTemplate>;
  deleteTemplate(templateId: string): Promise<void>;
  listWorkflowTemplates(userId?: string): Promise<WorkflowCanvasTemplate[]>;
  getWorkflowTemplate(templateId: string, userId?: string): Promise<WorkflowCanvasTemplate | null>;
  saveWorkflowTemplate(template: WorkflowCanvasTemplate): Promise<WorkflowCanvasTemplate>;
  deleteWorkflowTemplate(templateId: string, userId?: string): Promise<void>;
  getDashboardData(userId?: string): Promise<DashboardData>;
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
  recordWorkerRuntimeHealth(snapshot: WorkerRuntimeHealthSnapshot): Promise<void>;
  getLatestWorkerRuntimeHealth(): Promise<WorkerRuntimeHealthSnapshot | null>;
};

export type RepositoryLifecyclePort = Pick<AgenticRepository, "backend" | "seedDefaults">;

export type QueueRepositoryPort = Pick<
  AgenticRepository,
  "listJobs" | "getJob" | "enqueueJob" | "claimNextJob" | "completeJob" | "retryJob" | "deadLetterJob" | "cancelJobsForGoal"
>;

export type ApprovalQueueRepositoryPort = Pick<
  AgenticRepository,
  "respondToApproval" | "respondToApprovalAndEnqueueJob" | "enqueueJob"
>;

export type DashboardReadRepositoryPort = Pick<AgenticRepository, "getDashboardData">;

export type DashboardCollectionRepositoryPort = Pick<
  AgenticRepository,
  "listGoalsPage" | "listCommitments" | "listJobs" | "listMemoryPage"
>;

export type DashboardEventStreamRepositoryPort = Pick<AgenticRepository, "getDashboardData" | "listJobs">;

export type ReadinessRepositoryPort = Pick<
  AgenticRepository,
  "getJobReadinessSummary" | "getProviderCredentialReadinessSummary" | "getLatestWorkerRuntimeHealth"
>;

export type GovernanceRepositoryPort = Pick<
  AgenticRepository,
  | "listWorkspaces"
  | "saveWorkspace"
  | "listWorkspaceMembers"
  | "saveWorkspaceMember"
  | "getWorkspaceSelection"
  | "saveWorkspaceSelection"
  | "getWorkspaceGovernance"
  | "saveWorkspaceGovernance"
>;

export type GovernanceRouteRepositoryPort = DashboardReadRepositoryPort &
  Pick<AgenticRepository, "getWorkspaceGovernance" | "saveWorkspaceGovernance">;

export type GovernanceSimulationRepositoryPort = DashboardReadRepositoryPort &
  Pick<AgenticRepository, "getWorkspaceGovernance">;

export type WorkspaceRouteRepositoryPort = DashboardReadRepositoryPort &
  Pick<
    AgenticRepository,
    "listWorkspaces" | "saveWorkspace" | "saveWorkspaceMember" | "saveWorkspaceSelection" | "saveWorkspaceGovernance"
  >;

export type CredentialRepositoryPort = Pick<
  AgenticRepository,
  | "listIntegrations"
  | "listIntegrationsPage"
  | "upsertIntegration"
  | "listProviderCredentials"
  | "getProviderCredential"
  | "saveProviderCredential"
  | "getProviderCredentialSecret"
  | "saveProviderCredentialSecret"
  | "reserveProviderSideEffect"
  | "updateProviderSideEffect"
>;

export type MemoryRepositoryPort = Pick<
  AgenticRepository,
  "listMemory" | "listContextPacketMemory" | "listMemoryPage" | "saveMemory" | "saveEvidenceRecord" | "listEvidenceRecords"
>;

export type WatcherRepositoryPort = Pick<
  AgenticRepository,
  "listWatchers" | "listWatchersPage" | "claimWatcherLease" | "saveWatcher" | "claimAutopilotEvent"
>;

export type PrivacyRepositoryPort = Pick<
  AgenticRepository,
  | "listPrivacyOperations"
  | "getPrivacyOperation"
  | "savePrivacyOperation"
  | "enforceWorkspaceRetention"
  | "deleteWorkspaceData"
  | "exportWorkspaceAudit"
>;

export type PrivacyRouteRepositoryPort = DashboardReadRepositoryPort &
  QueueRepositoryPort &
  Pick<AgenticRepository, "listPrivacyOperations" | "savePrivacyOperation">;

export type GovernanceAuditRepositoryPort = DashboardReadRepositoryPort & Pick<AgenticRepository, "exportWorkspaceAudit">;

export type ShareAuditRepositoryPort = Pick<
  AgenticRepository,
  | "listGoalShares"
  | "getGoalShare"
  | "getGoalShareByTokenFingerprint"
  | "saveGoalShare"
  | "getGoalBundle"
  | "saveGoalBundle"
  | "appendGoalActionLogs"
  | "exportWorkspaceAudit"
>;

export type TemplateRepositoryPort = Pick<
  AgenticRepository,
  "listTemplates" | "saveTemplate" | "deleteTemplate" | "listWorkflowTemplates" | "getWorkflowTemplate" | "saveWorkflowTemplate" | "deleteWorkflowTemplate"
>;

export type AgentCatalogRepositoryPort = Pick<
  AgenticRepository,
  "listAgents" | "getAgent" | "saveAgent" | "deleteAgent" | "getAgentMetrics" | "saveAgentMetrics"
>;

export type ProductRepositoryPort = Pick<
  AgenticRepository,
  "listOperatorProducts" | "getOperatorProductSelection" | "saveOperatorProduct" | "saveOperatorProductSelection"
>;

export type WorkerRuntimeRepositoryPort = QueueRepositoryPort &
  ApprovalQueueRepositoryPort &
  DashboardReadRepositoryPort &
  GovernanceRepositoryPort &
  CredentialRepositoryPort &
  MemoryRepositoryPort &
  WatcherRepositoryPort &
  PrivacyRepositoryPort &
  ShareAuditRepositoryPort &
  TemplateRepositoryPort &
  AgentCatalogRepositoryPort &
  Pick<
    AgenticRepository,
    | "getGoalBundleForUser"
    | "listGoals"
    | "listApprovals"
    | "getBriefingPreferences"
    | "listAutopilotEvents"
    | "saveAutopilotEvent"
    | "recordWorkerRuntimeHealth"
  >;
