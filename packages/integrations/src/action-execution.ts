import { createHash } from "node:crypto";
import {
  ActionExecutionOutcomeSchema,
  ActionExecutionPlanSchema,
  type ActionExecutionOutcome,
  type ActionExecutionPlan,
  type ActionIntent,
  type ApprovalPreview,
  type Task
} from "@agentic/contracts";
import { normalizeConnectorThrownError } from "./connector-errors";

export type ActionExecutionAdapters = {
  gmail?: {
    createDraft: (params: { to: string; subject: string; body: string; threadId?: string }) => Promise<{ id: string }>;
    sendDraft: (draftId: string) => Promise<{ messageId: string }>;
    listRecentEmails: (maxResults?: number, query?: string) => Promise<Array<{ id: string; from: string; subject: string; snippet: string }>>;
  };
  calendar?: {
    createEvent: (params: { summary: string; start: string; end: string; description?: string; attendees?: string[] }) => Promise<{ id: string; htmlLink: string }>;
    updateEvent: (params: { eventId: string; summary?: string; start?: string; end?: string }) => Promise<{ id: string }>;
    listUpcomingEvents: (params?: { maxResults?: number }) => Promise<Array<{ id: string; summary: string; start: string; end: string }>>;
  };
  notes?: {
    createLocalNote: (params: { title: string; content: string }) => Promise<{ slug: string }>;
  };
};

function inferApprovalActionType(task: Task): ApprovalPreview["actionType"] {
  if (task.toolCapabilities.includes("delete")) {
    return "delete";
  }

  if (task.toolCapabilities.includes("send")) {
    return "send";
  }

  if (task.toolCapabilities.includes("schedule")) {
    return "schedule";
  }

  if (task.toolCapabilities.includes("update")) {
    return "update";
  }

  if (task.toolCapabilities.includes("create")) {
    return "create";
  }

  if (task.toolCapabilities.includes("draft")) {
    return "draft";
  }

  return "artifact-only";
}

function actionTypeForApproval(task: Task, actionIntent: ActionIntent): ApprovalPreview["actionType"] {
  switch (actionIntent.type) {
    case "send_message":
      return actionIntent.mode === "send" ? "send" : "draft";
    case "schedule_event":
      return "schedule";
    case "create_note":
      return "create";
    case "manual_review":
      return actionIntent.actionType;
    case "update_record":
      return "update";
    case "delete_record":
      return "delete";
    case "monitor_signal":
      return "artifact-only";
    default:
      return inferApprovalActionType(task);
  }
}

function inferApprovalImpact(task: Task, actionType: ApprovalPreview["actionType"]): ApprovalPreview["impact"] {
  const affectedSystems = new Set<string>();

  if (task.assignedAgent === "communications" || task.toolCapabilities.includes("send") || task.toolCapabilities.includes("draft")) {
    affectedSystems.add("email");
  }

  if (task.assignedAgent === "calendar" || task.toolCapabilities.includes("schedule")) {
    affectedSystems.add("calendar");
  }

  if (task.toolCapabilities.includes("create") || task.toolCapabilities.includes("update")) {
    affectedSystems.add("workspace");
  }

  return {
    affectedPeople: actionType === "send" ? ["external recipients"] : [],
    affectedSystems: [...affectedSystems],
    permissions: task.toolCapabilities,
    rollback: actionType === "delete" ? "not_supported" : actionType === "draft" || actionType === "artifact-only" ? "supported" : "manual"
  };
}

function buildApprovalPreview(task: Task, actionIntent: ActionIntent): ApprovalPreview {
  const actionType = actionTypeForApproval(task, actionIntent);
  const target =
    actionIntent.type === "send_message"
      ? actionIntent.to
      : actionIntent.type === "schedule_event"
        ? "Calendar commitment"
        : actionIntent.type === "create_note"
          ? actionIntent.title
          : actionType === "send"
            ? "External communication"
            : actionType === "schedule"
              ? "Calendar commitment"
              : actionType === "create"
                ? "New workspace artifact"
                : actionType === "update"
                  ? "Existing workspace state"
                  : actionType === "delete"
                    ? "Existing record"
                    : actionType === "draft"
                      ? "Draft artifact"
                      : task.title;
  const summary =
    actionIntent.type === "send_message"
      ? `Draft ${actionIntent.mode === "send" ? "and send" : "an"} email to ${actionIntent.to}: ${actionIntent.subject}`
      : actionIntent.type === "schedule_event"
        ? `Schedule "${actionIntent.summary}" from ${actionIntent.start} to ${actionIntent.end}`
        : actionIntent.type === "create_note"
          ? `Create note "${actionIntent.title}"`
          : actionIntent.type === "update_record"
            ? `Update ${actionIntent.targetType} ${actionIntent.targetId}: ${actionIntent.reason}`
            : actionIntent.type === "delete_record"
              ? `Delete ${actionIntent.targetType} ${actionIntent.targetId}: ${actionIntent.reason}`
              : actionIntent.type === "monitor_signal"
                ? `Monitor ${actionIntent.targetEntity}: ${actionIntent.condition}`
                : actionIntent.summary;
  const changes =
    actionIntent.type === "send_message"
      ? [
          {
            label: "Recipient",
            before: "Pending user review",
            after: actionIntent.to
          },
          {
            label: "Subject",
            before: "Pending user review",
            after: actionIntent.subject
          }
        ]
      : actionIntent.type === "schedule_event"
        ? [
            {
              label: "Scheduled window",
              before: "Pending user review",
              after: `${actionIntent.start} -> ${actionIntent.end}`
            }
          ]
        : actionIntent.type === "create_note"
          ? [
              {
                label: "Note title",
                before: "Pending user review",
                after: actionIntent.title
              }
            ]
          : actionIntent.type === "update_record"
            ? Object.entries(actionIntent.patch).map(([field, value]) => ({
                label: field,
                before: "Current record value",
                after: value === null ? "null" : String(value)
              }))
            : actionIntent.type === "delete_record"
              ? [
                  {
                    label: "Delete target",
                    before: `${actionIntent.targetType}:${actionIntent.targetId}`,
                    after: "Deleted after explicit approval"
                  }
                ]
              : actionIntent.type === "monitor_signal"
                ? [
                    {
                      label: "Watcher condition",
                      before: "No durable monitor",
                      after: actionIntent.condition
                    }
                  ]
          : [
              {
                label: "Requested action",
                before: "Pending user review",
                after: actionIntent.summary
              }
            ];

  return {
    actionType,
    summary,
    target,
    changes,
    impact: inferApprovalImpact(task, actionType)
  };
}

function shortHash(value: string): string {
  return createHash("sha256").update(value).digest("hex").slice(0, 16);
}

function stableJson(value: unknown): string {
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value);
  }

  if (Array.isArray(value)) {
    return `[${value.map((item) => stableJson(item)).join(",")}]`;
  }

  return `{${Object.entries(value)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, item]) => `${JSON.stringify(key)}:${stableJson(item)}`)
    .join(",")}}`;
}

function buildStableIntentFingerprint(task: Task, actionIntent: ActionIntent): string {
  return stableJson({
    taskId: task.id,
    assignedAgent: task.assignedAgent,
    toolCapabilities: task.toolCapabilities,
    actionIntent
  });
}

function buildIdempotencyKey(task: Task, actionIntent: ActionIntent): string | null {
  if (actionIntent.type === "manual_review") {
    return null;
  }

  return `task:${task.id}:${shortHash(buildStableIntentFingerprint(task, actionIntent))}`;
}

function buildSideEffectTarget(actionIntent: ActionIntent): string | null {
  switch (actionIntent.type) {
    case "send_message":
      return `gmail:${actionIntent.mode}:${actionIntent.to}:${actionIntent.threadId ?? shortHash(actionIntent.subject)}`;
    case "schedule_event":
      return `calendar:${actionIntent.start}:${actionIntent.end}:${shortHash(actionIntent.summary)}`;
    case "create_note":
      return `notes:${shortHash(actionIntent.title)}`;
    case "manual_review":
    case "monitor_signal":
    default:
      return null;
    case "update_record":
      return `workspace:update:${actionIntent.targetType}:${actionIntent.targetId}:${shortHash(stableJson(actionIntent.patch))}`;
    case "delete_record":
      return `workspace:delete:${actionIntent.targetType}:${actionIntent.targetId}`;
  }
}

function buildPlanRecovery(actionIntent: ActionIntent) {
  switch (actionIntent.type) {
    case "send_message":
      return {
        strategy: "retry" as const,
        note: "Retry is safe for connector failures because the adapter contract carries a stable idempotency key.",
        compensationHints: []
      };
    case "schedule_event":
      return {
        strategy: "retry" as const,
        note: "Retry is safe for recoverable calendar connector failures when the same idempotency key is reused.",
        compensationHints: []
      };
    case "create_note":
      return {
        strategy: "manual_review" as const,
        note: "Local note writes should be reviewed manually on failure because filesystem state may need inspection.",
        compensationHints: []
      };
    case "manual_review":
    case "update_record":
    case "delete_record":
    case "monitor_signal":
    default:
      return {
        strategy: "manual_review" as const,
        note:
          actionIntent.type === "manual_review"
            ? actionIntent.reason
            : "This intent is typed and validated, but the current driver is review-only until a concrete adapter is configured.",
        compensationHints: []
      };
  }
}

function buildOperation(actionIntent: ActionIntent): ActionExecutionPlan["operation"] {
  switch (actionIntent.type) {
    case "send_message":
      return actionIntent.mode === "send" ? "send_message" : "create_draft";
    case "schedule_event":
      return "create_event";
    case "create_note":
      return "create_note";
    case "manual_review":
      return "manual_review";
    case "update_record":
      return "update_record";
    case "delete_record":
      return "delete_record";
    case "monitor_signal":
      return "monitor_signal";
    default:
      return "manual_review";
  }
}

function buildAdapterKey(actionIntent: ActionIntent): ActionExecutionPlan["adapter"] {
  switch (actionIntent.type) {
    case "send_message":
      return "gmail";
    case "schedule_event":
      return "calendar";
    case "create_note":
      return "notes";
    case "manual_review":
      return "manual_review";
    case "update_record":
    case "delete_record":
      return "workspace";
    case "monitor_signal":
      return "watcher";
    default:
      return "manual_review";
  }
}

function buildSuccessRecovery() {
  return {
    strategy: "none" as const,
    note: "Execution completed successfully.",
    compensationHints: []
  };
}

function buildMissingAdapterOutcome(params: {
  plan: ActionExecutionPlan;
  detail: string;
}): ActionExecutionOutcome {
  return ActionExecutionOutcomeSchema.parse({
    status: "skipped",
    detail: params.detail,
    preview: params.plan.preview,
    retryable: false,
    providerRef: null,
    idempotencyKey: params.plan.idempotencyKey,
    sideEffectTarget: params.plan.sideEffectTarget,
    recovery: {
      strategy: "manual_review",
      note: "The required adapter is unavailable, so a human should review the task and connector readiness before retrying.",
      compensationHints: []
    }
  });
}

function buildConnectorFailureOutcome(params: {
  plan: ActionExecutionPlan;
  provider: string;
  operation: string;
  error: unknown;
  providerRef?: string | null;
  detailPrefix: string;
  compensationHints?: string[];
  status?: ActionExecutionOutcome["status"];
}): ActionExecutionOutcome {
  const normalizedError = normalizeConnectorThrownError({
    provider: params.provider,
    operation: params.operation,
    error: params.error
  });

  return ActionExecutionOutcomeSchema.parse({
    status: params.status ?? "failed",
    detail: `${params.detailPrefix}: ${normalizedError.message}`,
    preview: params.plan.preview,
    retryable: normalizedError.retryable,
    providerRef: params.providerRef ?? null,
    idempotencyKey: params.plan.idempotencyKey,
    sideEffectTarget: params.plan.sideEffectTarget,
    recovery: {
      strategy: normalizedError.retryable ? "retry" : "manual_review",
      note: normalizedError.retryable
        ? `Retry ${params.provider} ${params.operation} with the same idempotency key after the upstream failure clears.`
        : `Manual review is required before retrying ${params.provider} ${params.operation}.`,
      compensationHints: params.compensationHints ?? []
    }
  });
}

function buildLocalFailureOutcome(params: {
  plan: ActionExecutionPlan;
  detailPrefix: string;
  error: unknown;
}): ActionExecutionOutcome {
  const errorMessage = params.error instanceof Error ? params.error.message : "Unknown local adapter failure";

  return ActionExecutionOutcomeSchema.parse({
    status: "failed",
    detail: `${params.detailPrefix}: ${errorMessage}`,
    preview: params.plan.preview,
    retryable: false,
    providerRef: null,
    idempotencyKey: params.plan.idempotencyKey,
    sideEffectTarget: params.plan.sideEffectTarget,
    recovery: {
      strategy: "manual_review",
      note: "Local adapter failures require manual review before recovery because the filesystem state may have changed.",
      compensationHints: []
    }
  });
}

export function planActionExecution(params: { task: Task; actionIntent: ActionIntent }): ActionExecutionPlan {
  const preview = buildApprovalPreview(params.task, params.actionIntent);

  return ActionExecutionPlanSchema.parse({
    actionType: params.actionIntent.type,
    adapter: buildAdapterKey(params.actionIntent),
    operation: buildOperation(params.actionIntent),
    dryRunSummary: preview.summary,
    preview,
    idempotencyKey: buildIdempotencyKey(params.task, params.actionIntent),
    sideEffectTarget: buildSideEffectTarget(params.actionIntent),
    recovery: buildPlanRecovery(params.actionIntent)
  });
}

export async function executeTypedAction(params: {
  task: Task;
  actionIntent: ActionIntent;
  adapters: ActionExecutionAdapters;
}): Promise<{ plan: ActionExecutionPlan; outcome: ActionExecutionOutcome }> {
  const plan = planActionExecution({
    task: params.task,
    actionIntent: params.actionIntent
  });

  switch (params.actionIntent.type) {
    case "send_message": {
      if (!params.adapters.gmail) {
        return {
          plan,
          outcome: buildMissingAdapterOutcome({
            plan,
            detail: "Gmail adapter not available for a typed send_message intent."
          })
        };
      }

      let draftId: string | null = null;

      try {
        const draft = await params.adapters.gmail.createDraft({
          to: params.actionIntent.to,
          subject: params.actionIntent.subject,
          body: params.actionIntent.body,
          ...(params.actionIntent.threadId ? { threadId: params.actionIntent.threadId } : {})
        });
        draftId = draft.id;

        if (params.actionIntent.mode === "draft") {
          return {
            plan,
            outcome: ActionExecutionOutcomeSchema.parse({
              status: "completed",
              detail: `Draft created (id: ${draft.id}) for ${params.actionIntent.to}.`,
              preview: plan.preview,
              retryable: false,
              providerRef: draft.id,
              idempotencyKey: plan.idempotencyKey,
              sideEffectTarget: plan.sideEffectTarget,
              recovery: buildSuccessRecovery()
            })
          };
        }

        try {
          const sent = await params.adapters.gmail.sendDraft(draft.id);

          return {
            plan,
            outcome: ActionExecutionOutcomeSchema.parse({
              status: "completed",
              detail: `Draft ${draft.id} sent as message ${sent.messageId}.`,
              preview: plan.preview,
              retryable: false,
              providerRef: sent.messageId,
              idempotencyKey: plan.idempotencyKey,
              sideEffectTarget: plan.sideEffectTarget,
              recovery: buildSuccessRecovery()
            })
          };
        } catch (error) {
          return {
            plan,
            outcome: buildConnectorFailureOutcome({
              plan,
              provider: "gmail",
              operation: "drafts.send",
              error,
              providerRef: draft.id,
              status: "partial_success",
              detailPrefix: `Draft ${draft.id} was created but delivery failed`,
              compensationHints: [`Review draft ${draft.id} before retrying delivery.`]
            })
          };
        }
      } catch (error) {
        return {
          plan,
          outcome: buildConnectorFailureOutcome({
            plan,
            provider: "gmail",
            operation: "drafts.create",
            error,
            providerRef: draftId,
            detailPrefix: "Draft creation failed"
          })
        };
      }
    }

    case "schedule_event": {
      if (!params.adapters.calendar) {
        return {
          plan,
          outcome: buildMissingAdapterOutcome({
            plan,
            detail: "Calendar adapter not available for a typed schedule_event intent."
          })
        };
      }

      try {
        const event = await params.adapters.calendar.createEvent({
          summary: params.actionIntent.summary,
          start: params.actionIntent.start,
          end: params.actionIntent.end,
          ...(params.actionIntent.description ? { description: params.actionIntent.description } : {}),
          attendees: params.actionIntent.attendees
        });

        return {
          plan,
          outcome: ActionExecutionOutcomeSchema.parse({
            status: "completed",
            detail: `Calendar event created (id: ${event.id}). Link: ${event.htmlLink}`,
            preview: plan.preview,
            retryable: false,
            providerRef: event.id,
            idempotencyKey: plan.idempotencyKey,
            sideEffectTarget: plan.sideEffectTarget,
            recovery: buildSuccessRecovery()
          })
        };
      } catch (error) {
        return {
          plan,
          outcome: buildConnectorFailureOutcome({
            plan,
            provider: "google_calendar",
            operation: "events.create",
            error,
            detailPrefix: "Calendar event creation failed"
          })
        };
      }
    }

    case "create_note": {
      if (!params.adapters.notes) {
        return {
          plan,
          outcome: buildMissingAdapterOutcome({
            plan,
            detail: "Notes adapter not available for a typed create_note intent."
          })
        };
      }

      try {
        const note = await params.adapters.notes.createLocalNote({
          title: params.actionIntent.title,
          content: params.actionIntent.content
        });

        return {
          plan,
          outcome: ActionExecutionOutcomeSchema.parse({
            status: "completed",
            detail: `Local note created (slug: ${note.slug}).`,
            preview: plan.preview,
            retryable: false,
            providerRef: note.slug,
            idempotencyKey: plan.idempotencyKey,
            sideEffectTarget: plan.sideEffectTarget,
            recovery: buildSuccessRecovery()
          })
        };
      } catch (error) {
        return {
          plan,
          outcome: buildLocalFailureOutcome({
            plan,
            detailPrefix: "Local note creation failed",
            error
          })
        };
      }
    }

    case "update_record":
    case "delete_record":
    case "monitor_signal":
      return {
        plan,
        outcome: buildMissingAdapterOutcome({
          plan,
          detail: `Execution skipped: typed ${params.actionIntent.type} intents are recognized, but no enforcing driver is registered for adapter "${plan.adapter}".`
        })
      };

    case "manual_review":
    default:
      return {
        plan,
        outcome: ActionExecutionOutcomeSchema.parse({
          status: "skipped",
          detail: `Execution skipped: ${params.actionIntent.reason}`,
          preview: plan.preview,
          retryable: false,
          providerRef: null,
          idempotencyKey: plan.idempotencyKey,
          sideEffectTarget: plan.sideEffectTarget,
          recovery: {
            strategy: "manual_review",
            note: params.actionIntent.reason,
            compensationHints: []
          }
        })
      };
  }
}
