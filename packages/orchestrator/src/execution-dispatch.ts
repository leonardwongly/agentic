import { ActionLogSchema, nowIso, type ActionLog, type GoalBundle, type Task } from "@agentic/contracts";
import { createActionLog } from "@agentic/observability";

export type ExecutionResult = {
  taskId: string;
  success: boolean;
  action: string;
  detail: string;
  timestamp: string;
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

function extractActionFromArtifacts(task: Task, bundle: GoalBundle): { type: string; description: string } {
  const artifacts = bundle.artifacts.filter((a) => a.taskId === task.id);
  const content = artifacts.map((a) => a.content).join("\n");

  if (task.toolCapabilities.includes("send")) {
    return { type: "send", description: `Send action for "${task.title}" based on agent output.` };
  }
  if (task.toolCapabilities.includes("schedule")) {
    return { type: "schedule", description: `Schedule action for "${task.title}" based on agent output.` };
  }
  if (task.toolCapabilities.includes("create")) {
    return { type: "create", description: `Create action for "${task.title}" based on agent output.` };
  }
  return { type: "artifact-only", description: `Task "${task.title}" produced artifacts but requires no external execution.` };
}

export async function executeApprovedTask(params: {
  task: Task;
  bundle: GoalBundle;
  adapters: IntegrationAdapters;
}): Promise<{ result: ExecutionResult; log: ActionLog }> {
  const { task, bundle, adapters } = params;
  const action = extractActionFromArtifacts(task, bundle);
  const timestamp = nowIso();

  try {
    let detail: string;

    switch (action.type) {
      case "send": {
        if (adapters.gmail) {
          const draft = await adapters.gmail.createDraft({
            to: "pending-recipient@placeholder.com",
            subject: `[Agentic] ${task.title}`,
            body: bundle.artifacts.filter((a) => a.taskId === task.id).map((a) => a.content).join("\n\n")
          });
          detail = `Draft created (id: ${draft.id}). Ready for manual send or auto-send on next approval cycle.`;
        } else {
          detail = "Gmail adapter not available. Action logged as pending manual execution.";
        }
        break;
      }
      case "schedule": {
        if (adapters.calendar) {
          const now = new Date();
          const oneHourLater = new Date(now.getTime() + 60 * 60 * 1000);
          const event = await adapters.calendar.createEvent({
            summary: task.title,
            start: now.toISOString(),
            end: oneHourLater.toISOString(),
            description: bundle.artifacts.filter((a) => a.taskId === task.id).map((a) => a.content).join("\n\n")
          });
          detail = `Calendar event created (id: ${event.id}). Link: ${event.htmlLink}`;
        } else {
          detail = "Calendar adapter not available. Action logged as pending manual execution.";
        }
        break;
      }
      case "create": {
        if (adapters.notes) {
          const note = await adapters.notes.createLocalNote({
            title: task.title,
            content: bundle.artifacts.filter((a) => a.taskId === task.id).map((a) => a.content).join("\n\n")
          });
          detail = `Local note created (slug: ${note.slug}).`;
        } else {
          detail = "No writable adapter available. Artifacts persisted in goal bundle.";
        }
        break;
      }
      default: {
        detail = "No external execution required. Artifacts persisted in goal bundle.";
      }
    }

    const result: ExecutionResult = {
      taskId: task.id,
      success: true,
      action: action.type,
      detail,
      timestamp
    };

    const log = ActionLogSchema.parse(
      createActionLog({
        goalId: bundle.goal.id,
        taskId: task.id,
        workflowId: bundle.workflow.id,
        actor: "execution-engine",
        kind: "execution.completed",
        message: `Executed "${task.title}": ${detail}`,
        details: { action: action.type, success: true, detail }
      })
    );

    return { result, log };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : "Unknown execution error";

    const result: ExecutionResult = {
      taskId: task.id,
      success: false,
      action: action.type,
      detail: `Execution failed: ${errorMessage}`,
      timestamp
    };

    const log = ActionLogSchema.parse(
      createActionLog({
        goalId: bundle.goal.id,
        taskId: task.id,
        workflowId: bundle.workflow.id,
        actor: "execution-engine",
        kind: "execution.failed",
        message: `Failed to execute "${task.title}": ${errorMessage}`,
        details: { action: action.type, success: false, error: errorMessage }
      })
    );

    return { result, log };
  }
}

export async function executeApprovedTasks(params: {
  bundle: GoalBundle;
  approvedTaskIds: string[];
  adapters: IntegrationAdapters;
}): Promise<{ results: ExecutionResult[]; logs: ActionLog[] }> {
  const { bundle, approvedTaskIds, adapters } = params;
  const results: ExecutionResult[] = [];
  const logs: ActionLog[] = [];

  for (const taskId of approvedTaskIds) {
    const task = bundle.tasks.find((t) => t.id === taskId);
    if (!task) continue;

    const { result, log } = await executeApprovedTask({ task, bundle, adapters });
    results.push(result);
    logs.push(log);
  }

  return { results, logs };
}
