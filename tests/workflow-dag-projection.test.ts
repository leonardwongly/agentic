import { mkdtemp } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { DEFAULT_OWNER_USER_ID, nowIso, type GoalBundle, type Task } from "@agentic/contracts";
import {
  WORKFLOW_DAG_CONTROL_LOG_KIND,
  WorkflowDagControlError,
  applyWorkflowDagControl,
  buildWorkflowDagFromBundle,
  processUserRequest,
  projectWorkflowDagInstance,
  summarizeWorkflowDag
} from "@agentic/orchestrator";
import { createRepository } from "@agentic/repository";
import { beforeAll, describe, expect, it } from "vitest";

let baseBundle: GoalBundle;
let template: Task;

beforeAll(async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "agentic-dag-projection-"));
  const repository = createRepository({ storePath: path.join(tempDir, "runtime-store.json") });
  await repository.seedDefaults(DEFAULT_OWNER_USER_ID);
  baseBundle = await processUserRequest({
    userId: DEFAULT_OWNER_USER_ID,
    request: "Plan my week, triage the inbox, and prepare for the key client meetings.",
    memories: await repository.listMemory(DEFAULT_OWNER_USER_ID),
    integrations: await repository.listIntegrations(DEFAULT_OWNER_USER_ID)
  });
  template = baseBundle.tasks[0]!;
});

function withTasks(tasks: Task[]): GoalBundle {
  return { ...structuredClone(baseBundle), tasks };
}

function task(id: string, state: Task["state"], dependsOn: string[] = []): Task {
  return { ...structuredClone(template), id, title: `Task ${id}`, state, dependsOn };
}

function withControlLog(bundle: GoalBundle, control: { action: string; status: string; at: string }): GoalBundle {
  const clone = structuredClone(bundle);
  clone.actionLogs = [
    ...clone.actionLogs,
    {
      id: `log-${control.action}`,
      goalId: clone.goal.id,
      taskId: null,
      workflowId: clone.workflow.id,
      actor: "operator",
      kind: WORKFLOW_DAG_CONTROL_LOG_KIND,
      message: `Workflow ${control.action}`,
      details: { action: control.action, status: control.status, at: control.at, compensations: [] },
      createdAt: control.at,
      prevHash: null
    }
  ];
  return clone;
}

describe("workflow DAG projection (AOS-20)", () => {
  it("derives a validated DAG with one node per task and dependency edges", () => {
    const dag = buildWorkflowDagFromBundle(baseBundle);

    expect(dag).not.toBeNull();
    expect(dag!.nodes).toHaveLength(baseBundle.tasks.length);
    expect(new Set(dag!.nodes.map((node) => node.id))).toEqual(new Set(baseBundle.tasks.map((t) => t.id)));

    const taskIds = new Set(baseBundle.tasks.map((t) => t.id));
    const expectedEdgeCount = baseBundle.tasks.reduce(
      (count, t) => count + t.dependsOn.filter((dep) => dep !== t.id && taskIds.has(dep)).length,
      0
    );
    expect(dag!.edges).toHaveLength(expectedEdgeCount);
  });

  it("returns null when the bundle has no tasks", () => {
    expect(buildWorkflowDagFromBundle(withTasks([]))).toBeNull();
    expect(summarizeWorkflowDag(withTasks([]))).toBeNull();
  });

  it("projects live task state onto node statuses", () => {
    const completed = summarizeWorkflowDag(withTasks(baseBundle.tasks.map((t) => ({ ...t, state: "completed" }))));
    expect(completed?.status).toBe("completed");
    expect(completed?.counts.completed).toBe(baseBundle.tasks.length);

    const blocked = summarizeWorkflowDag(withTasks(baseBundle.tasks.map((t) => ({ ...t, state: "blocked" }))));
    expect(blocked?.counts.paused).toBe(baseBundle.tasks.length);
    expect(blocked?.status).toBe("queued");
  });

  it("pauses a non-terminal workflow", () => {
    const controllable = withTasks([task("t-a", "completed"), task("t-b", "queued", ["t-a"])]);
    const result = applyWorkflowDagControl({ bundle: controllable, action: "pause", reason: "operator review" });
    expect(result.status).toBe("paused");
  });

  it("resumes from a persisted pause control", () => {
    const controllable = withTasks([task("t-a", "completed"), task("t-b", "queued", ["t-a"])]);
    const paused = withControlLog(controllable, { action: "pause", status: "paused", at: nowIso() });

    expect(projectWorkflowDagInstance(paused)?.status).toBe("paused");
    expect(applyWorkflowDagControl({ bundle: paused, action: "resume" }).status).toBe("running");
  });

  it("cancels and emits compensation hints for completed steps", () => {
    const controllable = withTasks([task("t-a", "completed"), task("t-b", "queued", ["t-a"])]);
    const result = applyWorkflowDagControl({ bundle: controllable, action: "cancel", reason: "duplicate run" });

    expect(result.status).toBe("cancelled");
    expect(result.compensations).toHaveLength(1);
    expect(result.compensations[0]).toContain("rollback");
  });

  it("rejects illegal control transitions", () => {
    const finished = withTasks(baseBundle.tasks.map((t) => ({ ...t, state: "completed" })));
    expect(() => applyWorkflowDagControl({ bundle: finished, action: "pause" })).toThrow(WorkflowDagControlError);
  });

  it("reflects a persisted cancel control in the projection", () => {
    const controllable = withTasks([task("t-a", "running"), task("t-b", "queued", ["t-a"])]);
    const cancelled = withControlLog(controllable, { action: "cancel", status: "cancelled", at: nowIso() });

    expect(projectWorkflowDagInstance(cancelled)?.status).toBe("cancelled");
  });
});
