import { TaskSchema, TaskStateSchema, WorkflowStateSchema, nowIso, type AgentName, type Capability, type RiskClass, type Task, type TaskState, type WorkflowState } from "@agentic/contracts";

export function createWorkflowState(goalId: string, currentStep = "intake"): WorkflowState {
  const timestamp = nowIso();

  return WorkflowStateSchema.parse({
    id: crypto.randomUUID(),
    goalId,
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

export function transitionTaskState(task: Task, state: TaskState): Task {
  return TaskSchema.parse({
    ...task,
    state: TaskStateSchema.parse(state),
    updatedAt: nowIso()
  });
}

