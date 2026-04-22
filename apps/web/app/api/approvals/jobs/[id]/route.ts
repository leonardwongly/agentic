import { buildGoalJobResultSummary, isApprovalFollowUpJob } from "@agentic/worker-runtime";
import { requireApiSession } from "../../../../../lib/auth";
import { ApiRouteError, authenticatedJson, handleApiError } from "../../../../../lib/api-response";
import { getSeededRepository } from "../../../../../lib/server";

type RouteContext = {
  params: Promise<{
    id: string;
  }>;
};

const APPROVAL_JOB_FAILURE_MESSAGE = "Approval follow-up failed. Replay the job or inspect worker logs.";

export async function GET(request: Request, context: RouteContext) {
  try {
    const principal = await requireApiSession(request);
    const { id } = await context.params;

    if (!id.trim()) {
      throw new ApiRouteError(400, "Approval job id is required.");
    }

    const repository = await getSeededRepository();
    const job = await repository.getJob(id, principal.userId);

    if (!isApprovalFollowUpJob(job)) {
      throw new ApiRouteError(404, `Approval job ${id} was not found.`);
    }

    const responseBody = {
      job: {
        id: job.id,
        kind: job.kind,
        status: job.status,
        goalId: job.payload.goalId,
        approvalId: job.payload.approvalId,
        taskId: job.payload.taskId,
        decision: job.payload.decision,
        attemptCount: job.attemptCount,
        maxAttempts: job.maxAttempts,
        journal: {
          lifecycleState: job.journal.lifecycleState,
          retryCount: job.journal.retryCount,
          sideEffectTarget: job.journal.sideEffectTarget,
          providerRef: job.journal.providerRef,
          replayedFromJobId: job.journal.replayedFromJobId,
          lastUpdatedAt: job.journal.lastUpdatedAt,
          recovery: job.journal.recovery,
          entries: job.journal.entries
        },
        createdAt: job.createdAt,
        updatedAt: job.updatedAt
      }
    };

    if (job.status === "completed") {
      const bundle = await repository.getGoalBundleForUser(job.payload.goalId, principal.userId);

      if (!bundle) {
        throw new Error(`Approval goal ${job.payload.goalId} is missing after job completion.`);
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
        error: APPROVAL_JOB_FAILURE_MESSAGE
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
    return handleApiError(error, "Failed to load approval job.");
  }
}
