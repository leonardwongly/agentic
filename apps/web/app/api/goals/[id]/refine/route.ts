import { z } from "zod";
import { RecommendationRefinementSourceSchema } from "@agentic/contracts";
import { enqueueGoalRefineJob } from "@agentic/worker-runtime";
import { checkAbuseRateLimit } from "../../../../../lib/abuse-rate-limit";
import { requireApiSession } from "../../../../../lib/auth";
import { createActorContextFromPrincipal } from "../../../../../lib/actor-context";
import {
  ApiRouteError,
  authenticatedJson,
  authenticatedRateLimitError,
  handleApiError,
  parseJsonBody
} from "../../../../../lib/api-response";
import { parseIdempotencyKey } from "../../../../../lib/request-idempotency";
import { getSeededRepository } from "../../../../../lib/server";

const GoalIdSchema = z.string().trim().min(1).max(200);

const RefinementBodySchema = z
  .object({
    message: z.string().trim().min(1).max(2_000),
    sourceRecommendation: RecommendationRefinementSourceSchema.optional()
  })
  .strict();

type RouteContext = {
  params: Promise<{
    id: string;
  }>;
};

export async function POST(request: Request, context: RouteContext) {
  try {
    const principal = await requireApiSession(request);
    const rateLimit = await checkAbuseRateLimit({
      namespace: "goal-refine",
      request,
      principal
    });

    if (!rateLimit.allowed) {
      return authenticatedRateLimitError("Too many goal refinement requests. Try again later.", rateLimit.retryAfterSeconds);
    }

    const actorContext = createActorContextFromPrincipal(principal);
    const { id } = await context.params;
    const goalId = GoalIdSchema.parse(id);
    const body = await parseJsonBody(request, RefinementBodySchema);
    const repository = await getSeededRepository();
    const bundle = await repository.getGoalBundleForUser(goalId, principal.userId);

    if (!bundle) {
      throw new ApiRouteError(404, `Goal ${goalId} was not found.`);
    }

    const job = await enqueueGoalRefineJob({
      repository,
      userId: principal.userId,
      goalId: bundle.goal.id,
      workflowId: bundle.workflow.id,
      refinement: body.message,
      workspaceId: bundle.goal.workspaceId,
      actorContext,
      sourceRecommendation: body.sourceRecommendation ?? null,
      idempotencyKey: parseIdempotencyKey(request)
    });

    return authenticatedJson(
      {
        job: {
          id: job.id,
          kind: job.kind,
          status: job.status,
          goalId: job.payload.goalId,
          attemptCount: job.attemptCount,
          maxAttempts: job.maxAttempts,
          createdAt: job.createdAt,
          updatedAt: job.updatedAt
        },
        statusUrl: `/api/goals/jobs/${job.id}`
      },
      { status: 202 }
    );
  } catch (error) {
    return handleApiError(error, "Failed to refine goal.");
  }
}
