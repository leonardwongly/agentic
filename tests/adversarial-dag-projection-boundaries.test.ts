import { describe, expect, it } from "vitest";
import { TaskSchema, nowIso, type GoalBundle } from "@agentic/contracts";
import {
  buildWorkflowDagFromBundle,
  applyWorkflowDagControl,
  WorkflowDagControlError
} from "@agentic/orchestrator";

function buildMinimalBundle(tasks: GoalBundle["tasks"]): GoalBundle {
  const goalId = "goal-boundary-test";
  const workflowId = "workflow-boundary-test";
  const timestamp = nowIso();

  return {
    goal: {
      id: goalId,
      userId: "user-1",
      workspaceId: null,
      workflowId,
      title: "Boundary test goal",
      request: "Test boundary conditions.",
      intent: "general-coordination",
      status: "running",
      confidence: 0.8,
      explanation: "Boundary test.",
      wedge: null,
      completionContract: null,
      createdAt: timestamp,
      updatedAt: timestamp
    },
    workflow: {
      id: workflowId,
      goalId,
      workspaceId: null,
      status: "running",
      currentStep: "intake",
      checkpoint: null,
      pausedAt: null,
      cancelledAt: null,
      cancelReason: null,
      createdAt: timestamp,
      updatedAt: timestamp
    },
    tasks,
    artifacts: [],
    approvals: [],
    watchers: [],
    actionLogs: []
  } as unknown as GoalBundle;
}

describe("adversarial buildWorkflowDagFromBundle edge cases", () => {
  it("filters out self-referencing dependsOn entries", () => {
    const task = TaskSchema.parse({
      id: "task-self-ref",
      goalId: "goal-boundary-test",
      workflowId: "workflow-boundary-test",
      title: "Self-referencing task",
      summary: "Depends on itself.",
      assignedAgent: "workflow",
      state: "queued",
      riskClass: "R2",
      requiresApproval: false,
      toolCapabilities: ["read"],
      dependsOn: ["task-self-ref"],
      artifactIds: [],
      createdAt: nowIso(),
      updatedAt: nowIso()
    });
    const bundle = buildMinimalBundle([task]);
    const dag = buildWorkflowDagFromBundle(bundle);
    expect(dag).not.toBeNull();
    expect(dag!.nodes[0]?.dependsOn).toEqual([]);
    expect(dag!.edges).toHaveLength(0);
  });

  it("filters out dependsOn entries referencing non-existent tasks", () => {
    const task = TaskSchema.parse({
      id: "task-ghost-dep",
      goalId: "goal-boundary-test",
      workflowId: "workflow-boundary-test",
      title: "Ghost dependency task",
      summary: "Depends on a task that does not exist.",
      assignedAgent: "workflow",
      state: "queued",
      riskClass: "R2",
      requiresApproval: false,
      toolCapabilities: ["read"],
      dependsOn: ["task-that-does-not-exist"],
      artifactIds: [],
      createdAt: nowIso(),
      updatedAt: nowIso()
    });
    const bundle = buildMinimalBundle([task]);
    const dag = buildWorkflowDagFromBundle(bundle);
    expect(dag).not.toBeNull();
    expect(dag!.nodes[0]?.dependsOn).toEqual([]);
  });

  it("returns null for a bundle with zero tasks", () => {
    const bundle = buildMinimalBundle([]);
    expect(buildWorkflowDagFromBundle(bundle)).toBeNull();
  });
});

describe("adversarial applyWorkflowDagControl edge cases", () => {
  it("throws WorkflowDagControlError when the bundle has no tasks", () => {
    const bundle = buildMinimalBundle([]);
    expect(() => applyWorkflowDagControl({ bundle, action: "pause" })).toThrow(WorkflowDagControlError);
  });

  it("pausing an already-paused workflow is idempotent", () => {
    const task = TaskSchema.parse({
      id: "task-pause-idem",
      goalId: "goal-boundary-test",
      workflowId: "workflow-boundary-test",
      title: "Pause idempotency task",
      summary: "Test.",
      assignedAgent: "workflow",
      state: "queued",
      riskClass: "R2",
      requiresApproval: false,
      toolCapabilities: ["read"],
      artifactIds: [],
      createdAt: nowIso(),
      updatedAt: nowIso()
    });
    const bundle = buildMinimalBundle([task]);
    const first = applyWorkflowDagControl({ bundle, action: "pause" });
    expect(first.status).toBe("paused");

    const pausedBundle = {
      ...bundle,
      actionLogs: [
        ...bundle.actionLogs,
        {
          id: "log-pause-1",
          goalId: bundle.goal.id,
          taskId: null,
          workflowId: bundle.workflow.id,
          actor: "operator",
          kind: "workflow.dag.control",
          message: "Paused",
          details: { action: "pause", status: "paused", at: nowIso(), compensations: [] },
          createdAt: nowIso(),
          prevHash: null
        }
      ]
    } as unknown as GoalBundle;

    const second = applyWorkflowDagControl({ bundle: pausedBundle, action: "pause" });
    expect(second.status).toBe("paused");
  });

  it("cancelling an already-cancelled workflow is idempotent", () => {
    const task = TaskSchema.parse({
      id: "task-cancel-idem",
      goalId: "goal-boundary-test",
      workflowId: "workflow-boundary-test",
      title: "Cancel idempotency task",
      summary: "Test.",
      assignedAgent: "workflow",
      state: "queued",
      riskClass: "R2",
      requiresApproval: false,
      toolCapabilities: ["read"],
      artifactIds: [],
      createdAt: nowIso(),
      updatedAt: nowIso()
    });
    const bundle = buildMinimalBundle([task]);
    const first = applyWorkflowDagControl({ bundle, action: "cancel" });
    expect(first.status).toBe("cancelled");

    const cancelledBundle = {
      ...bundle,
      actionLogs: [
        ...bundle.actionLogs,
        {
          id: "log-cancel-1",
          goalId: bundle.goal.id,
          taskId: null,
          workflowId: bundle.workflow.id,
          actor: "operator",
          kind: "workflow.dag.control",
          message: "Cancelled",
          details: { action: "cancel", status: "cancelled", at: nowIso(), compensations: [] },
          createdAt: nowIso(),
          prevHash: null
        }
      ]
    } as unknown as GoalBundle;

    const second = applyWorkflowDagControl({ bundle: cancelledBundle, action: "cancel" });
    expect(second.status).toBe("cancelled");
  });
});
