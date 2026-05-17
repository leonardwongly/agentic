import type { ApprovalRequest, GoalBundle, JobRecord } from "@agentic/contracts";
import { selectedProductionWedgeKeys, type SelectedProductionWedgeKey } from "./wedge-quality-gates";

export type ExecutionGradeVerticalGateKey =
  | "selected_wedge_contract"
  | "specialist_runner_contract"
  | "approval_preview_blast_radius"
  | "worker_job_idempotency"
  | "no_side_effect_before_approval";

export type ExecutionGradeVerticalGate = {
  key: ExecutionGradeVerticalGateKey;
  passed: boolean;
  summary: string;
  evidence: Record<string, unknown>;
};

export type ExecutionGradeVerticalWorkflowEvaluation = {
  passed: boolean;
  wedgeKey: SelectedProductionWedgeKey | null;
  gates: ExecutionGradeVerticalGate[];
};

function isSelectedProductionWedgeKey(value: string): value is SelectedProductionWedgeKey {
  return selectedProductionWedgeKeys.includes(value as SelectedProductionWedgeKey);
}

function approvalFollowUpJobsFor(approval: ApprovalRequest, jobs: JobRecord[]) {
  return jobs.filter(
    (job) => job.payload.type === "approval_follow_up" && job.payload.approvalId === approval.id
  );
}

function approvalHasBlastRadiusEvidence(approval: ApprovalRequest): boolean {
  return (
    approval.preview.summary.trim().length > 0 &&
    approval.preview.target.trim().length > 0 &&
    approval.preview.changes.length > 0 &&
    approval.preview.impact.permissions.length > 0 &&
    approval.preview.impact.affectedSystems.length > 0
  );
}

function approvalJobHasIdempotencyEvidence(job: JobRecord): boolean {
  if (job.payload.type !== "approval_follow_up") {
    return false;
  }

  return Boolean(job.idempotencyKey?.trim() && job.payload.metadata.actionId?.trim());
}

export function evaluateExecutionGradeVerticalWorkflow(params: {
  bundle: GoalBundle;
  jobs?: JobRecord[];
}): ExecutionGradeVerticalWorkflowEvaluation {
  const jobs = params.jobs ?? [];
  const wedgeKey = isSelectedProductionWedgeKey(params.bundle.goal.wedge.key)
    ? params.bundle.goal.wedge.key
    : null;
  const governedSpecialistArtifacts = params.bundle.artifacts.filter(
    (artifact) =>
      artifact.metadata.executionMode === "governed_specialist" &&
      artifact.metadata.implementationTier === "production"
  );
  const selectedWedgeContractPassed =
    Boolean(wedgeKey) &&
    params.bundle.goal.wedge.selection === "selected_production" &&
    params.bundle.goal.completionContract.successCriteria.length > 0 &&
    params.bundle.goal.completionContract.evidenceSignals.length > 0;
  const approvalPreviewBlastRadiusPassed =
    params.bundle.approvals.length > 0 && params.bundle.approvals.every(approvalHasBlastRadiusEvidence);
  const respondedApprovals = params.bundle.approvals.filter((approval) => approval.decision !== "pending");
  const pendingApprovalsWithFollowUpJobs = params.bundle.approvals.filter(
    (approval) => approval.decision === "pending" && approvalFollowUpJobsFor(approval, jobs).length > 0
  );
  const respondedApprovalsWithIdempotentJobs = respondedApprovals.filter((approval) =>
    approvalFollowUpJobsFor(approval, jobs).some(approvalJobHasIdempotencyEvidence)
  );
  const workerJobIdempotencyPassed =
    respondedApprovals.length > 0 && respondedApprovalsWithIdempotentJobs.length === respondedApprovals.length;

  const gates: ExecutionGradeVerticalGate[] = [
    {
      key: "selected_wedge_contract",
      passed: selectedWedgeContractPassed,
      summary: selectedWedgeContractPassed
        ? "The goal is one of the selected production wedges and carries a measurable completion contract."
        : "The goal is not yet backed by a selected production wedge contract with success criteria and evidence signals.",
      evidence: {
        wedgeKey: params.bundle.goal.wedge.key,
        selection: params.bundle.goal.wedge.selection,
        successCriteria: params.bundle.goal.completionContract.successCriteria.length,
        evidenceSignals: params.bundle.goal.completionContract.evidenceSignals.length
      }
    },
    {
      key: "specialist_runner_contract",
      passed: governedSpecialistArtifacts.length > 0,
      summary: governedSpecialistArtifacts.length > 0
        ? "At least one artifact was produced by a production governed-specialist runner."
        : "The workflow has not produced governed-specialist production output.",
      evidence: {
        governedSpecialistArtifactCount: governedSpecialistArtifacts.length
      }
    },
    {
      key: "approval_preview_blast_radius",
      passed: approvalPreviewBlastRadiusPassed,
      summary: approvalPreviewBlastRadiusPassed
        ? "Every approval preview includes operator-visible blast-radius evidence."
        : "One or more approvals are missing summary, target, changes, permissions, or affected-system evidence.",
      evidence: {
        approvalCount: params.bundle.approvals.length,
        approvalsWithBlastRadiusEvidence: params.bundle.approvals.filter(approvalHasBlastRadiusEvidence).length
      }
    },
    {
      key: "worker_job_idempotency",
      passed: workerJobIdempotencyPassed,
      summary: workerJobIdempotencyPassed
        ? "Every responded approval has a matching idempotent worker follow-up job."
        : "Responded approvals must be connected to durable follow-up jobs with stable idempotency and action ids.",
      evidence: {
        respondedApprovalCount: respondedApprovals.length,
        respondedApprovalsWithIdempotentJobs: respondedApprovalsWithIdempotentJobs.length
      }
    },
    {
      key: "no_side_effect_before_approval",
      passed: pendingApprovalsWithFollowUpJobs.length === 0,
      summary: pendingApprovalsWithFollowUpJobs.length === 0
        ? "No approval follow-up jobs were queued before an operator decision."
        : "Pending approvals must not have side-effect worker follow-up jobs.",
      evidence: {
        pendingApprovalsWithFollowUpJobs: pendingApprovalsWithFollowUpJobs.map((approval) => approval.id)
      }
    }
  ];

  return {
    passed: gates.every((gate) => gate.passed),
    wedgeKey,
    gates
  };
}
