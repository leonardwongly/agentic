import { ApprovalRequestSchema, JobRecordSchema, WatcherSchema, nowIso } from "@agentic/contracts";
import {
  computeJobRetryDelayMs,
  createDurableJobQueue,
  createJobRecord,
  createTask,
  isJobClaimable,
  recomputeWorkflowStatuses,
  transitionTaskState
} from "@agentic/execution";

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

  it("creates claimable goal jobs with bounded retry backoff", () => {
    const job = createJobRecord({
      userId: "user-1",
      kind: "goal_create",
      payload: {
        type: "goal_create",
        request: "Plan next week around focus blocks.",
        workspaceId: null,
        agentId: null,
        metadata: {}
      },
      maxAttempts: 3
    });

    expect(job.status).toBe("queued");
    expect(isJobClaimable(job, Date.parse(job.availableAt))).toBe(true);
    expect(computeJobRetryDelayMs(1, { baseDelayMs: 500, maxDelayMs: 5_000 })).toBe(500);
    expect(computeJobRetryDelayMs(4, { baseDelayMs: 500, maxDelayMs: 2_000 })).toBe(2_000);
  });

  it("routes failures into retry and dead-letter transitions through the durable queue contract", async () => {
    const baseJob = createJobRecord({
      userId: "user-1",
      kind: "goal_create",
      payload: {
        type: "goal_create",
        request: "Draft a customer update.",
        workspaceId: null,
        agentId: null,
        metadata: {}
      },
      maxAttempts: 2
    });
    const recordedCalls: Array<{ type: "retry" | "dead_letter"; payload: Record<string, unknown> }> = [];
    const queue = createDurableJobQueue(
      {
        enqueueJob: async (job) => job,
        claimNextJob: async () => null,
        completeJob: async ({ jobId, runnerId, completedAt }) =>
          JobRecordSchema.parse({
            ...baseJob,
            id: jobId,
            status: "completed",
            claimedBy: runnerId,
            completedAt,
            updatedAt: completedAt
          }),
        retryJob: async (params) => {
          recordedCalls.push({ type: "retry", payload: params as unknown as Record<string, unknown> });
          return JobRecordSchema.parse({
            ...baseJob,
            id: params.jobId,
            status: "retrying",
            attemptCount: 1,
            claimedBy: null,
            claimedAt: null,
            leaseExpiresAt: null,
            availableAt: params.availableAt,
            lastError: params.error,
            updatedAt: params.availableAt
          });
        },
        deadLetterJob: async (params) => {
          recordedCalls.push({ type: "dead_letter", payload: params as unknown as Record<string, unknown> });
          return JobRecordSchema.parse({
            ...baseJob,
            id: params.jobId,
            status: "dead_letter",
            attemptCount: 2,
            claimedBy: params.runnerId,
            claimedAt: "2026-04-16T00:00:00.000Z",
            leaseExpiresAt: null,
            deadLetteredAt: params.deadLetteredAt,
            lastError: params.error,
            updatedAt: params.deadLetteredAt
          });
        }
      },
      {
        runnerId: "worker-1",
        retryPolicy: {
          baseDelayMs: 500,
          maxDelayMs: 1_000
        }
      }
    );

    const firstAttempt = JobRecordSchema.parse({
      ...baseJob,
      status: "running",
      attemptCount: 1,
      claimedBy: "worker-1",
      claimedAt: "2026-04-16T00:00:00.000Z",
      lastAttemptAt: "2026-04-16T00:00:00.000Z",
      leaseExpiresAt: "2026-04-16T00:00:30.000Z",
      updatedAt: "2026-04-16T00:00:00.000Z"
    });
    const secondAttempt = JobRecordSchema.parse({
      ...firstAttempt,
      attemptCount: 2
    });

    const retried = await queue.fail({
      job: firstAttempt,
      error: new Error("temporary upstream failure"),
      now: "2026-04-16T00:00:00.000Z"
    });
    const deadLettered = await queue.fail({
      job: secondAttempt,
      error: "permanent upstream failure",
      now: "2026-04-16T00:05:00.000Z"
    });

    expect(retried.status).toBe("retrying");
    expect(retried.availableAt).toBe("2026-04-16T00:00:00.500Z");
    expect(deadLettered.status).toBe("dead_letter");
    expect(deadLettered.deadLetteredAt).toBe("2026-04-16T00:05:00.000Z");
    expect(recordedCalls.map((call) => call.type)).toEqual(["retry", "dead_letter"]);
  });
});
