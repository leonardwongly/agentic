import { z } from "zod";
import { requireApiSession } from "../../../../lib/auth";
import { ApiRouteError, authenticatedJson, handleApiError } from "../../../../lib/api-response";
import { getSeededRepository } from "../../../../lib/server";

const GoalIdSchema = z.string().trim().min(1).max(200);

export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const principal = await requireApiSession(request);
    const { id } = await context.params;
    const goalId = GoalIdSchema.parse(id);
    const repository = await getSeededRepository();
    const bundle = await repository.getGoalBundleForUser(goalId, principal.userId);

    if (!bundle) {
      throw new ApiRouteError(404, `Goal ${goalId} was not found.`);
    }

    return authenticatedJson({ bundle });
  } catch (error) {
    return handleApiError(error, "Failed to load goal.");
  }
}
