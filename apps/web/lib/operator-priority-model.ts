import type { ApprovalRequest, Commitment } from "@agentic/contracts";
import type { DashboardData, DashboardDiagnostic } from "@agentic/repository";

export const OPERATOR_PRIORITY_MODEL_LIMITS = {
  maxPriorities: 8,
  maxRecoveryActions: 12,
  maxEvidence: 4,
  maxTextLength: 220
} as const;

export type OperatorPrioritySeverity = "critical" | "degraded" | "attention";

export type OperatorPriorityKind =
  | "async_recovery"
  | "approval_debt"
  | "connector_recovery"
  | "autonomy_blocker"
  | "blocked_work"
  | "overdue_commitment"
  | "diagnostic";

export type OperatorRecoveryAction = {
  id: string;
  label: string;
  targetSection: string;
  targetItemId?: string;
  note: string;
  sideEffecting: boolean;
  confirmationRequired: boolean;
  requiredPermission: "owner" | "operator";
  source: "async_execution" | "connector" | "approval" | "commitment" | "governance" | "diagnostic";
};

export type OperatorPriority = {
  id: string;
  kind: OperatorPriorityKind;
  title: string;
  summary: string;
  severity: OperatorPrioritySeverity;
  rank: number;
  count: number;
  countLabel: string;
  targetSection: string;
  targetItemId?: string;
  evidence: string[];
  recoveryActions: OperatorRecoveryAction[];
};

export type OperatorPriorityModel = {
  generatedAt: string;
  limits: typeof OPERATOR_PRIORITY_MODEL_LIMITS;
  totalCandidateCount: number;
  truncated: boolean;
  priorities: OperatorPriority[];
  recoveryActions: OperatorRecoveryAction[];
};

const severityWeight: Record<OperatorPrioritySeverity, number> = {
  critical: 3,
  degraded: 2,
  attention: 1
};

const kindWeight: Record<OperatorPriorityKind, number> = {
  async_recovery: 700,
  approval_debt: 650,
  connector_recovery: 600,
  autonomy_blocker: 550,
  blocked_work: 500,
  overdue_commitment: 450,
  diagnostic: 400
};

const riskWeight: Record<string, number> = {
  R4: 4,
  R3: 3,
  R2: 2,
  R1: 1
};

function boundedText(value: string, fallback: string): string {
  const trimmed = value.trim().replace(/\s+/gu, " ");
  const normalized = trimmed.length > 0 ? trimmed : fallback;

  if (normalized.length <= OPERATOR_PRIORITY_MODEL_LIMITS.maxTextLength) {
    return normalized;
  }

  return `${normalized.slice(0, OPERATOR_PRIORITY_MODEL_LIMITS.maxTextLength - 1).trimEnd()}...`;
}

function pluralize(count: number, noun: string, plural = `${noun}s`): string {
  return `${count} ${count === 1 ? noun : plural}`;
}

function parseTime(value: string | null | undefined): number {
  if (!value) {
    return Number.POSITIVE_INFINITY;
  }

  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : Number.POSITIVE_INFINITY;
}

function sortByOldestUpdated<T extends { updatedAt?: string; createdAt?: string }>(items: T[]): T[] {
  return [...items].sort((left, right) => {
    const delta = parseTime(left.updatedAt ?? left.createdAt) - parseTime(right.updatedAt ?? right.createdAt);
    return delta !== 0 ? delta : String(left.updatedAt ?? left.createdAt).localeCompare(String(right.updatedAt ?? right.createdAt));
  });
}

function sortApprovals(approvals: ApprovalRequest[]): ApprovalRequest[] {
  return [...approvals].sort((left, right) => {
    const riskDelta = (riskWeight[right.riskClass] ?? 0) - (riskWeight[left.riskClass] ?? 0);

    if (riskDelta !== 0) {
      return riskDelta;
    }

    const createdDelta = parseTime(left.createdAt) - parseTime(right.createdAt);
    return createdDelta !== 0 ? createdDelta : left.id.localeCompare(right.id);
  });
}

function isOpenCommitment(commitment: Commitment): boolean {
  return commitment.status !== "completed" && commitment.status !== "dismissed";
}

function isBlockedCommitment(commitment: Commitment): boolean {
  return commitment.status === "blocked" || commitment.status === "needs-review" || commitment.status === "stale";
}

function isOverdueCommitment(commitment: Commitment, now: number): boolean {
  const dueAt = parseTime(commitment.dueAt);
  return Number.isFinite(dueAt) && dueAt < now && isOpenCommitment(commitment);
}

function action(params: OperatorRecoveryAction): OperatorRecoveryAction {
  return {
    ...params,
    label: boundedText(params.label, "Open"),
    note: boundedText(params.note, "Inspect the affected operator surface.")
  };
}

function priority(params: Omit<OperatorPriority, "rank">): OperatorPriority {
  return {
    ...params,
    title: boundedText(params.title, "Operator priority"),
    summary: boundedText(params.summary, "Inspect the affected operator surface."),
    evidence: params.evidence
      .map((item) => boundedText(item, "Evidence unavailable"))
      .slice(0, OPERATOR_PRIORITY_MODEL_LIMITS.maxEvidence),
    recoveryActions: params.recoveryActions.slice(0, 3),
    rank: 0
  };
}

function diagnosticSeverity(diagnostic: DashboardDiagnostic): OperatorPrioritySeverity {
  return diagnostic.severity === "critical" ? "critical" : "attention";
}

function buildDiagnosticPriority(diagnostic: DashboardDiagnostic): OperatorPriority {
  const target = diagnostic.targets[0];

  return priority({
    id: `diagnostic-${diagnostic.kind}`,
    kind: "diagnostic",
    title: diagnostic.title,
    summary: diagnostic.reasons[0] ?? `${pluralize(diagnostic.count, "signal")} need review.`,
    severity: diagnosticSeverity(diagnostic),
    count: diagnostic.count,
    countLabel: pluralize(diagnostic.count, "signal"),
    targetSection: target?.section ?? "operations",
    targetItemId: target?.itemId,
    evidence: diagnostic.reasons,
    recoveryActions: [
      action({
        id: `diagnostic-${diagnostic.kind}-open`,
        label: target?.label ?? "Open diagnostic",
        targetSection: target?.section ?? "operations",
        targetItemId: target?.itemId,
        note: "Open the diagnostic target before changing runtime posture.",
        sideEffecting: false,
        confirmationRequired: false,
        requiredPermission: "operator",
        source: "diagnostic"
      })
    ]
  });
}

export function buildOperatorPriorityModel(data: DashboardData, now = Date.now()): OperatorPriorityModel {
  const candidates: OperatorPriority[] = [];
  const pendingApprovals = sortApprovals(data.approvals.filter((approval) => approval.decision === "pending"));
  const blockedCommitments = sortByOldestUpdated(data.commitments.filter(isBlockedCommitment));
  const overdueCommitments = sortByOldestUpdated(data.commitments.filter((commitment) => isOverdueCommitment(commitment, now)));
  const asyncIssues = data.operations?.asyncExecution.items ?? [];
  const connectorIssues = data.operations?.connectorHealth.items ?? [];
  const autonomyPosture = data.operations?.autonomyPosture ?? null;

  if (asyncIssues.length > 0) {
    const first = asyncIssues[0]!;
    const remediation = first.remediation;

    candidates.push(
      priority({
        id: "async-recovery",
        kind: "async_recovery",
        title: "Recover async execution",
        summary: first.summary,
        severity: first.severity === "critical" ? "critical" : "degraded",
        count: data.operations?.asyncExecution.issueCount ?? asyncIssues.length,
        countLabel: pluralize(data.operations?.asyncExecution.issueCount ?? asyncIssues.length, "queue issue"),
        targetSection: first.target?.section ?? "operations",
        targetItemId: first.target?.itemId ?? first.id,
        evidence: [
          first.label,
          `${first.status.replaceAll("_", " ")} job`,
          `${data.operations?.asyncExecution.deadLetterJobs ?? 0} dead letters`,
          `${data.operations?.asyncExecution.expiredLeaseCount ?? 0} expired leases`
        ],
        recoveryActions: [
          action({
            id: `async-${first.jobId}-${remediation?.kind ?? "open"}`,
            label: remediation?.label ?? first.target?.label ?? "Open operations",
            targetSection: first.target?.section ?? "operations",
            targetItemId: first.target?.itemId ?? first.id,
            note: remediation?.note ?? "Inspect the runtime issue before retrying work.",
            sideEffecting: remediation ? remediation.kind !== "open_target" : false,
            confirmationRequired: remediation?.kind === "cancel_job" || remediation?.kind === "release_expired_lease",
            requiredPermission: "owner",
            source: "async_execution"
          })
        ]
      })
    );
  }

  if (pendingApprovals.length > 0) {
    const first = pendingApprovals[0]!;

    candidates.push(
      priority({
        id: "approval-debt",
        kind: "approval_debt",
        title: "Resolve approval debt",
        summary: `${first.title} is waiting on a ${first.riskClass} decision.`,
        severity: pendingApprovals.some((approval) => approval.riskClass === "R4" || approval.riskClass === "R3")
          ? "critical"
          : "attention",
        count: pendingApprovals.length,
        countLabel: pluralize(pendingApprovals.length, "pending approval"),
        targetSection: "approvals",
        targetItemId: first.id,
        evidence: [
          `Highest risk ${first.riskClass}`,
          first.rationale,
          `Requested action: ${first.requestedAction}`,
          first.expiryAt ? `Expires ${first.expiryAt}` : "No expiry available"
        ],
        recoveryActions: [
          action({
            id: `approval-${first.id}-review`,
            label: "Review approval",
            targetSection: "approvals",
            targetItemId: first.id,
            note: "Approve or reject through the governed approval surface.",
            sideEffecting: false,
            confirmationRequired: false,
            requiredPermission: "operator",
            source: "approval"
          })
        ]
      })
    );
  }

  if (connectorIssues.length > 0) {
    const first = connectorIssues[0]!;
    const remediation = first.remediation;

    candidates.push(
      priority({
        id: "connector-recovery",
        kind: "connector_recovery",
        title: "Repair degraded connector",
        summary: first.summary,
        severity: first.severity === "critical" ? "critical" : "degraded",
        count: data.operations?.connectorHealth.issueCount ?? connectorIssues.length,
        countLabel: pluralize(data.operations?.connectorHealth.issueCount ?? connectorIssues.length, "connector issue"),
        targetSection: first.target.section,
        targetItemId: first.target.itemId ?? first.id,
        evidence: [
          first.label,
          first.status.replaceAll("_", " "),
          first.expectedReadinessLabel ? `Target ${first.expectedReadinessLabel}` : "No target readiness label",
          (first.linkedIntegrationNames?.length ?? 0) > 0
            ? `Linked ${first.linkedIntegrationNames.join(", ")}`
            : "No linked integrations"
        ],
        recoveryActions: [
          action({
            id: `connector-${first.credentialId}-${remediation?.kind ?? "open"}`,
            label: remediation?.label ?? first.target.label,
            targetSection: first.target.section,
            targetItemId: first.target.itemId ?? first.id,
            note: remediation?.note ?? "Inspect connector health before widening automation.",
            sideEffecting: remediation ? remediation.kind !== "open_target" : false,
            confirmationRequired: remediation?.kind === "mark_connector_reconnect_required",
            requiredPermission: "owner",
            source: "connector"
          })
        ]
      })
    );
  }

  if (autonomyPosture && autonomyPosture.status !== "healthy" && autonomyPosture.status !== "idle") {
    const firstPath = autonomyPosture.overridePaths[0] ?? null;

    candidates.push(
      priority({
        id: "autonomy-posture",
        kind: "autonomy_blocker",
        title: "Hold autonomy within safe bounds",
        summary: autonomyPosture.summary,
        severity: autonomyPosture.status === "critical" ? "critical" : "degraded",
        count: autonomyPosture.reasons.length,
        countLabel: pluralize(autonomyPosture.reasons.length, "autonomy reason"),
        targetSection: firstPath?.target.section ?? "autopilot",
        targetItemId: firstPath?.target.itemId,
        evidence: autonomyPosture.reasons.length > 0 ? autonomyPosture.reasons : autonomyPosture.stats,
        recoveryActions: autonomyPosture.overridePaths.slice(0, 3).map((path) =>
          action({
            id: path.id,
            label: path.label,
            targetSection: path.target.section,
            targetItemId: path.target.itemId,
            note: path.note,
            sideEffecting: false,
            confirmationRequired: false,
            requiredPermission: "owner",
            source: "governance"
          })
        )
      })
    );
  }

  if (blockedCommitments.length > 0) {
    const first = blockedCommitments[0]!;

    candidates.push(
      priority({
        id: "blocked-work",
        kind: "blocked_work",
        title: "Unblock current work",
        summary: first.summary,
        severity: first.status === "needs-review" || first.status === "stale" ? "critical" : "degraded",
        count: blockedCommitments.length,
        countLabel: pluralize(blockedCommitments.length, "blocked item"),
        targetSection: first.suggestedNextAction?.section ?? "now",
        targetItemId: first.suggestedNextAction?.itemId ?? first.id,
        evidence: [
          first.title,
          `Status ${first.status}`,
          first.riskClass ? `Risk ${first.riskClass}` : "No risk class",
          first.provenanceSummary
        ],
        recoveryActions: [
          action({
            id: `commitment-${first.id}-open`,
            label: first.suggestedNextAction?.label ?? "Open now queue",
            targetSection: first.suggestedNextAction?.section ?? "now",
            targetItemId: first.suggestedNextAction?.itemId ?? first.id,
            note: "Open the source item and resolve the blocker through the governed workflow.",
            sideEffecting: false,
            confirmationRequired: false,
            requiredPermission: "operator",
            source: "commitment"
          })
        ]
      })
    );
  }

  if (overdueCommitments.length > 0) {
    const first = overdueCommitments[0]!;

    candidates.push(
      priority({
        id: "overdue-commitments",
        kind: "overdue_commitment",
        title: "Review overdue commitments",
        summary: first.summary,
        severity: first.urgency === "immediate" || first.urgency === "today" ? "critical" : "attention",
        count: overdueCommitments.length,
        countLabel: pluralize(overdueCommitments.length, "overdue item"),
        targetSection: first.suggestedNextAction?.section ?? "now",
        targetItemId: first.suggestedNextAction?.itemId ?? first.id,
        evidence: [
          first.title,
          first.dueAt ? `Due ${first.dueAt}` : "Due date missing",
          `Urgency ${first.urgency}`,
          `Status ${first.status}`
        ],
        recoveryActions: [
          action({
            id: `commitment-${first.id}-overdue-open`,
            label: first.suggestedNextAction?.label ?? "Open now queue",
            targetSection: first.suggestedNextAction?.section ?? "now",
            targetItemId: first.suggestedNextAction?.itemId ?? first.id,
            note: "Review overdue work before taking lower-priority dashboard actions.",
            sideEffecting: false,
            confirmationRequired: false,
            requiredPermission: "operator",
            source: "commitment"
          })
        ]
      })
    );
  }

  for (const diagnostic of data.diagnostics.items) {
    if (diagnostic.kind === "async_execution_issues" || diagnostic.kind === "connector_degradation") {
      continue;
    }

    if (diagnostic.severity === "critical" || candidates.length < OPERATOR_PRIORITY_MODEL_LIMITS.maxPriorities) {
      candidates.push(buildDiagnosticPriority(diagnostic));
    }
  }

  const sorted = candidates
    .sort((left, right) => {
      const severityDelta = severityWeight[right.severity] - severityWeight[left.severity];
      if (severityDelta !== 0) {
        return severityDelta;
      }

      const kindDelta = kindWeight[right.kind] - kindWeight[left.kind];
      if (kindDelta !== 0) {
        return kindDelta;
      }

      return left.title.localeCompare(right.title);
    })
    .map((item, index) => ({ ...item, rank: index + 1 }));
  const priorities = sorted.slice(0, OPERATOR_PRIORITY_MODEL_LIMITS.maxPriorities);
  const recoveryActions = priorities
    .flatMap((item) => item.recoveryActions)
    .slice(0, OPERATOR_PRIORITY_MODEL_LIMITS.maxRecoveryActions);

  return {
    generatedAt: data.diagnostics.generatedAt,
    limits: OPERATOR_PRIORITY_MODEL_LIMITS,
    totalCandidateCount: sorted.length,
    truncated: sorted.length > priorities.length,
    priorities,
    recoveryActions
  };
}
