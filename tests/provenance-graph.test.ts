import { JobRecordSchema, SYSTEM_USER_ID } from "@agentic/contracts";
import { createJobRecord } from "@agentic/execution";
import { createMemoryRecord } from "@agentic/memory";
import { buildExecutionProvenanceGraph } from "@agentic/repository";
import { processUserRequest } from "@agentic/orchestrator";

describe("execution provenance graph", () => {
  it("connects goals, jobs, memory-derived packets, outputs, and failures without raw payload leakage", async () => {
    const bundle = await processUserRequest({
      userId: SYSTEM_USER_ID,
      request: "Draft a concise project update that needs review.",
      memories: [],
      integrations: []
    });
    const job = createJobRecord({
      userId: SYSTEM_USER_ID,
      kind: "goal_create",
      payload: {
        type: "goal_create",
        goalId: bundle.goal.id,
        workflowId: bundle.workflow.id,
        request: "Sensitive raw job prompt should not appear in graph metadata.",
        workspaceId: null,
        agentId: null,
        metadata: {}
      }
    });
    const deadLetter = JobRecordSchema.parse({
      ...job,
      id: "dead-letter-job",
      status: "dead_letter",
      attemptCount: 1,
      lastError: "Provider returned a timeout while executing the job.",
      deadLetteredAt: "2026-04-16T00:05:00.000Z",
      updatedAt: "2026-04-16T00:05:00.000Z"
    });
    const memory = createMemoryRecord({
      id: "memory-1",
      userId: SYSTEM_USER_ID,
      category: "preferences",
      memoryType: "observed",
      content: "Prefers short updates.",
      confidence: 0.8,
      source: "test",
      sensitivity: "internal"
    });

    const graph = buildExecutionProvenanceGraph({
      userId: SYSTEM_USER_ID,
      goals: [bundle],
      jobs: [deadLetter],
      memories: [memory],
      limit: 100
    });

    expect(graph.nodes.some((node) => node.id === `goal:${bundle.goal.id}`)).toBe(true);
    expect(graph.nodes.some((node) => node.id === "job:dead-letter-job")).toBe(true);
    expect(graph.nodes.some((node) => node.id === "failure:dead-letter-job")).toBe(true);
    expect(graph.nodes.some((node) => node.id === "context_packet:ctx_memory-1")).toBe(true);
    expect(graph.edges).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ type: "queued", to: "job:dead-letter-job" }),
        expect.objectContaining({ type: "failed", to: "failure:dead-letter-job" }),
        expect.objectContaining({ type: "derived_from", to: "context_packet:ctx_memory-1" })
      ])
    );
    expect(JSON.stringify(graph)).not.toContain("Sensitive raw job prompt");
  });

  it("bounds traversal from a root node", async () => {
    const bundle = await processUserRequest({
      userId: SYSTEM_USER_ID,
      request: "Create an artifact-rich planning brief.",
      memories: [],
      integrations: []
    });
    const job = createJobRecord({
      userId: SYSTEM_USER_ID,
      kind: "goal_create",
      payload: {
        type: "goal_create",
        goalId: bundle.goal.id,
        workflowId: bundle.workflow.id,
        request: "Create a goal.",
        workspaceId: null,
        agentId: null,
        metadata: {}
      }
    });
    const memory = createMemoryRecord({
      id: "outside-root-memory",
      userId: SYSTEM_USER_ID,
      category: "outside",
      memoryType: "observed",
      content: "This packet is disconnected from the root goal.",
      confidence: 0.8,
      source: "test"
    });

    const graph = buildExecutionProvenanceGraph({
      userId: SYSTEM_USER_ID,
      goals: [bundle],
      jobs: [job],
      memories: [memory],
      rootId: `goal:${bundle.goal.id}`,
      depth: 1,
      limit: 3
    });

    expect(graph.nodes.length).toBeLessThanOrEqual(3);
    expect(graph.nodes.every((node) => node.id !== "context_packet:ctx_outside-root-memory")).toBe(true);
    expect(graph.query).toMatchObject({
      rootId: `goal:${bundle.goal.id}`,
      depth: 1,
      limit: 3
    });
  });

  it("preserves source owner ids when building nodes for shared data", async () => {
    const sourceOwnerId = "source-owner";
    const bundle = await processUserRequest({
      userId: sourceOwnerId,
      request: "Create a shared provenance brief.",
      memories: [],
      integrations: []
    });
    const job = createJobRecord({
      userId: sourceOwnerId,
      kind: "goal_create",
      payload: {
        type: "goal_create",
        goalId: bundle.goal.id,
        workflowId: bundle.workflow.id,
        request: "Create shared graph job.",
        workspaceId: null,
        agentId: null,
        metadata: {}
      }
    });
    const memory = createMemoryRecord({
      id: "shared-memory",
      userId: sourceOwnerId,
      category: "shared",
      memoryType: "observed",
      content: "Shared memory.",
      confidence: 0.8,
      source: "test"
    });

    const graph = buildExecutionProvenanceGraph({
      userId: "requesting-member",
      goals: [bundle],
      jobs: [job],
      memories: [memory],
      limit: 50
    });

    expect(graph.nodes.filter((node) => node.id !== `approval:${bundle.approvals[0]?.id}`)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: `goal:${bundle.goal.id}`, ownerUserId: sourceOwnerId }),
        expect.objectContaining({ id: `job:${job.id}`, ownerUserId: sourceOwnerId }),
        expect.objectContaining({ id: "memory:shared-memory", ownerUserId: sourceOwnerId }),
        expect.objectContaining({ id: "context_packet:ctx_shared-memory", ownerUserId: sourceOwnerId })
      ])
    );
  });

  it("keeps large graph projections bounded for traversal performance", async () => {
    const bundle = await processUserRequest({
      userId: SYSTEM_USER_ID,
      request: "Prepare a bounded provenance graph.",
      memories: [],
      integrations: []
    });
    const jobs = Array.from({ length: 180 }, (_, index) =>
      createJobRecord({
        userId: SYSTEM_USER_ID,
        kind: "goal_create",
        payload: {
          type: "goal_create",
          goalId: bundle.goal.id,
          workflowId: bundle.workflow.id,
          request: `Create graph job ${index}.`,
          workspaceId: null,
          agentId: null,
          metadata: {}
        }
      })
    );
    const memories = Array.from({ length: 180 }, (_, index) =>
      createMemoryRecord({
        id: `memory-${index}`,
        userId: SYSTEM_USER_ID,
        category: "performance",
        memoryType: "observed",
        content: `Memory ${index}`,
        confidence: 0.8,
        source: "test"
      })
    );

    const graph = buildExecutionProvenanceGraph({
      userId: SYSTEM_USER_ID,
      goals: [bundle],
      jobs,
      memories,
      limit: 120
    });

    expect(graph.nodes.length).toBeLessThanOrEqual(120);
    expect(graph.edges.every((edge) => graph.nodes.some((node) => node.id === edge.from))).toBe(true);
    expect(graph.edges.every((edge) => graph.nodes.some((node) => node.id === edge.to))).toBe(true);
  });
});
