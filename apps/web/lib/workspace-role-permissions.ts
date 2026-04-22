import type { WorkspaceMember, WorkspaceRole } from "@agentic/contracts";

export const GOAL_SHARE_MUTATION_DENIED_REASON =
  "Only workspace owners and editors can manage public goal share links.";

export function canManageGoalSharesForRole(role: WorkspaceRole | null | undefined): boolean {
  return role === "owner" || role === "editor";
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
