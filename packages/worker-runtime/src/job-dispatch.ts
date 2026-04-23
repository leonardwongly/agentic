import {
  buildApprovalNotificationDeliveryTarget,
  type ActorContext,
  type ApprovalFollowUpJobPayload,
  type ApprovalNotificationJobPayload,
  type AutopilotEvent,
  type AutopilotProcessJobPayload,
  type BriefingCreateJobPayload,
  type BriefingType,
  type DocsRenderJobPayload,
  type GoalCreateJobPayload,
  type GoalRefineJobPayload,
  type JobRecord,
  type PrivacyOperationJobPayload,
  type PublicShareViewJobPayload,
  type RecommendationRefinementSource,
  type TemplateRunJobPayload
} from "@agentic/contracts";
import { createJobRecord } from "@agentic/execution";
import { logInfo, recordCounter, withSpan } from "@agentic/integrations";
import type { AgenticRepository } from "@agentic/repository";
import {
  buildAutopilotProcessJobIdempotencyKey,
  buildAutopilotProcessPayload,
  buildBriefingCreateJobIdempotencyKey,
  buildBriefingCreatePayload,
  buildDocsRenderJobIdempotencyKey,
  buildDocsRenderPayload,
  buildGoalCreatePayload,
  buildGoalRefinePayload,
  buildPrivacyOperationJobIdempotencyKey,
  buildPrivacyOperationPayload,
  buildPublicShareViewPayload,
  buildTemplateRunPayload
} from "./job-payloads";

function buildApprovalFollowUpPayload(params: {
  approvalId: string;
  goalId: string;
  taskId: string;
  decision: ApprovalFollowUpJobPayload["decision"];
  workspaceId: string | null;
  replayedFromJobId?: string | null;
}): ApprovalFollowUpJobPayload {
  return {
    type: "approval_follow_up",
    approvalId: params.approvalId,
    goalId: params.goalId,
    taskId: params.taskId,
    decision: params.decision,
    workspaceId: params.workspaceId,
    metadata: {
      replayedFromJobId: params.replayedFromJobId ?? null
    }
  };
}

function buildApprovalNotificationPayload(params: {
  approvalId: string;
  goalId: string;
  taskId: string;
  decision: ApprovalNotificationJobPayload["decision"];
  workspaceId: string | null;
  replayedFromJobId?: string | null;
} & (
  | {
      channel: "slack";
    }
  | {
      channel: "slack_receipt";
      slackChannelId: string;
      slackMessageTs: string;
    }
  | {
      channel: "telegram_receipt";
      telegramChatId: string;
      telegramMessageId: number;
    }
)): ApprovalNotificationJobPayload {
  const basePayload = {
    type: "approval_notification" as const,
    approvalId: params.approvalId,
    goalId: params.goalId,
    taskId: params.taskId,
    decision: params.decision,
    workspaceId: params.workspaceId,
    metadata: {
      replayedFromJobId: params.replayedFromJobId ?? null
    }
  };

  switch (params.channel) {
    case "slack":
      return {
        ...basePayload,
        channel: "slack"
      };
    case "slack_receipt":
      return {
        ...basePayload,
        channel: "slack_receipt",
        slackChannelId: params.slackChannelId,
        slackMessageTs: params.slackMessageTs
      };
    case "telegram_receipt":
      return {
        ...basePayload,
        channel: "telegram_receipt",
        telegramChatId: params.telegramChatId,
        telegramMessageId: params.telegramMessageId
      };
  }
}

function buildApprovalFollowUpJobIdempotencyKey(params: {
  approvalId: string;
  decision: ApprovalFollowUpJobPayload["decision"];
  replayedFromJobId?: string | null;
}): string {
  const baseKey = `approval-follow-up:${params.approvalId}:${params.decision}`;
  return params.replayedFromJobId ? `${baseKey}:replay:${params.replayedFromJobId}` : baseKey;
}

function buildApprovalNotificationJobIdempotencyKey(params: {
  payload: ApprovalNotificationJobPayload;
  replayedFromJobId?: string | null;
}): string {
  const baseKey = `approval-notification:${params.payload.decision}:${buildApprovalNotificationDeliveryTarget(params.payload)}`;
  return params.replayedFromJobId ? `${baseKey}:replay:${params.replayedFromJobId}` : baseKey;
}

export async function enqueueGoalCreateJob(params: {
  repository: AgenticRepository;
  userId: string;
  request: string;
  workspaceId: string | null;
  agentId: string | null;
  actorContext: ActorContext | null;
  idempotencyKey?: string | null;
}): Promise<JobRecord & { payload: GoalCreateJobPayload }> {
  const payload = buildGoalCreatePayload({
    request: params.request,
    workspaceId: params.workspaceId,
    agentId: params.agentId
  });

  return withSpan(
    "worker.job.enqueue.goal_create",
    {
      jobKind: "goal_create",
      userId: params.userId,
      workspaceId: params.workspaceId
    },
    async () => {
      const job = await params.repository.enqueueJob(createJobRecord({
        userId: params.userId,
        kind: "goal_create",
        payload,
        actorContext: params.actorContext,
        idempotencyKey: params.idempotencyKey ?? null,
        maxAttempts: 3
      })) as JobRecord & { payload: GoalCreateJobPayload };

      logInfo("worker.job.enqueued", {
        jobId: job.id,
        jobKind: job.kind,
        userId: job.userId,
        workspaceId: params.workspaceId
      });
      recordCounter("worker.job.enqueued.total", 1, {
        jobKind: job.kind
      });
      return job;
    }
  );
}

export async function enqueueGoalRefineJob(params: {
  repository: AgenticRepository;
  userId: string;
  goalId: string;
  workflowId: string;
  refinement: string;
  workspaceId: string | null;
  actorContext: ActorContext | null;
  sourceRecommendation?: RecommendationRefinementSource | null;
  idempotencyKey?: string | null;
}): Promise<JobRecord & { payload: GoalRefineJobPayload }> {
  const payload = buildGoalRefinePayload({
    goalId: params.goalId,
    workflowId: params.workflowId,
    refinement: params.refinement,
    workspaceId: params.workspaceId,
    sourceRecommendation: params.sourceRecommendation ?? null
  });

  return withSpan(
    "worker.job.enqueue.goal_refine",
    {
      jobKind: "goal_refine",
      userId: params.userId,
      goalId: params.goalId,
      workspaceId: params.workspaceId
    },
    async () => {
      const job = await params.repository.enqueueJob(createJobRecord({
        userId: params.userId,
        kind: "goal_refine",
        payload,
        actorContext: params.actorContext,
        idempotencyKey: params.idempotencyKey ?? null,
        maxAttempts: 3
      })) as JobRecord & { payload: GoalRefineJobPayload };

      logInfo("worker.job.enqueued", {
        jobId: job.id,
        jobKind: job.kind,
        userId: job.userId,
        goalId: params.goalId,
        workspaceId: params.workspaceId
      });
      recordCounter("worker.job.enqueued.total", 1, {
        jobKind: job.kind
      });
      return job;
    }
  );
}

export async function enqueueBriefingCreateJob(params: {
  repository: AgenticRepository;
  userId: string;
  goalId: string;
  workflowId: string;
  briefingType: BriefingType;
  workspaceId: string | null;
  actorContext: ActorContext | null;
  idempotencyKey?: string | null;
}): Promise<JobRecord & { payload: BriefingCreateJobPayload }> {
  const payload = buildBriefingCreatePayload({
    goalId: params.goalId,
    workflowId: params.workflowId,
    briefingType: params.briefingType,
    workspaceId: params.workspaceId
  });

  return withSpan(
    "worker.job.enqueue.briefing_create",
    {
      jobKind: "briefing_create",
      userId: params.userId,
      workspaceId: params.workspaceId,
      briefingType: params.briefingType
    },
    async () => {
      const job = await params.repository.enqueueJob(createJobRecord({
        userId: params.userId,
        kind: "briefing_create",
        payload,
        actorContext: params.actorContext,
        idempotencyKey:
          params.idempotencyKey ?? buildBriefingCreateJobIdempotencyKey(params.goalId, params.briefingType),
        maxAttempts: 3
      })) as JobRecord & { payload: BriefingCreateJobPayload };

      logInfo("worker.job.enqueued", {
        jobId: job.id,
        jobKind: job.kind,
        userId: job.userId,
        workspaceId: params.workspaceId,
        briefingType: params.briefingType
      });
      recordCounter("worker.job.enqueued.total", 1, {
        jobKind: job.kind
      });
      return job;
    }
  );
}

export async function enqueueTemplateRunJob(params: {
  repository: AgenticRepository;
  userId: string;
  templateId: string;
  goalId: string;
  workflowId: string;
  workspaceId: string | null;
  actorContext: ActorContext | null;
  idempotencyKey?: string | null;
}): Promise<JobRecord & { payload: TemplateRunJobPayload }> {
  const payload = buildTemplateRunPayload({
    templateId: params.templateId,
    goalId: params.goalId,
    workflowId: params.workflowId,
    workspaceId: params.workspaceId
  });

  return withSpan(
    "worker.job.enqueue.template_run",
    {
      jobKind: "template_run",
      userId: params.userId,
      workspaceId: params.workspaceId,
      templateId: params.templateId
    },
    async () => {
      const job = await params.repository.enqueueJob(createJobRecord({
        userId: params.userId,
        kind: "template_run",
        payload,
        actorContext: params.actorContext,
        idempotencyKey: params.idempotencyKey ?? null,
        maxAttempts: 3
      })) as JobRecord & { payload: TemplateRunJobPayload };

      logInfo("worker.job.enqueued", {
        jobId: job.id,
        jobKind: job.kind,
        userId: job.userId,
        workspaceId: params.workspaceId,
        templateId: params.templateId
      });
      recordCounter("worker.job.enqueued.total", 1, {
        jobKind: job.kind
      });
      return job;
    }
  );
}

export async function enqueueDocsRenderJob(params: {
  repository: AgenticRepository;
  userId: string;
  actorContext: ActorContext | null;
  idempotencyKey?: string | null;
}): Promise<JobRecord & { payload: DocsRenderJobPayload }> {
  const payload = buildDocsRenderPayload();

  return withSpan(
    "worker.job.enqueue.docs_render",
    {
      jobKind: "docs_render",
      userId: params.userId
    },
    async () => {
      const job = await params.repository.enqueueJob(createJobRecord({
        userId: params.userId,
        kind: "docs_render",
        payload,
        actorContext: params.actorContext,
        idempotencyKey: params.idempotencyKey ?? buildDocsRenderJobIdempotencyKey(params.userId),
        maxAttempts: 3
      })) as JobRecord & { payload: DocsRenderJobPayload };

      logInfo("worker.job.enqueued", {
        jobId: job.id,
        jobKind: job.kind,
        userId: job.userId
      });
      recordCounter("worker.job.enqueued.total", 1, {
        jobKind: job.kind
      });
      return job;
    }
  );
}

export async function enqueueAutopilotProcessJob(params: {
  repository: AgenticRepository;
  autopilotEvent: AutopilotEvent;
  replayedFromJobId?: string | null;
}): Promise<JobRecord & { payload: AutopilotProcessJobPayload }> {
  const payload = buildAutopilotProcessPayload({
    autopilotEvent: params.autopilotEvent,
    replayedFromJobId: params.replayedFromJobId
  });

  return withSpan(
    "worker.job.enqueue.autopilot_process",
    {
      jobKind: "autopilot_process",
      userId: params.autopilotEvent.userId
    },
    async () => {
      const job = await params.repository.enqueueJob(createJobRecord({
        userId: params.autopilotEvent.userId,
        kind: "autopilot_process",
        payload,
        actorContext: params.autopilotEvent.actorContext,
        idempotencyKey: buildAutopilotProcessJobIdempotencyKey({
          eventId: params.autopilotEvent.id,
          replayedFromJobId: params.replayedFromJobId
        }),
        maxAttempts: 3
      })) as JobRecord & { payload: AutopilotProcessJobPayload };

      logInfo("worker.job.enqueued", {
        jobId: job.id,
        jobKind: job.kind,
        userId: job.userId
      });
      recordCounter("worker.job.enqueued.total", 1, {
        jobKind: job.kind
      });
      return job;
    }
  );
}

export async function enqueueApprovalFollowUpJob(params: {
  repository: AgenticRepository;
  userId: string;
  approvalId: string;
  goalId: string;
  taskId: string;
  decision: ApprovalFollowUpJobPayload["decision"];
  workspaceId: string | null;
  actorContext: ActorContext | null;
  idempotencyKey?: string | null;
  replayedFromJobId?: string | null;
}): Promise<JobRecord & { payload: ApprovalFollowUpJobPayload }> {
  const payload = buildApprovalFollowUpPayload({
    approvalId: params.approvalId,
    goalId: params.goalId,
    taskId: params.taskId,
    decision: params.decision,
    workspaceId: params.workspaceId,
    replayedFromJobId: params.replayedFromJobId
  });

  return withSpan(
    "worker.job.enqueue.approval_follow_up",
    {
      jobKind: "approval_follow_up",
      userId: params.userId,
      goalId: params.goalId,
      approvalId: params.approvalId
    },
    async () => {
      const job = await params.repository.enqueueJob(createJobRecord({
        userId: params.userId,
        kind: "approval_follow_up",
        payload,
        actorContext: params.actorContext,
        idempotencyKey:
          params.idempotencyKey ??
          buildApprovalFollowUpJobIdempotencyKey({
            approvalId: params.approvalId,
            decision: params.decision,
            replayedFromJobId: params.replayedFromJobId
          }),
        maxAttempts: 1
      })) as JobRecord & { payload: ApprovalFollowUpJobPayload };

      logInfo("worker.job.enqueued", {
        jobId: job.id,
        jobKind: job.kind,
        userId: job.userId,
        goalId: params.goalId,
        approvalId: params.approvalId
      });
      recordCounter("worker.job.enqueued.total", 1, {
        jobKind: job.kind
      });
      return job;
    }
  );
}

export async function enqueueApprovalNotificationJob(params: {
  repository: AgenticRepository;
  userId: string;
  approvalId: string;
  goalId: string;
  taskId: string;
  decision: ApprovalNotificationJobPayload["decision"];
  workspaceId: string | null;
  actorContext: ActorContext | null;
  idempotencyKey?: string | null;
  replayedFromJobId?: string | null;
} & (
  | {
      channel: "slack";
    }
  | {
      channel: "slack_receipt";
      slackChannelId: string;
      slackMessageTs: string;
    }
  | {
      channel: "telegram_receipt";
      telegramChatId: string;
      telegramMessageId: number;
    }
)): Promise<JobRecord & { payload: ApprovalNotificationJobPayload }> {
  const payload = buildApprovalNotificationPayload({
    approvalId: params.approvalId,
    goalId: params.goalId,
    taskId: params.taskId,
    decision: params.decision,
    workspaceId: params.workspaceId,
    replayedFromJobId: params.replayedFromJobId,
    ...(params.channel === "slack"
      ? { channel: "slack" as const }
      : params.channel === "slack_receipt"
        ? {
            channel: "slack_receipt" as const,
            slackChannelId: params.slackChannelId,
            slackMessageTs: params.slackMessageTs
          }
        : {
            channel: "telegram_receipt" as const,
            telegramChatId: params.telegramChatId,
            telegramMessageId: params.telegramMessageId
          })
  });

  return withSpan(
    "worker.job.enqueue.approval_notification",
    {
      jobKind: "approval_notification",
      userId: params.userId,
      goalId: params.goalId,
      approvalId: params.approvalId,
      channel: params.channel
    },
    async () => {
      const job = await params.repository.enqueueJob(createJobRecord({
        userId: params.userId,
        kind: "approval_notification",
        payload,
        actorContext: params.actorContext,
        idempotencyKey:
          params.idempotencyKey ??
          buildApprovalNotificationJobIdempotencyKey({
            payload,
            replayedFromJobId: params.replayedFromJobId
          })
      })) as JobRecord & { payload: ApprovalNotificationJobPayload };

      logInfo("worker.job.enqueued", {
        jobId: job.id,
        jobKind: job.kind,
        userId: job.userId,
        goalId: params.goalId,
        approvalId: params.approvalId,
        channel: params.channel
      });
      recordCounter("worker.job.enqueued.total", 1, {
        jobKind: job.kind
      });
      return job;
    }
  );
}

export async function enqueuePrivacyOperationJob(params: {
  repository: AgenticRepository;
  operation: {
    id: string;
    workspaceId: string;
    userId: string;
    kind: PrivacyOperationJobPayload["kind"];
    actorContext: ActorContext | null;
  };
}): Promise<JobRecord & { payload: PrivacyOperationJobPayload }> {
  const payload = buildPrivacyOperationPayload({
    operationId: params.operation.id,
    workspaceId: params.operation.workspaceId,
    kind: params.operation.kind
  });

  return withSpan(
    "worker.job.enqueue.privacy_operation",
    {
      jobKind: "privacy_operation",
      userId: params.operation.userId,
      workspaceId: params.operation.workspaceId
    },
    async () => {
      const job = await params.repository.enqueueJob(createJobRecord({
        userId: params.operation.userId,
        kind: "privacy_operation",
        payload,
        actorContext: params.operation.actorContext,
        idempotencyKey: buildPrivacyOperationJobIdempotencyKey(params.operation.id),
        maxAttempts: 3
      })) as JobRecord & { payload: PrivacyOperationJobPayload };

      logInfo("worker.job.enqueued", {
        jobId: job.id,
        jobKind: job.kind,
        userId: job.userId,
        workspaceId: params.operation.workspaceId
      });
      recordCounter("worker.job.enqueued.total", 1, {
        jobKind: job.kind
      });
      return job;
    }
  );
}

export async function enqueuePublicShareViewJob(params: {
  repository: AgenticRepository;
  userId: string;
  shareId: string;
  goalId: string;
  tokenFingerprint: string;
  viewedAt: string;
  actorContext: ActorContext | null;
  idempotencyKey: string;
}): Promise<JobRecord & { payload: PublicShareViewJobPayload }> {
  const payload = buildPublicShareViewPayload({
    shareId: params.shareId,
    goalId: params.goalId,
    tokenFingerprint: params.tokenFingerprint,
    viewedAt: params.viewedAt
  });

  return withSpan(
    "worker.job.enqueue.public_share_view",
    {
      jobKind: "public_share_view",
      userId: params.userId,
      goalId: params.goalId,
      shareId: params.shareId
    },
    async () => {
      const job = await params.repository.enqueueJob(createJobRecord({
        userId: params.userId,
        kind: "public_share_view",
        payload,
        actorContext: params.actorContext,
        idempotencyKey: params.idempotencyKey,
        maxAttempts: 3
      })) as JobRecord & { payload: PublicShareViewJobPayload };

      logInfo("worker.job.enqueued", {
        jobId: job.id,
        jobKind: job.kind,
        userId: job.userId,
        goalId: params.goalId,
        shareId: params.shareId
      });
      recordCounter("worker.job.enqueued.total", 1, {
        jobKind: job.kind
      });
      return job;
    }
  );
}
