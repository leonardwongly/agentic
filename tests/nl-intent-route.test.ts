import { mkdtemp } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { SYSTEM_USER_ID } from "@agentic/contracts";
import { processUserRequest } from "@agentic/orchestrator";
import { createRepository } from "@agentic/repository";
import { GET as nlIntentCapabilitiesRoute, POST as nlIntentRoute } from "../apps/web/app/api/nl/intent/route";
import { buildAuthorizedGetRequest, buildAuthorizedJsonRequest, expectNoStoreHeaders } from "./route-test-helpers";

describe("nl intent route", () => {
  const originalAccessKey = process.env.AGENTIC_ACCESS_KEY;
  const originalRuntimeStorePath = process.env.AGENTIC_RUNTIME_STORE_PATH;

  async function buildRepository() {
    const repository = createRepository({
      storePath: process.env.AGENTIC_RUNTIME_STORE_PATH
    });

    await repository.seedDefaults(SYSTEM_USER_ID);
    return repository;
  }

  async function createApprovalBundle(repository: ReturnType<typeof createRepository>) {
    const bundle = await processUserRequest({
      userId: SYSTEM_USER_ID,
      request: "Review my inbox and draft responses.",
      memories: await repository.listMemory(SYSTEM_USER_ID),
      integrations: await repository.listIntegrations(SYSTEM_USER_ID)
    });
    const approval = bundle.approvals[0];

    expect(approval).toBeDefined();

    const normalizedBundle = {
      ...bundle,
      approvals: bundle.approvals.map((candidate) =>
        candidate.id === approval!.id
          ? {
              ...candidate,
              riskClass: "R2" as const,
              decision: "pending" as const,
              respondedAt: null,
              decisionScope: null,
              decisionRationale: null,
              history: []
            }
          : candidate
      )
    };

    await repository.saveGoalBundle(normalizedBundle);
    return normalizedBundle;
  }

  beforeEach(async () => {
    process.env.AGENTIC_ACCESS_KEY = "test-access-key";
    process.env.AGENTIC_RUNTIME_STORE_PATH = path.join(
      await mkdtemp(path.join(os.tmpdir(), "agentic-nl-intent-route-")),
      "runtime-store.json"
    );
    Reflect.set(globalThis, "__agenticRepository", undefined);
  });

  afterEach(() => {
    process.env.AGENTIC_ACCESS_KEY = originalAccessKey;
    process.env.AGENTIC_RUNTIME_STORE_PATH = originalRuntimeStorePath;
    Reflect.set(globalThis, "__agenticRepository", undefined);
  });

  it("returns filtered approval results through the server boundary", async () => {
    const repository = await buildRepository();
    const bundle = await createApprovalBundle(repository);

    Reflect.set(globalThis, "__agenticRepository", undefined);

    const response = await nlIntentRoute(
      buildAuthorizedJsonRequest("http://localhost/api/nl/intent", {
        type: "query",
        target: "approvals",
        filters: {
          status: "pending",
          riskClass: "R2"
        }
      })
    );
    const payload = (await response.json()) as {
      message: string;
      data: Array<{ id: string; decision: string; riskClass: string }>;
    };

    expect(response.status).toBe(200);
    expect(payload.message).toContain("Found 1 approval");
    expect(payload.data).toEqual([
      expect.objectContaining({
        id: bundle.approvals[0]!.id,
        decision: "pending",
        riskClass: "R2"
      })
    ]);
    expectNoStoreHeaders(response);
  });

  it("publishes bounded NL capabilities and live integration readiness", async () => {
    const repository = await buildRepository();

    Reflect.set(globalThis, "__agenticRepository", repository);

    const response = await nlIntentCapabilitiesRoute(buildAuthorizedGetRequest("http://localhost/api/nl/intent"));
    const payload = (await response.json()) as {
      capabilities: {
        headline: string;
        commands: Array<{ id: string; status: string }>;
        integrations: Array<{ label: string; connectionStatus: string; readinessTier: string; readinessLabel: string }>;
      };
    };

    expect(response.status).toBe(200);
    expect(payload.capabilities.headline).toContain("bounded control commands");
    expect(payload.capabilities.commands).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: "create-goal", status: "ready" }),
        expect.objectContaining({ id: "approve-all-r2", status: "limited" })
      ])
    );
    expect(payload.capabilities.integrations).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ label: "Email" }),
        expect.objectContaining({ label: "Calendar" }),
        expect.objectContaining({
          label: "Notes",
          connectionStatus: "ready",
          readinessTier: "autonomous-grade",
          readinessLabel: "Autonomous-grade"
        })
      ])
    );
    expectNoStoreHeaders(response);
  });

  it("approves all pending R2 approvals and returns refreshed dashboard data", async () => {
    const repository = await buildRepository();
    const bundle = await createApprovalBundle(repository);

    Reflect.set(globalThis, "__agenticRepository", undefined);

    const response = await nlIntentRoute(
      buildAuthorizedJsonRequest("http://localhost/api/nl/intent", {
        type: "command",
        action: "approve",
        params: {
          all: true,
          riskClass: "R2"
        }
      })
    );
    const payload = (await response.json()) as {
      message: string;
      dashboard: { approvals: Array<{ id: string; decision: string; riskClass: string }> };
    };

    expect(response.status).toBe(200);
    expect(payload.message).toContain("Approved 1 R2 approval");
    expect(payload.dashboard.approvals).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: bundle.approvals[0]!.id,
          decision: "approved",
          riskClass: "R2"
        })
      ])
    );
    expectNoStoreHeaders(response);
  });

  it("creates goal bundles from the NL command boundary", async () => {
    const repository = await buildRepository();

    Reflect.set(globalThis, "__agenticRepository", repository);

    const response = await nlIntentRoute(
      buildAuthorizedJsonRequest("http://localhost/api/nl/intent", {
        type: "command",
        action: "create-goal",
        params: {
          request: "Draft a Q2 operating plan"
        }
      })
    );
    const payload = (await response.json()) as {
      message: string;
      data: { goalId: string; title: string };
      dashboard: { goals: Array<{ goal: { id: string; title: string } }> };
    };

    expect(response.status).toBe(200);
    expect(payload.message).toContain("Created goal bundle");
    expect(payload.data.goalId).toBeTruthy();
    expect(payload.dashboard.goals).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          goal: expect.objectContaining({
            id: payload.data.goalId
          })
        })
      ])
    );
    expectNoStoreHeaders(response);
  });

  it("returns structured summaries instead of relying on local dashboard state", async () => {
    const repository = await buildRepository();
    await createApprovalBundle(repository);

    Reflect.set(globalThis, "__agenticRepository", undefined);

    const response = await nlIntentRoute(
      buildAuthorizedJsonRequest("http://localhost/api/nl/intent", {
        type: "summary",
        timeRange: "since-last-login"
      })
    );
    const payload = (await response.json()) as {
      message: string;
      data: {
        pendingApprovals: number;
        runningGoals: number;
        recentActivities: number;
      };
    };

    expect(response.status).toBe(200);
    expect(payload.message).toContain("since-last-login summary");
    expect(payload.data.pendingApprovals).toBeGreaterThanOrEqual(1);
    expect(payload.data.runningGoals).toEqual(expect.any(Number));
    expect(payload.data.recentActivities).toBeGreaterThan(0);
    expectNoStoreHeaders(response);
  });

  it("rejects NL reject commands that are missing an approval selection", async () => {
    const repository = await buildRepository();

    Reflect.set(globalThis, "__agenticRepository", repository);

    const response = await nlIntentRoute(
      buildAuthorizedJsonRequest("http://localhost/api/nl/intent", {
        type: "command",
        action: "reject",
        params: {}
      })
    );
    const payload = (await response.json()) as { error?: string };

    expect(response.status).toBe(400);
    expect(payload.error).toBe("Reject commands require selecting an approval in the approvals queue.");
    expectNoStoreHeaders(response);
  });
});
