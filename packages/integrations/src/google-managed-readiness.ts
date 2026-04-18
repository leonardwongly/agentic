import type { IntegrationAccount, ProviderCredential, ProviderCredentialStatus } from "@agentic/contracts";

export const managedGoogleRequiredScopesByIntegration = {
  gmail: ["https://www.googleapis.com/auth/gmail.modify"],
  "google-calendar": ["https://www.googleapis.com/auth/calendar"]
} as const;

export const googleWorkspaceRequiredScopes = [
  ...new Set(
    Object.values(managedGoogleRequiredScopesByIntegration).flatMap((scopes) => scopes)
  )
] as string[];

export const googleCredentialIssueCodeValues = [
  "provider_credential_missing",
  "provider_refresh_token_missing",
  "provider_scope_missing",
  "provider_reconnect_required",
  "provider_refresh_failed",
  "provider_revoked"
] as const;

export type GoogleCredentialIssueCode = (typeof googleCredentialIssueCodeValues)[number];

export type GoogleCredentialIssue = {
  code: GoogleCredentialIssueCode;
  blocking: boolean;
  message: string;
  missingScopes?: string[];
};

export type GoogleCredentialAssessment = {
  provider: "google";
  providerCredentialId: string | null;
  credentialStatus: ProviderCredentialStatus | "missing";
  hasRefreshToken: boolean;
  missingScopes: string[];
  issues: GoogleCredentialIssue[];
  ready: boolean;
};

function extractProviderCredentialId(account: Pick<IntegrationAccount, "metadata">): string | null {
  const raw = account.metadata.providerCredentialId;
  return typeof raw === "string" && raw.trim().length > 0 ? raw : null;
}

export function isManagedGoogleIntegration(account: Pick<IntegrationAccount, "metadata">): boolean {
  return account.metadata.provider === "google" && account.metadata.managed === true;
}

export function getManagedGoogleRequiredScopes(integrationId: string): readonly string[] {
  return managedGoogleRequiredScopesByIntegration[
    integrationId as keyof typeof managedGoogleRequiredScopesByIntegration
  ] ?? [];
}

export function assessManagedGoogleCredential(params: {
  account: Pick<IntegrationAccount, "id" | "name" | "metadata">;
  credential?: Pick<ProviderCredential, "id" | "status" | "scopes"> | null;
  hasRefreshTokenSecret?: boolean;
}): GoogleCredentialAssessment | null {
  if (!isManagedGoogleIntegration(params.account)) {
    return null;
  }

  const requiredScopes = getManagedGoogleRequiredScopes(params.account.id);
  const credential = params.credential ?? null;
  const issues: GoogleCredentialIssue[] = [];

  if (!credential) {
    issues.push({
      code: "provider_credential_missing",
      blocking: true,
      message: `${params.account.name} is managed by Google, but no connected provider credential is available.`
    });
  }

  const credentialStatus = credential?.status ?? "missing";

  if (credential && credential.status === "reconnect_required") {
    issues.push({
      code: "provider_reconnect_required",
      blocking: true,
      message: `${params.account.name} requires Google re-authentication before governed execution can continue.`
    });
  }

  if (credential && credential.status === "refresh_failed") {
    issues.push({
      code: "provider_refresh_failed",
      blocking: true,
      message: `${params.account.name} last failed to refresh its Google credential and should not be treated as approval-safe.`
    });
  }

  if (credential && credential.status === "revoked") {
    issues.push({
      code: "provider_revoked",
      blocking: true,
      message: `${params.account.name} lost Google access because the provider credential was revoked.`
    });
  }

  if (credential && !params.hasRefreshTokenSecret) {
    issues.push({
      code: "provider_refresh_token_missing",
      blocking: true,
      message: `${params.account.name} is missing its encrypted Google refresh token, so the managed connector cannot refresh safely.`
    });
  }

  const missingScopes = credential
    ? requiredScopes.filter((scope) => !credential.scopes.includes(scope))
    : [...requiredScopes];

  if (missingScopes.length > 0) {
    issues.push({
      code: "provider_scope_missing",
      blocking: true,
      missingScopes,
      message: `${params.account.name} is missing required Google scopes: ${missingScopes.join(", ")}.`
    });
  }

  return {
    provider: "google",
    providerCredentialId: credential?.id ?? extractProviderCredentialId(params.account),
    credentialStatus,
    hasRefreshToken: Boolean(credential && params.hasRefreshTokenSecret),
    missingScopes,
    issues,
    ready: issues.every((issue) => !issue.blocking)
  };
}
