import {
  ActionLogSchema,
  ActionIntentSchema,
  nowIso,
  type ActionExecutionOutcome,
  type ActionIntent,
  type ActionLog,
  type ApprovalRequest,
  type Capability,
  type GoalBundle,
  type Task,
  type TaskState,
  type WorkspaceGovernance
} from "@agentic/contracts";
import { canTransitionTaskState, recomputeWorkflowStatuses, transitionTaskState } from "@agentic/execution";
import {
  assertCapabilitiesWithinAllowlist,
  CapabilityAllowlistViolationError,
  executeTypedAction,
  type ActionExecutionAdapters,
  type ActionExecutionConnectorReadiness,
  type ActionExecutionSideEffectLedger
} from "@agentic/integrations";
import { createActionLog } from "@agentic/observability";
import { getGovernanceApprovalReason } from "@agentic/policy";

export type ExecutionResult = {
  taskId: string;
  success: boolean;
  action: string;
  detail: string;
  timestamp: string;
  kind: "execution.completed" | "execution.failed" | "execution.skipped";
  outcome?: ActionExecutionOutcome["status"];
  retryable?: boolean;
  idempotencyKey?: string | null;
  sideEffectTarget?: string | null;
  providerRef?: string | null;
  recoveryStrategy?: ActionExecutionOutcome["recovery"]["strategy"];
  compensationHints?: string[];
  dryRunSummary?: string;
};

function findApprovedApproval(task: Task, bundle: GoalBundle): ApprovalRequest | null {
  return bundle.approvals.find((candidate) => candidate.taskId === task.id && candidate.decision === "approved") ?? null;
}

function resolveActionIntent(task: Task, bundle: GoalBundle): ActionIntent {
  const approvedApproval = findApprovedApproval(task, bundle);
  const approval = approvedApproval ?? bundle.approvals.find((candidate) => candidate.taskId === task.id);

  if (approvedApproval?.actionIntent) {
    return approvedApproval.actionIntent;
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

function requiredCapabilitiesForActionIntent(actionIntent: ActionIntent): Capability[] {
  switch (actionIntent.type) {
    case "send_message":
      return actionIntent.mode === "send" ? ["send"] : ["draft", "send"];
    case "schedule_event":
      return ["schedule"];
    case "create_note":
      return ["create"];
    case "update_record":
      return ["update"];
    case "delete_record":
      return ["delete"];
    case "monitor_signal":
      return ["monitor"];
    case "manual_review":
    default:
      return [];
  }
}

const riskRank: Record<ActionIntent["riskClass"], number> = {
  R1: 1,
  R2: 2,
  R3: 3,
  R4: 4
};

function validateTypedActionBoundary(params: { task: Task; actionIntent: ActionIntent }): string | null {
  const { task, actionIntent } = params;

  try {
    assertCapabilitiesWithinAllowlist(task.assignedAgent, task.toolCapabilities);
  } catch (error) {
    if (error instanceof CapabilityAllowlistViolationError) {
      return `Execution skipped: agent "${task.assignedAgent}" was granted disallowed capability "${error.disallowedCapability}" outside its allowlist.`;
    }

    throw error;
  }

  const requiredCapabilities = requiredCapabilitiesForActionIntent(actionIntent);

  if (riskRank[actionIntent.riskClass] > riskRank[task.riskClass]) {
    return `Execution skipped: typed ${actionIntent.type} intent risk ${actionIntent.riskClass} exceeds task risk grant ${task.riskClass}.`;
  }

  if (requiredCapabilities.length === 0) {
    return null;
  }

  if (requiredCapabilities.some((capability) => task.toolCapabilities.includes(capability))) {
    return null;
  }

  return `Execution skipped: typed ${actionIntent.type} intents require one of [${requiredCapabilities.join(", ")}] but task "${task.title}" only grants [${task.toolCapabilities.join(", ") || "none"}].`;
}

function buildResult(params: {
  bundle: GoalBundle;
  task: Task;
  action: string;
  success: boolean;
  detail: string;
  kind: "execution.completed" | "execution.failed" | "execution.skipped";
  error?: string;
  outcome?: ActionExecutionOutcome["status"];
  retryable?: boolean;
  idempotencyKey?: string | null;
  sideEffectTarget?: string | null;
  providerRef?: string | null;
  recoveryStrategy?: ActionExecutionOutcome["recovery"]["strategy"];
  compensationHints?: string[];
  dryRunSummary?: string;
}) {
  const timestamp = nowIso();
  const result: ExecutionResult = {
    taskId: params.task.id,
    success: params.success,
    action: params.action,
    detail: params.detail,
    timestamp,
    kind: params.kind,
    ...(params.outcome ? { outcome: params.outcome } : {}),
    ...(typeof params.retryable === "boolean" ? { retryable: params.retryable } : {}),
    ...(params.idempotencyKey !== undefined ? { idempotencyKey: params.idempotencyKey } : {}),
    ...(params.sideEffectTarget !== undefined ? { sideEffectTarget: params.sideEffectTarget } : {}),
    ...(params.providerRef !== undefined ? { providerRef: params.providerRef } : {}),
    ...(params.recoveryStrategy ? { recoveryStrategy: params.recoveryStrategy } : {}),
    ...(params.compensationHints ? { compensationHints: params.compensationHints } : {}),
    ...(params.dryRunSummary ? { dryRunSummary: params.dryRunSummary } : {})
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
        ...(params.outcome ? { outcome: params.outcome } : {}),
        ...(typeof params.retryable === "boolean" ? { retryable: params.retryable } : {}),
        ...(params.idempotencyKey !== undefined ? { idempotencyKey: params.idempotencyKey } : {}),
        ...(params.sideEffectTarget !== undefined ? { sideEffectTarget: params.sideEffectTarget } : {}),
        ...(params.providerRef !== undefined ? { providerRef: params.providerRef } : {}),
        ...(params.recoveryStrategy ? { recoveryStrategy: params.recoveryStrategy } : {}),
        ...(params.compensationHints ? { compensationHints: params.compensationHints } : {}),
        ...(params.dryRunSummary ? { dryRunSummary: params.dryRunSummary } : {}),
        ...(params.error ? { error: params.error } : {})
      }
    })
  );

  return { result, log };
}

export async function executeApprovedTask(params: {
  task: Task;
  bundle: GoalBundle;
  adapters: ActionExecutionAdapters;
  connectorReadiness?: ActionExecutionConnectorReadiness;
  governance?: WorkspaceGovernance | null;
  sideEffectLedger?: ActionExecutionSideEffectLedger;
}): Promise<{ result: ExecutionResult; log: ActionLog }> {
  const { task, bundle, adapters, connectorReadiness, governance, sideEffectLedger } = params;
  const actionIntent = resolveActionIntent(task, bundle);
  const approvedApproval = findApprovedApproval(task, bundle);
  const governanceApprovalReason = getGovernanceApprovalReason({
    capabilities: task.toolCapabilities,
    riskClass: task.riskClass,
    governance
  });
  const hasApprovedApproval = approvedApproval !== null;

  if (actionIntent.type !== "manual_review" && !hasApprovedApproval) {
    return buildResult({
      bundle,
      task,
      action: actionIntent.type,
      success: false,
      detail: `Execution skipped: typed ${actionIntent.type} intents require an approved approval record for this task.`,
      kind: "execution.skipped"
    });
  }

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

  const boundaryViolation = validateTypedActionBoundary({ task, actionIntent });

  if (boundaryViolation) {
    return buildResult({
      bundle,
      task,
      action: actionIntent.type,
      success: false,
      detail: boundaryViolation,
      kind: "execution.skipped"
    });
  }

  try {
    const { plan, outcome } = await executeTypedAction({
      task,
      actionIntent,
      adapters,
      connectorReadiness,
      sideEffectLedger
    });
    const kind =
      outcome.status === "completed"
        ? "execution.completed"
        : outcome.status === "skipped"
          ? "execution.skipped"
          : "execution.failed";

    return buildResult({
      bundle,
      task,
      action: actionIntent.type,
      success: outcome.status === "completed",
      detail: outcome.detail,
      kind,
      outcome: outcome.status,
      retryable: outcome.retryable,
      idempotencyKey: outcome.idempotencyKey,
      sideEffectTarget: outcome.sideEffectTarget,
      providerRef: outcome.providerRef,
      recoveryStrategy: outcome.recovery.strategy,
      compensationHints: outcome.recovery.compensationHints,
      dryRunSummary: plan.dryRunSummary
    });
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
  adapters: ActionExecutionAdapters;
  connectorReadiness?: ActionExecutionConnectorReadiness;
  governance?: WorkspaceGovernance | null;
  sideEffectLedger?: ActionExecutionSideEffectLedger;
}): Promise<{ results: ExecutionResult[]; logs: ActionLog[] }> {
  const { bundle, approvedTaskIds, adapters, connectorReadiness, governance, sideEffectLedger } = params;
  const results: ExecutionResult[] = [];
  const logs: ActionLog[] = [];

  for (const taskId of approvedTaskIds) {
    const task = bundle.tasks.find((candidate) => candidate.id === taskId);

    if (!task) {
      continue;
    }

    const { result, log } = await executeApprovedTask({
      task,
      bundle,
      adapters,
      connectorReadiness,
      governance,
      sideEffectLedger
    });
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
