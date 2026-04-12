import {
  ActionLogSchema,
  ActionIntentSchema,
  nowIso,
  type ActionIntent,
  type ActionLog,
  type GoalBundle,
  type Task,
  type TaskState,
  type WorkspaceGovernance
} from "@agentic/contracts";
import { canTransitionTaskState, recomputeWorkflowStatuses, transitionTaskState } from "@agentic/execution";
import { createActionLog } from "@agentic/observability";
import { getGovernanceApprovalReason } from "@agentic/policy";

export type ExecutionResult = {
  taskId: string;
  success: boolean;
  action: string;
  detail: string;
  timestamp: string;
  kind: "execution.completed" | "execution.failed" | "execution.skipped";
};

type IntegrationAdapters = {
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

function resolveActionIntent(task: Task, bundle: GoalBundle): ActionIntent {
  const approval = bundle.approvals.find((candidate) => candidate.taskId === task.id);

  if (approval?.actionIntent) {
    return approval.actionIntent;
  }

  const inferredActionType = task.toolCapabilities.includes("send")
    ? "send"
    : task.toolCapabilities.includes("schedule")
      ? "schedule"
      : task.toolCapabilities.includes("create")
        ? "create"
        : task.toolCapabilities.includes("update")
          ? "update"
          : task.toolCapabilities.includes("delete")
            ? "delete"
            : task.toolCapabilities.includes("draft")
              ? "draft"
              : "artifact-only";

  return ActionIntentSchema.parse({
    type: "manual_review",
    actionType: inferredActionType,
    summary: approval?.requestedAction ?? task.summary,
    reason: "This approval cannot be executed automatically because no validated action payload is available.",
    artifactIds: bundle.artifacts.filter((artifact) => artifact.taskId === task.id).map((artifact) => artifact.id)
  });
}

function buildResult(params: {
  bundle: GoalBundle;
  task: Task;
  action: string;
  success: boolean;
  detail: string;
  kind: "execution.completed" | "execution.failed" | "execution.skipped";
  error?: string;
}) {
  const timestamp = nowIso();
  const result: ExecutionResult = {
    taskId: params.task.id,
    success: params.success,
    action: params.action,
    detail: params.detail,
    timestamp,
    kind: params.kind
  };

  const statusVerb = params.success ? "Executed" : params.kind === "execution.skipped" ? "Skipped" : "Failed to execute";
  const log = ActionLogSchema.parse(
    createActionLog({
      goalId: params.bundle.goal.id,
      taskId: params.task.id,
      workflowId: params.bundle.workflow.id,
      actor: "execution-engine",
      kind: params.kind,
      message: `${statusVerb} "${params.task.title}": ${params.detail}`,
      details: {
        action: params.action,
        success: params.success,
        detail: params.detail,
        ...(params.error ? { error: params.error } : {})
      }
    })
  );

  return { result, log };
}

export async function executeApprovedTask(params: {
  task: Task;
  bundle: GoalBundle;
  adapters: IntegrationAdapters;
  governance?: WorkspaceGovernance | null;
}): Promise<{ result: ExecutionResult; log: ActionLog }> {
  const { task, bundle, adapters, governance } = params;
  const actionIntent = resolveActionIntent(task, bundle);
  const governanceApprovalReason = getGovernanceApprovalReason({
    capabilities: task.toolCapabilities,
    riskClass: task.riskClass,
    governance
  });
  const hasApprovedApproval = bundle.approvals.some(
    (approval) => approval.taskId === task.id && approval.decision === "approved"
  );

  if (governanceApprovalReason && !hasApprovedApproval) {
    return buildResult({
      bundle,
      task,
      action: actionIntent.type,
      success: false,
      detail: `Execution skipped: ${governanceApprovalReason}`,
      kind: "execution.skipped"
    });
  }

  try {
    switch (actionIntent.type) {
      case "send_message": {
        if (!adapters.gmail) {
          return buildResult({
            bundle,
            task,
            action: actionIntent.type,
            success: false,
            detail: "Gmail adapter not available for a typed send_message intent.",
            kind: "execution.skipped"
          });
        }

        const draft = await adapters.gmail.createDraft({
          to: actionIntent.to,
          subject: actionIntent.subject,
          body: actionIntent.body,
          ...(actionIntent.threadId ? { threadId: actionIntent.threadId } : {})
        });

        if (actionIntent.mode === "send") {
          const sent = await adapters.gmail.sendDraft(draft.id);
          return buildResult({
            bundle,
            task,
            action: actionIntent.type,
            success: true,
            detail: `Draft ${draft.id} sent as message ${sent.messageId}.`,
            kind: "execution.completed"
          });
        }

        return buildResult({
          bundle,
          task,
          action: actionIntent.type,
          success: true,
          detail: `Draft created (id: ${draft.id}) for ${actionIntent.to}.`,
          kind: "execution.completed"
        });
      }

      case "schedule_event": {
        if (!adapters.calendar) {
          return buildResult({
            bundle,
            task,
            action: actionIntent.type,
            success: false,
            detail: "Calendar adapter not available for a typed schedule_event intent.",
            kind: "execution.skipped"
          });
        }

        const event = await adapters.calendar.createEvent({
          summary: actionIntent.summary,
          start: actionIntent.start,
          end: actionIntent.end,
          ...(actionIntent.description ? { description: actionIntent.description } : {}),
          attendees: actionIntent.attendees
        });

        return buildResult({
          bundle,
          task,
          action: actionIntent.type,
          success: true,
          detail: `Calendar event created (id: ${event.id}). Link: ${event.htmlLink}`,
          kind: "execution.completed"
        });
      }

      case "create_note": {
        if (!adapters.notes) {
          return buildResult({
            bundle,
            task,
            action: actionIntent.type,
            success: false,
            detail: "Notes adapter not available for a typed create_note intent.",
            kind: "execution.skipped"
          });
        }

        const note = await adapters.notes.createLocalNote({
          title: actionIntent.title,
          content: actionIntent.content
        });

        return buildResult({
          bundle,
          task,
          action: actionIntent.type,
          success: true,
          detail: `Local note created (slug: ${note.slug}).`,
          kind: "execution.completed"
        });
      }

      case "manual_review":
      default:
        return buildResult({
          bundle,
          task,
          action: actionIntent.type,
          success: false,
          detail: `Execution skipped: ${actionIntent.reason}`,
          kind: "execution.skipped"
        });
    }
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : "Unknown execution error";
    return buildResult({
      bundle,
      task,
      action: actionIntent.type,
      success: false,
      detail: `Execution failed: ${errorMessage}`,
      kind: "execution.failed",
      error: errorMessage
    });
  }
}

export async function executeApprovedTasks(params: {
  bundle: GoalBundle;
  approvedTaskIds: string[];
  adapters: IntegrationAdapters;
  governance?: WorkspaceGovernance | null;
}): Promise<{ results: ExecutionResult[]; logs: ActionLog[] }> {
  const { bundle, approvedTaskIds, adapters, governance } = params;
  const results: ExecutionResult[] = [];
  const logs: ActionLog[] = [];

  for (const taskId of approvedTaskIds) {
    const task = bundle.tasks.find((candidate) => candidate.id === taskId);

    if (!task) {
      continue;
    }

    const { result, log } = await executeApprovedTask({ task, bundle, adapters, governance });
    results.push(result);
    logs.push(log);
  }

  return { results, logs };
}

function resolveTaskTerminalState(kind: ExecutionResult["kind"]): TaskState {
  switch (kind) {
    case "execution.completed":
      return "completed";
    case "execution.failed":
      return "failed";
    case "execution.skipped":
    default:
      return "blocked";
  }
}

export function reconcileExecutionResults(params: {
  bundle: GoalBundle;
  results: ExecutionResult[];
  logs?: ActionLog[];
}): GoalBundle {
  const { bundle, results, logs = [] } = params;

  if (results.length === 0 && logs.length === 0) {
    return bundle;
  }

  const baseActionLogs = [...bundle.actionLogs, ...logs];
  const stateTransitionLogs: ActionLog[] = [];
  const tasks = bundle.tasks.map((task) => {
    const result = results.find((candidate) => candidate.taskId === task.id);

    if (!result) {
      return task;
    }

    const nextState = resolveTaskTerminalState(result.kind);

    if (task.state === nextState || !canTransitionTaskState(task.state, nextState)) {
      return task;
    }

    const nextTask = transitionTaskState(task, nextState);
    stateTransitionLogs.push(
      ActionLogSchema.parse(
        createActionLog({
          goalId: bundle.goal.id,
          taskId: task.id,
          workflowId: bundle.workflow.id,
          actor: "execution-engine",
          kind: "task.state_changed",
          message: `Moved "${task.title}" from "${task.state}" to "${nextTask.state}" after execution ${result.kind}.`,
          details: {
            from: task.state,
            to: nextTask.state,
            resultKind: result.kind,
            success: result.success,
            action: result.action
          },
          prevLog: stateTransitionLogs.at(-1) ?? baseActionLogs.at(-1) ?? null
        })
      )
    );

    return nextTask;
  });

  const statuses = recomputeWorkflowStatuses(tasks, bundle.approvals, bundle.watchers);
  const hasFailures = results.some((result) => result.kind === "execution.failed");
  const hasSkips = results.some((result) => result.kind === "execution.skipped");
  const hasPendingApprovals = bundle.approvals.some((approval) => approval.decision === "pending");
  const checkpoint =
    statuses.workflowStatus === "completed"
      ? "done"
      : hasFailures || hasSkips
        ? "execution-recovery"
        : hasPendingApprovals
          ? "approval-gate"
          : "resumed-after-approval";
  const updatedAt = nowIso();

  return {
    ...bundle,
    goal: {
      ...bundle.goal,
      status: statuses.goalStatus,
      updatedAt
    },
    workflow: {
      ...bundle.workflow,
      status: statuses.workflowStatus,
      checkpoint,
      updatedAt
    },
    tasks,
    actionLogs: [...baseActionLogs, ...stateTransitionLogs]
  };
}
