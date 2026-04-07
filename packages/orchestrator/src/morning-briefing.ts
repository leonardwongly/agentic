import {
  GoalBundleSchema,
  GoalSchema,
  TaskSchema,
  nowIso,
  type ActionLog,
  type ApprovalRequest,
  type GoalBundle,
  type IntegrationAccount,
  type MemoryRecord,
  type Task,
  type Watcher
} from "@agentic/contracts";
import { runAgent } from "@agentic/agents";
import { createTask, createWorkflowState } from "@agentic/execution";
import { createActionLog } from "@agentic/observability";
import { evaluateTaskPolicy } from "@agentic/policy";

type BriefingTask = {
  title: string;
  summary: string;
  assignedAgent: Task["assignedAgent"];
  capabilities: Task["toolCapabilities"];
  confidence: number;
};

const briefingTasks: BriefingTask[] = [
  {
    title: "Inbox summary",
    summary: "Scan recent communications, surface urgent threads, and summarize key messages requiring attention.",
    assignedAgent: "communications",
    capabilities: ["read", "search"],
    confidence: 0.88
  },
  {
    title: "Calendar overview",
    summary: "Review today's schedule, highlight conflicts, and identify preparation needed for upcoming meetings.",
    assignedAgent: "calendar",
    capabilities: ["read", "search"],
    confidence: 0.85
  },
  {
    title: "Pending items review",
    summary: "Consolidate pending approvals, active watchers, and outstanding workflow items into a single status view.",
    assignedAgent: "workflow",
    capabilities: ["read", "monitor"],
    confidence: 0.82
  }
];

function formatBriefingDate(): string {
  return new Date().toISOString().slice(0, 10);
}

function recomputeStatuses(
  tasks: Task[],
  approvals: ApprovalRequest[],
  watchers: Watcher[]
): { goalStatus: "planned" | "running" | "waiting" | "completed"; workflowStatus: string } {
  const hasPendingApprovals = approvals.some((a) => a.decision === "pending");
  const hasBlockedTask = tasks.some((t) => t.state === "blocked");
  const hasOpenWatchers = watchers.some((w) => w.status === "active");
  const allTasksCompleted = tasks.every((t) => t.state === "completed");

  if (hasPendingApprovals) {
    return { goalStatus: "waiting", workflowStatus: "waiting" };
  }

  if (hasBlockedTask) {
    return { goalStatus: "running", workflowStatus: "running" };
  }

  if (allTasksCompleted && !hasOpenWatchers) {
    return { goalStatus: "completed", workflowStatus: "completed" };
  }

  return { goalStatus: "running", workflowStatus: "running" };
}

export async function generateMorningBriefing(params: {
  userId: string;
  memories: MemoryRecord[];
  integrations: IntegrationAccount[];
  pendingApprovals: ApprovalRequest[];
  activeWatchers: Watcher[];
}): Promise<GoalBundle> {
  const dateStr = formatBriefingDate();
  const goalId = crypto.randomUUID();
  const workflow = createWorkflowState(goalId, "morning-briefing");
  const createdAt = nowIso();
  const logs: ActionLog[] = [];
  const tasks: Task[] = [];
  const approvals: ApprovalRequest[] = [];
  const artifacts = [];
  const scenarioTitle = `Daily briefing for ${dateStr}`;

  const readyIntegrations = params.integrations.filter((i) => i.status !== "disabled").length;

  const goal = GoalSchema.parse({
    id: goalId,
    userId: params.userId,
    workflowId: workflow.id,
    title: scenarioTitle,
    request: `Generate a morning briefing for ${dateStr} covering inbox, calendar, and pending items.`,
    intent: "morning-briefing",
    status: "planned",
    confidence: 0.86,
    explanation: `Proactive morning briefing assembling inbox, calendar, and pending item summaries. Resolved ${params.memories.length} memory records and ${readyIntegrations} enabled adapters.`,
    createdAt,
    updatedAt: createdAt
  });

  logs.push(
    createActionLog({
      goalId: goal.id,
      workflowId: workflow.id,
      actor: "orchestrator",
      kind: "goal.created",
      message: `Created morning briefing goal "${goal.title}".`,
      details: {
        intent: goal.intent,
        status: goal.status,
        pendingApprovals: params.pendingApprovals.length,
        activeWatchers: params.activeWatchers.length
      }
    })
  );

  logs.push(
    createActionLog({
      goalId,
      workflowId: workflow.id,
      actor: "orchestrator",
      kind: "context.resolved",
      message: "Resolved context for morning briefing.",
      details: {
        memoryCount: params.memories.length,
        integrationCount: params.integrations.length,
        pendingApprovalCount: params.pendingApprovals.length,
        activeWatcherCount: params.activeWatchers.length
      }
    })
  );

  for (const planned of briefingTasks) {
    const decision = evaluateTaskPolicy({
      capabilities: planned.capabilities,
      confidence: planned.confidence,
      title: planned.title,
      memories: params.memories
    });

    const state = decision.outcome === "blocked" ? "blocked" : decision.requiresApproval ? "waiting" : "completed";

    const task = createTask({
      goalId,
      workflowId: workflow.id,
      title: planned.title,
      summary: planned.summary,
      assignedAgent: planned.assignedAgent,
      riskClass: decision.riskClass,
      requiresApproval: decision.requiresApproval,
      toolCapabilities: planned.capabilities,
      state
    });

    const agentResult = await runAgent(task, scenarioTitle);

    const nextTask = TaskSchema.parse({
      ...task,
      artifactIds: agentResult.artifacts.map((a) => a.id)
    });

    tasks.push(nextTask);
    artifacts.push(...agentResult.artifacts);

    logs.push(
      createActionLog({
        goalId,
        taskId: nextTask.id,
        workflowId: workflow.id,
        actor: "policy",
        kind: "policy.evaluated",
        message: `Evaluated policy for "${nextTask.title}".`,
        details: decision
      })
    );

    logs.push(
      createActionLog({
        goalId,
        taskId: nextTask.id,
        workflowId: workflow.id,
        actor: nextTask.assignedAgent,
        kind: "agent.completed",
        message: agentResult.summary,
        details: {
          confidence: agentResult.confidence,
          nextSteps: agentResult.nextSteps
        }
      })
    );
  }

  const statuses = recomputeStatuses(tasks, approvals, []);

  return GoalBundleSchema.parse({
    goal: {
      ...goal,
      status: statuses.goalStatus,
      updatedAt: nowIso()
    },
    workflow: {
      ...workflow,
      status: statuses.workflowStatus,
      checkpoint: "done",
      updatedAt: nowIso()
    },
    tasks,
    artifacts,
    approvals,
    watchers: [],
    actionLogs: logs
  });
}
