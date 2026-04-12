import { mkdtemp } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { SYSTEM_USER_ID } from "@agentic/contracts";
import { createRepository } from "@agentic/repository";
import { processUserRequest } from "@agentic/orchestrator";
import { GET as agentMetricsRoute } from "../apps/web/app/api/agents/[id]/metrics/route";
import { AGENTIC_ACCESS_KEY_HEADER } from "../apps/web/lib/auth";
import { expectNoStoreHeaders } from "./route-test-helpers";

describe("agent metrics route", () => {
  const originalAccessKey = process.env.AGENTIC_ACCESS_KEY;
  const originalRuntimeStorePath = process.env.AGENTIC_RUNTIME_STORE_PATH;

  async function createGoalForUser(
    repository: ReturnType<typeof createRepository>,
    userId: string,
    request: string
  ) {
    const bundle = await processUserRequest({
      userId,
      request,
      memories: await repository.listMemory(userId),
      integrations: await repository.listIntegrations(userId)
    });

    await repository.saveGoalBundle(bundle);
    return bundle;
  }

  function buildAuthorizedGetRequest(url: string) {
    return new Request(url, {
      method: "GET",
      headers: {
        [AGENTIC_ACCESS_KEY_HEADER]: "test-access-key"
      }
    });
  }

  beforeEach(async () => {
    process.env.AGENTIC_ACCESS_KEY = "test-access-key";
    process.env.AGENTIC_RUNTIME_STORE_PATH = path.join(
      await mkdtemp(path.join(os.tmpdir(), "agentic-agent-metrics-route-")),
      "runtime-store.json"
    );
    Reflect.set(globalThis, "__agenticRepository", undefined);
  });

  afterEach(() => {
    process.env.AGENTIC_ACCESS_KEY = originalAccessKey;
    process.env.AGENTIC_RUNTIME_STORE_PATH = originalRuntimeStorePath;
    Reflect.set(globalThis, "__agenticRepository", undefined);
  });

  it("returns derived metrics for built-in agents by name", async () => {
    const repository = createRepository({
      storePath: process.env.AGENTIC_RUNTIME_STORE_PATH
    });

    await repository.seedDefaults(SYSTEM_USER_ID);

    const bundle = await createGoalForUser(repository, SYSTEM_USER_ID, "Review my inbox and send one external reply.");
    const startedAt = Date.now() - bundle.tasks.length * 45_000;

    await repository.saveGoalBundle({
      ...bundle,
      tasks: bundle.tasks.map((task, index) => ({
        ...task,
        assignedAgent: "communications",
        state: "completed",
        createdAt: new Date(startedAt + index * 1_000).toISOString(),
        updatedAt: new Date(startedAt + (index + 1) * 45_000).toISOString()
      })),
      approvals: bundle.approvals.map((approval) => ({
        ...approval,
        decision: "approved"
      }))
    });

    Reflect.set(globalThis, "__agenticRepository", undefined);

    const response = await agentMetricsRoute(buildAuthorizedGetRequest("http://localhost/api/agents/communications/metrics?period=all"), {
      params: Promise.resolve({ id: "communications" })
    });
    const payload = (await response.json()) as {
      agentId: string;
      period: string;
      metrics: {
        agentId: string;
        tasksTotal: number;
        tasksCompleted: number;
        approvalsApproved: number;
        successRate: number;
      };
    };

    expect(response.status).toBe(200);
    expectNoStoreHeaders(response);
    expect(payload.agentId).toBe("communications");
    expect(payload.period).toBe("all");
    expect(payload.metrics.agentId).toBe("agent-builtin-communications");
    expect(payload.metrics.tasksTotal).toBe(bundle.tasks.length);
    expect(payload.metrics.tasksCompleted).toBe(bundle.tasks.length);
    expect(payload.metrics.approvalsApproved).toBe(bundle.approvals.length);
    expect(payload.metrics.successRate).toBe(1);
  });

  it("returns 404 for unknown agents", async () => {
    const repository = createRepository({
      storePath: process.env.AGENTIC_RUNTIME_STORE_PATH
    });

    await repository.seedDefaults(SYSTEM_USER_ID);
    Reflect.set(globalThis, "__agenticRepository", undefined);

    const response = await agentMetricsRoute(buildAuthorizedGetRequest("http://localhost/api/agents/missing-agent/metrics"), {
      params: Promise.resolve({ id: "missing-agent" })
    });
    const payload = (await response.json()) as { error?: string };

    expect(response.status).toBe(404);
    expectNoStoreHeaders(response);
    expect(payload.error).toBe("Agent not found");
  });

  it("returns 400 for unsupported metric periods", async () => {
    const repository = createRepository({
      storePath: process.env.AGENTIC_RUNTIME_STORE_PATH
    });

    await repository.seedDefaults(SYSTEM_USER_ID);
    Reflect.set(globalThis, "__agenticRepository", undefined);

    const response = await agentMetricsRoute(
      buildAuthorizedGetRequest("http://localhost/api/agents/communications/metrics?period=decade"),
      {
        params: Promise.resolve({ id: "communications" })
      }
    );
    const payload = (await response.json()) as { error?: string };

    expect(response.status).toBe(400);
    expectNoStoreHeaders(response);
    expect(payload.error).toMatch(/day|week|month|all/i);
  });
});
