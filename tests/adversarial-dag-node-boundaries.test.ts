import { describe, expect, it } from "vitest";
import { nowIso } from "@agentic/contracts";
import {
  transitionWorkflowDagNode,
  retryWorkflowDagNode,
  createWorkflowDagInstance,
  validateWorkflowDag,
  WorkflowDagValidationError,
  transitionWorkflowDagInstance
} from "@agentic/execution";

function buildNodeExecution(overrides?: Partial<{ status: string; attemptCount: number; maxAttempts: number }>) {
  return {
    id: "instance-1:node-1",
    instanceId: "instance-1",
    nodeId: "node-1",
    status: (overrides?.status ?? "queued") as "queued" | "running" | "paused" | "completed" | "failed" | "skipped" | "cancelled",
    attemptCount: overrides?.attemptCount ?? 0,
    maxAttempts: overrides?.maxAttempts ?? 3,
    runnerId: null,
    lastError: null,
    startedAt: null,
    completedAt: null,
    updatedAt: nowIso()
  };
}

function buildMinimalDag(dagId = "dag-test") {
  return validateWorkflowDag({
    id: dagId,
    workflowId: "wf-test",
    nodes: [
      {
        id: "node-1",
        label: "Test node",
        actionIntent: {
          type: "manual_review",
          riskClass: "R2",
          actionType: "artifact-only",
          summary: "Test",
          reason: "Test"
        },
        permissionGrant: { capabilities: ["read"], maxRiskClass: "R2" }
      }
    ],
    edges: [],
    createdAt: nowIso(),
    updatedAt: nowIso()
  });
}

describe("adversarial workflow DAG node transitions", () => {
  it("rejects transitioning a completed node to any other state", () => {
    const execution = buildNodeExecution({ status: "completed" });
    const targets = ["queued", "running", "paused", "failed", "skipped", "cancelled"];
    for (const target of targets) {
      expect(() =>
        transitionWorkflowDagNode({ execution, status: target as "queued" })
      ).toThrow(/Illegal workflow DAG node transition/i);
    }
  });

  it("rejects transitioning a skipped node to any other state", () => {
    const execution = buildNodeExecution({ status: "skipped" });
    const targets = ["queued", "running", "paused", "completed", "failed", "cancelled"];
    for (const target of targets) {
      expect(() =>
        transitionWorkflowDagNode({ execution, status: target as "queued" })
      ).toThrow(/Illegal workflow DAG node transition/i);
    }
  });

  it("rejects transitioning a cancelled node to any other state", () => {
    const execution = buildNodeExecution({ status: "cancelled" });
    const targets = ["queued", "running", "paused", "completed", "failed", "skipped"];
    for (const target of targets) {
      expect(() =>
        transitionWorkflowDagNode({ execution, status: target as "queued" })
      ).toThrow(/Illegal workflow DAG node transition/i);
    }
  });

  it("increments attempt count only when starting a new attempt from queued or failed", () => {
    const queued = buildNodeExecution({ status: "queued", attemptCount: 0 });
    const running = transitionWorkflowDagNode({ execution: queued, status: "running" });
    expect(running.attemptCount).toBe(1);

    const paused = transitionWorkflowDagNode({ execution: running, status: "paused" });
    expect(paused.attemptCount).toBe(1);

    const resumed = transitionWorkflowDagNode({ execution: paused, status: "running" });
    expect(resumed.attemptCount).toBe(1);
  });

  it("rejects starting a new attempt when the retry budget is exhausted", () => {
    const exhausted = buildNodeExecution({ status: "failed", attemptCount: 3, maxAttempts: 3 });
    expect(() =>
      transitionWorkflowDagNode({ execution: exhausted, status: "running" })
    ).toThrow(/exhausted retry attempts/i);
  });

  it("allows retrying a failed node within budget via retryWorkflowDagNode", () => {
    const dag = buildMinimalDag("dag-retry");
    const instance = createWorkflowDagInstance({ dag, instanceId: "inst-retry" });

    const running = {
      ...instance,
      nodeExecutions: instance.nodeExecutions.map((ne) =>
        ne.nodeId === "node-1" ? transitionWorkflowDagNode({ execution: ne, status: "running" }) : ne
      )
    };
    const failed = {
      ...running,
      nodeExecutions: running.nodeExecutions.map((ne) =>
        ne.nodeId === "node-1"
          ? transitionWorkflowDagNode({ execution: ne, status: "failed", error: "test failure" })
          : ne
      )
    };

    const retried = retryWorkflowDagNode({ instance: failed, nodeId: "node-1" });
    const retriedNode = retried.nodeExecutions.find((ne) => ne.nodeId === "node-1");
    expect(retriedNode?.status).toBe("queued");
    expect(retriedNode?.lastError).toBeNull();
  });

  it("rejects retrying a node that is not in failed state", () => {
    const dag = buildMinimalDag("dag-no-retry");
    const instance = createWorkflowDagInstance({ dag, instanceId: "inst-no-retry" });
    expect(() =>
      retryWorkflowDagNode({ instance, nodeId: "node-1" })
    ).toThrow(/must be failed before it can be retried/i);
  });

  it("rejects retrying a non-existent node", () => {
    const dag = buildMinimalDag("dag-missing");
    const instance = createWorkflowDagInstance({ dag, instanceId: "inst-missing" });
    expect(() =>
      retryWorkflowDagNode({ instance, nodeId: "node-that-does-not-exist" })
    ).toThrow(/was not found/i);
  });
});

describe("adversarial workflow DAG instance transitions", () => {
  it("rejects transitioning a completed instance to running", () => {
    const dag = buildMinimalDag("dag-term");
    let instance = createWorkflowDagInstance({ dag, instanceId: "inst-term" });
    instance = transitionWorkflowDagInstance({ instance, status: "running" });
    instance = transitionWorkflowDagInstance({ instance, status: "completed" });
    expect(() =>
      transitionWorkflowDagInstance({ instance, status: "running" })
    ).toThrow(/Illegal workflow DAG transition/i);
  });

  it("rejects transitioning a cancelled instance to any state", () => {
    const dag = buildMinimalDag("dag-cancel");
    let instance = createWorkflowDagInstance({ dag, instanceId: "inst-cancel" });
    instance = transitionWorkflowDagInstance({ instance, status: "cancelled" });
    const targets = ["queued", "running", "paused", "completed", "failed"];
    for (const target of targets) {
      expect(() =>
        transitionWorkflowDagInstance({ instance, status: target as "queued" })
      ).toThrow(/Illegal workflow DAG transition/i);
    }
  });
});

describe("adversarial validateWorkflowDag edge cases", () => {
  it("rejects a DAG where action risk exceeds permission ceiling", () => {
    expect(() =>
      validateWorkflowDag({
        id: "dag-risk-exceed",
        workflowId: "wf-risk",
        nodes: [
          {
            id: "node-1",
            label: "Over-risked node",
            actionIntent: {
              type: "manual_review",
              riskClass: "R4",
              actionType: "artifact-only",
              summary: "Test",
              reason: "Test"
            },
            permissionGrant: { capabilities: ["read"], maxRiskClass: "R2" }
          }
        ],
        edges: [],
        createdAt: nowIso(),
        updatedAt: nowIso()
      })
    ).toThrow(WorkflowDagValidationError);
  });

  it("rejects a DAG with a compensation-required node missing compensation intent", () => {
    expect(() =>
      validateWorkflowDag({
        id: "dag-comp-missing",
        workflowId: "wf-comp",
        nodes: [
          {
            id: "node-1",
            label: "Compensation node",
            actionIntent: {
              type: "create_note",
              title: "Create",
              content: "Content"
            },
            permissionGrant: { capabilities: ["create"], maxRiskClass: "R2" },
            compensation: { required: true, actionIntent: null }
          }
        ],
        edges: [],
        createdAt: nowIso(),
        updatedAt: nowIso()
      })
    ).toThrow(WorkflowDagValidationError);
  });

  it("reports multiple validation issues in a single error", () => {
    try {
      validateWorkflowDag({
        id: "dag-multi-issue",
        workflowId: "wf-multi",
        nodes: [
          {
            id: "node-a",
            label: "Node A",
            actionIntent: {
              type: "send_message",
              mode: "send",
              to: "test@example.com",
              subject: "Test",
              body: "Body"
            },
            permissionGrant: { capabilities: ["read"], maxRiskClass: "R1" }
          },
          {
            id: "node-b",
            label: "Node B",
            actionIntent: {
              type: "schedule_event",
              summary: "Meeting",
              start: "2026-05-01T09:00:00Z",
              end: "2026-05-01T10:00:00Z",
              attendees: []
            },
            permissionGrant: { capabilities: ["read"], maxRiskClass: "R1" }
          }
        ],
        edges: [],
        createdAt: nowIso(),
        updatedAt: nowIso()
      });
      expect.fail("Should have thrown");
    } catch (error) {
      expect(error).toBeInstanceOf(WorkflowDagValidationError);
      const validationError = error as WorkflowDagValidationError;
      expect(validationError.issues.length).toBeGreaterThanOrEqual(2);
    }
  });
});
