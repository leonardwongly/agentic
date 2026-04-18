import { z } from "zod";
import { describeIntegrationReadiness } from "@agentic/integrations";
import { IntegrationAccountSchema, nowIso } from "@agentic/contracts";
import type { AgenticRepository } from "@agentic/repository";
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

async function serializeIntegration(
  account: z.infer<typeof IntegrationAccountSchema>,
  repository: AgenticRepository,
  providerCredentialsById?: Map<string, Awaited<ReturnType<AgenticRepository["listProviderCredentials"]>>[number]>
) {
  const providerCredentialId =
    account.metadata.provider === "google" &&
    account.metadata.managed === true &&
    typeof account.metadata.providerCredentialId === "string"
      ? account.metadata.providerCredentialId
      : null;

  const providerCredential = providerCredentialId ? providerCredentialsById?.get(providerCredentialId) ?? null : null;
  const providerSecret = providerCredential
    ? await repository.getProviderCredentialSecret(providerCredential.id, "oauth_refresh_token", account.userId)
    : null;

  return {
    ...account,
    readiness: describeIntegrationReadiness(account, {
      providerCredential: providerCredential
        ? {
            credential: providerCredential,
            hasRefreshTokenSecret: Boolean(providerSecret)
          }
        : undefined
    })
  };
}

export async function GET(request: Request) {
  try {
    const principal = await requireApiSession(request);
    const repository = await getSeededRepository();
    const integrations = await repository.listIntegrations(principal.userId);
    const providerCredentials = await repository.listProviderCredentials(principal.userId);
    const providerCredentialsById = new Map(providerCredentials.map((credential) => [credential.id, credential]));

    return authenticatedJson({
      integrations: await Promise.all(
        integrations.map((integration) => serializeIntegration(integration, repository, providerCredentialsById))
      )
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
      integration: await serializeIntegration(integration, repository),
      dashboard: await repository.getDashboardData(principal.userId)
    });
  } catch (error) {
    return handleApiError(error, "Failed to update integration.");
  }
}
