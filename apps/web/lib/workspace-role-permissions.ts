import type { WorkspaceMember, WorkspaceRole } from "@agentic/contracts";

export const GOAL_SHARE_MUTATION_DENIED_REASON =
  "Only workspace owners and editors can manage public goal share links.";
export const SHARED_WORKSPACE_AUTOMATION_DENIED_REASON =
  "Only workspace owners and editors can manage shared workspace automations.";
export const SHARED_GOAL_REFINEMENT_DENIED_REASON =
  "Viewers can inspect shared goals, but only workspace owners and editors can refine them.";
export const SHARED_WATCHER_MUTATION_DENIED_REASON =
  "Viewers can inspect shared workflow watchers, but only workspace owners and editors can create or change them.";
export const SHARED_JOB_REPLAY_DENIED_REASON =
  "Viewers can inspect shared runtime issues, but only workspace owners and editors can replay dead-letter jobs.";

export type SharedWorkspaceOperation = "refine_goal" | "manage_watchers" | "replay_dead_letter_job";

const SHARED_WORKFLOW_DENIED_REASON_BY_OPERATION: Record<SharedWorkspaceOperation, string> = {
  refine_goal: SHARED_GOAL_REFINEMENT_DENIED_REASON,
  manage_watchers: SHARED_WATCHER_MUTATION_DENIED_REASON,
  replay_dead_letter_job: SHARED_JOB_REPLAY_DENIED_REASON
};

export function canManageGoalSharesForRole(role: WorkspaceRole | null | undefined): boolean {
  return role === "owner" || role === "editor";
}

export function canManageSharedWorkspaceAutomationsForRole(role: WorkspaceRole | null | undefined): boolean {
  return role === "owner" || role === "editor";
}

export function canOperateSharedWorkflowForRole(role: WorkspaceRole | null | undefined): boolean {
  return role === "owner" || role === "editor";
}

export function canOperateSharedWorkflow(params: {
  workspaceId: string | null | undefined;
  role: WorkspaceRole | null | undefined;
}): boolean {
  return !params.workspaceId || canOperateSharedWorkflowForRole(params.role);
}

export function getSharedWorkflowDeniedReason(operation: SharedWorkspaceOperation): string {
  return SHARED_WORKFLOW_DENIED_REASON_BY_OPERATION[operation];
}

export function resolveWorkspaceRoleForUser(
  workspaceMembers: readonly WorkspaceMember[],
  workspaceId: string | null | undefined,
  userId: string | null | undefined
): WorkspaceRole | null {
  if (!workspaceId || !userId) {
    return null;
  }

  return workspaceMembers.find((member) => member.workspaceId === workspaceId && member.userId === userId)?.role ?? null;
}
