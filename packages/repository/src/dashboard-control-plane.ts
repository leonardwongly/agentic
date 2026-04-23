import {
  BriefingHistoryItemSchema,
  briefingTypeValues,
  type ApprovalRequest,
  type AutopilotEvent,
  type AutopilotSettings,
  type BriefingHistoryItem,
  type BriefingType,
  type Commitment,
  type CommitmentUrgency,
  type EvidenceRecord,
  type GoalBundle,
  type IntegrationAccount,
  type MemoryRecord,
  type NowQueue,
  type Watcher,
  type Workspace,
  type WorkspaceGovernance,
  type WorkspaceMember
} from "@agentic/contracts";
import { getMemoryFreshness } from "@agentic/memory";
import { sortByCreatedDesc } from "./collection-pagination";
import { isOpenCommitment } from "./commitment-helpers";
import { type DashboardOperationsTower } from "./dashboard-operations";
import {
  type DashboardControlPlane,
  type DashboardControlPlaneSection,
  type DashboardDiagnostics
} from "./repository-types";

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

export function buildBriefingHistory(goals: GoalBundle[]): BriefingHistoryItem[] {
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

export function buildNowQueue(params: {
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

export function buildDashboardControlPlane(params: {
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
  const pendingApprovals = params.approvals.filter((approval) => approval.decision === "pending");
  const respondedApprovals = params.approvals.filter((approval) => approval.decision !== "pending");
  const staleMemories = params.memories.filter((record) => getMemoryFreshness(record, freshnessNow) !== "fresh");
  const readyIntegrations = params.integrations.filter((integration) => integration.status === "ready");
  const tracedApprovalIds = new Set(params.evidenceRecords.map((record) => record.approvalId));
  const tracedApprovals = respondedApprovals.filter((approval) => tracedApprovalIds.has(approval.id));
  const missingEvidenceApprovals = respondedApprovals.filter((approval) => !tracedApprovalIds.has(approval.id));
  const asyncExecution = params.operations?.asyncExecution;
  const connectorHealth = params.operations?.connectorHealth;
  const firstAsyncIssue = asyncExecution?.items[0] ?? null;
  const firstConnectorIssue = connectorHealth?.items[0] ?? null;
  const executionDiagnosticTarget =
    params.diagnostics.items.find(
      (item) =>
        item.kind === "stuck_workflows" ||
        item.kind === "expired_approvals" ||
        item.kind === "async_execution_issues"
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
        asyncExecution?.status === "critical" || executionDiagnosticTarget
          ? "critical"
          : asyncExecution?.status === "attention" || pendingApprovals.length > 0 || openGoals.length > 0
            ? "attention"
            : "healthy",
      targetSection: firstAsyncIssue ? "operations" : (executionDiagnosticTarget?.section ?? "goals"),
      targetItemId: firstAsyncIssue?.id ?? executionDiagnosticTarget?.itemId,
      stats: [
        `${pluralize(openGoals.length, "active goal")}`,
        `${pluralize(asyncExecution?.issueCount ?? 0, "queue issue")}`,
        asyncExecution
          ? `${pluralize(asyncExecution.deadLetterJobs, "dead letter")} / ${pluralize(asyncExecution.retryingJobs, "retrying job")}`
          : `${pluralize(pendingApprovals.length, "pending approval")}`
      ],
      highlights:
        firstAsyncIssue
          ? [
              firstAsyncIssue.summary,
              asyncExecution && asyncExecution.stalePendingCount > 0
                ? `${pluralize(asyncExecution.stalePendingCount, "stale pending job")} are breaching the queue age threshold.`
                : null,
              asyncExecution && asyncExecution.expiredLeaseCount > 0
                ? `${pluralize(asyncExecution.expiredLeaseCount, "expired lease")} need worker recovery.`
                : null
            ].filter((highlight): highlight is string => highlight !== null)
          : executionDiagnosticTarget
            ? params.diagnostics.items
                .filter(
                  (item) =>
                    item.kind === "stuck_workflows" ||
                    item.kind === "expired_approvals" ||
                    item.kind === "async_execution_issues"
                )
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
      targetSection: firstConnectorIssue ? "operations" : (trustDiagnosticTarget?.section ?? "governance"),
      targetItemId: firstConnectorIssue?.id ?? trustDiagnosticTarget?.itemId,
      stats: [
        `${pluralize(params.diagnostics.totalCount, "reliability signal")}`,
        respondedApprovals.length > 0
          ? `${tracedApprovals.length}/${respondedApprovals.length} approvals traced`
          : formatCount(staleMemories.length, "stale memory", "stale memories"),
        `Max auto ${params.workspaceGovernance?.maxAutoRunRiskClass ?? "R1"}`
      ],
      highlights:
        firstConnectorIssue
          ? [
              firstConnectorIssue.summary,
              connectorHealth && connectorHealth.refreshFailedCount > 0
                ? `${pluralize(connectorHealth.refreshFailedCount, "refresh failure")} need connector review.`
                : null,
              connectorHealth && connectorHealth.validationStaleCount > 0
                ? `${pluralize(connectorHealth.validationStaleCount, "stale validation")} should be rechecked.`
                : null
            ].filter((highlight): highlight is string => highlight !== null)
          : params.diagnostics.totalCount > 0
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
