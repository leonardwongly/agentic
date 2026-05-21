import { describe, expect, it, vi } from "vitest";
import { spawnSync } from "node:child_process";
import { runDeploymentSmoke } from "../scripts/lib/deployment-smoke";

function buildJsonResponse(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: {
      "content-type": "application/json"
    }
  });
}

describe("deployment smoke", () => {
  it("prints operator help without running live smoke checks", () => {
    const result = spawnSync(process.execPath, ["--import", "tsx", "scripts/deployment-smoke.ts", "--help"], {
      cwd: process.cwd(),
      encoding: "utf8"
    });

    expect(result.status).toBe(0);
    expect(result.stdout).toContain("Usage: npm run test:smoke:deployment -- [--json]");
    expect(result.stdout).toContain("AGENTIC_SMOKE_BASE_URL");
    expect(result.stdout).toContain("AGENTIC_DEPLOYMENT_SMOKE_JSON");
    expect(result.stderr).toBe("");
  });

  it("passes health and readiness checks without a session login", async () => {
    const fetchImpl = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(buildJsonResponse({ status: "live" }))
      .mockResolvedValueOnce(buildJsonResponse({ ok: true, status: "ready" }));

    await expect(
      runDeploymentSmoke({
        baseUrl: "http://127.0.0.1:3301/",
        requestId: "smoke-request-1",
        traceId: "smoke-trace-1",
        fetchImpl
      })
    ).resolves.toMatchObject({
      healthStatus: "live",
      readinessStatus: "ready",
      sessionChecked: false,
      requestId: "smoke-request-1",
      traceId: "smoke-trace-1",
      checks: [
        expect.objectContaining({ name: "health", status: 200 }),
        expect.objectContaining({ name: "readiness", status: 200 })
      ]
    });

    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(fetchImpl).toHaveBeenNthCalledWith(
      1,
      "http://127.0.0.1:3301/api/health",
      expect.objectContaining({
        headers: expect.objectContaining({
          "x-request-id": "smoke-request-1",
          "x-trace-id": "smoke-trace-1"
        })
      })
    );
  });

  it("performs a session login when a smoke access key is configured", async () => {
    const fetchImpl = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(buildJsonResponse({ status: "live" }))
      .mockResolvedValueOnce(buildJsonResponse({ ok: true, status: "ready" }))
      .mockResolvedValueOnce(buildJsonResponse({ ok: true }));

    await expect(
      runDeploymentSmoke({
        baseUrl: "http://127.0.0.1:3301",
        accessKey: "smoke-key",
        requestId: "smoke-request-session",
        traceId: "smoke-trace-session",
        fetchImpl
      })
    ).resolves.toMatchObject({
      healthStatus: "live",
      readinessStatus: "ready",
      sessionChecked: true,
      requestId: "smoke-request-session",
      traceId: "smoke-trace-session",
      checks: [
        expect.objectContaining({ name: "health", status: 200 }),
        expect.objectContaining({ name: "readiness", status: 200 }),
        expect.objectContaining({ name: "session", status: 200 })
      ]
    });

    expect(fetchImpl.mock.calls[2]?.[0]).toBe("http://127.0.0.1:3301/api/session");
    expect(fetchImpl.mock.calls[2]?.[1]).toEqual(
      expect.objectContaining({
        headers: expect.objectContaining({
          "x-request-id": "smoke-request-session",
          "x-trace-id": "smoke-trace-session"
        })
      })
    );
  });

  it("fails when the readiness payload is not ready", async () => {
    const fetchImpl = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(buildJsonResponse({ status: "live" }))
      .mockResolvedValueOnce(buildJsonResponse({ ok: false, status: "not_ready" }));

    await expect(
      runDeploymentSmoke({
        baseUrl: "http://127.0.0.1:3301",
        fetchImpl
      })
    ).rejects.toThrow("Readiness check failed.");
  });

  it("fails when a smoke endpoint returns malformed JSON", async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValueOnce(
      new Response("not-json", {
        status: 200,
        headers: {
          "content-type": "application/json"
        }
      })
    );

    await expect(
      runDeploymentSmoke({
        baseUrl: "http://127.0.0.1:3301",
        fetchImpl
      })
    ).rejects.toThrow("Deployment smoke received an invalid JSON response:");
  });
});
