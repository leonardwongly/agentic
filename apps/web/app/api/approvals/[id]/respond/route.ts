import { z } from "zod";
import { captureExecutionOutcomeSignals, captureMemoriesFromBundle, executeApprovedTasks, reconcileExecutionResults, type ExecutionResult } from "@agentic/orchestrator";
import { isGmailReady, isCalendarReady, isSlackReady, sendNotification, createDraft, sendDraft, listRecentEmails, createEvent, updateEvent, listUpcomingEvents, createLocalNote } from "@agentic/integrations";
import type { GoalBundle } from "@agentic/contracts";
import { ApprovalMutationError, type AgenticRepository } from "@agentic/repository";
import { requireApiSession } from "../../../../../lib/auth";
import { createActorContextFromPrincipal } from "../../../../../lib/actor-context";
import { ApiRouteError, authenticatedJson, handleApiError, parseJsonBody } from "../../../../../lib/api-response";
import { requireJsonContentType } from "../../../../../lib/api-errors";
import { persistCapturedMemories } from "../../../../../lib/persist-captured-memories";
import { getSeededRepository } from "../../../../../lib/server";

const ApprovalIdSchema = z.string().trim().min(1).max(200);

const ApprovalResponseSchema = z
  .object({
    decision: z.enum(["approved", "rejected"]),
    scope: z.enum(["once", "similar_24h", "always_review"]).optional(),
    rationale: z.string().trim().max(1000).nullable().optional()
  })
  .strict();

function mergeIds(...groups: Array<string[] | undefined>): string[] {
  return Array.from(new Set(groups.flatMap((group) => group ?? [])));
}

async function finalizeApprovalEvidenceRecord(params: {
  repository: AgenticRepository;
  bundle: GoalBundle;
  userId: string;
  approvalId: string;
  memoryIds: string[];
}) {
  const { repository, bundle, userId, approvalId, memoryIds } = params;
  const approval = bundle.approvals.find((candidate) => candidate.id === approvalId);

  if (!approval || approval.decision === "pending") {
    return;
  }

  const task = bundle.tasks.find((candidate) => candidate.id === approval.taskId);
  const evidenceRecord =
    (await repository.listEvidenceRecords({ userId, approvalId }))
      .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))
      .at(0) ?? null;

  if (!evidenceRecord) {
    return;
  }

  const relatedActionLogIds = bundle.actionLogs
    .filter(
      (log) => log.taskId === approval.taskId || (typeof log.details.approvalId === "string" && log.details.approvalId === approvalId)
    )
    .map((log) => log.id);
  const relatedArtifactIds = bundle.artifacts
    .filter((artifact) => artifact.taskId === approval.taskId)
    .map((artifact) => artifact.id);

  await repository.saveEvidenceRecord({
    ...evidenceRecord,
    resultingTaskState: task?.state ?? evidenceRecord.resultingTaskState,
    resultingGoalStatus: bundle.goal.status,
    actionLogIds: mergeIds(evidenceRecord.actionLogIds, relatedActionLogIds),
    artifactIds: mergeIds(
      evidenceRecord.artifactIds,
      relatedArtifactIds,
      approval.actionIntent?.type === "manual_review" ? approval.actionIntent.artifactIds : undefined
    ),
    memoryIds: mergeIds(evidenceRecord.memoryIds, memoryIds),
    updatedAt: new Date().toISOString()
  });
}

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    requireJsonContentType(request);
    const principal = await requireApiSession(request);
    const actor = createActorContextFromPrincipal(principal);
    const { id } = await context.params;
    const approvalId = ApprovalIdSchema.parse(id);
    const body = await parseJsonBody(request, ApprovalResponseSchema);
    const repository = await getSeededRepository();
    let updatedBundle = await (async () => {
      try {
        return await repository.respondToApproval({
          approvalId,
          decision: body.decision,
          actor,
          scope: body.scope,
          rationale: body.rationale ?? null
        });
      } catch (error) {
        if (error instanceof ApprovalMutationError) {
          if (error.code === "not_found") {
            throw new ApiRouteError(404, error.message);
          }

          throw new ApiRouteError(409, error.message);
        }

        throw error;
      }
    })();

    // Execute approved tasks via integration adapters
    let executionResults: ExecutionResult[] = [];
    if (body.decision === "approved") {
      const approval = updatedBundle.approvals.find((a) => a.id === approvalId);
      if (approval) {
        try {
          const adapters = {
            gmail: isGmailReady() ? { createDraft, sendDraft, listRecentEmails } : undefined,
            calendar: isCalendarReady() ? { createEvent, updateEvent, listUpcomingEvents } : undefined,
            notes: { createLocalNote }
          };
          const governance = updatedBundle.goal.workspaceId
            ? await repository.getWorkspaceGovernance(updatedBundle.goal.workspaceId, principal.userId)
            : null;
          const { results, logs } = await executeApprovedTasks({
            bundle: updatedBundle,
            approvedTaskIds: [approval.taskId],
            adapters,
            governance
          });
          executionResults = results;
          updatedBundle = reconcileExecutionResults({
            bundle: updatedBundle,
            results,
            logs
          });
          console.log(`[execution] Executed ${results.length} task(s) after approval:`, results.map((r) => `${r.action}: ${r.success ? "OK" : "FAILED"}`).join(", "));
        } catch (execError) {
          console.error("[execution] Failed to execute approved task:", execError);
        }
      }
    }

    await repository.saveGoalBundle(updatedBundle);

    const capturedMemoryIds: string[] = [];

    if (executionResults.length > 0) {
      try {
        const persisted = await persistCapturedMemories({
          repository,
          captured: captureExecutionOutcomeSignals(updatedBundle, principal.userId, executionResults, actor),
          goalId: updatedBundle.goal.id,
          label: "execution-capture",
          actorContext: actor
        });
        capturedMemoryIds.push(...persisted.memories.map((memory) => memory.id));
      } catch (captureError) {
        console.error("[execution-capture] Failed to persist execution outcome signals after approval:", captureError);
      }
    }

    if (updatedBundle.goal.status === "completed") {
      try {
        const persisted = await persistCapturedMemories({
          repository,
          captured: captureMemoriesFromBundle(updatedBundle, principal.userId, actor),
          goalId: updatedBundle.goal.id,
          label: "auto-capture",
          actorContext: actor
        });
        capturedMemoryIds.push(...persisted.memories.map((memory) => memory.id));
      } catch (captureError) {
        console.error("[auto-capture] Failed to persist captured memories after approval:", captureError);
      }
    }

    try {
      await finalizeApprovalEvidenceRecord({
        repository,
        bundle: updatedBundle,
        userId: principal.userId,
        approvalId,
        memoryIds: capturedMemoryIds
      });
    } catch (evidenceError) {
      console.error("[approval-evidence] Failed to reconcile approval evidence after execution:", evidenceError);
    }

    // Send Slack notification about the decision (non-blocking)
    if (isSlackReady()) {
      try {
        const slackChannel = process.env.SLACK_DEFAULT_CHANNEL ?? "#approvals";
        const taskTitle =
          updatedBundle.tasks.find(
            (t) => t.id === updatedBundle.approvals.find((a) => a.id === approvalId)?.taskId
          )?.title ?? "Unknown task";
        const statusEmoji = body.decision === "approved" ? "\u2713" : "\u2717";
        const statusLabel = body.decision === "approved" ? "Approved" : "Rejected";

        await sendNotification({
          channel: slackChannel,
          text: `${statusEmoji} ${statusLabel}: ${taskTitle}`
        });
      } catch (slackError) {
        console.error("[approval] Failed to send Slack notification:", slackError);
      }
    }

    return authenticatedJson({
      bundle: updatedBundle,
      dashboard: await repository.getDashboardData(principal.userId)
    });
  } catch (error) {
    return handleApiError(error, "Failed to respond to approval.");
  }
}
