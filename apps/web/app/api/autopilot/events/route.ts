import crypto from "node:crypto";
import { z } from "zod";
import {
  AUTOPILOT_EVENT_TAXONOMY,
  AutopilotEventBudgetSchema,
  AutopilotEventDetailsSchema,
  AutopilotEventFabricEnvelopeSchema,
  AutopilotModeSchema,
  type AutopilotEventFamily,
  AutopilotEventKindSchema,
  AutopilotEventPrioritySchema,
  AutopilotEventSchema,
  BriefingTypeSchema,
  nowIso,
  type AutopilotEvent,
  type AutopilotEventBudget,
  type AutopilotEventDetails,
  type AutopilotEventKind,
  type AutopilotEventPriority,
  type ActorContext,
  type AutopilotMode,
  type BriefingType
} from "@agentic/contracts";
import { enqueueAutopilotProcessJob } from "@agentic/worker-runtime";
import {
  authenticatedRateLimitError,
  authenticatedJson,
  handleApiError,
  parseJsonBody,
  ApiRouteError,
  withApiTelemetry
} from "../../../../lib/api-response";
import { requireJsonContentType } from "../../../../lib/api-errors";
import { requireApiSession } from "../../../../lib/auth";
import { createActorContextFromPrincipal } from "../../../../lib/actor-context";
import {
  buildDryRunAutopilotEvent,
  normalizeAutopilotEventRequest
} from "../../../../lib/autopilot-event-fabric";
import { checkAbuseRateLimit } from "../../../../lib/abuse-rate-limit";
import { getSeededRepository } from "../../../../lib/server";
import {
  SHARED_WORKSPACE_AUTOMATION_DENIED_REASON,
  canManageSharedWorkspaceAutomationsForRole
} from "../../../../lib/workspace-role-permissions";
import type { AgenticRepository } from "@agentic/repository";

const TriggerAutopilotEventSchema = z
  .object({
    kind: AutopilotEventKindSchema,
    sourceId: z.string().trim().min(1).max(200),
    summary: z.string().trim().min(1).max(200).optional(),
    details: z.record(z.string().min(1).max(100), z.unknown()).optional(),
    idempotencyKey: z.string().trim().min(1).max(200).optional(),
    priority: AutopilotEventPrioritySchema.optional(),
    tags: z.array(z.string().trim().min(1).max(32)).max(8).optional(),
    correlationKey: z.string().trim().min(1).max(200).optional(),
    budget: AutopilotEventBudgetSchema.optional(),
    dryRun: z.boolean().optional().default(false),
    mode: AutopilotModeSchema.optional()
  })
  .strict();

const ScheduledAutopilotDueAtSchema = z.string().datetime();

type CompatibilityAutopilotEventKind = Extract<
  AutopilotEventKind,
  | "watcher_triggered"
  | "template_due"
  | "briefing_due"
  | "communication_received"
  | "deadline_drift_detected"
  | "approval_sla_breached"
  | "workflow_stalled"
  | "connector_failed"
  | "dormant_workflow_review_due"
>;

type GenericAutopilotEventKind = Exclude<CompatibilityAutopilotEventKind, "watcher_triggered" | "template_due" | "briefing_due">;

type AutopilotOperatorRoute = {
  section: "goals" | "approvals" | "watchers" | "operations";
  itemId?: string;
  label: string;
  actionLabel?: string;
};

type ResolvedAutopilotSource = {
  summary: string;
  details: Record<string, unknown>;
  operatorRoute?: AutopilotOperatorRoute | null;
};

type CompatibilityFabricAutopilotEventKind = Extract<
  CompatibilityAutopilotEventKind,
  "deadline_drift_detected" | "workflow_stalled" | "dormant_workflow_review_due"
>;

const compatibilityFabricKinds = new Set<CompatibilityFabricAutopilotEventKind>([
  "deadline_drift_detected",
  "workflow_stalled",
  "dormant_workflow_review_due"
]);

const autopilotFamilyByKind: Record<CompatibilityAutopilotEventKind, AutopilotEventFamily> = {
  watcher_triggered: "watcher",
  template_due: "template",
  briefing_due: "briefing",
  communication_received: "communication",
  deadline_drift_detected: "deadline",
  approval_sla_breached: "approval",
  workflow_stalled: "workflow",
  connector_failed: "connector",
  dormant_workflow_review_due: "workflow"
};

const autopilotPriorityByKind: Record<CompatibilityAutopilotEventKind, AutopilotEventPriority> = {
  watcher_triggered: "high",
  template_due: "medium",
  briefing_due: "low",
  communication_received: "high",
  deadline_drift_detected: "high",
  approval_sla_breached: "critical",
  workflow_stalled: "high",
  connector_failed: "critical",
  dormant_workflow_review_due: "medium"
};

const autopilotQueueByKind: Record<CompatibilityAutopilotEventKind, string> = {
  watcher_triggered: "watcher_queue",
  template_due: "scheduled_templates",
  briefing_due: "scheduled_briefings",
  communication_received: "communications_inbox",
  deadline_drift_detected: "deadline_recovery",
  approval_sla_breached: "approval_escalations",
  workflow_stalled: "workflow_recovery",
  connector_failed: "connector_incidents",
  dormant_workflow_review_due: "workflow_review"
};

const autopilotDefaultTagsByKind: Record<CompatibilityAutopilotEventKind, string[]> = {
  watcher_triggered: ["watcher", "queue"],
  template_due: ["template", "schedule"],
  briefing_due: ["briefing", "schedule"],
  communication_received: ["communications", "triage"],
  deadline_drift_detected: ["deadline", "workflow"],
  approval_sla_breached: ["approval", "escalation"],
  workflow_stalled: ["workflow", "blocked"],
  connector_failed: ["connector", "incident"],
  dormant_workflow_review_due: ["workflow", "review"]
};

function buildCompatibilityFabricEnvelope(params: {
  kind: CompatibilityAutopilotEventKind;
  summary: string;
  details?: Record<string, unknown>;
}) {
  const details = params.details ?? {};
  const nestedReferences =
    typeof details.references === "object" && details.references !== null
      ? (details.references as Record<string, unknown>)
      : null;

  if (
    params.kind !== "deadline_drift_detected" &&
    params.kind !== "workflow_stalled" &&
    params.kind !== "dormant_workflow_review_due"
  ) {
    return null;
  }

  const kind: CompatibilityFabricAutopilotEventKind = params.kind;
  const taxonomy = AUTOPILOT_EVENT_TAXONOMY[kind];
  const severity =
    kind === "deadline_drift_detected" && normalizeEventText(details.state, 40) === "breached"
      ? "critical"
      : kind === "workflow_stalled" && normalizeEventText(details.status, 40) === "blocked"
        ? "high"
        : taxonomy.defaultSeverity;

  const references = {
    goalId: normalizeEventText(nestedReferences?.goalId, 200) ?? normalizeEventText(details.goalId, 200),
    workflowId: normalizeEventText(nestedReferences?.workflowId, 200) ?? normalizeEventText(details.workflowId, 200),
    approvalId: null,
    watcherId: null,
    templateId: null,
    briefingType: null
  };
  const baseEnvelope = {
    version: 1,
    family: taxonomy.family,
    severity,
    operatorRoute: taxonomy.operatorRoute,
    policy: taxonomy.policy,
    references,
    signals: [
      taxonomy.family.replaceAll("_", "-"),
      taxonomy.operatorRoute.replaceAll("_", "-"),
      kind.replaceAll("_", "-")
    ],
    summary: params.summary
  };

  if (kind === "deadline_drift_detected") {
    return AutopilotEventFabricEnvelopeSchema.parse({
      ...baseEnvelope,
      trigger: {
        target:
          readEventText(details, ["workflowName", "goalTitle", "title", "target"], 200) ??
          normalizeEventText(details.sourceId, 200) ??
          "workflow",
        deadlineAt: normalizeEventText(details.deadlineAt, 200) ?? normalizeEventText(details.deadline, 200) ?? null,
        state: normalizeEventText(details.state, 40) ?? "at_risk",
        reason: readEventText(details, ["reason"], 500),
        daysOverdue: typeof details.daysOverdue === "number" ? details.daysOverdue : null
      }
    });
  }

  if (kind === "workflow_stalled") {
    return AutopilotEventFabricEnvelopeSchema.parse({
      ...baseEnvelope,
      trigger: {
        stalledStep:
          readEventText(details, ["stalledStep", "blockedStep"], 200) ??
          normalizeEventText(details.sourceId, 200) ??
          "unknown-step",
        status: normalizeEventText(details.status, 40) ?? "waiting",
        stalledSince: normalizeEventText(details.stalledSince, 200),
        blocker: readEventText(details, ["blocker"], 500)
      }
    });
  }

  return AutopilotEventFabricEnvelopeSchema.parse({
    ...baseEnvelope,
    trigger: {
      dormantDays: typeof details.dormantDays === "number" ? details.dormantDays : null,
      lastActivityAt: normalizeEventText(details.lastActivityAt, 200),
      reviewReason: readEventText(details, ["reviewReason"], 500)
    }
  });
}

function normalizeEventText(value: unknown, maxLength = 120): string | null {
  if (typeof value !== "string") {
    return null;
  }

  const normalized = value.trim().replace(/\s+/g, " ");

  if (!normalized) {
    return null;
  }

  return normalized.slice(0, maxLength);
}

function readEventText(details: Record<string, unknown> | undefined, keys: readonly string[], maxLength = 120): string | null {
  if (!details) {
    return null;
  }

  for (const key of keys) {
    const value = normalizeEventText(details[key], maxLength);

    if (value) {
      return value;
    }
  }

  return null;
}

function buildGenericAutopilotSummary(
  kind: GenericAutopilotEventKind,
  sourceId: string,
  details?: Record<string, unknown>
): string {
  const sourceLabel = normalizeEventText(sourceId, 120) ?? "unknown-source";

  switch (kind) {
    case "communication_received": {
      const sender = readEventText(details, ["sender", "from", "contact", "customer"], 80);
      const subject = readEventText(details, ["subject", "threadSubject", "title"], 120);

      if (sender && subject) {
        return `Inbound communication from ${sender}: ${subject}`;
      }

      if (sender) {
        return `Inbound communication from ${sender}`;
      }

      if (subject) {
        return `Inbound communication: ${subject}`;
      }

      return `Inbound communication received: ${sourceLabel}`;
    }
    case "deadline_drift_detected": {
      const workflow = readEventText(details, ["workflowName", "goalTitle", "title"], 120);
      const deadline = readEventText(details, ["deadline", "deadlineAt", "dueAt"], 80);

      if (workflow && deadline) {
        return `Deadline drift detected for ${workflow} (${deadline})`;
      }

      return workflow ? `Deadline drift detected for ${workflow}` : `Deadline drift detected: ${sourceLabel}`;
    }
    case "approval_sla_breached": {
      const approval = readEventText(details, ["approvalTitle", "title", "queue"], 120);
      return approval ? `Approval SLA breached: ${approval}` : `Approval SLA breached: ${sourceLabel}`;
    }
    case "workflow_stalled": {
      const workflow = readEventText(details, ["workflowName", "goalTitle", "title"], 120);
      return workflow ? `Workflow stalled: ${workflow}` : `Workflow stalled: ${sourceLabel}`;
    }
    case "connector_failed": {
      const connector = readEventText(details, ["connector", "provider", "service"], 120);
      return connector ? `Connector failure: ${connector}` : `Connector failure: ${sourceLabel}`;
    }
    case "dormant_workflow_review_due": {
      const workflow = readEventText(details, ["workflowName", "goalTitle", "title"], 120);
      return workflow ? `Dormant workflow review due: ${workflow}` : `Dormant workflow review due: ${sourceLabel}`;
    }
  }
}

function buildSimulatedAutopilotEvent(params: {
  userId: string;
  kind: CompatibilityAutopilotEventKind;
  sourceId: string;
  mode: AutopilotMode;
  summary: string;
  details: AutopilotEventDetails;
  idempotencyKey?: string | null;
  actorContext: ActorContext;
}) {
  return AutopilotEventSchema.parse({
    ...buildPendingEvent({
      userId: params.userId,
      kind: params.kind,
      sourceId: params.sourceId,
      mode: params.mode,
      summary: params.summary,
      details: params.details,
      idempotencyKey: params.idempotencyKey,
      actorContext: params.actorContext
    }),
    status: "simulated"
  });
}

function buildAutopilotEventDetails(params: {
  kind: CompatibilityAutopilotEventKind;
  sourceId: string;
  summary: string;
  idempotencyKey?: string | null;
  priority?: AutopilotEventPriority;
  tags?: string[];
  correlationKey?: string | null;
  budget?: AutopilotEventBudget | null;
  details?: Record<string, unknown>;
  operatorRoute?: AutopilotOperatorRoute | null;
  suppression?: {
    outcome: "allowed" | "duplicate" | "debounced" | "budget_exhausted";
    reason?: string | null;
    relatedEventId?: string | null;
    budgetKey?: string | null;
    observedCount?: number | null;
  };
}): AutopilotEventDetails {
  const tags = Array.from(
    new Set(
      [...autopilotDefaultTagsByKind[params.kind], ...(params.tags ?? [])]
        .map((tag) => tag.trim().toLowerCase())
        .filter((tag) => tag.length > 0)
    )
  );
  const effectivePriority = params.priority ?? autopilotPriorityByKind[params.kind];

  return AutopilotEventDetailsSchema.parse({
    ...(params.details ?? {}),
    fabric: buildCompatibilityFabricEnvelope({
      kind: params.kind,
      summary: params.summary,
      details: {
        ...(params.details ?? {}),
        sourceId: params.sourceId
      }
    }),
    eventEnvelope: {
      family: autopilotFamilyByKind[params.kind],
      trigger: params.kind,
      priority: effectivePriority,
      tags,
      correlationKey: params.correlationKey?.trim() || params.idempotencyKey?.trim() || `${params.kind}:${params.sourceId}`
    },
    policy: {
      family: autopilotFamilyByKind[params.kind],
      severity: effectivePriority,
      queue: autopilotQueueByKind[params.kind],
      modeRecommendation: params.kind === "approval_sla_breached" || params.kind === "connector_failed" ? "notify_only" : null
    },
    operatorRoute: params.operatorRoute ?? null,
    budget: params.budget ?? null,
    suppression: params.suppression ?? {
      outcome: "allowed"
    }
  });
}

function buildPendingEvent(params: {
  userId: string;
  kind: AutopilotEventKind;
  sourceId: string;
  mode: AutopilotMode;
  summary: string;
  details?: AutopilotEventDetails;
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

function shouldUseStrictEventFabricNormalization(
  kind: CompatibilityAutopilotEventKind,
  details: Record<string, unknown> | undefined
): kind is CompatibilityFabricAutopilotEventKind {
  if (!compatibilityFabricKinds.has(kind as CompatibilityFabricAutopilotEventKind) || !details) {
    return false;
  }

  switch (kind) {
    case "deadline_drift_detected":
      return "target" in details || "state" in details || "references" in details;
    case "workflow_stalled":
      return "stalledStep" in details || "status" in details || "references" in details;
    case "dormant_workflow_review_due":
      return "lastActivityAt" in details || "references" in details;
    default:
      return false;
  }
}

function measureProcessingLatencyMs(createdAt: string, processedAt: string): number {
  const createdMs = Date.parse(createdAt);
  const processedMs = Date.parse(processedAt);

  if (!Number.isFinite(createdMs) || !Number.isFinite(processedMs)) {
    return 0;
  }

  return Math.max(0, processedMs - createdMs);
}

function summarizeEnqueueFailure(createdAt: string, processedAt: string): Record<string, unknown> {
  return {
    failureStage: "enqueue",
    requiresReview: true,
    recoveryAction: "requeue_event",
    jobStatus: "enqueue_failed",
    processingLatencyMs: measureProcessingLatencyMs(createdAt, processedAt)
  };
}

function isCompatibilityAutopilotKind(kind: AutopilotEventKind): kind is CompatibilityAutopilotEventKind {
  return kind in autopilotFamilyByKind;
}

async function resolveWatcherSource(repository: AgenticRepository, sourceId: string, userId: string) {
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

  if (goal.goal.workspaceId) {
    const workspaceMembers = await repository.listWorkspaceMembers(goal.goal.workspaceId, userId);
    const role = workspaceMembers.find((member) => member.userId === userId)?.role;

    if (!canManageSharedWorkspaceAutomationsForRole(role)) {
      throw new ApiRouteError(403, SHARED_WORKSPACE_AUTOMATION_DENIED_REASON);
    }
  }

  return { repository, watcher, goal };
}

async function resolveTemplateSource(repository: AgenticRepository, sourceId: string, userId: string) {
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

async function resolveBriefingSource(repository: AgenticRepository, sourceId: string, userId: string) {
  const type = BriefingTypeSchema.parse(sourceId) as BriefingType;
  const preferences = await repository.getBriefingPreferences(userId);
  const schedule = preferences.schedules.find((candidate) => candidate.type === type);

  if (!schedule?.enabled) {
    throw new ApiRouteError(409, `Briefing ${type} is not enabled.`);
  }

  return { repository, type, preferences };
}

function requireDueScheduledAutopilotEvent(params: {
  kind: Extract<CompatibilityAutopilotEventKind, "template_due" | "briefing_due">;
  sourceId: string;
  dueAt: unknown;
  now?: Date;
}): string {
  const parsed = ScheduledAutopilotDueAtSchema.safeParse(params.dueAt);

  if (!parsed.success) {
    throw new ApiRouteError(409, `${params.kind} event for ${params.sourceId} requires an ISO dueAt timestamp.`);
  }

  if (Date.parse(parsed.data) > (params.now ?? new Date()).getTime()) {
    throw new ApiRouteError(409, `${params.kind} event for ${params.sourceId} is not due yet.`);
  }

  return parsed.data;
}

async function resolveGoalSource(repository: AgenticRepository, sourceId: string, userId: string) {
  const directGoal = await repository.getGoalBundleForUser(sourceId, userId);

  if (directGoal) {
    return directGoal;
  }

  const goals = await repository.listGoals(userId);
  return goals.find((candidate) => candidate.workflow.id === sourceId) ?? null;
}

async function resolveApprovalSource(repository: AgenticRepository, sourceId: string, userId: string) {
  const approvals = await repository.listApprovals(userId);
  return approvals.find((candidate) => candidate.id === sourceId) ?? null;
}

async function resolveConnectorSource(
  repository: AgenticRepository,
  sourceId: string,
  userId: string,
  details?: Record<string, unknown>
) {
  const normalizedSourceId = sourceId.trim().toLowerCase();
  const connectorHint = readEventText(details, ["connector", "provider", "service"], 120)?.toLowerCase() ?? null;
  const [credentials, integrations] = await Promise.all([
    repository.listProviderCredentials(userId),
    repository.listIntegrations(userId)
  ]);

  const credential =
    credentials.find((candidate) => candidate.id === sourceId) ??
    credentials.find((candidate) =>
      [candidate.provider, candidate.displayName, candidate.accountEmail, candidate.accountId]
        .filter((value): value is string => typeof value === "string" && value.length > 0)
        .some((value) => value.toLowerCase() === normalizedSourceId || value.toLowerCase() === connectorHint)
    ) ??
    null;
  const integration =
    integrations.find((candidate) => candidate.id === sourceId) ??
    integrations.find((candidate) =>
      [candidate.system, candidate.name]
        .filter((value): value is string => typeof value === "string" && value.length > 0)
        .some((value) => value.toLowerCase() === normalizedSourceId || value.toLowerCase() === connectorHint)
    ) ??
    null;

  return {
    credential,
    integration
  };
}

async function resolveGenericAutopilotSource(params: {
  repository: AgenticRepository;
  kind: GenericAutopilotEventKind;
  sourceId: string;
  userId: string;
  details?: Record<string, unknown>;
}): Promise<ResolvedAutopilotSource> {
  const { repository, kind, sourceId, userId, details } = params;
  const summary = buildGenericAutopilotSummary(kind, sourceId, details);

  switch (kind) {
    case "communication_received": {
      const linkedGoalId = normalizeEventText(details?.goalId, 200);
      const goal = linkedGoalId ? await resolveGoalSource(repository, linkedGoalId, userId) : null;

      return {
        summary,
        details: {
          ...(details ?? {}),
          goalId: goal?.goal.id ?? linkedGoalId ?? null,
          workflowId: goal?.workflow.id ?? null,
          workspaceId: goal?.workflow.workspaceId ?? null,
          goalTitle: goal?.goal.title ?? readEventText(details, ["goalTitle", "title"], 160)
        },
        operatorRoute: goal
          ? {
              section: "goals",
              itemId: goal.goal.id,
              label: goal.goal.title,
              actionLabel: "Open goal"
            }
          : {
              section: "operations",
              label: summary,
              actionLabel: "Open operations"
            }
      };
    }
    case "deadline_drift_detected":
    case "workflow_stalled":
    case "dormant_workflow_review_due": {
      const goal = await resolveGoalSource(repository, sourceId, userId);

      return {
        summary,
        details: {
          ...(details ?? {}),
          goalId: goal?.goal.id ?? normalizeEventText(details?.goalId, 200) ?? null,
          workflowId: goal?.workflow.id ?? normalizeEventText(details?.workflowId, 200) ?? null,
          workspaceId: goal?.workflow.workspaceId ?? normalizeEventText(details?.workspaceId, 200) ?? null,
          goalTitle: goal?.goal.title ?? readEventText(details, ["goalTitle", "title"], 160),
          workflowName:
            readEventText(details, ["workflowName"], 160) ??
            (goal ? `${goal.goal.title} / ${goal.workflow.currentStep}` : null)
        },
        operatorRoute: goal
          ? {
              section: "goals",
              itemId: goal.goal.id,
              label: goal.goal.title,
              actionLabel: kind === "dormant_workflow_review_due" ? "Review workflow" : "Open goal"
            }
          : {
              section: "operations",
              label: summary,
              actionLabel: "Open operations"
            }
      };
    }
    case "approval_sla_breached": {
      const approval = await resolveApprovalSource(repository, sourceId, userId);
      const approvalGoal = approval ? await repository.getGoalBundleForUser(approval.goalId, userId) : null;

      return {
        summary: approval ? `Approval SLA breached: ${approval.title}` : summary,
        details: {
          ...(details ?? {}),
          approvalId: approval?.id ?? normalizeEventText(details?.approvalId, 200) ?? null,
          goalId: approval?.goalId ?? normalizeEventText(details?.goalId, 200) ?? null,
          taskId: approval?.taskId ?? normalizeEventText(details?.taskId, 200) ?? null,
          approvalTitle: approval?.title ?? readEventText(details, ["approvalTitle", "title"], 160),
          workspaceId: approvalGoal?.workflow.workspaceId ?? null,
          riskClass: approval?.riskClass ?? null
        },
        operatorRoute: approval
          ? {
              section: "approvals",
              itemId: approval.id,
              label: approval.title,
              actionLabel: "Open approval"
            }
          : {
              section: "operations",
              label: summary,
              actionLabel: "Open operations"
            }
      };
    }
    case "connector_failed": {
      const connector = await resolveConnectorSource(repository, sourceId, userId, details);
      const connectorLabel =
        connector.integration?.name ??
        connector.integration?.system ??
        connector.credential?.displayName ??
        connector.credential?.provider ??
        readEventText(details, ["connector", "provider", "service"], 120) ??
        sourceId;

      return {
        summary: `Connector failure: ${connectorLabel}`,
        details: {
          ...(details ?? {}),
          connector: connectorLabel,
          credentialId: connector.credential?.id ?? null,
          integrationId: connector.integration?.id ?? null,
          workspaceId: connector.credential?.workspaceId ?? null,
          provider: connector.credential?.provider ?? null,
          connectorStatus: connector.credential?.status ?? connector.integration?.status ?? null
        },
        operatorRoute: {
          section: "operations",
          label: connectorLabel,
          actionLabel: "Open operations"
        }
      };
    }
  }
}

async function resolveAutopilotSource(params: {
  repository: AgenticRepository;
  kind: CompatibilityAutopilotEventKind;
  sourceId: string;
  userId: string;
  details?: Record<string, unknown>;
}): Promise<ResolvedAutopilotSource> {
  const { repository, kind, sourceId, userId, details } = params;

  switch (kind) {
    case "watcher_triggered": {
      const { watcher, goal } = await resolveWatcherSource(repository, sourceId, userId);
      return {
        summary: `Watcher triggered: ${watcher.targetEntity}`,
        details: {
          ...(details ?? {}),
          watcherId: watcher.id,
          goalId: goal.goal.id,
          workflowId: goal.workflow.id,
          workspaceId: goal.workflow.workspaceId ?? null,
          goalTitle: goal.goal.title
        },
        operatorRoute: {
          section: "watchers",
          itemId: watcher.id,
          label: watcher.targetEntity,
          actionLabel: "Open watcher"
        }
      };
    }
    case "template_due": {
      const { template } = await resolveTemplateSource(repository, sourceId, userId);
      const dueAt = requireDueScheduledAutopilotEvent({
        kind,
        sourceId,
        dueAt: template.schedule.nextRunAt
      });
      return {
        summary: `Template due: ${template.name}`,
        details: {
          ...(details ?? {}),
          templateId: template.id,
          dueAt
        },
        operatorRoute: {
          section: "operations",
          label: template.name,
          actionLabel: "Open operations"
        }
      };
    }
    case "briefing_due": {
      const { type } = await resolveBriefingSource(repository, sourceId, userId);
      const dueAt = requireDueScheduledAutopilotEvent({
        kind,
        sourceId,
        dueAt: details?.dueAt
      });
      return {
        summary: `Briefing due: ${type}`,
        details: {
          ...(details ?? {}),
          briefingType: type,
          dueAt
        },
        operatorRoute: {
          section: "operations",
          label: `Briefing ${type}`,
          actionLabel: "Open operations"
        }
      };
    }
    default:
      return resolveGenericAutopilotSource({
        repository,
        kind,
        sourceId,
        userId,
        details
      });
  }
}

async function findAutopilotProcessJob(
  repository: AgenticRepository,
  userId: string,
  autopilotEventId: string
) {
  const jobs = await repository.listJobs({
    userId,
    kinds: ["autopilot_process"]
  });

  return (
    jobs.find(
      (job) => job.payload.type === "autopilot_process" && job.payload.autopilotEventId === autopilotEventId
    ) ?? null
  );
}

function shouldEnsureAutopilotJob(event: AutopilotEvent): boolean {
  if (event.status === "pending") {
    return true;
  }

  if (event.status !== "failed") {
    return false;
  }

  return typeof event.details.jobId !== "string";
}

async function ensureAutopilotProcessJob(repository: AgenticRepository, event: AutopilotEvent) {
  const existing = await findAutopilotProcessJob(repository, event.userId, event.id);

  if (existing) {
    return {
      job: existing,
      created: false
    };
  }

  return {
    job: await enqueueAutopilotProcessJob({
      repository,
      autopilotEvent: event
    }),
    created: true
  };
}

export async function POST(request: Request) {
  return withApiTelemetry(request, "api.autopilot.events.create", async () => {
    try {
      requireJsonContentType(request);
      const principal = await requireApiSession(request);
      const rateLimit = await checkAbuseRateLimit({
        request,
        principal,
        namespace: "autopilot-event"
      });

      if (!rateLimit.allowed) {
        return authenticatedRateLimitError("Too many autopilot event requests. Try again later.", rateLimit.retryAfterSeconds);
      }

      const actorContext = createActorContextFromPrincipal(principal);
      const repository = await getSeededRepository();
      const settings = await repository.getAutopilotSettings(principal.userId);
      const body = await parseJsonBody(request, TriggerAutopilotEventSchema);
      const effectiveMode = body.mode ?? settings.mode;
      const bodyDetails = body.details;
      const normalizedDetails =
        typeof bodyDetails === "object" && bodyDetails !== null && !Array.isArray(bodyDetails)
          ? (bodyDetails as Record<string, unknown>)
          : undefined;
      const compatibilityKind = isCompatibilityAutopilotKind(body.kind) ? body.kind : null;
      const normalized = compatibilityKind
        ? shouldUseStrictEventFabricNormalization(compatibilityKind, normalizedDetails)
          ? await normalizeAutopilotEventRequest({
              repository,
              userId: principal.userId,
              body
            })
          : await (async () => {
            const resolvedSource = await resolveAutopilotSource({
              repository,
              kind: compatibilityKind,
              sourceId: body.sourceId,
              userId: principal.userId,
              details: normalizedDetails
            });

            return {
              summary: body.summary?.trim() || resolvedSource.summary,
              details: buildAutopilotEventDetails({
                kind: compatibilityKind,
                sourceId: body.sourceId,
                summary: body.summary?.trim() || resolvedSource.summary,
                idempotencyKey: body.idempotencyKey ?? null,
                priority: body.priority,
                tags: body.tags,
                correlationKey: body.correlationKey,
                budget: body.budget ?? null,
                details: {
                  ...resolvedSource.details,
                  ...(body.dryRun ? { dryRun: true } : {})
                },
                operatorRoute: resolvedSource.operatorRoute ?? null
              })
            };
          })()
        : await normalizeAutopilotEventRequest({
            repository,
            userId: principal.userId,
            body
          });
      const normalizedEvent = body.dryRun
        ? {
            ...normalized,
            details: {
              ...normalized.details,
              dryRun: true
            }
          }
        : normalized;

      if (effectiveMode === "auto_run" && repository.backend !== "postgres") {
        return authenticatedJson(
          {
            error: "Autopilot auto-run requires Postgres-backed persistence.",
            backend: repository.backend
          },
          { status: 409 }
        );
      }

      if (body.dryRun) {
        const event = isCompatibilityAutopilotKind(body.kind)
          ? buildSimulatedAutopilotEvent({
              userId: principal.userId,
              kind: body.kind,
              sourceId: body.sourceId,
              mode: effectiveMode,
              summary: normalizedEvent.summary,
              details: normalizedEvent.details as AutopilotEventDetails,
              idempotencyKey: body.idempotencyKey,
              actorContext
            })
          : buildDryRunAutopilotEvent({
              dryRun: true,
              event: buildPendingEvent({
                userId: principal.userId,
                kind: body.kind,
                sourceId: body.sourceId,
                mode: effectiveMode,
                summary: normalizedEvent.summary,
                details: AutopilotEventDetailsSchema.parse(normalizedEvent.details),
                idempotencyKey: body.idempotencyKey,
                actorContext
              })
            });

        return authenticatedJson({
          event,
          simulated: true,
          dashboard: await repository.getDashboardData(principal.userId)
        });
      }

      const claim = await repository.claimAutopilotEvent({
        userId: principal.userId,
        kind: body.kind,
        sourceId: body.sourceId,
        idempotencyKey: body.idempotencyKey ?? null,
        mode: effectiveMode,
        summary: normalizedEvent.summary,
        details: normalizedEvent.details,
        actorContext,
        debounceMinutes: settings.debounceMinutes,
        reliabilityControls: settings.reliabilityControls
      });

      if (claim.outcome === "ignored") {
        return authenticatedJson({
          event: claim.event,
          ignored: true,
          dashboard: await repository.getDashboardData(principal.userId)
        });
      }

      if (claim.outcome === "duplicate" || claim.outcome === "debounced" || claim.outcome === "suppressed") {
        if (claim.outcome === "duplicate" && shouldEnsureAutopilotJob(claim.event)) {
          try {
            const { job } = await ensureAutopilotProcessJob(repository, claim.event);

            return authenticatedJson(
              {
                event: claim.event,
                job,
                duplicate: true,
                queued: true,
                debounced: false,
                dashboard: await repository.getDashboardData(principal.userId)
              },
              { status: 202 }
            );
          } catch {
            const processedAt = nowIso();
            const failedEvent = await repository.saveAutopilotEvent({
              ...claim.event,
              status: "failed",
              processedAt,
              details: {
                ...claim.event.details,
                ...summarizeEnqueueFailure(claim.event.createdAt, processedAt)
              },
              error: "Autopilot execution failed."
            });

            return authenticatedJson(
              {
                event: failedEvent,
                duplicate: true,
                queued: false,
                error: failedEvent.error,
                dashboard: await repository.getDashboardData(principal.userId)
              },
              { status: 500 }
            );
          }
        }

        return authenticatedJson({
          event: claim.event,
          duplicate: claim.outcome === "duplicate",
          debounced: claim.outcome === "debounced",
          suppressed: claim.outcome === "suppressed",
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
        const { job } = await ensureAutopilotProcessJob(repository, claim.event);

        return authenticatedJson(
          {
            event: claim.event,
            job,
            queued: true,
            dashboard: await repository.getDashboardData(principal.userId)
          },
          { status: 202 }
        );
      } catch {
        const processedAt = nowIso();
        const failedEvent = await repository.saveAutopilotEvent(
          AutopilotEventSchema.parse({
            ...claim.event,
            status: "failed",
            processedAt,
            details: {
              ...claim.event.details,
              ...summarizeEnqueueFailure(claim.event.createdAt, processedAt)
            },
            error: "Autopilot execution failed."
          })
        );

        return authenticatedJson(
          {
            event: failedEvent,
            error: failedEvent.error,
            dashboard: await repository.getDashboardData(principal.userId)
          },
          { status: 500 }
        );
      }
    } catch (error) {
      return handleApiError(error, "Failed to trigger autopilot event.");
    }
  });
}
