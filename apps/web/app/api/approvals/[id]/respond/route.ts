import { z } from "zod";
import { ApprovalMutationError } from "@agentic/repository";
import { respondToApprovalAndEnqueueFollowUpJob } from "@agentic/worker-runtime";
import { ApiRouteError, authenticatedJson } from "../../../../../lib/api-response";
import { createGovernedMutationRoute } from "../../../../../lib/governed-route";
import { getSeededRepository } from "../../../../../lib/server";

const ApprovalIdSchema = z.string().trim().min(1).max(200);

const ApprovalResponseSchema = z
  .object({
    decision: z.enum(["approved", "rejected"]),
    scope: z.enum(["once", "similar_24h", "always_review"]).optional(),
    rationale: z.string().trim().max(1000).nullable().optional()
  })
  .strict();

type RouteContext = { params: Promise<{ id: string }> };

export const POST = createGovernedMutationRoute<z.infer<typeof ApprovalResponseSchema>, RouteContext>(
  {
    route: "api.approvals.respond",
    fallbackError: "Failed to respond to approval.",
    bodySchema: ApprovalResponseSchema,
    rateLimit: {
      namespace: "approval-response",
      error: "Too many approval response requests. Try again later."
    },
    idempotency: "optional"
  },
  async ({ routeContext, principal, actorContext: actor, body }) => {
    const { id } = await routeContext.params;
    const approvalId = ApprovalIdSchema.parse(id);
    const repository = await getSeededRepository();
    const { bundle: updatedBundle, job: queuedJob } = await (async () => {
      try {
        return await respondToApprovalAndEnqueueFollowUpJob({
          repository,
          userId: principal.userId,
          approvalId,
          decision: body.decision,
          actorContext: actor,
          scope: body.scope,
          rationale: body.rationale ?? null
        });
      } catch (error) {
        if (error instanceof ApprovalMutationError) {
          if (error.code === "not_found") {
            throw new ApiRouteError(404, error.message);
          }

          if (error.code === "forbidden") {
            throw new ApiRouteError(403, error.message);
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
          actionId: queuedJob.payload.metadata.actionId,
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
  }
);
