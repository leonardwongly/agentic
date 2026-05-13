import { vi } from "vitest";
import {
  buildAuthorizedGetRequest,
  expectNoStoreHeaders,
  expectOperationalNoStoreHeaders
} from "./route-test-helpers";

const { getWebReadinessReportMock } = vi.hoisted(() => ({
  getWebReadinessReportMock: vi.fn()
}));

vi.mock("../apps/web/lib/runtime-readiness", () => ({
  getWebReadinessReport: getWebReadinessReportMock
}));

import { GET as healthRoute } from "../apps/web/app/api/health/route";
import { GET as readyRoute } from "../apps/web/app/api/ready/route";
import { GET as readyDetailsRoute } from "../apps/web/app/api/ready/details/route";

describe("operational routes", () => {
  const originalAccessKey = process.env.AGENTIC_ACCESS_KEY;

  beforeEach(() => {
    process.env.AGENTIC_ACCESS_KEY = "test-access-key";
  });

  afterEach(() => {
    process.env.AGENTIC_ACCESS_KEY = originalAccessKey;
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

  it("returns a minimal ready report with HTTP 200", async () => {
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
      details: string;
      checks?: unknown;
      runtime?: unknown;
      storageBackend?: unknown;
    };

    expect(response.status).toBe(200);
    expect(payload).toMatchObject({
      ok: true,
      status: "ready",
      details: "/api/ready/details"
    });
    expect(payload.checks).toBeUndefined();
    expect(payload.runtime).toBeUndefined();
    expect(payload.storageBackend).toBeUndefined();
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
      checks?: unknown;
    };

    expect(response.status).toBe(503);
    expect(payload).toMatchObject({
      ok: false,
      status: "not_ready"
    });
    expect(payload.checks).toBeUndefined();
    expectOperationalNoStoreHeaders(response);
  });

  it("requires authentication for detailed readiness diagnostics", async () => {
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

    const unauthorized = await readyDetailsRoute(new Request("http://localhost/api/ready/details"));
    const authorized = await readyDetailsRoute(buildAuthorizedGetRequest("http://localhost/api/ready/details"));
    const authorizedPayload = (await authorized.json()) as {
      checks: Array<{ name: string; status: string }>;
    };

    expect(unauthorized.status).toBe(401);
    expect(authorized.status).toBe(200);
    expect(authorizedPayload.checks).toContainEqual(
      expect.objectContaining({
        name: "connector_health",
        status: "pass"
      })
    );
    expectNoStoreHeaders(authorized);
  });
});
