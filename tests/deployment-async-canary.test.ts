import { describe, expect, it, vi } from "vitest";
import { spawnSync } from "node:child_process";
import { AGENTIC_ACCESS_KEY_HEADER } from "../apps/web/lib/auth";
import { runDeploymentAsyncCanary } from "../scripts/lib/deployment-async-canary";

function jsonResponse(status: number, payload: unknown) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: {
      "content-type": "application/json"
    }
  });
}

describe("deployment async canary", () => {
  it("prints operator help without running live canary calls", () => {
    const result = spawnSync(process.execPath, ["--import", "tsx", "scripts/deployment-async-canary.ts", "--help"], {
      cwd: process.cwd(),
      encoding: "utf8"
    });

    expect(result.status).toBe(0);
    expect(result.stdout).toContain("Usage: npm run test:smoke:deployment-async -- [--json]");
    expect(result.stdout).toContain("AGENTIC_SMOKE_ACCESS_KEY");
    expect(result.stdout).toContain("AGENTIC_DEPLOYMENT_ASYNC_CANARY_JSON");
    expect(result.stderr).toBe("");
  });

  it("proves queued work reaches durable completion", async () => {
    const fetchImpl = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(
        jsonResponse(202, {
          job: { id: "job-1", status: "queued" },
          statusUrl: "/api/goals/jobs/job-1"
        })
      )
      .mockResolvedValueOnce(
        jsonResponse(202, {
          job: { id: "job-1", status: "running" },
          result: null,
          error: null
        })
      )
      .mockResolvedValueOnce(
        jsonResponse(200, {
          job: { id: "job-1", status: "completed" },
          result: { goalId: "goal-1" },
          error: null
        })
      );
    const wait = vi.fn(async () => undefined);

    const summary = await runDeploymentAsyncCanary({
      baseUrl: "https://agentic.example.com/",
      accessKey: "test-access-key",
      pollIntervalMs: 10,
      timeoutMs: 30,
      idempotencyKey: "deploy-canary:test",
      requestId: "canary-request-1",
      traceId: "canary-trace-1",
      fetchImpl,
      wait
    });

    expect(summary).toMatchObject({
      jobId: "job-1",
      attempts: 2,
      statusUrl: "https://agentic.example.com/api/goals/jobs/job-1",
      requestId: "canary-request-1",
      traceId: "canary-trace-1",
      idempotencyKey: "deploy-canary:test",
      enqueueDurationMs: expect.any(Number),
      pollDurationMs: expect.any(Number)
    });

    expect(fetchImpl).toHaveBeenNthCalledWith(
      1,
      "https://agentic.example.com/api/goals",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({
          [AGENTIC_ACCESS_KEY_HEADER]: "test-access-key",
          "x-idempotency-key": "deploy-canary:test",
          "x-request-id": "canary-request-1",
          "x-trace-id": "canary-trace-1"
        })
      })
    );
    expect(fetchImpl).toHaveBeenNthCalledWith(
      2,
      "https://agentic.example.com/api/goals/jobs/job-1",
      expect.objectContaining({
        headers: expect.objectContaining({
          [AGENTIC_ACCESS_KEY_HEADER]: "test-access-key",
          "x-request-id": "canary-request-1",
          "x-trace-id": "canary-trace-1"
        })
      })
    );
    expect(wait).toHaveBeenCalledTimes(1);
  });

  it("fails when the deployed worker dead-letters the canary job", async () => {
    const fetchImpl = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(
        jsonResponse(202, {
          job: { id: "job-2", status: "queued" },
          statusUrl: "/api/goals/jobs/job-2"
        })
      )
      .mockResolvedValueOnce(
        jsonResponse(200, {
          job: { id: "job-2", status: "dead_letter" },
          result: null,
          error: "Goal creation failed. Retry the request or inspect worker logs."
        })
      );

    await expect(
      runDeploymentAsyncCanary({
        baseUrl: "https://agentic.example.com",
        accessKey: "test-access-key",
        pollIntervalMs: 10,
        timeoutMs: 20,
        fetchImpl,
        wait: async () => undefined
      })
    ).rejects.toThrow("Goal creation failed. Retry the request or inspect worker logs.");
  });

  it("fails when the canary never settles before the timeout budget", async () => {
    const fetchImpl = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(
        jsonResponse(202, {
          job: { id: "job-3", status: "queued" },
          statusUrl: "/api/goals/jobs/job-3"
        })
      )
      .mockImplementation(async () =>
        jsonResponse(202, {
          job: { id: "job-3", status: "running" },
          result: null,
          error: null
        })
      );

    await expect(
      runDeploymentAsyncCanary({
        baseUrl: "https://agentic.example.com",
        accessKey: "test-access-key",
        pollIntervalMs: 10,
        timeoutMs: 20,
        fetchImpl,
        wait: async () => undefined
      })
    ).rejects.toThrow("Deployment async canary timed out after 2 poll attempt(s).");
  });

  it("rejects invalid configuration before making network calls", async () => {
    const fetchImpl = vi.fn<typeof fetch>();

    await expect(
      runDeploymentAsyncCanary({
        baseUrl: "   ",
        accessKey: "test-access-key",
        fetchImpl
      })
    ).rejects.toThrow("AGENTIC_SMOKE_BASE_URL must be configured.");
    await expect(
      runDeploymentAsyncCanary({
        baseUrl: "https://agentic.example.com",
        accessKey: "   ",
        fetchImpl
      })
    ).rejects.toThrow("AGENTIC_SMOKE_ACCESS_KEY must be configured.");
    await expect(
      runDeploymentAsyncCanary({
        baseUrl: "https://agentic.example.com",
        accessKey: "test-access-key",
        timeoutMs: 0,
        fetchImpl
      })
    ).rejects.toThrow("timeoutMs must be a positive number.");
    await expect(
      runDeploymentAsyncCanary({
        baseUrl: "https://agentic.example.com",
        accessKey: "test-access-key",
        requestText: "x".repeat(2_001),
        fetchImpl
      })
    ).rejects.toThrow("Deployment async canary request must be 2,000 characters or fewer.");

    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("fails when the enqueue response is malformed", async () => {
    const fetchImpl = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(
        new Response("not-json", {
          status: 202,
          headers: {
            "content-type": "application/json"
          }
        })
      );

    await expect(
      runDeploymentAsyncCanary({
        baseUrl: "https://agentic.example.com",
        accessKey: "test-access-key",
        fetchImpl
      })
    ).rejects.toThrow("Deployment async canary received an invalid JSON response:");
  });

  it("fails when the enqueue response omits the status URL", async () => {
    const fetchImpl = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(
        jsonResponse(202, {
          job: { id: "job-4", status: "queued" }
        })
      );

    await expect(
      runDeploymentAsyncCanary({
        baseUrl: "https://agentic.example.com",
        accessKey: "test-access-key",
        fetchImpl
      })
    ).rejects.toThrow("Goal enqueue response did not include a status URL.");
  });

  it("fails when the polled job response returns an unexpected status", async () => {
    const fetchImpl = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(
        jsonResponse(202, {
          job: { id: "job-5", status: "queued" },
          statusUrl: "/api/goals/jobs/job-5"
        })
      )
      .mockResolvedValueOnce(
        jsonResponse(500, {
          job: { id: "job-5", status: "running" },
          result: null,
          error: "worker degraded"
        })
      );

    await expect(
      runDeploymentAsyncCanary({
        baseUrl: "https://agentic.example.com",
        accessKey: "test-access-key",
        fetchImpl,
        wait: async () => undefined
      })
    ).rejects.toThrow(
      "Deployment async canary observed an unexpected job response: status=500, jobStatus=running."
    );
  });

  it("fails when a completed canary omits the result payload", async () => {
    const fetchImpl = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(
        jsonResponse(202, {
          job: { id: "job-6", status: "queued" },
          statusUrl: "/api/goals/jobs/job-6"
        })
      )
      .mockResolvedValueOnce(
        jsonResponse(200, {
          job: { id: "job-6", status: "completed" },
          result: null,
          error: null
        })
      );

    await expect(
      runDeploymentAsyncCanary({
        baseUrl: "https://agentic.example.com",
        accessKey: "test-access-key",
        fetchImpl,
        wait: async () => undefined
      })
    ).rejects.toThrow("Completed goal canary did not include a result payload.");
  });
});
