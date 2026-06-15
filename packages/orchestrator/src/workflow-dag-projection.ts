import {
  WorkflowDagInstanceSchema,
  WorkflowDagNodeExecutionSchema,
  WorkflowDagSchema,
  nowIso,
  type GoalBundle,
  type Task,
  type WorkflowDag,
  type WorkflowDagInstance,
  type WorkflowDagNodeExecution,
  type WorkflowDagStatus
} from "@agentic/contracts";
import {
  createWorkflowDagInstance,
  inspectWorkflowDagInstance,
  transitionWorkflowDagInstance,
  validateWorkflowDag
} from "@agentic/execution";

/**
 * AOS-20: wire the WorkflowDag engine into the live path.
 *
 * The orchestrator already produces a task graph (with dependencies, granted
 * capabilities, and risk classes) but the live path used a flat `WorkflowState`
 * and never exercised the tested DAG engine. These helpers derive a validated
 * `WorkflowDag` from a goal bundle's task graph, project a read-model instance
 * whose node statuses reflect live task state, and expose deterministic operator
 * pause/resume/cancel controls with compensation hints. Operator control is
 * persisted as an append-only action log (see `WORKFLOW_DAG_CONTROL_LOG_KIND`),
 * so it never collides with `recomputeWorkflowStatuses`.
 */

export const WORKFLOW_DAG_CONTROL_LOG_KIND = "workflow.dag.control";

export type WorkflowDagControlAction = "pause" | "resume" | "cancel";

export class WorkflowDagControlError extends Error {
  readonly safeForUsers = true;

  constructor(message: string) {
    super(message);
    this.name = "WorkflowDagControlError";
  }
}

// Project a live task state onto a DAG node execution status (read-model only).
const TASK_STATE_TO_NODE_STATUS: Record<Task["state"], WorkflowDagNodeExecution["status"]> = {
  queued: "queued",
  running: "running",
  waiting: "queued",
  blocked: "paused",
  retrying: "queued",
  failed: "failed",
  completed: "completed"
};

type PersistedControl = {
  action: WorkflowDagControlAction;
  status: Extract<WorkflowDagStatus, "running" | "paused" | "cancelled">;
  reason: string | null;
  at: string;
  compensations: string[];
};

/**
 * Derive a validated process-control DAG from the bundle's task graph. Nodes are
 * coordination (`manual_review`) placeholders — action execution still runs
 * through the existing task/approval/job path — so they always satisfy the
 * engine's capability/risk checks at the task's own risk class. Returns null when
 * there are no tasks or the derived graph fails validation (a projection failure
 * must never break goal reads).
 */
export function buildWorkflowDagFromBundle(bundle: GoalBundle): WorkflowDag | null {
  if (bundle.tasks.length === 0) {
    return null;
  }

  const taskIds = new Set(bundle.tasks.map((task) => task.id));
  const raw = {
    id: `${bundle.workflow.id}-dag`,
    workflowId: bundle.workflow.id,
    nodes: bundle.tasks.map((task) => ({
      id: task.id,
      label: task.title.slice(0, 240),
      actionIntent: {
        type: "manual_review" as const,
        riskClass: task.riskClass,
        actionType: "artifact-only" as const,
        summary: `Coordinate task: ${task.title}`.slice(0, 500),
        reason: `Process-control node for task ${task.id} assigned to ${task.assignedAgent}.`.slice(0, 1000)
      },
      dependsOn: task.dependsOn.filter((dependency) => dependency !== task.id && taskIds.has(dependency)),
      permissionGrant: {
        capabilities: task.toolCapabilities,
        maxRiskClass: task.riskClass
      }
    })),
    edges: bundle.tasks.flatMap((task) =>
      task.dependsOn
        .filter((dependency) => dependency !== task.id && taskIds.has(dependency))
        .map((dependency) => ({ from: dependency, to: task.id, condition: "success" as const }))
    ),
    createdAt: bundle.goal.createdAt,
    updatedAt: bundle.goal.updatedAt
  };

  try {
    return validateWorkflowDag(WorkflowDagSchema.parse(raw));
  } catch {
    return null;
  }
}

function deriveInstanceStatus(nodeExecutions: WorkflowDagNodeExecution[]): WorkflowDagStatus {
  if (nodeExecutions.length > 0 && nodeExecutions.every((execution) => execution.status === "completed")) {
    return "completed";
  }
  if (nodeExecutions.some((execution) => execution.status === "failed")) {
    return "failed";
  }
  if (nodeExecutions.some((execution) => execution.status === "running")) {
    return "running";
  }
  return "queued";
}

/** Read the most recent persisted operator control from the bundle's action logs. */
export function readLatestWorkflowDagControl(bundle: GoalBundle): PersistedControl | null {
  const latest = bundle.actionLogs
    .filter((log) => log.kind === WORKFLOW_DAG_CONTROL_LOG_KIND)
    .sort((left, right) => right.createdAt.localeCompare(left.createdAt))[0];

  if (!latest) {
    return null;
  }

  const details = latest.details as Record<string, unknown>;
  const action = details.action;

  if (action !== "pause" && action !== "resume" && action !== "cancel") {
    return null;
  }

  return {
    action,
    status: action === "pause" ? "paused" : action === "resume" ? "running" : "cancelled",
    reason: typeof details.reason === "string" ? details.reason : null,
    at: typeof details.at === "string" ? details.at : latest.createdAt,
    compensations: Array.isArray(details.compensations)
      ? details.compensations.filter((entry): entry is string => typeof entry === "string")
      : []
  };
}

/**
 * AOS-25: the persisted control status to feed into `recomputeWorkflowStatuses` so a
 * governed pause/cancel survives the next status recompute. Returns "paused" or
 * "cancelled" when the latest operator control halts the workflow, and null when the
 * latest control is a resume (or there is no control), letting normal task-derived
 * recompute resume.
 */
export function readWorkflowControlStatusOverride(bundle: GoalBundle): "paused" | "cancelled" | null {
  const control = readLatestWorkflowDagControl(bundle);
  return control?.status === "paused" || control?.status === "cancelled" ? control.status : null;
}

/** Project a read-model DAG instance whose node statuses mirror live task state. */
export function projectWorkflowDagInstance(bundle: GoalBundle, now = nowIso()): WorkflowDagInstance | null {
  const dag = buildWorkflowDagFromBundle(bundle);
  if (!dag) {
    return null;
  }

  const base = createWorkflowDagInstance({
    dag,
    instanceId: `${bundle.workflow.id}-instance`,
    now: bundle.goal.createdAt
  });
  const taskById = new Map(bundle.tasks.map((task) => [task.id, task]));
  const nodeExecutions = base.nodeExecutions.map((execution) => {
    const task = taskById.get(execution.nodeId);
    const status = task ? TASK_STATE_TO_NODE_STATUS[task.state] : execution.status;
    return WorkflowDagNodeExecutionSchema.parse({
      ...execution,
      status,
      startedAt: status === "queued" ? execution.startedAt : execution.startedAt ?? task?.updatedAt ?? execution.updatedAt,
      completedAt: status === "completed" ? task?.updatedAt ?? execution.updatedAt : execution.completedAt,
      updatedAt: task?.updatedAt ?? execution.updatedAt
    });
  });
  const control = readLatestWorkflowDagControl(bundle);
  const status = control?.status ?? deriveInstanceStatus(nodeExecutions);

  return WorkflowDagInstanceSchema.parse({
    ...base,
    status,
    pausedAt: control?.status === "paused" ? control.at : base.pausedAt,
    cancelledAt: control?.status === "cancelled" ? control.at : base.cancelledAt,
    cancelReason: control?.status === "cancelled" ? control.reason ?? "Workflow cancelled." : base.cancelReason,
    nodeExecutions,
    auditLog: control
      ? [
          ...base.auditLog,
          `${control.at} operator ${control.action} -> ${control.status}${control.reason ? `: ${control.reason}` : ""}`
        ]
      : base.auditLog,
    updatedAt: now
  });
}

/** Inspect summary (counts + node statuses) for the projected instance, or null. */
export function summarizeWorkflowDag(bundle: GoalBundle) {
  const instance = projectWorkflowDagInstance(bundle);
  return instance ? inspectWorkflowDagInstance(instance) : null;
}

export type WorkflowDagControlResult = {
  instance: WorkflowDagInstance;
  status: WorkflowDagStatus;
  compensations: string[];
};

/**
 * Apply an operator pause/resume/cancel to the projected instance using the
 * engine's legal-transition rules. Idempotent for already-in-target states;
 * throws `WorkflowDagControlError` for illegal transitions (e.g. pausing a
 * completed workflow). Cancel derives compensation hints from completed nodes.
 */
export function applyWorkflowDagControl(params: {
  bundle: GoalBundle;
  action: WorkflowDagControlAction;
  reason?: string | null;
  now?: string;
}): WorkflowDagControlResult {
  const now = params.now ?? nowIso();
  const projected = projectWorkflowDagInstance(params.bundle, now);

  if (!projected) {
    throw new WorkflowDagControlError("This goal has no workflow DAG to control.");
  }

  const reason = params.reason?.trim() ? params.reason.trim().slice(0, 500) : null;
  let instance = projected;

  if (params.action === "pause") {
    if (instance.status === "queued") {
      instance = transitionWorkflowDagInstance({ instance, status: "running", now });
      instance = transitionWorkflowDagInstance({ instance, status: "paused", reason, now });
    } else if (instance.status === "running") {
      instance = transitionWorkflowDagInstance({ instance, status: "paused", reason, now });
    } else if (instance.status !== "paused") {
      throw new WorkflowDagControlError(`Cannot pause a workflow that is ${instance.status}.`);
    }
  } else if (params.action === "resume") {
    if (instance.status === "paused") {
      instance = transitionWorkflowDagInstance({ instance, status: "running", now });
    } else if (instance.status !== "running") {
      throw new WorkflowDagControlError(`Cannot resume a workflow that is ${instance.status}.`);
    }
  } else if (instance.status === "queued" || instance.status === "running" || instance.status === "paused") {
    instance = transitionWorkflowDagInstance({ instance, status: "cancelled", reason, now });
  } else if (instance.status !== "cancelled") {
    throw new WorkflowDagControlError(`Cannot cancel a workflow that is ${instance.status}.`);
  }

  return {
    instance,
    status: instance.status,
    compensations: params.action === "cancel" ? deriveCompensations(params.bundle, instance) : []
  };
}

function deriveCompensations(bundle: GoalBundle, instance: WorkflowDagInstance): string[] {
  const taskById = new Map(bundle.tasks.map((task) => [task.id, task]));
  return instance.nodeExecutions
    .filter((execution) => execution.status === "completed")
    .map((execution) => {
      const label = taskById.get(execution.nodeId)?.title ?? execution.nodeId;
      return `Review completed step "${label}" for rollback before closing the cancelled workflow.`;
    });
}
