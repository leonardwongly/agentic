import { requireApiSession } from "../../../../lib/auth";
import { checkAbuseRateLimit } from "../../../../lib/abuse-rate-limit";
import {
  ApiRouteError,
  AUTHENTICATED_API_CACHE_CONTROL,
  authenticatedRateLimitError,
  handleApiError
} from "../../../../lib/api-response";
import { getSeededRepository } from "../../../../lib/server";

export async function GET(request: Request) {
  try {
    const principal = await requireApiSession(request);
    const rateLimit = await checkAbuseRateLimit({
      request,
      principal,
      namespace: "governance-audit"
    });

    if (!rateLimit.allowed) {
      return authenticatedRateLimitError("Too many audit export requests. Try again later.", rateLimit.retryAfterSeconds);
    }

    const repository = await getSeededRepository();
    const dashboard = await repository.getDashboardData(principal.userId);
    const activeWorkspace = dashboard.activeWorkspace;

    if (!activeWorkspace) {
      throw new ApiRouteError(404, "No active workspace is selected.");
    }

    const audit = await repository.exportWorkspaceAudit(activeWorkspace.id, principal.userId);

    return new Response(audit.content, {
      status: 200,
      headers: {
        "content-type": audit.contentType,
        "content-disposition": `attachment; filename="${audit.fileName}"`,
        "cache-control": AUTHENTICATED_API_CACHE_CONTROL,
        pragma: "no-cache",
        expires: "0",
        vary: "Cookie, X-Agentic-Access-Key"
      }
    });
  } catch (error) {
    return handleApiError(error, "Failed to export workspace audit.");
  }
}
