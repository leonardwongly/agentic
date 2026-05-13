import { requireApiSession } from "../../../../lib/auth";
import {
  authenticatedJson,
  handleApiError,
  withApiTelemetry
} from "../../../../lib/api-response";
import { getWebReadinessReport } from "../../../../lib/runtime-readiness";

export async function GET(request: Request) {
  return withApiTelemetry(request, "api.ready.details.read", async () => {
    try {
      await requireApiSession(request);
      const report = await getWebReadinessReport();

      return authenticatedJson(report, {
        status: report.ok ? 200 : 503
      });
    } catch (error) {
      return handleApiError(error, "Unable to read detailed readiness report.");
    }
  });
}
