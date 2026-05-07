import { requireApiSession } from "../../../../lib/auth";
import { authenticatedJson, handleApiError, withApiTelemetry } from "../../../../lib/api-response";
import { buildDashboardIntelligenceReport } from "../../../../lib/dashboard-intelligence";
import { getSeededRepository } from "../../../../lib/server";

export async function GET(request: Request) {
  return withApiTelemetry(request, "api.dashboard.recommendations", async () => {
    try {
      const principal = await requireApiSession(request);
      const repository = await getSeededRepository();
      const dashboard = await repository.getDashboardData(principal.userId);

      return authenticatedJson({
        intelligence: buildDashboardIntelligenceReport(dashboard)
      });
    } catch (error) {
      return handleApiError(error, "Failed to load dashboard recommendations.");
    }
  });
}
