import { buildGoogleAuthorizationUrl, isGoogleOAuthConfigured } from "@agentic/integrations";
import { requireApiSession, buildOAuthStateToken } from "../../../../../lib/auth";
import { ApiRouteError, authenticatedRedirect, handleApiError } from "../../../../../lib/api-response";
import { buildPublicUrl } from "../../../../../lib/public-origin";
import { getSeededRepository } from "../../../../../lib/server";

function buildGoogleCallbackUrl(request: Request): string {
  return buildPublicUrl(request.url, "/api/integrations/google/callback").toString();
}

export async function GET(request: Request) {
  try {
    const principal = await requireApiSession(request);

    if (!isGoogleOAuthConfigured()) {
      throw new ApiRouteError(503, "Google OAuth is not configured for this runtime.");
    }

    const repository = await getSeededRepository();
    const dashboard = await repository.getDashboardData(principal.userId);
    const workspaceId = dashboard.activeWorkspace?.id ?? null;
    const existingCredential = (await repository.listProviderCredentials(principal.userId)).find(
      (credential) => credential.provider === "google" && credential.status === "connected" && credential.workspaceId === workspaceId
    );
    const state = buildOAuthStateToken({
      userId: principal.userId,
      workspaceId
    });
    const authorizationUrl = buildGoogleAuthorizationUrl({
      redirectUri: buildGoogleCallbackUrl(request),
      state,
      loginHint: existingCredential?.accountEmail ?? undefined
    });

    return authenticatedRedirect(authorizationUrl, { status: 302 });
  } catch (error) {
    return handleApiError(error, "Failed to start Google OAuth connection.");
  }
}
