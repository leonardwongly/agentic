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

export function ApprovalDetailPanel({ approval, relatedGoal, onApprove, onReject, isPending }: ApprovalDetailPanelProps) {
  const relatedTask = relatedGoal?.tasks.find((t) => t.id === approval.taskId);

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
      </div>

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
          </div>
        </div>
      )}
    </div>
  );
}
