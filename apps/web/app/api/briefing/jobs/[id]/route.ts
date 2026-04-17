import { buildGoalJobResultSummary, isBriefingCreateJob } from "@agentic/worker-runtime";
import { requireApiSession } from "../../../../../lib/auth";
import { ApiRouteError, authenticatedJson, handleApiError } from "../../../../../lib/api-response";
import { getSeededRepository } from "../../../../../lib/server";

type RouteContext = {
  params: Promise<{
    id: string;
  }>;
};

const BRIEFING_JOB_FAILURE_MESSAGE = "Briefing generation failed. Retry the request or inspect worker logs.";

export async function GET(request: Request, context: RouteContext) {
  try {
    const principal = await requireApiSession(request);
    const { id } = await context.params;

    if (!id.trim()) {
      throw new ApiRouteError(400, "Briefing job id is required.");
    }

    const repository = await getSeededRepository();
    const job = await repository.getJob(id, principal.userId);

    if (!isBriefingCreateJob(job)) {
      throw new ApiRouteError(404, `Briefing job ${id} was not found.`);
    }

    const responseBody = {
      job: {
        id: job.id,
        kind: job.kind,
        status: job.status,
        goalId: job.payload.goalId,
        briefingType: job.payload.briefingType,
        attemptCount: job.attemptCount,
        maxAttempts: job.maxAttempts,
        createdAt: job.createdAt,
        updatedAt: job.updatedAt
      }
    };

    if (job.status === "completed") {
      const bundle = await repository.getGoalBundleForUser(job.payload.goalId, principal.userId);

      if (!bundle) {
        throw new Error(`Briefing goal ${job.payload.goalId} is missing after job completion.`);
      }

      return authenticatedJson({
        ...responseBody,
        result: buildGoalJobResultSummary(bundle),
        error: null
      });
    }

    if (job.status === "dead_letter") {
      return authenticatedJson({
        ...responseBody,
        result: null,
        error: BRIEFING_JOB_FAILURE_MESSAGE
      });
    }

    return authenticatedJson(
      {
        ...responseBody,
        result: null,
        error: null
      },
      { status: 202 }
    );
  } catch (error) {
    return handleApiError(error, "Failed to load briefing job.");
  }
}
