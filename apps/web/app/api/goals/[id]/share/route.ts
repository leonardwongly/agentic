import crypto from "node:crypto";
import { z } from "zod";
import { WorkspaceGovernanceSchema } from "@agentic/contracts";
import { resolveWorkspaceGovernanceDefaultsFromEnv } from "@agentic/repository";
import { ApiRouteError, authenticatedJson } from "../../../../../lib/api-response";
import { createGovernedMutationRoute } from "../../../../../lib/governed-route";
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
  const dashboard = workspaceId ? null : await repository.getDashboardData(userId);
  const governanceWorkspaceId = workspaceId ?? dashboard?.activeWorkspace?.id ?? null;
  if (!governanceWorkspaceId) {
    throw new ApiRouteError(403, "Public sharing is disabled until workspace governance explicitly enables it.");
  }
  const governance =
    (workspaceId ? null : dashboard?.workspaceGovernance) ??
    (await repository.getWorkspaceGovernance(governanceWorkspaceId, userId)) ??
    WorkspaceGovernanceSchema.parse({
      workspaceId: governanceWorkspaceId,
      ...resolveWorkspaceGovernanceDefaultsFromEnv(),
      updatedBy: userId,
      createdAt: dashboard?.activeWorkspace?.createdAt ?? new Date().toISOString(),
      updatedAt: dashboard?.activeWorkspace?.updatedAt ?? new Date().toISOString()
    });

  if (!governance?.publicSharingEnabled) {
    throw new ApiRouteError(403, "Public sharing is disabled until workspace governance explicitly enables it.");
  }
}

export const POST = createGovernedMutationRoute<undefined, RouteContext>(
  {
    route: "api.goals.share.create",
    fallbackError: "Failed to create a goal share link.",
    rateLimit: {
      namespace: "goal-share-create",
      error: "Too many goal share creation requests. Try again later."
    },
    idempotency: "optional"
  },
  async ({ request, routeContext, principal, actorContext }) => {
    const { id } = await routeContext.params;
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
  }
);

export const DELETE = createGovernedMutationRoute<z.infer<typeof RevokeGoalShareBodySchema>, RouteContext>(
  {
    route: "api.goals.share.revoke",
    fallbackError: "Failed to revoke the goal share link.",
    bodySchema: RevokeGoalShareBodySchema,
    rateLimit: {
      namespace: "goal-share-revoke",
      error: "Too many goal share revoke requests. Try again later."
    },
    idempotency: "optional"
  },
  async ({ routeContext, principal, actorContext, body }) => {
    const { id } = await routeContext.params;
    const goalId = GoalIdSchema.parse(id);
    const { shareId } = body;
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
  }
);
