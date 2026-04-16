import { z } from "zod";
import { describeIntegrationReadiness } from "@agentic/integrations";
import { IntegrationAccountSchema, nowIso } from "@agentic/contracts";
import { requireApiSession } from "../../../lib/auth";
import { createActorContextFromPrincipal } from "../../../lib/actor-context";
import { ApiRouteError, authenticatedJson, handleApiError, parseJsonBody } from "../../../lib/api-response";
import { requireJsonContentType } from "../../../lib/api-errors";
import { getSeededRepository } from "../../../lib/server";

const UpdateIntegrationSchema = z
  .object({
    id: z.string().trim().min(1),
    status: z.enum(["ready", "mock", "manual", "disabled"])
  })
  .strict();

function serializeIntegration(account: z.infer<typeof IntegrationAccountSchema>) {
  return {
    ...account,
    readiness: describeIntegrationReadiness(account)
  };
}

export async function GET(request: Request) {
  try {
    const principal = await requireApiSession(request);
    const repository = await getSeededRepository();
    return authenticatedJson({
      integrations: (await repository.listIntegrations(principal.userId)).map(serializeIntegration)
    });
  } catch (error) {
    return handleApiError(error, "Failed to list integrations.");
  }
}

export async function POST(request: Request) {
  try {
    requireJsonContentType(request);
    const principal = await requireApiSession(request);
    const actorContext = createActorContextFromPrincipal(principal);
    const body = await parseJsonBody(request, UpdateIntegrationSchema);
    const repository = await getSeededRepository();
    const existing = (await repository.listIntegrations(principal.userId)).find((integration) => integration.id === body.id);

    if (!existing) {
      throw new ApiRouteError(404, `Integration ${body.id} was not found.`);
    }

    if (existing.metadata.provider === "google" && existing.metadata.managed === true) {
      throw new ApiRouteError(
        409,
        `Integration ${body.id} is managed by Google provider credentials and cannot be toggled manually.`
      );
    }

    const integration = IntegrationAccountSchema.parse({
      ...existing,
      status: body.status,
      actorContext,
      updatedAt: nowIso()
    });

    await repository.upsertIntegration(integration);

    return authenticatedJson({
      integration: serializeIntegration(integration),
      dashboard: await repository.getDashboardData(principal.userId)
    });
  } catch (error) {
    return handleApiError(error, "Failed to update integration.");
  }
}
