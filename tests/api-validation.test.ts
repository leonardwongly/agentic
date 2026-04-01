import { mkdtemp } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { AGENTIC_ACCESS_KEY_HEADER } from "../apps/web/lib/auth";
import { POST as approvalResponseRoute } from "../apps/web/app/api/approvals/[id]/respond/route";
import { POST as goalsRoute } from "../apps/web/app/api/goals/route";
import { POST as integrationsRoute } from "../apps/web/app/api/integrations/route";
import { POST as memoryRoute } from "../apps/web/app/api/memory/route";
import { POST as sessionRoute } from "../apps/web/app/api/session/route";
import { POST as watchersRoute } from "../apps/web/app/api/watchers/route";

function buildJsonRequest(url: string, body: unknown, authenticated = true): Request {
  const headers = new Headers({
    "content-type": "application/json"
  });

  if (authenticated) {
    headers.set(AGENTIC_ACCESS_KEY_HEADER, "test-access-key");
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
  });
});
