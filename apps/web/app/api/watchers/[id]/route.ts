import { z } from "zod";
import { WatcherSchema, nowIso } from "@agentic/contracts";
import { requireApiSession } from "../../../../lib/auth";
import { ApiRouteError, authenticatedJson, handleApiError, parseJsonBody } from "../../../../lib/api-response";
import { requireJsonContentType } from "../../../../lib/api-errors";
import { getSeededRepository } from "../../../../lib/server";

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
    const { id } = await context.params;
    const watcherId = WatcherIdSchema.parse(id);
    const body = await parseJsonBody(request, UpdateWatcherSchema);
    const repository = await getSeededRepository();
    const watchers = await repository.listWatchers({ userId: principal.userId });
    const existing = watchers.find((watcher) => watcher.id === watcherId);

    if (!existing) {
      throw new ApiRouteError(404, `Watcher ${watcherId} was not found.`);
    }

    const updated = WatcherSchema.parse({
      ...existing,
      status: body.action === "pause" ? "paused" : "active",
      updatedAt: nowIso()
    });

    await repository.saveWatcher(updated);

    return authenticatedJson({
      watcher: updated,
      dashboard: await repository.getDashboardData(principal.userId)
    });
  } catch (error) {
    return handleApiError(error, "Failed to update watcher.");
  }
}
