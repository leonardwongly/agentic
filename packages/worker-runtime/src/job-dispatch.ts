import { createHash } from "node:crypto";
import {
  buildApprovalNotificationDeliveryTarget,
  type ActorContext,
  type ActionIntent,
  type ApprovalDecisionScope,
  type ApprovalFollowUpJobPayload,
  type ApprovalNotificationJobPayload,
  type AutopilotEvent,
  type AutopilotProcessJobPayload,
  type BriefingCreateJobPayload,
  type BriefingType,
  type DeploymentCanaryJobPayload,
  type DocsRenderJobPayload,
  type GoalCreateJobPayload,
  type GoalRefineJobPayload,
  type GitHubIssueIntakeJobPayload,
  type JobRecord,
  type PrivacyOperationJobPayload,
  type PublicShareViewJobPayload,
  type RecommendationRefinementSource,
  type TemplateRunJobPayload
} from "@agentic/contracts";
import { createJobRecord } from "@agentic/execution";
import { logInfo, recordCounter, withSpan } from "@agentic/integrations";
import type { ApprovalQueueRepositoryPort, QueueRepositoryPort } from "@agentic/repository";
import { delay } from "./runtime-delay";
import {
  buildAutopilotProcessJobIdempotencyKey,
  buildAutopilotProcessPayload,
  buildBriefingCreateJobIdempotencyKey,
  buildBriefingCreatePayload,
  buildDeploymentCanaryPayload,
  buildDocsRenderJobIdempotencyKey,
  buildDocsRenderPayload,
  buildGitHubIssueIntakeConcurrencyKey,
  buildGitHubIssueIntakeJobIdempotencyKey,
  buildGitHubIssueIntakePayload,
  buildGoalCreatePayload,
  buildGoalRefinePayload,
  buildPrivacyOperationJobIdempotencyKey,
  buildPrivacyOperationPayload,
  buildPublicShareViewPayload,
  buildTemplateRunPayload,
  type GitHubIssueIntakePayloadParams
} from "./job-payloads";

function stableSerialize(value: unknown, seen = new WeakSet<object>()): string {
  if (value === null) {
    return "null";
  }

  switch (typeof value) {
    case "string":
    case "number":
    case "boolean":
      return JSON.stringify(value);
    case "undefined":
      return "{\"$unsupported\":\"undefined\"}";
    case "bigint":
      return `{"$unsupported":"bigint","value":${JSON.stringify(value.toString())}}`;
    case "symbol":
      return `{"$unsupported":"symbol","value":${JSON.stringify(value.toString())}}`;
    case "function":
      return "{\"$unsupported\":\"function\"}";
  }

  if (Array.isArray(value)) {
    return `[${value.map((item) => stableSerialize(item, seen)).join(",")}]`;
  }

  if (value instanceof Date) {
    return JSON.stringify(value.toISOString());
  }

  if (seen.has(value)) {
    return "{\"$unsupported\":\"circular\"}";
  }

  seen.add(value);
  try {
    return `{${Object.entries(value)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, entry]) => `${JSON.stringify(key)}:${stableSerialize(entry, seen)}`)
      .join(",")}}`;
  } finally {
    seen.delete(value);
  }
}

function buildApprovalFollowUpActionId(params: {
  approvalId: string;
  taskId: string;
  actionIntent?: ActionIntent | null;
}): string {
  const digest = createHash("sha256")
    .update(stableSerialize({
      approvalId: params.approvalId,
      taskId: params.taskId,
      actionIntent: params.actionIntent ?? null
    }))
    .digest("hex")
    .slice(0, 16);
  return `approval-action:${digest}`;
}

function buildApprovalFollowUpPayload(params: {
  approvalId: string;
  goalId: string;
  taskId: string;
  decision: ApprovalFollowUpJobPayload["decision"];
  workspaceId: string | null;
  actionId: string;
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
      replayedFromJobId: params.replayedFromJobId ?? null,
      actionId: params.actionId
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
  actionId: string;
  decision: ApprovalFollowUpJobPayload["decision"];
  replayedFromJobId?: string | null;
}): string {
  const baseKey = `approval-follow-up:${params.approvalId}:${params.actionId}:${params.decision}`;
  return params.replayedFromJobId ? `${baseKey}:replay:${params.replayedFromJobId}` : baseKey;
}

function buildApprovalNotificationJobIdempotencyKey(params: {
  payload: ApprovalNotificationJobPayload;
  replayedFromJobId?: string | null;
}): string {
  const baseKey = `approval-notification:${params.payload.decision}:${buildApprovalNotificationDeliveryTarget(params.payload)}`;
  return params.replayedFromJobId ? `${baseKey}:replay:${params.replayedFromJobId}` : baseKey;
}

function buildPublicDurableJobIdempotencyKey(namespace: string, value: unknown): string {
  return `${namespace}:${createHash("sha256").update(stableSerialize(value)).digest("hex").slice(0, 32)}`;
}

function resolveIdempotencyKey(candidate: string | null | undefined, fallback: () => string): string {
  return candidate?.trim() || fallback();
}

function logEnqueuedJob(job: JobRecord, context: Record<string, unknown>) {
  logInfo("worker.job.enqueued", {
    jobId: job.id,
    jobKind: job.kind,
    userId: job.userId,
    ...context
  });
  recordCounter("worker.job.enqueued.total", 1, {
    jobKind: job.kind
  });
}

export async function enqueueGoalCreateJob(params: {
  repository: QueueRepositoryPort;
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
        idempotencyKey: resolveIdempotencyKey(params.idempotencyKey, () =>
          buildPublicDurableJobIdempotencyKey("goal-create", {
            userId: params.userId,
            request: params.request,
            workspaceId: params.workspaceId,
            agentId: params.agentId
          })
        ),
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
  repository: QueueRepositoryPort;
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
        idempotencyKey: resolveIdempotencyKey(params.idempotencyKey, () =>
          buildPublicDurableJobIdempotencyKey("goal-refine", {
            userId: params.userId,
            goalId: params.goalId,
            workflowId: params.workflowId,
            refinement: params.refinement,
            sourceRecommendation: params.sourceRecommendation ?? null
          })
        ),
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
  repository: QueueRepositoryPort;
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
  repository: QueueRepositoryPort;
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
        idempotencyKey: resolveIdempotencyKey(params.idempotencyKey, () =>
          buildPublicDurableJobIdempotencyKey("template-run", {
            userId: params.userId,
            templateId: params.templateId,
            workspaceId: params.workspaceId
          })
        ),
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
  repository: QueueRepositoryPort;
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

export async function enqueueDeploymentCanaryJob(params: {
  repository: QueueRepositoryPort;
  userId: string;
  actorContext: ActorContext | null;
  requestId: string;
  traceId: string;
  idempotencyKey: string;
}): Promise<JobRecord & { payload: DeploymentCanaryJobPayload }> {
  const now = new Date().toISOString();
  const payload = buildDeploymentCanaryPayload({
    requestId: params.requestId,
    traceId: params.traceId,
    enqueuedAt: now
  });

  return withSpan(
    "worker.job.enqueue.deployment_canary",
    {
      jobKind: "deployment_canary",
      userId: params.userId,
      requestId: params.requestId,
      traceId: params.traceId
    },
    async () => {
      const job = await params.repository.enqueueJob(createJobRecord({
        userId: params.userId,
        kind: "deployment_canary",
        priority: "maintenance",
        queue: "deployment-canary",
        timeoutMs: 30_000,
        payload,
        actorContext: params.actorContext,
        idempotencyKey: params.idempotencyKey,
        maxAttempts: 1
      })) as JobRecord & { payload: DeploymentCanaryJobPayload };

      logEnqueuedJob(job, {
        requestId: params.requestId,
        traceId: params.traceId
      });
      return job;
    }
  );
}

export async function enqueueAutopilotProcessJob(params: {
  repository: QueueRepositoryPort;
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

export async function enqueueGitHubIssueIntakeJob(params: {
  repository: QueueRepositoryPort;
  userId: string;
  actorContext: ActorContext | null;
  payload: GitHubIssueIntakePayloadParams;
  idempotencyKey?: string | null;
}): Promise<JobRecord & { payload: GitHubIssueIntakeJobPayload }> {
  const payload = buildGitHubIssueIntakePayload(params.payload);
  const identity = {
    repositoryFullName: payload.repository.fullName,
    issueNumber: payload.issue.number,
    automationMode: payload.automationMode,
    triggerId: payload.metadata.triggerId
  };

  return withSpan(
    "worker.job.enqueue.github_issue_intake",
    {
      jobKind: "github_issue_intake",
      userId: params.userId,
      repository: payload.repository.fullName,
      issueNumber: payload.issue.number
    },
    async () => {
      const job = await params.repository.enqueueJob(createJobRecord({
        userId: params.userId,
        kind: "github_issue_intake",
        priority: "high",
        queue: "github-issue-intake",
        concurrencyKey: buildGitHubIssueIntakeConcurrencyKey(identity),
        timeoutMs: 10 * 60_000,
        payload,
        actorContext: params.actorContext,
        idempotencyKey: params.idempotencyKey ?? buildGitHubIssueIntakeJobIdempotencyKey(identity),
        maxAttempts: 3
      })) as JobRecord & { payload: GitHubIssueIntakeJobPayload };

      logEnqueuedJob(job, {
        repository: payload.repository.fullName,
        issueNumber: payload.issue.number
      });
      return job;
    }
  );
}

export async function enqueueApprovalFollowUpJob(params: {
  repository: QueueRepositoryPort;
  userId: string;
  approvalId: string;
  goalId: string;
  taskId: string;
  decision: ApprovalFollowUpJobPayload["decision"];
  workspaceId: string | null;
  actorContext: ActorContext | null;
  actionIntent?: ActionIntent | null;
  actionId?: string | null;
  idempotencyKey?: string | null;
  replayedFromJobId?: string | null;
}): Promise<JobRecord & { payload: ApprovalFollowUpJobPayload }> {
  const actionId =
    params.actionId?.trim() ||
    buildApprovalFollowUpActionId({
      approvalId: params.approvalId,
      taskId: params.taskId,
      actionIntent: params.actionIntent ?? null
    });
  const payload = buildApprovalFollowUpPayload({
    approvalId: params.approvalId,
    goalId: params.goalId,
    taskId: params.taskId,
    decision: params.decision,
    workspaceId: params.workspaceId,
    actionId,
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
            actionId,
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

type ApprovalFollowUpBundle = Awaited<ReturnType<ApprovalQueueRepositoryPort["respondToApproval"]>>;
type ApprovalFollowUpJob = JobRecord & { payload: ApprovalFollowUpJobPayload };
type ApprovalFollowUpDecisionParams = {
  repository: ApprovalQueueRepositoryPort;
  userId: string;
  approvalId: string;
  decision: ApprovalFollowUpJobPayload["decision"];
  actorContext: ActorContext;
  scope?: ApprovalDecisionScope;
  rationale?: string | null;
};

// The follow-up job is enqueued after the decision is already durable, so a single lost write
// would strand the approved task; give the transient store faults a couple of short retries.
const FOLLOW_UP_ENQUEUE_ATTEMPTS = 3;
const FOLLOW_UP_ENQUEUE_BACKOFF_MS = [50, 150];

function isAlreadyHandledApprovalError(error: unknown): boolean {
  // Structural check: `ApprovalMutationError` lives in @agentic/repository, which this package
  // deliberately depends on type-only to keep the runtime package graph acyclic.
  return error instanceof Error && (error as { code?: unknown }).code === "already_handled";
}

async function enqueueFollowUpJobWithRecovery(
  repository: ApprovalQueueRepositoryPort,
  job: ApprovalFollowUpJob
): Promise<ApprovalFollowUpJob> {
  let lastError: unknown = null;

  for (let attempt = 0; attempt < FOLLOW_UP_ENQUEUE_ATTEMPTS; attempt += 1) {
    try {
      return (await repository.enqueueJob(job)) as ApprovalFollowUpJob;
    } catch (error) {
      lastError = error;

      if (attempt + 1 < FOLLOW_UP_ENQUEUE_ATTEMPTS) {
        await delay(FOLLOW_UP_ENQUEUE_BACKOFF_MS[attempt] ?? 0);
      }
    }
  }

  throw lastError;
}

/**
 * Recover an approved action whose follow-up job never landed.
 *
 * Without the atomic `respondToApprovalAndEnqueueJob` mutation the fallback commits two
 * separate writes: decide first, enqueue second. If the enqueue fails the decision is already
 * durable, so every later response is rejected as `already_handled` and the task stays
 * "queued" forever with nothing left to replay. Re-drive the job from the persisted decision
 * instead: the payload is deterministic and `enqueueJob` dedupes on the
 * `approval-follow-up:<approvalId>:<actionId>:<decision>` idempotency key, so replaying the
 * missing write yields exactly one job - the guarantee the atomic port gives. Ports without
 * the optional reads cannot be healed here and keep surfacing the original error.
 */
async function redriveLostFollowUpJob(
  params: ApprovalFollowUpDecisionParams,
  buildJob: (bundle: ApprovalFollowUpBundle) => ApprovalFollowUpJob
): Promise<{ bundle: ApprovalFollowUpBundle; job: ApprovalFollowUpJob } | null> {
  const { repository, userId, approvalId, decision } = params;

  if (!repository.listApprovals || !repository.getGoalBundleForUser) {
    return null;
  }

  try {
    const approvals = await repository.listApprovals(userId);
    const approval = approvals.find((candidate) => candidate.id === approvalId);

    if (!approval || approval.decision !== decision) {
      return null;
    }

    const bundle = await repository.getGoalBundleForUser(approval.goalId, userId);
    const recordedApproval = bundle?.approvals.find((candidate) => candidate.id === approvalId);

    if (!bundle || !recordedApproval || recordedApproval.decision !== decision) {
      return null;
    }

    const job = await enqueueFollowUpJobWithRecovery(repository, buildJob(bundle));

    logInfo("worker.job.approval_follow_up.redriven", {
      jobId: job.id,
      jobKind: job.kind,
      userId,
      goalId: job.payload.goalId,
      approvalId
    });
    recordCounter("worker.job.approval_follow_up.redriven.total", 1, { jobKind: job.kind });
    return { bundle, job };
  } catch {
    // Never mask the original rejection of the duplicate response with a recovery failure.
    return null;
  }
}

export async function respondToApprovalAndEnqueueFollowUpJob(params: ApprovalFollowUpDecisionParams): Promise<{
  bundle: ApprovalFollowUpBundle;
  job: ApprovalFollowUpJob;
}> {
  return withSpan(
    "worker.job.enqueue.approval_follow_up.after_decision",
    {
      jobKind: "approval_follow_up",
      userId: params.userId,
      approvalId: params.approvalId
    },
    async () => {
      const buildJob = (bundle: ApprovalFollowUpBundle) => {
        const approval = bundle.approvals.find((candidate) => candidate.id === params.approvalId);

        if (!approval) {
          throw new Error(`Approval ${params.approvalId} is missing after response mutation.`);
        }

        const actionId = buildApprovalFollowUpActionId({
          approvalId: approval.id,
          taskId: approval.taskId,
          actionIntent: approval.actionIntent
        });

        return createJobRecord({
          userId: params.userId,
          kind: "approval_follow_up",
          payload: buildApprovalFollowUpPayload({
            approvalId: approval.id,
            goalId: bundle.goal.id,
            taskId: approval.taskId,
            decision: params.decision,
            workspaceId: bundle.goal.workspaceId,
            actionId,
            replayedFromJobId: null
          }),
          actorContext: params.actorContext,
          idempotencyKey: buildApprovalFollowUpJobIdempotencyKey({
            approvalId: approval.id,
            actionId,
            decision: params.decision,
            replayedFromJobId: null
          }),
          maxAttempts: 1
        }) as JobRecord & { payload: ApprovalFollowUpJobPayload };
      };

      const result = params.repository.respondToApprovalAndEnqueueJob
        ? await params.repository.respondToApprovalAndEnqueueJob({
            approvalId: params.approvalId,
            decision: params.decision,
            actor: params.actorContext,
            scope: params.scope,
            rationale: params.rationale,
            buildJob
          })
        : await (async () => {
            let bundle: ApprovalFollowUpBundle;

            try {
              bundle = await params.repository.respondToApproval({
                approvalId: params.approvalId,
                decision: params.decision,
                actor: params.actorContext,
                scope: params.scope,
                rationale: params.rationale
              });
            } catch (error) {
              // `already_handled` on a two-step port is ambiguous: the reviewer may be
              // double-clicking, or the previous response committed the decision and lost the
              // enqueue. Try the second reading first so the approved action still runs.
              const redriven = isAlreadyHandledApprovalError(error)
                ? await redriveLostFollowUpJob(params, buildJob)
                : null;

              if (!redriven) {
                throw error;
              }

              return redriven;
            }

            const job = await enqueueFollowUpJobWithRecovery(params.repository, buildJob(bundle));
            return { bundle, job };
          })();
      const job = result.job as JobRecord & { payload: ApprovalFollowUpJobPayload };

      logEnqueuedJob(job, {
        goalId: job.payload.goalId,
        approvalId: job.payload.approvalId
      });
      return {
        bundle: result.bundle,
        job
      };
    }
  );
}

export async function enqueueApprovalNotificationJob(params: {
  repository: QueueRepositoryPort;
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
  repository: QueueRepositoryPort;
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
  repository: QueueRepositoryPort;
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
