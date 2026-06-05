import { operationalJson, withApiTelemetry } from "../../../lib/api-response";
import { getPublicWebReadinessSummary } from "../../../lib/runtime-readiness";

export async function GET(request: Request) {
  return withApiTelemetry(request, "api.ready.read", async () => {
    const report = await getPublicWebReadinessSummary();

    return operationalJson(
      report,
      {
        status: report.ok ? 200 : 503
      }
    );
  });
}
