import { afterEach, describe, expect, it, vi } from "vitest";
import {
  buildClientIdempotencyKey,
  connectDashboardEventStream,
  createInitialDashboardEventStreamState,
  deriveDashboardFreshnessState,
  pollJobStatusUntilSettled,
  readJson
} from "../apps/web/components/dashboard-async";

class FakeEventSource {
  static instances: FakeEventSource[] = [];

  readonly listeners = new Map<string, Array<(event: Event) => void>>();
  closed = false;

  constructor(readonly url: string) {
    FakeEventSource.instances.push(this);
  }

  addEventListener(type: string, listener: EventListenerOrEventListenerObject) {
    const callback =
      typeof listener === "function" ? listener : (event: Event) => listener.handleEvent(event);
    this.listeners.set(type, [...(this.listeners.get(type) ?? []), callback]);
  }

  close() {
    this.closed = true;
  }

  emit(type: string, data?: unknown) {
    for (const listener of this.listeners.get(type) ?? []) {
      listener({ data: JSON.stringify(data) } as MessageEvent);
    }
  }
}

describe("dashboard async helpers", () => {
  afterEach(() => {
    FakeEventSource.instances = [];
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
        timeoutMs: 10,
        preferEventStream: false
      }
    );

    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(payload).toEqual({
      job: { status: "completed" },
      error: null
    });
  });

  it("subscribes to job event streams and reads the final typed payload after a terminal event", async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(
        JSON.stringify({
          job: { status: "completed" },
          result: { goalId: "goal-1" },
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
    const payloadPromise = pollJobStatusUntilSettled<{
      job: { status: "running" | "completed" };
      result: { goalId: string } | null;
      error: null;
    }>("/api/templates/jobs/job-123", {
      fetchImpl,
      eventSourceFactory: (url) => new FakeEventSource(url),
      timeoutMs: 1_000
    });

    expect(FakeEventSource.instances[0]?.url).toBe("/api/jobs/job-123/events");
    FakeEventSource.instances[0]?.emit("job.snapshot", {
      job: { status: "running" }
    });
    FakeEventSource.instances[0]?.emit("job.snapshot", {
      job: { status: "completed" }
    });

    await expect(payloadPromise).resolves.toEqual({
      job: { status: "completed" },
      result: { goalId: "goal-1" },
      error: null
    });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(FakeEventSource.instances[0]?.closed).toBe(true);
  });

  it("falls back to polling when the event stream errors", async () => {
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ job: { status: "running" }, error: null }), {
          status: 200,
          headers: { "content-type": "application/json" }
        })
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ job: { status: "completed" }, error: null }), {
          status: 200,
          headers: { "content-type": "application/json" }
        })
      );
    const payloadPromise = pollJobStatusUntilSettled<{
      job: { status: "running" | "completed" };
      error: null;
    }>("/api/docs/jobs/job-456", {
      fetchImpl,
      eventSourceFactory: (url) => new FakeEventSource(url),
      pollIntervalMs: 0,
      timeoutMs: 1_000
    });

    FakeEventSource.instances[0]?.emit("error");

    await expect(payloadPromise).resolves.toEqual({
      job: { status: "completed" },
      error: null
    });
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it("tracks dashboard event stream freshness and falls back after stale reconnects", () => {
    const states: string[] = [];
    const batches: unknown[] = [];
    const close = connectDashboardEventStream({
      eventSourceFactory: (url) => new FakeEventSource(url),
      now: () => 1_000,
      onBatch: (batch) => batches.push(batch),
      onFreshnessChange: (state) => states.push(state.freshness)
    });

    expect(FakeEventSource.instances[0]?.url).toBe("/api/dashboard/events");
    FakeEventSource.instances[0]?.emit("dashboard.events", {
      schemaVersion: 1,
      principalUserId: "system",
      workspaceId: null,
      observedAt: "2026-05-06T00:00:00.000Z",
      freshness: {
        state: "live",
        staleAfterMs: 5_000,
        fallbackAfterMs: 10_000
      },
      events: [
        {
          schemaVersion: 1,
          sequence: 7,
          id: "7",
          kind: "job.updated",
          domain: "job",
          principalUserId: "system",
          workspaceId: null,
          resourceId: "job-1",
          summary: "Job updated.",
          severity: "info",
          observedAt: "2026-05-06T00:00:00.000Z",
          updatedAt: "2026-05-06T00:00:00.000Z",
          dedupeKey: "job.updated:personal:job-1",
          target: null,
          metadata: {}
        }
      ]
    });
    FakeEventSource.instances[0]?.emit("dashboard.events", {
      schemaVersion: 1,
      principalUserId: "system",
      workspaceId: null,
      observedAt: "2026-05-06T00:00:00.000Z",
      freshness: {
        state: "live",
        staleAfterMs: 5_000,
        fallbackAfterMs: 10_000
      },
      events: [
        {
          schemaVersion: 1,
          sequence: 7,
          id: "7",
          kind: "job.updated",
          domain: "job",
          principalUserId: "system",
          workspaceId: null,
          resourceId: "job-1",
          summary: "Job updated.",
          severity: "info",
          observedAt: "2026-05-06T00:00:00.000Z",
          updatedAt: "2026-05-06T00:00:00.000Z",
          dedupeKey: "job.updated:personal:job-1",
          target: null,
          metadata: {}
        }
      ]
    });
    FakeEventSource.instances[0]?.emit("error");

    close();

    expect(batches).toHaveLength(1);
    expect(states).toContain("live");
    expect(states).toContain("reconnecting");
    expect(FakeEventSource.instances[0]?.closed).toBe(true);
    expect(
      deriveDashboardFreshnessState(
        {
          ...createInitialDashboardEventStreamState(),
          freshness: "live",
          lastEventAt: 1_000
        },
        12_000,
        5_000,
        10_000
      )
    ).toBe("fallback");
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
