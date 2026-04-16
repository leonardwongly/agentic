import type { ProviderCredential } from "@agentic/contracts";
import {
  createCalendarAdapter,
  createGmailAdapter,
  createProviderCredentialSecretStore,
  type GmailAdapter,
  type GoogleCalendarAdapter
} from "@agentic/integrations";
import type { AgenticRepository } from "@agentic/repository";

type GoogleWorkspaceAdapters = {
  credential: ProviderCredential;
  gmail: GmailAdapter;
  calendar: GoogleCalendarAdapter;
};

function selectGoogleCredentialForWorkspace(
  credentials: ProviderCredential[],
  workspaceId: string | null | undefined
): ProviderCredential | null {
  const connected = credentials
    .filter((credential) => credential.provider === "google" && credential.status === "connected")
    .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));

  if (workspaceId) {
    const exact = connected.find((credential) => credential.workspaceId === workspaceId);

    if (exact) {
      return exact;
    }
  }

  return connected.find((credential) => credential.workspaceId === null) ?? null;
}

export async function resolveGoogleWorkspaceAdapters(params: {
  repository: AgenticRepository;
  userId: string;
  workspaceId?: string | null;
}): Promise<GoogleWorkspaceAdapters | null> {
  const credential = selectGoogleCredentialForWorkspace(
    await params.repository.listProviderCredentials(params.userId),
    params.workspaceId ?? null
  );

  if (!credential) {
    return null;
  }

  const secretRecord = await params.repository.getProviderCredentialSecret(
    credential.id,
    "oauth_refresh_token",
    params.userId
  );

  if (!secretRecord) {
    throw new Error(`Connected Google credential ${credential.id} is missing its refresh token.`);
  }

  const refreshToken = createProviderCredentialSecretStore().decrypt(secretRecord.secret);

  return {
    credential,
    gmail: createGmailAdapter({ refreshToken }),
    calendar: createCalendarAdapter({ refreshToken })
  };
}
