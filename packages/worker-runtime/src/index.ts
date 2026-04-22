import crypto from "node:crypto";
import { runDocsBuild } from "@agentic/docs-runtime";
import {
  buildApprovalNotificationDeliveryTarget,
  createSystemActorContext,
  type ApprovalNotificationJobPayload,
  type ApprovalFollowUpJobPayload,
  type BriefingCreateJobPayload,
  type Capability,
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
  RecommendationRefinementSourceSchema,
  type RecommendationRefinementSource,
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
  assessManagedGoogleCredential,
  createCalendarAdapter,
  createGmailAdapter,
  createLocalNote,
  createProviderCredentialSecretStore,
  googleWorkspaceRequiredScopes,
  createActionLog,
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
  captureExecutionOutcomeSignals,
  type CapturedMemories,
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
import {
  SelfImprovementConflictError,
  buildPolicyLearningValidation,
  type SelfImprovementRepository
} from "@agentic/self-improvement-memory";

export const workerJobKindValues = [
  "goal_create",
  "goal_refine",
  "briefing_create",
  "template_run",
  "docs_render",
  "autopilot_process",
  "approval_follow_up",
  "approval_notification",
  "privacy_operation",
  "public_share_view"
] as const;

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

const SHARE_VIEW_DEDUP_WINDOW_MS = 1000 * 60 * 15;
const REPLAY_VALIDATION_CAPABILITIES = new Set<Capability>(["send", "schedule"]);

type PolicyReplayValidationResolver = NonNullable<Parameters<typeof processUserRequest>[0]["resolvePolicyReplayValidation"]>;

function createPolicyReplayValidationResolver(
  episodes: Awaited<ReturnType<SelfImprovementRepository["listEpisodes"]>>
): PolicyReplayValidationResolver {
  return async ({ agent, capabilities, riskClass }) => {
    if (!capabilities.some((capability) => REPLAY_VALIDATION_CAPABILITIES.has(capability))) {
      return null;
    }

    return buildPolicyLearningValidation(episodes, {
      kind: "execution_path",
      agent,
      riskClass,
      capabilities
    });
  };
}

function createPublicShareViewedLog(
  bundle: GoalBundle,
  shareId: string,
  tokenFingerprint: string,
  now = Date.now()
) {
  const dedupeThreshold = now - SHARE_VIEW_DEDUP_WINDOW_MS;
  const alreadyTracked = bundle.actionLogs.some((log) => {
    if (log.kind !== "share.page_viewed") {
      return false;
    }

    const createdAt = Date.parse(log.createdAt);
    const loggedFingerprint = typeof log.details.tokenFingerprint === "string" ? log.details.tokenFingerprint : null;

    return loggedFingerprint === tokenFingerprint && Number.isFinite(createdAt) && createdAt >= dedupeThreshold;
  });

  if (alreadyTracked) {
    return null;
  }

  return createActionLog({
    goalId: bundle.goal.id,
    taskId: null,
    workflowId: bundle.workflow.id,
    actor: "public-share",
    kind: "share.page_viewed",
    message: `Opened the public share page for "${bundle.goal.title}".`,
    details: {
      shareId,
      tokenFingerprint
    }
  });
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

function buildGoalRefinePayload(params: {
  goalId: string;
  workflowId: string;
  refinement: string;
  workspaceId: string | null;
  sourceRecommendation?: RecommendationRefinementSource | null;
}): GoalRefineJobPayload {
  return {
    type: "goal_refine",
    goalId: params.goalId,
    workflowId: params.workflowId,
    refinement: params.refinement,
    workspaceId: params.workspaceId,
    metadata: params.sourceRecommendation
      ? {
          sourceRecommendation: RecommendationRefinementSourceSchema.parse(params.sourceRecommendation)
        }
      : {}
  };
}

function buildAutopilotProcessPayload(params: {
  autopilotEvent: AutopilotEvent;
  replayedFromJobId?: string | null;
}): AutopilotProcessJobPayload {
  return {
    type: "autopilot_process",
    autopilotEventId: params.autopilotEvent.id,
    kind: params.autopilotEvent.kind,
    sourceId: params.autopilotEvent.sourceId,
    mode: params.autopilotEvent.mode,
    metadata: params.replayedFromJobId
      ? {
          replayedFromJobId: params.replayedFromJobId
        }
      : {}
  };
}

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

function buildBriefingCreatePayload(params: {
  goalId: string;
  workflowId: string;
  briefingType: BriefingType;
  workspaceId: string | null;
}): BriefingCreateJobPayload {
  return {
    type: "briefing_create",
    goalId: params.goalId,
    workflowId: params.workflowId,
    briefingType: params.briefingType,
    workspaceId: params.workspaceId,
    metadata: {}
  };
}

function buildTemplateRunPayload(params: {
  templateId: string;
  goalId: string;
  workflowId: string;
  workspaceId: string | null;
}): TemplateRunJobPayload {
  return {
    type: "template_run",
    templateId: params.templateId,
    goalId: params.goalId,
    workflowId: params.workflowId,
    workspaceId: params.workspaceId,
    metadata: {}
  };
}

function buildDocsRenderPayload(): DocsRenderJobPayload {
  return {
    type: "docs_render",
    metadata: {}
  };
}

function buildAutopilotGoalId(eventId: string): string {
  return `autopilot-goal-${eventId}`;
}

function buildAutopilotWorkflowId(eventId: string): string {
  return `autopilot-workflow-${eventId}`;
}

function buildAutopilotProcessJobIdempotencyKey(params: {
  eventId: string;
  replayedFromJobId?: string | null;
}): string {
  const baseKey = `autopilot-process:${params.eventId}`;
  return params.replayedFromJobId ? `${baseKey}:replay:${params.replayedFromJobId}` : baseKey;
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

function buildPrivacyOperationPayload(params: {
  operationId: string;
  workspaceId: string;
  kind: PrivacyOperationJobPayload["kind"];
}): PrivacyOperationJobPayload {
  return {
    type: "privacy_operation",
    operationId: params.operationId,
    workspaceId: params.workspaceId,
    kind: params.kind,
    metadata: {}
  };
}

function buildPublicShareViewPayload(params: {
  shareId: string;
  goalId: string;
  tokenFingerprint: string;
  viewedAt: string;
}): PublicShareViewJobPayload {
  return {
    type: "public_share_view",
    shareId: params.shareId,
    goalId: params.goalId,
    tokenFingerprint: params.tokenFingerprint,
    viewedAt: params.viewedAt,
    metadata: {}
  };
}

function buildPrivacyOperationJobIdempotencyKey(operationId: string): string {
  return `privacy-operation:${operationId}`;
}

function buildBriefingCreateJobIdempotencyKey(goalId: string, briefingType: BriefingType): string {
  return `briefing-create:${briefingType}:${goalId}`;
}

function buildDocsRenderJobIdempotencyKey(userId: string): string {
  return `docs-render:${userId}`;
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

async function persistCapturedSignals(params: {
  repository: AgenticRepository;
  selfImprovementRepository: SelfImprovementRepository;
  captured: CapturedMemories;
  userId: string;
  jobId: string;
  label: string;
}) {
  if (params.captured.memories.length === 0 && params.captured.episodes.length === 0) {
    return [];
  }

  try {
    await Promise.all(params.captured.memories.map((memory) => params.repository.saveMemory(memory)));

    for (const episode of params.captured.episodes) {
      try {
        await params.selfImprovementRepository.appendEpisode(episode);
      } catch (error) {
        if (error instanceof SelfImprovementConflictError) {
          continue;
        }

        throw error;
      }
    }

    return params.captured.memories.map((memory) => memory.id);
  } catch (error) {
    logError("approval_follow_up.memory_capture_failed", error, {
      jobId: params.jobId,
      userId: params.userId,
      label: params.label
    });
    return [];
  }
}

function listGoogleCredentialCandidatesForWorkspace(
  credentials: Awaited<ReturnType<AgenticRepository["listProviderCredentials"]>>,
  workspaceId: string | null | undefined
) {
  const connected = credentials
    .filter((credential) => credential.provider === "google" && credential.status === "connected")
    .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));

  if (workspaceId) {
    const exact = connected.filter((credential) => credential.workspaceId === workspaceId);

    if (exact.length > 0) {
      return exact;
    }
  }

  return connected.filter((credential) => credential.workspaceId === null);
}

async function resolveGoogleWorkspaceAdapters(params: {
  repository: AgenticRepository;
  userId: string;
  workspaceId?: string | null;
}) {
  const candidates = listGoogleCredentialCandidatesForWorkspace(
    await params.repository.listProviderCredentials(params.userId),
    params.workspaceId ?? null
  );

  if (candidates.length === 0) {
    return null;
  }

  const candidateFailures: string[] = [];

  for (const credential of candidates) {
    const secretRecord = await params.repository.getProviderCredentialSecret(
      credential.id,
      "oauth_refresh_token",
      params.userId
    );
    const assessment = assessManagedGoogleCredential({
      account: {
        id: "google-workspace",
        name: "Google workspace adapters",
        metadata: {
          provider: "google",
          managed: true,
          providerCredentialId: credential.id
        }
      },
      credential,
      hasRefreshTokenSecret: Boolean(secretRecord)
    });

    const missingWorkspaceScopes = googleWorkspaceRequiredScopes.filter((scope) => !credential.scopes.includes(scope));
    const blockedByWorkspaceScopes = missingWorkspaceScopes.length > 0;
    const workspaceIssues = blockedByWorkspaceScopes
      ? [`missing required Google scopes: ${missingWorkspaceScopes.join(", ")}`]
      : [];

    if (!assessment?.ready || blockedByWorkspaceScopes) {
      candidateFailures.push(
        `${credential.id}: ${[...(assessment?.issues.map((issue) => issue.message) ?? []), ...workspaceIssues].join("; ")}`
      );
      continue;
    }

    try {
      const refreshToken = createProviderCredentialSecretStore().decrypt(secretRecord!.secret);

      return {
        credential,
        gmail: createGmailAdapter({ refreshToken }),
        calendar: createCalendarAdapter({ refreshToken })
      };
    } catch (error) {
      candidateFailures.push(
        `${credential.id}: ${error instanceof Error ? error.message : "failed to decrypt refresh token"}`
      );
    }
  }

  throw new Error(
    `No approval-safe Google credential is available for workspace adapters. ${candidateFailures.join(" | ")}`
  );
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
}) {
  const { repository, bundle, userId, approvalId, memoryIds } = params;
  const approval = bundle.approvals.find((candidate) => candidate.id === approvalId);

  if (!approval || approval.decision === "pending") {
    return;
  }

  const task = bundle.tasks.find((candidate) => candidate.id === approval.taskId);
  const evidenceRecord =
    (await repository.listEvidenceRecords({ userId, approvalId }))
      .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))
      .at(0) ?? null;

  if (!evidenceRecord) {
    return;
  }

  const relatedActionLogIds = bundle.actionLogs
    .filter(
      (log) => log.taskId === approval.taskId || (typeof log.details.approvalId === "string" && log.details.approvalId === approvalId)
    )
    .map((log) => log.id);
  const relatedArtifactIds = bundle.artifacts
    .filter((artifact) => artifact.taskId === approval.taskId)
    .map((artifact) => artifact.id);

  await repository.saveEvidenceRecord({
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
  const [memories, integrations, agentDefinition, episodes] = await Promise.all([
    repository.listMemory(job.userId),
    repository.listIntegrations(job.userId),
    resolveGoalCreateAgentDefinition(repository, job.userId, job.payload.agentId),
    params.selfImprovementRepository.listEpisodes()
  ]);
  const resolvePolicyReplayValidation = createPolicyReplayValidationResolver(episodes);
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
    resolveAgentMetrics: (agentIdOrName) => repository.getAgentMetrics(agentIdOrName, "all", job.userId),
    resolvePolicyReplayValidation
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

  const [memories, episodes, governance] = await Promise.all([
    repository.listMemory(job.userId),
    params.selfImprovementRepository.listEpisodes(),
    job.payload.workspaceId
      ? repository.getWorkspaceGovernance(job.payload.workspaceId, job.userId)
      : Promise.resolve(null)
  ]);
  const resolvePolicyReplayValidation = createPolicyReplayValidationResolver(episodes);
  const updatedBundle = await refineGoal({
    bundle,
    refinement: job.payload.refinement,
    memories,
    actorContext: job.actorContext,
    sourceRecommendation:
      job.payload.metadata && typeof job.payload.metadata === "object" && "sourceRecommendation" in job.payload.metadata
        ? RecommendationRefinementSourceSchema.parse(job.payload.metadata.sourceRecommendation)
        : null,
    governance,
    resolveAgentMetrics: (agentIdOrName) => repository.getAgentMetrics(agentIdOrName, "all", job.userId),
    resolvePolicyReplayValidation
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
  const [preferences, memories, integrations, approvals, watchers, episodes] = await Promise.all([
    repository.getBriefingPreferences(job.userId),
    repository.listMemory(job.userId),
    repository.listIntegrations(job.userId),
    repository.listApprovals(job.userId),
    repository.listWatchers({ userId: job.userId }),
    params.selfImprovementRepository.listEpisodes()
  ]);
  const resolvePolicyReplayValidation = createPolicyReplayValidationResolver(episodes);
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
    resolveAgentMetrics: (agentIdOrName) => repository.getAgentMetrics(agentIdOrName, "all", job.userId),
    resolvePolicyReplayValidation
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

export async function executeApprovalFollowUpJob(params: {
  repository: AgenticRepository;
  selfImprovementRepository: SelfImprovementRepository;
  job: JobRecord;
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
      governance: job.payload.workspaceId
        ? await repository.getWorkspaceGovernance(job.payload.workspaceId, job.userId)
        : null
    });
    updatedBundle = reconcileExecutionResults({
      bundle,
      results,
      logs
    });
    await repository.saveGoalBundle(updatedBundle);

    const capturedMemoryIds = await persistCapturedSignals({
      repository,
      selfImprovementRepository: params.selfImprovementRepository,
      captured: captureExecutionOutcomeSignals(
        updatedBundle,
        job.userId,
        results,
        job.actorContext ?? createSystemActorContext(job.userId)
      ),
      userId: job.userId,
      jobId: job.id,
      label: "approval-execution-capture"
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
    const capturedMemoryIds = await persistCapturedSignals({
      repository,
      selfImprovementRepository: params.selfImprovementRepository,
      captured: captureMemoriesFromBundle(
        updatedBundle,
        job.userId,
        job.actorContext ?? createSystemActorContext(job.userId)
      ),
      userId: job.userId,
      jobId: job.id,
      label: "approval-auto-capture"
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
    await finalizeApprovalEvidenceRecord({
      repository,
      bundle: updatedBundle,
      userId: job.userId,
      approvalId: approval.id,
      memoryIds: []
    });
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

      await sendNotification({
        channel: process.env.SLACK_DEFAULT_CHANNEL ?? "#approvals",
        text: `${statusEmoji} ${statusLabel}: ${task.title}`
      });
      return;
    case "slack_receipt":
      if (!isSlackReady()) {
        throw new Error("Slack integration is not configured.");
      }

      await updateMessage({
        channel: job.payload.slackChannelId,
        ts: job.payload.slackMessageTs,
        text: `${statusEmoji} ${receiptLabel}: ${task.title}`,
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

      await updateTelegramMessage({
        chatId: job.payload.telegramChatId,
        messageId: job.payload.telegramMessageId,
        text: `${job.payload.decision === "approved" ? "\u2705" : "\u274c"} ${receiptLabel}: ${task.title}`
      });
      return;
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
    approval_follow_up: wrapHandler("approval_follow_up", (job) =>
      executeApprovalFollowUpJob({
        repository: params.repository,
        selfImprovementRepository: params.selfImprovementRepository,
        job
      })),
    approval_notification: wrapHandler("approval_notification", (job) =>
      executeApprovalNotificationJob({
        repository: params.repository,
        job
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
