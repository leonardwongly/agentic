import { artifactTypeValues } from "@agentic/contracts";
import { listDashboardArtifactsPage } from "@agentic/repository";
import { requireApiSession } from "../../../../lib/auth";
import { authenticatedJson, handleApiError, withApiTelemetry } from "../../../../lib/api-response";
import { buildDashboardCollectionPage, parseDashboardCollectionQuery } from "../../../../lib/dashboard-collection";
import { getSeededRepository } from "../../../../lib/server";

export async function GET(request: Request) {
  return withApiTelemetry(request, "api.dashboard.artifacts", async () => {
    try {
      const principal = await requireApiSession(request);
      const query = parseDashboardCollectionQuery(request, {
        allowedFilters: ["kind"],
        allowedKindValues: artifactTypeValues
      });
      const repository = await getSeededRepository();
      const page = await listDashboardArtifactsPage(repository, {
        userId: principal.userId,
        limit: query.limit,
        cursor: query.cursor,
        sort: query.sort,
        q: query.q,
        kind: query.kind
      });

      return authenticatedJson({
        page: buildDashboardCollectionPage(page)
      });
    } catch (error) {
      return handleApiError(error, "Failed to load dashboard artifacts.");
    }
  });
}
