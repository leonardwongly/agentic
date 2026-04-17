import { operationalJson, withApiTelemetry } from "../../../lib/api-response";

export async function GET(request: Request) {
  return withApiTelemetry(request, "api.health.read", async () =>
    operationalJson({
      status: "live",
      uptimeSeconds: Math.max(0, Math.floor(process.uptime())),
      timestamp: new Date().toISOString()
    })
  );
}

