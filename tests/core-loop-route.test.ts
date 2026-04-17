import { mkdtemp } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { SYSTEM_USER_ID } from "@agentic/contracts";
import { processUserRequest } from "@agentic/orchestrator";
import { createRepository, type AgenticRepository } from "@agentic/repository";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { POST as coreLoopRoute } from "../apps/web/app/api/dashboard/core-loop/route";
import { AGENTIC_ACCESS_KEY_HEADER } from "../apps/web/lib/auth";
import { expectNoStoreHeaders } from "./route-test-helpers";

async function createGoalForUser(repository: AgenticRepository, userId: string, request: string) {
  const bundle = await processUserRequest({
    userId,
    request,
    memories: await repository.listMemory(userId),
    integrations: []
  });

  await repository.saveGoalBundle(bundle);
  return bundle;
}

function buildCoreLoopRequest(body: unknown) {
  return new Request("http://localhost/api/dashboard/core-loop", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      [AGENTIC_ACCESS_KEY_HEADER]: "test-access-key"
    },
    body: JSON.stringify(body)
  });
}

describe("core loop telemetry route", () => {
  const originalAccessKey = process.env.AGENTIC_ACCESS_KEY;
  const originalRuntimeStorePath = process.env.AGENTIC_RUNTIME_STORE_PATH;

  beforeEach(async () => {
    process.env.AGENTIC_ACCESS_KEY = "test-access-key";
    process.env.AGENTIC_RUNTIME_STORE_PATH = path.join(
      await mkdtemp(path.join(os.tmpdir(), "agentic-core-loop-route-")),
      "runtime-store.json"
    );
    Reflect.set(globalThis, "__agenticRepository", undefined);
  });

  afterEach(() => {
    process.env.AGENTIC_ACCESS_KEY = originalAccessKey;
    process.env.AGENTIC_RUNTIME_STORE_PATH = originalRuntimeStorePath;
    Reflect.set(globalThis, "__agenticRepository", undefined);
  });

  it("records a dashboard view summary from persisted governed work", async () => {
    const repository = createRepository({
      storePath: process.env.AGENTIC_RUNTIME_STORE_PATH
    });

    await repository.seedDefaults(SYSTEM_USER_ID);
    const bundle = await createGoalForUser(repository, SYSTEM_USER_ID, "Prepare the approval queue for operations.");
    await repository.saveGoalBundle({
      ...bundle,
      goal: {
        ...bundle.goal,
        status: "completed"
      }
    });
    Reflect.set(globalThis, "__agenticRepository", undefined);

    const response = await coreLoopRoute(buildCoreLoopRequest({ event: "dashboard_view" }));
    const payload = (await response.json()) as {
      accepted: boolean;
      summary: {
        health: string;
        workspaceState: string;
        hasActivation: boolean;
        hasRepeatUsage: boolean;
        hasValueRealization: boolean;
        counts: {
          completedGoals: number;
        };
      };
    };

    expect(response.status).toBe(200);
    expect(payload.accepted).toBe(true);
    expect(payload.summary.workspaceState).toBe("configured");
    expect(payload.summary.hasActivation).toBe(true);
    expect(payload.summary.hasValueRealization).toBe(true);
    expect(payload.summary.counts.completedGoals).toBe(1);
    expectNoStoreHeaders(response);
  });

  it("rejects unknown fields in telemetry requests", async () => {
    const repository = createRepository({
      storePath: process.env.AGENTIC_RUNTIME_STORE_PATH
    });

    await repository.seedDefaults(SYSTEM_USER_ID);
    Reflect.set(globalThis, "__agenticRepository", undefined);

    const response = await coreLoopRoute(
      buildCoreLoopRequest({
        event: "dashboard_view",
        unexpected: true
      })
    );
    const payload = (await response.json()) as { error: string };

    expect(response.status).toBe(400);
    expect(payload.error).toContain("unexpected");
    expectNoStoreHeaders(response);
  });
});
