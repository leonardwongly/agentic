import crypto from "node:crypto";
import { z } from "zod";
import { requireApiSession } from "../../../../../lib/auth";
import { createActorContextFromPrincipal } from "../../../../../lib/actor-context";
import { ApiRouteError, authenticatedJson, handleApiError, parseJsonBody } from "../../../../../lib/api-response";
import { GOAL_SHARE_MUTATION_DENIED_REASON, canManageGoalSharesForRole } from "../../../../../lib/workspace-role-permissions";
import {
  buildGoalShareUrl,
  createGoalShareCreatedLog,
  createGoalShareRevokedLog,
  createGoalShareToken,
  fingerprintGoalShareToken,
  getGoalShareExpiry
} from "../../../../../lib/share";
import { getSeededRepository } from "../../../../../lib/server";

const GoalIdSchema = z.string().trim().min(1).max(200);
const RevokeGoalShareBodySchema = z.object({
  shareId: z.string().trim().min(1).max(200)
}).strict();

type RouteContext = {
  params: Promise<{
    id: string;
  }>;
};

async function assertCanManageGoalShares(
  repository: Awaited<ReturnType<typeof getSeededRepository>>,
  workspaceId: string | null,
  goalUserId: string,
  userId: string
) {
  if (!workspaceId) {
    if (goalUserId !== userId) {
      throw new ApiRouteError(403, GOAL_SHARE_MUTATION_DENIED_REASON);
    }

    return;
  }

  const workspaceMembers = await repository.listWorkspaceMembers(workspaceId, userId);
  const role = workspaceMembers.find((member) => member.userId === userId)?.role;

  if (!canManageGoalSharesForRole(role)) {
    throw new ApiRouteError(403, GOAL_SHARE_MUTATION_DENIED_REASON);
  }
}

async function assertPublicSharingEnabled(
  repository: Awaited<ReturnType<typeof getSeededRepository>>,
  workspaceId: string | null,
  userId: string
) {
  if (!workspaceId) {
    throw new ApiRouteError(403, "Public sharing is disabled until workspace governance explicitly enables it.");
  }

  const governance = await repository.getWorkspaceGovernance(workspaceId, userId);

  if (!governance?.publicSharingEnabled) {
    throw new ApiRouteError(403, "Public sharing is disabled until workspace governance explicitly enables it.");
  }
}

export async function POST(request: Request, context: RouteContext) {
  try {
    const principal = await requireApiSession(request);
    const actorContext = createActorContextFromPrincipal(principal);
    const { id } = await context.params;
    const goalId = GoalIdSchema.parse(id);
    const repository = await getSeededRepository();
    const bundle = await repository.getGoalBundleForUser(goalId, principal.userId);

    if (!bundle) {
      throw new ApiRouteError(404, `Goal ${goalId} was not found.`);
    }

    await assertCanManageGoalShares(repository, bundle.goal.workspaceId, bundle.goal.userId, principal.userId);
    await assertPublicSharingEnabled(repository, bundle.goal.workspaceId, principal.userId);

    const expiresAt = getGoalShareExpiry();
    const createdAt = new Date().toISOString();
    const shareId = crypto.randomUUID();
    const token = createGoalShareToken(shareId, goalId, expiresAt);
    await repository.saveGoalShare({
      id: shareId,
      goalId,
      userId: principal.userId,
      workspaceId: bundle.goal.workspaceId,
      tokenFingerprint: fingerprintGoalShareToken(token),
      status: "active",
      actorContext,
      expiresAt,
      lastViewedAt: null,
      revokedAt: null,
      createdAt,
      updatedAt: createdAt
    });
    const shareLog = createGoalShareCreatedLog(bundle, shareId, token, expiresAt, actorContext);

    await repository.saveGoalBundle({
      ...bundle,
      actionLogs: [...bundle.actionLogs, shareLog]
    });

    return authenticatedJson({
      shareId,
      shareUrl: buildGoalShareUrl(request.url, token),
      expiresAt,
      dashboard: await repository.getDashboardData(principal.userId)
    });
  } catch (error) {
    return handleApiError(error, "Failed to create a goal share link.");
  }
}

export async function DELETE(request: Request, context: RouteContext) {
  try {
    const principal = await requireApiSession(request);
    const actorContext = createActorContextFromPrincipal(principal);
    const { id } = await context.params;
    const goalId = GoalIdSchema.parse(id);
    const { shareId } = await parseJsonBody(request, RevokeGoalShareBodySchema);
    const repository = await getSeededRepository();
    const [bundle, share] = await Promise.all([
      repository.getGoalBundleForUser(goalId, principal.userId),
      repository.getGoalShare(shareId, principal.userId)
    ]);

    if (!bundle || !share || share.goalId !== goalId) {
      throw new ApiRouteError(404, `Share ${shareId} was not found for goal ${goalId}.`);
    }

    await assertCanManageGoalShares(repository, bundle.goal.workspaceId, bundle.goal.userId, principal.userId);

    if (share.status !== "revoked") {
      const revokedAt = new Date().toISOString();
      await repository.saveGoalShare({
        ...share,
        status: "revoked",
        revokedAt,
        updatedAt: revokedAt
      });
      await repository.saveGoalBundle({
        ...bundle,
        actionLogs: [...bundle.actionLogs, createGoalShareRevokedLog(bundle, share.id, actorContext)]
      });
    }

    return authenticatedJson({
      shareId,
      dashboard: await repository.getDashboardData(principal.userId)
    });
  } catch (error) {
    return handleApiError(error, "Failed to revoke the goal share link.");
  }
}
