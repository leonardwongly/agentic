import { mkdtemp } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { SYSTEM_USER_ID } from "@agentic/contracts";
import { getTelemetrySnapshot, resetTelemetrySnapshot } from "@agentic/observability";
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
    resetTelemetrySnapshot();
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
    resetTelemetrySnapshot();
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

  it("records command-center decision and recovery-start telemetry", async () => {
    const repository = createRepository({
      storePath: process.env.AGENTIC_RUNTIME_STORE_PATH
    });

    await repository.seedDefaults(SYSTEM_USER_ID);
    Reflect.set(globalThis, "__agenticRepository", undefined);

    const response = await coreLoopRoute(
      buildCoreLoopRequest({
        event: "command_center_action",
        role: "communications",
        source: "priority",
        targetSection: "approvals",
        elapsedMs: 1_250,
        severity: "critical"
      })
    );
    const payload = (await response.json()) as { accepted: boolean };
    const snapshot = getTelemetrySnapshot();
    const actionMetric = snapshot.metrics.find((entry) => entry.name === "product.command_center.action.total");
    const decisionTimingMetric = snapshot.metrics.find((entry) => entry.name === "product.command_center.time_to_decision_ms");
    const recoveryMetric = snapshot.metrics.find((entry) => entry.name === "product.command_center.recovery_start.total");
    const recoveryTimingMetric = snapshot.metrics.find(
      (entry) => entry.name === "product.command_center.time_to_recovery_start_ms"
    );
    const actionLog = snapshot.logs.find((entry) => entry.message === "product.command_center.action");

    expect(response.status).toBe(200);
    expect(payload.accepted).toBe(true);
    expect(actionMetric).toMatchObject({
      kind: "counter",
      name: "product.command_center.action.total",
      value: 1,
      attributes: expect.objectContaining({
        role: "communications",
        source: "priority",
        targetSection: "approvals"
      })
    });
    expect(decisionTimingMetric).toMatchObject({
      kind: "histogram",
      name: "product.command_center.time_to_decision_ms",
      value: 1_250
    });
    expect(recoveryMetric).toMatchObject({
      kind: "counter",
      name: "product.command_center.recovery_start.total",
      value: 1
    });
    expect(recoveryTimingMetric).toMatchObject({
      kind: "histogram",
      name: "product.command_center.time_to_recovery_start_ms",
      value: 1_250
    });
    expect(actionLog).toMatchObject({
      message: "product.command_center.action",
      attributes: expect.objectContaining({
        role: "communications",
        source: "priority",
        targetSection: "approvals",
        elapsedMs: 1_250,
        isRecoveryAction: true
      })
    });
    expectNoStoreHeaders(response);
  });

  it("records command-center role changes without treating them as recovery actions", async () => {
    const repository = createRepository({
      storePath: process.env.AGENTIC_RUNTIME_STORE_PATH
    });

    await repository.seedDefaults(SYSTEM_USER_ID);
    Reflect.set(globalThis, "__agenticRepository", undefined);

    const response = await coreLoopRoute(
      buildCoreLoopRequest({
        event: "command_center_role_change",
        role: "executive",
        elapsedMs: 480
      })
    );
    const payload = (await response.json()) as { accepted: boolean };
    const snapshot = getTelemetrySnapshot();
    const roleMetric = snapshot.metrics.find((entry) => entry.name === "product.command_center.role_change.total");
    const timingMetric = snapshot.metrics.find((entry) => entry.name === "product.command_center.time_to_role_change_ms");
    const recoveryMetric = snapshot.metrics.find((entry) => entry.name === "product.command_center.recovery_start.total");

    expect(response.status).toBe(200);
    expect(payload.accepted).toBe(true);
    expect(roleMetric).toMatchObject({
      kind: "counter",
      name: "product.command_center.role_change.total",
      value: 1,
      attributes: expect.objectContaining({
        role: "executive"
      })
    });
    expect(timingMetric).toMatchObject({
      kind: "histogram",
      name: "product.command_center.time_to_role_change_ms",
      value: 480
    });
    expect(recoveryMetric).toBeUndefined();
    expectNoStoreHeaders(response);
  });

  it("records privacy-preserving cockpit telemetry without command query text", async () => {
    const response = await coreLoopRoute(
      buildCoreLoopRequest({
        event: "command_palette_usage",
        action: "selected",
        category: "navigate",
        cockpitVariant: "redesigned"
      })
    );
    const payload = (await response.json()) as { accepted: boolean };
    const snapshot = getTelemetrySnapshot();
    const metric = snapshot.metrics.find((entry) => entry.name === "product.dashboard.command_palette.total");
    const log = snapshot.logs.find((entry) => entry.message === "product.dashboard.command_palette");

    expect(response.status).toBe(200);
    expect(payload.accepted).toBe(true);
    expect(metric).toMatchObject({
      kind: "counter",
      value: 1,
      attributes: expect.objectContaining({
        action: "selected",
        category: "navigate",
        variant: "redesigned"
      })
    });
    expect(JSON.stringify(log)).not.toContain("query");
    expectNoStoreHeaders(response);
  });

  it("rejects free-form command query fields in cockpit telemetry", async () => {
    const response = await coreLoopRoute(
      buildCoreLoopRequest({
        event: "command_palette_usage",
        action: "opened",
        cockpitVariant: "redesigned",
        query: "find customer@example.com"
      })
    );
    const payload = (await response.json()) as { error: string };

    expect(response.status).toBe(400);
    expect(payload.error).toContain("query");
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
