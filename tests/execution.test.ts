import {
  appendJobExecutionJournalEntry,
  ApprovalRequestSchema,
  deriveJobRecoveryState,
  JobRecordSchema,
  WatcherSchema,
  nowIso
} from "@agentic/contracts";
import {
  computeJobRetryDelayMs,
  createDurableJobQueue,
  createJobRecord,
  createTask,
  isJobClaimable,
  processNextDurableJob,
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
        goalId: "goal-1",
        workflowId: "workflow-1",
        request: "Plan next week around focus blocks.",
        workspaceId: null,
        agentId: null,
        metadata: {}
      },
      maxAttempts: 3
    });

    expect(job.status).toBe("queued");
    expect(job.journal).toMatchObject({
      lifecycleState: "queued",
      retryCount: 0,
      sideEffectTarget: "goal:goal-1",
      replayedFromJobId: null,
      recovery: null
    });
    expect(job.journal.entries).toHaveLength(1);
    expect(job.journal.entries[0]).toMatchObject({
      state: "queued",
      attempt: 0,
      summary: "Job queued for worker execution."
    });
    expect(isJobClaimable(job, Date.parse(job.availableAt))).toBe(true);
    expect(computeJobRetryDelayMs(1, { baseDelayMs: 500, maxDelayMs: 5_000 })).toBe(500);
    expect(computeJobRetryDelayMs(4, { baseDelayMs: 500, maxDelayMs: 2_000 })).toBe(2_000);
  });

  it("preserves explicit null concurrency keys", () => {
    const job = createJobRecord({
      userId: "user-1",
      kind: "goal_create",
      concurrencyKey: null,
      payload: {
        type: "goal_create",
        goalId: "goal-1",
        workflowId: "workflow-1",
        request: "Create a job without per-key concurrency.",
        workspaceId: null,
        agentId: null,
        metadata: {}
      }
    });

    expect(job.concurrencyKey).toBeNull();
  });

  it("passes an abort signal to timed durable job handlers", async () => {
    const baseJob = createJobRecord({
      userId: "user-1",
      kind: "goal_create",
      timeoutMs: 100,
      payload: {
        type: "goal_create",
        goalId: "goal-1",
        workflowId: "workflow-1",
        request: "Exercise timeout cancellation.",
        workspaceId: null,
        agentId: null,
        metadata: {}
      }
    });
    const runningJob = JobRecordSchema.parse({
      ...baseJob,
      status: "running",
      attemptCount: 1,
      claimedBy: "worker-1",
      claimedAt: "2026-04-16T00:00:00.000Z",
      lastAttemptAt: "2026-04-16T00:00:00.000Z",
      leaseExpiresAt: "2026-04-16T00:00:30.000Z"
    });
    let observedSignal: AbortSignal | undefined;
    const queue = createDurableJobQueue(
      {
        enqueueJob: async (job) => job,
        claimNextJob: async () => runningJob,
        completeJob: async () => {
          throw new Error("Timed out job should not be acknowledged.");
        },
        retryJob: async (params) =>
          JobRecordSchema.parse({
            ...runningJob,
            status: "retrying",
            claimedBy: null,
            claimedAt: null,
            leaseExpiresAt: null,
            availableAt: params.availableAt,
            lastError: params.error
          }),
        deadLetterJob: async () => runningJob
      },
      { runnerId: "worker-1" }
    );

    const result = await processNextDurableJob({
      queue,
      handlers: {
        goal_create: async (_job, context) => {
          observedSignal = context?.signal;
          await new Promise((resolve) => setTimeout(resolve, 125));
        }
      }
    });

    expect(observedSignal).toBeDefined();
    expect(observedSignal?.aborted).toBe(true);
    expect(result.finalJob?.status).toBe("retrying");
    expect(result.finalJob?.lastError).toContain("timed out");
  });

  it("routes failures into retry and dead-letter transitions through the durable queue contract", async () => {
    const baseJob = createJobRecord({
      userId: "user-1",
      kind: "goal_create",
      payload: {
        type: "goal_create",
        goalId: "goal-1",
        workflowId: "workflow-1",
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
            journal: appendJobExecutionJournalEntry({
              journal: baseJob.journal,
              at: params.availableAt,
              status: "retrying",
              attemptCount: 1,
              summary: "Attempt 1 failed and retry 2 was scheduled.",
              error: params.error,
              metadata: {
                nextAvailableAt: params.availableAt
              },
              retryCount: 1,
              recovery: deriveJobRecoveryState({
                jobId: params.jobId,
                status: "retrying",
                payload: baseJob.payload,
                replayedFromJobId: baseJob.journal.replayedFromJobId
              })
            }),
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
            journal: appendJobExecutionJournalEntry({
              journal: baseJob.journal,
              at: params.deadLetteredAt,
              status: "dead_letter",
              attemptCount: 2,
              summary: "Job dead-lettered after 2/2 attempts.",
              error: params.error,
              retryCount: 2,
              recovery: deriveJobRecoveryState({
                jobId: params.jobId,
                status: "dead_letter",
                payload: baseJob.payload,
                replayedFromJobId: baseJob.journal.replayedFromJobId
              })
            }),
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
    expect(retried.journal).toMatchObject({
      lifecycleState: "retrying",
      retryCount: 1,
      recovery: {
        strategy: "retry_job"
      }
    });
    expect(retried.journal.entries.at(-1)).toMatchObject({
      state: "retrying",
      attempt: 1,
      error: "temporary upstream failure",
      metadata: {
        nextAvailableAt: "2026-04-16T00:00:00.500Z"
      }
    });
    expect(deadLettered.status).toBe("dead_letter");
    expect(deadLettered.deadLetteredAt).toBe("2026-04-16T00:05:00.000Z");
    expect(deadLettered.journal).toMatchObject({
      lifecycleState: "dead_letter",
      retryCount: 2,
      recovery: {
        strategy: "manual_review"
      }
    });
    expect(deadLettered.journal.entries.at(-1)).toMatchObject({
      state: "dead_letter",
      attempt: 2,
      error: "permanent upstream failure"
    });
    expect(recordedCalls.map((call) => call.type)).toEqual(["retry", "dead_letter"]);
  });

  it("dead-letters non-idempotent jobs when retry safety is required", async () => {
    const baseJob = createJobRecord({
      userId: "user-1",
      kind: "goal_create",
      payload: {
        type: "goal_create",
        goalId: "goal-1",
        workflowId: "workflow-1",
        request: "Create a side-effecting goal.",
        workspaceId: null,
        agentId: null,
        metadata: {}
      },
      idempotencyKey: null,
      maxAttempts: 3
    });
    const calls: string[] = [];
    const queue = createDurableJobQueue(
      {
        enqueueJob: async (job) => job,
        claimNextJob: async () => null,
        completeJob: async () => {
          throw new Error("completeJob should not be called");
        },
        retryJob: async () => {
          calls.push("retry");
          throw new Error("retryJob should not be called for non-idempotent failures");
        },
        deadLetterJob: async (params) => {
          calls.push("dead_letter");
          return JobRecordSchema.parse({
            ...baseJob,
            status: "dead_letter",
            attemptCount: 1,
            claimedBy: params.runnerId,
            deadLetteredAt: params.deadLetteredAt,
            lastError: params.error,
            updatedAt: params.deadLetteredAt
          });
        }
      },
      {
        runnerId: "worker-1",
        requireIdempotencyForRetry: true
      }
    );

    const running = JobRecordSchema.parse({
      ...baseJob,
      status: "running",
      attemptCount: 1,
      claimedBy: "worker-1",
      claimedAt: "2026-04-16T00:00:00.000Z",
      lastAttemptAt: "2026-04-16T00:00:00.000Z",
      leaseExpiresAt: "2026-04-16T00:00:30.000Z",
      updatedAt: "2026-04-16T00:00:00.000Z"
    });

    const finalJob = await queue.fail({
      job: running,
      error: new Error("unsafe duplicate side effect"),
      now: "2026-04-16T00:00:00.000Z"
    });

    expect(finalJob.status).toBe("dead_letter");
    expect(calls).toEqual(["dead_letter"]);
  });

  it("fails timed-out jobs through the durable processing path", async () => {
    const job = createJobRecord({
      userId: "user-1",
      kind: "goal_create",
      payload: {
        type: "goal_create",
        goalId: "goal-1",
        workflowId: "workflow-1",
        request: "Run a bounded worker task.",
        workspaceId: null,
        agentId: null,
        metadata: {}
      },
      timeoutMs: 100,
      maxAttempts: 1
    });
    const running = JobRecordSchema.parse({
      ...job,
      status: "running",
      attemptCount: 1,
      claimedBy: "worker-1",
      claimedAt: "2026-04-16T00:00:00.000Z",
      lastAttemptAt: "2026-04-16T00:00:00.000Z",
      leaseExpiresAt: "2026-04-16T00:00:30.000Z",
      updatedAt: "2026-04-16T00:00:00.000Z"
    });
    const queue = createDurableJobQueue(
      {
        enqueueJob: async (candidate) => candidate,
        claimNextJob: async () => running,
        completeJob: async () => {
          throw new Error("completeJob should not be called for a timed-out handler");
        },
        retryJob: async () => {
          throw new Error("retryJob should not be called when maxAttempts is exhausted");
        },
        deadLetterJob: async (params) =>
          JobRecordSchema.parse({
            ...running,
            status: "dead_letter",
            deadLetteredAt: params.deadLetteredAt,
            lastError: params.error,
            updatedAt: params.deadLetteredAt
          })
      },
      { runnerId: "worker-1" }
    );

    const abortObserved: string[] = [];
    const result = await processNextDurableJob({
      queue,
      handlers: {
        goal_create: async (_claimedJob, context) =>
          new Promise<void>((resolve) => {
            context.signal.addEventListener(
              "abort",
              () => {
                abortObserved.push("aborted");
                resolve();
              },
              { once: true }
            );
          })
      }
    });

    expect(abortObserved).toEqual(["aborted"]);
    expect(result.finalJob?.status).toBe("dead_letter");
    expect(result.finalJob?.lastError).toContain("timed out");
  });

  it("processes the next claimed durable job through the registered handler and acknowledges it", async () => {
    const job = createJobRecord({
      userId: "user-1",
      kind: "goal_create",
      payload: {
        type: "goal_create",
        goalId: "goal-1",
        workflowId: "workflow-1",
        request: "Prepare my weekly operating plan.",
        workspaceId: null,
        agentId: null,
        metadata: {}
      }
    });
    const handledIds: string[] = [];
    const queue = createDurableJobQueue(
      {
        enqueueJob: async (candidate) => candidate,
        claimNextJob: async () =>
          JobRecordSchema.parse({
            ...job,
            status: "running",
            attemptCount: 1,
            claimedBy: "worker-1",
            claimedAt: "2026-04-16T00:00:00.000Z",
            lastAttemptAt: "2026-04-16T00:00:00.000Z",
            leaseExpiresAt: "2026-04-16T00:00:30.000Z",
            updatedAt: "2026-04-16T00:00:00.000Z"
          }),
        completeJob: async ({ jobId, runnerId, completedAt }) =>
          JobRecordSchema.parse({
            ...job,
            id: jobId,
            status: "completed",
            attemptCount: 1,
            claimedBy: runnerId,
            claimedAt: "2026-04-16T00:00:00.000Z",
            lastAttemptAt: "2026-04-16T00:00:00.000Z",
            leaseExpiresAt: null,
            completedAt,
            updatedAt: completedAt
          }),
        retryJob: async () => {
          throw new Error("retryJob should not be called for a successful handler");
        },
        deadLetterJob: async () => {
          throw new Error("deadLetterJob should not be called for a successful handler");
        }
      },
      { runnerId: "worker-1" }
    );

    const result = await processNextDurableJob({
      queue,
      handlers: {
        goal_create: async (claimedJob) => {
          handledIds.push(claimedJob.id);
        }
      }
    });

    expect(handledIds).toEqual([job.id]);
    expect(result.claimedJob?.id).toBe(job.id);
    expect(result.finalJob?.status).toBe("completed");
  });
});
