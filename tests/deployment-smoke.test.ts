import { describe, expect, it, vi } from "vitest";
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
  it("passes health and readiness checks without a session login", async () => {
    const fetchImpl = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(buildJsonResponse({ status: "live" }))
      .mockResolvedValueOnce(buildJsonResponse({ ok: true, status: "ready" }));

    await expect(
      runDeploymentSmoke({
        baseUrl: "http://127.0.0.1:3301/",
        fetchImpl
      })
    ).resolves.toEqual({
      healthStatus: "live",
      readinessStatus: "ready",
      sessionChecked: false
    });

    expect(fetchImpl).toHaveBeenCalledTimes(2);
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
        fetchImpl
      })
    ).resolves.toEqual({
      healthStatus: "live",
      readinessStatus: "ready",
      sessionChecked: true
    });

    expect(fetchImpl.mock.calls[2]?.[0]).toBe("http://127.0.0.1:3301/api/session");
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
