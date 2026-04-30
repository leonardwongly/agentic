import { mkdtemp } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { SYSTEM_USER_ID } from "@agentic/contracts";
import { createJobRecord } from "@agentic/execution";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { GET as jobEventsRoute } from "../apps/web/app/api/jobs/[id]/events/route";
import { buildAuthorizedGetRequest, createRouteTestRepository, expectBaseSecurityHeaders } from "./route-test-helpers";

describe("job event stream route", () => {
  const originalAccessKey = process.env.AGENTIC_ACCESS_KEY;
  const originalRuntimeStorePath = process.env.AGENTIC_RUNTIME_STORE_PATH;

  beforeEach(async () => {
    process.env.AGENTIC_ACCESS_KEY = "test-access-key";
    process.env.AGENTIC_RUNTIME_STORE_PATH = path.join(
      await mkdtemp(path.join(os.tmpdir(), "agentic-job-events-route-")),
      "runtime-store.json"
    );
    Reflect.set(globalThis, "__agenticRepository", undefined);
  });

  afterEach(() => {
    process.env.AGENTIC_ACCESS_KEY = originalAccessKey;
    process.env.AGENTIC_RUNTIME_STORE_PATH = originalRuntimeStorePath;
    Reflect.set(globalThis, "__agenticRepository", undefined);
  });

  it("rejects unauthenticated job event streams before exposing job state", async () => {
    const response = await jobEventsRoute(new Request("http://localhost/api/jobs/job-1/events"), {
      params: Promise.resolve({ id: "job-1" })
    });
    const payload = (await response.json()) as { error: string };

    expect(response.status).toBe(401);
    expect(payload.error).toBe("Unauthorized. Create a session before calling the Agentic API.");
  });

  it("streams an authenticated terminal job snapshot and closes", async () => {
    const repository = createRouteTestRepository();
    await repository.seedDefaults(SYSTEM_USER_ID);
    const now = "2026-04-29T00:00:00.000Z";
    const queuedJob = createJobRecord({
      userId: SYSTEM_USER_ID,
      kind: "docs_render",
      payload: {
        type: "docs_render",
        metadata: {}
      },
      availableAt: now
    });
    const completedJob = {
      ...queuedJob,
      status: "completed" as const,
      completedAt: now,
      updatedAt: now
    };
    await repository.enqueueJob(completedJob);

    const response = await jobEventsRoute(
      buildAuthorizedGetRequest(`http://localhost/api/jobs/${completedJob.id}/events?timeoutMs=1000`),
      {
        params: Promise.resolve({ id: completedJob.id })
      }
    );
    const text = await response.text();

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("text/event-stream");
    expect(response.headers.get("cache-control")).toBe("no-cache, no-transform");
    expectBaseSecurityHeaders(response);
    expect(text).toContain("event: job.snapshot");
    expect(text).toContain(`"id":"${completedJob.id}"`);
    expect(text).toContain('"status":"completed"');
    expect(text).toContain('"terminal":true');
  });

  it("does not stream jobs that are absent or outside the authenticated scope", async () => {
    const repository = createRouteTestRepository();
    await repository.seedDefaults(SYSTEM_USER_ID);

    const response = await jobEventsRoute(
      buildAuthorizedGetRequest("http://localhost/api/jobs/missing-job/events?timeoutMs=1000"),
      {
        params: Promise.resolve({ id: "missing-job" })
      }
    );
    const payload = (await response.json()) as { error: string };

    expect(response.status).toBe(404);
    expect(payload.error).toBe("Job missing-job was not found.");
  });
});
