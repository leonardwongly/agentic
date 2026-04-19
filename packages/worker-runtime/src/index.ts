import { runDocsBuild } from "@agentic/docs-runtime";
import {
  createSystemActorContext,
  type BriefingCreateJobPayload,
  type DocsRenderJobPayload,
  GoalTemplateSchema,
  nowIso,
  type ActorContext,
  type AutopilotEvent,
  type AutopilotProcessJobPayload,
  type BriefingType,
  type GoalBundle,
  type GoalCreateJobPayload,
  type GoalRefineJobPayload,
  type GoalTemplate,
  type JobKind,
  type JobRecord,
  type PrivacyOperationJobPayload,
  type PublicShareViewJobPayload,
  type TemplateRunJobPayload,
  type Watcher,
  type WorkspaceGovernance
} from "@agentic/contracts";
import {
  computeJobRetryDelayMs,
  createDurableJobQueue,
  createJobRecord,
  processNextDurableJob,
  type ClaimNextJobParams,
  type JobHandlerMap,
  type JobRetryPolicy
} from "@agentic/execution";
import {
  logError,
  logInfo,
  logWarn,
  recordCounter,
  withSpan,
  withTelemetryContext
} from "@agentic/observability";
import {
  captureMemoriesFromBundle,
  computeNextRun,
  generateBriefing,
  interpolateTemplate,
  refineGoal,
  processUserRequest
} from "@agentic/orchestrator";
import type { AgenticRepository } from "@agentic/repository";
import {
  SelfImprovementConflictError,
  type SelfImprovementRepository
} from "@agentic/self-improvement-memory";
import {
  buildAutopilotGoalId,
  buildAutopilotProcessJobIdempotencyKey,
  buildAutopilotProcessPayload,
  buildAutopilotWorkflowId,
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
import { createPublicShareViewedLog } from "./public-share-log";

export const workerJobKindValues = ["goal_create", "goal_refine", "briefing_create", "template_run", "docs_render", "autopilot_process", "privacy_operation", "public_share_view"] as const;

export type GoalJobResultSummary = {
  goalId: string;
  goalStatus: GoalBundle["goal"]["status"];
  taskCount: number;
  completedTaskCount: number;
  pendingApprovalCount: number;
  artifactCount: number;
  watcherCount: number;
  requiresReview: boolean;
};

export type WorkerRuntimeResult = {
  processedCount: number;
  stopReason: "aborted" | "max_jobs";
};

export type WorkerRuntimeOptions = {
  repository: AgenticRepository;
  selfImprovementRepository: SelfImprovementRepository;
  runnerId: string;
  signal?: AbortSignal;
  pollIntervalMs?: number;
  leaseMs?: number;
  retryPolicy?: Partial<JobRetryPolicy>;
  maxJobs?: number;
  claim?: ClaimNextJobParams;
};

class AutopilotExecutionError extends Error {
  readonly safeForUsers = true;
}

async function resolveGoalCreateGovernance(
  repository: AgenticRepository,
  userId: string,
  workspaceId: string | null
): Promise<WorkspaceGovernance | null> {
  if (!workspaceId) {
    return null;
  }

  return repository.getWorkspaceGovernance(workspaceId, userId);
}

async function resolveGoalCreateAgentDefinition(
  repository: AgenticRepository,
  userId: string,
  agentId: string | null
) {
  if (!agentId) {
    return undefined;
  }

  try {
    return (await repository.getAgent(agentId, userId)) ?? undefined;
  } catch {
    logWarn("goal_job.agent_override_missing", {
      agentId,
      userId
    });
    return undefined;
  }
}

async function persistCapturedMemories(params: {
  repository: AgenticRepository;
  selfImprovementRepository: SelfImprovementRepository;
  userId: string;
  actorContext: ActorContext | null;
  jobId: string;
  bundle: GoalBundle;
}) {
  if (params.bundle.goal.status !== "completed") {
    return;
  }

  try {
    const captured = captureMemoriesFromBundle(
      params.bundle,
      params.userId,
      params.actorContext ?? createSystemActorContext(params.userId)
    );

    await Promise.all(captured.memories.map((memory) => params.repository.saveMemory(memory)));

    for (const episode of captured.episodes) {
      try {
        await params.selfImprovementRepository.appendEpisode(episode);
      } catch (error) {
        if (error instanceof SelfImprovementConflictError) {
          continue;
        }

        throw error;
      }
    }
  } catch (error) {
    logError("goal_job.memory_capture_failed", error, {
      jobId: params.jobId,
      userId: params.userId
    });
    throw error;
  }
}

async function resolveDashboardWorkspaceContext(repository: AgenticRepository, userId: string) {
  const dashboard = await repository.getDashboardData(userId);
  const workspaceId = dashboard.activeWorkspace?.id ?? null;

  return {
    workspaceId,
    workspaceGovernance: workspaceId
      ? dashboard.workspaceGovernance ?? await repository.getWorkspaceGovernance(workspaceId, userId)
      : null
  };
}

async function findAutopilotEvent(repository: AgenticRepository, userId: string, eventId: string) {
  const events = await repository.listAutopilotEvents(userId);
  return events.find((event) => event.id === eventId) ?? null;
}

async function resolveWatcherExecutionSource(repository: AgenticRepository, sourceId: string, userId: string) {
  const watchers = await repository.listWatchers({ userId });
  const watcher = watchers.find((candidate) => candidate.id === sourceId);

  if (!watcher) {
    throw new AutopilotExecutionError(`Watcher ${sourceId} was not found.`);
  }

  if (watcher.status !== "active") {
    throw new AutopilotExecutionError(`Watcher ${sourceId} is not active.`);
  }

  const goal = await repository.getGoalBundleForUser(watcher.goalId, userId);

  if (!goal) {
    throw new AutopilotExecutionError(`Watcher goal ${watcher.goalId} was not found.`);
  }

  return {
    watcher,
    goal
  };
}

async function resolveTemplateExecutionSource(repository: AgenticRepository, sourceId: string, userId: string) {
  const templates = await repository.listTemplates(userId);
  const template = templates.find((candidate) => candidate.id === sourceId);

  if (!template) {
    throw new AutopilotExecutionError(`Template ${sourceId} was not found.`);
  }

  if (!template.schedule.enabled) {
    throw new AutopilotExecutionError(`Template ${sourceId} does not have scheduling enabled.`);
  }

  return {
    template
  };
}

async function resolveBriefingExecutionSource(repository: AgenticRepository, sourceId: string, userId: string) {
  const preferences = await repository.getBriefingPreferences(userId);
  const schedule = preferences.schedules.find((candidate) => candidate.type === sourceId);

  if (!schedule?.enabled) {
    throw new AutopilotExecutionError(`Briefing ${sourceId} is not enabled.`);
  }

  return {
    type: sourceId as BriefingType,
    preferences
  };
}

function buildWatcherAutopilotRequest(watcher: Watcher): string {
  return [
    `Watcher "${watcher.targetEntity}" triggered.`,
    `Condition: ${watcher.condition}.`,
    `Required response: ${watcher.triggerAction}.`,
    watcher.sourceSystems.length > 0 ? `Source systems: ${watcher.sourceSystems.join(", ")}.` : ""
  ]
    .filter(Boolean)
    .join(" ");
}

function measureProcessingLatencyMs(createdAt: string, processedAt: string): number {
  const createdMs = Date.parse(createdAt);
  const processedMs = Date.parse(processedAt);

  if (!Number.isFinite(createdMs) || !Number.isFinite(processedMs)) {
    return 0;
  }

  return Math.max(0, processedMs - createdMs);
}

function summarizeExecutionOutcome(bundle: GoalBundle, createdAt: string, processedAt: string): Record<string, unknown> {
  const pendingApprovalCount = bundle.approvals.filter((approval) => approval.decision === "pending").length;
  const approvedApprovalCount = bundle.approvals.filter((approval) => approval.decision === "approved").length;
  const rejectedApprovalCount = bundle.approvals.filter((approval) => approval.decision === "rejected").length;
  const completedTaskCount = bundle.tasks.filter((task) => task.state === "completed").length;
  const failedTaskCount = bundle.tasks.filter((task) => task.state === "failed").length;
  const blockedTaskCount = bundle.tasks.filter((task) => task.state === "blocked").length;
  const waitingTaskCount = bundle.tasks.filter((task) => task.state === "waiting").length;
  const requiresReview = pendingApprovalCount > 0 || failedTaskCount > 0 || blockedTaskCount > 0;
  const recoveryAction =
    pendingApprovalCount > 0
      ? "review_approvals"
      : failedTaskCount > 0 || blockedTaskCount > 0
        ? "inspect_failed_tasks"
        : "none";
  const tasksNeedingRecovery = failedTaskCount + blockedTaskCount;
  const resultSummary =
    pendingApprovalCount > 0
      ? `${pendingApprovalCount} approval${pendingApprovalCount === 1 ? "" : "s"} pending review.`
      : tasksNeedingRecovery > 0
        ? `${tasksNeedingRecovery} task${tasksNeedingRecovery === 1 ? "" : "s"} need recovery.`
        : `${completedTaskCount}/${bundle.tasks.length} tasks completed without additional review.`;

  return {
    goalStatus: bundle.goal.status,
    taskCount: bundle.tasks.length,
    completedTaskCount,
    failedTaskCount,
    blockedTaskCount,
    waitingTaskCount,
    pendingApprovalCount,
    approvedApprovalCount,
    rejectedApprovalCount,
    artifactCount: bundle.artifacts.length,
    actionLogCount: bundle.actionLogs.length,
    requiresReview,
    recoveryAction,
    resultSummary,
    processingLatencyMs: measureProcessingLatencyMs(createdAt, processedAt)
  };
}

function sanitizeAutopilotError(error: unknown): string {
  if (error instanceof AutopilotExecutionError && error.safeForUsers) {
    return error.message;
  }

  return "Autopilot execution failed.";
}

function summarizeExecutionFailure(params: {
  createdAt: string;
  processedAt: string;
  job: JobRecord & { payload: AutopilotProcessJobPayload };
  retryPolicy?: Partial<JobRetryPolicy>;
}): Record<string, unknown> {
  const willRetry = params.job.attemptCount < params.job.maxAttempts;
  const nextRetryAt = willRetry
    ? new Date(
        Date.parse(params.processedAt) + computeJobRetryDelayMs(params.job.attemptCount, params.retryPolicy)
      ).toISOString()
    : null;

  return {
    failureStage: "execution",
    requiresReview: true,
    recoveryAction: willRetry ? "worker_retry_scheduled" : "review_event_error",
    processingLatencyMs: measureProcessingLatencyMs(params.createdAt, params.processedAt),
    jobId: params.job.id,
    jobAttemptCount: params.job.attemptCount,
    jobMaxAttempts: params.job.maxAttempts,
    jobStatus: willRetry ? "retrying" : "dead_letter",
    nextRetryAt
  };
}

async function executeWatcherEvent(params: {
  repository: AgenticRepository;
  selfImprovementRepository: SelfImprovementRepository;
  userId: string;
  actorContext: ActorContext | null;
  watcher: Watcher;
  goal: GoalBundle;
  eventId: string;
  jobId: string;
}) {
  const [memories, integrations] = await Promise.all([
    params.repository.listMemory(params.userId),
    params.repository.listIntegrations(params.userId)
  ]);
  const governance = params.goal.goal.workspaceId
    ? await params.repository.getWorkspaceGovernance(params.goal.goal.workspaceId, params.userId)
    : null;
  const bundle = await processUserRequest({
    userId: params.userId,
    workspaceId: params.goal.goal.workspaceId,
    governance,
    request: buildWatcherAutopilotRequest(params.watcher),
    memories,
    integrations,
    goalId: buildAutopilotGoalId(params.eventId),
    workflowId: buildAutopilotWorkflowId(params.eventId),
    resolveAgentMetrics: (agentIdOrName) => params.repository.getAgentMetrics(agentIdOrName, "all", params.userId)
  });

  await params.repository.saveGoalBundle(bundle);
  await persistCapturedMemories({
    repository: params.repository,
    selfImprovementRepository: params.selfImprovementRepository,
    userId: params.userId,
    actorContext: params.actorContext,
    jobId: params.jobId,
    bundle
  });
  return bundle;
}

async function runTemplateExecution(params: {
  repository: AgenticRepository;
  selfImprovementRepository: SelfImprovementRepository;
  userId: string;
  actorContext: ActorContext | null;
  template: GoalTemplate;
  goalId: string;
  workflowId: string;
  workspaceId: string | null;
  workspaceGovernance: WorkspaceGovernance | null;
  jobId: string;
}) {
  const [memories, integrations] = await Promise.all([
    params.repository.listMemory(params.userId),
    params.repository.listIntegrations(params.userId)
  ]);
  const bundle = await processUserRequest({
    userId: params.userId,
    workspaceId: params.workspaceId,
    governance: params.workspaceGovernance,
    request: interpolateTemplate(params.template),
    memories,
    integrations,
    goalId: params.goalId,
    workflowId: params.workflowId,
    resolveAgentMetrics: (agentIdOrName) => params.repository.getAgentMetrics(agentIdOrName, "all", params.userId)
  });

  await params.repository.saveGoalBundle(bundle);
  await params.repository.saveTemplate(
    GoalTemplateSchema.parse({
      ...params.template,
      schedule: {
        ...params.template.schedule,
        lastRunAt: nowIso(),
        nextRunAt:
          params.template.schedule.enabled && params.template.schedule.cron
            ? computeNextRun(params.template.schedule.cron, params.template.schedule.timezone)
            : null
      },
      actorContext: params.actorContext,
      updatedAt: nowIso()
    })
  );
  await persistCapturedMemories({
    repository: params.repository,
    selfImprovementRepository: params.selfImprovementRepository,
    userId: params.userId,
    actorContext: params.actorContext,
    jobId: params.jobId,
    bundle
  });
  return bundle;
}

async function executeTemplateEvent(params: {
  repository: AgenticRepository;
  selfImprovementRepository: SelfImprovementRepository;
  userId: string;
  actorContext: ActorContext | null;
  template: GoalTemplate;
  eventId: string;
  jobId: string;
}) {
  const { workspaceId, workspaceGovernance } = await resolveDashboardWorkspaceContext(
    params.repository,
    params.userId
  );
  return runTemplateExecution({
    repository: params.repository,
    selfImprovementRepository: params.selfImprovementRepository,
    userId: params.userId,
    actorContext: params.actorContext,
    template: params.template,
    goalId: buildAutopilotGoalId(params.eventId),
    workflowId: buildAutopilotWorkflowId(params.eventId),
    workspaceId,
    workspaceGovernance,
    jobId: params.jobId
  });
}

async function executeBriefingEvent(params: {
  repository: AgenticRepository;
  selfImprovementRepository: SelfImprovementRepository;
  userId: string;
  actorContext: ActorContext | null;
  type: BriefingType;
  eventId: string;
  jobId: string;
}) {
  const [preferences, memories, integrations, approvals, watchers] = await Promise.all([
    params.repository.getBriefingPreferences(params.userId),
    params.repository.listMemory(params.userId),
    params.repository.listIntegrations(params.userId),
    params.repository.listApprovals(params.userId),
    params.repository.listWatchers({ userId: params.userId })
  ]);
  const { workspaceId, workspaceGovernance } = await resolveDashboardWorkspaceContext(
    params.repository,
    params.userId
  );
  const bundle = await generateBriefing({
    type: params.type,
    userId: params.userId,
    workspaceId,
    governance: workspaceGovernance,
    preferences,
    memories,
    integrations,
    pendingApprovals: approvals.filter((approval) => approval.decision === "pending"),
    activeWatchers: watchers.filter((watcher) => watcher.status === "active"),
    goalId: buildAutopilotGoalId(params.eventId),
    workflowId: buildAutopilotWorkflowId(params.eventId),
    resolveAgentMetrics: (agentIdOrName) => params.repository.getAgentMetrics(agentIdOrName, "all", params.userId)
  });

  await params.repository.saveGoalBundle(bundle);
  await persistCapturedMemories({
    repository: params.repository,
    selfImprovementRepository: params.selfImprovementRepository,
    userId: params.userId,
    actorContext: params.actorContext,
    jobId: params.jobId,
    bundle
  });
  return bundle;
}

export function isGoalCreateJob(job: JobRecord | null): job is JobRecord & { payload: GoalCreateJobPayload } {
  return job?.kind === "goal_create" && job.payload.type === "goal_create";
}

export function isGoalRefineJob(job: JobRecord | null): job is JobRecord & { payload: GoalRefineJobPayload } {
  return job?.kind === "goal_refine" && job.payload.type === "goal_refine";
}

export function isBriefingCreateJob(
  job: JobRecord | null
): job is JobRecord & { payload: BriefingCreateJobPayload } {
  return job?.kind === "briefing_create" && job.payload.type === "briefing_create";
}

export function isTemplateRunJob(job: JobRecord | null): job is JobRecord & { payload: TemplateRunJobPayload } {
  return job?.kind === "template_run" && job.payload.type === "template_run";
}

export function isDocsRenderJob(job: JobRecord | null): job is JobRecord & { payload: DocsRenderJobPayload } {
  return job?.kind === "docs_render" && job.payload.type === "docs_render";
}

export function isAutopilotProcessJob(
  job: JobRecord | null
): job is JobRecord & { payload: AutopilotProcessJobPayload } {
  return job?.kind === "autopilot_process" && job.payload.type === "autopilot_process";
}

export function isPrivacyOperationJob(
  job: JobRecord | null
): job is JobRecord & { payload: PrivacyOperationJobPayload } {
  return job?.kind === "privacy_operation" && job.payload.type === "privacy_operation";
}

export function isPublicShareViewJob(
  job: JobRecord | null
): job is JobRecord & { payload: PublicShareViewJobPayload } {
  return job?.kind === "public_share_view" && job.payload.type === "public_share_view";
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
  idempotencyKey?: string | null;
}): Promise<JobRecord & { payload: GoalRefineJobPayload }> {
  const payload = buildGoalRefinePayload({
    goalId: params.goalId,
    workflowId: params.workflowId,
    refinement: params.refinement,
    workspaceId: params.workspaceId
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
}): Promise<JobRecord & { payload: AutopilotProcessJobPayload }> {
  const payload = buildAutopilotProcessPayload({
    autopilotEvent: params.autopilotEvent
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
        idempotencyKey: buildAutopilotProcessJobIdempotencyKey(params.autopilotEvent.id),
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

export async function executeGoalCreateJob(params: {
  repository: AgenticRepository;
  selfImprovementRepository: SelfImprovementRepository;
  job: JobRecord;
}) {
  const { job, repository } = params;

  if (!isGoalCreateJob(job)) {
    throw new Error(`Expected a goal_create payload for job ${job.id}.`);
  }

  const governance = await resolveGoalCreateGovernance(repository, job.userId, job.payload.workspaceId);
  const [memories, integrations, agentDefinition] = await Promise.all([
    repository.listMemory(job.userId),
    repository.listIntegrations(job.userId),
    resolveGoalCreateAgentDefinition(repository, job.userId, job.payload.agentId)
  ]);
  const bundle = await processUserRequest({
    userId: job.userId,
    request: job.payload.request,
    workspaceId: job.payload.workspaceId,
    governance,
    memories,
    integrations,
    agentDefinition,
    goalId: job.payload.goalId,
    workflowId: job.payload.workflowId,
    resolveAgentMetrics: (agentIdOrName) => repository.getAgentMetrics(agentIdOrName, "all", job.userId)
  });

  await repository.saveGoalBundle(bundle);
  await persistCapturedMemories({
    repository,
    selfImprovementRepository: params.selfImprovementRepository,
    userId: job.userId,
    actorContext: job.actorContext,
    jobId: job.id,
    bundle
  });
}

export async function executeGoalRefineJob(params: {
  repository: AgenticRepository;
  selfImprovementRepository: SelfImprovementRepository;
  job: JobRecord;
}) {
  const { job, repository } = params;

  if (!isGoalRefineJob(job)) {
    throw new Error(`Expected a goal_refine payload for job ${job.id}.`);
  }

  const bundle = await repository.getGoalBundleForUser(job.payload.goalId, job.userId);

  if (!bundle) {
    throw new Error(`Goal ${job.payload.goalId} was not found.`);
  }

  const [memories, governance] = await Promise.all([
    repository.listMemory(job.userId),
    job.payload.workspaceId
      ? repository.getWorkspaceGovernance(job.payload.workspaceId, job.userId)
      : Promise.resolve(null)
  ]);
  const updatedBundle = await refineGoal({
    bundle,
    refinement: job.payload.refinement,
    memories,
    actorContext: job.actorContext,
    governance,
    resolveAgentMetrics: (agentIdOrName) => repository.getAgentMetrics(agentIdOrName, "all", job.userId)
  });

  await repository.saveGoalBundle(updatedBundle);
}

export async function executeBriefingCreateJob(params: {
  repository: AgenticRepository;
  selfImprovementRepository: SelfImprovementRepository;
  job: JobRecord;
}) {
  const { job, repository } = params;

  if (!isBriefingCreateJob(job)) {
    throw new Error(`Expected a briefing_create payload for job ${job.id}.`);
  }

  const governance = job.payload.workspaceId
    ? await repository.getWorkspaceGovernance(job.payload.workspaceId, job.userId)
    : null;
  const [preferences, memories, integrations, approvals, watchers] = await Promise.all([
    repository.getBriefingPreferences(job.userId),
    repository.listMemory(job.userId),
    repository.listIntegrations(job.userId),
    repository.listApprovals(job.userId),
    repository.listWatchers({ userId: job.userId })
  ]);
  const bundle = await generateBriefing({
    type: job.payload.briefingType,
    userId: job.userId,
    workspaceId: job.payload.workspaceId,
    governance,
    preferences,
    memories,
    integrations,
    pendingApprovals: approvals.filter((approval) => approval.decision === "pending"),
    activeWatchers: watchers.filter((watcher) => watcher.status === "active"),
    goalId: job.payload.goalId,
    workflowId: job.payload.workflowId,
    resolveAgentMetrics: (agentIdOrName) => repository.getAgentMetrics(agentIdOrName, "all", job.userId)
  });

  await repository.saveGoalBundle(bundle);
  await persistCapturedMemories({
    repository,
    selfImprovementRepository: params.selfImprovementRepository,
    userId: job.userId,
    actorContext: job.actorContext,
    jobId: job.id,
    bundle
  });
}

export async function executeTemplateRunJob(params: {
  repository: AgenticRepository;
  selfImprovementRepository: SelfImprovementRepository;
  job: JobRecord;
}) {
  const { job, repository } = params;

  if (!isTemplateRunJob(job)) {
    throw new Error(`Expected a template_run payload for job ${job.id}.`);
  }

  const templates = await repository.listTemplates(job.userId);
  const template = templates.find((candidate) => candidate.id === job.payload.templateId);

  if (!template) {
    throw new Error(`Template ${job.payload.templateId} was not found.`);
  }

  await runTemplateExecution({
    repository,
    selfImprovementRepository: params.selfImprovementRepository,
    userId: job.userId,
    actorContext: job.actorContext,
    template,
    goalId: job.payload.goalId,
    workflowId: job.payload.workflowId,
    workspaceId: job.payload.workspaceId,
    workspaceGovernance:
      job.payload.workspaceId ? await repository.getWorkspaceGovernance(job.payload.workspaceId, job.userId) : null,
    jobId: job.id
  });
}

export async function executeDocsRenderJob(params: {
  job: JobRecord;
}) {
  const { job } = params;

  if (!isDocsRenderJob(job)) {
    throw new Error(`Expected a docs_render payload for job ${job.id}.`);
  }

  await runDocsBuild();
}

export async function executeAutopilotProcessJob(params: {
  repository: AgenticRepository;
  selfImprovementRepository: SelfImprovementRepository;
  job: JobRecord;
  retryPolicy?: Partial<JobRetryPolicy>;
}) {
  const { job, repository } = params;

  if (!isAutopilotProcessJob(job)) {
    throw new Error(`Expected an autopilot_process payload for job ${job.id}.`);
  }

  const event = await findAutopilotEvent(repository, job.userId, job.payload.autopilotEventId);

  if (!event) {
    throw new AutopilotExecutionError(`Autopilot event ${job.payload.autopilotEventId} was not found.`);
  }

  try {
    let bundle: GoalBundle;

    if (job.payload.kind === "watcher_triggered") {
      const { watcher, goal } = await resolveWatcherExecutionSource(repository, job.payload.sourceId, job.userId);
      bundle = await executeWatcherEvent({
        repository,
        selfImprovementRepository: params.selfImprovementRepository,
        userId: job.userId,
        actorContext: job.actorContext,
        watcher,
        goal,
        eventId: event.id,
        jobId: job.id
      });
    } else if (job.payload.kind === "template_due") {
      const { template } = await resolveTemplateExecutionSource(repository, job.payload.sourceId, job.userId);
      bundle = await executeTemplateEvent({
        repository,
        selfImprovementRepository: params.selfImprovementRepository,
        userId: job.userId,
        actorContext: job.actorContext,
        template,
        eventId: event.id,
        jobId: job.id
      });
    } else {
      const { type } = await resolveBriefingExecutionSource(repository, job.payload.sourceId, job.userId);
      bundle = await executeBriefingEvent({
        repository,
        selfImprovementRepository: params.selfImprovementRepository,
        userId: job.userId,
        actorContext: job.actorContext,
        type,
        eventId: event.id,
        jobId: job.id
      });
    }

    const processedAt = nowIso();
    await repository.saveAutopilotEvent({
      ...event,
      status: "executed",
      processedAt,
      resultGoalId: bundle.goal.id,
      details: {
        ...event.details,
        jobId: job.id,
        jobAttemptCount: job.attemptCount,
        jobMaxAttempts: job.maxAttempts,
        jobStatus: "completed",
        ...summarizeExecutionOutcome(bundle, event.createdAt, processedAt)
      },
      error: null
    });
  } catch (error) {
    const processedAt = nowIso();
    await repository.saveAutopilotEvent({
      ...event,
      status: "failed",
      processedAt,
      details: {
        ...event.details,
        ...summarizeExecutionFailure({
          createdAt: event.createdAt,
          processedAt,
          job,
          retryPolicy: params.retryPolicy
        })
      },
      error: sanitizeAutopilotError(error)
    });
    throw error;
  }
}

function sanitizePrivacyOperationError(kind: PrivacyOperationJobPayload["kind"]): string {
  switch (kind) {
    case "workspace_export":
      return "Workspace export failed.";
    case "workspace_delete":
      return "Workspace deletion failed.";
    case "retention_enforcement":
      return "Retention enforcement failed.";
    default:
      return "Privacy operation failed.";
  }
}

export async function executePrivacyOperationJob(params: {
  repository: AgenticRepository;
  job: JobRecord;
}) {
  const { job, repository } = params;

  if (!isPrivacyOperationJob(job)) {
    throw new Error(`Expected a privacy_operation payload for job ${job.id}.`);
  }

  const operation = await repository.getPrivacyOperation(job.payload.operationId, job.userId);

  if (!operation) {
    throw new Error(`Privacy operation ${job.payload.operationId} was not found.`);
  }

  if (operation.kind !== job.payload.kind || operation.workspaceId !== job.payload.workspaceId) {
    throw new Error(`Privacy operation ${operation.id} no longer matches the queued job payload.`);
  }

  const startedAt = nowIso();
  const runningOperation = await repository.savePrivacyOperation({
    ...operation,
    status: "running",
    startedAt,
    completedAt: null,
    error: null,
    updatedAt: startedAt
  });

  try {
    let result: Record<string, unknown>;

    switch (job.payload.kind) {
      case "workspace_export": {
        const audit = await repository.exportWorkspaceAudit(job.payload.workspaceId, job.userId);
        result = {
          workspaceId: audit.workspaceId,
          fileName: audit.fileName,
          contentType: audit.contentType,
          generatedAt: audit.generatedAt,
          contentLength: Buffer.byteLength(audit.content, "utf8")
        };
        break;
      }
      case "retention_enforcement": {
        const retentionDays = operation.details.retentionDays;

        if (typeof retentionDays !== "number" || !Number.isInteger(retentionDays) || retentionDays < 0) {
          throw new Error(`Privacy operation ${operation.id} is missing a valid retention policy.`);
        }

        result = await repository.enforceWorkspaceRetention({
          workspaceId: job.payload.workspaceId,
          userId: job.userId,
          retentionDays,
          now: startedAt
        });
        break;
      }
      case "workspace_delete":
        result = await repository.deleteWorkspaceData({
          workspaceId: job.payload.workspaceId,
          userId: job.userId,
          operationId: operation.id,
          now: startedAt
        });
        break;
    }

    const completedAt = nowIso();
    await repository.savePrivacyOperation({
      ...runningOperation,
      status: "completed",
      result,
      completedAt,
      error: null,
      updatedAt: completedAt
    });
  } catch (error) {
    const completedAt = nowIso();

    await repository.savePrivacyOperation({
      ...runningOperation,
      status: "failed",
      completedAt,
      error: sanitizePrivacyOperationError(job.payload.kind),
      updatedAt: completedAt
    });

    throw error;
  }
}

function shouldAdvanceLastViewedAt(current: string | null, candidate: string): boolean {
  if (!current) {
    return true;
  }

  const currentTimestamp = Date.parse(current);
  const candidateTimestamp = Date.parse(candidate);

  if (!Number.isFinite(currentTimestamp) || !Number.isFinite(candidateTimestamp)) {
    return true;
  }

  return candidateTimestamp >= currentTimestamp;
}

export async function executePublicShareViewJob(params: {
  repository: AgenticRepository;
  job: JobRecord;
}) {
  const { job, repository } = params;

  if (!isPublicShareViewJob(job)) {
    throw new Error(`Expected a public_share_view payload for job ${job.id}.`);
  }

  const share = await repository.getGoalShare(job.payload.shareId, job.userId);

  if (!share || share.goalId !== job.payload.goalId || share.status !== "active" || Date.parse(share.expiresAt) <= Date.now()) {
    return;
  }

  const bundle = await repository.getGoalBundle(job.payload.goalId);

  if (!bundle) {
    return;
  }

  const viewedLog = createPublicShareViewedLog(
    bundle,
    job.payload.shareId,
    job.payload.tokenFingerprint,
    Date.parse(job.payload.viewedAt)
  );
  const shouldUpdateShare = shouldAdvanceLastViewedAt(share.lastViewedAt, job.payload.viewedAt);

  if (!viewedLog && !shouldUpdateShare) {
    return;
  }

  const writes: Array<Promise<unknown>> = [];

  if (shouldUpdateShare) {
    writes.push(
      repository.saveGoalShare({
        ...share,
        lastViewedAt: job.payload.viewedAt,
        updatedAt: nowIso()
      })
    );
  }

  if (viewedLog) {
    writes.push(
      repository.saveGoalBundle({
        ...bundle,
        actionLogs: [...bundle.actionLogs, viewedLog]
      })
    );
  }

  await Promise.all(writes);
}

export function createWorkerJobHandlers(params: {
  repository: AgenticRepository;
  selfImprovementRepository: SelfImprovementRepository;
  runnerId: string;
  retryPolicy?: Partial<JobRetryPolicy>;
}): JobHandlerMap {
  const wrapHandler = (jobKind: JobKind, execute: (job: JobRecord) => Promise<void>) => {
    return (job: JobRecord) =>
      withTelemetryContext(
        {
          jobId: job.id,
          jobKind,
          runnerId: params.runnerId,
          userId: job.userId
        },
        async () =>
          withSpan(
            "worker.job.execute",
            {
              jobId: job.id,
              jobKind,
              runnerId: params.runnerId,
              userId: job.userId
            },
            async () => {
              logInfo("worker.job.started", {
                jobId: job.id,
                jobKind,
                runnerId: params.runnerId,
                attemptCount: job.attemptCount
              });

              try {
                await execute(job);
                recordCounter("worker.job.succeeded.total", 1, {
                  jobKind,
                  runnerId: params.runnerId
                });
                logInfo("worker.job.completed", {
                  jobId: job.id,
                  jobKind,
                  runnerId: params.runnerId,
                  attemptCount: job.attemptCount
                });
              } catch (error) {
                recordCounter("worker.job.failed.total", 1, {
                  jobKind,
                  runnerId: params.runnerId
                });
                logError("worker.job.failed", error, {
                  jobId: job.id,
                  jobKind,
                  runnerId: params.runnerId,
                  attemptCount: job.attemptCount
                });
                throw error;
              }
            }
          )
      );
  };

  return {
    goal_create: wrapHandler("goal_create", (job) =>
      executeGoalCreateJob({
        repository: params.repository,
        selfImprovementRepository: params.selfImprovementRepository,
        job
    })),
    goal_refine: wrapHandler("goal_refine", (job) =>
      executeGoalRefineJob({
        repository: params.repository,
        selfImprovementRepository: params.selfImprovementRepository,
        job
      })),
    briefing_create: wrapHandler("briefing_create", (job) =>
      executeBriefingCreateJob({
        repository: params.repository,
        selfImprovementRepository: params.selfImprovementRepository,
        job
      })),
    template_run: wrapHandler("template_run", (job) =>
      executeTemplateRunJob({
        repository: params.repository,
        selfImprovementRepository: params.selfImprovementRepository,
        job
      })),
    docs_render: wrapHandler("docs_render", (job) =>
      executeDocsRenderJob({
        job
      })),
    autopilot_process: wrapHandler("autopilot_process", (job) =>
      executeAutopilotProcessJob({
        repository: params.repository,
        selfImprovementRepository: params.selfImprovementRepository,
        job,
        retryPolicy: params.retryPolicy
      })),
    privacy_operation: wrapHandler("privacy_operation", (job) =>
      executePrivacyOperationJob({
        repository: params.repository,
        job
      })),
    public_share_view: wrapHandler("public_share_view", (job) =>
      executePublicShareViewJob({
        repository: params.repository,
        job
      }))
  };
}

export function buildGoalJobResultSummary(bundle: GoalBundle): GoalJobResultSummary {
  const completedTaskCount = bundle.tasks.filter((task) => task.state === "completed").length;
  const pendingApprovalCount = bundle.approvals.filter((approval) => approval.decision === "pending").length;
  const requiresReview =
    pendingApprovalCount > 0 ||
    bundle.tasks.some((task) => task.state === "blocked" || task.state === "failed");

  return {
    goalId: bundle.goal.id,
    goalStatus: bundle.goal.status,
    taskCount: bundle.tasks.length,
    completedTaskCount,
    pendingApprovalCount,
    artifactCount: bundle.artifacts.length,
    watcherCount: bundle.watchers.length,
    requiresReview
  };
}

function shouldClaimJob(jobKind: JobKind, filters: readonly JobKind[] | undefined): boolean {
  return !filters || filters.length === 0 || filters.includes(jobKind);
}

function delay(ms: number, signal?: AbortSignal): Promise<void> {
  if (ms <= 0) {
    return Promise.resolve();
  }

  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", abort);
      resolve();
    }, ms);

    function abort() {
      clearTimeout(timer);
      signal?.removeEventListener("abort", abort);
      resolve();
    }

    signal?.addEventListener("abort", abort, { once: true });
  });
}

export async function runWorkerRuntime(options: WorkerRuntimeOptions): Promise<WorkerRuntimeResult> {
  return withTelemetryContext(
    {
      runnerId: options.runnerId
    },
    async () => {
      const queue = createDurableJobQueue(options.repository, {
        runnerId: options.runnerId,
        leaseMs: options.leaseMs,
        retryPolicy: options.retryPolicy
      });
      const handlers = createWorkerJobHandlers({
        repository: options.repository,
        selfImprovementRepository: options.selfImprovementRepository,
        runnerId: options.runnerId,
        retryPolicy: options.retryPolicy
      });
      const pollIntervalMs = Math.max(50, options.pollIntervalMs ?? 1_000);
      let processedCount = 0;

      while (!options.signal?.aborted) {
        const result = await processNextDurableJob({
          queue,
          handlers,
          claim: options.claim
        });

        if (result.claimedJob) {
          if (!shouldClaimJob(result.claimedJob.kind, options.claim?.kinds)) {
            throw new Error(`Worker claimed unexpected job kind "${result.claimedJob.kind}".`);
          }

          processedCount += 1;
          recordCounter("worker.loop.processed.total", 1, {
            runnerId: options.runnerId,
            jobKind: result.claimedJob.kind
          });

          if (options.maxJobs && processedCount >= options.maxJobs) {
            return {
              processedCount,
              stopReason: "max_jobs"
            };
          }

          continue;
        }

        await delay(pollIntervalMs, options.signal);
      }

      return {
        processedCount,
        stopReason: "aborted"
      };
    }
  );
}
