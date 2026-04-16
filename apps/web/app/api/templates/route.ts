import { z } from "zod";
import { createGoalTemplate } from "@agentic/orchestrator";
import { createActorContextFromPrincipal } from "../../../lib/actor-context";
import { requireApiSession } from "../../../lib/auth";
import { authenticatedJson, handleApiError, parseJsonBody } from "../../../lib/api-response";
import { getSeededRepository } from "../../../lib/server";

const CreateTemplateSchema = z
  .object({
    name: z.string().trim().min(1).max(200),
    description: z.string().trim().max(500).optional(),
    request: z.string().trim().min(1).max(2_000),
    parameters: z.record(z.string(), z.string()).optional(),
    schedule: z
      .object({
        enabled: z.boolean(),
        cron: z.string().max(100),
        timezone: z.string().max(100)
      })
      .optional()
  })
  .strict();

export async function GET(request: Request) {
  try {
    const principal = await requireApiSession(request);
    const repository = await getSeededRepository();
    return authenticatedJson({
      templates: await repository.listTemplates(principal.userId)
    });
  } catch (error) {
    return handleApiError(error, "Failed to list templates.");
  }
}

export async function POST(request: Request) {
  try {
    const principal = await requireApiSession(request);
    const actorContext = createActorContextFromPrincipal(principal);
    const body = await parseJsonBody(request, CreateTemplateSchema);
    const repository = await getSeededRepository();

    const template = createGoalTemplate({
      userId: principal.userId,
      name: body.name,
      description: body.description,
      request: body.request,
      parameters: body.parameters,
      schedule: body.schedule
    });

    const saved = await repository.saveTemplate({
      ...template,
      actorContext
    });

    return authenticatedJson({
      template: saved,
      dashboard: await repository.getDashboardData(principal.userId)
    });
  } catch (error) {
    return handleApiError(error, "Failed to create template.");
  }
}
