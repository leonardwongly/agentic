import { z } from "zod";
import { SYSTEM_USER_ID, WatcherSchema, nowIso } from "@agentic/contracts";
import { requireApiSession } from "../../../lib/auth";
import { ApiRouteError, authenticatedJson, handleApiError, parseJsonBody } from "../../../lib/api-response";
import { getSeededRepository } from "../../../lib/server";

const CreateWatcherSchema = z
  .object({
    goalId: z.string().trim().min(1),
    targetEntity: z.string().trim().min(1).max(80),
    condition: z.string().trim().min(1).max(200),
    frequency: WatcherFrequencySchema,
    triggerAction: z.string().trim().min(1).max(200),
    sourceSystems: z.array(z.string().trim().min(1).max(40)).max(8).optional()
  })
  .strict();

export async function GET(request: Request) {
  try {
    await requireApiSession(request);
    const repository = await getSeededRepository();
    return authenticatedJson({
      watchers: await repository.listWatchers({ userId: SYSTEM_USER_ID })
    });
  } catch (error) {
    return handleApiError(error, "Failed to list watchers.");
  }
}

export async function POST(request: Request) {
  try {
    requireJsonContentType(request);
    await requireApiSession(request);
    const body = await parseJsonBody(request, CreateWatcherSchema);
    const repository = await getSeededRepository();
    const goal = await repository.getGoalBundleForUser(body.goalId, SYSTEM_USER_ID);

    if (!goal) {
      throw new ApiRouteError(404, `Goal ${body.goalId} was not found.`);
    }

    const watcher = WatcherSchema.parse({
      id: crypto.randomUUID(),
      goalId: body.goalId,
      targetEntity: body.targetEntity,
      condition: body.condition,
      frequency: body.frequency,
      triggerAction: body.triggerAction,
      sourceSystems: body.sourceSystems ?? [],
      status: "active",
      expiryAt: null,
      createdAt: nowIso(),
      updatedAt: nowIso()
    });

    await repository.saveWatcher(watcher);

    return authenticatedJson({
      watcher,
      dashboard: await repository.getDashboardData(SYSTEM_USER_ID)
    });
  } catch (error) {
    return handleApiError(error, "Failed to save watcher.");
  }
}
