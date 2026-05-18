import { mkdtemp } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { ProviderCredentialSchema, SYSTEM_USER_ID, createSystemActorContext, nowIso } from "@agentic/contracts";
import { createJobRecord } from "@agentic/execution";
import { processUserRequest } from "@agentic/orchestrator";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { GET as dashboardEventsRoute } from "../apps/web/app/api/dashboard/events/route";
import { buildDashboardEventBatch } from "../apps/web/lib/dashboard-events";
import {
  buildAuthorizedGetRequest,
  createRouteTestRepository,
  expectAuthenticatedStreamHeaders,
  expectNoStoreHeaders
} from "./route-test-helpers";

describe("dashboard events route", () => {
  const originalAccessKey = process.env.AGENTIC_ACCESS_KEY;
  const originalRuntimeStorePath = process.env.AGENTIC_RUNTIME_STORE_PATH;

  beforeEach(async () => {
    process.env.AGENTIC_ACCESS_KEY = "test-access-key";
    process.env.AGENTIC_RUNTIME_STORE_PATH = path.join(
      await mkdtemp(path.join(os.tmpdir(), "agentic-dashboard-events-route-")),
      "runtime-store.json"
    );
    Reflect.set(globalThis, "__agenticRepository", undefined);
  });

  afterEach(() => {
    process.env.AGENTIC_ACCESS_KEY = originalAccessKey;
    process.env.AGENTIC_RUNTIME_STORE_PATH = originalRuntimeStorePath;
    Reflect.set(globalThis, "__agenticRepository", undefined);
  });

  it("rejects unauthenticated dashboard event streams", async () => {
    const response = await dashboardEventsRoute(new Request("http://localhost/api/dashboard/events"));
    const payload = (await response.json()) as { error: string };

    expect(response.status).toBe(401);
    expectNoStoreHeaders(response);
    expect(payload.error).toBe("Unauthorized. Create a session before calling the Agentic API.");
  });

  it("streams scoped dashboard events without leaking another user's jobs", async () => {
    const repository = createRouteTestRepository();
    await repository.seedDefaults(SYSTEM_USER_ID);
    const bundle = await processUserRequest({
      userId: SYSTEM_USER_ID,
      request: "Review my inbox and draft an external response.",
      memories: await repository.listMemory(SYSTEM_USER_ID),
      integrations: await repository.listIntegrations(SYSTEM_USER_ID)
    });
    await repository.saveGoalBundle(bundle);
    const job = createJobRecord({
      userId: SYSTEM_USER_ID,
      kind: "docs_render",
      payload: {
        type: "docs_render",
        metadata: {}
      },
      availableAt: nowIso()
    });
    const hiddenJob = createJobRecord({
      userId: "other-user",
      kind: "docs_render",
      payload: {
        type: "docs_render",
        metadata: {}
      },
      availableAt: nowIso()
    });
    await repository.enqueueJob(job);
    await repository.enqueueJob(hiddenJob);
    await repository.saveProviderCredential(
      ProviderCredentialSchema.parse({
        id: "google:global:dashboard-events",
        userId: SYSTEM_USER_ID,
        workspaceId: null,
        provider: "google",
        accountId: "dashboard-events",
        accountEmail: "events@example.com",
        displayName: "Events Test",
        status: "refresh_failed",
        scopes: ["https://www.googleapis.com/auth/gmail.modify"],
        lastValidatedAt: nowIso(),
        lastRefreshFailureAt: nowIso(),
        metadata: {},
        actorContext: createSystemActorContext(SYSTEM_USER_ID),
        createdAt: nowIso(),
        updatedAt: nowIso()
      })
    );

    Reflect.set(globalThis, "__agenticRepository", undefined);

    const response = await dashboardEventsRoute(
      buildAuthorizedGetRequest("http://localhost/api/dashboard/events?timeoutMs=1000&pollMs=1000")
    );
    const text = await response.text();

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("text/event-stream");
    expectAuthenticatedStreamHeaders(response);
    expect(text).toContain("event: dashboard.events");
    expect(text).toContain('"kind":"approval.created"');
    expect(text).toContain('"kind":"job.created"');
    expect(text).toContain('"kind":"connector.updated"');
    expect(text).toContain(job.id);
    expect(text).not.toContain(hiddenJob.id);
  });

  it("bounds burst batches with monotonic sequence ids for client dedupe", async () => {
    const repository = createRouteTestRepository();
    await repository.seedDefaults(SYSTEM_USER_ID);
    const dashboard = await repository.getDashboardData(SYSTEM_USER_ID);
    const jobs = Array.from({ length: 125 }, (_, index) =>
      createJobRecord({
        userId: SYSTEM_USER_ID,
        kind: "docs_render",
        payload: {
          type: "docs_render",
          metadata: {}
        },
        availableAt: `2026-05-06T00:${String(index % 60).padStart(2, "0")}:00.000Z`
      })
    );

    const batch = buildDashboardEventBatch({
      dashboard,
      jobs,
      principalUserId: SYSTEM_USER_ID,
      lastEventId: 9,
      observedAt: "2026-05-06T01:00:00.000Z",
      limit: 25
    });

    expect(batch.events).toHaveLength(25);
    expect(batch.events[0]?.sequence).toBe(10);
    expect(batch.events.at(-1)?.sequence).toBe(34);
    expect(new Set(batch.events.map((event) => event.id)).size).toBe(25);
  });
});
