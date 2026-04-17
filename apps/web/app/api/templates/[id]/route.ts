import { z } from "zod";
import { GoalTemplateSchema, nowIso } from "@agentic/contracts";
import { computeNextRun } from "@agentic/orchestrator";
import { createActorContextFromPrincipal } from "../../../../lib/actor-context";
import { requireApiSession } from "../../../../lib/auth";
import { ApiRouteError, authenticatedJson, handleApiError, parseJsonBody } from "../../../../lib/api-response";
import { requireUpdatedAtPrecondition } from "../../../../lib/mutation-preconditions";
import { getSeededRepository } from "../../../../lib/server";

const TemplateIdSchema = z.string().trim().min(1).max(200);

const PatchScheduleSchema = z
  .object({
    schedule: z.object({
      enabled: z.boolean(),
      cron: z.string().max(100),
      timezone: z.string().max(100)
    })
  })
  .strict();

export async function DELETE(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const principal = await requireApiSession(request);
    const { id } = await context.params;
    const templateId = TemplateIdSchema.parse(id);
    const repository = await getSeededRepository();
    const templates = await repository.listTemplates(principal.userId);
    const existing = templates.find((t) => t.id === templateId);

    if (!existing) {
      throw new ApiRouteError(404, `Template ${templateId} was not found.`);
    }

    requireUpdatedAtPrecondition(request, existing.updatedAt);

    await repository.deleteTemplate(templateId);

    return authenticatedJson({
      deleted: templateId,
      dashboard: await repository.getDashboardData(principal.userId)
    });
  } catch (error) {
    return handleApiError(error, "Failed to delete template.");
  }
}

export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const principal = await requireApiSession(request);
    const actorContext = createActorContextFromPrincipal(principal);
    const { id } = await context.params;
    const templateId = TemplateIdSchema.parse(id);
    const body = await parseJsonBody(request, PatchScheduleSchema);
    const repository = await getSeededRepository();
    const templates = await repository.listTemplates(principal.userId);
    const existing = templates.find((t) => t.id === templateId);

    if (!existing) {
      throw new ApiRouteError(404, `Template ${templateId} was not found.`);
    }

    requireUpdatedAtPrecondition(request, existing.updatedAt);

    const nextRunAt = body.schedule.enabled && body.schedule.cron
      ? computeNextRun(body.schedule.cron, body.schedule.timezone)
      : null;

    const updated = GoalTemplateSchema.parse({
      ...existing,
      schedule: {
        enabled: body.schedule.enabled,
        cron: body.schedule.cron,
        timezone: body.schedule.timezone,
        lastRunAt: existing.schedule.lastRunAt,
        nextRunAt
      },
      actorContext,
      updatedAt: nowIso()
    });

    const saved = await repository.saveTemplate(updated);

    return authenticatedJson({
      template: saved,
      dashboard: await repository.getDashboardData(principal.userId)
    });
  } catch (error) {
    return handleApiError(error, "Failed to update template schedule.");
  }
}
