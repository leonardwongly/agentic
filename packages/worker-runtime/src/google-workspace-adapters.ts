import {
  buildDefaultIntegrationAccounts,
  createCalendarAdapter,
  createGmailAdapter,
  createProviderCredentialSecretStore,
  decryptProviderCredentialSecret,
  describeIntegrationReadiness,
  type IntegrationReadinessProfile
} from "@agentic/integrations";
import type { CredentialRepositoryPort } from "@agentic/repository";

function listGoogleCredentialCandidatesForWorkspace(
  credentials: Awaited<ReturnType<CredentialRepositoryPort["listProviderCredentials"]>>,
  workspaceId: string | null | undefined
) {
  const connected = credentials
    .filter((credential) => credential.provider === "google" && credential.status === "connected")
    .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));

  if (workspaceId) {
    const exact = connected.filter((credential) => credential.workspaceId === workspaceId);

    if (exact.length > 0) {
      return exact;
    }
  }

  return connected.filter((credential) => credential.workspaceId === null);
}

export type GoogleWorkspaceAdapterResolution = {
  credential?: Awaited<ReturnType<CredentialRepositoryPort["listProviderCredentials"]>>[number];
  gmail?: ReturnType<typeof createGmailAdapter>;
  calendar?: ReturnType<typeof createCalendarAdapter>;
  readiness: {
    gmail: IntegrationReadinessProfile;
    calendar: IntegrationReadinessProfile;
  };
};

type GoogleWorkspaceCredential = NonNullable<GoogleWorkspaceAdapterResolution["credential"]>;

function buildGoogleWorkspaceReadiness(params: {
  userId: string;
  credential: GoogleWorkspaceCredential;
  hasRefreshTokenSecret: boolean;
}): GoogleWorkspaceAdapterResolution["readiness"] {
  const integrations = buildDefaultIntegrationAccounts(params.userId);
  const gmail = integrations.find((integration) => integration.id === "gmail");
  const calendar = integrations.find((integration) => integration.id === "google-calendar");

  if (!gmail || !calendar) {
    throw new Error("Default Google workspace integrations are not configured.");
  }

  return {
    gmail: describeIntegrationReadiness(
      {
        ...gmail,
        status: "ready",
        metadata: {
          ...gmail.metadata,
          provider: "google",
          managed: true,
          providerCredentialId: params.credential.id
        }
      },
      {
        providerCredential: {
          credential: params.credential,
          hasRefreshTokenSecret: params.hasRefreshTokenSecret
        }
      }
    ),
    calendar: describeIntegrationReadiness(
      {
        ...calendar,
        status: "ready",
        metadata: {
          ...calendar.metadata,
          provider: "google",
          managed: true,
          providerCredentialId: params.credential.id
        }
      },
      {
        providerCredential: {
          credential: params.credential,
          hasRefreshTokenSecret: params.hasRefreshTokenSecret
        }
      }
    )
  };
}

export async function resolveGoogleWorkspaceAdapters(params: {
  repository: CredentialRepositoryPort;
  userId: string;
  workspaceId?: string | null;
}): Promise<GoogleWorkspaceAdapterResolution | null> {
  const candidates = listGoogleCredentialCandidatesForWorkspace(
    await params.repository.listProviderCredentials(params.userId),
    params.workspaceId ?? null
  );

  if (candidates.length === 0) {
    return null;
  }

  const candidateFailures: string[] = [];
  let fallbackReadiness: Pick<GoogleWorkspaceAdapterResolution, "credential" | "readiness"> | null = null;

  for (const credential of candidates) {
    const secretRecord = await params.repository.getProviderCredentialSecret(
      credential.id,
      "oauth_refresh_token",
      params.userId
    );
    const readiness = buildGoogleWorkspaceReadiness({
      userId: params.userId,
      credential,
      hasRefreshTokenSecret: Boolean(secretRecord)
    });

    if (!secretRecord) {
      fallbackReadiness ??= { credential, readiness };
      continue;
    }

    try {
      const refreshToken = decryptProviderCredentialSecret({
        store: createProviderCredentialSecretStore(),
        envelope: secretRecord.secret,
        context: {
          credentialId: credential.id,
          userId: params.userId,
          kind: "oauth_refresh_token"
        }
      });

      return {
        credential,
        gmail: createGmailAdapter({ refreshToken }),
        calendar: createCalendarAdapter({ refreshToken }),
        readiness
      };
    } catch (error) {
      candidateFailures.push(
        `${credential.id}: ${error instanceof Error ? error.message : "failed to decrypt refresh token"}`
      );
    }
  }

  if (fallbackReadiness) {
    return fallbackReadiness;
  }

  throw new Error(
    `No approval-safe Google credential is available for workspace adapters. ${candidateFailures.join(" | ")}`
  );
}
