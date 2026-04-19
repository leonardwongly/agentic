import { afterEach, describe, expect, it, vi } from "vitest";
import {
  buildClientIdempotencyKey,
  pollJobStatusUntilSettled,
  readJson
} from "../apps/web/components/dashboard-async";

describe("dashboard async helpers", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("returns parsed payloads for successful responses", async () => {
    const response = new Response(JSON.stringify({ ok: true, value: 7 }), {
      status: 200,
      headers: {
        "content-type": "application/json"
      }
    });

    await expect(readJson<{ ok: boolean; value: number }>(response)).resolves.toEqual({
      ok: true,
      value: 7
    });
  });

  it("surfaces API error messages for failed responses", async () => {
    const response = new Response(JSON.stringify({ error: "Queue lease expired." }), {
      status: 409,
      headers: {
        "content-type": "application/json"
      }
    });

    await expect(readJson(response)).rejects.toThrow("Queue lease expired.");
  });

  it("uses crypto.randomUUID when it is available for client idempotency keys", () => {
    vi.stubGlobal("crypto", {
      randomUUID: () => "dashboard-client-key-123"
    });

    expect(buildClientIdempotencyKey()).toBe("dashboard-client-key-123");
  });

  it("polls until a job reaches a terminal state", async () => {
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            job: { status: "running" },
            error: null
          }),
          {
            status: 200,
            headers: {
              "content-type": "application/json"
            }
          }
        )
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            job: { status: "completed" },
            error: null
          }),
          {
            status: 200,
            headers: {
              "content-type": "application/json"
            }
          }
        )
      );

    const payload = await pollJobStatusUntilSettled<{ job: { status: "running" | "completed" }; error: null }>(
      "/api/goals/jobs/job-123",
      {
        fetchImpl,
        pollIntervalMs: 0,
        timeoutMs: 10
      }
    );

    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(payload).toEqual({
      job: { status: "completed" },
      error: null
    });
  });

  it("returns null when the polling window is exhausted before the first request", async () => {
    const fetchImpl = vi.fn<typeof fetch>();

    const payload = await pollJobStatusUntilSettled("/api/goals/jobs/job-timeout", {
      fetchImpl,
      timeoutMs: 0
    });

    expect(payload).toBeNull();
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});
