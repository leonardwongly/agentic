import { commitmentStatusValues } from "@agentic/contracts";
import { listDashboardCommitmentsPage } from "@agentic/repository";
import { requireApiSession } from "../../../../lib/auth";
import { authenticatedJson, handleApiError, withApiTelemetry } from "../../../../lib/api-response";
import { buildDashboardCollectionPage, parseDashboardCollectionQuery } from "../../../../lib/dashboard-collection";
import { getSeededRepository } from "../../../../lib/server";

export async function GET(request: Request) {
  return withApiTelemetry(request, "api.dashboard.commitments", async () => {
    try {
      const principal = await requireApiSession(request);
      const query = parseDashboardCollectionQuery(request, {
        allowedFilters: ["status", "riskClass", "bucket"],
        allowedStatusValues: commitmentStatusValues
      });
      const repository = await getSeededRepository();
      const page = await listDashboardCommitmentsPage(repository, {
        userId: principal.userId,
        limit: query.limit,
        cursor: query.cursor,
        sort: query.sort,
        q: query.q,
        status: query.status,
        riskClass: query.riskClass,
        bucket: query.bucket
      });

      return authenticatedJson({
        page: buildDashboardCollectionPage(page)
      });
    } catch (error) {
      return handleApiError(error, "Failed to load dashboard commitments.");
    }
  });
}
