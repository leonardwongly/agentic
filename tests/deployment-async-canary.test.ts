import { describe, expect, it, vi } from "vitest";
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
      fetchImpl,
      wait
    });

    expect(summary).toEqual({
      jobId: "job-1",
      attempts: 2,
      statusUrl: "https://agentic.example.com/api/goals/jobs/job-1"
    });

    expect(fetchImpl).toHaveBeenNthCalledWith(
      1,
      "https://agentic.example.com/api/goals",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({
          [AGENTIC_ACCESS_KEY_HEADER]: "test-access-key",
          "x-idempotency-key": "deploy-canary:test"
        })
      })
    );
    expect(fetchImpl).toHaveBeenNthCalledWith(
      2,
      "https://agentic.example.com/api/goals/jobs/job-1",
      expect.objectContaining({
        headers: expect.objectContaining({
          [AGENTIC_ACCESS_KEY_HEADER]: "test-access-key"
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
});
