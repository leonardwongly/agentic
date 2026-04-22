import {
  buildGoalJobResultSummary,
  isApprovalFollowUpJob,
  isApprovalNotificationJob,
  isAutopilotProcessJob
} from "@agentic/worker-runtime";
import { requireApiSession } from "../../../../lib/auth";
import { ApiRouteError, authenticatedJson, handleApiError } from "../../../../lib/api-response";
import { getSeededRepository } from "../../../../lib/server";

type RouteContext = {
  params: Promise<{
    id: string;
  }>;
};

const APPROVAL_JOB_FAILURE_MESSAGE = "Approval follow-up failed. Replay the job or inspect worker logs.";
const APPROVAL_NOTIFICATION_FAILURE_MESSAGE = "Approval notification failed. Replay the job or inspect worker logs.";
const AUTOPILOT_JOB_FAILURE_MESSAGE = "Autopilot event processing failed. Replay the job or inspect worker logs.";

function buildJobJournal(job: {
  journal: {
    lifecycleState: string;
    retryCount: number;
    sideEffectTarget: string | null;
    providerRef: string | null;
    replayedFromJobId: string | null;
    lastUpdatedAt: string;
    recovery: unknown;
    entries: unknown[];
  };
}) {
  return {
    lifecycleState: job.journal.lifecycleState,
    retryCount: job.journal.retryCount,
    sideEffectTarget: job.journal.sideEffectTarget,
    providerRef: job.journal.providerRef,
    replayedFromJobId: job.journal.replayedFromJobId,
    lastUpdatedAt: job.journal.lastUpdatedAt,
    recovery: job.journal.recovery,
    entries: job.journal.entries
  };
}

export async function GET(request: Request, context: RouteContext) {
  try {
    const principal = await requireApiSession(request);
    const { id } = await context.params;

    if (!id.trim()) {
      throw new ApiRouteError(400, "Job id is required.");
    }

    const repository = await getSeededRepository();
    const job = await repository.getJob(id, principal.userId);

    if (isApprovalFollowUpJob(job)) {
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
          journal: buildJobJournal(job),
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
    }

    if (isAutopilotProcessJob(job)) {
      const event = (await repository.listAutopilotEvents(principal.userId)).find(
        (candidate) => candidate.id === job.payload.autopilotEventId
      );

      if (!event) {
        throw new ApiRouteError(404, `Autopilot event ${job.payload.autopilotEventId} was not found.`);
      }

      const responseBody = {
        job: {
          id: job.id,
          kind: job.kind,
          status: job.status,
          autopilotEventId: job.payload.autopilotEventId,
          eventKind: job.payload.kind,
          sourceId: job.payload.sourceId,
          mode: job.payload.mode,
          attemptCount: job.attemptCount,
          maxAttempts: job.maxAttempts,
          journal: buildJobJournal(job),
          createdAt: job.createdAt,
          updatedAt: job.updatedAt
        },
        result: {
          event: {
            id: event.id,
            status: event.status,
            resultGoalId: event.resultGoalId,
            processedAt: event.processedAt,
            details: event.details,
            error: event.error
          },
          goal: null as ReturnType<typeof buildGoalJobResultSummary> | null
        }
      };

      if (event.resultGoalId) {
        const bundle = await repository.getGoalBundleForUser(event.resultGoalId, principal.userId);

        if (bundle) {
          responseBody.result.goal = buildGoalJobResultSummary(bundle);
        }
      }

      if (job.status === "dead_letter") {
        return authenticatedJson({
          ...responseBody,
          error: AUTOPILOT_JOB_FAILURE_MESSAGE
        });
      }

      if (job.status === "completed") {
        return authenticatedJson({
          ...responseBody,
          error: null
        });
      }

      return authenticatedJson(
        {
          ...responseBody,
          error: null
        },
        { status: 202 }
      );
    }

    if (isApprovalNotificationJob(job)) {
      const bundle = await repository.getGoalBundleForUser(job.payload.goalId, principal.userId);

      if (!bundle) {
        throw new Error(`Approval notification goal ${job.payload.goalId} is missing.`);
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
          channel: job.payload.channel,
          attemptCount: job.attemptCount,
          maxAttempts: job.maxAttempts,
          journal: buildJobJournal(job),
          createdAt: job.createdAt,
          updatedAt: job.updatedAt
        },
        result: buildGoalJobResultSummary(bundle)
      };

      if (job.status === "dead_letter") {
        return authenticatedJson({
          ...responseBody,
          error: APPROVAL_NOTIFICATION_FAILURE_MESSAGE
        });
      }

      if (job.status === "completed") {
        return authenticatedJson({
          ...responseBody,
          error: null
        });
      }

      return authenticatedJson(
        {
          ...responseBody,
          error: null
        },
        { status: 202 }
      );
    }

    throw new ApiRouteError(404, `Job ${id} was not found.`);
  } catch (error) {
    return handleApiError(error, "Failed to load job.");
  }
}
