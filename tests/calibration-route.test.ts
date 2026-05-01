import { mkdtemp } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { SYSTEM_USER_ID } from "@agentic/contracts";
import { createRepository } from "@agentic/repository";
import { processUserRequest } from "@agentic/orchestrator";
import { GET as calibrationRoute } from "../apps/web/app/api/calibration/route";
import { AGENTIC_ACCESS_KEY_HEADER } from "../apps/web/lib/auth";
import { expectNoStoreHeaders } from "./route-test-helpers";

describe("calibration route", () => {
  const originalAccessKey = process.env.AGENTIC_ACCESS_KEY;
  const originalRuntimeStorePath = process.env.AGENTIC_RUNTIME_STORE_PATH;

  function buildAuthorizedGetRequest(url: string) {
    return new Request(url, {
      method: "GET",
      headers: {
        [AGENTIC_ACCESS_KEY_HEADER]: "test-access-key"
      }
    });
  }

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

  beforeEach(async () => {
    process.env.AGENTIC_ACCESS_KEY = "test-access-key";
    process.env.AGENTIC_RUNTIME_STORE_PATH = path.join(
      await mkdtemp(path.join(os.tmpdir(), "agentic-calibration-route-")),
      "runtime-store.json"
    );
    Reflect.set(globalThis, "__agenticRepository", undefined);
  });

  afterEach(() => {
    process.env.AGENTIC_ACCESS_KEY = originalAccessKey;
    process.env.AGENTIC_RUNTIME_STORE_PATH = originalRuntimeStorePath;
    Reflect.set(globalThis, "__agenticRepository", undefined);
  });

  it("returns bounded calibration insights for the authenticated user", async () => {
    const repository = createRepository({
      storePath: process.env.AGENTIC_RUNTIME_STORE_PATH
    });

    await repository.seedDefaults(SYSTEM_USER_ID);
    const agent = (await repository.listAgents(SYSTEM_USER_ID)).find((candidate) => candidate.name === "communications");
    const bundle = await createGoalForUser(repository, SYSTEM_USER_ID, "Review my inbox and send one external reply.");
    const task = bundle.tasks[0];
    const approval = bundle.approvals[0];
    const createdAt = new Date().toISOString();
    const updatedAt = new Date(Date.now() + 60_000).toISOString();

    expect(agent).toBeDefined();
    expect(task).toBeDefined();
    expect(approval).toBeDefined();

    await repository.saveGoalBundle({
      ...bundle,
      tasks: [
        {
          ...task!,
          assignedAgent: agent!.name,
          state: "failed",
          createdAt,
          updatedAt
        }
      ],
      approvals: [
        {
          ...approval!,
          taskId: task!.id,
          decision: "approved",
          createdAt,
          respondedAt: updatedAt
        }
      ]
    });
    await repository.saveEvidenceRecord({
      id: "route-evidence-approved-failure",
      userId: SYSTEM_USER_ID,
      goalId: bundle.goal.id,
      taskId: task!.id,
      approvalId: approval!.id,
      sourceKind: "approval_response",
      sourceId: approval!.id,
      sourceSummary: "Approved execution later failed.",
      riskClass: approval!.riskClass,
      requestedAction: approval!.requestedAction,
      requestRationale: approval!.rationale,
      requiresApproval: true,
      decision: "approved",
      decisionScope: "once",
      decisionRationale: null,
      respondedAt: updatedAt,
      resultingTaskState: "failed",
      resultingGoalStatus: bundle.goal.status,
      actionLogIds: [],
      artifactIds: [],
      memoryIds: [],
      actorContext: null,
      createdAt,
      updatedAt
    });
    Reflect.set(globalThis, "__agenticRepository", undefined);

    const response = await calibrationRoute(
      buildAuthorizedGetRequest("http://localhost/api/calibration?agentId=communications&period=all&limit=1")
    );
    const payload = (await response.json()) as {
      calibration: {
        totalAgents: number;
        agentsWithActivity: number;
        events: Array<{ kind: string }>;
        insights: Array<{ agentId: string; posture: string; events: Array<{ kind: string }> }>;
      };
    };

    expect(response.status).toBe(200);
    expectNoStoreHeaders(response);
    expect(payload.calibration.totalAgents).toBe(1);
    expect(payload.calibration.agentsWithActivity).toBe(1);
    expect(payload.calibration.events).toHaveLength(1);
    expect(payload.calibration.insights[0]?.agentId).toBe(agent!.id);
    expect(payload.calibration.insights[0]?.posture).toBe("needs-review");
    expect(payload.calibration.insights[0]?.events[0]?.kind).toBe("post_approval_failure");
  });

  it("rejects unsupported query fields and unsafe limits", async () => {
    const repository = createRepository({
      storePath: process.env.AGENTIC_RUNTIME_STORE_PATH
    });

    await repository.seedDefaults(SYSTEM_USER_ID);
    Reflect.set(globalThis, "__agenticRepository", undefined);

    const unknownField = await calibrationRoute(
      buildAuthorizedGetRequest("http://localhost/api/calibration?period=all&debug=true")
    );
    const oversizedLimit = await calibrationRoute(
      buildAuthorizedGetRequest("http://localhost/api/calibration?limit=500")
    );

    expect(unknownField.status).toBe(400);
    expect(oversizedLimit.status).toBe(400);
  });

  it("returns 404 for inaccessible agents", async () => {
    const repository = createRepository({
      storePath: process.env.AGENTIC_RUNTIME_STORE_PATH
    });

    await repository.seedDefaults(SYSTEM_USER_ID);
    Reflect.set(globalThis, "__agenticRepository", undefined);

    const response = await calibrationRoute(
      buildAuthorizedGetRequest("http://localhost/api/calibration?agentId=missing-agent")
    );
    const payload = (await response.json()) as { error?: string };

    expect(response.status).toBe(404);
    expect(payload.error).toBe("Agent not found");
  });
});
