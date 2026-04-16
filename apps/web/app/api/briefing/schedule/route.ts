import { z } from "zod";
import {
  BriefingFocusSchema,
  BriefingPreferencesSchema,
  BriefingScheduleEntrySchema,
  nowIso
} from "@agentic/contracts";
import { requireApiSession } from "../../../../lib/auth";
import { authenticatedJson, handleApiError, parseJsonBody } from "../../../../lib/api-response";
import { createActorContextFromPrincipal } from "../../../../lib/actor-context";
import { getSeededRepository } from "../../../../lib/server";

const BriefingPreferencesUpdateSchema = z
  .object({
    timezone: z.string().trim().min(1).max(100).optional(),
    focus: BriefingFocusSchema.optional(),
    schedules: z.array(BriefingScheduleEntrySchema).optional()
  })
  .strict();

export async function GET(request: Request) {
  try {
    const principal = await requireApiSession(request);
    const repository = await getSeededRepository();
    const preferences = await repository.getBriefingPreferences(principal.userId);
    return authenticatedJson({ preferences });
  } catch (error) {
    return handleApiError(error, "Failed to retrieve briefing preferences.");
  }
}

export async function POST(request: Request) {
  try {
    const principal = await requireApiSession(request);
    const repository = await getSeededRepository();
    const actorContext = createActorContextFromPrincipal(principal);
    const body = await parseJsonBody(request, BriefingPreferencesUpdateSchema);
    const current = await repository.getBriefingPreferences(principal.userId);
    const updated = BriefingPreferencesSchema.parse({
      ...current,
      ...body,
      userId: principal.userId,
      actorContext,
      updatedAt: nowIso()
    });

    const preferences = await repository.saveBriefingPreferences(updated);

    return authenticatedJson({
      preferences,
      dashboard: await repository.getDashboardData(principal.userId)
    });
  } catch (error) {
    return handleApiError(error, "Failed to update briefing preferences.");
  }
}
