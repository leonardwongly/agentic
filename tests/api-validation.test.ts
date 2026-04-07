import { mkdtemp } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { POST as approvalResponseRoute } from "../apps/web/app/api/approvals/[id]/respond/route";
import { POST as goalsRoute } from "../apps/web/app/api/goals/route";
import { POST as integrationsRoute } from "../apps/web/app/api/integrations/route";
import { POST as localNotesRoute } from "../apps/web/app/api/integrations/local-notes/route";
import { POST as memoryRoute } from "../apps/web/app/api/memory/route";
import { POST as sessionRoute } from "../apps/web/app/api/session/route";
import { POST as watchersRoute } from "../apps/web/app/api/watchers/route";
import { resetSessionUnlockRateLimit } from "../apps/web/lib/session-unlock-rate-limit";
import {
  buildAuthorizedJsonRequest,
  buildInvalidJsonRequest,
  expectNoStoreHeaders
} from "./route-test-helpers";

function buildJsonRequest(url: string, body: unknown, authenticated = true): Request {
  const headers = new Headers({
    "content-type": "application/json"
  });

  if (authenticated) {
    headers.set("x-agentic-access-key", "test-access-key");
  }

  return new Request(url, {
    method: "POST",
    headers,
    body: JSON.stringify(body)
  });
}

describe("api request validation", () => {
  const originalAccessKey = process.env.AGENTIC_ACCESS_KEY;
  const originalRuntimeStorePath = process.env.AGENTIC_RUNTIME_STORE_PATH;

  beforeEach(async () => {
    process.env.AGENTIC_ACCESS_KEY = "test-access-key";
    process.env.AGENTIC_RUNTIME_STORE_PATH = path.join(
      await mkdtemp(path.join(os.tmpdir(), "agentic-api-validation-")),
      "runtime-store.json"
    );
    Reflect.set(globalThis, "__agenticRepository", undefined);
  });

  afterEach(() => {
    process.env.AGENTIC_ACCESS_KEY = originalAccessKey;
    process.env.AGENTIC_RUNTIME_STORE_PATH = originalRuntimeStorePath;
    Reflect.set(globalThis, "__agenticRepository", undefined);
    resetSessionUnlockRateLimit();
  });

  it.each([
    [
      "session",
      () =>
        sessionRoute(
          buildJsonRequest("http://localhost/api/session", {
            accessKey: "test-access-key",
            extra: "nope"
          }, false)
        )
    ],
    [
      "goals",
      () =>
        goalsRoute(
          buildJsonRequest("http://localhost/api/goals", {
            request: "Plan my week",
            extra: "nope"
          })
        )
    ],
    [
      "memory",
      () =>
        memoryRoute(
          buildJsonRequest("http://localhost/api/memory", {
            category: "style",
            content: "Prefer concise answers.",
            extra: "nope"
          })
        )
    ],
    [
      "watchers",
      () =>
        watchersRoute(
          buildJsonRequest("http://localhost/api/watchers", {
            goalId: "goal-1",
            targetEntity: "priority-inbox",
            condition: "urgent thread appears",
            frequency: "hourly",
            triggerAction: "notify me",
            extra: "nope"
          })
        )
    ],
    [
      "integrations",
      () =>
        integrationsRoute(
          buildJsonRequest("http://localhost/api/integrations", {
            id: "local-notes",
            status: "ready",
            extra: "nope"
          })
        )
    ],
    [
      "approval response",
      () =>
        approvalResponseRoute(
          buildJsonRequest("http://localhost/api/approvals/appr-1/respond", {
            decision: "approved",
            extra: "nope"
          }),
          { params: Promise.resolve({ id: "appr-1" }) }
        )
    ]
  ])("rejects unknown fields for %s requests", async (_label, invokeRoute) => {
    const response = await invokeRoute();
    const payload = (await response.json()) as { error?: string };

    expect(response.status).toBe(400);
    expect(payload.error).toContain("Unrecognized key");
    expectNoStoreHeaders(response);
  });

  it.each([
    ["session", () => sessionRoute(buildInvalidJsonRequest("http://localhost/api/session"))],
    ["goals", () => goalsRoute(buildInvalidJsonRequest("http://localhost/api/goals"))],
    ["memory", () => memoryRoute(buildInvalidJsonRequest("http://localhost/api/memory"))],
    ["watchers", () => watchersRoute(buildInvalidJsonRequest("http://localhost/api/watchers"))],
    ["integrations", () => integrationsRoute(buildInvalidJsonRequest("http://localhost/api/integrations"))],
    ["local notes", () => localNotesRoute(buildInvalidJsonRequest("http://localhost/api/integrations/local-notes"))],
    [
      "approval response",
      () =>
        approvalResponseRoute(buildInvalidJsonRequest("http://localhost/api/approvals/appr-1/respond"), {
          params: Promise.resolve({ id: "appr-1" })
        })
    ]
  ])("rejects malformed JSON bodies for %s requests", async (_label, invokeRoute) => {
    const response = await invokeRoute();
    const payload = (await response.json()) as { error?: string };

    expect(response.status).toBe(400);
    expect(payload.error).toBe("Request body must be valid JSON.");
    expectNoStoreHeaders(response);
  });

  it.each([
    ["session", () => sessionRoute(new Request("http://localhost/api/session", { method: "POST", body: "accessKey=test-access-key" }))],
    [
      "memory",
      () =>
        memoryRoute(
          new Request("http://localhost/api/memory", {
            method: "POST",
            headers: {
              "content-type": "text/plain",
              "x-agentic-access-key": "test-access-key"
            },
            body: "not-json"
          })
        )
    ],
    [
      "watchers",
      () =>
        watchersRoute(
          new Request("http://localhost/api/watchers", {
            method: "POST",
            headers: {
              "content-type": "application/x-www-form-urlencoded",
              "x-agentic-access-key": "test-access-key"
            },
            body: "goalId=goal-1"
          })
        )
    ]
  ])("rejects non-json content types for %s requests", async (_label, invokeRoute) => {
    const response = await invokeRoute();
    const payload = (await response.json()) as { error?: string };

    expect(response.status).toBe(415);
    expect(payload.error).toBe("Content-Type must be application/json.");
    expectNoStoreHeaders(response);
  });

  it("returns no-store headers when creating a session successfully", async () => {
    const response = await sessionRoute(
      buildJsonRequest(
        "http://localhost/api/session",
        {
          accessKey: "test-access-key"
        },
        false
      )
    );

    expect(response.status).toBe(200);
    expectNoStoreHeaders(response);
  });

  it("rate limits repeated failed session unlock attempts and returns retry metadata", async () => {
    const request = () =>
      buildJsonRequest(
        "http://localhost/api/session",
        {
          accessKey: "wrong-key"
        },
        false
      );

    for (let index = 0; index < 4; index += 1) {
      const response = await sessionRoute(request());
      const payload = (await response.json()) as { error?: string };

      expect(response.status).toBe(401);
      expect(payload.error).toBe("The supplied access key was rejected.");
      expectNoStoreHeaders(response);
    }

    const throttledResponse = await sessionRoute(request());
    const throttledPayload = (await throttledResponse.json()) as { error?: string };

    expect(throttledResponse.status).toBe(429);
    expect(throttledPayload.error).toBe("Too many failed unlock attempts. Try again later.");
    expect(throttledResponse.headers.get("retry-after")).toBeTruthy();
    expectNoStoreHeaders(throttledResponse);
  });

  it("returns no-store headers on successful authenticated API responses", async () => {
    const response = await memoryRoute(
      buildAuthorizedJsonRequest("http://localhost/api/memory", {
        category: "style",
        content: "Prefer concise answers."
      })
    );

    expect(response.status).toBe(200);
    expectNoStoreHeaders(response);
  });
});
