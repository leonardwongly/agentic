import { ApprovalRequestSchema, WatcherSchema, nowIso } from "@agentic/contracts";
import { createTask, recomputeWorkflowStatuses, transitionTaskState } from "@agentic/execution";

describe("execution", () => {
  it("allows legal approval-related task transitions", () => {
    const waitingTask = createTask({
      goalId: "goal-1",
      workflowId: "workflow-1",
      title: "Await approval",
      summary: "Pause for user review.",
      assignedAgent: "workflow",
      riskClass: "R3",
      requiresApproval: true,
      toolCapabilities: ["draft"],
      state: "waiting"
    });

    expect(transitionTaskState(waitingTask, "completed").state).toBe("completed");
    expect(transitionTaskState(waitingTask, "blocked").state).toBe("blocked");
  });

  it("rejects illegal task transitions", () => {
    const completedTask = createTask({
      goalId: "goal-1",
      workflowId: "workflow-1",
      title: "Done task",
      summary: "Already finished.",
      assignedAgent: "workflow",
      riskClass: "R1",
      requiresApproval: false,
      toolCapabilities: ["read"],
      state: "completed"
    });

    expect(() => transitionTaskState(completedTask, "running")).toThrow(/Illegal task transition/);
  });

  it("prioritizes pending approvals over completion", () => {
    const task = createTask({
      goalId: "goal-1",
      workflowId: "workflow-1",
      title: "Prepared draft",
      summary: "Draft is ready.",
      assignedAgent: "communications",
      riskClass: "R3",
      requiresApproval: true,
      toolCapabilities: ["draft"],
      state: "waiting"
    });
    const approval = ApprovalRequestSchema.parse({
      id: "approval-1",
      goalId: "goal-1",
      taskId: task.id,
      title: "Review draft",
      rationale: "External commitment",
      riskClass: "R3",
      decision: "pending",
      requestedAction: "Send the reply",
      createdAt: nowIso(),
      expiryAt: new Date(Date.now() + 60_000).toISOString(),
      respondedAt: null
    });
    const watcher = WatcherSchema.parse({
      id: "watcher-1",
      goalId: "goal-1",
      targetEntity: "inbox",
      condition: "VIP reply arrives",
      frequency: "hourly",
      triggerAction: "notify user",
      sourceSystems: ["email"],
      status: "active",
      expiryAt: null,
      createdAt: nowIso(),
      updatedAt: nowIso()
    });

    expect(recomputeWorkflowStatuses([task], [approval], [watcher])).toEqual({
      goalStatus: "waiting",
      workflowStatus: "waiting"
    });
  });
});
