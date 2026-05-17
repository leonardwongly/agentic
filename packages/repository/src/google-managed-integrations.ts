import {
  IntegrationAccountSchema,
  type IntegrationAccount,
  type ProviderCredential
} from "@agentic/contracts";
import { buildDefaultIntegrationAccounts } from "@agentic/integrations";

const GOOGLE_MANAGED_INTEGRATION_IDS = ["gmail", "google-calendar"] as const;

export function isGoogleManagedIntegrationId(integrationId: string): boolean {
  return GOOGLE_MANAGED_INTEGRATION_IDS.includes(integrationId as (typeof GOOGLE_MANAGED_INTEGRATION_IDS)[number]);
}

function integrationStoreKey(account: Pick<IntegrationAccount, "id" | "userId">): string {
  return `${account.userId}:${account.id}`;
}

function upsertByKey<T>(items: T[], nextItem: T, getKey: (item: T) => string): T[] {
  const nextKey = getKey(nextItem);
  return [...items.filter((item) => getKey(item) !== nextKey), nextItem];
}

function buildGoogleManagedIntegrationStatus(status: ProviderCredential["status"]): IntegrationAccount["status"] {
  return status === "connected" ? "ready" : "manual";
}

function buildGoogleManagedIntegrationMetadata(credential: ProviderCredential): Record<string, unknown> {
  return {
    provider: "google",
    managed: true,
    providerCredentialId: credential.id,
    providerCredentialStatus: credential.status,
    workspaceId: credential.workspaceId,
    accountId: credential.accountId,
    accountEmail: credential.accountEmail,
    displayName: credential.displayName
  };
}

export function syncGoogleManagedIntegrations(
  integrations: IntegrationAccount[],
  credential: ProviderCredential
): IntegrationAccount[] {
  if (credential.provider !== "google") {
    return integrations;
  }

  const defaults = buildDefaultIntegrationAccounts(credential.userId);
  let nextIntegrations = [...integrations];

  for (const integrationId of GOOGLE_MANAGED_INTEGRATION_IDS) {
    const defaultIntegration = defaults.find((candidate) => candidate.id === integrationId);

    if (!defaultIntegration) {
      continue;
    }

    const existing =
      nextIntegrations.find((candidate) => candidate.userId === credential.userId && candidate.id === integrationId) ?? null;

    const managedIntegration = IntegrationAccountSchema.parse({
      ...(existing ?? defaultIntegration),
      userId: credential.userId,
      status: buildGoogleManagedIntegrationStatus(credential.status),
      metadata: {
        ...defaultIntegration.metadata,
        ...(existing?.metadata ?? {}),
        ...buildGoogleManagedIntegrationMetadata(credential)
      },
      actorContext: credential.actorContext,
      createdAt: existing?.createdAt ?? defaultIntegration.createdAt,
      updatedAt: credential.updatedAt
    });

    nextIntegrations = upsertByKey(nextIntegrations, managedIntegration, integrationStoreKey);
  }

  return nextIntegrations;
}
