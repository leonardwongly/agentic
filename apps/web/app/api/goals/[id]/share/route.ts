import { z } from "zod";
import { SYSTEM_USER_ID } from "@agentic/contracts";
import { requireApiSession } from "../../../../../lib/auth";
import { ApiRouteError, authenticatedJson, handleApiError } from "../../../../../lib/api-response";
import { buildGoalShareUrl, createGoalShareCreatedLog, createGoalShareToken, getGoalShareExpiry } from "../../../../../lib/share";
import { getSeededRepository } from "../../../../../lib/server";

const GoalIdSchema = z.string().trim().min(1).max(200);

type RouteContext = {
  params: Promise<{
    id: string;
  }>;
};

export async function POST(request: Request, context: RouteContext) {
  try {
    await requireApiSession(request);
    const { id } = await context.params;
    const goalId = GoalIdSchema.parse(id);
    const repository = await getSeededRepository();
    const bundle = await repository.getGoalBundleForUser(goalId, SYSTEM_USER_ID);

    if (!bundle) {
      throw new ApiRouteError(404, `Goal ${goalId} was not found.`);
    }

    const expiresAt = getGoalShareExpiry();
    const token = createGoalShareToken(goalId, expiresAt);
    const shareLog = createGoalShareCreatedLog(bundle, token, expiresAt);

    await repository.saveGoalBundle({
      ...bundle,
      actionLogs: [...bundle.actionLogs, shareLog]
    });

    return authenticatedJson({
      shareUrl: buildGoalShareUrl(request.url, token),
      expiresAt,
      dashboard: await repository.getDashboardData(SYSTEM_USER_ID)
    });
  } catch (error) {
    return handleApiError(error, "Failed to create a goal share link.");
  }
}
