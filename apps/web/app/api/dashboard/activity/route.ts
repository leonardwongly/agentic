import { requireApiSession } from "../../../../lib/auth";
import { authenticatedJson, handleApiError, withApiTelemetry } from "../../../../lib/api-response";
import { buildDashboardCollectionPage, parseDashboardCollectionQuery } from "../../../../lib/dashboard-collection";
import { getSeededRepository } from "../../../../lib/server";

export async function GET(request: Request) {
  return withApiTelemetry(request, "api.dashboard.activity", async () => {
    try {
      const principal = await requireApiSession(request);
      const query = parseDashboardCollectionQuery(request, {
        allowedFilters: ["kind"]
      });
      const repository = await getSeededRepository();
      const dashboard = await repository.getDashboardData(principal.userId);
      const logs = dashboard.actionLogs.filter((log) => !query.kind || log.kind === query.kind);

      return authenticatedJson({
        page: buildDashboardCollectionPage(logs, query, {
          getId: (log) => log.id,
          getCreatedAt: (log) => log.createdAt,
          getTitle: (log) => log.kind,
          getSearchText: (log) => [log.id, log.kind, log.message, log.actor].join(" ")
        })
      });
    } catch (error) {
      return handleApiError(error, "Failed to load dashboard activity.");
    }
  });
}
