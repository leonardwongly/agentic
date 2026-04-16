import { z } from "zod";
import { AutopilotSettingsSchema, AutopilotModeSchema, nowIso } from "@agentic/contracts";
import { ApiRouteError, authenticatedJson, handleApiError, parseJsonBody } from "../../../../lib/api-response";
import { requireApiSession } from "../../../../lib/auth";
import { createActorContextFromPrincipal } from "../../../../lib/actor-context";

import { getSeededRepository } from "../../../../lib/server";

const UpdateAutopilotSettingsSchema = z
  .object({
    mode: AutopilotModeSchema.optional(),
    debounceMinutes: z.number().int().min(1).max(1440).optional()
  })
  .strict();

export async function GET(request: Request) {
  try {
    const principal = await requireApiSession(request);
    const repository = await getSeededRepository();
    const settings = await repository.getAutopilotSettings(principal.userId);

    return authenticatedJson({ settings });
  } catch (error) {
    return handleApiError(error, "Failed to retrieve autopilot settings.");
  }
}

export async function POST(request: Request) {
  try {
    const principal = await requireApiSession(request);
    const actorContext = createActorContextFromPrincipal(principal);
    const repository = await getSeededRepository();
    const body = await parseJsonBody(request, UpdateAutopilotSettingsSchema);

    if (body.mode === "auto_run" && repository.backend !== "postgres") {
      throw new ApiRouteError(409, "Autopilot auto-run requires Postgres-backed persistence.");
    }

    const current = await repository.getAutopilotSettings(principal.userId);
    const settings = await repository.saveAutopilotSettings(
      AutopilotSettingsSchema.parse({
        ...current,
        ...body,
        userId: principal.userId,
        actorContext,
        updatedAt: nowIso()
      })
    );

    return authenticatedJson({
      settings,
      dashboard: await repository.getDashboardData(principal.userId)
    });
  } catch (error) {
    return handleApiError(error, "Failed to update autopilot settings.");
  }
}
