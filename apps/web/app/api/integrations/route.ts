import { z } from "zod";
import { IntegrationAccountSchema, SYSTEM_USER_ID, nowIso } from "@agentic/contracts";
import { requireApiSession } from "../../../lib/auth";
import { ApiRouteError, authenticatedJson, handleApiError, parseJsonBody } from "../../../lib/api-response";
import { getSeededRepository } from "../../../lib/server";

const UpdateIntegrationSchema = z
  .object({
    id: z.string().trim().min(1),
    status: z.enum(["ready", "mock", "manual", "disabled"])
  })
  .strict();

export async function GET(request: Request) {
  try {
    await requireApiSession(request);
    const repository = await getSeededRepository();
    return authenticatedJson({
      integrations: await repository.listIntegrations(SYSTEM_USER_ID)
    });
  } catch (error) {
    return handleApiError(error, "Failed to list integrations.");
  }
}

export async function POST(request: Request) {
  try {
    requireJsonContentType(request);
    await requireApiSession(request);
    const body = await parseJsonBody(request, UpdateIntegrationSchema);
    const repository = await getSeededRepository();
    const existing = (await repository.listIntegrations(SYSTEM_USER_ID)).find((integration) => integration.id === body.id);

    if (!existing) {
      throw new ApiRouteError(404, `Integration ${body.id} was not found.`);
    }

    const integration = IntegrationAccountSchema.parse({
      ...existing,
      status: body.status,
      updatedAt: nowIso()
    });

    await repository.upsertIntegration(integration);

    return authenticatedJson({
      integration,
      dashboard: await repository.getDashboardData(SYSTEM_USER_ID)
    });
  } catch (error) {
    return handleApiError(error, "Failed to update integration.");
  }
}
