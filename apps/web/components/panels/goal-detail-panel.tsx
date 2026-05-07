"use client";

import type { GoalBundle } from "@agentic/contracts";
import {
  StatusBadge,
  RiskBadge,
  RelativeTime,
  CopyableText,
  CopyButton,
  ExecutionModeBadge,
  ImplementationTierBadge,
  findTaskExecutionMode,
  extractArtifactExecutionMode,
  formatConfidencePercentage,
  getImplementationTierPresentation,
  getExecutionModePresentation
} from "../ui";

type ResponsibilityAssignee = GoalBundle["goal"]["responsibility"]["owner"];
type ResponsibilityRecord = GoalBundle["goal"]["responsibility"];

type GoalDetailPanelProps = {
  bundle: GoalBundle;
  onClose: () => void;
  onRefine?: (message: string) => void;
  onShare?: () => void;
  onSaveAsTemplate?: () => void;
  isPending?: boolean;
};

type ContextPackSummary = {
  selectedMemoryIds: string[];
  staleMemoryIds: string[];
  conflictingMemoryIds: string[];
  reviewRequiredMemoryIds: string[];
  conflicts: Array<{
    category: string;
    subject: string;
    reason: string;
  }>;
  evidenceSummary: {
    selectedCount: number;
    confirmedCount: number;
    observedCount: number;
    inferredCount: number;
    freshCount: number;
    expiredCount: number;
    lowConfidenceCount: number;
    reviewRequiredCount: number;
    conflictCount: number;
  };
};

type PolicyTraceSummary = {
  logId: string;
  taskTitle: string;
  decision: {
    riskClass: "R1" | "R2" | "R3" | "R4";
    outcome: "allowed" | "allowed_with_confirmation" | "blocked" | "downgrade_to_draft" | "escalate";
    rationale: string;
    confidence: number;
    requiresApproval: boolean;
  };
  checks: Array<{
    id: string;
    stage: "input" | "risk" | "governance" | "trust" | "decision";
    status: "pass" | "warn" | "fail" | "info";
    summary: string;
    detail: string;
  }>;
  trust: {
    approvedCount: number;
    rejectedCount: number;
    trustScore: number;
  };
  scorecardTrust: {
    strong: boolean;
    weak: boolean;
    rationale: string | null;
  };
  autonomyBudget: {
    approvalMode: "always_review" | "risk_based";
    governanceCeilingRiskClass: "R1" | "R2" | "R3" | "R4";
    requiresExplicitApprovalCapabilities: string[];
    r3AutonomyEligible: boolean;
    shadowReplay: {
      eligibleForR3: boolean;
      enabled: boolean;
      required: boolean;
      promotionMode: "disabled" | "shadow_only" | "validated_autonomy";
      rollbackOutcome: "allowed_with_confirmation" | "downgrade_to_draft";
      thresholdSummary: string[];
      summary: string;
    };
    decisionInputs: Array<{
      id:
        | "confidence_threshold"
        | "capability_risk_class"
        | "approval_mode"
        | "governance_ceiling"
        | "external_send_gate"
        | "calendar_write_gate"
        | "shadow_replay_policy"
        | "learning_promotion_mode"
        | "learning_rollback_control"
        | "memory_trust"
        | "scorecard_trust"
        | "replay_validation";
      category: "input" | "governance" | "trust" | "learning";
      active: boolean;
      summary: string;
      detail: string;
    }>;
    summary: string;
  } | null;
  conformance: {
    status: "conformant" | "needs_attention" | "non_conformant";
    summary: string;
  } | null;
  learningValidation: {
    replayValidated: boolean;
    safeSuggestionPrecision: number;
    negativeOutcomeRate: number;
    failureCostRate: number;
    driftStatus: "improving" | "stable" | "regressing" | "insufficient_data";
    rationale: string;
  } | null;
};

type PolicyTraceCheck = PolicyTraceSummary["checks"][number];
type PolicyTraceConformance = NonNullable<PolicyTraceSummary["conformance"]>;
type PolicyTraceLearningValidation = NonNullable<PolicyTraceSummary["learningValidation"]>;
type PolicyTraceAutonomyBudget = NonNullable<PolicyTraceSummary["autonomyBudget"]>;
type PolicyTraceAutonomyInput = PolicyTraceAutonomyBudget["decisionInputs"][number];

function isRiskClass(value: unknown): value is PolicyTraceSummary["decision"]["riskClass"] {
  return value === "R1" || value === "R2" || value === "R3" || value === "R4";
}

function isPolicyOutcome(value: unknown): value is PolicyTraceSummary["decision"]["outcome"] {
  return (
    value === "allowed" ||
    value === "allowed_with_confirmation" ||
    value === "blocked" ||
    value === "downgrade_to_draft" ||
    value === "escalate"
  );
}

function isPolicyCheckStage(value: unknown): value is PolicyTraceCheck["stage"] {
  return value === "input" || value === "risk" || value === "governance" || value === "trust" || value === "decision";
}

function isPolicyCheckStatus(value: unknown): value is PolicyTraceCheck["status"] {
  return value === "pass" || value === "warn" || value === "fail" || value === "info";
}

function isPolicyConformanceStatus(value: unknown): value is PolicyTraceConformance["status"] {
  return value === "conformant" || value === "needs_attention" || value === "non_conformant";
}

function isPolicyDriftStatus(value: unknown): value is PolicyTraceLearningValidation["driftStatus"] {
  return value === "improving" || value === "stable" || value === "regressing" || value === "insufficient_data";
}

function isPolicyAutonomyInputCategory(value: unknown): value is PolicyTraceAutonomyInput["category"] {
  return value === "input" || value === "governance" || value === "trust" || value === "learning";
}

function isPolicyAutonomyInputId(value: unknown): value is PolicyTraceAutonomyInput["id"] {
  return (
    value === "confidence_threshold" ||
    value === "capability_risk_class" ||
    value === "approval_mode" ||
    value === "governance_ceiling" ||
    value === "external_send_gate" ||
    value === "calendar_write_gate" ||
    value === "shadow_replay_policy" ||
    value === "learning_promotion_mode" ||
    value === "learning_rollback_control" ||
    value === "memory_trust" ||
    value === "scorecard_trust" ||
    value === "replay_validation"
  );
}

function formatCapabilityLabel(value: string): string {
  return value.replaceAll("_", " ");
}

function formatPercent(value: number): string {
  return `${Math.round(value * 100)}%`;
}

function formatOutcomeLabel(value: PolicyTraceSummary["decision"]["outcome"]): string {
  return value.replaceAll("_", " ");
}

function formatResponsibilityAssignee(value: ResponsibilityAssignee | null | undefined): string {
  if (!value) {
    return "Unassigned";
  }

  if (value.kind === "user") {
    return value.label;
  }

  if (value.kind === "workspace_role") {
    return `${value.label} (${value.workspaceRole?.replaceAll("_", " ") ?? "workspace role"})`;
  }

  return `${value.label} (${value.systemActor ?? "system"})`;
}

function formatResponsibilityStatus(value: ResponsibilityRecord["handoffStatus"]): string {
  return value.replaceAll("_", " ");
}

function formatAuditRequirements(value: ResponsibilityRecord): string {
  const requirements = [...value.audit.requiredEvents.map((entry) => entry.replaceAll("_", " "))];

  if (value.audit.requireActorContext) {
    requirements.push("actor context");
  }

  if (value.audit.requireReasonForDelegation) {
    requirements.push("delegation reason");
  }

  if (value.audit.requireReasonForEscalation) {
    requirements.push("escalation reason");
  }

  if (value.audit.requireReviewerIdentity) {
    requirements.push("reviewer identity");
  }

  return requirements.join(", ");
}

function parseContextPackSummary(bundle: GoalBundle): ContextPackSummary | null {
  const resolutionLog = [...bundle.actionLogs].reverse().find((log) => log.kind === "context.resolved");
  const candidate = resolutionLog?.details?.contextPack;

  if (!candidate || typeof candidate !== "object") {
    return null;
  }

  const value = candidate as Record<string, unknown>;
  const selectedMemoryIds = Array.isArray(value.selectedMemoryIds)
    ? value.selectedMemoryIds.filter((entry): entry is string => typeof entry === "string")
    : [];
  const staleMemoryIds = Array.isArray(value.staleMemoryIds)
    ? value.staleMemoryIds.filter((entry): entry is string => typeof entry === "string")
    : [];
  const conflictingMemoryIds = Array.isArray(value.conflictingMemoryIds)
    ? value.conflictingMemoryIds.filter((entry): entry is string => typeof entry === "string")
    : [];
  const reviewRequiredMemoryIds = Array.isArray(value.reviewRequiredMemoryIds)
    ? value.reviewRequiredMemoryIds.filter((entry): entry is string => typeof entry === "string")
    : [];
  const evidenceSummaryCandidate =
    value.evidenceSummary && typeof value.evidenceSummary === "object"
      ? (value.evidenceSummary as Record<string, unknown>)
      : null;
  const conflicts = Array.isArray(value.conflicts)
    ? value.conflicts.flatMap((entry) => {
        if (!entry || typeof entry !== "object") {
          return [];
        }

        const conflict = entry as Record<string, unknown>;
        const category = typeof conflict.category === "string" ? conflict.category : null;
        const subject = typeof conflict.subject === "string" ? conflict.subject : null;
        const reason = typeof conflict.reason === "string" ? conflict.reason : null;

        if (!category || !subject || !reason) {
          return [];
        }

        return [{
          category,
          subject,
          reason
        }];
      })
    : [];

  if (selectedMemoryIds.length === 0 && conflicts.length === 0 && reviewRequiredMemoryIds.length === 0) {
    return null;
  }

  return {
    selectedMemoryIds,
    staleMemoryIds,
    conflictingMemoryIds,
    reviewRequiredMemoryIds,
    conflicts,
    evidenceSummary: {
      selectedCount:
        typeof evidenceSummaryCandidate?.selectedCount === "number"
          ? evidenceSummaryCandidate.selectedCount
          : selectedMemoryIds.length,
      confirmedCount: typeof evidenceSummaryCandidate?.confirmedCount === "number" ? evidenceSummaryCandidate.confirmedCount : 0,
      observedCount: typeof evidenceSummaryCandidate?.observedCount === "number" ? evidenceSummaryCandidate.observedCount : 0,
      inferredCount: typeof evidenceSummaryCandidate?.inferredCount === "number" ? evidenceSummaryCandidate.inferredCount : 0,
      freshCount: typeof evidenceSummaryCandidate?.freshCount === "number" ? evidenceSummaryCandidate.freshCount : 0,
      expiredCount: typeof evidenceSummaryCandidate?.expiredCount === "number" ? evidenceSummaryCandidate.expiredCount : 0,
      lowConfidenceCount:
        typeof evidenceSummaryCandidate?.lowConfidenceCount === "number"
          ? evidenceSummaryCandidate.lowConfidenceCount
          : 0,
      reviewRequiredCount:
        typeof evidenceSummaryCandidate?.reviewRequiredCount === "number"
          ? evidenceSummaryCandidate.reviewRequiredCount
          : reviewRequiredMemoryIds.length,
      conflictCount:
        typeof evidenceSummaryCandidate?.conflictCount === "number"
          ? evidenceSummaryCandidate.conflictCount
          : conflicts.length
    }
  };
}

function parsePolicyTraceSummaries(bundle: GoalBundle): PolicyTraceSummary[] {
  const taskTitles = new Map(bundle.tasks.map((task) => [task.id, task.title]));

  return [...bundle.actionLogs]
    .reverse()
    .flatMap((log) => {
      if (log.kind !== "policy.evaluated" || !log.details || typeof log.details !== "object") {
        return [];
      }

      const details = log.details as Record<string, unknown>;
      const traceCandidate =
        details.policyTrace && typeof details.policyTrace === "object"
          ? (details.policyTrace as Record<string, unknown>)
          : null;
      const decisionCandidate =
        traceCandidate?.decision && typeof traceCandidate.decision === "object"
          ? (traceCandidate.decision as Record<string, unknown>)
          : details;
      const riskClass = decisionCandidate?.riskClass;
      const outcome = decisionCandidate?.outcome;
      const rationale = decisionCandidate?.rationale;
      const confidence = decisionCandidate?.confidence;
      const requiresApproval = decisionCandidate?.requiresApproval;

      if (
        !isRiskClass(riskClass) ||
        !isPolicyOutcome(outcome) ||
        typeof rationale !== "string" ||
        typeof confidence !== "number" ||
        typeof requiresApproval !== "boolean"
      ) {
        return [];
      }

      const checks = Array.isArray(traceCandidate?.checks)
        ? traceCandidate.checks.flatMap((entry) => {
            if (!entry || typeof entry !== "object") {
              return [] as PolicyTraceCheck[];
            }

            const candidate = entry as Record<string, unknown>;
            const id = typeof candidate.id === "string" ? candidate.id : null;
            const stage = isPolicyCheckStage(candidate.stage) ? candidate.stage : null;
            const status = isPolicyCheckStatus(candidate.status) ? candidate.status : null;
            const summary = typeof candidate.summary === "string" ? candidate.summary : null;
            const detail = typeof candidate.detail === "string" ? candidate.detail : null;

            if (!id || !stage || !status || !summary || !detail) {
              return [] as PolicyTraceCheck[];
            }

            return [
              {
              id,
              stage,
              status,
              summary,
              detail
              }
            ];
          })
        : [];
      const trustCandidate =
        traceCandidate?.trust && typeof traceCandidate.trust === "object"
          ? (traceCandidate.trust as Record<string, unknown>)
          : null;
      const scorecardTrustCandidate =
        traceCandidate?.scorecardTrust && typeof traceCandidate.scorecardTrust === "object"
          ? (traceCandidate.scorecardTrust as Record<string, unknown>)
          : null;
      const conformanceCandidate =
        traceCandidate?.conformance && typeof traceCandidate.conformance === "object"
          ? (traceCandidate.conformance as Record<string, unknown>)
          : null;
      const autonomyBudgetCandidate =
        traceCandidate?.autonomyBudget && typeof traceCandidate.autonomyBudget === "object"
          ? (traceCandidate.autonomyBudget as Record<string, unknown>)
          : null;
      const learningValidationCandidate =
        traceCandidate?.learningValidation && typeof traceCandidate.learningValidation === "object"
          ? (traceCandidate.learningValidation as Record<string, unknown>)
          : null;

      const conformance: PolicyTraceConformance | null =
        conformanceCandidate && isPolicyConformanceStatus(conformanceCandidate.status) && typeof conformanceCandidate.summary === "string"
          ? {
              status: conformanceCandidate.status,
              summary: conformanceCandidate.summary
            }
          : null;
      const learningValidation: PolicyTraceLearningValidation | null =
        learningValidationCandidate &&
        typeof learningValidationCandidate.replayValidated === "boolean" &&
        typeof learningValidationCandidate.safeSuggestionPrecision === "number" &&
        typeof learningValidationCandidate.negativeOutcomeRate === "number" &&
        typeof learningValidationCandidate.failureCostRate === "number" &&
        isPolicyDriftStatus(learningValidationCandidate.driftStatus) &&
        typeof learningValidationCandidate.rationale === "string"
          ? {
              replayValidated: learningValidationCandidate.replayValidated,
              safeSuggestionPrecision: learningValidationCandidate.safeSuggestionPrecision,
              negativeOutcomeRate: learningValidationCandidate.negativeOutcomeRate,
              failureCostRate: learningValidationCandidate.failureCostRate,
              driftStatus: learningValidationCandidate.driftStatus,
              rationale: learningValidationCandidate.rationale
            }
          : null;
      const shadowReplayCandidate =
        autonomyBudgetCandidate?.shadowReplay && typeof autonomyBudgetCandidate.shadowReplay === "object"
          ? (autonomyBudgetCandidate.shadowReplay as Record<string, unknown>)
          : null;
      const autonomyBudget: PolicyTraceAutonomyBudget | null =
        autonomyBudgetCandidate &&
        (autonomyBudgetCandidate.approvalMode === "always_review" || autonomyBudgetCandidate.approvalMode === "risk_based") &&
        isRiskClass(autonomyBudgetCandidate.governanceCeilingRiskClass) &&
        typeof autonomyBudgetCandidate.r3AutonomyEligible === "boolean" &&
        typeof autonomyBudgetCandidate.summary === "string" &&
        shadowReplayCandidate &&
        typeof shadowReplayCandidate.eligibleForR3 === "boolean" &&
        typeof shadowReplayCandidate.enabled === "boolean" &&
        typeof shadowReplayCandidate.required === "boolean" &&
        typeof shadowReplayCandidate.summary === "string"
          ? {
              approvalMode: autonomyBudgetCandidate.approvalMode,
              governanceCeilingRiskClass: autonomyBudgetCandidate.governanceCeilingRiskClass,
              requiresExplicitApprovalCapabilities: Array.isArray(autonomyBudgetCandidate.requiresExplicitApprovalCapabilities)
                ? autonomyBudgetCandidate.requiresExplicitApprovalCapabilities.filter((entry): entry is string => typeof entry === "string")
                : [],
              r3AutonomyEligible: autonomyBudgetCandidate.r3AutonomyEligible,
              shadowReplay: {
                eligibleForR3: shadowReplayCandidate.eligibleForR3,
                enabled: shadowReplayCandidate.enabled,
                required: shadowReplayCandidate.required,
                promotionMode:
                  shadowReplayCandidate.promotionMode === "disabled" || shadowReplayCandidate.promotionMode === "shadow_only"
                    ? shadowReplayCandidate.promotionMode
                    : "validated_autonomy",
                rollbackOutcome:
                  shadowReplayCandidate.rollbackOutcome === "downgrade_to_draft"
                    ? "downgrade_to_draft"
                    : "allowed_with_confirmation",
                thresholdSummary: Array.isArray(shadowReplayCandidate.thresholdSummary)
                  ? shadowReplayCandidate.thresholdSummary.filter((entry): entry is string => typeof entry === "string")
                  : [],
                summary: shadowReplayCandidate.summary
              },
              decisionInputs: Array.isArray(autonomyBudgetCandidate.decisionInputs)
                ? autonomyBudgetCandidate.decisionInputs.flatMap((entry) => {
                    if (!entry || typeof entry !== "object") {
                      return [] as PolicyTraceAutonomyInput[];
                    }

                    const candidate = entry as Record<string, unknown>;

                    if (
                      !isPolicyAutonomyInputId(candidate.id) ||
                      !isPolicyAutonomyInputCategory(candidate.category) ||
                      typeof candidate.active !== "boolean" ||
                      typeof candidate.summary !== "string" ||
                      typeof candidate.detail !== "string"
                    ) {
                      return [] as PolicyTraceAutonomyInput[];
                    }

                    return [
                      {
                        id: candidate.id,
                        category: candidate.category,
                        active: candidate.active,
                        summary: candidate.summary,
                        detail: candidate.detail
                      }
                    ];
                  })
                : [],
              summary: autonomyBudgetCandidate.summary
            }
          : null;
      const summary: PolicyTraceSummary = {
        logId: log.id,
        taskTitle: log.taskId ? (taskTitles.get(log.taskId) ?? log.message) : log.message,
        decision: {
          riskClass,
          outcome,
          rationale,
          confidence,
          requiresApproval
        },
        checks,
        trust: {
          approvedCount: typeof trustCandidate?.approvedCount === "number" ? trustCandidate.approvedCount : 0,
          rejectedCount: typeof trustCandidate?.rejectedCount === "number" ? trustCandidate.rejectedCount : 0,
          trustScore: typeof trustCandidate?.trustScore === "number" ? trustCandidate.trustScore : 0
        },
        scorecardTrust: {
          strong: scorecardTrustCandidate?.strong === true,
          weak: scorecardTrustCandidate?.weak === true,
          rationale: typeof scorecardTrustCandidate?.rationale === "string" ? scorecardTrustCandidate.rationale : null
        },
        autonomyBudget,
        conformance,
        learningValidation
      };

      return [summary];
    });
}

export function GoalDetailPanel({ bundle, onClose, onRefine, onShare, onSaveAsTemplate, isPending }: GoalDetailPanelProps) {
  const { goal, workflow, tasks, artifacts, approvals, watchers, actionLogs } = bundle;
  const goalConfidence = formatConfidencePercentage(goal.confidence);
  const contextPack = parseContextPackSummary(bundle);
  const policyTraces = parsePolicyTraceSummaries(bundle);

  return (
    <div className="detail-panel">
      <div className="detail-section">
        <div className="detail-header">
          <h3>Goal Details</h3>
          <CopyableText value={goal.id} />
        </div>
        <div className="detail-meta">
          <StatusBadge status={goal.status} />
          <span className="detail-meta-item">
            <strong>Confidence:</strong> {goalConfidence}
          </span>
          <span className="detail-meta-item">
            <strong>Created:</strong> <RelativeTime date={goal.createdAt} />
          </span>
        </div>
        <div className="detail-field">
          <label>Request</label>
          <div className="detail-value">{goal.request}</div>
        </div>
        <div className="detail-field">
          <label>Intent</label>
          <div className="detail-value">{goal.intent}</div>
        </div>
        <div className="detail-field">
          <label>Explanation</label>
          <div className="detail-value">{goal.explanation}</div>
        </div>
      </div>

      <div className="detail-section">
        <h4>Workflow</h4>
        <div className="detail-meta">
          <StatusBadge status={workflow.status} />
          <span className="detail-meta-item">
            <strong>Step:</strong> {workflow.currentStep}
          </span>
        </div>
      </div>

      {goal.wedge && goal.completionContract ? (
        <div className="detail-section">
          <h4>Goal Contract</h4>
          <div className="detail-list">
            <div className="detail-list-item">
              <div className="detail-list-header">
                <strong>{goal.wedge.label}</strong>
                <div className="detail-list-badges">
                  <span className="pill">{goal.wedge.selection.replaceAll("_", " ")}</span>
                  <span className="pill">{goal.completionContract.id}</span>
                </div>
              </div>
              <p className="detail-list-summary">{goal.wedge.rationale}</p>
              <div className="detail-list-meta">
                <span>
                  Summary: <strong>{goal.completionContract.summary}</strong>
                </span>
              </div>
              <div className="detail-field">
                <label>Done when</label>
                <div className="detail-value">{goal.completionContract.doneWhen}</div>
              </div>
              <div className="detail-field">
                <label>Success criteria</label>
                <div className="detail-list">
                  {goal.completionContract.successCriteria.map((criterion) => (
                    <div key={criterion} className="detail-list-item">
                      <p className="detail-list-summary">{criterion}</p>
                    </div>
                  ))}
                </div>
              </div>
              <div className="detail-field">
                <label>Evidence signals</label>
                <div className="detail-list">
                  {goal.completionContract.evidenceSignals.map((signal) => (
                    <div key={signal} className="detail-list-item">
                      <p className="detail-list-summary">{signal}</p>
                    </div>
                  ))}
                </div>
              </div>
              {goal.completionContract.approvalExpectations.length > 0 ? (
                <div className="detail-field">
                  <label>Approval expectations</label>
                  <div className="detail-list">
                    {goal.completionContract.approvalExpectations.map((expectation) => (
                      <div key={expectation} className="detail-list-item">
                        <p className="detail-list-summary">{expectation}</p>
                      </div>
                    ))}
                  </div>
                </div>
              ) : null}
            </div>
          </div>
        </div>
      ) : null}

      <div className="detail-section">
        <h4>Responsibility</h4>
        <div className="detail-field">
          <label>Owner</label>
          <div className="detail-value">{formatResponsibilityAssignee(goal.responsibility.owner)}</div>
        </div>
        <div className="detail-field">
          <label>Reviewer</label>
          <div className="detail-value">{formatResponsibilityAssignee(goal.responsibility.reviewer)}</div>
        </div>
        <div className="detail-field">
          <label>Escalation owner</label>
          <div className="detail-value">{formatResponsibilityAssignee(goal.responsibility.escalationOwner)}</div>
        </div>
        <div className="detail-field">
          <label>Handoff</label>
          <div className="detail-value">{formatResponsibilityStatus(goal.responsibility.handoffStatus)}</div>
        </div>
        {goal.responsibility.handoffSummary ? (
          <div className="detail-field">
            <label>Handoff summary</label>
            <div className="detail-value">{goal.responsibility.handoffSummary}</div>
          </div>
        ) : null}
        <div className="detail-field">
          <label>Audit requirements</label>
          <div className="detail-value">{formatAuditRequirements(goal.responsibility)}</div>
        </div>
      </div>

      {goal.wedge && goal.completionContract ? (
        <div className="detail-section">
          <h4>Goal Contract</h4>
          <div className="detail-list">
            <div className="detail-list-item">
              <div className="detail-list-header">
                <strong>{goal.wedge.label}</strong>
                <div className="detail-list-badges">
                  <span className="pill">{goal.wedge.selection.replaceAll("_", " ")}</span>
                  <span className="pill">{goal.completionContract.id}</span>
                </div>
              </div>
              <p className="detail-list-summary">{goal.wedge.rationale}</p>
              <div className="detail-list-meta">
                <span>
                  Summary: <strong>{goal.completionContract.summary}</strong>
                </span>
              </div>
              <div className="detail-field">
                <label>Done when</label>
                <div className="detail-value">{goal.completionContract.doneWhen}</div>
              </div>
              <div className="detail-field">
                <label>Success criteria</label>
                <ul className="detail-bullet-list">
                  {goal.completionContract.successCriteria.map((criterion) => (
                    <li key={criterion}>{criterion}</li>
                  ))}
                </ul>
              </div>
              <div className="detail-field">
                <label>Evidence signals</label>
                <ul className="detail-bullet-list">
                  {goal.completionContract.evidenceSignals.map((signal) => (
                    <li key={signal}>{signal}</li>
                  ))}
                </ul>
              </div>
              {goal.completionContract.approvalExpectations.length > 0 ? (
                <div className="detail-field">
                  <label>Approval expectations</label>
                  <ul className="detail-bullet-list">
                    {goal.completionContract.approvalExpectations.map((expectation) => (
                      <li key={expectation}>{expectation}</li>
                    ))}
                  </ul>
                </div>
              ) : null}
            </div>
          </div>
        </div>
      ) : null}

      {contextPack ? (
        <div className="detail-section">
          <h4>Context Review</h4>
          <div className="detail-meta">
            <span className="detail-meta-item">
              <strong>Selected memories:</strong> {contextPack.evidenceSummary.selectedCount}
            </span>
            <span className="detail-meta-item">
              <strong>Needs review:</strong> {contextPack.evidenceSummary.reviewRequiredCount}
            </span>
            <span className="detail-meta-item">
              <strong>Fresh:</strong> {contextPack.evidenceSummary.freshCount}
            </span>
            <span className="detail-meta-item">
              <strong>Inferred:</strong> {contextPack.evidenceSummary.inferredCount} advisory
            </span>
            <span className="detail-meta-item">
              <strong>Conflicts:</strong> {contextPack.evidenceSummary.conflictCount}
            </span>
          </div>
          <div className="detail-list-meta">
            <span>Confirmed: <strong>{contextPack.evidenceSummary.confirmedCount}</strong></span>
            <span>Observed: <strong>{contextPack.evidenceSummary.observedCount}</strong></span>
            <span>Expired: <strong>{contextPack.evidenceSummary.expiredCount}</strong></span>
            <span>Low confidence: <strong>{contextPack.evidenceSummary.lowConfidenceCount}</strong></span>
          </div>
          <div className="detail-list">
            {contextPack.conflicts.length > 0 ? (
              contextPack.conflicts.map((conflict) => (
                <div className="detail-list-item" key={`${conflict.category}-${conflict.subject}`}>
                  <div className="detail-list-header">
                    <strong>{conflict.category}</strong>
                    <span className="pill">subject: {conflict.subject}</span>
                  </div>
                  <p className="detail-list-summary">{conflict.reason}</p>
                </div>
              ))
            ) : (
              <div className="detail-list-item">
                <p className="detail-list-summary">
                  No conflicting context was retained for this workflow, but review-required counts still reflect stale or
                  low-confidence evidence.
                </p>
              </div>
            )}
          </div>
        </div>
      ) : null}

      {policyTraces.length > 0 ? (
        <div className="detail-section">
          <h4>Policy Trace</h4>
          <div className="detail-list">
            {policyTraces.map((trace) => (
              <div className="detail-list-item" key={trace.logId}>
                <div className="detail-list-header">
                  <strong>{trace.taskTitle}</strong>
                  <div className="detail-list-badges">
                    <RiskBadge riskClass={trace.decision.riskClass} />
                    <span className="pill">{trace.decision.requiresApproval ? "approval required" : "autonomous"}</span>
                    <span className="pill">{formatOutcomeLabel(trace.decision.outcome)}</span>
                  </div>
                </div>
                <p className="detail-list-summary">{trace.decision.rationale}</p>
                <div className="detail-list-meta">
                  <span>
                    Confidence: <strong>{formatConfidencePercentage(trace.decision.confidence)}</strong>
                  </span>
                  <span>
                    Trust score: <strong>{formatPercent(trace.trust.trustScore)}</strong>
                  </span>
                  <span>
                    Approved memory signals: <strong>{trace.trust.approvedCount}</strong>
                  </span>
                  <span>
                    Rejected memory signals: <strong>{trace.trust.rejectedCount}</strong>
                  </span>
                </div>
                {trace.scorecardTrust.rationale ? (
                  <p className="detail-list-summary">{trace.scorecardTrust.rationale}</p>
                ) : null}
                {trace.autonomyBudget ? (
                  <>
                    <div className="detail-list-meta">
                      <span>
                        Budget mode: <strong>{trace.autonomyBudget.approvalMode.replaceAll("_", " ")}</strong>
                      </span>
                      <span>
                        Ceiling: <strong>{trace.autonomyBudget.governanceCeilingRiskClass}</strong>
                      </span>
                      <span>
                        Explicit review: <strong>{trace.autonomyBudget.requiresExplicitApprovalCapabilities.length > 0 ? trace.autonomyBudget.requiresExplicitApprovalCapabilities.map(formatCapabilityLabel).join(", ") : "none"}</strong>
                      </span>
                    </div>
                    <p className="detail-list-summary">{trace.autonomyBudget.summary}</p>
                    <div className="detail-list-meta">
                      <span>
                        Shadow replay: <strong>{trace.autonomyBudget.shadowReplay.required ? "required" : "staged"}</strong>
                      </span>
                      <span>
                        Enabled: <strong>{trace.autonomyBudget.shadowReplay.enabled ? "yes" : "no"}</strong>
                      </span>
                      <span>
                        R3 eligible: <strong>{trace.autonomyBudget.r3AutonomyEligible ? "yes" : "no"}</strong>
                      </span>
                    </div>
                    <p className="detail-list-summary">{trace.autonomyBudget.shadowReplay.summary}</p>
                    {trace.autonomyBudget.shadowReplay.thresholdSummary.length > 0 ? (
                      <div className="detail-list-meta">
                        {trace.autonomyBudget.shadowReplay.thresholdSummary.map((threshold) => (
                          <span key={threshold}>{threshold}</span>
                        ))}
                      </div>
                    ) : null}
                  </>
                ) : null}
                {trace.conformance ? (
                  <div className="detail-list-meta">
                    <span>
                      Governance: <strong>{trace.conformance.status.replaceAll("_", " ")}</strong>
                    </span>
                    <span>{trace.conformance.summary}</span>
                  </div>
                ) : null}
                {trace.learningValidation ? (
                  <div className="detail-list-meta">
                    <span>
                      Replay: <strong>{trace.learningValidation.replayValidated ? "validated" : "needs approval"}</strong>
                    </span>
                    <span>
                      Precision: <strong>{formatPercent(trace.learningValidation.safeSuggestionPrecision)}</strong>
                    </span>
                    <span>
                      Negative outcomes: <strong>{formatPercent(trace.learningValidation.negativeOutcomeRate)}</strong>
                    </span>
                    <span>
                      Failure cost: <strong>{formatPercent(trace.learningValidation.failureCostRate)}</strong>
                    </span>
                    <span>
                      Drift: <strong>{trace.learningValidation.driftStatus.replaceAll("_", " ")}</strong>
                    </span>
                  </div>
                ) : null}
                {trace.learningValidation ? (
                  <p className="detail-list-summary">{trace.learningValidation.rationale}</p>
                ) : null}
                {trace.autonomyBudget && trace.autonomyBudget.decisionInputs.length > 0 ? (
                  <div className="detail-list">
                    {trace.autonomyBudget.decisionInputs.map((input) => (
                      <div className="detail-list-item" key={input.id}>
                        <div className="detail-list-header">
                          <strong>{input.summary}</strong>
                          <div className="detail-list-badges">
                            <span className="pill">{input.category}</span>
                            <span className="pill">{input.active ? "active" : "inactive"}</span>
                          </div>
                        </div>
                        <p className="detail-list-summary">{input.detail}</p>
                      </div>
                    ))}
                  </div>
                ) : null}
                {trace.checks.length > 0 ? (
                  <div className="detail-list">
                    {trace.checks.map((check) => (
                      <div className="detail-list-item" key={check.id}>
                        <div className="detail-list-header">
                          <strong>{check.summary}</strong>
                          <div className="detail-list-badges">
                            <span className="pill">{check.stage}</span>
                            <span className="pill">{check.status}</span>
                          </div>
                        </div>
                        <p className="detail-list-summary">{check.detail}</p>
                      </div>
                    ))}
                  </div>
                ) : null}
              </div>
            ))}
          </div>
        </div>
      ) : null}

      <div className="detail-section">
        <h4>Tasks ({tasks.length})</h4>
        <div className="detail-list">
          {tasks.map((task) => (
            (() => {
              const executionMode = findTaskExecutionMode(task, artifacts);

              return (
                <div key={task.id} className="detail-list-item">
                  <div className="detail-list-header">
                    <strong>{task.title}</strong>
                    <div className="detail-list-badges">
                      <StatusBadge status={task.state} />
                      <RiskBadge riskClass={task.riskClass} />
                      <ImplementationTierBadge mode={executionMode} />
                      <ExecutionModeBadge mode={executionMode} />
                    </div>
                  </div>
                  <p className="detail-list-summary">{task.summary}</p>
                  <div className="detail-list-meta">
                    <span>Agent: {task.assignedAgent}</span>
                    <span>Capabilities: {task.toolCapabilities.join(", ") || "none"}</span>
                  </div>
                  <div className="detail-list-meta">
                    <span>Owner: <strong>{formatResponsibilityAssignee(task.responsibility.owner)}</strong></span>
                    <span>Delegate: <strong>{formatResponsibilityAssignee(task.responsibility.delegate)}</strong></span>
                    {task.responsibility.reviewer ? (
                      <span>Reviewer: <strong>{formatResponsibilityAssignee(task.responsibility.reviewer)}</strong></span>
                    ) : null}
                  </div>
                  <div className="detail-list-meta">
                    <span>Implementation tier: <strong>{getImplementationTierPresentation(executionMode).label}</strong></span>
                  </div>
                  <div className="detail-list-meta">
                    <span>Execution mode: <strong>{getExecutionModePresentation(executionMode).label}</strong></span>
                    <span>Goal confidence: <strong>{goalConfidence}</strong></span>
                    <span>Handoff: <strong>{formatResponsibilityStatus(task.responsibility.handoffStatus)}</strong></span>
                  </div>
                  {task.responsibility.handoffSummary ? (
                    <p className="detail-list-summary">{task.responsibility.handoffSummary}</p>
                  ) : null}
                </div>
              );
            })()
          ))}
        </div>
      </div>

      {artifacts.length > 0 && (
        <div className="detail-section">
          <h4>Artifacts ({artifacts.length})</h4>
          <div className="detail-list">
            {artifacts.map((artifact) => (
              (() => {
                const executionMode = extractArtifactExecutionMode(artifact);

                return (
                  <div key={artifact.id} className="detail-list-item">
                    <div className="detail-list-header">
                      <strong>{artifact.title}</strong>
                      <div className="detail-list-badges">
                        <StatusBadge status={artifact.artifactType} />
                        <ImplementationTierBadge mode={executionMode} />
                        <ExecutionModeBadge mode={executionMode} />
                      </div>
                    </div>
                    <div className="detail-list-meta">
                      <span>Implementation tier: <strong>{getImplementationTierPresentation(executionMode).label}</strong></span>
                    </div>
                    <div className="detail-list-meta">
                      <span>Execution mode: <strong>{getExecutionModePresentation(executionMode).label}</strong></span>
                      <span>Goal confidence: <strong>{goalConfidence}</strong></span>
                    </div>
                    <pre className="detail-artifact-content">{artifact.content}</pre>
                    <CopyButton value={artifact.content} label="Copy" />
                  </div>
                );
              })()
            ))}
          </div>
        </div>
      )}

      {approvals.length > 0 && (
        <div className="detail-section">
          <h4>Approvals ({approvals.length})</h4>
          <div className="detail-list">
            {approvals.map((approval) => (
              <div key={approval.id} className="detail-list-item">
                <div className="detail-list-header">
                  <strong>{approval.title}</strong>
                  <div className="detail-list-badges">
                    <StatusBadge status={approval.decision} />
                    <RiskBadge riskClass={approval.riskClass} />
                  </div>
                </div>
                <p className="detail-list-summary">{approval.rationale}</p>
                <div className="detail-list-meta">
                  <span>Owner: <strong>{formatResponsibilityAssignee(approval.responsibility.owner)}</strong></span>
                  {approval.responsibility.delegate ? (
                    <span>Delegate: <strong>{formatResponsibilityAssignee(approval.responsibility.delegate)}</strong></span>
                  ) : null}
                  <span>Reviewer: <strong>{formatResponsibilityAssignee(approval.responsibility.reviewer)}</strong></span>
                </div>
                <div className="detail-list-meta">
                  <span>Escalation: <strong>{formatResponsibilityAssignee(approval.responsibility.escalationOwner)}</strong></span>
                  <span>Handoff: <strong>{formatResponsibilityStatus(approval.responsibility.handoffStatus)}</strong></span>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {watchers.length > 0 && (
        <div className="detail-section">
          <h4>Watchers ({watchers.length})</h4>
          <div className="detail-list">
            {watchers.map((watcher) => (
              <div key={watcher.id} className="detail-list-item">
                <div className="detail-list-header">
                  <strong>{watcher.targetEntity}</strong>
                  <StatusBadge status={watcher.status} />
                </div>
                <p className="detail-list-summary">{watcher.condition}</p>
                <span className="pill">{watcher.frequency}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="detail-section">
        <h4>Activity Log ({actionLogs.length})</h4>
        <div className="detail-timeline">
          {actionLogs.map((log) => (
            <div key={log.id} className="detail-timeline-item">
              <div className="detail-timeline-dot" />
              <div className="detail-timeline-content">
                <strong>{log.kind}</strong>
                <p>{log.message}</p>
                <RelativeTime date={log.createdAt} />
              </div>
            </div>
          ))}
        </div>
      </div>

      <div className="detail-actions">
        {onShare && (
          <button type="button" className="secondary-button" onClick={onShare} disabled={isPending}>
            Share
          </button>
        )}
        {goal.status === "completed" && onSaveAsTemplate && (
          <button type="button" className="secondary-button" onClick={onSaveAsTemplate} disabled={isPending}>
            Save as Template
          </button>
        )}
      </div>
    </div>
  );
}
