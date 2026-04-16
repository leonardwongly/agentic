import { mkdtemp } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { POST as approvalResponseRoute } from "../apps/web/app/api/approvals/[id]/respond/route";
import { POST as autopilotEventsRoute } from "../apps/web/app/api/autopilot/events/route";
import { POST as autopilotSettingsRoute } from "../apps/web/app/api/autopilot/settings/route";
import { POST as goalsRoute } from "../apps/web/app/api/goals/route";
import { POST as governanceRoute } from "../apps/web/app/api/governance/route";
import { POST as integrationsRoute } from "../apps/web/app/api/integrations/route";
import { POST as localNotesRoute } from "../apps/web/app/api/integrations/local-notes/route";
import { POST as memoryRoute } from "../apps/web/app/api/memory/route";
import { PATCH as memoryUpdateRoute } from "../apps/web/app/api/memory/[id]/route";
import { POST as nlIntentRoute } from "../apps/web/app/api/nl/intent/route";
import { POST as sessionRoute } from "../apps/web/app/api/session/route";
import { POST as watchersRoute } from "../apps/web/app/api/watchers/route";
import { PATCH as watcherUpdateRoute } from "../apps/web/app/api/watchers/[id]/route";
import { POST as workflowTemplatesRoute } from "../apps/web/app/api/workflow-templates/route";
import { POST as workspacesRoute } from "../apps/web/app/api/workspaces/route";
import {
  resetAuthSessionStateStoreForTesting,
  setAuthSessionStateStoreForTesting,
  type AuthSessionStateStore
} from "../apps/web/lib/auth-session-store";
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
  const originalNodeEnv = process.env.NODE_ENV;
  const originalRequireSharedAuthState = process.env.AGENTIC_REQUIRE_SHARED_AUTH_STATE;
  const originalTrustProxyHeaders = process.env.AGENTIC_TRUST_PROXY_HEADERS;

  beforeEach(async () => {
    process.env.AGENTIC_ACCESS_KEY = "test-access-key";
    process.env.NODE_ENV = "test";
    delete process.env.AGENTIC_REQUIRE_SHARED_AUTH_STATE;
    process.env.AGENTIC_RUNTIME_STORE_PATH = path.join(
      await mkdtemp(path.join(os.tmpdir(), "agentic-api-validation-")),
      "runtime-store.json"
    );
    Reflect.set(globalThis, "__agenticRepository", undefined);
  });

  afterEach(async () => {
    process.env.AGENTIC_ACCESS_KEY = originalAccessKey;
    process.env.NODE_ENV = originalNodeEnv;
    process.env.AGENTIC_REQUIRE_SHARED_AUTH_STATE = originalRequireSharedAuthState;
    process.env.AGENTIC_TRUST_PROXY_HEADERS = originalTrustProxyHeaders;
    process.env.AGENTIC_RUNTIME_STORE_PATH = originalRuntimeStorePath;
    Reflect.set(globalThis, "__agenticRepository", undefined);
    await resetSessionUnlockRateLimit();
    resetAuthSessionStateStoreForTesting();
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
      "workspaces",
      () =>
        workspacesRoute(
          buildJsonRequest("http://localhost/api/workspaces", {
            action: "create",
            name: "Shared Planning",
            extra: "nope"
          })
        )
    ],
    [
      "governance",
      () =>
        governanceRoute(
          buildJsonRequest("http://localhost/api/governance", {
            approvalMode: "always_review",
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
      "memory update",
      () =>
        memoryUpdateRoute(
          buildJsonRequest("http://localhost/api/memory/memory-1", {
            action: "review",
            extra: "nope"
          }),
          { params: Promise.resolve({ id: "memory-1" }) }
        )
    ],
    [
      "watcher update",
      () =>
        watcherUpdateRoute(
          buildJsonRequest("http://localhost/api/watchers/watcher-1", {
            action: "pause",
            extra: "nope"
          }),
          { params: Promise.resolve({ id: "watcher-1" }) }
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
    ],
    [
      "autopilot settings",
      () =>
        autopilotSettingsRoute(
          buildJsonRequest("http://localhost/api/autopilot/settings", {
            mode: "notify_only",
            extra: "nope"
          })
        )
    ],
    [
      "autopilot events",
      () =>
        autopilotEventsRoute(
          buildJsonRequest("http://localhost/api/autopilot/events", {
            kind: "watcher_triggered",
            sourceId: "watcher-1",
            extra: "nope"
          })
        )
    ],
    [
      "workflow templates",
      () =>
        workflowTemplatesRoute(
          buildJsonRequest("http://localhost/api/workflow-templates", {
            name: "Daily triage",
            description: "Review signals",
            nodes: [],
            edges: [],
            triggers: [],
            extra: "nope"
          })
        )
    ],
    [
      "nl intent",
      () =>
        nlIntentRoute(
          buildJsonRequest("http://localhost/api/nl/intent", {
            type: "summary",
            timeRange: "today",
            extra: "nope"
          })
        )
    ]
  ])("rejects unknown fields for %s requests", async (_label, invokeRoute) => {
    const response = await invokeRoute();
    const payload = (await response.json()) as { error?: string };
    const expectedMessage = _label === "nl intent" ? "Invalid input" : "Unrecognized key";

    expect(response.status).toBe(400);
    expect(payload.error).toContain(expectedMessage);
    expectNoStoreHeaders(response);
  });

  it.each([
    ["session", () => sessionRoute(buildInvalidJsonRequest("http://localhost/api/session"))],
    ["goals", () => goalsRoute(buildInvalidJsonRequest("http://localhost/api/goals"))],
    ["workspaces", () => workspacesRoute(buildInvalidJsonRequest("http://localhost/api/workspaces"))],
    ["governance", () => governanceRoute(buildInvalidJsonRequest("http://localhost/api/governance"))],
    ["memory", () => memoryRoute(buildInvalidJsonRequest("http://localhost/api/memory"))],
    ["watchers", () => watchersRoute(buildInvalidJsonRequest("http://localhost/api/watchers"))],
    ["workflow templates", () => workflowTemplatesRoute(buildInvalidJsonRequest("http://localhost/api/workflow-templates"))],
    [
      "memory update",
      () =>
        memoryUpdateRoute(buildInvalidJsonRequest("http://localhost/api/memory/memory-1"), {
          params: Promise.resolve({ id: "memory-1" })
        })
    ],
    [
      "watcher update",
      () =>
        watcherUpdateRoute(buildInvalidJsonRequest("http://localhost/api/watchers/watcher-1"), {
          params: Promise.resolve({ id: "watcher-1" })
        })
    ],
    ["integrations", () => integrationsRoute(buildInvalidJsonRequest("http://localhost/api/integrations"))],
    ["local notes", () => localNotesRoute(buildInvalidJsonRequest("http://localhost/api/integrations/local-notes"))],
    ["nl intent", () => nlIntentRoute(buildInvalidJsonRequest("http://localhost/api/nl/intent"))],
    [
      "approval response",
      () =>
        approvalResponseRoute(buildInvalidJsonRequest("http://localhost/api/approvals/appr-1/respond"), {
          params: Promise.resolve({ id: "appr-1" })
        })
    ],
    ["autopilot settings", () => autopilotSettingsRoute(buildInvalidJsonRequest("http://localhost/api/autopilot/settings"))],
    ["autopilot events", () => autopilotEventsRoute(buildInvalidJsonRequest("http://localhost/api/autopilot/events"))]
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
      "workspaces",
      () =>
        workspacesRoute(
          new Request("http://localhost/api/workspaces", {
            method: "POST",
            headers: {
              "content-type": "text/plain",
              "x-agentic-access-key": "test-access-key"
            },
            body: "action=create"
          })
        )
    ],
    [
      "governance",
      () =>
        governanceRoute(
          new Request("http://localhost/api/governance", {
            method: "POST",
            headers: {
              "content-type": "application/x-www-form-urlencoded",
              "x-agentic-access-key": "test-access-key"
            },
            body: "approvalMode=always_review"
          })
        )
    ],
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
    ],
    [
      "memory update",
      () =>
        memoryUpdateRoute(
          new Request("http://localhost/api/memory/memory-1", {
            method: "PATCH",
            headers: {
              "content-type": "text/plain",
              "x-agentic-access-key": "test-access-key"
            },
            body: "not-json"
          }),
          { params: Promise.resolve({ id: "memory-1" }) }
        )
    ],
    [
      "watcher update",
      () =>
        watcherUpdateRoute(
          new Request("http://localhost/api/watchers/watcher-1", {
            method: "PATCH",
            headers: {
              "content-type": "application/x-www-form-urlencoded",
              "x-agentic-access-key": "test-access-key"
            },
            body: "action=pause"
          }),
          { params: Promise.resolve({ id: "watcher-1" }) }
        )
    ],
    [
      "autopilot settings",
      () =>
        autopilotSettingsRoute(
          new Request("http://localhost/api/autopilot/settings", {
            method: "POST",
            headers: {
              "content-type": "text/plain",
              "x-agentic-access-key": "test-access-key"
            },
            body: "mode=notify_only"
          })
        )
    ],
    [
      "autopilot events",
      () =>
        autopilotEventsRoute(
          new Request("http://localhost/api/autopilot/events", {
            method: "POST",
            headers: {
              "content-type": "application/x-www-form-urlencoded",
              "x-agentic-access-key": "test-access-key"
            },
            body: "kind=watcher_triggered"
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

  it("rejects invalid approval scopes", async () => {
    const response = await approvalResponseRoute(
      buildAuthorizedJsonRequest("http://localhost/api/approvals/appr-1/respond", {
        decision: "approved",
        scope: "forever"
      }),
      {
        params: Promise.resolve({ id: "appr-1" })
      }
    );
    const payload = (await response.json()) as { error?: string };

    expect(response.status).toBe(400);
    expect(payload.error).toContain("Invalid option");
    expectNoStoreHeaders(response);
  });

  it("rejects oversized approval rationales", async () => {
    const response = await approvalResponseRoute(
      buildAuthorizedJsonRequest("http://localhost/api/approvals/appr-1/respond", {
        decision: "approved",
        rationale: "x".repeat(1001)
      }),
      {
        params: Promise.resolve({ id: "appr-1" })
      }
    );
    const payload = (await response.json()) as { error?: string };

    expect(response.status).toBe(400);
    expect(payload.error).toContain("1000");
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

  it("ignores spoofed forwarding headers for session login throttling by default", async () => {
    const seenKeys: string[] = [];
    const store: AuthSessionStateStore = {
      scope: "shared",
      async checkRateLimit(key) {
        seenKeys.push(`check:${key}`);
        return { allowed: true, retryAfterMs: 0 };
      },
      async clearRateLimit(key) {
        seenKeys.push(`clear:${key}`);
      },
      async revokeSession() {},
      async isSessionRevoked() {
        return false;
      },
      async reset() {}
    };

    setAuthSessionStateStoreForTesting(store);

    const response = await sessionRoute(
      new Request("http://localhost/api/session", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-forwarded-for": "203.0.113.77",
          "x-real-ip": "198.51.100.9",
          "user-agent": "Agentic Route Test"
        },
        body: JSON.stringify({
          accessKey: "test-access-key"
        })
      })
    );

    expect(response.status).toBe(200);
    expect(seenKeys).toEqual([
      "check:ua:agentic route test",
      "clear:ua:agentic route test"
    ]);
    expectNoStoreHeaders(response);
  });

  it("uses the trusted forwarded client IP for session login throttling when proxy trust is enabled", async () => {
    process.env.AGENTIC_TRUST_PROXY_HEADERS = "true";

    const seenKeys: string[] = [];
    const store: AuthSessionStateStore = {
      scope: "shared",
      async checkRateLimit(key) {
        seenKeys.push(`check:${key}`);
        return { allowed: true, retryAfterMs: 0 };
      },
      async clearRateLimit(key) {
        seenKeys.push(`clear:${key}`);
      },
      async revokeSession() {},
      async isSessionRevoked() {
        return false;
      },
      async reset() {}
    };

    setAuthSessionStateStoreForTesting(store);

    const response = await sessionRoute(
      new Request("http://localhost/api/session", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-forwarded-for": "203.0.113.77, 198.51.100.9",
          "user-agent": "Agentic Route Test"
        },
        body: JSON.stringify({
          accessKey: "test-access-key"
        })
      })
    );

    expect(response.status).toBe(200);
    expect(seenKeys).toEqual([
      "check:ip:203.0.113.77",
      "clear:ip:203.0.113.77"
    ]);
    expectNoStoreHeaders(response);
  });

  it("rejects session creation when production requires shared auth state but only process-local stores are configured", async () => {
    process.env.NODE_ENV = "production";
    process.env.AGENTIC_REQUIRE_SHARED_AUTH_STATE = "true";

    const response = await sessionRoute(
      buildJsonRequest(
        "http://localhost/api/session",
        {
          accessKey: "test-access-key"
        },
        false
      )
    );
    const payload = (await response.json()) as { error?: string };

    expect(response.status).toBe(503);
    expect(payload.error).toContain("Shared auth state is not configured for production.");
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
