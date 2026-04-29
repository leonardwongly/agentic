import { createActorContextFromPrincipal } from "../../../../../lib/actor-context";
import { requireApiSession } from "../../../../../lib/auth";
import { ApiRouteError, authenticatedJson, handleApiError } from "../../../../../lib/api-response";
import { getSeededRepository } from "../../../../../lib/server";
import {
  enqueueApprovalFollowUpJob,
  enqueueApprovalNotificationJob,
  enqueueAutopilotProcessJob
} from "@agentic/worker-runtime";
import {
  ApprovalFollowUpJobPayloadSchema,
  ApprovalNotificationJobPayloadSchema,
  AutopilotProcessJobPayloadSchema
} from "@agentic/contracts";
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

    if (job.kind === "approval_follow_up" && job.payload.type === "approval_follow_up") {
      const followUpPayload = ApprovalFollowUpJobPayloadSchema.parse(job.payload);
      const bundle = await repository.getGoalBundleForUser(followUpPayload.goalId, principal.userId);
      const currentApproval = bundle?.approvals.find(
        (approval) => approval.id === followUpPayload.approvalId && approval.taskId === followUpPayload.taskId
      );
      const replayedJob = await enqueueApprovalFollowUpJob({
        repository,
        userId: principal.userId,
        approvalId: followUpPayload.approvalId,
        goalId: followUpPayload.goalId,
        taskId: followUpPayload.taskId,
        decision: followUpPayload.decision,
        workspaceId: followUpPayload.workspaceId,
        actorContext,
        actionId: followUpPayload.metadata.actionId,
        actionIntent: followUpPayload.metadata.actionId ? null : currentApproval?.actionIntent ?? null,
        replayedFromJobId: job.id
      });

      if (bundle) {
        const failedAtMs = Date.parse(job.updatedAt);
        const replayedAtMs = Date.parse(replayedJob.createdAt);

        bundle.actionLogs.push(
          createActionLog({
            goalId: bundle.goal.id,
            taskId: followUpPayload.taskId,
            workflowId: bundle.workflow.id,
            actor: actorContext.executor.label,
            kind: "approval_follow_up.replayed",
            message: `Replayed approval follow-up job ${job.id} after dead-letter recovery.`,
            details: {
              replayedFromJobId: job.id,
              replayedJobId: replayedJob.id,
              approvalId: followUpPayload.approvalId,
              decision: followUpPayload.decision,
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
            actionId: replayedJob.payload.metadata.actionId,
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

    if (job.kind === "autopilot_process" && job.payload.type === "autopilot_process") {
      const autopilotPayload = AutopilotProcessJobPayloadSchema.parse(job.payload);
      const autopilotEvent = (await repository.listAutopilotEvents(principal.userId)).find(
        (candidate) => candidate.id === autopilotPayload.autopilotEventId
      );

      if (!autopilotEvent) {
        throw new ApiRouteError(404, `Autopilot event ${autopilotPayload.autopilotEventId} was not found.`);
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

    if (job.kind === "approval_notification" && job.payload.type === "approval_notification") {
      const notificationPayload = ApprovalNotificationJobPayloadSchema.parse(job.payload);
      const replayedJob = await enqueueApprovalNotificationJob(
        notificationPayload.channel === "slack"
          ? {
              repository,
              userId: principal.userId,
              approvalId: notificationPayload.approvalId,
              goalId: notificationPayload.goalId,
              taskId: notificationPayload.taskId,
              decision: notificationPayload.decision,
              channel: "slack",
              workspaceId: notificationPayload.workspaceId,
              actorContext,
              replayedFromJobId: job.id
            }
          : notificationPayload.channel === "slack_receipt"
            ? {
                repository,
                userId: principal.userId,
                approvalId: notificationPayload.approvalId,
                goalId: notificationPayload.goalId,
                taskId: notificationPayload.taskId,
                decision: notificationPayload.decision,
                channel: "slack_receipt",
                slackChannelId: notificationPayload.slackChannelId,
                slackMessageTs: notificationPayload.slackMessageTs,
                workspaceId: notificationPayload.workspaceId,
                actorContext,
                replayedFromJobId: job.id
              }
            : {
                repository,
                userId: principal.userId,
                approvalId: notificationPayload.approvalId,
                goalId: notificationPayload.goalId,
                taskId: notificationPayload.taskId,
                decision: notificationPayload.decision,
                channel: "telegram_receipt",
                telegramChatId: notificationPayload.telegramChatId,
                telegramMessageId: notificationPayload.telegramMessageId,
                workspaceId: notificationPayload.workspaceId,
                actorContext,
                replayedFromJobId: job.id
              }
      );

      const bundle = await repository.getGoalBundleForUser(notificationPayload.goalId, principal.userId);

      if (bundle) {
        const failedAtMs = Date.parse(job.updatedAt);
        const replayedAtMs = Date.parse(replayedJob.createdAt);

        bundle.actionLogs.push(
          createActionLog({
            goalId: bundle.goal.id,
            taskId: notificationPayload.taskId,
            workflowId: bundle.workflow.id,
            actor: actorContext.executor.label,
            kind: "approval_notification.replayed",
            message: `Replayed approval notification job ${job.id} after dead-letter recovery.`,
            details: {
              replayedFromJobId: job.id,
              replayedJobId: replayedJob.id,
              approvalId: notificationPayload.approvalId,
              decision: notificationPayload.decision,
              channel: notificationPayload.channel,
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
            goalId: notificationPayload.goalId,
            approvalId: notificationPayload.approvalId,
            taskId: notificationPayload.taskId,
            decision: notificationPayload.decision,
            channel: notificationPayload.channel,
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
