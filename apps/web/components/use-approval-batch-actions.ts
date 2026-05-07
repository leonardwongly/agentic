"use client";

import { startTransition, useState } from "react";
import type { ApprovalDecisionScope } from "@agentic/contracts";
import type { DashboardData } from "@agentic/repository";
import { buildClientIdempotencyKey, readJson } from "./dashboard-async";
import type { RequestState } from "./dashboard-types";
import { toast } from "./ui";

type ApprovalBatchPreviewPayload = {
  blocked: boolean;
  blockers: string[];
  requiresHighRiskConfirmation: boolean;
  riskCounts: Record<string, number>;
};

type ApprovalBatchRespondPayload = {
  dashboard: DashboardData;
  resultCounts: {
    succeeded: number;
    failed: number;
    skipped: number;
  };
};

type ApprovalBatchActionOptions = {
  setData: (data: DashboardData) => void;
  setIsPending: (pending: boolean) => void;
  updateStats: () => void;
  deselectAll: () => void;
  addRecentAction: (action: { type: "approve" | "reject"; label: string; undoable: boolean }) => void;
};

export function useApprovalBatchActions(options: ApprovalBatchActionOptions) {
  const [approvalBatchState, setApprovalBatchState] = useState<RequestState>({ kind: "idle", message: "" });

  async function respondApprovalBatch(
    approvals: Array<DashboardData["approvals"][number]>,
    decision: "approved" | "rejected",
    scope: ApprovalDecisionScope = "once"
  ) {
    if (approvals.length === 0) {
      return;
    }

    options.setIsPending(true);

    try {
      setApprovalBatchState({ kind: "idle", message: "Previewing approval batch." });
      const approvalIds = approvals.map((approval) => approval.id);
      const previewPayload = await readJson<{ preview: ApprovalBatchPreviewPayload }>(
        await fetch("/api/approvals/batch/preview", {
          method: "POST",
          headers: {
            "content-type": "application/json"
          },
          body: JSON.stringify({
            approvalIds,
            decision
          })
        })
      );

      if (previewPayload.preview.blocked) {
        throw new Error(previewPayload.preview.blockers.join(" "));
      }

      const needsHighRiskConfirmation = decision === "approved" && previewPayload.preview.requiresHighRiskConfirmation;
      if (
        needsHighRiskConfirmation &&
        !globalThis.confirm(
          `Approve ${previewPayload.preview.riskCounts.R3} R3 approval${previewPayload.preview.riskCounts.R3 === 1 ? "" : "s"} in this batch?`
        )
      ) {
        setApprovalBatchState({ kind: "idle", message: "Approval batch cancelled before high-risk confirmation." });
        return;
      }

      const payload = await readJson<ApprovalBatchRespondPayload>(
        await fetch("/api/approvals/batch/respond", {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "x-idempotency-key": buildClientIdempotencyKey()
          },
          body: JSON.stringify({
            approvalIds,
            decision,
            ...(decision === "approved" ? { scope } : {}),
            ...(needsHighRiskConfirmation ? { confirmationText: "CONFIRM R3 BATCH" } : {})
          })
        })
      );
      const { succeeded, failed, skipped } = payload.resultCounts;
      const partial = failed > 0 || skipped > 0;
      const message = `${decision === "approved" ? "Approved" : "Rejected"} ${succeeded} approval${succeeded === 1 ? "" : "s"}${partial ? `; ${failed} failed and ${skipped} skipped.` : "."}`;

      startTransition(() => {
        options.setData(payload.dashboard);
        setApprovalBatchState({ kind: partial ? "error" : "success", message });
        options.updateStats();
      });
      options.deselectAll();

      if (partial) {
        toast.error("Batch completed with partial failures", message);
      } else {
        toast.success(message);
      }

      options.addRecentAction({
        type: decision === "approved" ? "approve" : "reject",
        label: `${succeeded} approvals`,
        undoable: false
      });
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : "Failed to process approval batch.";
      setApprovalBatchState({ kind: "error", message: errorMessage });
      toast.error("Batch action failed", errorMessage);
    } finally {
      options.setIsPending(false);
    }
  }

  return {
    approvalBatchState,
    respondApprovalBatch
  };
}
