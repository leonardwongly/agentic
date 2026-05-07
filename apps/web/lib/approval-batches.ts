import { z } from "zod";
import { ApprovalMutationError, type AgenticRepository } from "@agentic/repository";
import { respondToApprovalAndEnqueueFollowUpJob } from "@agentic/worker-runtime";
import type {
  ActorContext,
  ApprovalDecision,
  ApprovalDecisionScope,
  ApprovalRequest,
  RiskClass
} from "@agentic/contracts";
import { createActionLog } from "@agentic/observability";

const MAX_APPROVAL_BATCH_SIZE = 25;
const HIGH_RISK_CONFIRMATION = "CONFIRM R3 BATCH";

const ApprovalBatchDecisionSchema = z.enum(["approved", "rejected"]);
const ApprovalBatchIdSchema = z.string().trim().min(1).max(200);

export const ApprovalBatchPreviewRequestSchema = z
  .object({
    approvalIds: z.array(ApprovalBatchIdSchema).min(1).max(MAX_APPROVAL_BATCH_SIZE),
    decision: ApprovalBatchDecisionSchema.optional()
  })
  .strict();

export const ApprovalBatchRespondRequestSchema = z
  .object({
    approvalIds: z.array(ApprovalBatchIdSchema).min(1).max(MAX_APPROVAL_BATCH_SIZE),
    decision: ApprovalBatchDecisionSchema,
    scope: z.enum(["once", "similar_24h", "always_review"]).optional(),
    rationale: z.string().trim().max(1000).nullable().optional(),
    confirmHighRisk: z.boolean().optional(),
    confirmationText: z.string().trim().max(80).optional()
  })
  .strict();

export type ApprovalBatchPreviewRequest = z.infer<typeof ApprovalBatchPreviewRequestSchema>;
export type ApprovalBatchRespondRequest = z.infer<typeof ApprovalBatchRespondRequestSchema>;

export type ApprovalBatchSkippedReason =
  | "not_found_or_forbidden"
  | "duplicate"
  | "already_handled"
  | "expired";

export type ApprovalBatchPreviewItem =
  | {
      status: "actionable";
      approvalId: string;
      goalId: string;
      taskId: string;
      title: string;
      riskClass: RiskClass;
      affectedPeople: string[];
      affectedSystems: string[];
      rollbackMode: string;
      expiresAt: string;
    }
  | {
      status: "skipped";
      requestedId: string;
      approvalId?: string;
      goalId?: string;
      taskId?: string;
      title?: string;
      riskClass?: RiskClass;
      reason: ApprovalBatchSkippedReason;
    };

export type ApprovalBatchPreview = {
  id: string;
  decision: Exclude<ApprovalDecision, "pending"> | null;
  requestedCount: number;
  actionableCount: number;
  skippedCount: number;
  riskCounts: Record<RiskClass, number>;
  affectedPeople: string[];
  affectedSystems: string[];
  rollbackModes: string[];
  staleOrSkippedItems: Array<Extract<ApprovalBatchPreviewItem, { status: "skipped" }>>;
  requiresHighRiskConfirmation: boolean;
  blocked: boolean;
  blockers: string[];
  items: ApprovalBatchPreviewItem[];
};

export type ApprovalBatchResponse = {
  preview: ApprovalBatchPreview;
  batchId: string;
  decision: Exclude<ApprovalDecision, "pending">;
  resultCounts: {
    succeeded: number;
    failed: number;
    skipped: number;
  };
  results: Array<{
    approvalId: string;
    goalId: string;
    taskId: string;
    riskClass: RiskClass;
    status: "succeeded";
    jobId: string;
    statusUrl: string;
  } | {
    approvalId: string;
    status: "failed";
    reason: string;
  }>;
};

function uniqueIds(ids: string[]): { ids: string[]; duplicates: string[] } {
  const seen = new Set<string>();
  const duplicates = new Set<string>();
  const unique: string[] = [];

  for (const id of ids.map((value) => value.trim())) {
    if (seen.has(id)) {
      duplicates.add(id);
      continue;
    }

    seen.add(id);
    unique.push(id);
  }

  return {
    ids: unique,
    duplicates: [...duplicates]
  };
}

function riskCounts(): Record<RiskClass, number> {
  return {
    R1: 0,
    R2: 0,
    R3: 0,
    R4: 0
  };
}

function isExpired(approval: ApprovalRequest, nowMs: number): boolean {
  const expiresAt = Date.parse(approval.expiryAt);
  return Number.isFinite(expiresAt) && expiresAt <= nowMs;
}

function buildActionableItem(approval: ApprovalRequest): Extract<ApprovalBatchPreviewItem, { status: "actionable" }> {
  return {
    status: "actionable",
    approvalId: approval.id,
    goalId: approval.goalId,
    taskId: approval.taskId,
    title: approval.title,
    riskClass: approval.riskClass,
    affectedPeople: approval.preview.impact.affectedPeople,
    affectedSystems: approval.preview.impact.affectedSystems,
    rollbackMode: approval.preview.impact.rollback,
    expiresAt: approval.expiryAt
  };
}

function buildSkippedItem(
  requestedId: string,
  reason: ApprovalBatchSkippedReason,
  approval?: ApprovalRequest
): Extract<ApprovalBatchPreviewItem, { status: "skipped" }> {
  return {
    status: "skipped",
    requestedId,
    approvalId: approval?.id,
    goalId: approval?.goalId,
    taskId: approval?.taskId,
    title: approval?.title,
    riskClass: approval?.riskClass,
    reason
  };
}

function buildPreviewId(items: ApprovalBatchPreviewItem[], decision: ApprovalBatchPreview["decision"]): string {
  const seed = `${decision ?? "preview"}:${items
    .map((item) => (item.status === "actionable" ? item.approvalId : `${item.requestedId}:${item.reason}`))
    .join("|")}`;
  let hash = 0;

  for (let index = 0; index < seed.length; index += 1) {
    hash = (hash * 31 + seed.charCodeAt(index)) >>> 0;
  }

  return `approval-batch-${hash.toString(16).padStart(8, "0")}`;
}

export async function buildApprovalBatchPreview(params: {
  repository: AgenticRepository;
  userId: string;
  request: ApprovalBatchPreviewRequest;
  nowMs?: number;
}): Promise<ApprovalBatchPreview> {
  const normalized = uniqueIds(params.request.approvalIds);
  const visibleApprovals = new Map((await params.repository.listApprovals(params.userId)).map((approval) => [approval.id, approval]));
  const nowMs = params.nowMs ?? Date.now();
  const items: ApprovalBatchPreviewItem[] = [
    ...normalized.duplicates.map((id) => buildSkippedItem(id, "duplicate")),
    ...normalized.ids.map((id) => {
      const approval = visibleApprovals.get(id);
      if (!approval) {
        return buildSkippedItem(id, "not_found_or_forbidden");
      }

      if (approval.decision !== "pending") {
        return buildSkippedItem(id, "already_handled", approval);
      }

      if (isExpired(approval, nowMs)) {
        return buildSkippedItem(id, "expired", approval);
      }

      return buildActionableItem(approval);
    })
  ];
  const counts = riskCounts();
  const actionable = items.filter((item): item is Extract<ApprovalBatchPreviewItem, { status: "actionable" }> => item.status === "actionable");
  const skipped = items.filter((item): item is Extract<ApprovalBatchPreviewItem, { status: "skipped" }> => item.status === "skipped");

  for (const item of actionable) {
    counts[item.riskClass] += 1;
  }

  const affectedPeople = [...new Set(actionable.flatMap((item) => item.affectedPeople))].sort();
  const affectedSystems = [...new Set(actionable.flatMap((item) => item.affectedSystems))].sort();
  const rollbackModes = [...new Set(actionable.map((item) => item.rollbackMode))].sort();
  const approving = params.request.decision === "approved";
  const blockers: string[] = [];

  if (approving && counts.R4 > 0) {
    blockers.push("R4 approvals cannot be approved through batch actions.");
  }

  if (actionable.length === 0) {
    blockers.push("No requested approvals are currently actionable.");
  }

  return {
    id: buildPreviewId(items, params.request.decision ?? null),
    decision: params.request.decision ?? null,
    requestedCount: params.request.approvalIds.length,
    actionableCount: actionable.length,
    skippedCount: skipped.length,
    riskCounts: counts,
    affectedPeople,
    affectedSystems,
    rollbackModes,
    staleOrSkippedItems: skipped,
    requiresHighRiskConfirmation: Boolean(approving && counts.R3 > 0),
    blocked: blockers.length > 0,
    blockers,
    items
  };
}

function confirmationSatisfied(body: ApprovalBatchRespondRequest, preview: ApprovalBatchPreview): boolean {
  if (!preview.requiresHighRiskConfirmation) {
    return true;
  }

  return body.confirmHighRisk === true || body.confirmationText === HIGH_RISK_CONFIRMATION;
}

function errorMessage(error: unknown): string {
  if (error instanceof ApprovalMutationError) {
    return error.message;
  }

  return error instanceof Error ? error.message : "Approval response failed.";
}

async function appendBatchAuditLog(params: {
  repository: AgenticRepository;
  goalId: string;
  taskId: string;
  workflowId: string;
  actor: ActorContext;
  batchId: string;
  approvalId: string;
  decision: Exclude<ApprovalDecision, "pending">;
  riskClass: RiskClass;
  requestedCount: number;
  result: "succeeded" | "failed" | "skipped";
  reason?: string;
}) {
  await params.repository.appendGoalActionLogs(params.goalId, [
    createActionLog({
      goalId: params.goalId,
      taskId: params.taskId,
      workflowId: params.workflowId,
      actor: params.actor.executor.label,
      kind: "approval.batch_response",
      message:
        params.result === "succeeded"
          ? `Batch ${params.batchId} recorded ${params.decision} for approval ${params.approvalId}.`
          : `Batch ${params.batchId} could not record ${params.decision} for approval ${params.approvalId}.`,
      details: {
        batchId: params.batchId,
        approvalId: params.approvalId,
        decision: params.decision,
        riskClass: params.riskClass,
        requestedCount: params.requestedCount,
        result: params.result,
        reason: params.reason ?? null
      }
    })
  ]);
}

export async function respondToApprovalBatch(params: {
  repository: AgenticRepository;
  userId: string;
  actorContext: ActorContext;
  request: ApprovalBatchRespondRequest;
  nowMs?: number;
}): Promise<ApprovalBatchResponse> {
  const preview = await buildApprovalBatchPreview({
    repository: params.repository,
    userId: params.userId,
    request: {
      approvalIds: params.request.approvalIds,
      decision: params.request.decision
    },
    nowMs: params.nowMs
  });

  if (preview.blocked) {
    throw new Error(preview.blockers.join(" "));
  }

  if (!confirmationSatisfied(params.request, preview)) {
    throw new Error(`High-risk R3 approval batches require ${HIGH_RISK_CONFIRMATION}.`);
  }

  const batchId = preview.id;
  const results: ApprovalBatchResponse["results"] = [];

  for (const item of preview.items) {
    if (item.status !== "actionable") {
      continue;
    }

    try {
      const { bundle, job } = await respondToApprovalAndEnqueueFollowUpJob({
        repository: params.repository,
        userId: params.userId,
        approvalId: item.approvalId,
        decision: params.request.decision,
        actorContext: params.actorContext,
        scope: params.request.scope,
        rationale: params.request.rationale ?? null
      });

      await appendBatchAuditLog({
        repository: params.repository,
        goalId: bundle.goal.id,
        taskId: item.taskId,
        workflowId: bundle.workflow.id,
        actor: params.actorContext,
        batchId,
        approvalId: item.approvalId,
        decision: params.request.decision,
        riskClass: item.riskClass,
        requestedCount: preview.requestedCount,
        result: "succeeded"
      });

      results.push({
        approvalId: item.approvalId,
        goalId: bundle.goal.id,
        taskId: item.taskId,
        riskClass: item.riskClass,
        status: "succeeded",
        jobId: job.id,
        statusUrl: `/api/approvals/jobs/${job.id}`
      });
    } catch (error) {
      const reason = errorMessage(error);
      const bundle = await params.repository.getGoalBundleForUser(item.goalId, params.userId);

      if (bundle) {
        await appendBatchAuditLog({
          repository: params.repository,
          goalId: bundle.goal.id,
          taskId: item.taskId,
          workflowId: bundle.workflow.id,
          actor: params.actorContext,
          batchId,
          approvalId: item.approvalId,
          decision: params.request.decision,
          riskClass: item.riskClass,
          requestedCount: preview.requestedCount,
          result: "failed",
          reason
        });
      }

      results.push({
        approvalId: item.approvalId,
        status: "failed",
        reason
      });
    }
  }

  const succeeded = results.filter((result) => result.status === "succeeded").length;
  const failed = results.filter((result) => result.status === "failed").length;

  return {
    preview,
    batchId,
    decision: params.request.decision,
    resultCounts: {
      succeeded,
      failed,
      skipped: preview.skippedCount
    },
    results
  };
}
