import { mkdtemp } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { DEFAULT_OWNER_USER_ID } from "@agentic/contracts";
import { createJobRecord } from "@agentic/execution";
import { createMemoryRecord } from "@agentic/memory";
import { processUserRequest } from "@agentic/orchestrator";
import { createRepository } from "@agentic/repository";
import { createSelfImprovementRepository, EpisodeRecordSchema } from "@agentic/self-improvement-memory";
import { vi } from "vitest";
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
    Reflect.set(globalThis, "__agenticSelfImprovementRepository", undefined);
  });

  afterEach(() => {
    process.env.AGENTIC_ACCESS_KEY = originalAccessKey;
    process.env.AGENTIC_RUNTIME_STORE_PATH = originalRuntimeStorePath;
    Reflect.set(globalThis, "__agenticRepository", undefined);
    Reflect.set(globalThis, "__agenticSelfImprovementRepository", undefined);
  });

  it("returns a graph scoped to the authenticated owner", async () => {
    const repository = createRepository({
      storePath: process.env.AGENTIC_RUNTIME_STORE_PATH
    });
    const userBundle = await processUserRequest({
      userId: DEFAULT_OWNER_USER_ID,
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
        userId: DEFAULT_OWNER_USER_ID,
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
    expect(payload.graph.nodes.every((node) => node.ownerUserId === DEFAULT_OWNER_USER_ID)).toBe(true);
  });

  it("rejects invalid traversal limits", async () => {
    const response = await graphRoute(buildAuthorizedGetRequest("http://localhost/api/provenance/graph?depth=9"));
    const payload = (await response.json()) as { error?: string };

    expect(response.status).toBe(400);
    expect(payload.error).toContain("Too big");
  });

  it("resolves job roots before applying collection limits", async () => {
    const repository = createRepository({
      storePath: process.env.AGENTIC_RUNTIME_STORE_PATH
    });
    const bundle = await processUserRequest({
      userId: DEFAULT_OWNER_USER_ID,
      request: "Prepare a job-root provenance graph.",
      memories: [],
      integrations: []
    });
    await repository.saveGoalBundle(bundle);
    for (let index = 0; index < 3; index += 1) {
      const newerBundle = await processUserRequest({
        userId: DEFAULT_OWNER_USER_ID,
        request: `Prepare newer goal ${index}.`,
        memories: [],
        integrations: []
      });
      await repository.saveGoalBundle(newerBundle);
    }
    const rootJob = await repository.enqueueJob(
      createJobRecord({
        id: "older-root-job",
        userId: DEFAULT_OWNER_USER_ID,
        kind: "goal_create",
        payload: {
          type: "goal_create",
          goalId: bundle.goal.id,
          workflowId: bundle.workflow.id,
          request: "Create older root job.",
          workspaceId: null,
          agentId: null,
          metadata: {}
        }
      })
    );

    for (let index = 0; index < 5; index += 1) {
      await repository.enqueueJob(
        createJobRecord({
          id: `newer-job-${index}`,
          userId: DEFAULT_OWNER_USER_ID,
          kind: "goal_create",
          payload: {
            type: "goal_create",
            goalId: bundle.goal.id,
            workflowId: bundle.workflow.id,
            request: `Create newer job ${index}.`,
            workspaceId: null,
            agentId: null,
            metadata: {}
          }
        })
      );
    }
    Reflect.set(globalThis, "__agenticRepository", undefined);

    const response = await graphRoute(
      buildAuthorizedGetRequest(`http://localhost/api/provenance/graph?rootId=job:${rootJob.id}&limit=2`)
    );
    const payload = (await response.json()) as { graph: { nodes: Array<{ id: string }> } };

    expect(response.status).toBe(200);
    expect(payload.graph.nodes.some((node) => node.id === `job:${rootJob.id}`)).toBe(true);
    expect(payload.graph.nodes.some((node) => node.id === `goal:${bundle.goal.id}`)).toBe(true);
  });

  it("pages goals when the requested provenance limit exceeds the repository page cap", async () => {
    const repository = createRepository({
      storePath: process.env.AGENTIC_RUNTIME_STORE_PATH
    });

    for (let index = 0; index < 125; index += 1) {
      const bundle = await processUserRequest({
        userId: DEFAULT_OWNER_USER_ID,
        request: `Prepare paged provenance goal ${index}.`,
        memories: [],
        integrations: []
      });
      await repository.saveGoalBundle(bundle);
    }
    const listGoalsPageSpy = vi.spyOn(repository, "listGoalsPage");
    Reflect.set(globalThis, "__agenticRepository", repository);

    const response = await graphRoute(buildAuthorizedGetRequest("http://localhost/api/provenance/graph?limit=125"));

    expect(response.status).toBe(200);
    expect(listGoalsPageSpy).toHaveBeenCalledWith(expect.objectContaining({ userId: DEFAULT_OWNER_USER_ID, limit: 100 }));
    expect(listGoalsPageSpy).toHaveBeenCalledWith(
      expect.objectContaining({ userId: DEFAULT_OWNER_USER_ID, limit: 25, cursor: expect.any(String) })
    );
  }, 15_000);

  it("resolves long memory roots with bounded pages instead of unbounded scans", async () => {
    const repository = createRepository({
      storePath: process.env.AGENTIC_RUNTIME_STORE_PATH
    });
    const longMemoryId = `memory-${"root-".repeat(60)}`;
    const rootMemory = createMemoryRecord({
      id: longMemoryId,
      userId: DEFAULT_OWNER_USER_ID,
      category: "audit",
      memoryType: "confirmed",
      content: "Older memory root with a long upstream identifier.",
      confidence: 0.9,
      source: "test",
      createdAt: "2026-04-20T00:00:00.000Z",
      updatedAt: "2026-04-20T00:00:00.000Z"
    });
    await repository.saveMemory(rootMemory);
    for (let index = 0; index < 125; index += 1) {
      await repository.saveMemory(
        createMemoryRecord({
          id: `newer-memory-${index}`,
          userId: DEFAULT_OWNER_USER_ID,
          category: "audit",
          memoryType: "observed",
          content: `Newer memory ${index}.`,
          confidence: 0.75,
          source: "test",
          createdAt: `2026-04-21T00:${String(Math.floor(index / 60)).padStart(2, "0")}:${String(index % 60).padStart(2, "0")}.000Z`,
          updatedAt: `2026-04-21T00:${String(Math.floor(index / 60)).padStart(2, "0")}:${String(index % 60).padStart(2, "0")}.000Z`
        })
      );
    }
    const listMemoryPageSpy = vi.spyOn(repository, "listMemoryPage");
    const listMemorySpy = vi.spyOn(repository, "listMemory");
    Reflect.set(globalThis, "__agenticRepository", repository);

    const response = await graphRoute(
      buildAuthorizedGetRequest(`http://localhost/api/provenance/graph?rootId=context_packet:ctx_${longMemoryId}&limit=1`)
    );
    const payload = (await response.json()) as { graph: { nodes: Array<{ id: string }> } };

    expect(response.status).toBe(200);
    expect(payload.graph.nodes.some((node) => node.id === `context_packet:ctx_${longMemoryId}`)).toBe(true);
    expect(listMemorySpy).not.toHaveBeenCalled();
    expect(listMemoryPageSpy).toHaveBeenCalledWith(expect.objectContaining({ userId: DEFAULT_OWNER_USER_ID, limit: 100 }));
  });

  it("includes restricted owner memories in audit provenance graphs", async () => {
    const repository = createRepository({
      storePath: process.env.AGENTIC_RUNTIME_STORE_PATH
    });
    const restrictedMemory = createMemoryRecord({
      id: "restricted-owner-memory",
      userId: DEFAULT_OWNER_USER_ID,
      category: "audit",
      memoryType: "confirmed",
      content: "Restricted owner-only audit context.",
      confidence: 0.95,
      source: "test",
      sensitivity: "restricted",
      createdAt: "2026-04-20T00:00:00.000Z",
      updatedAt: "2026-04-20T00:00:00.000Z"
    });
    await repository.saveMemory(restrictedMemory);
    Reflect.set(globalThis, "__agenticRepository", undefined);

    const response = await graphRoute(buildAuthorizedGetRequest("http://localhost/api/provenance/graph?limit=10"));
    const payload = (await response.json()) as { graph: { nodes: Array<{ id: string; sensitivity?: string }> } };

    expect(response.status).toBe(200);
    expect(payload.graph.nodes).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: `memory:${restrictedMemory.id}`,
          sensitivity: "restricted"
        })
      ])
    );
  });

  it("bounds non-root provenance memory reads with the requested limit", async () => {
    const repository = createRepository({
      storePath: process.env.AGENTIC_RUNTIME_STORE_PATH
    });
    const listMemoryPageSpy = vi.spyOn(repository, "listMemoryPage");
    const listMemorySpy = vi.spyOn(repository, "listMemory");
    Reflect.set(globalThis, "__agenticRepository", repository);

    const response = await graphRoute(buildAuthorizedGetRequest("http://localhost/api/provenance/graph?limit=10"));

    expect(response.status).toBe(200);
    expect(listMemoryPageSpy).toHaveBeenCalledWith(expect.objectContaining({ userId: DEFAULT_OWNER_USER_ID, limit: 10 }));
    expect(listMemorySpy).not.toHaveBeenCalled();
  });

  it("resolves recommendation provenance through owner-scoped learning episodes", async () => {
    const runtimeTempDir = await mkdtemp(path.join(os.tmpdir(), "agentic-provenance-learning-runtime-"));
    const learningTempDir = await mkdtemp(path.join(os.tmpdir(), "agentic-provenance-learning-"));
    process.env.AGENTIC_RUNTIME_STORE_PATH = path.join(runtimeTempDir, "runtime-store.json");
    const repository = createRepository({
      storePath: process.env.AGENTIC_RUNTIME_STORE_PATH
    });
    const bundle = await processUserRequest({
      userId: DEFAULT_OWNER_USER_ID,
      request: "Prepare recommendation-linked provenance.",
      memories: [],
      integrations: []
    });
    const otherBundle = await processUserRequest({
      userId: "other-user",
      request: "Prepare hidden recommendation-linked provenance.",
      memories: [],
      integrations: []
    });
    await repository.saveGoalBundle(bundle);
    await repository.saveGoalBundle(otherBundle);
    const selfImprovementRepository = createSelfImprovementRepository({
      baseDir: path.join(learningTempDir, ".agentic", "self-improvement")
    });
    await selfImprovementRepository.seed();
    await selfImprovementRepository.appendEpisode(
      EpisodeRecordSchema.parse({
        id: "learning-episode-1",
        timestamp: "2026-04-20T00:00:00.000Z",
        skill: "communications",
        task: "Learn outbound recommendation",
        outcome: "success",
        situation: "Recommendation completed successfully.",
        rootCause: null,
        solution: "Reuse recommendation when replay gates pass.",
        lesson: "Recommendation provenance should link back to the source goal.",
        recommendation: {
          key: "execution_path:communications:send_message:R3:send",
          kind: "execution_path",
          agent: "communications",
          action: "send_message",
          confidence: 0.9,
          rationale: "Validated send path.",
          riskClass: "R3",
          capabilities: ["send"],
          sourceGoalId: bundle.goal.id,
          sourceTaskId: bundle.tasks[0]?.id ?? null,
          fallbackMode: "normal",
          evidenceHint: "established"
        },
        outcomeLink: {
          goalId: bundle.goal.id,
          workflowId: bundle.workflow.id,
          taskId: bundle.tasks[0]?.id ?? null,
          goalStatus: bundle.goal.status,
          taskState: bundle.tasks[0]?.state ?? null,
          approvalDecision: null,
          executionKind: "completed",
          outcomeScore: 1,
          userCorrection: false,
          notes: null
        },
        provenance: {
          ownerUserId: DEFAULT_OWNER_USER_ID,
          workspaceId: bundle.goal.workspaceId,
          source: "execution",
          memoryIds: [],
          actionLogIds: [],
          evidenceRecordIds: [],
          recommendationKeys: ["execution_path:communications:send_message:R3:send"]
        },
        privacy: {
          sensitivity: "R3",
          retention: {
            policy: "learning-outcome-365d",
            reviewAt: "2026-07-20T00:00:00.000Z",
            expiresAt: "2027-04-20T00:00:00.000Z"
          },
          redaction: {
            applied: false,
            fields: [],
            rules: [],
            reason: null
          }
        },
        metadata: {}
      })
    );
    await selfImprovementRepository.appendEpisode(
      EpisodeRecordSchema.parse({
        id: "foreign-learning-episode",
        timestamp: "2026-04-20T00:01:00.000Z",
        skill: "communications",
        task: "Learn foreign outbound recommendation",
        outcome: "success",
        situation: "Foreign recommendation completed successfully.",
        rootCause: null,
        solution: "Hidden.",
        lesson: "Hidden.",
        recommendation: {
          key: "execution_path:communications:send_message:R3:send",
          kind: "execution_path",
          agent: "communications",
          action: "send_message",
          confidence: 0.9,
          rationale: "Foreign send path.",
          riskClass: "R3",
          capabilities: ["send"],
          sourceGoalId: otherBundle.goal.id,
          sourceTaskId: otherBundle.tasks[0]?.id ?? null,
          fallbackMode: "normal",
          evidenceHint: "established"
        },
        outcomeLink: {
          goalId: otherBundle.goal.id,
          workflowId: otherBundle.workflow.id,
          taskId: otherBundle.tasks[0]?.id ?? null,
          goalStatus: otherBundle.goal.status,
          taskState: otherBundle.tasks[0]?.state ?? null,
          approvalDecision: null,
          executionKind: "completed",
          outcomeScore: 1,
          userCorrection: false,
          notes: null
        },
        provenance: {
          ownerUserId: "other-user",
          workspaceId: otherBundle.goal.workspaceId,
          source: "execution",
          memoryIds: [],
          actionLogIds: [],
          evidenceRecordIds: [],
          recommendationKeys: ["execution_path:communications:send_message:R3:send"]
        },
        metadata: {}
      })
    );
    Reflect.set(globalThis, "__agenticRepository", repository);
    Reflect.set(globalThis, "__agenticSelfImprovementRepository", selfImprovementRepository);

    const response = await graphRoute(
      buildAuthorizedGetRequest(
        "http://localhost/api/provenance/graph?recommendationKey=execution_path%3Acommunications%3Asend_message%3AR3%3Asend&limit=50"
      )
    );
    const payload = (await response.json()) as {
      graph: { nodes: Array<{ id: string }> };
      learning: { linkedEpisodeCount: number; linkedGoalIds: string[] };
    };

    expect(response.status).toBe(200);
    expect(payload.learning).toEqual({
      recommendationKey: "execution_path:communications:send_message:R3:send",
      linkedEpisodeCount: 1,
      linkedGoalIds: [bundle.goal.id]
    });
    expect(payload.graph.nodes.some((node) => node.id === `goal:${bundle.goal.id}`)).toBe(true);
    expect(payload.graph.nodes.some((node) => node.id === `goal:${otherBundle.goal.id}`)).toBe(false);
  });

  it("projects more than 200 memory-derived nodes when the provenance limit allows it", async () => {
    const repository = createRepository({
      storePath: process.env.AGENTIC_RUNTIME_STORE_PATH
    });

    for (let index = 0; index < 225; index += 1) {
      const padded = String(index).padStart(3, "0");
      await repository.saveMemory(
        createMemoryRecord({
          id: `memory-scale-${padded}`,
          userId: DEFAULT_OWNER_USER_ID,
          category: "scale",
          memoryType: "observed",
          content: `Scale memory ${padded}.`,
          confidence: 0.75,
          source: "test",
          createdAt: `2026-04-20T00:${String(Math.floor(index / 60)).padStart(2, "0")}:${String(index % 60).padStart(2, "0")}.000Z`,
          updatedAt: `2026-04-20T00:${String(Math.floor(index / 60)).padStart(2, "0")}:${String(index % 60).padStart(2, "0")}.000Z`
        })
      );
    }
    Reflect.set(globalThis, "__agenticRepository", undefined);

    const response = await graphRoute(buildAuthorizedGetRequest("http://localhost/api/provenance/graph?limit=500"));
    const payload = (await response.json()) as { graph: { nodes: Array<{ id: string; type: string }> } };

    expect(response.status).toBe(200);
    expect(payload.graph.nodes.filter((node) => node.type === "memory")).toHaveLength(225);
    expect(payload.graph.nodes.some((node) => node.id === "memory:memory-scale-000")).toBe(true);
  });
});
