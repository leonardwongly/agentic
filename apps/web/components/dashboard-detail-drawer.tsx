"use client";

import type { ApprovalDecisionScope, ApprovalRequest, GoalBundle } from "@agentic/contracts";
import { ApprovalDetailPanel } from "./panels/approval-detail-panel";
import { GoalDetailPanel } from "./panels/goal-detail-panel";
import { SlideOutPanel } from "./ui";

type ApprovalResponseOptions = {
  scope?: ApprovalDecisionScope;
  rationale?: string | null;
};

type DashboardDetailDrawerProps = {
  isOpen: boolean;
  goalBundle: GoalBundle | null;
  approval: ApprovalRequest | null;
  relatedGoal: GoalBundle | null;
  onClose: () => void;
  onShareGoal: (goalId: string, title: string) => void;
  onSaveAsTemplate: (title: string, request: string) => void;
  onRespondApproval: (
    approvalId: string,
    decision: "approved" | "rejected",
    options?: ApprovalResponseOptions
  ) => void | Promise<void>;
  isPending: boolean;
};

export function DashboardDetailDrawer({
  isOpen,
  goalBundle,
  approval,
  relatedGoal,
  onClose,
  onShareGoal,
  onSaveAsTemplate,
  onRespondApproval,
  isPending
}: DashboardDetailDrawerProps) {
  return (
    <SlideOutPanel
      isOpen={isOpen}
      onClose={onClose}
      title={goalBundle ? goalBundle.goal.title : approval ? approval.title : "Details"}
      subtitle={
        goalBundle
          ? "Workflow trace, provenance, approvals, artifacts, and activity."
          : approval
            ? "Approval impact, policy context, and linked workflow evidence."
            : undefined
      }
      width="xl"
    >
      {goalBundle ? (
        <GoalDetailPanel
          bundle={goalBundle}
          onClose={onClose}
          onShare={() => onShareGoal(goalBundle.goal.id, goalBundle.goal.title)}
          onSaveAsTemplate={() => onSaveAsTemplate(goalBundle.goal.title, goalBundle.goal.request)}
          isPending={isPending}
        />
      ) : approval ? (
        <ApprovalDetailPanel
          approval={approval}
          relatedGoal={relatedGoal}
          onApprove={() => onRespondApproval(approval.id, "approved", { scope: "once" })}
          onReject={() => onRespondApproval(approval.id, "rejected")}
          isPending={isPending}
        />
      ) : (
        <p className="empty-state">The selected detail record is no longer available.</p>
      )}
    </SlideOutPanel>
  );
}
