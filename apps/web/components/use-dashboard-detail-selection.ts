"use client";

import { useCallback, useMemo, useState } from "react";
import type { ApprovalRequest, GoalBundle } from "@agentic/contracts";

export type DashboardDetailPanelState =
  | {
      type: "goal";
      goalId: string;
    }
  | {
      type: "approval";
      approvalId: string;
    };

export function useDashboardDetailSelection(approvals: ApprovalRequest[], goalBundleById: Map<string, GoalBundle>) {
  const [detailPanel, setDetailPanel] = useState<DashboardDetailPanelState | null>(null);
  const selectedGoalDetailBundle = useMemo(
    () => (detailPanel?.type === "goal" ? goalBundleById.get(detailPanel.goalId) ?? null : null),
    [goalBundleById, detailPanel]
  );
  const selectedApprovalDetail = useMemo(
    () => (detailPanel?.type === "approval" ? approvals.find((approval) => approval.id === detailPanel.approvalId) ?? null : null),
    [approvals, detailPanel]
  );
  const selectedApprovalGoalBundle = selectedApprovalDetail ? goalBundleById.get(selectedApprovalDetail.goalId) ?? null : null;
  const openGoalDetails = useCallback((goalId: string) => {
    setDetailPanel({ type: "goal", goalId });
  }, []);
  const openApprovalDetails = useCallback((approvalId: string) => {
    setDetailPanel({ type: "approval", approvalId });
  }, []);
  const closeDetails = useCallback(() => {
    setDetailPanel(null);
  }, []);

  return {
    detailPanel,
    selectedGoalDetailBundle,
    selectedApprovalDetail,
    selectedApprovalGoalBundle,
    openGoalDetails,
    openApprovalDetails,
    closeDetails
  };
}
