import { approvalDecisionValues } from "@agentic/contracts";
import { listDashboardApprovalsPage } from "@agentic/repository";
import { requireApiSession } from "../../../../lib/auth";
import { authenticatedJson, handleApiError, withApiTelemetry } from "../../../../lib/api-response";
import { buildDashboardCollectionPage, parseDashboardCollectionQuery } from "../../../../lib/dashboard-collection";
import { getSeededDashboardCollectionRepository } from "../../../../lib/server";

export async function GET(request: Request) {
  return withApiTelemetry(request, "api.dashboard.approvals", async () => {
    try {
      const principal = await requireApiSession(request);
      const query = parseDashboardCollectionQuery(request, {
        allowedFilters: ["status", "riskClass"],
        allowedStatusValues: approvalDecisionValues
      });
      const repository = await getSeededDashboardCollectionRepository();
      const page = await listDashboardApprovalsPage(repository, {
        userId: principal.userId,
        limit: query.limit,
        cursor: query.cursor,
        sort: query.sort,
        q: query.q,
        status: query.status,
        riskClass: query.riskClass
      });

      return authenticatedJson({
        page: buildDashboardCollectionPage(page)
      });
    } catch (error) {
      return handleApiError(error, "Failed to load dashboard approvals.");
    }
  });
}
