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
import { readWorkflowControlStatusOverride } from "./workflow-dag-projection";
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

/**
 * Resolve the approved approval that authorises this dispatch.
 *
 * When the caller knows which approval triggered the follow-up job it must be honoured:
 * a task can carry more than one approved approval (nothing in GoalBundleSchema forbids it)
 * and a taskId-first match would permanently execute the wrong intent. Without an id the
 * historical first-match-by-task behaviour is kept so existing callers stay valid.
 */
function findApprovedApproval(task: Task, bundle: GoalBundle, approvalId?: string | null): ApprovalRequest | null {
  if (approvalId) {
    const named = bundle.approvals.find((candidate) => candidate.id === approvalId && candidate.taskId === task.id);

    if (named) {
      // The operator named a specific approval for THIS task: only it may authorise execution. If
      // it is not approved, do not silently substitute a different approved approval (a rejected
      // or stale id would otherwise run the wrong intent). A named approval that belongs to a
      // different task in a mixed batch still falls back to this task's own approved one.
      return named.decision === "approved" ? named : null;
    }
  }

  return (
    bundle.approvals.find((candidate) => candidate.taskId === task.id && candidate.decision === "approved") ?? null
  );
}

function resolveActionIntent(task: Task, bundle: GoalBundle, approvalId?: string | null): ActionIntent {
  const approvedApproval = findApprovedApproval(task, bundle, approvalId);
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
  /** Approval that authorised this dispatch; wins over the first approved approval of the task. */
  approvalId?: string | null;
  adapters: ActionExecutionAdapters;
  connectorReadiness?: ActionExecutionConnectorReadiness;
  governance?: WorkspaceGovernance | null;
  sideEffectLedger?: ActionExecutionSideEffectLedger;
  signal?: AbortSignal;
}): Promise<{ result: ExecutionResult; log: ActionLog }> {
  const { task, bundle, adapters, connectorReadiness, governance, sideEffectLedger, signal } = params;
  const actionIntent = resolveActionIntent(task, bundle, params.approvalId);
  const approvedApproval = findApprovedApproval(task, bundle, params.approvalId);
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
      sideEffectLedger,
      signal
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
  /**
   * Approval that authorised the batch. Production dispatch is one job per approval, so a
   * single id is enough to disambiguate tasks that hold several approved approvals; batches
   * that mix approvals keep the historical first-match resolution for the other ids.
   */
  approvalId?: string | null;
  adapters: ActionExecutionAdapters;
  connectorReadiness?: ActionExecutionConnectorReadiness;
  governance?: WorkspaceGovernance | null;
  sideEffectLedger?: ActionExecutionSideEffectLedger;
  signal?: AbortSignal;
}): Promise<{ results: ExecutionResult[]; logs: ActionLog[] }> {
  const { bundle, approvedTaskIds, approvalId, adapters, connectorReadiness, governance, sideEffectLedger, signal } =
    params;
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
      approvalId,
      adapters,
      connectorReadiness,
      governance,
      sideEffectLedger,
      signal
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

/**
 * A completed envelope reports a real external effect, so it outranks a skipped or failed
 * envelope for the same task no matter how the callbacks were ordered.
 */
const resultAuthority: Record<ExecutionResult["kind"], number> = {
  "execution.failed": 0,
  "execution.skipped": 1,
  "execution.completed": 2
};

function isMoreAuthoritativeResult(candidate: ExecutionResult, current: ExecutionResult): boolean {
  if (resultAuthority[candidate.kind] !== resultAuthority[current.kind]) {
    return resultAuthority[candidate.kind] > resultAuthority[current.kind];
  }

  const candidateAt = Date.parse(candidate.timestamp);
  const currentAt = Date.parse(current.timestamp);

  if (Number.isFinite(candidateAt) && Number.isFinite(currentAt) && candidateAt !== currentAt) {
    return candidateAt > currentAt;
  }

  // Same rank and indistinguishable timestamps: the later delivery wins.
  return true;
}

/**
 * Collapse duplicate/out-of-order envelopes to one effective result per task.
 *
 * `executeApprovedTasks()` emits one envelope per requested id, so retries and replayed
 * deliveries routinely produce several envelopes for a single task. First-match-wins let a
 * discarded failure overwrite the success that the retry really produced, and let a foreign
 * envelope - for a task this bundle never contained - rewrite the recovery checkpoint.
 */
function selectEffectiveResults(results: ExecutionResult[], knownTaskIds: Set<string>): Map<string, ExecutionResult> {
  const effective = new Map<string, ExecutionResult>();

  for (const result of results) {
    if (!knownTaskIds.has(result.taskId)) {
      continue;
    }

    const current = effective.get(result.taskId);

    if (!current || isMoreAuthoritativeResult(result, current)) {
      effective.set(result.taskId, result);
    }
  }

  return effective;
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

  const effectiveResults = selectEffectiveResults(results, new Set(bundle.tasks.map((task) => task.id)));
  const baseActionLogs = [...bundle.actionLogs, ...logs];
  const stateTransitionLogs: ActionLog[] = [];
  const tasks = bundle.tasks.map((task) => {
    const result = effectiveResults.get(task.id);

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

  const statuses = recomputeWorkflowStatuses(
    tasks,
    bundle.approvals,
    bundle.watchers,
    readWorkflowControlStatusOverride(bundle)
  );
  // Recovery state is derived only from the results that were actually attributed to a
  // task of this bundle: superseded duplicates and foreign envelopes must not flip the
  // checkpoint of work that reconciled cleanly.
  const appliedResults = [...effectiveResults.values()];
  const hasFailures = appliedResults.some((result) => result.kind === "execution.failed");
  const hasSkips = appliedResults.some((result) => result.kind === "execution.skipped");
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
