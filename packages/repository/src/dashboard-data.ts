import type {
  ActionLog,
  Artifact,
  AutopilotEvent,
  AutopilotSettings,
  ApprovalRequest,
  BriefingHistoryItem,
  BriefingPreferences,
  Commitment,
  DashboardOperatingSections,
  EvidenceRecord,
  GoalBundle,
  GoalShareRecord,
  IntegrationAccount,
  JobRecord,
  MemoryRecord,
  NowQueue,
  PrivacyOperation,
  ProviderCredential,
  Watcher,
  Workspace,
  WorkspaceGovernance,
  WorkspaceMember,
  WorkspaceSelection
} from "@agentic/contracts";
import { assessWorkspaceGovernanceConformance } from "@agentic/policy";
import type { DashboardControlPlane, DashboardData, DashboardDiagnostics } from "./index";
import type { DashboardOperationsTower } from "./dashboard-operations";

type AssembleDashboardDataParams = {
  userId: string;
  workspaces: Workspace[];
  activeWorkspace: Workspace | null;
  workspaceSelection: WorkspaceSelection | null;
  workspaceMembers: WorkspaceMember[];
  workspaceGovernance: WorkspaceGovernance | null;
  goalShares: GoalShareRecord[];
  privacyOperations: PrivacyOperation[];
  goals: GoalBundle[];
  approvals: ApprovalRequest[];
  evidenceRecords: EvidenceRecord[];
  commitments: Commitment[];
  briefingPreferences: BriefingPreferences;
  autopilotSettings: AutopilotSettings;
  autopilotEvents: AutopilotEvent[];
  memories: MemoryRecord[];
  integrations: IntegrationAccount[];
  jobs?: JobRecord[];
  providerCredentials?: ProviderCredential[];
  watchers: Watcher[];
  now?: number;
  filterBundlesForWorkspace: (goals: GoalBundle[], activeWorkspace: Workspace | null, userId: string) => GoalBundle[];
  mergeCommitments: (params: {
    goals: GoalBundle[];
    approvals: ApprovalRequest[];
    persisted: Commitment[];
    userId: string;
  }) => Commitment[];
  buildDiagnostics: (params: {
    goals: GoalBundle[];
    approvals: ApprovalRequest[];
    memories: MemoryRecord[];
    watchers: Watcher[];
    operations?: DashboardOperationsTower;
    now?: number;
  }) => DashboardDiagnostics;
  buildControlPlane: (params: {
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
    operations?: DashboardOperationsTower;
  }) => DashboardControlPlane;
  buildNowQueue: (params: {
    commitments: Commitment[];
    diagnostics: DashboardDiagnostics;
    now?: number;
  }) => NowQueue;
  buildOperatingSections: (params: {
    activeWorkspace: Workspace | null;
    workspaceMembers: WorkspaceMember[];
    workspaceGovernance: WorkspaceGovernance | null;
    goals: GoalBundle[];
    approvals: ApprovalRequest[];
    evidenceRecords: EvidenceRecord[];
    commitments: Commitment[];
    nowQueue: NowQueue;
    autopilotSettings: AutopilotSettings;
    autopilotEvents: AutopilotEvent[];
    memories: MemoryRecord[];
    watchers: Watcher[];
    integrations: IntegrationAccount[];
    latestArtifacts: Artifact[];
    actionLogs: ActionLog[];
    diagnostics: DashboardDiagnostics;
    operations?: DashboardOperationsTower;
  }) => DashboardOperatingSections;
  buildOperations?: (params: {
    activeWorkspace: Workspace | null;
    goals: GoalBundle[];
    jobs: JobRecord[];
    providerCredentials: ProviderCredential[];
    generatedAt: string;
  }) => DashboardOperationsTower;
  buildBriefingHistory: (goals: GoalBundle[]) => BriefingHistoryItem[];
  sortArtifacts: (artifacts: Artifact[]) => Artifact[];
  sortActionLogs: (logs: ActionLog[]) => ActionLog[];
};

function readDashboardWarnMs(): number {
  const parsed = Number(process.env.AGENTIC_DASHBOARD_WARN_MS ?? "250");
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 250;
}

function shouldAlwaysLogDashboardTiming(): boolean {
  return process.env.AGENTIC_DASHBOARD_TIMING_LOG === "1";
}

function humanizeSnakeCase(value: string): string {
  return value.replaceAll("_", " ");
}

function formatCount(count: number, singular: string, plural = `${singular}s`): string {
  return `${count} ${count === 1 ? singular : plural}`;
}

function pluralize(count: number, noun: string): string {
  return formatCount(count, noun, noun.endsWith("y") ? `${noun.slice(0, -1)}ies` : `${noun}s`);
}

function buildApprovalImpactSummary(approval: ApprovalRequest): string {
  if (approval.preview.changes.length > 0) {
    const target = approval.preview.target || "the target system";
    return `${pluralize(approval.preview.changes.length, "planned change")} will be applied to ${target}.`;
  }

  const touchedTargets = [
    ...approval.preview.impact.affectedSystems,
    ...approval.preview.impact.affectedPeople
  ];

  if (touchedTargets.length > 0) {
    return `Touches ${touchedTargets.join(", ")} with ${approval.preview.impact.rollback.replaceAll("_", " ")} rollback.`;
  }

  if (approval.preview.impact.permissions.length > 0) {
    return `Requires ${approval.preview.impact.permissions.join(", ")} permissions with ${approval.preview.impact.rollback.replaceAll("_", " ")} rollback.`;
  }

  return `Planned ${approval.preview.actionType.replaceAll("-", " ")} action with ${approval.preview.impact.rollback.replaceAll("_", " ")} rollback.`;
}

function buildApprovalDecisionSummary(approval: ApprovalRequest): string | null {
  if (approval.decision === "pending") {
    return null;
  }

  const scopeSummary = approval.decisionScope ? humanizeSnakeCase(approval.decisionScope) : "one-time review";

  if (approval.decisionRationale) {
    return `${approval.decision === "approved" ? "Approved" : "Rejected"} for ${scopeSummary}. ${approval.decisionRationale}`;
  }

  return `${approval.decision === "approved" ? "Approved" : "Rejected"} for ${scopeSummary}.`;
}

function buildApprovalOutcomeSummary(record: EvidenceRecord | null): string | null {
  if (!record) {
    return null;
  }

  return `Task is ${humanizeSnakeCase(record.resultingTaskState)} and goal is ${humanizeSnakeCase(record.resultingGoalStatus)} after the response.`;
}

function buildApprovalEvidenceSummary(record: EvidenceRecord | null, approval: ApprovalRequest): string | null {
  if (!record) {
    return approval.decision === "pending" ? null : "Decision recorded, but the post-decision evidence trail is still incomplete.";
  }

  return `Linked ${formatCount(record.actionLogIds.length, "action log")}, ${formatCount(record.artifactIds.length, "artifact")}, and ${formatCount(record.memoryIds.length, "memory")}.`;
}

function resolveLatestEvidenceRecord(records: EvidenceRecord[]): EvidenceRecord | null {
  if (records.length === 0) {
    return null;
  }

  return [...records].sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))[0] ?? null;
}

function enrichApprovals(params: {
  approvals: ApprovalRequest[];
  evidenceRecords: EvidenceRecord[];
}): ApprovalRequest[] {
  const evidenceByApprovalId = new Map<string, EvidenceRecord>();

  for (const approval of params.approvals) {
    const evidence = resolveLatestEvidenceRecord(
      params.evidenceRecords.filter((record) => record.approvalId === approval.id)
    );

    if (evidence) {
      evidenceByApprovalId.set(approval.id, evidence);
    }
  }

  return params.approvals.map((approval) => {
    const evidence = evidenceByApprovalId.get(approval.id) ?? null;

    return {
      ...approval,
      explanation: {
        requestReason: approval.rationale,
        impactSummary: buildApprovalImpactSummary(approval),
        decisionSummary: buildApprovalDecisionSummary(approval),
        outcomeSummary: buildApprovalOutcomeSummary(evidence),
        evidenceSummary: buildApprovalEvidenceSummary(evidence, approval),
        evidence: {
          actionLogCount: evidence?.actionLogIds.length ?? 0,
          artifactCount: evidence?.artifactIds.length ?? 0,
          memoryCount: evidence?.memoryIds.length ?? 0,
          updatedAt: evidence?.updatedAt ?? null
        }
      }
    };
  });
}

export function assembleDashboardData(params: AssembleDashboardDataParams): DashboardData {
  const startedAt = Date.now();
  const scopedGoals = params.filterBundlesForWorkspace(params.goals, params.activeWorkspace, params.userId);
  const scopedGoalIds = new Set(scopedGoals.map((bundle) => bundle.goal.id));
  const goalShares = params.goalShares ?? [];
  const privacyOperations = params.privacyOperations ?? [];
  const scopedGoalShares = goalShares.filter((share) => scopedGoalIds.has(share.goalId));
  const scopedPrivacyOperations = params.activeWorkspace
    ? privacyOperations.filter((operation) => operation.workspaceId === params.activeWorkspace?.id)
    : [];
  const scopedEvidenceRecords = params.evidenceRecords.filter((record) => scopedGoalIds.has(record.goalId));
  const scopedApprovals = enrichApprovals({
    approvals: params.approvals.filter((approval) => scopedGoalIds.has(approval.goalId)),
    evidenceRecords: scopedEvidenceRecords
  });
  const scopedWatchers = params.watchers.filter((watcher) => scopedGoalIds.has(watcher.goalId));
  const mergedCommitments = params.mergeCommitments({
    goals: scopedGoals,
    approvals: scopedApprovals,
    persisted: params.commitments,
    userId: params.userId
  });
  const dashboardNow = params.now ?? Date.now();
  const operations = params.buildOperations
    ? params.buildOperations({
        activeWorkspace: params.activeWorkspace,
        goals: scopedGoals,
        jobs: params.jobs ?? [],
        providerCredentials: params.providerCredentials ?? [],
        generatedAt: new Date(dashboardNow).toISOString()
      })
    : undefined;
  const diagnostics = params.buildDiagnostics({
    goals: scopedGoals,
    approvals: scopedApprovals,
    memories: params.memories,
    watchers: scopedWatchers,
    operations,
    now: dashboardNow
  });
  const recentAutopilotEvents = params.autopilotEvents.slice(0, 8);
  const nowQueue = params.buildNowQueue({
    commitments: mergedCommitments,
    diagnostics,
    now: dashboardNow
  });
  const latestArtifacts = params.sortArtifacts(scopedGoals.flatMap((bundle) => bundle.artifacts)).slice(0, 8);
  const actionLogs = params.sortActionLogs(scopedGoals.flatMap((bundle) => bundle.actionLogs)).slice(0, 20);
  const operatingSections = params.buildOperatingSections({
    activeWorkspace: params.activeWorkspace,
    workspaceMembers: params.workspaceMembers,
    workspaceGovernance: params.workspaceGovernance,
    goals: scopedGoals,
    approvals: scopedApprovals,
    evidenceRecords: scopedEvidenceRecords,
    commitments: mergedCommitments,
    nowQueue,
    autopilotSettings: params.autopilotSettings,
    autopilotEvents: recentAutopilotEvents,
    memories: params.memories,
    watchers: scopedWatchers,
    integrations: params.integrations,
    latestArtifacts,
    actionLogs,
    diagnostics,
    operations
  });
  const governanceConformance = assessWorkspaceGovernanceConformance(params.workspaceGovernance);

  const dashboard = {
    workspaces: params.workspaces,
    activeWorkspace: params.activeWorkspace,
    workspaceSelection: params.workspaceSelection,
    workspaceMembers: params.workspaceMembers,
    workspaceGovernance: params.workspaceGovernance,
    governanceConformance,
    goalShares: scopedGoalShares,
    privacyOperations: scopedPrivacyOperations,
    controlPlane: params.buildControlPlane({
      activeWorkspace: params.activeWorkspace,
      workspaceMembers: params.workspaceMembers,
      workspaceGovernance: params.workspaceGovernance,
      goals: scopedGoals,
      approvals: scopedApprovals,
      evidenceRecords: scopedEvidenceRecords,
      commitments: mergedCommitments,
      autopilotSettings: params.autopilotSettings,
      autopilotEvents: recentAutopilotEvents,
      memories: params.memories,
      watchers: scopedWatchers,
      integrations: params.integrations,
      diagnostics,
      operations
    }),
    operatingSections,
    goals: scopedGoals,
    approvals: scopedApprovals,
    commitments: mergedCommitments,
    nowQueue,
    briefingPreferences: params.briefingPreferences,
    briefingHistory: params.buildBriefingHistory(scopedGoals),
    autopilotSettings: params.autopilotSettings,
    autopilotEvents: recentAutopilotEvents,
    memories: params.memories,
    watchers: scopedWatchers,
    integrations: params.integrations,
    latestArtifacts,
    actionLogs,
    diagnostics,
    operations
  };

  const durationMs = Date.now() - startedAt;
  const warnMs = readDashboardWarnMs();

  if (shouldAlwaysLogDashboardTiming() || durationMs >= warnMs) {
    const log = durationMs >= warnMs ? console.warn : console.info;
    log("[dashboard-data] assembled dashboard payload", {
      durationMs,
      totalGoals: params.goals.length,
      scopedGoals: scopedGoals.length,
      goalShares: scopedGoalShares.length,
      privacyOperations: scopedPrivacyOperations.length,
      approvals: scopedApprovals.length,
      commitments: mergedCommitments.length,
      watchers: scopedWatchers.length,
      workspaces: params.workspaces.length,
      autopilotEvents: recentAutopilotEvents.length
    });
  }

  return dashboard;
}
