import crypto from "node:crypto";
import {
  ActorContextSchema,
  EvidenceRecordSchema,
  GoalBundleSchema,
  clone,
  type ActorContext,
  type ApprovalDecision,
  type ApprovalDecisionScope,
  type ApprovalRequest,
  type EvidenceRecord,
  type GoalBundle,
  type JobRecord
} from "@agentic/contracts";
import { respondToApproval as applyApprovalResponse } from "@agentic/orchestrator";
import { ApprovalMutationError } from "./repository-types";

function subjectUserIdForActor(actor: ActorContext): string {
  return ActorContextSchema.parse(actor).subjectUserId;
}

export function assertApprovalFollowUpJobOwner(job: JobRecord, userId: string): void {
  if (job.userId !== userId) {
    throw new Error("Approval follow-up job owner must match the approval mutation actor.");
  }
}

function buildApprovalEvidenceRecord(params: {
  actor: ActorContext;
  previousBundle: GoalBundle;
  updatedBundle: GoalBundle;
  originalApproval: ApprovalRequest;
}): EvidenceRecord {
  const updatedApproval = params.updatedBundle.approvals.find(
    (candidate) => candidate.id === params.originalApproval.id
  );
  const updatedTask = params.updatedBundle.tasks.find(
    (candidate) => candidate.id === params.originalApproval.taskId
  );

  if (!updatedApproval) {
    throw new Error(`Approval ${params.originalApproval.id} is missing after response processing.`);
  }

  if (!updatedTask) {
    throw new Error(`Task ${params.originalApproval.taskId} is missing after response processing.`);
  }

  if (updatedApproval.decision === "pending" || !updatedApproval.respondedAt || !updatedApproval.decisionScope) {
    throw new Error(`Approval ${params.originalApproval.id} did not persist a complete response state.`);
  }

  const previousLogIds = new Set(params.previousBundle.actionLogs.map((log) => log.id));
  const actionLogIds = params.updatedBundle.actionLogs
    .filter((log) => !previousLogIds.has(log.id))
    .map((log) => log.id);
  const artifactIds =
    updatedApproval.actionIntent?.type === "manual_review" ? updatedApproval.actionIntent.artifactIds : [];

  return EvidenceRecordSchema.parse({
    id: crypto.randomUUID(),
    userId: subjectUserIdForActor(params.actor),
    goalId: params.updatedBundle.goal.id,
    taskId: params.originalApproval.taskId,
    approvalId: params.originalApproval.id,
    sourceKind: "approval_response",
    sourceId: params.originalApproval.id,
    sourceSummary: `${updatedApproval.decision === "approved" ? "Approved" : "Rejected"} "${params.originalApproval.title}".`,
    riskClass: params.originalApproval.riskClass,
    requestedAction: params.originalApproval.requestedAction,
    requestRationale: params.originalApproval.rationale,
    requiresApproval: true,
    decision: updatedApproval.decision,
    decisionScope: updatedApproval.decisionScope,
    decisionRationale: updatedApproval.decisionRationale,
    respondedAt: updatedApproval.respondedAt,
    resultingTaskState: updatedTask.state,
    resultingGoalStatus: params.updatedBundle.goal.status,
    actionLogIds,
    artifactIds,
    memoryIds: [],
    actorContext: ActorContextSchema.parse(params.actor),
    createdAt: updatedApproval.respondedAt,
    updatedAt: updatedApproval.respondedAt
  });
}

export function buildApprovalResponseMutation(params: {
  bundle: GoalBundle;
  approvalId: string;
  decision: Exclude<ApprovalDecision, "pending">;
  actor: ActorContext;
  scope?: ApprovalDecisionScope;
  rationale?: string | null;
}): { updatedBundle: GoalBundle; parsedBundle: GoalBundle; evidenceRecord: EvidenceRecord } {
  const originalApproval = params.bundle.approvals.find((candidate) => candidate.id === params.approvalId);

  if (!originalApproval) {
    throw new ApprovalMutationError("not_found", `Approval ${params.approvalId} was not found.`);
  }

  const updatedBundle = applyApprovalResponse({
    bundle: params.bundle,
    approvalId: params.approvalId,
    decision: params.decision,
    actor: params.actor,
    scope: params.scope,
    rationale: params.rationale
  });

  return {
    updatedBundle,
    parsedBundle: GoalBundleSchema.parse(clone(updatedBundle)),
    evidenceRecord: buildApprovalEvidenceRecord({
      actor: params.actor,
      previousBundle: params.bundle,
      updatedBundle,
      originalApproval
    })
  };
}
