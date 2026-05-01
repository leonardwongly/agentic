import { z } from "zod";
import { WatcherSchema, nowIso } from "@agentic/contracts";
import { requireApiSession } from "../../../../lib/auth";
import { ApiRouteError, authenticatedJson, handleApiError, parseJsonBody } from "../../../../lib/api-response";
import { requireJsonContentType } from "../../../../lib/api-errors";
import { createActorContextFromPrincipal } from "../../../../lib/actor-context";
import { getSeededRepository } from "../../../../lib/server";
import {
  canOperateSharedWorkflow,
  getSharedWorkflowDeniedReason,
  resolveWorkspaceRoleForUser
} from "../../../../lib/workspace-role-permissions";

const WatcherIdSchema = z.string().trim().min(1).max(200);

const UpdateWatcherSchema = z
  .object({
    action: z.enum(["pause", "resume"])
  })
  .strict();

export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    requireJsonContentType(request);
    const principal = await requireApiSession(request);
    const actorContext = createActorContextFromPrincipal(principal);
    const { id } = await context.params;
    const watcherId = WatcherIdSchema.parse(id);
    const body = await parseJsonBody(request, UpdateWatcherSchema);
    const repository = await getSeededRepository();
    const watchers = await repository.listWatchers({ userId: principal.userId });
    const existing = watchers.find((watcher) => watcher.id === watcherId);

    if (!existing) {
      throw new ApiRouteError(404, `Watcher ${watcherId} was not found.`);
    }

    const goal = await repository.getGoalBundleForUser(existing.goalId, principal.userId);

    if (!goal) {
      throw new ApiRouteError(404, `Watcher goal ${existing.goalId} was not found.`);
    }

    if (goal.goal.workspaceId) {
      const workspaceMembers = await repository.listWorkspaceMembers(goal.goal.workspaceId, principal.userId);
      const role = resolveWorkspaceRoleForUser(workspaceMembers, goal.goal.workspaceId, principal.userId);

      if (!canOperateSharedWorkflow({ workspaceId: goal.goal.workspaceId, role })) {
        throw new ApiRouteError(403, getSharedWorkflowDeniedReason("manage_watchers"));
      }
    }

    const updated = WatcherSchema.parse({
      ...existing,
      status: body.action === "pause" ? "paused" : "active",
      actorContext,
      updatedAt: nowIso()
    });

    const savedWatcher = await repository.saveWatcher(updated);

    return authenticatedJson({
      watcher: savedWatcher,
      dashboard: await repository.getDashboardData(principal.userId)
    });
  } catch (error) {
    return handleApiError(error, "Failed to update watcher.");
  }
}
