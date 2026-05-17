import { operationalJson, withApiTelemetry } from "../../../lib/api-response";
import { getWebReadinessReport } from "../../../lib/runtime-readiness";

export async function GET(request: Request) {
  return withApiTelemetry(request, "api.ready.read", async () => {
    const report = await getWebReadinessReport();

    return operationalJson(
      {
        ok: report.ok,
        status: report.status,
        generatedAt: report.generatedAt,
        details: "/api/ready/details"
      },
      {
        status: report.ok ? 200 : 503
      }
    );
  });
}
