import { mkdtemp } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { SYSTEM_USER_ID } from "@agentic/contracts";
import { createJobRecord } from "@agentic/execution";
import { processUserRequest } from "@agentic/orchestrator";
import { createRepository } from "@agentic/repository";
import { buildAuthorizedGetRequest, expectNoStoreHeaders } from "./route-test-helpers";
import { GET as graphRoute } from "../apps/web/app/api/provenance/graph/route";

describe("provenance graph route", () => {
  const originalAccessKey = process.env.AGENTIC_ACCESS_KEY;
  const originalRuntimeStorePath = process.env.AGENTIC_RUNTIME_STORE_PATH;

  beforeEach(async () => {
    process.env.AGENTIC_ACCESS_KEY = "test-access-key";
    process.env.AGENTIC_RUNTIME_STORE_PATH = path.join(
      await mkdtemp(path.join(os.tmpdir(), "agentic-provenance-graph-route-")),
      "runtime-store.json"
    );
    Reflect.set(globalThis, "__agenticRepository", undefined);
  });

  afterEach(() => {
    process.env.AGENTIC_ACCESS_KEY = originalAccessKey;
    process.env.AGENTIC_RUNTIME_STORE_PATH = originalRuntimeStorePath;
    Reflect.set(globalThis, "__agenticRepository", undefined);
  });

  it("returns a graph scoped to the authenticated owner", async () => {
    const repository = createRepository({
      storePath: process.env.AGENTIC_RUNTIME_STORE_PATH
    });
    const userBundle = await processUserRequest({
      userId: SYSTEM_USER_ID,
      request: "Prepare my update.",
      memories: [],
      integrations: []
    });
    const otherBundle = await processUserRequest({
      userId: "other-user",
      request: "Prepare someone else's update.",
      memories: [],
      integrations: []
    });

    await repository.saveGoalBundle(userBundle);
    await repository.saveGoalBundle(otherBundle);
    await repository.enqueueJob(
      createJobRecord({
        userId: SYSTEM_USER_ID,
        kind: "goal_create",
        payload: {
          type: "goal_create",
          goalId: userBundle.goal.id,
          workflowId: userBundle.workflow.id,
          request: "Create my goal.",
          workspaceId: null,
          agentId: null,
          metadata: {}
        }
      })
    );
    Reflect.set(globalThis, "__agenticRepository", undefined);

    const response = await graphRoute(buildAuthorizedGetRequest("http://localhost/api/provenance/graph?limit=50"));
    const payload = (await response.json()) as {
      graph: {
        nodes: Array<{ id: string; ownerUserId: string }>;
      };
    };

    expect(response.status).toBe(200);
    expectNoStoreHeaders(response);
    expect(payload.graph.nodes.some((node) => node.id === `goal:${userBundle.goal.id}`)).toBe(true);
    expect(payload.graph.nodes.some((node) => node.id === `goal:${otherBundle.goal.id}`)).toBe(false);
    expect(payload.graph.nodes.every((node) => node.ownerUserId === SYSTEM_USER_ID)).toBe(true);
  });

  it("rejects invalid traversal limits", async () => {
    const response = await graphRoute(buildAuthorizedGetRequest("http://localhost/api/provenance/graph?depth=9"));
    const payload = (await response.json()) as { error?: string };

    expect(response.status).toBe(400);
    expect(payload.error).toContain("Too big");
  });
});
