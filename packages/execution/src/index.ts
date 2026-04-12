import {
  TaskSchema,
  TaskStateSchema,
  WorkflowStateSchema,
  nowIso,
  type AgentName,
  type ApprovalRequest,
  type Capability,
  type Goal,
  type RiskClass,
  type Task,
  type TaskState,
  type Watcher,
  type WorkflowState
} from "@agentic/contracts";

const legalTaskTransitions: Record<TaskState, readonly TaskState[]> = {
  queued: ["running", "waiting", "blocked", "failed", "completed"],
  running: ["waiting", "blocked", "failed", "completed"],
  waiting: ["queued", "running", "blocked", "completed"],
  blocked: ["queued", "running"],
  retrying: ["running", "failed"],
  failed: ["retrying", "blocked"],
  completed: []
};

export function createWorkflowState(goalId: string, currentStep = "intake", workspaceId: string | null = null): WorkflowState {
  const timestamp = nowIso();

  return WorkflowStateSchema.parse({
    id: crypto.randomUUID(),
    goalId,
    workspaceId,
    status: "running",
    currentStep,
    checkpoint: null,
    createdAt: timestamp,
    updatedAt: timestamp
  });
}

export function createTask(params: {
  goalId: string;
  workflowId: string;
  title: string;
  summary: string;
  assignedAgent: AgentName;
  riskClass: RiskClass;
  requiresApproval: boolean;
  toolCapabilities: Capability[];
  dependsOn?: string[];
  state?: TaskState;
}): Task {
  const timestamp = nowIso();

  return TaskSchema.parse({
    id: crypto.randomUUID(),
    goalId: params.goalId,
    workflowId: params.workflowId,
    title: params.title,
    summary: params.summary,
    assignedAgent: params.assignedAgent,
    state: params.state ?? (params.requiresApproval ? "waiting" : "completed"),
    riskClass: params.riskClass,
    requiresApproval: params.requiresApproval,
    dependsOn: params.dependsOn ?? [],
    toolCapabilities: params.toolCapabilities,
    artifactIds: [],
    createdAt: timestamp,
    updatedAt: timestamp
  });
}

export function canTransitionTaskState(from: TaskState, to: TaskState): boolean {
  return legalTaskTransitions[from].includes(to);
}

export function transitionTaskState(task: Task, state: TaskState): Task {
  const nextState = TaskStateSchema.parse(state);

  if (!canTransitionTaskState(task.state, nextState)) {
    throw new Error(`Illegal task transition from "${task.state}" to "${nextState}" for task ${task.id}.`);
  }

  return TaskSchema.parse({
    ...task,
    state: nextState,
    updatedAt: nowIso()
  });
}

export function recomputeWorkflowStatuses(
  tasks: Task[],
  approvals: ApprovalRequest[],
  watchers: Watcher[]
): { goalStatus: Goal["status"]; workflowStatus: WorkflowState["status"] } {
  const hasPendingApprovals = approvals.some((approval) => approval.decision === "pending");
  const hasBlockedTask = tasks.some((task) => task.state === "blocked");
  const hasOpenWatchers = watchers.some((watcher) => watcher.status === "active");
  const allTasksCompleted = tasks.every((task) => task.state === "completed");

  if (hasPendingApprovals) {
    return {
      goalStatus: "waiting",
      workflowStatus: "waiting"
    };
  }

  if (hasBlockedTask) {
    return {
      goalStatus: "running",
      workflowStatus: "running"
    };
  }

  if (allTasksCompleted && !hasOpenWatchers) {
    return {
      goalStatus: "completed",
      workflowStatus: "completed"
    };
  }

  return {
    goalStatus: "running",
    workflowStatus: "running"
  };
}
