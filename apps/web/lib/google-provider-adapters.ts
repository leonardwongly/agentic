import type { ProviderCredential } from "@agentic/contracts";
import {
  assessManagedGoogleCredential,
  createCalendarAdapter,
  createGmailAdapter,
  createProviderCredentialSecretStore,
  googleWorkspaceRequiredScopes,
  type GmailAdapter,
  type GoogleCalendarAdapter
} from "@agentic/integrations";
import type { AgenticRepository } from "@agentic/repository";

type GoogleWorkspaceAdapters = {
  credential: ProviderCredential;
  gmail: GmailAdapter;
  calendar: GoogleCalendarAdapter;
};

function listGoogleCredentialCandidatesForWorkspace(
  credentials: ProviderCredential[],
  workspaceId: string | null | undefined
): ProviderCredential[] {
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

export async function resolveGoogleWorkspaceAdapters(params: {
  repository: AgenticRepository;
  userId: string;
  workspaceId?: string | null;
}): Promise<GoogleWorkspaceAdapters | null> {
  const candidates = listGoogleCredentialCandidatesForWorkspace(
    await params.repository.listProviderCredentials(params.userId),
    params.workspaceId ?? null
  );

  if (candidates.length === 0) {
    return null;
  }

  const candidateFailures: string[] = [];

  for (const credential of candidates) {
    const secretRecord = await params.repository.getProviderCredentialSecret(
      credential.id,
      "oauth_refresh_token",
      params.userId
    );
    const assessment = assessManagedGoogleCredential({
      account: {
        id: "google-workspace",
        name: "Google workspace adapters",
        metadata: {
          provider: "google",
          managed: true,
          providerCredentialId: credential.id
        }
      },
      credential,
      hasRefreshTokenSecret: Boolean(secretRecord)
    });

    const missingWorkspaceScopes = googleWorkspaceRequiredScopes.filter((scope) => !credential.scopes.includes(scope));
    const blockedByWorkspaceScopes = missingWorkspaceScopes.length > 0;
    const workspaceIssues = blockedByWorkspaceScopes
      ? [`missing required Google scopes: ${missingWorkspaceScopes.join(", ")}`]
      : [];

    if (!assessment?.ready || blockedByWorkspaceScopes) {
      candidateFailures.push(
        `${credential.id}: ${[...(assessment?.issues.map((issue) => issue.message) ?? []), ...workspaceIssues].join("; ")}`
      );
      continue;
    }

    try {
      const refreshToken = createProviderCredentialSecretStore().decrypt(secretRecord!.secret);

      return {
        credential,
        gmail: createGmailAdapter({ refreshToken }),
        calendar: createCalendarAdapter({ refreshToken })
      };
    } catch (error) {
      candidateFailures.push(
        `${credential.id}: ${error instanceof Error ? error.message : "failed to decrypt refresh token"}`
      );
    }
  }

  throw new Error(
    `No approval-safe Google credential is available for workspace adapters. ${candidateFailures.join(" | ")}`
  );
}
