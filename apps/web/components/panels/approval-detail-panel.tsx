"use client";

import type { ApprovalRequest, GoalBundle } from "@agentic/contracts";
import { StatusBadge, RiskBadge, RelativeTime, CopyableText } from "../ui";

type ApprovalDetailPanelProps = {
  approval: ApprovalRequest;
  relatedGoal?: GoalBundle | null;
  onApprove: () => void;
  onReject: () => void;
  isPending?: boolean;
};

const rollbackLabels: Record<ApprovalRequest["preview"]["impact"]["rollback"], string> = {
  supported: "Supported",
  manual: "Manual",
  not_supported: "Not supported"
};

const riskAssessmentCopy: Record<ApprovalRequest["riskClass"], string> = {
  R1: "Low risk. This action would normally auto-run but was escalated by policy or context.",
  R2: "Moderate risk. User confirmation is required before execution.",
  R3: "High risk. This action can create significant external effects and needs careful review.",
  R4: "Critical risk. This action needs admin-level approval because it may be irreversible or highly sensitive."
};

export function ApprovalDetailPanel({ approval, relatedGoal, onApprove, onReject, isPending }: ApprovalDetailPanelProps) {
  const relatedTask = relatedGoal?.tasks.find((t) => t.id === approval.taskId);
  const impact = approval.preview.impact;
  const goalConfidence = relatedGoal ? `${Math.round(relatedGoal.goal.confidence * 100)}%` : null;

  return (
    <div className="detail-panel">
      <div className="detail-section">
        <div className="detail-header">
          <h3>Approval Request</h3>
          <CopyableText value={approval.id} />
        </div>
        <div className="detail-meta">
          <StatusBadge status={approval.decision} />
          <RiskBadge riskClass={approval.riskClass} />
          <span className="detail-meta-item">
            <strong>Created:</strong> <RelativeTime date={approval.createdAt} />
          </span>
        </div>
      </div>

      <div className="detail-section">
        <div className="detail-field">
          <label>Title</label>
          <div className="detail-value">{approval.title}</div>
        </div>
        <div className="detail-field">
          <label>Rationale</label>
          <div className="detail-value">{approval.rationale}</div>
        </div>
        <div className="detail-field">
          <label>Requested Action</label>
          <div className="detail-value">{approval.requestedAction}</div>
        </div>
        <div className="detail-field">
          <label>Preview Summary</label>
          <div className="detail-value">{approval.preview.summary}</div>
        </div>
        {approval.preview.target ? (
          <div className="detail-field">
            <label>Target</label>
            <div className="detail-value">{approval.preview.target}</div>
          </div>
        ) : null}
        {approval.decisionScope ? (
          <div className="detail-field">
            <label>Decision Scope</label>
            <div className="detail-value">{approval.decisionScope.replace(/_/g, " ")}</div>
          </div>
        ) : null}
        {approval.decisionRationale ? (
          <div className="detail-field">
            <label>Decision Note</label>
            <div className="detail-value">{approval.decisionRationale}</div>
          </div>
        ) : null}
      </div>

      {approval.explanation ? (
        <div className="detail-section">
          <h4>Why This Needs Approval</h4>
          <div className="detail-field">
            <label>Policy rationale</label>
            <div className="detail-value">{approval.rationale}</div>
          </div>
          <div className="detail-field">
            <label>Review trigger</label>
            <div className="detail-value">{approval.explanation.requestReason}</div>
          </div>
          <div className="detail-field">
            <label>Impact summary</label>
            <div className="detail-value">{approval.explanation.impactSummary}</div>
          </div>
          {approval.explanation.decisionSummary ? (
            <div className="detail-field">
              <label>Decision guidance</label>
              <div className="detail-value">{approval.explanation.decisionSummary}</div>
            </div>
          ) : null}
          {goalConfidence ? (
            <div className="detail-field">
              <label>Goal confidence</label>
              <div className="detail-value">{goalConfidence}</div>
            </div>
          ) : null}
        </div>
      ) : null}

      {approval.preview.changes.length > 0 ? (
        <div className="detail-section">
          <h4>Planned Changes</h4>
          {approval.preview.changes.map((change) => (
            <div className="detail-list-item" key={`${change.label}-${change.after}-${change.before}`}>
              <div className="detail-list-header">
                <strong>{change.label}</strong>
              </div>
              <p className="detail-list-summary">
                {change.before ? `Before: ${change.before}` : "Before: not set"}
              </p>
              <p className="detail-list-summary">
                {change.after ? `After: ${change.after}` : "After: cleared"}
              </p>
            </div>
          ))}
        </div>
      ) : null}

      {relatedGoal && (
        <div className="detail-section">
          <h4>Related Goal</h4>
          <div className="detail-list-item">
            <div className="detail-list-header">
              <strong>{relatedGoal.goal.title}</strong>
              <StatusBadge status={relatedGoal.goal.status} />
            </div>
            <p className="detail-list-summary">{relatedGoal.goal.explanation}</p>
          </div>
        </div>
      )}

      {relatedTask && (
        <div className="detail-section">
          <h4>Related Task</h4>
          <div className="detail-list-item">
            <div className="detail-list-header">
              <strong>{relatedTask.title}</strong>
              <div className="detail-list-badges">
                <StatusBadge status={relatedTask.state} />
                <RiskBadge riskClass={relatedTask.riskClass} />
              </div>
            </div>
            <p className="detail-list-summary">{relatedTask.summary}</p>
            <div className="detail-list-meta">
              <span>Agent: {relatedTask.assignedAgent}</span>
              <span>Capabilities: {relatedTask.toolCapabilities.join(", ") || "none"}</span>
            </div>
          </div>
        </div>
      )}

      <div className="detail-section">
        <h4>Risk Assessment</h4>
        <div className="detail-field">
          <label>Risk posture</label>
          <div className="detail-value">{riskAssessmentCopy[approval.riskClass]}</div>
        </div>
        <div className="detail-field">
          <label>Rollback</label>
          <div className="detail-value">{rollbackLabels[impact.rollback]}</div>
        </div>
        {impact.permissions.length > 0 ? (
          <div className="detail-field">
            <label>Required permissions</label>
            <div className="detail-value">{impact.permissions.join(", ")}</div>
          </div>
        ) : null}
        {impact.affectedPeople.length > 0 ? (
          <div className="detail-field">
            <label>Affected people</label>
            <div className="detail-value">{impact.affectedPeople.join(", ")}</div>
          </div>
        ) : null}
        {impact.affectedSystems.length > 0 ? (
          <div className="detail-field">
            <label>Affected systems</label>
            <div className="detail-value">{impact.affectedSystems.join(", ")}</div>
          </div>
        ) : null}
        <div className="risk-explanation">
          {approval.riskClass === "R1" && (
            <p>This action is <strong>low risk</strong> and normally executes automatically. It was flagged for review due to policy rules.</p>
          )}
          {approval.riskClass === "R2" && (
            <p>This action requires <strong>user confirmation</strong> before execution. Review the details and approve if appropriate.</p>
          )}
          {approval.riskClass === "R3" && (
            <p>This action is <strong>high risk</strong> and requires careful review. It may have significant external effects.</p>
          )}
          {approval.riskClass === "R4" && (
            <p>This action requires <strong>admin-level approval</strong>. It has potentially irreversible or high-impact effects.</p>
          )}
        </div>
      </div>

      {approval.decision === "pending" && (
        <div className="detail-actions">
          <button type="button" className="primary-button" onClick={onApprove} disabled={isPending}>
            Approve
          </button>
          <button type="button" className="secondary-button" onClick={onReject} disabled={isPending}>
            Reject
          </button>
        </div>
      )}

      {approval.respondedAt && (
        <div className="detail-section">
          <div className="detail-meta">
            <span className="detail-meta-item">
              <strong>Responded:</strong> <RelativeTime date={approval.respondedAt} />
            </span>
            {approval.explanation?.evidence.updatedAt ? (
              <span className="detail-meta-item">
                <strong>Evidence Updated:</strong> <RelativeTime date={approval.explanation.evidence.updatedAt} />
              </span>
            ) : null}
          </div>
          {approval.explanation?.outcomeSummary || approval.explanation?.evidenceSummary ? (
            <div className="detail-list-item">
              <div className="detail-list-header">
                <strong>Outcome And Evidence</strong>
              </div>
              {approval.explanation.outcomeSummary ? (
                <p className="detail-list-summary">{approval.explanation.outcomeSummary}</p>
              ) : null}
              {approval.explanation.evidenceSummary ? (
                <p className="detail-list-summary">{approval.explanation.evidenceSummary}</p>
              ) : null}
              <div className="detail-list-meta">
                <span>Logs: {approval.explanation.evidence.actionLogCount}</span>
                <span>Artifacts: {approval.explanation.evidence.artifactCount}</span>
                <span>Memories: {approval.explanation.evidence.memoryCount}</span>
              </div>
            </div>
          ) : null}
          {approval.history.length > 0 ? (
            <div className="detail-list-item">
              <div className="detail-list-header">
                <strong>Decision history</strong>
              </div>
              <div className="detail-list-meta">
                {approval.history.map((entry) => (
                  <span key={entry.createdAt}>
                    {entry.decision} · {entry.scope.replace(/_/g, " ")} · <RelativeTime date={entry.createdAt} />
                  </span>
                ))}
              </div>
            </div>
          ) : null}
        </div>
      )}
    </div>
  );
}
