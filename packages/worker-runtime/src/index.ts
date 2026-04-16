import crypto from "node:crypto";
import {
  createSystemActorContext,
  GoalTemplateSchema,
  nowIso,
  type ActorContext,
  type AutopilotEvent,
  type AutopilotProcessJobPayload,
  type BriefingType,
  type GoalBundle,
  type GoalCreateJobPayload,
  type GoalTemplate,
  type JobKind,
  type JobRecord,
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
  captureMemoriesFromBundle,
  computeNextRun,
  generateBriefing,
  interpolateTemplate,
  processUserRequest
} from "@agentic/orchestrator";
import type { AgenticRepository } from "@agentic/repository";
import {
  SelfImprovementConflictError,
  type SelfImprovementRepository
} from "@agentic/self-improvement-memory";

export const workerJobKindValues = ["goal_create", "autopilot_process"] as const;

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

function buildGoalCreatePayload(params: {
  request: string;
  workspaceId: string | null;
  agentId: string | null;
}): GoalCreateJobPayload {
  return {
    type: "goal_create",
    goalId: crypto.randomUUID(),
    workflowId: crypto.randomUUID(),
    request: params.request,
    workspaceId: params.workspaceId,
    agentId: params.agentId,
    metadata: {}
  };
}

function buildAutopilotProcessPayload(params: {
  autopilotEvent: AutopilotEvent;
}): AutopilotProcessJobPayload {
  return {
    type: "autopilot_process",
    autopilotEventId: params.autopilotEvent.id,
    kind: params.autopilotEvent.kind,
    sourceId: params.autopilotEvent.sourceId,
    mode: params.autopilotEvent.mode,
    metadata: {}
  };
}

function buildAutopilotGoalId(eventId: string): string {
  return `autopilot-goal-${eventId}`;
}

function buildAutopilotWorkflowId(eventId: string): string {
  return `autopilot-workflow-${eventId}`;
}

function buildAutopilotProcessJobIdempotencyKey(eventId: string): string {
  return `autopilot-process:${eventId}`;
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
    console.warn(`[goal-jobs] Agent ${agentId} was not found for user ${userId}; proceeding without override.`);
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
    console.error(`[goal-jobs] Failed to persist captured memories for job ${params.jobId}:`, error);
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

async function executeTemplateEvent(params: {
  repository: AgenticRepository;
  selfImprovementRepository: SelfImprovementRepository;
  userId: string;
  actorContext: ActorContext | null;
  template: GoalTemplate;
  eventId: string;
  jobId: string;
}) {
  const [memories, integrations] = await Promise.all([
    params.repository.listMemory(params.userId),
    params.repository.listIntegrations(params.userId)
  ]);
  const { workspaceId, workspaceGovernance } = await resolveDashboardWorkspaceContext(
    params.repository,
    params.userId
  );
  const bundle = await processUserRequest({
    userId: params.userId,
    workspaceId,
    governance: workspaceGovernance,
    request: interpolateTemplate(params.template),
    memories,
    integrations,
    goalId: buildAutopilotGoalId(params.eventId),
    workflowId: buildAutopilotWorkflowId(params.eventId),
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

export function isAutopilotProcessJob(
  job: JobRecord | null
): job is JobRecord & { payload: AutopilotProcessJobPayload } {
  return job?.kind === "autopilot_process" && job.payload.type === "autopilot_process";
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

  return params.repository.enqueueJob(createJobRecord({
    userId: params.userId,
    kind: "goal_create",
    payload,
    actorContext: params.actorContext,
    idempotencyKey: params.idempotencyKey ?? null,
    maxAttempts: 3
  })) as Promise<JobRecord & { payload: GoalCreateJobPayload }>;
}

export async function enqueueAutopilotProcessJob(params: {
  repository: AgenticRepository;
  autopilotEvent: AutopilotEvent;
}): Promise<JobRecord & { payload: AutopilotProcessJobPayload }> {
  const payload = buildAutopilotProcessPayload({
    autopilotEvent: params.autopilotEvent
  });

  return params.repository.enqueueJob(createJobRecord({
    userId: params.autopilotEvent.userId,
    kind: "autopilot_process",
    payload,
    actorContext: params.autopilotEvent.actorContext,
    idempotencyKey: buildAutopilotProcessJobIdempotencyKey(params.autopilotEvent.id),
    maxAttempts: 3
  })) as Promise<JobRecord & { payload: AutopilotProcessJobPayload }>;
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

export function createWorkerJobHandlers(params: {
  repository: AgenticRepository;
  selfImprovementRepository: SelfImprovementRepository;
  retryPolicy?: Partial<JobRetryPolicy>;
}): JobHandlerMap {
  return {
    goal_create: (job) =>
      executeGoalCreateJob({
        repository: params.repository,
        selfImprovementRepository: params.selfImprovementRepository,
        job
      }),
    autopilot_process: (job) =>
      executeAutopilotProcessJob({
        repository: params.repository,
        selfImprovementRepository: params.selfImprovementRepository,
        job,
        retryPolicy: params.retryPolicy
      })
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
  const queue = createDurableJobQueue(options.repository, {
    runnerId: options.runnerId,
    leaseMs: options.leaseMs,
    retryPolicy: options.retryPolicy
  });
  const handlers = createWorkerJobHandlers({
    repository: options.repository,
    selfImprovementRepository: options.selfImprovementRepository,
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
