import { vi } from "vitest";
import { expectOperationalNoStoreHeaders } from "./route-test-helpers";

const { getWebReadinessReportMock } = vi.hoisted(() => ({
  getWebReadinessReportMock: vi.fn()
}));

vi.mock("../apps/web/lib/runtime-readiness", () => ({
  getWebReadinessReport: getWebReadinessReportMock
}));

import { GET as healthRoute } from "../apps/web/app/api/health/route";
import { GET as readyRoute } from "../apps/web/app/api/ready/route";

describe("operational routes", () => {
  afterEach(() => {
    getWebReadinessReportMock.mockReset();
  });

  it("returns liveness without authentication", async () => {
    const response = await healthRoute(new Request("http://localhost/api/health"));
    const payload = (await response.json()) as {
      status: string;
      uptimeSeconds: number;
      timestamp: string;
    };

    expect(response.status).toBe(200);
    expect(payload.status).toBe("live");
    expect(payload.uptimeSeconds).toBeGreaterThanOrEqual(0);
    expect(Number.isNaN(Date.parse(payload.timestamp))).toBe(false);
    expectOperationalNoStoreHeaders(response);
  });

  it("returns a ready report with HTTP 200", async () => {
    getWebReadinessReportMock.mockResolvedValue({
      ok: true,
      status: "ready",
      runtime: "production",
      storageBackend: "postgres",
      generatedAt: "2026-04-17T00:00:00.000Z",
      checks: [
        {
          name: "connector_health",
          status: "pass",
          message: "Connector health checks passed."
        }
      ]
    });

    const response = await readyRoute(new Request("http://localhost/api/ready"));
    const payload = (await response.json()) as {
      ok: boolean;
      status: string;
      checks: Array<{ name: string; status: string }>;
    };

    expect(response.status).toBe(200);
    expect(payload).toMatchObject({
      ok: true,
      status: "ready"
    });
    expect(payload.checks).toContainEqual(
      expect.objectContaining({
        name: "connector_health",
        status: "pass"
      })
    );
    expectOperationalNoStoreHeaders(response);
  });

  it("returns service unavailable when readiness fails", async () => {
    getWebReadinessReportMock.mockResolvedValue({
      ok: false,
      status: "not_ready",
      runtime: "production",
      storageBackend: "postgres",
      generatedAt: "2026-04-17T00:00:00.000Z",
      checks: [
        {
          name: "database",
          status: "fail",
          message: "Database schema is not ready for application startup."
        }
      ]
    });

    const response = await readyRoute(new Request("http://localhost/api/ready"));
    const payload = (await response.json()) as {
      ok: boolean;
      status: string;
      checks: Array<{ name: string; status: string }>;
    };

    expect(response.status).toBe(503);
    expect(payload).toMatchObject({
      ok: false,
      status: "not_ready"
    });
    expect(payload.checks).toContainEqual(
      expect.objectContaining({
        name: "database",
        status: "fail"
      })
    );
    expectOperationalNoStoreHeaders(response);
  });
});
