import { z } from "zod";
import { ApprovalMutationError, type AgenticRepository } from "@agentic/repository";
import { enqueueApprovalFollowUpJob } from "@agentic/worker-runtime";
import { requireApiSession } from "../../../../../lib/auth";
import { createActorContextFromPrincipal } from "../../../../../lib/actor-context";
import { ApiRouteError, authenticatedJson, handleApiError, parseJsonBody } from "../../../../../lib/api-response";
import { requireJsonContentType } from "../../../../../lib/api-errors";
import { getSeededRepository } from "../../../../../lib/server";

const ApprovalIdSchema = z.string().trim().min(1).max(200);

const ApprovalResponseSchema = z
  .object({
    decision: z.enum(["approved", "rejected"]),
    scope: z.enum(["once", "similar_24h", "always_review"]).optional(),
    rationale: z.string().trim().max(1000).nullable().optional()
  })
  .strict();

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    requireJsonContentType(request);
    const principal = await requireApiSession(request);
    const actor = createActorContextFromPrincipal(principal);
    const { id } = await context.params;
    const approvalId = ApprovalIdSchema.parse(id);
    const body = await parseJsonBody(request, ApprovalResponseSchema);
    const repository = await getSeededRepository();
    const updatedBundle = await (async () => {
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
    const approval = updatedBundle.approvals.find((candidate) => candidate.id === approvalId);

    if (!approval) {
      throw new Error(`Approval ${approvalId} is missing after response mutation.`);
    }

    const queuedJob = await enqueueApprovalFollowUpJob({
      repository,
      userId: principal.userId,
      approvalId: approval.id,
      goalId: updatedBundle.goal.id,
      taskId: approval.taskId,
      decision: body.decision,
      workspaceId: updatedBundle.goal.workspaceId,
      actorContext: actor
    });

    return authenticatedJson(
      {
        bundle: updatedBundle,
        dashboard: await repository.getDashboardData(principal.userId),
        job: {
          id: queuedJob.id,
          kind: queuedJob.kind,
          status: queuedJob.status,
          goalId: queuedJob.payload.goalId,
          approvalId: queuedJob.payload.approvalId,
          taskId: queuedJob.payload.taskId,
          decision: queuedJob.payload.decision,
          attemptCount: queuedJob.attemptCount,
          maxAttempts: queuedJob.maxAttempts,
          createdAt: queuedJob.createdAt,
          updatedAt: queuedJob.updatedAt
        },
        statusUrl: `/api/approvals/jobs/${queuedJob.id}`
      },
      { status: 202 }
    );
  } catch (error) {
    return handleApiError(error, "Failed to respond to approval.");
  }
}
