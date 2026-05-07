import { artifactTypeValues } from "@agentic/contracts";
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
      const dashboard = await repository.getDashboardData(principal.userId);
      const artifacts = dashboard.goals.flatMap((bundle) => bundle.artifacts);
      const filteredArtifacts = artifacts.filter((artifact) => !query.kind || artifact.artifactType === query.kind);

      return authenticatedJson({
        page: buildDashboardCollectionPage(filteredArtifacts, query, {
          getId: (artifact) => artifact.id,
          getCreatedAt: (artifact) => artifact.createdAt,
          getTitle: (artifact) => artifact.title,
          getSearchText: (artifact) => [artifact.id, artifact.title, artifact.artifactType, artifact.content].join(" ")
        })
      });
    } catch (error) {
      return handleApiError(error, "Failed to load dashboard artifacts.");
    }
  });
}
