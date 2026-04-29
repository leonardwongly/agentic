import { WorkflowDagSchema, nowIso, type WorkflowDag } from "@agentic/contracts";
import {
  createWorkflowDagInstance,
  inspectWorkflowDagInstance,
  retryWorkflowDagNode,
  transitionWorkflowDagInstance,
  transitionWorkflowDagNode,
  validateWorkflowDag,
  WorkflowDagValidationError
} from "@agentic/execution";

function buildDag(overrides: Partial<WorkflowDag> = {}): WorkflowDag {
  const timestamp = nowIso();

  return WorkflowDagSchema.parse({
    id: "dag-1",
    workflowId: "workflow-1",
    nodes: [
      {
        id: "draft",
        label: "Draft note",
        actionIntent: {
          type: "create_note",
          title: "Plan",
          content: "Prepare the plan."
        },
        permissionGrant: {
          capabilities: ["create"],
          maxRiskClass: "R2"
        }
      },
      {
        id: "monitor",
        label: "Monitor follow-up",
        actionIntent: {
          type: "monitor_signal",
          targetEntity: "VIP inbox",
          condition: "Important reply arrives.",
          triggerAction: "Escalate to operator.",
          sourceSystems: ["gmail"]
        },
        dependsOn: ["draft"],
        permissionGrant: {
          capabilities: ["monitor"],
          maxRiskClass: "R2"
        }
      }
    ],
    edges: [
      {
        from: "draft",
        to: "monitor"
      }
    ],
    createdAt: timestamp,
    updatedAt: timestamp,
    ...overrides
  });
}

describe("workflow DAG process model", () => {
  it("validates a typed workflow DAG with dependencies, retry, and compensation defaults", () => {
    const dag = validateWorkflowDag(buildDag());

    expect(dag.schemaVersion).toBe("v1");
    expect(dag.nodes[0]?.retryPolicy).toMatchObject({
      maxAttempts: 3,
      backoffMs: 1000
    });
    expect(dag.nodes[0]?.compensation).toMatchObject({
      actionIntent: null,
      required: false
    });
  });

  it("rejects cycles, missing nodes, and permission conflicts before execution", () => {
    const cyclic = buildDag({
      nodes: [
        {
          ...buildDag().nodes[0]!,
          dependsOn: ["monitor"]
        },
        buildDag().nodes[1]!
      ],
      edges: [
        {
          from: "draft",
          to: "monitor"
        }
      ]
    });

    expect(() => validateWorkflowDag(cyclic)).toThrow(WorkflowDagValidationError);
    expect(() =>
      validateWorkflowDag(
        buildDag({
          nodes: [
            {
              ...buildDag().nodes[0]!,
              dependsOn: ["missing-node"]
            }
          ],
          edges: []
        })
      )
    ).toThrow(/missing node/i);
    expect(() =>
      validateWorkflowDag(
        buildDag({
          nodes: [
            {
              ...buildDag().nodes[0]!,
              permissionGrant: {
                capabilities: ["read"],
                maxRiskClass: "R1"
              }
            }
          ],
          edges: []
        })
      )
    ).toThrow(/missing required capabilities|exceeds permission ceiling/i);
  });

  it("supports inspect, pause, resume, cancel, node failure, and retry transitions centrally", () => {
    const instance = createWorkflowDagInstance({
      dag: buildDag(),
      instanceId: "workflow-instance-1",
      now: "2026-04-20T00:00:00.000Z"
    });

    expect(inspectWorkflowDagInstance(instance).counts.queued).toBe(2);

    const running = transitionWorkflowDagInstance({
      instance,
      status: "running",
      now: "2026-04-20T00:01:00.000Z"
    });
    const paused = transitionWorkflowDagInstance({
      instance: running,
      status: "paused",
      reason: "Operator pause.",
      now: "2026-04-20T00:02:00.000Z"
    });
    const resumed = transitionWorkflowDagInstance({
      instance: paused,
      status: "running",
      now: "2026-04-20T00:03:00.000Z"
    });
    const firstExecution = resumed.nodeExecutions[0]!;
    const started = transitionWorkflowDagNode({
      execution: firstExecution,
      status: "running",
      runnerId: "runner-1",
      now: "2026-04-20T00:04:00.000Z"
    });
    const failed = transitionWorkflowDagNode({
      execution: started,
      status: "failed",
      error: "connector timeout",
      now: "2026-04-20T00:05:00.000Z"
    });
    const withFailedNode = {
      ...resumed,
      nodeExecutions: resumed.nodeExecutions.map((execution) => (execution.nodeId === failed.nodeId ? failed : execution))
    };
    const retried = retryWorkflowDagNode({
      instance: withFailedNode,
      nodeId: failed.nodeId,
      now: "2026-04-20T00:06:00.000Z"
    });
    const cancelled = transitionWorkflowDagInstance({
      instance: retried,
      status: "cancelled",
      reason: "Operator cancelled duplicate run.",
      now: "2026-04-20T00:07:00.000Z"
    });

    expect(retried.nodeExecutions.find((execution) => execution.nodeId === failed.nodeId)).toMatchObject({
      status: "queued",
      attemptCount: 1,
      lastError: null
    });
    expect(cancelled.status).toBe("cancelled");
    expect(cancelled.cancelReason).toContain("duplicate run");
    expect(cancelled.auditLog).toEqual(
      expect.arrayContaining([
        expect.stringContaining("transitioned from queued to running"),
        expect.stringContaining("queued retry for node draft")
      ])
    );
  });

  it("rejects duplicate worker delivery by enforcing legal node transitions", () => {
    const instance = createWorkflowDagInstance({
      dag: buildDag(),
      instanceId: "workflow-instance-duplicate",
      now: "2026-04-20T00:00:00.000Z"
    });
    const started = transitionWorkflowDagNode({
      execution: instance.nodeExecutions[0]!,
      status: "running",
      runnerId: "runner-1"
    });
    const completed = transitionWorkflowDagNode({
      execution: started,
      status: "completed"
    });

    expect(() =>
      transitionWorkflowDagNode({
        execution: completed,
        status: "running",
        runnerId: "runner-2"
      })
    ).toThrow(/Illegal workflow DAG node transition/);
  });
});
