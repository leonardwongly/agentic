import { z } from "zod";
import {
  AUTOPILOT_EVENT_TAXONOMY,
  AutopilotEventFabricEnvelopeSchema,
  AutopilotEventKindSchema,
  AutopilotModeSchema,
  BriefingTypeSchema,
  type AutopilotEvent,
  type AutopilotEventFabricEnvelope,
  type AutopilotEventKind,
  type BriefingType
} from "@agentic/contracts";
import type { AgenticRepository } from "@agentic/repository";
import { ApiRouteError } from "./api-response";

const BaseTriggerAutopilotEventSchema = z
  .object({
    kind: AutopilotEventKindSchema,
    sourceId: z.string().trim().min(1).max(200),
    summary: z.string().trim().min(1).max(200).optional(),
    details: z.unknown().optional(),
    idempotencyKey: z.string().trim().min(1).max(200).optional(),
    dryRun: z.boolean().optional().default(false),
    mode: AutopilotModeSchema.optional()
  })
  .strict();

const CommunicationChannelSchema = z.enum(["email", "chat", "ticket", "sms", "call", "other"]);
const TriggerUrgencySchema = z.enum(["low", "medium", "high", "critical"]);
const DeadlineStateSchema = z.enum(["upcoming", "at_risk", "breached"]);
const ApprovalAttentionStatusSchema = z.enum(["pending", "stale", "overdue"]);
const FailureClassSchema = z.enum(["integration", "policy", "runtime", "data"]);
const WorkflowStallStateSchema = z.enum(["waiting", "blocked", "retrying"]);

const EventReferenceInputSchema = z
  .object({
    goalId: z.string().trim().min(1).max(200).optional(),
    workflowId: z.string().trim().min(1).max(200).optional(),
    approvalId: z.string().trim().min(1).max(200).optional()
  })
  .strict()
  .optional()
  .default({});

const InboundCommunicationDetailsSchema = z
  .object({
    channel: CommunicationChannelSchema,
    counterparty: z.string().trim().min(1).max(200),
    subject: z.string().trim().min(1).max(200).optional(),
    messagePreview: z.string().trim().min(1).max(500).optional(),
    urgency: TriggerUrgencySchema.optional(),
    receivedAt: z.string().datetime().optional(),
    references: EventReferenceInputSchema
  })
  .strict();

const DeadlineDriftDetailsSchema = z
  .object({
    target: z.string().trim().min(1).max(200),
    deadlineAt: z.string().datetime(),
    state: DeadlineStateSchema,
    reason: z.string().trim().min(1).max(500).optional(),
    daysOverdue: z.number().int().min(0).max(3650).optional(),
    references: EventReferenceInputSchema
  })
  .strict();

const ApprovalAttentionDetailsSchema = z
  .object({
    requestedAction: z.string().trim().min(1).max(200),
    status: ApprovalAttentionStatusSchema,
    approverLabel: z.string().trim().min(1).max(200).optional(),
    requestedAt: z.string().datetime().optional(),
    references: EventReferenceInputSchema
  })
  .strict();

const ExecutionFailureDetailsSchema = z
  .object({
    component: z.string().trim().min(1).max(200),
    failureClass: FailureClassSchema,
    failureStage: z.string().trim().min(1).max(120),
    observedAt: z.string().datetime().optional(),
    summary: z.string().trim().min(1).max(500).optional(),
    references: EventReferenceInputSchema
  })
  .strict();

const WorkflowStalledDetailsSchema = z
  .object({
    stalledStep: z.string().trim().min(1).max(200),
    status: WorkflowStallStateSchema,
    stalledSince: z.string().datetime().optional(),
    blocker: z.string().trim().min(1).max(500).optional(),
    references: EventReferenceInputSchema
  })
  .strict();

const DormantWorkflowReviewDetailsSchema = z
  .object({
    dormantDays: z.number().int().min(1).max(3650),
    lastActivityAt: z.string().datetime(),
    reviewReason: z.string().trim().min(1).max(500).optional(),
    references: EventReferenceInputSchema
  })
  .strict();

const LEGACY_AUTOPILOT_EVENT_KINDS = new Set<AutopilotEventKind>([
  "watcher_triggered",
  "template_due",
  "briefing_due"
]);

type TriggerAutopilotEventInput = z.infer<typeof BaseTriggerAutopilotEventSchema>;
type EventReferenceInput = z.infer<typeof EventReferenceInputSchema>;

type NormalizedAutopilotRequest = {
  summary: string;
  details: Record<string, unknown>;
};

export const TriggerAutopilotEventSchema = BaseTriggerAutopilotEventSchema;

function buildReferenceDefaults(overrides?: Partial<AutopilotEventFabricEnvelope["references"]>) {
  return {
    goalId: null,
    workflowId: null,
    approvalId: null,
    watcherId: null,
    templateId: null,
    briefingType: null,
    ...(overrides ?? {})
  };
}

function buildEventFabricEnvelope(params: {
  kind: AutopilotEventKind;
  summary: string;
  trigger: Record<string, unknown>;
  references?: Partial<AutopilotEventFabricEnvelope["references"]>;
  severity?: AutopilotEventFabricEnvelope["severity"];
}): AutopilotEventFabricEnvelope {
  const taxonomy = AUTOPILOT_EVENT_TAXONOMY[params.kind];

  return AutopilotEventFabricEnvelopeSchema.parse({
    version: 1,
    family: taxonomy.family,
    severity: params.severity ?? taxonomy.defaultSeverity,
    operatorRoute: taxonomy.operatorRoute,
    policy: taxonomy.policy,
    references: buildReferenceDefaults(params.references),
    signals: [
      taxonomy.family.replaceAll("_", "-"),
      taxonomy.operatorRoute.replaceAll("_", "-"),
      params.kind.replaceAll("_", "-")
    ],
    trigger: params.trigger,
    summary: params.summary
  });
}

function parseLegacyDetails(details: unknown) {
  if (details === undefined) {
    return {};
  }

  return z.record(z.string().min(1).max(100), z.unknown()).parse(details);
}

function deriveSeverityFromUrgency(
  urgency: z.infer<typeof TriggerUrgencySchema> | undefined,
  fallback: AutopilotEventFabricEnvelope["severity"]
) {
  return urgency ?? fallback;
}

function buildCommunicationSummary(details: z.infer<typeof InboundCommunicationDetailsSchema>) {
  return `Inbound ${details.channel} from ${details.counterparty}`;
}

function buildDeadlineSummary(details: z.infer<typeof DeadlineDriftDetailsSchema>) {
  return `Deadline ${details.state.replaceAll("_", " ")}: ${details.target}`;
}

function buildApprovalSummary(details: z.infer<typeof ApprovalAttentionDetailsSchema>) {
  return `Approval ${details.status.replaceAll("_", " ")}: ${details.requestedAction}`;
}

function buildExecutionFailureSummary(details: z.infer<typeof ExecutionFailureDetailsSchema>) {
  return `Execution failure detected in ${details.component}`;
}

function buildWorkflowStallSummary(details: z.infer<typeof WorkflowStalledDetailsSchema>) {
  return `Workflow stalled at ${details.stalledStep}`;
}

function buildDormantWorkflowSummary(details: z.infer<typeof DormantWorkflowReviewDetailsSchema>) {
  return `Dormant workflow review due after ${details.dormantDays} days`;
}

async function resolveWorkflowReference(repository: AgenticRepository, userId: string, workflowId: string) {
  const goals = await repository.listGoals(userId);
  return goals.find((bundle) => bundle.workflow.id === workflowId) ?? null;
}

async function resolveReferences(
  repository: AgenticRepository,
  userId: string,
  references: EventReferenceInput
) {
  const goal = references.goalId
    ? await repository.getGoalBundleForUser(references.goalId, userId)
    : null;
  const workflowGoal = references.workflowId
    ? await resolveWorkflowReference(repository, userId, references.workflowId)
    : null;
  const approval = references.approvalId
    ? (await repository.listApprovals(userId)).find((candidate) => candidate.id === references.approvalId) ?? null
    : null;

  if (references.goalId && !goal) {
    throw new ApiRouteError(404, `Goal ${references.goalId} was not found.`);
  }

  if (references.workflowId && !workflowGoal) {
    throw new ApiRouteError(404, `Workflow ${references.workflowId} was not found.`);
  }

  if (references.approvalId && !approval) {
    throw new ApiRouteError(404, `Approval ${references.approvalId} was not found.`);
  }

  const resolvedGoalId = goal?.goal.id ?? workflowGoal?.goal.id ?? approval?.goalId ?? null;
  const resolvedWorkflowId = workflowGoal?.workflow.id ?? goal?.workflow.id ?? null;

  if (goal && workflowGoal && goal.goal.id !== workflowGoal.goal.id) {
    throw new ApiRouteError(409, "Goal and workflow references must point to the same workflow.");
  }

  if (approval && goal && approval.goalId !== goal.goal.id) {
    throw new ApiRouteError(409, "Approval and goal references must point to the same goal.");
  }

  if (approval && workflowGoal && approval.goalId !== workflowGoal.goal.id) {
    throw new ApiRouteError(409, "Approval and workflow references must point to the same goal.");
  }

  return buildReferenceDefaults({
    goalId: resolvedGoalId,
    workflowId: resolvedWorkflowId,
    approvalId: approval?.id ?? null
  });
}

function buildDryRunEvent(event: AutopilotEvent) {
  return {
    ...event,
    status: "simulated" as const
  };
}

export async function normalizeAutopilotEventRequest(params: {
  repository: AgenticRepository;
  userId: string;
  body: TriggerAutopilotEventInput;
}) {
  const { body, repository, userId } = params;

  if (LEGACY_AUTOPILOT_EVENT_KINDS.has(body.kind)) {
    const details = parseLegacyDetails(body.details);

    if (body.kind === "watcher_triggered") {
      const watchers = await repository.listWatchers({ userId });
      const watcher = watchers.find((candidate) => candidate.id === body.sourceId);

      if (!watcher) {
        throw new ApiRouteError(404, `Watcher ${body.sourceId} was not found.`);
      }

      if (watcher.status !== "active") {
        throw new ApiRouteError(409, `Watcher ${body.sourceId} is not active.`);
      }

      const goal = await repository.getGoalBundleForUser(watcher.goalId, userId);

      if (!goal) {
        throw new ApiRouteError(404, `Watcher goal ${watcher.goalId} was not found.`);
      }

      const summary = body.summary?.trim() || `Watcher triggered: ${watcher.targetEntity}`;
      const fabric = buildEventFabricEnvelope({
        kind: body.kind,
        summary,
        references: {
          goalId: goal.goal.id,
          workflowId: goal.workflow.id,
          watcherId: watcher.id
        },
        trigger: {
          targetEntity: watcher.targetEntity,
          condition: watcher.condition,
          triggerAction: watcher.triggerAction,
          sourceSystems: watcher.sourceSystems
        }
      });

      return {
        summary,
        details: {
          ...details,
          watcherId: watcher.id,
          fabric
        }
      } satisfies NormalizedAutopilotRequest;
    }

    if (body.kind === "template_due") {
      const templates = await repository.listTemplates(userId);
      const template = templates.find((candidate) => candidate.id === body.sourceId);

      if (!template) {
        throw new ApiRouteError(404, `Template ${body.sourceId} was not found.`);
      }

      if (!template.schedule.enabled) {
        throw new ApiRouteError(409, `Template ${body.sourceId} does not have scheduling enabled.`);
      }

      const summary = body.summary?.trim() || `Template due: ${template.name}`;
      const fabric = buildEventFabricEnvelope({
        kind: body.kind,
        summary,
        references: {
          templateId: template.id
        },
        trigger: {
          templateName: template.name,
          scheduleTimezone: template.schedule.timezone,
          scheduleCron: template.schedule.cron
        }
      });

      return {
        summary,
        details: {
          ...details,
          templateId: template.id,
          fabric
        }
      } satisfies NormalizedAutopilotRequest;
    }

    const type = BriefingTypeSchema.parse(body.sourceId) as BriefingType;
    const preferences = await repository.getBriefingPreferences(userId);
    const schedule = preferences.schedules.find((candidate) => candidate.type === type);

    if (!schedule?.enabled) {
      throw new ApiRouteError(409, `Briefing ${type} is not enabled.`);
    }

    const summary = body.summary?.trim() || `Briefing due: ${type}`;
    const fabric = buildEventFabricEnvelope({
      kind: body.kind,
      summary,
      references: {
        briefingType: type
      },
      trigger: {
        briefingType: type,
        focus: preferences.focus,
        timezone: preferences.timezone
      }
    });

    return {
      summary,
      details: {
        ...details,
        briefingType: type,
        fabric
      }
    } satisfies NormalizedAutopilotRequest;
  }

  if (body.kind === "inbound_communication_received") {
    const details = InboundCommunicationDetailsSchema.parse(body.details ?? {});
    const references = await resolveReferences(repository, userId, details.references);
    const summary = body.summary?.trim() || buildCommunicationSummary(details);
    const fabric = buildEventFabricEnvelope({
      kind: body.kind,
      summary,
      references,
      severity: deriveSeverityFromUrgency(details.urgency, AUTOPILOT_EVENT_TAXONOMY[body.kind].defaultSeverity),
      trigger: {
        channel: details.channel,
        counterparty: details.counterparty,
        subject: details.subject ?? null,
        messagePreview: details.messagePreview ?? null,
        urgency: details.urgency ?? AUTOPILOT_EVENT_TAXONOMY[body.kind].defaultSeverity,
        receivedAt: details.receivedAt ?? null
      }
    });

    return {
      summary,
      details: {
        ...details,
        references,
        fabric
      }
    } satisfies NormalizedAutopilotRequest;
  }

  if (body.kind === "deadline_drift_detected") {
    const details = DeadlineDriftDetailsSchema.parse(body.details ?? {});
    const references = await resolveReferences(repository, userId, details.references);
    const summary = body.summary?.trim() || buildDeadlineSummary(details);
    const severity = details.state === "breached" ? "critical" : AUTOPILOT_EVENT_TAXONOMY[body.kind].defaultSeverity;
    const fabric = buildEventFabricEnvelope({
      kind: body.kind,
      summary,
      references,
      severity,
      trigger: {
        target: details.target,
        deadlineAt: details.deadlineAt,
        state: details.state,
        reason: details.reason ?? null,
        daysOverdue: details.daysOverdue ?? null
      }
    });

    return {
      summary,
      details: {
        ...details,
        references,
        fabric
      }
    } satisfies NormalizedAutopilotRequest;
  }

  if (body.kind === "approval_attention_required") {
    const details = ApprovalAttentionDetailsSchema.parse(body.details ?? {});
    const references = await resolveReferences(repository, userId, details.references);
    const summary = body.summary?.trim() || buildApprovalSummary(details);
    const severity = details.status === "overdue" ? "critical" : AUTOPILOT_EVENT_TAXONOMY[body.kind].defaultSeverity;
    const fabric = buildEventFabricEnvelope({
      kind: body.kind,
      summary,
      references,
      severity,
      trigger: {
        requestedAction: details.requestedAction,
        status: details.status,
        approverLabel: details.approverLabel ?? null,
        requestedAt: details.requestedAt ?? null
      }
    });

    return {
      summary,
      details: {
        ...details,
        references,
        fabric
      }
    } satisfies NormalizedAutopilotRequest;
  }

  if (body.kind === "execution_failure_detected") {
    const details = ExecutionFailureDetailsSchema.parse(body.details ?? {});
    const references = await resolveReferences(repository, userId, details.references);
    const summary = body.summary?.trim() || buildExecutionFailureSummary(details);
    const fabric = buildEventFabricEnvelope({
      kind: body.kind,
      summary,
      references,
      severity: "critical",
      trigger: {
        component: details.component,
        failureClass: details.failureClass,
        failureStage: details.failureStage,
        observedAt: details.observedAt ?? null,
        summary: details.summary ?? null
      }
    });

    return {
      summary,
      details: {
        ...details,
        references,
        fabric
      }
    } satisfies NormalizedAutopilotRequest;
  }

  if (body.kind === "workflow_stalled") {
    const details = WorkflowStalledDetailsSchema.parse(body.details ?? {});
    const references = await resolveReferences(repository, userId, details.references);
    const summary = body.summary?.trim() || buildWorkflowStallSummary(details);
    const severity = details.status === "blocked" ? "high" : AUTOPILOT_EVENT_TAXONOMY[body.kind].defaultSeverity;
    const fabric = buildEventFabricEnvelope({
      kind: body.kind,
      summary,
      references,
      severity,
      trigger: {
        stalledStep: details.stalledStep,
        status: details.status,
        stalledSince: details.stalledSince ?? null,
        blocker: details.blocker ?? null
      }
    });

    return {
      summary,
      details: {
        ...details,
        references,
        fabric
      }
    } satisfies NormalizedAutopilotRequest;
  }

  const details = DormantWorkflowReviewDetailsSchema.parse(body.details ?? {});
  const references = await resolveReferences(repository, userId, details.references);
  const summary = body.summary?.trim() || buildDormantWorkflowSummary(details);
  const fabric = buildEventFabricEnvelope({
    kind: body.kind,
    summary,
    references,
    trigger: {
      dormantDays: details.dormantDays,
      lastActivityAt: details.lastActivityAt,
      reviewReason: details.reviewReason ?? null
    }
  });

  return {
    summary,
    details: {
      ...details,
      references,
      fabric
    }
  } satisfies NormalizedAutopilotRequest;
}

export function buildDryRunAutopilotEvent(params: {
  event: AutopilotEvent;
  dryRun: boolean;
}) {
  if (!params.dryRun) {
    return params.event;
  }

  return buildDryRunEvent({
    ...params.event,
    details: {
      ...params.event.details,
      dryRun: true
    }
  });
}
