import { createActorContextFromPrincipal } from "../../../../../lib/actor-context";
import { requireApiSession } from "../../../../../lib/auth";
import { ApiRouteError, authenticatedJson, handleApiError } from "../../../../../lib/api-response";
import { getSeededRepository } from "../../../../../lib/server";
import {
  enqueueApprovalFollowUpJob,
  enqueueApprovalNotificationJob,
  enqueueAutopilotProcessJob,
  isApprovalFollowUpJob,
  isApprovalNotificationJob,
  isAutopilotProcessJob
} from "@agentic/worker-runtime";
import { createActionLog } from "@agentic/integrations";
import {
  canOperateSharedWorkflow,
  getSharedWorkflowDeniedReason,
  resolveWorkspaceRoleForUser
} from "../../../../../lib/workspace-role-permissions";

type RouteContext = {
  params: Promise<{
    id: string;
  }>;
};

export async function POST(request: Request, context: RouteContext) {
  try {
    const principal = await requireApiSession(request);
    const actorContext = createActorContextFromPrincipal(principal);
    const { id } = await context.params;

    if (!id.trim()) {
      throw new ApiRouteError(400, "Job id is required.");
    }

    const repository = await getSeededRepository();
    const job = await repository.getJob(id, principal.userId);

    if (!job) {
      throw new ApiRouteError(404, `Job ${id} was not found.`);
    }

    const sharedWorkspaceId = "workspaceId" in job.payload ? job.payload.workspaceId ?? null : null;

    if (sharedWorkspaceId) {
      const workspaceMembers = await repository.listWorkspaceMembers(sharedWorkspaceId, principal.userId);
      const workspaceRole = resolveWorkspaceRoleForUser(workspaceMembers, sharedWorkspaceId, principal.userId);

      if (!canOperateSharedWorkflow({ workspaceId: sharedWorkspaceId, role: workspaceRole })) {
        throw new ApiRouteError(403, getSharedWorkflowDeniedReason("replay_dead_letter_job"));
      }
    }

    if (job.status !== "dead_letter") {
      throw new ApiRouteError(409, `Job ${id} is not dead-lettered and cannot be replayed.`);
    }

    if (isApprovalFollowUpJob(job)) {
      const replayedJob = await enqueueApprovalFollowUpJob({
        repository,
        userId: principal.userId,
        approvalId: job.payload.approvalId,
        goalId: job.payload.goalId,
        taskId: job.payload.taskId,
        decision: job.payload.decision,
        workspaceId: job.payload.workspaceId,
        actorContext,
        replayedFromJobId: job.id
      });

      const bundle = await repository.getGoalBundleForUser(job.payload.goalId, principal.userId);

      if (bundle) {
        const failedAtMs = Date.parse(job.updatedAt);
        const replayedAtMs = Date.parse(replayedJob.createdAt);

        bundle.actionLogs.push(
          createActionLog({
            goalId: bundle.goal.id,
            taskId: job.payload.taskId,
            workflowId: bundle.workflow.id,
            actor: actorContext.executor.label,
            kind: "approval_follow_up.replayed",
            message: `Replayed approval follow-up job ${job.id} after dead-letter recovery.`,
            details: {
              replayedFromJobId: job.id,
              replayedJobId: replayedJob.id,
              approvalId: job.payload.approvalId,
              decision: job.payload.decision,
              statusUrl: `/api/approvals/jobs/${replayedJob.id}`,
              recoveryLatencyMs:
                Number.isFinite(failedAtMs) && Number.isFinite(replayedAtMs)
                  ? Math.max(0, replayedAtMs - failedAtMs)
                  : null
            },
            prevLog: bundle.actionLogs.at(-1) ?? null
          })
        );

        await repository.saveGoalBundle(bundle);
      }

      return authenticatedJson(
        {
          replayedFromJobId: job.id,
          job: {
            id: replayedJob.id,
            kind: replayedJob.kind,
            status: replayedJob.status,
            goalId: replayedJob.payload.goalId,
            approvalId: replayedJob.payload.approvalId,
            taskId: replayedJob.payload.taskId,
            decision: replayedJob.payload.decision,
            attemptCount: replayedJob.attemptCount,
            maxAttempts: replayedJob.maxAttempts,
            createdAt: replayedJob.createdAt,
            updatedAt: replayedJob.updatedAt
          },
          statusUrl: `/api/approvals/jobs/${replayedJob.id}`,
          dashboard: await repository.getDashboardData(principal.userId)
        },
        { status: 202 }
      );
    }

    if (isAutopilotProcessJob(job)) {
      const autopilotEvent = (await repository.listAutopilotEvents(principal.userId)).find(
        (candidate) => candidate.id === job.payload.autopilotEventId
      );

      if (!autopilotEvent) {
        throw new ApiRouteError(404, `Autopilot event ${job.payload.autopilotEventId} was not found.`);
      }

      const replayedJob = await enqueueAutopilotProcessJob({
        repository,
        autopilotEvent,
        replayedFromJobId: job.id
      });

      await repository.saveAutopilotEvent({
        ...autopilotEvent,
        status: "pending",
        processedAt: null,
        resultGoalId: null,
        error: null,
        details: {
          ...autopilotEvent.details,
          jobId: replayedJob.id,
          jobStatus: "queued",
          replayRequestedAt: replayedJob.createdAt,
          replayRequestedFromJobId: job.id,
          replayedJobId: replayedJob.id,
          recoveryAction: "replay_job",
          requiresReview: false
        }
      });

      return authenticatedJson(
        {
          replayedFromJobId: job.id,
          job: {
            id: replayedJob.id,
            kind: replayedJob.kind,
            status: replayedJob.status,
            autopilotEventId: replayedJob.payload.autopilotEventId,
            eventKind: replayedJob.payload.kind,
            sourceId: replayedJob.payload.sourceId,
            mode: replayedJob.payload.mode,
            attemptCount: replayedJob.attemptCount,
            maxAttempts: replayedJob.maxAttempts,
            createdAt: replayedJob.createdAt,
            updatedAt: replayedJob.updatedAt
          },
          statusUrl: `/api/jobs/${replayedJob.id}`,
          dashboard: await repository.getDashboardData(principal.userId)
        },
        { status: 202 }
      );
    }

    if (isApprovalNotificationJob(job)) {
      const replayedJob = await enqueueApprovalNotificationJob(
        job.payload.channel === "slack"
          ? {
              repository,
              userId: principal.userId,
              approvalId: job.payload.approvalId,
              goalId: job.payload.goalId,
              taskId: job.payload.taskId,
              decision: job.payload.decision,
              channel: "slack",
              workspaceId: job.payload.workspaceId,
              actorContext,
              replayedFromJobId: job.id
            }
          : job.payload.channel === "slack_receipt"
            ? {
                repository,
                userId: principal.userId,
                approvalId: job.payload.approvalId,
                goalId: job.payload.goalId,
                taskId: job.payload.taskId,
                decision: job.payload.decision,
                channel: "slack_receipt",
                slackChannelId: job.payload.slackChannelId,
                slackMessageTs: job.payload.slackMessageTs,
                workspaceId: job.payload.workspaceId,
                actorContext,
                replayedFromJobId: job.id
              }
            : {
                repository,
                userId: principal.userId,
                approvalId: job.payload.approvalId,
                goalId: job.payload.goalId,
                taskId: job.payload.taskId,
                decision: job.payload.decision,
                channel: "telegram_receipt",
                telegramChatId: job.payload.telegramChatId,
                telegramMessageId: job.payload.telegramMessageId,
                workspaceId: job.payload.workspaceId,
                actorContext,
                replayedFromJobId: job.id
              }
      );

      const bundle = await repository.getGoalBundleForUser(job.payload.goalId, principal.userId);

      if (bundle) {
        const failedAtMs = Date.parse(job.updatedAt);
        const replayedAtMs = Date.parse(replayedJob.createdAt);

        bundle.actionLogs.push(
          createActionLog({
            goalId: bundle.goal.id,
            taskId: job.payload.taskId,
            workflowId: bundle.workflow.id,
            actor: actorContext.executor.label,
            kind: "approval_notification.replayed",
            message: `Replayed approval notification job ${job.id} after dead-letter recovery.`,
            details: {
              replayedFromJobId: job.id,
              replayedJobId: replayedJob.id,
              approvalId: job.payload.approvalId,
              decision: job.payload.decision,
              channel: job.payload.channel,
              statusUrl: `/api/jobs/${replayedJob.id}`,
              recoveryLatencyMs:
                Number.isFinite(failedAtMs) && Number.isFinite(replayedAtMs)
                  ? Math.max(0, replayedAtMs - failedAtMs)
                  : null
            },
            prevLog: bundle.actionLogs.at(-1) ?? null
          })
        );

        await repository.saveGoalBundle(bundle);
      }

      return authenticatedJson(
        {
          replayedFromJobId: job.id,
          job: {
            id: replayedJob.id,
            kind: replayedJob.kind,
            status: replayedJob.status,
            goalId: replayedJob.payload.goalId,
            approvalId: replayedJob.payload.approvalId,
            taskId: replayedJob.payload.taskId,
            decision: replayedJob.payload.decision,
            channel: replayedJob.payload.channel,
            attemptCount: replayedJob.attemptCount,
            maxAttempts: replayedJob.maxAttempts,
            createdAt: replayedJob.createdAt,
            updatedAt: replayedJob.updatedAt
          },
          statusUrl: `/api/jobs/${replayedJob.id}`,
          dashboard: await repository.getDashboardData(principal.userId)
        },
        { status: 202 }
      );
    }

    throw new ApiRouteError(409, `Job ${id} cannot be replayed from this endpoint.`);
  } catch (error) {
    return handleApiError(error, "Failed to replay job.");
  }
}
