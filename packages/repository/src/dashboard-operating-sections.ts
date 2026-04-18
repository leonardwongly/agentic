import { getMemoryFreshness } from "@agentic/memory";
import type {
  ActionLog,
  Artifact,
  AutopilotEvent,
  AutopilotSettings,
  ApprovalRequest,
  Commitment,
  DashboardOperatingSection,
  DashboardOperatingSections,
  EvidenceRecord,
  GoalBundle,
  IntegrationAccount,
  MemoryRecord,
  NowQueue,
  Watcher,
  Workspace,
  WorkspaceGovernance,
  WorkspaceMember
} from "@agentic/contracts";
import type { DashboardDiagnostics } from "./index";
import type { DashboardOperationsTower } from "./dashboard-operations";

type BuildDashboardOperatingSectionsParams = {
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
};

function pluralize(count: number, noun: string): string {
  if (count === 1) {
    return `${count} ${noun}`;
  }

  if (noun.endsWith("y") && noun.length > 1) {
    return `${count} ${noun.slice(0, -1)}ies`;
  }

  return `${count} ${noun}s`;
}

function compactHighlights(...highlights: Array<string | null>): string[] {
  return highlights.filter((highlight): highlight is string => highlight !== null && highlight.trim().length > 0);
}

function toAttentionStatus(status: DashboardDiagnostics["status"]): DashboardOperatingSection["status"] {
  if (status === "critical") {
    return "critical";
  }

  if (status === "warning") {
    return "attention";
  }

  return "healthy";
}

function maxSectionStatus(
  left: DashboardOperatingSection["status"],
  right: DashboardOperatingSection["status"]
): DashboardOperatingSection["status"] {
  const weight: Record<DashboardOperatingSection["status"], number> = {
    critical: 3,
    attention: 2,
    healthy: 1,
    idle: 0
  };

  return weight[left] >= weight[right] ? left : right;
}

export function buildDashboardOperatingSections(params: BuildDashboardOperatingSectionsParams): DashboardOperatingSections {
  const freshnessNow = Date.parse(params.diagnostics.generatedAt);
  const openCommitments = params.commitments.filter(
    (commitment) => commitment.status !== "completed" && commitment.status !== "dismissed"
  );
  const needsReviewCommitments = openCommitments.filter(
    (commitment) => commitment.status === "needs-review" || commitment.status === "stale"
  );
  const blockedCommitments = openCommitments.filter((commitment) => commitment.status === "blocked");
  const pendingApprovals = params.approvals.filter((approval) => approval.decision === "pending");
  const activeGoals = params.goals.filter((bundle) => bundle.goal.status !== "completed");
  const blockedTasks = activeGoals.flatMap((bundle) =>
    bundle.tasks.filter((task) => task.state === "blocked" || task.state === "failed")
  );
  const activeWatchers = params.watchers.filter((watcher) => watcher.status === "active");
  const pendingEvents = params.autopilotEvents.filter((event) => event.status === "pending");
  const failedEvents = params.autopilotEvents.filter((event) => event.status === "failed");
  const executedEvents = params.autopilotEvents.filter((event) => event.status === "executed");
  const readyIntegrations = params.integrations.filter((integration) => integration.status === "ready");
  const staleMemories = params.memories.filter((record) => getMemoryFreshness(record, freshnessNow) !== "fresh");
  const learnedMemories = params.memories.filter((record) => record.source !== "project-default");
  const respondedApprovals = params.approvals.filter((approval) => approval.decision !== "pending");
  const tracedApprovalIds = new Set(params.evidenceRecords.map((record) => record.approvalId));
  const tracedApprovals = respondedApprovals.filter((approval) => tracedApprovalIds.has(approval.id));
  const missingEvidenceApprovals = respondedApprovals.filter((approval) => !tracedApprovalIds.has(approval.id));
  const topNowItem = params.nowQueue.items[0] ?? null;
  const firstDiagnosticTarget = params.diagnostics.items[0]?.targets[0] ?? null;
  const recentArtifactSignals = params.latestArtifacts.length > 0 ? 1 : 0;
  const asyncExecution = params.operations?.asyncExecution;
  const connectorHealth = params.operations?.connectorHealth;
  const firstAsyncIssue = asyncExecution?.items[0] ?? null;
  const firstConnectorIssue = connectorHealth?.items[0] ?? null;

  const sections: DashboardOperatingSection[] = [
    {
      key: "now",
      title: "Now",
      description:
        params.nowQueue.totalCount > 0
          ? `${pluralize(params.nowQueue.totalCount, "commitment")} are ready for action right now.`
          : "The immediate queue is clear and there is no urgent operator work waiting.",
      status:
        needsReviewCommitments.length > 0
          ? "critical"
          : params.nowQueue.totalCount > 0 || blockedCommitments.length > 0
            ? "attention"
            : "healthy",
      targetSection: "now",
      targetItemId: topNowItem?.commitmentId,
      metrics: [
        `${pluralize(params.nowQueue.totalCount, "ready item")}`,
        `${pluralize(needsReviewCommitments.length, "review gate")}`,
        `${pluralize(blockedCommitments.length, "blocked item")}`
      ],
      highlights: compactHighlights(
        topNowItem ? `Top queue item: ${topNowItem.title}` : null,
        blockedCommitments[0] ? `Blocked: ${blockedCommitments[0].title}` : null,
        params.activeWorkspace ? `Workspace: ${params.activeWorkspace.name}` : null
      )
    },
    {
      key: "automation",
      title: "Automation",
      description:
        failedEvents.length > 0
          ? "Automation needs review because one or more autopilot events failed."
          : pendingEvents.length > 0
            ? "Automation is queued with pending events that still need a bounded decision."
            : "Automation is bounded by workspace policy, watcher coverage, and execution mode.",
      status:
        failedEvents.length > 0
          ? "critical"
          : pendingEvents.length > 0 ||
              activeWatchers.length > 0 ||
              params.autopilotSettings.mode !== "notify_only"
            ? "attention"
            : "healthy",
      targetSection: "autopilot",
      targetItemId: pendingEvents[0]?.id ?? failedEvents[0]?.id,
      metrics: [
        `Mode ${params.autopilotSettings.mode.replaceAll("_", " ")}`,
        `${pluralize(activeWatchers.length, "active watcher")}`,
        `${pluralize(failedEvents.length, "failed event")}`
      ],
      highlights: compactHighlights(
        executedEvents[0] ? `Last executed event: ${executedEvents[0].kind.replaceAll("_", " ")}` : null,
        pendingEvents[0] ? `Pending event: ${pendingEvents[0].kind.replaceAll("_", " ")}` : null,
        activeWatchers[0] ? `Watcher: ${activeWatchers[0].targetEntity}` : null
      )
    },
    {
      key: "execution",
      title: "Execution",
      description:
        firstAsyncIssue
          ? "Async execution needs operator recovery before queued work can be trusted again."
          : blockedTasks.length > 0
          ? `${pluralize(blockedTasks.length, "task")} are blocked or failed inside active goal execution.`
          : activeGoals.length > 0
            ? "Goals are in motion and producing artifacts and action logs that can be audited."
            : "No active goals are currently executing.",
      status:
        asyncExecution?.status === "critical" || blockedTasks.length > 0
          ? "critical"
          : asyncExecution?.status === "attention" || activeGoals.length > 0
            ? "attention"
            : "idle",
      targetSection: firstAsyncIssue ? "operations" : pendingApprovals[0] ? "approvals" : "goals",
      targetItemId: firstAsyncIssue?.id ?? pendingApprovals[0]?.id ?? activeGoals[0]?.goal.id,
      metrics: [
        `${pluralize(activeGoals.length, "active goal")}`,
        `${pluralize(asyncExecution?.issueCount ?? 0, "queue issue")}`,
        `${pluralize(recentArtifactSignals, "recent artifact")}`
      ],
      highlights: compactHighlights(
        firstAsyncIssue ? firstAsyncIssue.summary : null,
        asyncExecution && asyncExecution.stalePendingCount > 0
          ? `${pluralize(asyncExecution.stalePendingCount, "stale pending job")} breached the queue age threshold`
          : null,
        blockedTasks[0] ? `Blocked task: ${blockedTasks[0].title}` : null,
        params.latestArtifacts[0] ? `Latest artifact: ${params.latestArtifacts[0].title}` : null,
        params.actionLogs[0] ? `Latest action: ${params.actionLogs[0].kind}` : null
      )
    },
    {
      key: "trust",
      title: "Trust",
      description:
        firstConnectorIssue
          ? "Connector health degraded and should be recovered before widening automation."
          : params.diagnostics.totalCount > 0
          ? `${pluralize(params.diagnostics.totalCount, "reliability signal")} need review before widening autonomy.`
          : "Trust signals are clean: no active reliability findings are currently open.",
      status: maxSectionStatus(
        toAttentionStatus(params.diagnostics.status),
        connectorHealth?.status === "critical"
          ? "critical"
          : connectorHealth?.status === "attention"
            ? "attention"
            : "healthy"
      ),
      targetSection:
        firstConnectorIssue
          ? "operations"
          : firstDiagnosticTarget?.section ?? (pendingApprovals[0] ? "approvals" : "memory"),
      targetItemId: firstConnectorIssue?.id ?? firstDiagnosticTarget?.itemId ?? pendingApprovals[0]?.id,
      metrics: [
        `${pluralize(params.diagnostics.totalCount, "reliability signal")}`,
        `${pluralize(staleMemories.length, "stale memory")}`,
        respondedApprovals.length > 0
          ? `${tracedApprovals.length}/${respondedApprovals.length} approvals traced`
          : `${pluralize(pendingApprovals.length, "pending approval")}`
      ],
      highlights: compactHighlights(
        firstConnectorIssue ? firstConnectorIssue.summary : firstDiagnosticTarget ? `Investigate: ${firstDiagnosticTarget.label}` : null,
        connectorHealth && connectorHealth.refreshFailedCount > 0
          ? `${pluralize(connectorHealth.refreshFailedCount, "refresh failure")} need credential repair`
          : null,
        params.workspaceGovernance ? `Max auto ${params.workspaceGovernance.maxAutoRunRiskClass}` : null,
        missingEvidenceApprovals[0] ? `Missing evidence: ${missingEvidenceApprovals[0].title}` : null,
        pendingApprovals[0] ? `Pending approval: ${pendingApprovals[0].title}` : null
      )
    },
    {
      key: "build",
      title: "Build",
      description:
        readyIntegrations.length > 0 || activeWatchers.length > 0
          ? "Integrations, watchers, and memory coverage define how repeatable this control plane can become."
          : "Connect systems and watchers before treating this workspace like a durable operating surface.",
      status:
        readyIntegrations.length === 0 && activeWatchers.length === 0
          ? "attention"
          : params.activeWorkspace
            ? "healthy"
            : "idle",
      targetSection: readyIntegrations.length > 0 ? "integrations" : activeWatchers.length > 0 ? "watchers" : "workspaces",
      targetItemId: activeWatchers[0]?.id,
      metrics: [
        `${pluralize(readyIntegrations.length, "ready integration")}`,
        `${pluralize(activeWatchers.length, "active watcher")}`,
        `${pluralize(learnedMemories.length, "memory")}`
      ],
      highlights: compactHighlights(
        readyIntegrations[0] ? `Connected: ${readyIntegrations[0].name}` : null,
        activeWatchers[0] ? `Signal source: ${activeWatchers[0].targetEntity}` : null,
        params.workspaceMembers.length > 0 ? `${pluralize(params.workspaceMembers.length, "workspace member")}` : null
      )
    }
  ];

  return {
    generatedAt: params.diagnostics.generatedAt,
    sections
  };
}
