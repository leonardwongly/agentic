import {
  AutopilotProcessJobPayloadSchema,
  buildApprovalNotificationDeliveryTarget,
  createSystemActorContext,
  type ApprovalNotificationJobPayload,
  type ApprovalFollowUpJobPayload,
  GoalTemplateSchema,
  nowIso,
  type ActorContext,
  type AutopilotEvent,
  type AutopilotProcessJobPayload,
  type BriefingType,
  type EvidenceRecord,
  type GoalBundle,
  type GoalTemplate,
  type JobKind,
  type JobRecord,
  type PrivacyOperationJobPayload,
  type Watcher,
  type WorkspaceGovernance
} from "@agentic/contracts";
import {
  computeJobRetryDelayMs,
  createDurableJobQueue,
  createJobRecord,
  processNextDurableJob,
  type ClaimNextJobParams,
  type JobConcurrencyLimits,
  type JobHandlerContext,
  type JobHandlerMap,
  type JobRetryPolicy
} from "@agentic/execution";
import {
  createLocalNote,
  isSlackReady,
  isTelegramReady,
  logError,
  logInfo,
  logWarn,
  recordCounter,
  sendNotification,
  updateMessage,
  updateTelegramMessage,
  withSpan,
  withTelemetryContext
} from "@agentic/integrations";
import {
  captureApprovalOutcomeSignals,
  captureExecutionOutcomeSignals,
  captureMemoriesFromBundle,
  computeNextRun,
  executeApprovedTasks,
  generateBriefing,
  interpolateTemplate,
  reconcileExecutionResults,
  refineGoal,
  processUserRequest
} from "@agentic/orchestrator";
import type { AgenticRepository } from "@agentic/repository";
import type { SelfImprovementRepository } from "@agentic/self-improvement-memory";
import {
  buildAutopilotEventFabricRequest,
  getAutopilotEventFabricEnvelope,
  isEventFabricAutopilotKind,
  resolveAutopilotEventFabricExecutionContext
} from "./autopilot-event-fabric";
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
import {
  enqueueApprovalFollowUpJob,
  enqueueApprovalNotificationJob,
  enqueueGitHubIssueIntakeJob,
  respondToApprovalAndEnqueueFollowUpJob
} from "./job-dispatch";
import { executeGitHubIssueIntakeJob } from "./github-issue-intake-executor";
import {
  createPolicyReplayValidationResolver,
  executeBriefingCreateJob,
  executeDocsRenderJob,
  executeGoalCreateJob,
  executeGoalRefineJob,
  isBriefingCreateJob,
  isDocsRenderJob,
  isGoalCreateJob,
  isGoalRefineJob,
  isTemplateRunJob,
  executeTemplateRunJob,
  persistCapturedMemories,
} from "./job-executors-core";
import {
  executePrivacyOperationJob,
  executePublicShareViewJob
} from "./privacy-share-executors";
import { persistCapturedSignals } from "./memory-capture-signals";
import { createPublicShareViewedLog } from "./public-share-log";
import { resolveGoogleWorkspaceAdapters } from "./google-workspace-adapters";
import { delay } from "./runtime-delay";
import {
  createWorkerRuntimeImmuneSystem,
  type WorkerRuntimeImmuneSystemControls
} from "./runtime-immune-system";
import { getScheduledAutopilotDueTime } from "./scheduled-autopilot-due-time";
import {
  createWorkerRuntimeHealthReporter,
  type WorkerRuntimeHealthSink
} from "./worker-health";

export {
  enqueueApprovalFollowUpJob,
  enqueueApprovalNotificationJob,
  respondToApprovalAndEnqueueFollowUpJob,
  enqueueAutopilotProcessJob,
  enqueueBriefingCreateJob,
  enqueueDocsRenderJob,
  enqueueGitHubIssueIntakeJob,
  enqueueGoalCreateJob,
  enqueueGoalRefineJob,
  enqueuePrivacyOperationJob,
  enqueuePublicShareViewJob,
  enqueueTemplateRunJob
} from "./job-dispatch";
export {
  buildGoalJobResultSummary,
  createPolicyReplayValidationResolver,
  executeBriefingCreateJob,
  executeDocsRenderJob,
  executeGoalCreateJob,
  executeGoalRefineJob,
  isBriefingCreateJob,
  isDocsRenderJob,
  isGoalCreateJob,
  isGoalRefineJob,
  isTemplateRunJob,
  executeTemplateRunJob,
  persistCapturedMemories
} from "./job-executors-core";
export type { GoalJobResultSummary } from "./job-executors-core";
export { executeGitHubIssueIntakeJob, isGitHubIssueIntakeJob } from "./github-issue-intake-executor";
export { executePrivacyOperationJob, executePublicShareViewJob } from "./privacy-share-executors";
export {
  runWatcherSchedulerLoop,
  runWatcherSchedulerOnce,
  type WatcherSchedulerResult,
  type WatcherSchedulerDecision
} from "./watcher-scheduler";
export {
  createFileWorkerRuntimeHealthSink,
  createWorkerRuntimeHealthSnapshot,
  readFileWorkerRuntimeHealthSnapshot,
  updateWorkerRuntimeHealthSnapshot,
  type WorkerRuntimeHealthSink,
  type WorkerRuntimeHealthSnapshot
} from "./worker-health";
export type { WorkerRuntimeImmuneSystemControls } from "./runtime-immune-system";

export const workerJobKindValues = [
  "goal_create",
  "goal_refine",
  "briefing_create",
  "template_run",
  "docs_render",
  "autopilot_process",
  "github_issue_intake",
  "approval_follow_up",
  "approval_notification",
  "privacy_operation",
  "public_share_view"
] as const;

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
  concurrencyLimits?: JobConcurrencyLimits;
  retryJitterRatio?: number;
  requireIdempotencyForRetry?: boolean;
  maxJobs?: number;
  claim?: ClaimNextJobParams;
  immuneSystem?: Partial<WorkerRuntimeImmuneSystemControls>;
  health?: {
    sink: WorkerRuntimeHealthSink;
    intervalMs?: number;
    schedulerEnabled?: boolean;
  };
};

export type WorkerQueueHealthSummary = {
  queuedDepth: number;
  retryingDepth: number;
  deadLetterDepth: number;
  activeLeaseCount: number;
  expiredLeaseCount: number;
  queuedByPriority: Partial<Record<JobRecord["priority"], number>>;
  runningByKind: Partial<Record<JobKind, number>>;
};

class AutopilotExecutionError extends Error {
  readonly safeForUsers = true;
}

function mergeIds(...groups: Array<string[] | undefined>): string[] {
  return Array.from(new Set(groups.flatMap((group) => group ?? [])));
}

async function finalizeApprovalEvidenceRecord(params: {
  repository: AgenticRepository;
  bundle: GoalBundle;
  userId: string;
  approvalId: string;
  memoryIds: string[];
}): Promise<EvidenceRecord | null> {
  const { repository, bundle, userId, approvalId, memoryIds } = params;
  const approval = bundle.approvals.find((candidate) => candidate.id === approvalId);

  if (!approval || approval.decision === "pending") {
    return null;
  }

  const task = bundle.tasks.find((candidate) => candidate.id === approval.taskId);
  const evidenceRecord =
    (await repository.listEvidenceRecords({ userId, approvalId }))
      .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))
      .at(0) ?? null;

  if (!evidenceRecord) {
    return null;
  }

  const relatedActionLogIds = bundle.actionLogs
    .filter(
      (log) => log.taskId === approval.taskId || (typeof log.details.approvalId === "string" && log.details.approvalId === approvalId)
    )
    .map((log) => log.id);
  const relatedArtifactIds = bundle.artifacts
    .filter((artifact) => artifact.taskId === approval.taskId)
    .map((artifact) => artifact.id);

  return repository.saveEvidenceRecord({
    ...evidenceRecord,
    resultingTaskState: task?.state ?? evidenceRecord.resultingTaskState,
    resultingGoalStatus: bundle.goal.status,
    actionLogIds: mergeIds(evidenceRecord.actionLogIds, relatedActionLogIds),
    artifactIds: mergeIds(
      evidenceRecord.artifactIds,
      relatedArtifactIds,
      approval.actionIntent?.type === "manual_review" ? approval.actionIntent.artifactIds : undefined
    ),
    memoryIds: mergeIds(evidenceRecord.memoryIds, memoryIds),
    updatedAt: new Date().toISOString()
  });
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

type GenericAutopilotExecutionKind = Exclude<AutopilotEvent["kind"], "watcher_triggered" | "template_due" | "briefing_due">;

function normalizeAutopilotText(value: unknown, maxLength = 160): string | null {
  if (typeof value !== "string") {
    return null;
  }

  const normalized = value.trim().replace(/\s+/g, " ");

  if (!normalized) {
    return null;
  }

  return normalized.slice(0, maxLength);
}

function readAutopilotDetail(details: AutopilotEvent["details"], keys: readonly string[], maxLength = 160): string | null {
  for (const key of keys) {
    const direct = normalizeAutopilotText(details[key], maxLength);

    if (direct) {
      return direct;
    }

    const value = details[key];

    if (Array.isArray(value)) {
      const items = value
        .map((candidate) => normalizeAutopilotText(candidate, Math.min(80, maxLength)))
        .filter((candidate): candidate is string => Boolean(candidate))
        .slice(0, 4);

      if (items.length > 0) {
        return items.join(", ");
      }
    }
  }

  return null;
}

function appendAutopilotDetail(lines: string[], label: string, value: string | null) {
  if (value) {
    lines.push(`${label}: ${value}.`);
  }
}

function buildGenericAutopilotRequest(event: AutopilotEvent): string {
  const summary = normalizeAutopilotText(event.summary, 240) ?? "No summary provided";
  const sourceId = normalizeAutopilotText(event.sourceId, 120) ?? "unknown-source";
  const lines = [`Autopilot trigger "${event.kind}" needs follow-up.`, `Summary: ${summary}.`, `Source reference: ${sourceId}.`];

  switch (event.kind as GenericAutopilotExecutionKind) {
    case "communication_received":
      appendAutopilotDetail(lines, "Sender", readAutopilotDetail(event.details, ["sender", "from", "contact", "customer"], 80));
      appendAutopilotDetail(lines, "Channel", readAutopilotDetail(event.details, ["channel", "provider", "service"], 80));
      appendAutopilotDetail(lines, "Subject", readAutopilotDetail(event.details, ["subject", "threadSubject", "title"], 140));
      appendAutopilotDetail(lines, "Message excerpt", readAutopilotDetail(event.details, ["snippet", "message", "bodyPreview"], 220));
      lines.push("Triage urgency, identify the required next response, and draft the safest follow-up workflow.");
      break;
    case "deadline_drift_detected":
      appendAutopilotDetail(lines, "Workflow", readAutopilotDetail(event.details, ["workflowName", "goalTitle", "title"], 140));
      appendAutopilotDetail(lines, "Deadline", readAutopilotDetail(event.details, ["deadline", "deadlineAt", "dueAt"], 100));
      appendAutopilotDetail(lines, "Owner", readAutopilotDetail(event.details, ["owner", "assignee"], 100));
      appendAutopilotDetail(lines, "Risk signal", readAutopilotDetail(event.details, ["reason", "status", "risk"], 180));
      lines.push("Assess the slip risk, identify blockers, and produce a recovery workflow that gets execution back on track.");
      break;
    case "workflow_stalled":
      appendAutopilotDetail(lines, "Workflow", readAutopilotDetail(event.details, ["workflowName", "goalTitle", "title"], 140));
      appendAutopilotDetail(lines, "Blocked step", readAutopilotDetail(event.details, ["blockedStep", "pendingTasks", "blockedTasks"], 140));
      appendAutopilotDetail(lines, "Owner", readAutopilotDetail(event.details, ["owner", "assignee"], 100));
      appendAutopilotDetail(lines, "Stall reason", readAutopilotDetail(event.details, ["reason", "status", "risk"], 180));
      lines.push("Diagnose the stall, recommend the next unblock path, and create a governed recovery workflow.");
      break;
    case "approval_sla_breached":
      appendAutopilotDetail(lines, "Approval", readAutopilotDetail(event.details, ["approvalTitle", "title", "queue"], 140));
      appendAutopilotDetail(lines, "Approver", readAutopilotDetail(event.details, ["approver", "owner"], 100));
      appendAutopilotDetail(lines, "Escalation channel", readAutopilotDetail(event.details, ["channel", "escalationPath"], 120));
      appendAutopilotDetail(lines, "Current status", readAutopilotDetail(event.details, ["status", "reason"], 180));
      lines.push("Prepare the safest escalation, document the overdue approval risk, and recommend the next governed action.");
      break;
    case "connector_failed":
      appendAutopilotDetail(lines, "Connector", readAutopilotDetail(event.details, ["connector", "provider", "service"], 120));
      appendAutopilotDetail(lines, "Failure mode", readAutopilotDetail(event.details, ["error", "failureMode", "reason"], 180));
      appendAutopilotDetail(lines, "Impact", readAutopilotDetail(event.details, ["impact", "workflowName", "goalTitle"], 180));
      appendAutopilotDetail(lines, "Retry posture", readAutopilotDetail(event.details, ["retryAfter", "retryWindow", "nextRetryAt"], 120));
      lines.push("Assess blast radius, recommend the safest recovery plan, and capture any manual fallback steps operators should take.");
      break;
    case "dormant_workflow_review_due":
      appendAutopilotDetail(lines, "Workflow", readAutopilotDetail(event.details, ["workflowName", "goalTitle", "title"], 140));
      appendAutopilotDetail(lines, "Dormant since", readAutopilotDetail(event.details, ["inactiveSince", "lastUpdatedAt", "lastActivityAt"], 120));
      appendAutopilotDetail(lines, "Pending work", readAutopilotDetail(event.details, ["pendingTasks", "blockedTasks", "openApprovals"], 140));
      appendAutopilotDetail(lines, "Review reason", readAutopilotDetail(event.details, ["reason", "status"], 180));
      lines.push("Review whether the workflow should be reactivated, closed, or re-scoped, and produce the appropriate follow-up plan.");
      break;
  }

  return lines.join(" ");
}

async function executeGenericAutopilotEvent(params: {
  repository: AgenticRepository;
  selfImprovementRepository: SelfImprovementRepository;
  userId: string;
  actorContext: ActorContext | null;
  event: AutopilotEvent;
  jobId: string;
  signal?: AbortSignal;
}) {
  const requestedWorkspaceId = normalizeAutopilotText(params.event.details.workspaceId, 200);
  let workspaceId = requestedWorkspaceId;
  let workspaceGovernance = requestedWorkspaceId
    ? await params.repository.getWorkspaceGovernance(requestedWorkspaceId, params.userId)
    : null;

  if (!workspaceId) {
    const dashboardContext = await resolveDashboardWorkspaceContext(params.repository, params.userId);
    workspaceId = dashboardContext.workspaceId;
    workspaceGovernance = dashboardContext.workspaceGovernance;
  }

  const [memories, integrations, episodes] = await Promise.all([
    params.repository.listMemory(params.userId),
    params.repository.listIntegrations(params.userId),
    params.selfImprovementRepository.listEpisodes()
  ]);
  const resolvePolicyReplayValidation = createPolicyReplayValidationResolver(episodes);
  const bundle = await processUserRequest({
    userId: params.userId,
    workspaceId,
    governance: workspaceGovernance,
    request: buildGenericAutopilotRequest(params.event),
    memories,
    integrations,
    goalId: buildAutopilotGoalId(params.event.id),
    workflowId: buildAutopilotWorkflowId(params.event.id),
    resolveAgentMetrics: (agentIdOrName) => params.repository.getAgentMetrics(agentIdOrName, "all", params.userId),
    resolvePolicyReplayValidation
  });

  params.signal?.throwIfAborted();
  await params.repository.saveGoalBundle(bundle);
  params.signal?.throwIfAborted();
  await persistCapturedMemories({
    repository: params.repository,
    selfImprovementRepository: params.selfImprovementRepository,
    userId: params.userId,
    actorContext: params.actorContext,
    jobId: params.jobId,
    bundle,
    governance: workspaceGovernance
  });
  return bundle;
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
  signal?: AbortSignal;
}) {
  const [memories, integrations, episodes] = await Promise.all([
    params.repository.listMemory(params.userId),
    params.repository.listIntegrations(params.userId),
    params.selfImprovementRepository.listEpisodes()
  ]);
  const governance = params.goal.goal.workspaceId
    ? await params.repository.getWorkspaceGovernance(params.goal.goal.workspaceId, params.userId)
    : null;
  const resolvePolicyReplayValidation = createPolicyReplayValidationResolver(episodes);
  const bundle = await processUserRequest({
    userId: params.userId,
    workspaceId: params.goal.goal.workspaceId,
    governance,
    request: buildWatcherAutopilotRequest(params.watcher),
    memories,
    integrations,
    goalId: buildAutopilotGoalId(params.eventId),
    workflowId: buildAutopilotWorkflowId(params.eventId),
    resolveAgentMetrics: (agentIdOrName) => params.repository.getAgentMetrics(agentIdOrName, "all", params.userId),
    resolvePolicyReplayValidation
  });

  params.signal?.throwIfAborted();
  await params.repository.saveGoalBundle(bundle);
  params.signal?.throwIfAborted();
  await persistCapturedMemories({
    repository: params.repository,
    selfImprovementRepository: params.selfImprovementRepository,
    userId: params.userId,
    actorContext: params.actorContext,
    jobId: params.jobId,
    bundle,
    governance
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
  signal?: AbortSignal;
}) {
  const [memories, integrations, episodes] = await Promise.all([
    params.repository.listMemory(params.userId),
    params.repository.listIntegrations(params.userId),
    params.selfImprovementRepository.listEpisodes()
  ]);
  const resolvePolicyReplayValidation = createPolicyReplayValidationResolver(episodes);
  const bundle = await processUserRequest({
    userId: params.userId,
    workspaceId: params.workspaceId,
    governance: params.workspaceGovernance,
    request: interpolateTemplate(params.template),
    memories,
    integrations,
    goalId: params.goalId,
    workflowId: params.workflowId,
    resolveAgentMetrics: (agentIdOrName) => params.repository.getAgentMetrics(agentIdOrName, "all", params.userId),
    resolvePolicyReplayValidation
  });

  params.signal?.throwIfAborted();
  await params.repository.saveGoalBundle(bundle);
  params.signal?.throwIfAborted();
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
  params.signal?.throwIfAborted();
  await persistCapturedMemories({
    repository: params.repository,
    selfImprovementRepository: params.selfImprovementRepository,
    userId: params.userId,
    actorContext: params.actorContext,
    jobId: params.jobId,
    bundle,
    governance: params.workspaceGovernance
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
  signal?: AbortSignal;
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
    jobId: params.jobId,
    signal: params.signal
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
  signal?: AbortSignal;
}) {
  const [preferences, memories, integrations, approvals, watchers, episodes] = await Promise.all([
    params.repository.getBriefingPreferences(params.userId),
    params.repository.listMemory(params.userId),
    params.repository.listIntegrations(params.userId),
    params.repository.listApprovals(params.userId),
    params.repository.listWatchers({ userId: params.userId }),
    params.selfImprovementRepository.listEpisodes()
  ]);
  const { workspaceId, workspaceGovernance } = await resolveDashboardWorkspaceContext(
    params.repository,
    params.userId
  );
  const resolvePolicyReplayValidation = createPolicyReplayValidationResolver(episodes);
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
    resolveAgentMetrics: (agentIdOrName) => params.repository.getAgentMetrics(agentIdOrName, "all", params.userId),
    resolvePolicyReplayValidation
  });

  params.signal?.throwIfAborted();
  await params.repository.saveGoalBundle(bundle);
  params.signal?.throwIfAborted();
  await persistCapturedMemories({
    repository: params.repository,
    selfImprovementRepository: params.selfImprovementRepository,
    userId: params.userId,
    actorContext: params.actorContext,
    jobId: params.jobId,
    bundle,
    governance: workspaceGovernance
  });
  return bundle;
}

async function executeEventFabricEvent(params: {
  repository: AgenticRepository;
  selfImprovementRepository: SelfImprovementRepository;
  userId: string;
  actorContext: ActorContext | null;
  event: AutopilotEvent;
  eventId: string;
  jobId: string;
  signal?: AbortSignal;
}) {
  const envelope = getAutopilotEventFabricEnvelope(params.event);
  if (!envelope) {
    throw new AutopilotExecutionError(`Autopilot event ${params.event.id} is missing a valid fabric envelope.`);
  }
  const executionContext = await resolveAutopilotEventFabricExecutionContext({
    repository: params.repository,
    userId: params.userId,
    envelope
  });
  if ("missingReason" in executionContext) {
    throw new AutopilotExecutionError(executionContext.missingReason);
  }
  const [memories, integrations] = await Promise.all([
    params.repository.listMemory(params.userId),
    params.repository.listIntegrations(params.userId)
  ]);
  const bundle = await processUserRequest({
    userId: params.userId,
    workspaceId: executionContext.workspaceId,
    governance: executionContext.workspaceGovernance,
    request: buildAutopilotEventFabricRequest({
      event: params.event,
      envelope,
      goalBundle: executionContext.goalBundle,
      approval: executionContext.approval
    }),
    memories,
    integrations,
    goalId: buildAutopilotGoalId(params.eventId),
    workflowId: buildAutopilotWorkflowId(params.eventId),
    resolveAgentMetrics: (agentIdOrName) => params.repository.getAgentMetrics(agentIdOrName, "all", params.userId)
  });
  params.signal?.throwIfAborted();
  await params.repository.saveGoalBundle(bundle);
  params.signal?.throwIfAborted();
  await persistCapturedMemories({
    repository: params.repository,
    selfImprovementRepository: params.selfImprovementRepository,
    userId: params.userId,
    actorContext: params.actorContext,
    jobId: params.jobId,
    bundle,
    governance: executionContext.workspaceGovernance
  });
  return bundle;
}
export function isAutopilotProcessJob(
  job: JobRecord | null
): job is JobRecord & { payload: AutopilotProcessJobPayload } {
  return job?.kind === "autopilot_process" && job.payload.type === "autopilot_process";
}

export function isApprovalFollowUpJob(
  job: JobRecord | null
): job is JobRecord & { payload: ApprovalFollowUpJobPayload } {
  return job?.kind === "approval_follow_up" && job.payload.type === "approval_follow_up";
}

export function isApprovalNotificationJob(
  job: JobRecord | null
): job is JobRecord & { payload: ApprovalNotificationJobPayload } {
  return job?.kind === "approval_notification" && job.payload.type === "approval_notification";
}

export async function executeAutopilotProcessJob(params: {
  repository: AgenticRepository;
  selfImprovementRepository: SelfImprovementRepository;
  job: JobRecord;
  retryPolicy?: Partial<JobRetryPolicy>;
  signal?: AbortSignal;
}) {
  const { job, repository } = params;

  if (job.kind !== "autopilot_process" || job.payload.type !== "autopilot_process") {
    throw new Error(`Expected an autopilot_process payload for job ${job.id}.`);
  }

  const autopilotPayload = AutopilotProcessJobPayloadSchema.parse(job.payload);
  const autopilotJob = {
    ...job,
    payload: autopilotPayload
  } satisfies JobRecord & { payload: AutopilotProcessJobPayload };
  const event = await findAutopilotEvent(repository, job.userId, autopilotPayload.autopilotEventId);

  if (!event) {
    throw new AutopilotExecutionError(`Autopilot event ${autopilotPayload.autopilotEventId} was not found.`);
  }

  const scheduledDueTime = getScheduledAutopilotDueTime(event);

  if (!scheduledDueTime.due) {
    const processedAt = nowIso();
    await repository.saveAutopilotEvent({
      ...event,
      status: "ignored",
      processedAt,
      details: {
        ...event.details,
        jobId: job.id,
        jobStatus: "skipped",
        dueTimeValidation: {
          outcome: "ignored",
          reason: scheduledDueTime.reason,
          dueAt: scheduledDueTime.dueAt
        }
      },
      error: null
    });
    return;
  }

  try {
    let bundle: GoalBundle;

    if (autopilotPayload.kind === "watcher_triggered") {
      const { watcher, goal } = await resolveWatcherExecutionSource(repository, autopilotPayload.sourceId, job.userId);
      bundle = await executeWatcherEvent({
        repository,
        selfImprovementRepository: params.selfImprovementRepository,
        userId: job.userId,
        actorContext: job.actorContext,
        watcher,
        goal,
        eventId: event.id,
        jobId: job.id,
        signal: params.signal
      });
    } else if (autopilotPayload.kind === "template_due") {
      const { template } = await resolveTemplateExecutionSource(repository, autopilotPayload.sourceId, job.userId);
      bundle = await executeTemplateEvent({
        repository,
        selfImprovementRepository: params.selfImprovementRepository,
        userId: job.userId,
        actorContext: job.actorContext,
        template,
        eventId: event.id,
        jobId: job.id,
        signal: params.signal
      });
    } else if (autopilotPayload.kind === "briefing_due") {
      const { type } = await resolveBriefingExecutionSource(repository, autopilotPayload.sourceId, job.userId);
      bundle = await executeBriefingEvent({
        repository,
        selfImprovementRepository: params.selfImprovementRepository,
        userId: job.userId,
        actorContext: job.actorContext,
        type,
        eventId: event.id,
        jobId: job.id,
        signal: params.signal
      });
    } else if (isEventFabricAutopilotKind(autopilotPayload.kind)) {
      bundle = await executeEventFabricEvent({
        repository,
        selfImprovementRepository: params.selfImprovementRepository,
        userId: job.userId,
        actorContext: job.actorContext,
        event,
        eventId: event.id,
        jobId: job.id,
        signal: params.signal
      });
    } else {
      bundle = await executeGenericAutopilotEvent({
        repository,
        selfImprovementRepository: params.selfImprovementRepository,
        userId: job.userId,
        actorContext: job.actorContext,
        event,
        jobId: job.id,
        signal: params.signal
      });
    }

    const processedAt = nowIso();
    params.signal?.throwIfAborted();
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
    params.signal?.throwIfAborted();
    await repository.saveAutopilotEvent({
      ...event,
      status: "failed",
      processedAt,
      details: {
        ...event.details,
        ...summarizeExecutionFailure({
          createdAt: event.createdAt,
          processedAt,
          job: autopilotJob,
          retryPolicy: params.retryPolicy
        })
      },
      error: sanitizeAutopilotError(error)
    });
    throw error;
  }
}

export async function executeApprovalFollowUpJob(params: {
  repository: AgenticRepository;
  selfImprovementRepository: SelfImprovementRepository;
  job: JobRecord;
  signal?: AbortSignal;
}) {
  const { job, repository } = params;

  if (!isApprovalFollowUpJob(job)) {
    throw new Error(`Expected an approval_follow_up payload for job ${job.id}.`);
  }

  const bundle = await repository.getGoalBundleForUser(job.payload.goalId, job.userId);

  if (!bundle) {
    throw new Error(`Goal ${job.payload.goalId} was not found.`);
  }

  const approval = bundle.approvals.find((candidate) => candidate.id === job.payload.approvalId);

  if (!approval) {
    throw new Error(`Approval ${job.payload.approvalId} was not found.`);
  }

  if (approval.taskId !== job.payload.taskId) {
    throw new Error(`Approval ${approval.id} no longer matches queued task ${job.payload.taskId}.`);
  }

  if (approval.decision !== job.payload.decision) {
    throw new Error(
      `Approval ${approval.id} decision changed from ${job.payload.decision} to ${approval.decision}.`
    );
  }

  const task = bundle.tasks.find((candidate) => candidate.id === approval.taskId);

  if (!task) {
    throw new Error(`Task ${approval.taskId} was not found for approval ${approval.id}.`);
  }

  let updatedBundle = bundle;
  const shouldExecuteApprovedTask = job.payload.decision === "approved" && task.state === "queued";
  const workspaceGovernance = job.payload.workspaceId
    ? await repository.getWorkspaceGovernance(job.payload.workspaceId, job.userId)
    : null;

  if (shouldExecuteApprovedTask) {
    const googleAdapters = await resolveGoogleWorkspaceAdapters({
      repository,
      userId: job.userId,
      workspaceId: job.payload.workspaceId
    });
    const { results, logs } = await executeApprovedTasks({
      bundle,
      approvedTaskIds: [approval.taskId],
      adapters: {
        gmail: googleAdapters?.gmail,
        calendar: googleAdapters?.calendar,
        notes: { createLocalNote }
      },
      connectorReadiness: {
        gmail: googleAdapters?.readiness.gmail,
        calendar: googleAdapters?.readiness.calendar
      },
      governance: workspaceGovernance,
      sideEffectLedger: {
        reserve: ({ plan, task, actionIntent }) =>
          repository.reserveProviderSideEffect({
            userId: job.userId,
            workspaceId: job.payload.workspaceId,
            goalId: task.goalId,
            taskId: task.id,
            adapter: plan.adapter,
            operation: plan.operation,
            idempotencyKey: plan.idempotencyKey ?? "",
            sideEffectTarget: plan.sideEffectTarget ?? "",
            metadata: {
              approvalId: job.payload.approvalId,
              jobId: job.id,
              actionIntentType: actionIntent.type
            }
          }),
        update: ({ record, status, providerRef, detail, error, metadata }) =>
          repository.updateProviderSideEffect({
            id: record.id,
            status,
            providerRef,
            detail,
            error,
            metadata
          })
      },
      signal: params.signal
    });
    updatedBundle = reconcileExecutionResults({
      bundle,
      results,
      logs
    });
    await repository.saveGoalBundle(updatedBundle);

    const evidenceRecord = await finalizeApprovalEvidenceRecord({
      repository,
      bundle: updatedBundle,
      userId: job.userId,
      approvalId: approval.id,
      memoryIds: []
    });
    const evidenceRecordIdsByTaskId = evidenceRecord
      ? {
          [approval.taskId]: [evidenceRecord.id]
        }
      : undefined;

    const capturedMemoryIds = await persistCapturedSignals({
      repository,
      selfImprovementRepository: params.selfImprovementRepository,
      captured: captureExecutionOutcomeSignals(
        updatedBundle,
        job.userId,
        results,
        job.actorContext ?? createSystemActorContext(job.userId),
        {
          governance: workspaceGovernance,
          evidenceRecordIdsByTaskId
        }
      ),
      userId: job.userId,
      jobId: job.id,
      label: "approval-execution-capture",
      workspaceId: updatedBundle.goal.workspaceId ?? null
    });

    await finalizeApprovalEvidenceRecord({
      repository,
      bundle: updatedBundle,
      userId: job.userId,
      approvalId: approval.id,
      memoryIds: capturedMemoryIds
    });
  }

  if (updatedBundle.goal.status === "completed") {
    const evidenceRecord = await finalizeApprovalEvidenceRecord({
      repository,
      bundle: updatedBundle,
      userId: job.userId,
      approvalId: approval.id,
      memoryIds: []
    });
    const evidenceRecordIdsByTaskId = evidenceRecord
      ? {
          [approval.taskId]: [evidenceRecord.id]
        }
      : undefined;

    const capturedMemoryIds = await persistCapturedSignals({
      repository,
      selfImprovementRepository: params.selfImprovementRepository,
      captured: captureMemoriesFromBundle(
        updatedBundle,
        job.userId,
        job.actorContext ?? createSystemActorContext(job.userId),
        {
          governance: workspaceGovernance,
          evidenceRecordIdsByTaskId
        }
      ),
      userId: job.userId,
      jobId: job.id,
      label: "approval-auto-capture",
      workspaceId: updatedBundle.goal.workspaceId ?? null
    });

    if (capturedMemoryIds.length > 0) {
      await finalizeApprovalEvidenceRecord({
        repository,
        bundle: updatedBundle,
        userId: job.userId,
        approvalId: approval.id,
        memoryIds: capturedMemoryIds
      });
    }
  } else if (!shouldExecuteApprovedTask) {
    const evidenceRecord = await finalizeApprovalEvidenceRecord({
      repository,
      bundle: updatedBundle,
      userId: job.userId,
      approvalId: approval.id,
      memoryIds: []
    });
    const evidenceRecordIdsByTaskId = evidenceRecord
      ? {
          [approval.taskId]: [evidenceRecord.id]
        }
      : undefined;

    if (job.payload.decision === "rejected") {
      const capturedMemoryIds = await persistCapturedSignals({
        repository,
        selfImprovementRepository: params.selfImprovementRepository,
        captured: captureApprovalOutcomeSignals(
          updatedBundle,
          job.userId,
          approval.id,
          job.actorContext ?? createSystemActorContext(job.userId),
          {
            governance: workspaceGovernance,
            evidenceRecordIdsByTaskId
          }
        ),
        userId: job.userId,
        jobId: job.id,
        label: "approval-outcome-capture",
        workspaceId: updatedBundle.goal.workspaceId ?? null
      });

      if (capturedMemoryIds.length > 0) {
        await finalizeApprovalEvidenceRecord({
          repository,
          bundle: updatedBundle,
          userId: job.userId,
          approvalId: approval.id,
          memoryIds: capturedMemoryIds
        });
      }
    }
  }

  if (isSlackReady()) {
    await enqueueApprovalNotificationJob({
      repository,
      userId: job.userId,
      approvalId: approval.id,
      goalId: updatedBundle.goal.id,
      taskId: task.id,
      decision: job.payload.decision,
      channel: "slack",
      workspaceId: job.payload.workspaceId,
      actorContext: job.actorContext,
      replayedFromJobId: null
    });
  }
}

export async function executeApprovalNotificationJob(params: {
  repository: AgenticRepository;
  job: JobRecord;
  signal?: AbortSignal;
}) {
  const { job, repository } = params;

  if (!isApprovalNotificationJob(job)) {
    throw new Error(`Expected an approval_notification payload for job ${job.id}.`);
  }

  const bundle = await repository.getGoalBundleForUser(job.payload.goalId, job.userId);

  if (!bundle) {
    throw new Error(`Goal ${job.payload.goalId} was not found.`);
  }

  const approval = bundle.approvals.find((candidate) => candidate.id === job.payload.approvalId);

  if (!approval) {
    throw new Error(`Approval ${job.payload.approvalId} was not found.`);
  }

  if (approval.taskId !== job.payload.taskId) {
    throw new Error(`Approval ${approval.id} no longer matches queued task ${job.payload.taskId}.`);
  }

  if (approval.decision !== job.payload.decision) {
    throw new Error(
      `Approval ${approval.id} decision changed from ${job.payload.decision} to ${approval.decision}.`
    );
  }

  const task = bundle.tasks.find((candidate) => candidate.id === approval.taskId);

  if (!task) {
    throw new Error(`Task ${approval.taskId} was not found for approval ${approval.id}.`);
  }

  const statusEmoji = job.payload.decision === "approved" ? "\u2713" : "\u2717";
  const statusLabel = job.payload.decision === "approved" ? "Approved" : "Rejected";
  const receiptLabel = job.payload.decision === "approved" ? "Approved" : "Rejected";

  switch (job.payload.channel) {
    case "slack":
      if (!isSlackReady()) {
        throw new Error("Slack integration is not configured.");
      }

      params.signal?.throwIfAborted();
      await sendNotification({
        channel: process.env.SLACK_DEFAULT_CHANNEL ?? "#approvals",
        text: `${statusEmoji} ${statusLabel}: ${task.title}`,
        signal: params.signal
      });
      return;
    case "slack_receipt":
      if (!isSlackReady()) {
        throw new Error("Slack integration is not configured.");
      }

      params.signal?.throwIfAborted();
      await updateMessage({
        channel: job.payload.slackChannelId,
        ts: job.payload.slackMessageTs,
        text: `${statusEmoji} ${receiptLabel}: ${task.title}`,
        signal: params.signal,
        blocks: [
          {
            type: "section",
            text: {
              type: "mrkdwn",
              text: `${statusEmoji} *${receiptLabel}:* ${task.title}`
            }
          },
          {
            type: "context",
            elements: [
              {
                type: "mrkdwn",
                text: `Decision recorded via Slack worker for approval ${approval.id}.`
              }
            ]
          }
        ]
      });
      return;
    case "telegram_receipt":
      if (!isTelegramReady()) {
        throw new Error("Telegram integration is not configured.");
      }

      params.signal?.throwIfAborted();
      await updateTelegramMessage({
        chatId: job.payload.telegramChatId,
        messageId: job.payload.telegramMessageId,
        text: `${job.payload.decision === "approved" ? "\u2705" : "\u274c"} ${receiptLabel}: ${task.title}`,
        signal: params.signal
      });
      return;
  }
}

export function createWorkerJobHandlers(params: {
  repository: AgenticRepository;
  selfImprovementRepository: SelfImprovementRepository;
  runnerId: string;
  retryPolicy?: Partial<JobRetryPolicy>;
}): JobHandlerMap {
  const wrapHandler = (jobKind: JobKind, execute: (job: JobRecord, context?: JobHandlerContext) => Promise<void>) => {
    return (job: JobRecord, context?: JobHandlerContext) =>
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
                await execute(job, context);
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
    goal_create: wrapHandler("goal_create", (job, context) =>
      executeGoalCreateJob({
        repository: params.repository,
        selfImprovementRepository: params.selfImprovementRepository,
        job,
        signal: context?.signal
    })),
    goal_refine: wrapHandler("goal_refine", (job, context) =>
      executeGoalRefineJob({
        repository: params.repository,
        selfImprovementRepository: params.selfImprovementRepository,
        job,
        signal: context?.signal
      })),
    briefing_create: wrapHandler("briefing_create", (job, context) =>
      executeBriefingCreateJob({
        repository: params.repository,
        selfImprovementRepository: params.selfImprovementRepository,
        job,
        signal: context?.signal
      })),
    template_run: wrapHandler("template_run", (job, context) =>
      executeTemplateRunJob({
        repository: params.repository,
        selfImprovementRepository: params.selfImprovementRepository,
        job,
        signal: context?.signal
      })),
    docs_render: wrapHandler("docs_render", (job, context) =>
      executeDocsRenderJob({
        job,
        signal: context?.signal
      })),
    autopilot_process: wrapHandler("autopilot_process", (job, context) =>
      executeAutopilotProcessJob({
        repository: params.repository,
        selfImprovementRepository: params.selfImprovementRepository,
        job,
        retryPolicy: params.retryPolicy,
        signal: context?.signal
      })),
    github_issue_intake: wrapHandler("github_issue_intake", (job, context) =>
      executeGitHubIssueIntakeJob({
        repository: params.repository,
        selfImprovementRepository: params.selfImprovementRepository,
        job,
        signal: context?.signal
      })),
    approval_follow_up: wrapHandler("approval_follow_up", (job, context) =>
      executeApprovalFollowUpJob({
        repository: params.repository,
        selfImprovementRepository: params.selfImprovementRepository,
        job,
        signal: context?.signal
      })),
    approval_notification: wrapHandler("approval_notification", (job, context) =>
      executeApprovalNotificationJob({
        repository: params.repository,
        job,
        signal: context?.signal
      })),
    privacy_operation: wrapHandler("privacy_operation", (job, context) =>
      executePrivacyOperationJob({
        repository: params.repository,
        job,
        signal: context?.signal
      })),
    public_share_view: wrapHandler("public_share_view", (job, context) =>
      executePublicShareViewJob({
        repository: params.repository,
        job,
        signal: context?.signal
      }))
  };
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
        retryPolicy: options.retryPolicy,
        concurrencyLimits: options.concurrencyLimits,
        retryJitterRatio: options.retryJitterRatio,
        requireIdempotencyForRetry: options.requireIdempotencyForRetry
      });
      const handlers = createWorkerJobHandlers({
        repository: options.repository,
        selfImprovementRepository: options.selfImprovementRepository,
        runnerId: options.runnerId,
        retryPolicy: options.retryPolicy
      });
      const pollIntervalMs = Math.max(50, options.pollIntervalMs ?? 1_000);
      let processedCount = 0;
      const healthReporter = createWorkerRuntimeHealthReporter({
        runnerId: options.runnerId,
        health: options.health,
        getProcessedCount: () => processedCount,
        onWriteError: (error) => {
          logWarn("worker.health_signal.write_failed", {
            runnerId: options.runnerId,
            error: error instanceof Error ? error.message : "Unknown health signal failure"
          });
        }
      });
      const immuneSystem = createWorkerRuntimeImmuneSystem({
        runnerId: options.runnerId,
        controls: options.immuneSystem
      });

      healthReporter.write({
        status: "idle",
        processedCount,
        scheduler: {
          enabled: Boolean(options.health?.schedulerEnabled)
        }
      });

      try {
        while (!options.signal?.aborted) {
          const allowedKinds = immuneSystem.getAllowedKinds(options.claim?.kinds ?? workerJobKindValues);

          if (allowedKinds === null) {
            await delay(pollIntervalMs, options.signal);
            continue;
          }

          const result = await processNextDurableJob({
            queue,
            handlers,
            claim: {
              ...(options.claim ?? {}),
              kinds: allowedKinds
            }
          });

          if (result.claimedJob) {
            if (options.claim?.kinds?.length && !options.claim.kinds.includes(result.claimedJob.kind)) {
              throw new Error(`Worker claimed unexpected job kind "${result.claimedJob.kind}".`);
            }

            if (result.finalJob) {
              immuneSystem.recordJobOutcome(result.claimedJob.kind, result.finalJob.status);
            }

            processedCount += 1;
            healthReporter.write({
              status: "running",
              processedCount,
              lastProcessedAt: nowIso(),
              lastErrorAt: result.finalJob?.status === "completed" ? healthReporter.getSnapshot()?.lastErrorAt ?? null : nowIso(),
              lastErrorClass:
                result.finalJob?.status === "completed" ? healthReporter.getSnapshot()?.lastErrorClass ?? null : "JobFailure"
            });
            recordCounter("worker.loop.processed.total", 1, {
              runnerId: options.runnerId,
              jobKind: result.claimedJob.kind
            });

            if (options.maxJobs && processedCount >= options.maxJobs) {
              healthReporter.write({
                status: "stopped",
                processedCount
              });
              await healthReporter.flush();
              return {
                processedCount,
                stopReason: "max_jobs"
              };
            }

            continue;
          }

          await delay(pollIntervalMs, options.signal);
        }

        healthReporter.write({
          status: "stopped",
          processedCount
        });
        await healthReporter.flush();
        return {
          processedCount,
          stopReason: "aborted"
        };
      } catch (error) {
        healthReporter.write({
          status: "error",
          processedCount,
          lastErrorAt: nowIso(),
          lastErrorClass: error instanceof Error ? error.name : "UnknownError"
        });
        await healthReporter.flush();
        throw error;
      } finally {
        healthReporter.close();
      }
    }
  );
}

export function summarizeWorkerQueueHealth(jobs: JobRecord[], now = nowIso()): WorkerQueueHealthSummary {
  const nowMs = Date.parse(now);

  return jobs.reduce<WorkerQueueHealthSummary>(
    (summary, job) => {
      if (job.status === "queued") {
        summary.queuedDepth += 1;
        summary.queuedByPriority[job.priority] = (summary.queuedByPriority[job.priority] ?? 0) + 1;
      }

      if (job.status === "retrying") {
        summary.retryingDepth += 1;
      }

      if (job.status === "dead_letter") {
        summary.deadLetterDepth += 1;
      }

      if (job.status === "running") {
        summary.runningByKind[job.kind] = (summary.runningByKind[job.kind] ?? 0) + 1;

        const leaseExpiresAt = job.leaseExpiresAt ? Date.parse(job.leaseExpiresAt) : Number.NaN;
        if (Number.isFinite(leaseExpiresAt) && leaseExpiresAt <= nowMs) {
          summary.expiredLeaseCount += 1;
        } else {
          summary.activeLeaseCount += 1;
        }
      }

      return summary;
    },
    {
      queuedDepth: 0,
      retryingDepth: 0,
      deadLetterDepth: 0,
      activeLeaseCount: 0,
      expiredLeaseCount: 0,
      queuedByPriority: {},
      runningByKind: {}
    }
  );
}
