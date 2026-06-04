import { jobKindValues, jobStatusValues, type JobKind, type JobStatus } from "@agentic/contracts";
import { listDashboardJobsPage } from "@agentic/repository";
import { requireApiSession } from "../../../../lib/auth";
import { authenticatedJson, handleApiError, withApiTelemetry } from "../../../../lib/api-response";
import { buildDashboardCollectionPage, parseDashboardCollectionQuery } from "../../../../lib/dashboard-collection";
import { getSeededDashboardCollectionRepository } from "../../../../lib/server";

export async function GET(request: Request) {
  return withApiTelemetry(request, "api.dashboard.jobs", async () => {
    try {
      const principal = await requireApiSession(request);
      const query = parseDashboardCollectionQuery(request, {
        allowedFilters: ["status", "kind"],
        allowedStatusValues: jobStatusValues,
        allowedKindValues: jobKindValues
      });
      const repository = await getSeededDashboardCollectionRepository();
      const page = await listDashboardJobsPage(repository, {
        userId: principal.userId,
        limit: query.limit,
        cursor: query.cursor,
        sort: query.sort,
        q: query.q,
        statuses: query.status ? [query.status as JobStatus] : undefined,
        kinds: query.kind ? [query.kind as JobKind] : undefined
      });

      return authenticatedJson({
        page: buildDashboardCollectionPage(page)
      });
    } catch (error) {
      return handleApiError(error, "Failed to load dashboard jobs.");
    }
  });
}
