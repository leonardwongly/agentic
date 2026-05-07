import { buildDashboardSummary } from "@agentic/repository";
import { requireApiSession } from "../../../../lib/auth";
import { authenticatedJson, handleApiError, withApiTelemetry } from "../../../../lib/api-response";
import { getSeededRepository } from "../../../../lib/server";

export async function GET(request: Request) {
  return withApiTelemetry(request, "api.dashboard.summary", async () => {
    try {
      const principal = await requireApiSession(request);
      const repository = await getSeededRepository();
      const dashboard = await repository.getDashboardData(principal.userId);

      return authenticatedJson({
        summary: buildDashboardSummary(dashboard)
      });
    } catch (error) {
      return handleApiError(error, "Failed to load dashboard summary.");
    }
  });
}
