import { vi } from "vitest";
import { expectOperationalNoStoreHeaders } from "./route-test-helpers";

const { getPublicWebReadinessSummaryMock, getWebReadinessReportMock } = vi.hoisted(() => ({
  getPublicWebReadinessSummaryMock: vi.fn(),
  getWebReadinessReportMock: vi.fn()
}));

vi.mock("../apps/web/lib/runtime-readiness", () => ({
  getPublicWebReadinessSummary: getPublicWebReadinessSummaryMock,
  getWebReadinessReport: getWebReadinessReportMock
}));

import { GET as healthRoute } from "../apps/web/app/api/health/route";
import { GET as readyDetailsRoute } from "../apps/web/app/api/ready/details/route";
import { GET as readyRoute } from "../apps/web/app/api/ready/route";

describe("operational routes", () => {
  const originalAccessKey = process.env.AGENTIC_ACCESS_KEY;

  afterEach(() => {
    getPublicWebReadinessSummaryMock.mockReset();
    getWebReadinessReportMock.mockReset();
    process.env.AGENTIC_ACCESS_KEY = originalAccessKey;
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
    getPublicWebReadinessSummaryMock.mockResolvedValue({
      ok: true,
      status: "ready",
      generatedAt: "2026-04-17T00:00:00.000Z",
      details: "/api/ready/details"
    });

    const response = await readyRoute(new Request("http://localhost/api/ready"));
    const payload = (await response.json()) as {
      ok: boolean;
      status: string;
      generatedAt: string;
      details: string;
      checks?: Array<{ name: string; status: string }>;
    };

    expect(response.status).toBe(200);
    expect(payload).toMatchObject({
      ok: true,
      status: "ready",
      generatedAt: "2026-04-17T00:00:00.000Z",
      details: "/api/ready/details"
    });
    expect(payload.checks).toBeUndefined();
    expectOperationalNoStoreHeaders(response);
  });

  it("returns service unavailable when readiness fails", async () => {
    getPublicWebReadinessSummaryMock.mockResolvedValue({
      ok: false,
      status: "not_ready",
      generatedAt: "2026-04-17T00:00:00.000Z",
      details: "/api/ready/details"
    });

    const response = await readyRoute(new Request("http://localhost/api/ready"));
    const payload = (await response.json()) as {
      ok: boolean;
      status: string;
      generatedAt: string;
      details: string;
      checks?: Array<{ name: string; status: string }>;
    };

    expect(response.status).toBe(503);
    expect(payload).toMatchObject({
      ok: false,
      status: "not_ready",
      generatedAt: "2026-04-17T00:00:00.000Z",
      details: "/api/ready/details"
    });
    expect(payload.checks).toBeUndefined();
    expectOperationalNoStoreHeaders(response);
  });

  it("returns the detailed readiness report only for authenticated requests", async () => {
    process.env.AGENTIC_ACCESS_KEY = "test-access-key";
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

    const unauthenticated = await readyDetailsRoute(new Request("http://localhost/api/ready/details"));
    const authenticated = await readyDetailsRoute(
      new Request("http://localhost/api/ready/details", {
        headers: {
          "x-agentic-access-key": "test-access-key"
        }
      })
    );
    const payload = (await authenticated.json()) as {
      checks: Array<{ name: string; status: string }>;
    };

    expect(unauthenticated.status).toBe(401);
    expect(authenticated.status).toBe(200);
    expect(payload.checks).toContainEqual(
      expect.objectContaining({
        name: "connector_health",
        status: "pass"
      })
    );
  });
});
