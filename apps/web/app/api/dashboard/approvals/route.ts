import { approvalDecisionValues, riskClassValues } from "@agentic/contracts";
import { requireApiSession } from "../../../../lib/auth";
import { authenticatedJson, handleApiError, withApiTelemetry } from "../../../../lib/api-response";
import { buildDashboardCollectionPage, parseDashboardCollectionQuery } from "../../../../lib/dashboard-collection";
import { getSeededRepository } from "../../../../lib/server";

export async function GET(request: Request) {
  return withApiTelemetry(request, "api.dashboard.approvals", async () => {
    try {
      const principal = await requireApiSession(request);
      const query = parseDashboardCollectionQuery(request, {
        allowedFilters: ["status", "riskClass"],
        allowedStatusValues: approvalDecisionValues
      });
      const repository = await getSeededRepository();
      const dashboard = await repository.getDashboardData(principal.userId);
      const approvals = dashboard.approvals.filter((approval) => {
        if (query.status && approval.decision !== query.status) {
          return false;
        }

        if (query.riskClass && !riskClassValues.includes(query.riskClass)) {
          return false;
        }

        return !query.riskClass || approval.riskClass === query.riskClass;
      });

      return authenticatedJson({
        page: buildDashboardCollectionPage(approvals, query, {
          getId: (approval) => approval.id,
          getCreatedAt: (approval) => approval.createdAt,
          getUpdatedAt: (approval) => approval.respondedAt ?? approval.createdAt,
          getTitle: (approval) => approval.title,
          getSearchText: (approval) =>
            [approval.id, approval.title, approval.rationale, approval.requestedAction, approval.riskClass].join(" ")
        })
      });
    } catch (error) {
      return handleApiError(error, "Failed to load dashboard approvals.");
    }
  });
}
