import type { TaskState } from "@agentic/contracts";

/**
 * Raised when an approval is still answerable (pending, unexpired) but the task it gates has
 * already moved somewhere the reviewer's decision cannot legally take it - e.g. a reviewer
 * approving a task that is already running, completed or failed. Without a typed error the
 * raw `Illegal task transition ...` throw from `transitionTaskState()` escaped the mutation
 * as an unhandled 500 and left the approval pending forever.
 *
 * `@agentic/repository` maps this onto `ApprovalMutationError("conflict")`, which the API
 * routes already translate into a reconcilable 409.
 */
export class ApprovalResponseConflictError extends Error {
  readonly code = "approval_task_state_conflict";
  readonly safeForUsers = true;
  readonly approvalId: string;
  readonly taskId: string;
  readonly fromState: TaskState;
  readonly toState: TaskState;
  readonly decision: "approved" | "rejected";

  constructor(params: {
    approvalId: string;
    taskId: string;
    fromState: TaskState;
    toState: TaskState;
    decision: "approved" | "rejected";
  }) {
    const verb = params.decision === "approved" ? "approve" : "reject";

    super(
      `Cannot ${verb} approval "${params.approvalId}": task "${params.taskId}" is "${params.fromState}" and cannot move to "${params.toState}".`
    );

    this.name = "ApprovalResponseConflictError";
    this.approvalId = params.approvalId;
    this.taskId = params.taskId;
    this.fromState = params.fromState;
    this.toState = params.toState;
    this.decision = params.decision;
  }
}
