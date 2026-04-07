import { z } from "zod";
import { SYSTEM_USER_ID } from "@agentic/contracts";
import { refineGoal } from "@agentic/orchestrator";
import { requireApiSession } from "../../../../../lib/auth";
import { ApiRouteError, authenticatedJson, handleApiError, parseJsonBody } from "../../../../../lib/api-response";
import { getSeededRepository } from "../../../../../lib/server";

const GoalIdSchema = z.string().trim().min(1).max(200);

const RefinementBodySchema = z
  .object({
    message: z.string().trim().min(1).max(2_000)
  })
  .strict();

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
    const body = await parseJsonBody(request, RefinementBodySchema);
    const repository = await getSeededRepository();
    const bundle = await repository.getGoalBundleForUser(goalId, SYSTEM_USER_ID);

    if (!bundle) {
      throw new ApiRouteError(404, `Goal ${goalId} was not found.`);
    }

    const memories = await repository.listMemory(SYSTEM_USER_ID);

    const updatedBundle = await refineGoal({
      bundle,
      refinement: body.message,
      memories
    });

    await repository.saveGoalBundle(updatedBundle);

    return authenticatedJson({
      bundle: updatedBundle,
      dashboard: await repository.getDashboardData(SYSTEM_USER_ID)
    });
  } catch (error) {
    return handleApiError(error, "Failed to refine goal.");
  }
}
