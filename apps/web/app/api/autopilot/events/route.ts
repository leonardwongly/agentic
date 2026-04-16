import crypto from "node:crypto";
import { z } from "zod";
import {
  AutopilotEventKindSchema,
  AutopilotEventSchema,
  AutopilotModeSchema,
  BriefingTypeSchema,
  GoalTemplateSchema,
  nowIso,
  type AutopilotEvent,
  type ActorContext,
  type AutopilotMode,
  type BriefingType,
  type GoalBundle,
  type GoalTemplate,
  type Watcher
} from "@agentic/contracts";
import {
  captureMemoriesFromBundle,
  computeNextRun,
  generateBriefing,
  interpolateTemplate,
  processUserRequest
} from "@agentic/orchestrator";
import { ApiRouteError, authenticatedJson, handleApiError, parseJsonBody } from "../../../../lib/api-response";
import { requireJsonContentType } from "../../../../lib/api-errors";
import { requireApiSession } from "../../../../lib/auth";
import { createActorContextFromPrincipal } from "../../../../lib/actor-context";
import { getSeededRepository, getSeededSelfImprovementRepository } from "../../../../lib/server";
import type { AgenticRepository } from "@agentic/repository";

const TriggerAutopilotEventSchema = z
  .object({
    kind: AutopilotEventKindSchema,
    sourceId: z.string().trim().min(1).max(200),
    summary: z.string().trim().min(1).max(200).optional(),
    details: z.record(z.string().min(1).max(100), z.unknown()).optional(),
    idempotencyKey: z.string().trim().min(1).max(200).optional(),
    dryRun: z.boolean().optional().default(false),
    mode: AutopilotModeSchema.optional()
  })
  .strict();

function buildPendingEvent(params: {
  userId: string;
  kind: z.infer<typeof AutopilotEventKindSchema>;
  sourceId: string;
  mode: AutopilotMode;
  summary: string;
  details?: Record<string, unknown>;
  idempotencyKey?: string | null;
  actorContext: ActorContext;
}): AutopilotEvent {
  return AutopilotEventSchema.parse({
    id: crypto.randomUUID(),
    userId: params.userId,
    kind: params.kind,
    sourceId: params.sourceId,
    idempotencyKey: params.idempotencyKey ?? null,
    mode: params.mode,
    summary: params.summary,
    status: "pending",
    details: params.details ?? {},
    actorContext: params.actorContext,
    createdAt: nowIso(),
    processedAt: null,
    resultGoalId: null,
    error: null
  });
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

function sanitizeAutopilotError(error: unknown): string {
  if (error instanceof ApiRouteError) {
    return error.message;
  }

  return "Autopilot execution failed.";
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

function summarizeExecutionFailure(createdAt: string, processedAt: string): Record<string, unknown> {
  return {
    failureStage: "execution",
    requiresReview: true,
    recoveryAction: "review_event_error",
    processingLatencyMs: measureProcessingLatencyMs(createdAt, processedAt)
  };
}

async function persistCapturedMemories(
  repository: AgenticRepository,
  bundle: GoalBundle,
  userId: string,
  actorContext: ActorContext
) {
  if (bundle.goal.status !== "completed") {
    return;
  }

  try {
    const captured = captureMemoriesFromBundle(bundle, userId, actorContext);
    const selfImprovement = await getSeededSelfImprovementRepository();

    await Promise.all([
      ...captured.memories.map((memory) => repository.saveMemory(memory)),
      ...captured.episodes.map((episode) => selfImprovement.appendEpisode(episode))
    ]);
  } catch (error) {
    console.error("[autopilot] Failed to persist captured memories after execution:", error);
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

async function resolveWatcherSource(sourceId: string, userId: string) {
  const repository = await getSeededRepository();
  const watchers = await repository.listWatchers({ userId });
  const watcher = watchers.find((candidate) => candidate.id === sourceId);

  if (!watcher) {
    throw new ApiRouteError(404, `Watcher ${sourceId} was not found.`);
  }

  if (watcher.status !== "active") {
    throw new ApiRouteError(409, `Watcher ${sourceId} is not active.`);
  }

  const goal = await repository.getGoalBundleForUser(watcher.goalId, userId);

  if (!goal) {
    throw new ApiRouteError(404, `Watcher goal ${watcher.goalId} was not found.`);
  }

  return { repository, watcher, goal };
}

async function resolveTemplateSource(sourceId: string, userId: string) {
  const repository = await getSeededRepository();
  const templates = await repository.listTemplates(userId);
  const template = templates.find((candidate) => candidate.id === sourceId);

  if (!template) {
    throw new ApiRouteError(404, `Template ${sourceId} was not found.`);
  }

  if (!template.schedule.enabled) {
    throw new ApiRouteError(409, `Template ${sourceId} does not have scheduling enabled.`);
  }

  return { repository, template };
}

async function resolveBriefingSource(sourceId: string, userId: string) {
  const repository = await getSeededRepository();
  const type = BriefingTypeSchema.parse(sourceId) as BriefingType;
  const preferences = await repository.getBriefingPreferences(userId);
  const schedule = preferences.schedules.find((candidate) => candidate.type === type);

  if (!schedule?.enabled) {
    throw new ApiRouteError(409, `Briefing ${type} is not enabled.`);
  }

  return { repository, type, preferences };
}

async function executeWatcherEvent(
  repository: AgenticRepository,
  watcher: Watcher,
  goal: GoalBundle,
  userId: string,
  actorContext: ActorContext
): Promise<GoalBundle> {
  const [memories, integrations] = await Promise.all([
    repository.listMemory(userId),
    repository.listIntegrations(userId)
  ]);
  const governance = goal.goal.workspaceId ? await repository.getWorkspaceGovernance(goal.goal.workspaceId, userId) : null;
  const bundle = await processUserRequest({
    userId,
    workspaceId: goal.goal.workspaceId,
    governance,
    request: buildWatcherAutopilotRequest(watcher),
    memories,
    integrations,
    resolveAgentMetrics: (agentIdOrName) => repository.getAgentMetrics(agentIdOrName, "all", userId)
  });

  await repository.saveGoalBundle(bundle);
  await persistCapturedMemories(repository, bundle, userId, actorContext);
  return bundle;
}

async function executeTemplateEvent(
  repository: AgenticRepository,
  template: GoalTemplate,
  userId: string,
  actorContext: ActorContext
): Promise<GoalBundle> {
  const [memories, integrations] = await Promise.all([
    repository.listMemory(userId),
    repository.listIntegrations(userId)
  ]);
  const { workspaceId, workspaceGovernance } = await resolveDashboardWorkspaceContext(repository, userId);
  const bundle = await processUserRequest({
    userId,
    workspaceId,
    governance: workspaceGovernance,
    request: interpolateTemplate(template),
    memories,
    integrations,
    resolveAgentMetrics: (agentIdOrName) => repository.getAgentMetrics(agentIdOrName, "all", userId)
  });

  await repository.saveGoalBundle(bundle);
  await repository.saveTemplate(
    GoalTemplateSchema.parse({
      ...template,
      schedule: {
        ...template.schedule,
        lastRunAt: nowIso(),
        nextRunAt:
          template.schedule.enabled && template.schedule.cron
            ? computeNextRun(template.schedule.cron, template.schedule.timezone)
            : null
      },
      actorContext,
      updatedAt: nowIso()
    })
  );
  await persistCapturedMemories(repository, bundle, userId, actorContext);
  return bundle;
}

async function executeBriefingEvent(
  repository: AgenticRepository,
  type: BriefingType,
  userId: string,
  actorContext: ActorContext
): Promise<GoalBundle> {
  const [preferences, memories, integrations, approvals, watchers] = await Promise.all([
    repository.getBriefingPreferences(userId),
    repository.listMemory(userId),
    repository.listIntegrations(userId),
    repository.listApprovals(userId),
    repository.listWatchers({ userId })
  ]);
  const { workspaceId, workspaceGovernance } = await resolveDashboardWorkspaceContext(repository, userId);
  const bundle = await generateBriefing({
    type,
    userId,
    workspaceId,
    governance: workspaceGovernance,
    preferences,
    memories,
    integrations,
    pendingApprovals: approvals.filter((approval) => approval.decision === "pending"),
    activeWatchers: watchers.filter((watcher) => watcher.status === "active"),
    resolveAgentMetrics: (agentIdOrName) => repository.getAgentMetrics(agentIdOrName, "all", userId)
  });

  await repository.saveGoalBundle(bundle);
  await persistCapturedMemories(repository, bundle, userId, actorContext);
  return bundle;
}

export async function POST(request: Request) {
  try {
    requireJsonContentType(request);
    const principal = await requireApiSession(request);
    const actorContext = createActorContextFromPrincipal(principal);
    const repository = await getSeededRepository();
    const settings = await repository.getAutopilotSettings(principal.userId);
    const body = await parseJsonBody(request, TriggerAutopilotEventSchema);
    const effectiveMode = body.mode ?? settings.mode;
    let summary = body.summary?.trim() ?? "";

    if (effectiveMode === "auto_run" && repository.backend !== "postgres") {
      return authenticatedJson(
        {
          error: "Autopilot auto-run requires Postgres-backed persistence.",
          backend: repository.backend
        },
        { status: 409 }
      );
    }

    if (body.kind === "watcher_triggered") {
      const { watcher } = await resolveWatcherSource(body.sourceId, principal.userId);
      summary ||= `Watcher triggered: ${watcher.targetEntity}`;

      if (body.dryRun) {
        const event = AutopilotEventSchema.parse({
          ...buildPendingEvent({
            userId: principal.userId,
            kind: body.kind,
            sourceId: body.sourceId,
            mode: effectiveMode,
            summary,
            details: {
              ...(body.details ?? {}),
              watcherId: watcher.id,
              dryRun: true
            },
            idempotencyKey: body.idempotencyKey,
            actorContext
          }),
          status: "simulated"
        });

        return authenticatedJson({
          event,
          simulated: true,
          dashboard: await repository.getDashboardData(principal.userId)
        });
      }
    }

    if (body.kind === "template_due") {
      const { template } = await resolveTemplateSource(body.sourceId, principal.userId);
      summary ||= `Template due: ${template.name}`;

      if (body.dryRun) {
        const event = AutopilotEventSchema.parse({
          ...buildPendingEvent({
            userId: principal.userId,
            kind: body.kind,
            sourceId: body.sourceId,
            mode: effectiveMode,
            summary,
            details: {
              ...(body.details ?? {}),
              templateId: template.id,
              dryRun: true
            },
            idempotencyKey: body.idempotencyKey,
            actorContext
          }),
          status: "simulated"
        });

        return authenticatedJson({
          event,
          simulated: true,
          dashboard: await repository.getDashboardData(principal.userId)
        });
      }
    }

    if (body.kind === "briefing_due") {
      const { type } = await resolveBriefingSource(body.sourceId, principal.userId);
      summary ||= `Briefing due: ${type}`;

      if (body.dryRun) {
        const event = AutopilotEventSchema.parse({
          ...buildPendingEvent({
            userId: principal.userId,
            kind: body.kind,
            sourceId: body.sourceId,
            mode: effectiveMode,
            summary,
            details: {
              ...(body.details ?? {}),
              briefingType: type,
              dryRun: true
            },
            idempotencyKey: body.idempotencyKey,
            actorContext
          }),
          status: "simulated"
        });

        return authenticatedJson({
          event,
          simulated: true,
          dashboard: await repository.getDashboardData(principal.userId)
        });
      }
    }

    const claim = await repository.claimAutopilotEvent({
      userId: principal.userId,
      kind: body.kind,
      sourceId: body.sourceId,
      idempotencyKey: body.idempotencyKey ?? null,
      mode: effectiveMode,
      summary,
      details: body.details,
      actorContext,
      debounceMinutes: settings.debounceMinutes
    });

    if (claim.outcome === "duplicate" || claim.outcome === "debounced") {
      return authenticatedJson({
        event: claim.event,
        duplicate: claim.outcome === "duplicate",
        debounced: claim.outcome === "debounced",
        dashboard: await repository.getDashboardData(principal.userId)
      });
    }

    if (effectiveMode === "notify_only") {
      const processedAt = nowIso();
      const event = await repository.saveAutopilotEvent(
        AutopilotEventSchema.parse({
          ...claim.event,
          status: "notified",
          processedAt,
          details: {
            ...claim.event.details,
            requiresReview: true,
            recoveryAction: "await_operator_review",
            processingLatencyMs: measureProcessingLatencyMs(claim.event.createdAt, processedAt)
          }
        })
      );

      return authenticatedJson({
        event,
        dashboard: await repository.getDashboardData(principal.userId)
      });
    }

    try {
      let bundle: GoalBundle;

      if (body.kind === "watcher_triggered") {
        const { watcher, goal } = await resolveWatcherSource(body.sourceId, principal.userId);
        bundle = await executeWatcherEvent(repository, watcher, goal, principal.userId, actorContext);
      } else if (body.kind === "template_due") {
        const { template } = await resolveTemplateSource(body.sourceId, principal.userId);
        bundle = await executeTemplateEvent(repository, template, principal.userId, actorContext);
      } else {
        const { type } = await resolveBriefingSource(body.sourceId, principal.userId);
        bundle = await executeBriefingEvent(repository, type, principal.userId, actorContext);
      }

      const processedAt = nowIso();
      const event = await repository.saveAutopilotEvent(
        AutopilotEventSchema.parse({
          ...claim.event,
          status: "executed",
          processedAt,
          resultGoalId: bundle.goal.id,
          details: {
            ...claim.event.details,
            ...summarizeExecutionOutcome(bundle, claim.event.createdAt, processedAt)
          }
        })
      );

      return authenticatedJson({
        event,
        bundle,
        dashboard: await repository.getDashboardData(principal.userId)
      });
    } catch (error) {
      const processedAt = nowIso();
      const failedEvent = await repository.saveAutopilotEvent(
        AutopilotEventSchema.parse({
          ...claim.event,
          status: "failed",
          processedAt,
          details: {
            ...claim.event.details,
            ...summarizeExecutionFailure(claim.event.createdAt, processedAt)
          },
          error: sanitizeAutopilotError(error)
        })
      );

      return authenticatedJson(
        {
          event: failedEvent,
          error: failedEvent.error,
          dashboard: await repository.getDashboardData(principal.userId)
        },
        { status: error instanceof ApiRouteError ? error.status : 500 }
      );
    }
  } catch (error) {
    return handleApiError(error, "Failed to trigger autopilot event.");
  }
}
