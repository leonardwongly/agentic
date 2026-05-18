import { nowIso } from "@agentic/contracts";
import {
  exchangeGoogleAuthorizationCode,
  fetchGoogleAccountProfile,
  createProviderCredentialSecretStore,
  decryptProviderCredentialSecret,
  rotateProviderCredentialSecretRecord
} from "@agentic/integrations";
import { parseAuthorizedOAuthStateToken, requireApiSession } from "../../../../../lib/auth";
import { createActorContextFromPrincipal } from "../../../../../lib/actor-context";
import { ApiRouteError, authenticatedRedirect } from "../../../../../lib/api-response";
import { buildPublicUrl } from "../../../../../lib/public-origin";
import { getSeededRepository } from "../../../../../lib/server";

function buildGoogleCredentialId(workspaceId: string | null, accountId: string): string {
  return `google:${workspaceId ?? "global"}:${accountId}`;
}

function buildGoogleCallbackUrl(request: Request): string {
  return buildPublicUrl(request.url, "/api/integrations/google/callback").toString();
}

function buildDashboardRedirect(request: Request, status: "connected" | "error", reason?: string): URL {
  const redirectUrl = buildPublicUrl(request.url, "/");
  redirectUrl.searchParams.set("integration", "google");
  redirectUrl.searchParams.set("status", status);

  if (reason) {
    redirectUrl.searchParams.set("reason", reason);
  }

  return redirectUrl;
}

export async function GET(request: Request) {
  try {
    const principal = await requireApiSession(request);
    const requestUrl = new URL(request.url);
    const state = parseAuthorizedOAuthStateToken(requestUrl.searchParams.get("state"), principal.userId);
    const code = requestUrl.searchParams.get("code")?.trim();
    const oauthError = requestUrl.searchParams.get("error")?.trim();

    if (oauthError) {
      throw new ApiRouteError(400, `Google OAuth was denied: ${oauthError}.`);
    }

    if (!state) {
      throw new ApiRouteError(400, "Google OAuth state is invalid or expired.");
    }

    if (!code) {
      throw new ApiRouteError(400, "Google OAuth callback is missing the authorization code.");
    }

    const repository = await getSeededRepository();
    const actorContext = createActorContextFromPrincipal(principal);
    const callbackUrl = buildGoogleCallbackUrl(request);
    const exchanged = await exchangeGoogleAuthorizationCode({
      code,
      redirectUri: callbackUrl
    });
    const profile = await fetchGoogleAccountProfile({
      redirectUri: callbackUrl,
      accessToken: exchanged.accessToken ?? undefined,
      refreshToken: exchanged.refreshToken ?? undefined
    });
    const credentialId = buildGoogleCredentialId(state.workspaceId, profile.sub);
    const existingCredential = await repository.getProviderCredential(credentialId, principal.userId);
    const existingSecretRecord = existingCredential
      ? await repository.getProviderCredentialSecret(credentialId, "oauth_refresh_token", principal.userId)
      : null;
    const secretStore = createProviderCredentialSecretStore();
    const refreshToken = exchanged.refreshToken ?? (
      existingSecretRecord
        ? decryptProviderCredentialSecret({
            store: secretStore,
            envelope: existingSecretRecord.secret,
            context: {
              credentialId,
              userId: principal.userId,
              kind: "oauth_refresh_token"
            },
            allowLegacyContextFallback: true
          })
        : null
    );

    if (!refreshToken) {
      throw new ApiRouteError(
        400,
        "Google OAuth did not return a refresh token and no stored credential was available to reuse."
      );
    }

    const timestamp = nowIso();
    const credential = await repository.saveProviderCredential({
      id: credentialId,
      userId: principal.userId,
      workspaceId: state.workspaceId,
      provider: "google",
      accountId: profile.sub,
      accountEmail: profile.email,
      displayName: profile.name,
      status: "connected",
      scopes: exchanged.scopes.length > 0 ? exchanged.scopes : existingCredential?.scopes ?? [],
      lastValidatedAt: timestamp,
      lastRotatedAt: exchanged.refreshToken ? timestamp : existingCredential?.lastRotatedAt ?? null,
      lastRefreshAt: timestamp,
      lastRefreshFailureAt: null,
      reconnectRequiredAt: null,
      revokedAt: null,
      expiresAt: exchanged.expiryDate,
      metadata: {
        ...existingCredential?.metadata,
        picture: profile.picture,
        lastConnectedAt: timestamp
      },
      actorContext,
      createdAt: existingCredential?.createdAt ?? timestamp,
      updatedAt: timestamp
    });

    const nextSecretRecord = {
      credentialId: credential.id,
      userId: principal.userId,
      kind: "oauth_refresh_token" as const,
      secret: secretStore.encrypt(refreshToken, {
        credentialId: credential.id,
        userId: principal.userId,
        kind: "oauth_refresh_token"
      }),
      createdAt: existingSecretRecord?.createdAt ?? timestamp,
      updatedAt: timestamp
    };

    const rotation =
      existingSecretRecord && !exchanged.refreshToken
        ? rotateProviderCredentialSecretRecord({
            store: secretStore,
            record: existingSecretRecord,
            context: {
              credentialId: credential.id,
              userId: principal.userId,
              kind: "oauth_refresh_token"
            },
            mode: "commit",
            rotatedAt: timestamp,
            allowLegacyContextFallback: true
          })
        : null;

    await repository.saveProviderCredentialSecret(rotation?.rotatedRecord ?? nextSecretRecord);

    return authenticatedRedirect(buildDashboardRedirect(request, "connected"), { status: 302 });
  } catch (error) {
    console.error("[google-oauth-callback] Failed to persist Google provider credentials:", error);
    return authenticatedRedirect(buildDashboardRedirect(request, "error", "oauth_failed"), { status: 302 });
  }
}
