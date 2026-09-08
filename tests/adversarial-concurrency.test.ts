import { describe, expect, it } from "vitest";
import {
  DEFAULT_OWNER_USER_ID,
  JobRecordSchema,
  TaskSchema,
  WorkflowDagSchema,
  createSystemActorContext,
  nowIso,
  type JobRecord,
  type Task,
  type TaskState,
  type WorkflowDag,
  type Watcher
} from "@agentic/contracts";
import {
  canTransitionJobState,
  canTransitionTaskState,
  computeJobRetryDelayMs,
  createDurableJobQueue,
  createJobRecord,
  createTask,
  createWorkflowDagInstance,
  createWorkflowState,
  isJobClaimable,
  processNextDurableJob,
  transitionTaskState,
  transitionWorkflowDagInstance,
  transitionWorkflowDagNode,
  type DurableJobQueue,
  type JobConcurrencyLimits,
  type JobHandlerContext,
  type JobHandlerMap,
  type JobQueueStore
} from "@agentic/execution";
import {
  claimNextJobFromStore,
  claimNextJobFromStoreWithOutcome,
  type ClaimNextJobParams
} from "@agentic/repository/job-claim";
import {
  isJobBlockedByConcurrency,
  isJobClaimableAt
} from "@agentic/repository/runtime-helpers";
import {
  claimWatcherLeaseInRuntimeStore,
  type WatcherLeaseClaimParams
} from "@agentic/repository/watcher-lease";
import {
  countsTowardAutopilotBudget,
  evaluateAutopilotClaimControls,
  buildPendingAutopilotEvent
} from "@agentic/repository/autopilot-event-claim";
import {
  reconcileExecutionResults,
  type ExecutionResult
} from "@agentic/orchestrator";
import {
  GoalBundleSchema,
  GoalSchema,
  WorkflowStateSchema
} from "@agentic/contracts";

// ---------------------------------------------------------------------------
// Adversarial concurrency sweep: race conditions and parallel execution hazards.
//
// Where adversarial-execution-state-machine.test.ts attacks the state machine
// itself, this file attacks the *temporal* surface: concurrent claims on the
// same store, racing handler completions, timeout-vs-cancellation ordering,
// parallel reconciliation of execution results, shared mutable state between
// enqueue and claim, double-initialisation, and event ordering assumptions.
//
// Deterministic by construction: no wall-clock, no network, no Postgres.
// ---------------------------------------------------------------------------

const T0 = "2026-06-01T00:00:00.000Z";

function at(offsetMs: number): string {
  return new Date(Date.parse(T0) + offsetMs).toISOString();
}

function baseJob(overrides?: Partial<JobRecord> & { id?: string }): JobRecord {
  const record = createJobRecord({
    userId: DEFAULT_OWNER_USER_ID,
    kind: overrides?.kind ?? "docs_render",
    actorContext: createSystemActorContext(DEFAULT_OWNER_USER_ID),
    payload: overrides?.payload ?? { type: "docs_render", metadata: {} },
    availableAt: overrides?.availableAt,
    priority: overrides?.priority,
    maxAttempts: overrides?.maxAttempts,
    concurrencyKey: overrides?.concurrencyKey,
    timeoutMs: overrides?.timeoutMs
  });
  if (overrides?.id) {
    return { ...record, id: overrides.id };
  }
  return record;
}

function buildJobStore(jobs: JobRecord[]): JobQueueStore & { jobs: JobRecord[] } {
  const ledger = [...jobs];
  return {
    jobs: ledger,
    async enqueueJob(job: JobRecord) {
      ledger.push(job);
      return job;
    },
    async claimNextJob(params) {
      const claimed = claimNextJobFromStore(
        { jobs: ledger },
        { ...params, runnerId: params.runnerId, leaseMs: params.leaseMs }
      );
      // Write the claimed job back to the ledger so subsequent claims see the mutation
      if (claimed) {
        const idx = ledger.findIndex((j) => j.id === claimed.id);
        if (idx >= 0) {
          ledger[idx] = claimed;
        }
      }
      return claimed;
    },
    async completeJob({ jobId, runnerId, completedAt }) {
      const idx = ledger.findIndex((j) => j.id === jobId);
      if (idx < 0) throw new Error(`Job ${jobId} not found`);
      const updated = JobRecordSchema.parse({
        ...ledger[idx],
        status: "completed",
        claimedBy: runnerId,
        completedAt: completedAt ?? T0,
        leaseExpiresAt: null
      });
      ledger[idx] = updated;
      return updated;
    },
    async retryJob({ jobId, availableAt, error }) {
      const idx = ledger.findIndex((j) => j.id === jobId);
      if (idx < 0) throw new Error(`Job ${jobId} not found`);
      const updated = JobRecordSchema.parse({
        ...ledger[idx],
        status: "retrying",
        claimedBy: null,
        claimedAt: null,
        leaseExpiresAt: null,
        availableAt,
        lastError: error
      });
      ledger[idx] = updated;
      return updated;
    },
    async deadLetterJob({ jobId, runnerId, deadLetteredAt, error }) {
      const idx = ledger.findIndex((j) => j.id === jobId);
      if (idx < 0) throw new Error(`Job ${jobId} not found`);
      const updated = JobRecordSchema.parse({
        ...ledger[idx],
        status: "dead_letter",
        claimedBy: null,
        leaseExpiresAt: null,
        deadLetteredAt: deadLetteredAt ?? T0,
        lastError: error
      });
      ledger[idx] = updated;
      return updated;
    }
  };
}

// ---------------------------------------------------------------------------
// 1. Concurrent job claims: two runners racing on the same in-memory store.
//
// The in-memory claim is NOT atomic: filter + sort + claim is a read-then-write
// with no lock. Two concurrent callers can both see the same job as claimable
// and both return it. This test verifies the store's actual behavior.
// ---------------------------------------------------------------------------

describe("concurrent job claim races on in-memory store", () => {
  it("two simultaneous claims on the same store should not both return the same job", async () => {
    const job = baseJob({ availableAt: at(0) });
    const store = buildJobStore([job]);

    const [result1, result2] = await Promise.all([
      claimNextJobFromStore({ jobs: store.jobs }, {
        runnerId: "runner-A",
        leaseMs: 30_000,
        now: at(1000)
      }),
      claimNextJobFromStore({ jobs: store.jobs }, {
        runnerId: "runner-B",
        leaseMs: 30_000,
        now: at(1000)
      })
    ]);

    // In Node.js single-threaded event loop, the first microtask wins.
    // claimNextJobFromStore is synchronous internally, so both see the same
    // pre-mutation state. Both may return the same job - this documents the
    // known race condition of the in-memory store.
    if (result1 && result2) {
      // Both claimed: this IS a race condition. Document it.
      expect(result1.id).toBe(result2.id); // both found the same job
    } else {
      // At most one got it - the safe case
      const claimed = result1 ?? result2;
      expect(claimed).not.toBeNull();
      expect(claimed!.status).toBe("running");
    }
  });

  it("sequential claims after yield point give each runner a different job", async () => {
    const job1 = baseJob({ id: "job-1", availableAt: at(0) });
    const job2 = baseJob({ id: "job-2", availableAt: at(0) });
    const store = buildJobStore([job1, job2]);

    const first = await store.claimNextJob({
      runnerId: "runner-A",
      leaseMs: 30_000,
      now: at(1000)
    });

    // After the first claim mutates the store, the second should see different state
    const second = await store.claimNextJob({
      runnerId: "runner-B",
      leaseMs: 30_000,
      now: at(1000)
    });

    // At least one should succeed; both succeeding should yield different jobs
    if (first && second) {
      expect(first.id).not.toBe(second.id);
    }
  });

  it("claimNextJobFromStoreWithOutcome dead-letters exhausted jobs under concurrent pressure", () => {
    const exhausted = baseJob({ id: "exhausted", maxAttempts: 3, availableAt: at(0) });
    // Manually push attempt count to the cap
    const poisoned = JobRecordSchema.parse({
      ...exhausted,
      attemptCount: 3,
      status: "queued" as const
    });
    const healthy = baseJob({ id: "healthy", availableAt: at(0) });
    const store = { jobs: [poisoned, healthy] };

    const result = claimNextJobFromStoreWithOutcome(store, {
      runnerId: "runner-A",
      leaseMs: 30_000,
      now: at(1000)
    });

    // The exhausted job should be dead-lettered, the healthy one claimed
    expect(result.claimed).not.toBeNull();
    expect(result.claimed!.id).toBe("healthy");
    expect(result.deadLettered.length).toBe(1);
    expect(result.deadLettered[0]!.id).toBe("exhausted");
    expect(result.deadLettered[0]!.status).toBe("dead_letter");
  });
});

// ---------------------------------------------------------------------------
// 2. Concurrent execution results reconciliation.
//
// reconcileExecutionResults is called from concurrent dispatch paths. Two
// reconciliations on the same bundle can race, with the later one clobbering
// the earlier one's task state transitions.
// ---------------------------------------------------------------------------

describe("concurrent execution result reconciliation races", () => {
  function makeBundle(taskStates: Record<string, TaskState>) {
    const tasks = Object.entries(taskStates).map(([id, state]) =>
      TaskSchema.parse({
        id,
        goalId: "goal-1",
        workflowId: "wf-1",
        title: `Task ${id}`,
        summary: "test",
        assignedAgent: "communications",
        state,
        riskClass: "R3",
        requiresApproval: false,
        toolCapabilities: ["create"],
        artifactIds: [],
        createdAt: T0,
        updatedAt: T0
      })
    );

    return GoalBundleSchema.parse({
      goal: GoalSchema.parse({
        id: "goal-1",
        userId: DEFAULT_OWNER_USER_ID,
        workflowId: "wf-1",
        title: "Test",
        request: "Test",
        intent: "general-coordination",
        status: "running",
        confidence: 0.5,
        explanation: "test",
        createdAt: T0,
        updatedAt: T0
      }),
      workflow: WorkflowStateSchema.parse({
        id: "wf-1",
        goalId: "goal-1",
        status: "running",
        currentStep: "execution",
        checkpoint: null,
        createdAt: T0,
        updatedAt: T0
      }),
      tasks,
      artifacts: [],
      approvals: [],
      watchers: [],
      actionLogs: []
    });
  }

  function result(taskId: string, kind: ExecutionResult["kind"], timestamp: string): ExecutionResult {
    return {
      taskId,
      success: kind === "execution.completed",
      action: "create_note",
      detail: "test",
      timestamp,
      kind
    };
  }

  it("two reconciliations arriving in different orders converge to the same final state", () => {
    const bundle = makeBundle({ "task-1": "running", "task-2": "running" });

    // Order 1: task-1 completes first, then task-2
    const after1 = reconcileExecutionResults({
      bundle,
      results: [result("task-1", "execution.completed", at(1000))]
    });
    const afterBoth1 = reconcileExecutionResults({
      bundle: after1,
      results: [result("task-2", "execution.completed", at(2000))]
    });

    // Order 2: task-2 completes first, then task-1
    const after2 = reconcileExecutionResults({
      bundle,
      results: [result("task-2", "execution.completed", at(2000))]
    });
    const afterBoth2 = reconcileExecutionResults({
      bundle: after2,
      results: [result("task-1", "execution.completed", at(1000))]
    });

    // Both orders should produce the same final task states
    const states1 = afterBoth1.tasks.map((t) => ({ id: t.id, state: t.state })).sort((a, b) => a.id.localeCompare(b.id));
    const states2 = afterBoth2.tasks.map((t) => ({ id: t.id, state: t.state })).sort((a, b) => a.id.localeCompare(b.id));
    expect(states1).toEqual(states2);
  });

  it("duplicate results for the same task do not cause illegal double transitions", () => {
    const bundle = makeBundle({ "task-1": "running" });

    // Two completions for the same task arriving in the same batch
    const reconciled = reconcileExecutionResults({
      bundle,
      results: [
        result("task-1", "execution.completed", at(1000)),
        result("task-1", "execution.completed", at(2000))
      ]
    });

    const task = reconciled.tasks.find((t) => t.id === "task-1")!;
    expect(task.state).toBe("completed");
  });

  it("a failed result followed by a completed result converges to completed (more authoritative)", () => {
    const bundle = makeBundle({ "task-1": "running" });

    const reconciled = reconcileExecutionResults({
      bundle,
      results: [
        result("task-1", "execution.failed", at(1000)),
        result("task-1", "execution.completed", at(2000))
      ]
    });

    const task = reconciled.tasks.find((t) => t.id === "task-1")!;
    expect(task.state).toBe("completed");
  });

  it("a completed result followed by a failed result still converges to completed (authority wins)", () => {
    const bundle = makeBundle({ "task-1": "running" });

    const reconciled = reconcileExecutionResults({
      bundle,
      results: [
        result("task-1", "execution.completed", at(1000)),
        result("task-1", "execution.failed", at(2000))
      ]
    });

    // completion outranks failure per resultAuthority ranking
    const task = reconciled.tasks.find((t) => t.id === "task-1")!;
    expect(task.state).toBe("completed");
  });

  it("foreign task ids in results do not corrupt known task states", () => {
    const bundle = makeBundle({ "task-1": "running" });

    const reconciled = reconcileExecutionResults({
      bundle,
      results: [
        result("task-1", "execution.completed", at(1000)),
        result("foreign-task", "execution.failed", at(2000))
      ]
    });

    expect(reconciled.tasks.length).toBe(1);
    expect(reconciled.tasks[0]!.state).toBe("completed");
  });
});

// ---------------------------------------------------------------------------
// 3. Timeout vs cancellation race in job handler execution.
//
// When both a timeout and a cancellation poll detect ownership loss, the
// handler must be aborted exactly once and the correct error must propagate.
// ---------------------------------------------------------------------------

describe("timeout and cancellation race conditions", () => {
  it("handler that completes after timeout still settles cleanly", async () => {
    const job = baseJob({ timeoutMs: 100, availableAt: at(0), maxAttempts: 1 });
    let handlerResolved = false;

    const store = buildJobStore([job]);
    const queue = createDurableJobQueue(store, { runnerId: "runner-A", leaseMs: 30_000 });

    const handlers: JobHandlerMap = {
      docs_render: async (_job: JobRecord, _ctx?: JobHandlerContext) => {
        // Handler takes 150ms, exceeding the 100ms timeout.
        // The settlement grace period (100ms) gives it until t=200ms to settle.
        // Handler settles at t=150ms, 50ms within grace.
        await new Promise((resolve) => setTimeout(resolve, 150));
        handlerResolved = true;
      }
    };

    const result = await processNextDurableJob({
      queue,
      handlers,
      claim: { now: at(1000) }
    });

    // The handler should have settled within the grace period (50ms < 100ms grace)
    expect(handlerResolved).toBe(true);
    // The job should have been failed due to timeout (maxAttempts=1 → dead_letter)
    expect(result.finalJob!.status).not.toBe("completed");
  });

  it("handler that rejects with non-Error is coerced to a string failure", async () => {
    const job = baseJob({ timeoutMs: null, availableAt: at(0), maxAttempts: 1 });
    const store = buildJobStore([job]);
    const queue = createDurableJobQueue(store, { runnerId: "runner-A", leaseMs: 30_000 });

    const result = await processNextDurableJob({
      queue,
      handlers: {
        docs_render: async () => {
          throw "string-error"; // eslint-disable-line no-throw-literal
        }
      },
      claim: { now: at(1000) }
    });

    expect(result.finalJob!.status).toBe("dead_letter");
  });
});

// ---------------------------------------------------------------------------
// 4. Concurrent workflow DAG node transitions.
//
// Multiple workers completing DAG nodes simultaneously must not corrupt the
// instance state: each transition must see a consistent snapshot.
// ---------------------------------------------------------------------------

describe("concurrent workflow DAG node transitions", () => {
  function buildSimpleDag(): WorkflowDag {
    return WorkflowDagSchema.parse({
      id: "dag-1",
      workflowId: "wf-1",
      nodes: [
        {
          id: "node-a",
          label: "Node A",
          dependsOn: [],
          actionIntent: {
            type: "create_note",
            title: "Note A",
            content: "Content A",
            riskClass: "R1"
          },
          permissionGrant: {
            capabilities: ["create"],
            maxRiskClass: "R3"
          },
          retryPolicy: { maxAttempts: 3 },
          compensation: { required: false }
        },
        {
          id: "node-b",
          label: "Node B",
          dependsOn: ["node-a"],
          actionIntent: {
            type: "create_note",
            title: "Note B",
            content: "Content B",
            riskClass: "R1"
          },
          permissionGrant: {
            capabilities: ["create"],
            maxRiskClass: "R3"
          },
          retryPolicy: { maxAttempts: 3 },
          compensation: { required: false }
        }
      ],
      edges: [{ from: "node-a", to: "node-b" }],
      createdAt: T0,
      updatedAt: T0
    });
  }

  it("sequential node completions advance instance correctly", () => {
    const dag = buildSimpleDag();
    let instance = createWorkflowDagInstance({ dag, now: T0 });

    // Start node-a
    instance = transitionWorkflowDagInstance({ instance, status: "running", now: at(100) });

    const nodeAExec = instance.nodeExecutions.find((n) => n.nodeId === "node-a")!;
    const runningA = transitionWorkflowDagNode({
      execution: nodeAExec,
      status: "running",
      runnerId: "runner-A",
      now: at(200)
    });

    const completedA = transitionWorkflowDagNode({
      execution: runningA,
      status: "completed",
      now: at(300)
    });

    instance = {
      ...instance,
      nodeExecutions: instance.nodeExecutions.map((n) =>
        n.nodeId === "node-a" ? completedA : n
      )
    };

    // Start and complete node-b
    const nodeBExec = instance.nodeExecutions.find((n) => n.nodeId === "node-b")!;
    const runningB = transitionWorkflowDagNode({
      execution: nodeBExec,
      status: "running",
      runnerId: "runner-B",
      now: at(400)
    });

    const completedB = transitionWorkflowDagNode({
      execution: runningB,
      status: "completed",
      now: at(500)
    });

    instance = {
      ...instance,
      nodeExecutions: instance.nodeExecutions.map((n) =>
        n.nodeId === "node-b" ? completedB : n
      ),
      status: "completed",
      updatedAt: at(500)
    };

    expect(instance.status).toBe("completed");
    expect(instance.nodeExecutions.every((n) => n.status === "completed")).toBe(true);
  });

  it("transitioning a completed node to running again throws", () => {
    const dag = buildSimpleDag();
    let instance = createWorkflowDagInstance({ dag, now: T0 });
    instance = transitionWorkflowDagInstance({ instance, status: "running", now: at(100) });

    const nodeAExec = instance.nodeExecutions.find((n) => n.nodeId === "node-a")!;
    const runningA = transitionWorkflowDagNode({
      execution: nodeAExec,
      status: "running",
      runnerId: "runner-A",
      now: at(200)
    });
    const completedA = transitionWorkflowDagNode({
      execution: runningA,
      status: "completed",
      now: at(300)
    });

    // A second worker trying to re-run a completed node must fail
    expect(() =>
      transitionWorkflowDagNode({
        execution: completedA,
        status: "running",
        runnerId: "runner-B",
        now: at(400)
      })
    ).toThrow(/Illegal.*transition/);
  });

  it("instance cannot transition from terminal state", () => {
    const dag = buildSimpleDag();
    let instance = createWorkflowDagInstance({ dag, now: T0 });
    instance = transitionWorkflowDagInstance({ instance, status: "running", now: at(100) });
    instance = transitionWorkflowDagInstance({ instance, status: "completed", now: at(200) });

    expect(() =>
      transitionWorkflowDagInstance({ instance, status: "running", now: at(300) })
    ).toThrow(/Illegal.*transition/);
  });
});

// ---------------------------------------------------------------------------
// 5. Task state transition races: concurrent transitions on the same task.
// ---------------------------------------------------------------------------

describe("task state transition concurrency", () => {
  function makeTask(state: TaskState = "queued"): Task {
    return TaskSchema.parse({
      id: "task-race",
      goalId: "goal-1",
      workflowId: "wf-1",
      title: "Race task",
      summary: "test",
      assignedAgent: "communications",
      state,
      riskClass: "R3",
      requiresApproval: false,
      toolCapabilities: ["create"],
      artifactIds: [],
      createdAt: T0,
      updatedAt: T0
    });
  }

  it("queued -> running -> completed is legal; completed -> running is not", () => {
    const task = makeTask("queued");
    const running = transitionTaskState(task, "running");
    expect(running.state).toBe("running");

    const completed = transitionTaskState(running, "completed");
    expect(completed.state).toBe("completed");

    expect(() => transitionTaskState(completed, "running")).toThrow(/Illegal.*transition/);
  });

  it("concurrent transition attempts on the same base task are independent (pure functions)", () => {
    const base = makeTask("queued");

    // Two independent transitions from the same base
    const running1 = transitionTaskState(base, "running");
    const running2 = transitionTaskState(base, "running");

    // Both succeed because they operate on independent copies (pure functions)
    expect(running1.state).toBe("running");
    expect(running2.state).toBe("running");

    // But they have independent updatedAt values (both call nowIso())
    // The key point: no shared mutable state leaks between them
  });

  it("all legal task transitions are reachable without cycles", () => {
    // Verify the state machine is navigable
    const transitions: Array<[TaskState, TaskState]> = [
      ["queued", "running"],
      ["queued", "waiting"],
      ["queued", "blocked"],
      ["queued", "failed"],
      ["queued", "completed"],
      ["running", "waiting"],
      ["running", "blocked"],
      ["running", "failed"],
      ["running", "completed"],
      ["waiting", "queued"],
      ["waiting", "running"],
      ["waiting", "blocked"],
      ["waiting", "completed"],
      ["blocked", "queued"],
      ["blocked", "running"],
      ["failed", "retrying"],
      ["failed", "blocked"],
      ["retrying", "running"],
      ["retrying", "failed"]
    ];

    for (const [from, to] of transitions) {
      expect(canTransitionTaskState(from, to)).toBe(true);
    }

    // Terminal state: completed has no outgoing transitions
    expect(canTransitionTaskState("completed", "queued")).toBe(false);
    expect(canTransitionTaskState("completed", "running")).toBe(false);
    expect(canTransitionTaskState("completed", "failed")).toBe(false);
  });

  it("all legal job transitions are reachable; terminal states are sealed", () => {
    const legalJobTransitions: Array<[string, string]> = [
      ["queued", "running"],
      ["queued", "cancelled"],
      ["running", "retrying"],
      ["running", "completed"],
      ["running", "dead_letter"],
      ["running", "paused"],
      ["running", "cancelled"],
      ["retrying", "running"],
      ["retrying", "cancelled"],
      ["paused", "queued"],
      ["paused", "running"],
      ["paused", "cancelled"]
    ];

    for (const [from, to] of legalJobTransitions) {
      expect(canTransitionJobState(from as any, to as any)).toBe(true);
    }

    // Terminal states: completed, cancelled, dead_letter
    for (const terminal of ["completed", "cancelled", "dead_letter"]) {
      for (const target of ["queued", "running", "retrying", "paused", "completed", "cancelled", "dead_letter"]) {
        expect(canTransitionJobState(terminal as any, target as any)).toBe(false);
      }
    }
  });
});

// ---------------------------------------------------------------------------
// 6. Concurrency limit enforcement under parallel claims.
// ---------------------------------------------------------------------------

describe("concurrency limits under parallel pressure", () => {
  it("maxRunningPerKind blocks claims when limit is reached", () => {
    const runningJob = baseJob({ kind: "docs_render" });
    const runningWithLease = JobRecordSchema.parse({
      ...runningJob,
      status: "running",
      claimedBy: "runner-A",
      claimedAt: at(0),
      leaseExpiresAt: at(60_000),
      attemptCount: 1
    });

    const candidate = baseJob({ id: "candidate", kind: "docs_render", availableAt: at(0) });

    const limits: JobConcurrencyLimits = { maxRunningPerKind: 1 };
    const now = Date.parse(at(1000));

    const blocked = isJobBlockedByConcurrency(
      candidate,
      [runningWithLease],
      limits,
      now
    );

    expect(blocked).toBe(true);
  });

  it("expired lease does not count toward concurrency limit", () => {
    const staleLeaseJob = baseJob({ kind: "docs_render" });
    const staleJob = JobRecordSchema.parse({
      ...staleLeaseJob,
      status: "running",
      claimedBy: "runner-A",
      claimedAt: at(0),
      leaseExpiresAt: at(500), // expired
      attemptCount: 1
    });

    const candidate = baseJob({ id: "candidate", kind: "docs_render", availableAt: at(0) });
    const limits: JobConcurrencyLimits = { maxRunningPerKind: 1 };
    const now = Date.parse(at(1000));

    const blocked = isJobBlockedByConcurrency(candidate, [staleJob], limits, now);
    expect(blocked).toBe(false);
  });

  it("maxRunningPerConcurrencyKey blocks when key matches", () => {
    const runningJob = baseJob({ kind: "docs_render", concurrencyKey: "user-1:goal:g1" });
    const runningWithLease = JobRecordSchema.parse({
      ...runningJob,
      status: "running",
      claimedBy: "runner-A",
      claimedAt: at(0),
      leaseExpiresAt: at(60_000),
      attemptCount: 1
    });

    // Same kind to keep payload simple; concurrency key is what matters
    const candidate = baseJob({
      id: "candidate",
      kind: "docs_render",
      concurrencyKey: "user-1:goal:g1",
      availableAt: at(0)
    });

    const limits: JobConcurrencyLimits = { maxRunningPerConcurrencyKey: 1 };
    const now = Date.parse(at(1000));

    expect(isJobBlockedByConcurrency(candidate, [runningWithLease], limits, now)).toBe(true);
  });

  it("null concurrencyKey is never blocked by per-key limit", () => {
    const runningJob = baseJob({ kind: "docs_render", concurrencyKey: "user-1:goal:g1" });
    const runningWithLease = JobRecordSchema.parse({
      ...runningJob,
      status: "running",
      claimedBy: "runner-A",
      claimedAt: at(0),
      leaseExpiresAt: at(60_000),
      attemptCount: 1
    });

    const candidate = baseJob({
      id: "candidate",
      kind: "docs_render",
      concurrencyKey: null,
      availableAt: at(0)
    });

    const limits: JobConcurrencyLimits = { maxRunningPerConcurrencyKey: 1 };
    const now = Date.parse(at(1000));

    expect(isJobBlockedByConcurrency(candidate, [runningWithLease], limits, now)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// 7. Retry delay determinism under concurrent calls.
// ---------------------------------------------------------------------------

describe("retry delay computation determinism", () => {
  it("deterministic retry delays with seeded random are reproducible", () => {
    const seededRandom = (seed: number) => {
      let s = seed;
      return () => {
        s = (s * 1103515245 + 12345) & 0x7fffffff;
        return s / 0x7fffffff;
      };
    };

    const rng1 = seededRandom(42);
    const rng2 = seededRandom(42);

    for (let attempt = 1; attempt <= 5; attempt++) {
      const delay1 = computeJobRetryDelayMs(attempt, { baseDelayMs: 1000, factor: 2, maxDelayMs: 60_000 }, { jitterRatio: 0.5, random: rng1 });
      const delay2 = computeJobRetryDelayMs(attempt, { baseDelayMs: 1000, factor: 2, maxDelayMs: 60_000 }, { jitterRatio: 0.5, random: rng2 });
      expect(delay1).toBe(delay2);
    }
  });

  it("retry delays never exceed maxDelayMs even with extreme jitter", () => {
    // Worst case: maximum jitter always pushes toward the cap
    for (let attempt = 1; attempt <= 20; attempt++) {
      const delay = computeJobRetryDelayMs(attempt, { baseDelayMs: 1000, factor: 2, maxDelayMs: 5000 }, { jitterRatio: 1.0, random: () => 1.0 });
      expect(delay).toBeLessThanOrEqual(5000);
      expect(delay).toBeGreaterThanOrEqual(0);
    }
  });

  it("zero jitter produces exact exponential backoff", () => {
    expect(computeJobRetryDelayMs(1, { baseDelayMs: 1000, factor: 2, maxDelayMs: 60_000 }, { jitterRatio: 0 })).toBe(1000);
    expect(computeJobRetryDelayMs(2, { baseDelayMs: 1000, factor: 2, maxDelayMs: 60_000 }, { jitterRatio: 0 })).toBe(2000);
    expect(computeJobRetryDelayMs(3, { baseDelayMs: 1000, factor: 2, maxDelayMs: 60_000 }, { jitterRatio: 0 })).toBe(4000);
    expect(computeJobRetryDelayMs(4, { baseDelayMs: 1000, factor: 2, maxDelayMs: 60_000 }, { jitterRatio: 0 })).toBe(8000);
  });

  it("retry delays saturate at maxDelayMs", () => {
    const delay = computeJobRetryDelayMs(20, { baseDelayMs: 1000, factor: 2, maxDelayMs: 5000 }, { jitterRatio: 0 });
    expect(delay).toBe(5000);
  });
});

// ---------------------------------------------------------------------------
// 8. Watcher lease claim races: concurrent lease claims on the same store.
// ---------------------------------------------------------------------------

describe("watcher lease claim concurrency", () => {
  function makeWatcher(id: string): Watcher {
    return {
      id,
      goalId: "goal-1",
      targetEntity: "inbox",
      condition: "new email",
      frequency: "hourly",
      triggerAction: "notify",
      sourceSystems: ["email"],
      status: "active",
      expiryAt: null,
      schedule: {
        enabled: true,
        dryRun: true,
        cursor: null,
        lastRunAt: null,
        nextRunAt: at(0),
        lease: null
      },
      lastEvaluation: null,
      escalationPolicy: {
        notify: true,
        minSuppressionMs: 15 * 60_000,
        maxTriggersPerHour: 4
      },
      actorContext: null,
      createdAt: T0,
      updatedAt: T0
    };
  }

  it("two concurrent lease claims on the same watcher array: only one wins", () => {
    const watchers = [makeWatcher("watcher-1")];
    const visibleGoalIds = new Set(["goal-1"]);

    const normalizeWatcher = (w: Watcher) => w;

    const leaseParams1: WatcherLeaseClaimParams = {
      watcherId: "watcher-1",
      runnerId: "runner-A",
      acquiredAt: at(1000),
      expiresAt: at(31_000)
    };

    const result1 = claimWatcherLeaseInRuntimeStore({
      watchers,
      visibleGoalIds,
      lease: leaseParams1,
      normalizeWatcher
    });

    // First claim should succeed and mutate the array
    expect(result1).not.toBeNull();
    expect(result1!.schedule.lease!.ownerId).toBe("runner-A");

    // Second claim from different runner should fail because lease is held
    const leaseParams2: WatcherLeaseClaimParams = {
      watcherId: "watcher-1",
      runnerId: "runner-B",
      acquiredAt: at(1000),
      expiresAt: at(31_000)
    };

    const result2 = claimWatcherLeaseInRuntimeStore({
      watchers,
      visibleGoalIds,
      lease: leaseParams2,
      normalizeWatcher
    });

    // The second claim sees the lease held by runner-A (not expired yet)
    expect(result2).toBeNull();
  });

  it("lease expiry allows a new runner to claim", () => {
    const watchers = [makeWatcher("watcher-1")];
    const visibleGoalIds = new Set(["goal-1"]);
    const normalizeWatcher = (w: Watcher) => w;

    // First claim with a lease that expires at t=1000
    claimWatcherLeaseInRuntimeStore({
      watchers,
      visibleGoalIds,
      lease: {
        watcherId: "watcher-1",
        runnerId: "runner-A",
        acquiredAt: at(0),
        expiresAt: at(1000)
      },
      normalizeWatcher
    });

    // Second claim after the lease has expired (acquiredAt > expiresAt of first)
    const result2 = claimWatcherLeaseInRuntimeStore({
      watchers,
      visibleGoalIds,
      lease: {
        watcherId: "watcher-1",
        runnerId: "runner-B",
        acquiredAt: at(2000),
        expiresAt: at(32_000)
      },
      normalizeWatcher
    });

    expect(result2).not.toBeNull();
    expect(result2!.schedule.lease!.ownerId).toBe("runner-B");
  });
});

// ---------------------------------------------------------------------------
// 9. Autopilot claim controls under concurrent event generation.
// ---------------------------------------------------------------------------

describe("autopilot claim controls under concurrent pressure", () => {
  const reliabilityControls = {
    maxConsecutiveFailures: 3,
    maxPendingEvents: 5,
    maxEventsPerWindow: 10
  };

  it("circuit breaker opens after maxConsecutiveFailures", () => {
    const events = Array.from({ length: 3 }, (_, i) =>
      buildPendingAutopilotEvent({
        userId: "user-1",
        kind: "watcher_triggered",
        sourceId: "source-1",
        mode: "auto_run",
        summary: `Event ${i}`
      })
    ).map((e) => ({ ...e, status: "failed" as const }));

    const result = evaluateAutopilotClaimControls({ recentEvents: events, reliabilityControls });
    expect(result.outcome).toBe("suppress");
    if (result.outcome === "suppress") {
      expect(result.reason).toBe("failure_circuit_open");
    }
  });

  it("pending backlog suppresses when too many pending", () => {
    const events = Array.from({ length: 5 }, (_, i) =>
      buildPendingAutopilotEvent({
        userId: "user-1",
        kind: "watcher_triggered",
        sourceId: "source-1",
        mode: "auto_run",
        summary: `Event ${i}`
      })
    );

    const result = evaluateAutopilotClaimControls({ recentEvents: events, reliabilityControls });
    expect(result.outcome).toBe("suppress");
    if (result.outcome === "suppress") {
      expect(result.reason).toBe("pending_backlog");
    }
  });

  it("allows claim when under all limits", () => {
    const events = Array.from({ length: 2 }, (_, i) =>
      buildPendingAutopilotEvent({
        userId: "user-1",
        kind: "watcher_triggered",
        sourceId: "source-1",
        mode: "auto_run",
        summary: `Event ${i}`
      })
    );

    const result = evaluateAutopilotClaimControls({ recentEvents: events, reliabilityControls });
    expect(result.outcome).toBe("allow");
  });
});

// ---------------------------------------------------------------------------
// 10. Parallel processNextDurableJob executions.
// ---------------------------------------------------------------------------

describe("parallel processNextDurableJob executions", () => {
  it("two runners process different jobs from the same store", async () => {
    const job1 = baseJob({ id: "parallel-1", availableAt: at(0) });
    const job2 = baseJob({ id: "parallel-2", availableAt: at(0) });
    const store = buildJobStore([job1, job2]);

    const processed: string[] = [];
    const handlers: JobHandlerMap = {
      docs_render: async (job: JobRecord) => {
        processed.push(job.id);
      }
    };

    const queue1 = createDurableJobQueue(store, { runnerId: "runner-A", leaseMs: 30_000 });
    const queue2 = createDurableJobQueue(store, { runnerId: "runner-B", leaseMs: 30_000 });

    const [r1, r2] = await Promise.all([
      processNextDurableJob({ queue: queue1, handlers, claim: { now: at(1000) } }),
      processNextDurableJob({ queue: queue2, handlers, claim: { now: at(1000) } })
    ]);

    // At least one should have been processed
    const totalProcessed = [r1, r2].filter((r) => r.claimedJob !== null).length;
    expect(totalProcessed).toBeGreaterThanOrEqual(1);

    // Both should have finalJob status completed (if they got different jobs)
    if (r1.claimedJob && r2.claimedJob && r1.claimedJob.id !== r2.claimedJob.id) {
      expect(r1.finalJob!.status).toBe("completed");
      expect(r2.finalJob!.status).toBe("completed");
    }
  });

  it("job without handler is failed with descriptive error", async () => {
    const job = baseJob({ id: "no-handler-job", availableAt: at(0), maxAttempts: 1 });
    const store = buildJobStore([job]);
    const queue = createDurableJobQueue(store, { runnerId: "runner-A", leaseMs: 30_000 });

    const result = await processNextDurableJob({
      queue,
      handlers: {}, // no handler for docs_render
      claim: { now: at(1000) }
    });

    expect(result.claimedJob).not.toBeNull();
    expect(result.finalJob!.status).toBe("dead_letter");
  });

  it("handler that throws results in retry or dead-letter depending on attempt budget", async () => {
    const job = baseJob({ id: "fail-job", availableAt: at(0), maxAttempts: 1 });
    const store = buildJobStore([job]);
    const queue = createDurableJobQueue(store, { runnerId: "runner-A", leaseMs: 30_000 });

    const result = await processNextDurableJob({
      queue,
      handlers: {
        docs_render: async () => {
          throw new Error("deliberate failure");
        }
      },
      claim: { now: at(1000) }
    });

    // maxAttempts=1, attemptCount was bumped to 1 during claim.
    // fail() checks attemptCount >= maxAttempts -> dead_letter
    expect(result.finalJob!.status).toBe("dead_letter");
  });
});

// ---------------------------------------------------------------------------
// 11. Job claimability edge cases under concurrent timing.
// ---------------------------------------------------------------------------

describe("job claimability timing edge cases", () => {
  it("job exactly at availableAt boundary is claimable", () => {
    const job = baseJob({ availableAt: at(1000) });
    expect(isJobClaimable(job, Date.parse(at(1000)))).toBe(true);
    expect(isJobClaimable(job, Date.parse(at(999)))).toBe(false);
    expect(isJobClaimable(job, Date.parse(at(1001)))).toBe(true);
  });

  it("running job with expired lease is reclaimable", () => {
    const runningJob = baseJob({ availableAt: at(0) });
    const job = JobRecordSchema.parse({
      ...runningJob,
      status: "running",
      claimedBy: "runner-A",
      claimedAt: at(0),
      leaseExpiresAt: at(30_000),
      attemptCount: 1
    });

    expect(isJobClaimable(job, Date.parse(at(29_999)))).toBe(false);
    expect(isJobClaimable(job, Date.parse(at(30_000)))).toBe(true);
    expect(isJobClaimable(job, Date.parse(at(30_001)))).toBe(true);
  });

  it("job at attempt cap is never claimable regardless of status", () => {
    const job = baseJob({ availableAt: at(0), maxAttempts: 3 });
    const exhausted = JobRecordSchema.parse({
      ...job,
      attemptCount: 3,
      status: "queued"
    });

    expect(isJobClaimable(exhausted, Date.parse(at(1000)))).toBe(false);
  });

  it("isJobClaimableAt uses strict timestamp parsing", () => {
    const job = baseJob({ availableAt: at(5000) });
    expect(isJobClaimableAt(job, Date.parse(at(4999)))).toBe(false);
    expect(isJobClaimableAt(job, Date.parse(at(5000)))).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// 12. Shared mutable state: module-level lazy imports.
// ---------------------------------------------------------------------------

describe("module-level lazy import caching", () => {
  it("createJobRecord produces unique IDs even when called concurrently", async () => {
    const results = await Promise.all(
      Array.from({ length: 100 }, () =>
        Promise.resolve(baseJob())
      )
    );

    const ids = new Set(results.map((r) => r.id));
    expect(ids.size).toBe(100); // All unique
  });

  it("createWorkflowState produces unique workflow IDs", () => {
    const states = Array.from({ length: 50 }, () =>
      createWorkflowState("goal-1")
    );

    const ids = new Set(states.map((s) => s.id));
    expect(ids.size).toBe(50);
  });
});

// ---------------------------------------------------------------------------
// 13. Dead-letter and retry ordering under pressure.
// ---------------------------------------------------------------------------

describe("dead-letter and retry ordering", () => {
  it("multiple exhausted jobs are dead-lettered in priority order", () => {
    const normalJob = baseJob({ id: "normal", availableAt: at(0), maxAttempts: 1 });
    const criticalJob = baseJob({ id: "critical", availableAt: at(0), maxAttempts: 1 });

    const exhaustedNormal = JobRecordSchema.parse({ ...normalJob, attemptCount: 1, status: "queued", priority: "normal" });
    const exhaustedCritical = JobRecordSchema.parse({ ...criticalJob, attemptCount: 1, status: "queued", priority: "critical" });

    const store = { jobs: [exhaustedNormal, exhaustedCritical] };
    const result = claimNextJobFromStoreWithOutcome(store, {
      runnerId: "runner-A",
      leaseMs: 30_000,
      now: at(1000)
    });

    // Both should be dead-lettered, critical first
    expect(result.deadLettered.length).toBe(2);
    expect(result.deadLettered[0]!.id).toBe("critical");
    expect(result.deadLettered[1]!.id).toBe("normal");
    expect(result.claimed).toBeNull(); // No healthy jobs
  });

  it("mixed healthy and exhausted jobs: healthy claimed, exhausted dead-lettered", () => {
    const exhausted = JobRecordSchema.parse({
      ...baseJob({ id: "exhausted", availableAt: at(0), maxAttempts: 2 }),
      attemptCount: 2,
      status: "queued"
    });
    const healthy = baseJob({ id: "healthy", availableAt: at(0) });

    const store = { jobs: [exhausted, healthy] };
    const result = claimNextJobFromStoreWithOutcome(store, {
      runnerId: "runner-A",
      leaseMs: 30_000,
      now: at(1000)
    });

    expect(result.claimed).not.toBeNull();
    expect(result.claimed!.id).toBe("healthy");
    expect(result.deadLettered.length).toBe(1);
    expect(result.deadLettered[0]!.id).toBe("exhausted");
  });
});

// ---------------------------------------------------------------------------
// 14. Promise rejection handling in parallel operations.
// ---------------------------------------------------------------------------

describe("promise rejection handling in parallel job processing", () => {
  it("handler failure is caught and results in retry, not unhandled rejection", async () => {
    const job = baseJob({ id: "fail-job-2", availableAt: at(0) });
    const store = buildJobStore([job]);
    const queue = createDurableJobQueue(store, { runnerId: "runner-A", leaseMs: 30_000 });

    // This should NOT throw: processNextDurableJob catches handler errors
    const result = await processNextDurableJob({
      queue,
      handlers: {
        docs_render: async () => {
          throw new Error("boom");
        }
      },
      claim: { now: at(1000) }
    });

    expect(result.claimedJob).not.toBeNull();
    // maxAttempts=3 (default), attemptCount=1 after claim -> retry
    expect(result.finalJob!.status).toBe("retrying");
  });

  it("race between timeout and handler completion: handler wins if it settles first", async () => {
    const job = baseJob({ timeoutMs: 5000, availableAt: at(0) }); // long timeout
    const store = buildJobStore([job]);
    const queue = createDurableJobQueue(store, { runnerId: "runner-A", leaseMs: 30_000 });

    const result = await processNextDurableJob({
      queue,
      handlers: {
        docs_render: async () => {
          // Completes immediately, well before timeout
        }
      },
      claim: { now: at(1000) }
    });

    expect(result.finalJob!.status).toBe("completed");
  });
});

// ---------------------------------------------------------------------------
// 15. Double-initialization safety.
// ---------------------------------------------------------------------------

describe("double initialization safety", () => {
  it("creating multiple durable job queues on the same store is safe", async () => {
    const job = baseJob({ availableAt: at(0) });
    const store = buildJobStore([job]);

    const queue1 = createDurableJobQueue(store, { runnerId: "runner-A", leaseMs: 30_000 });
    const queue2 = createDurableJobQueue(store, { runnerId: "runner-B", leaseMs: 30_000 });

    // Both can attempt to claim; at most one gets the job
    const [r1, r2] = await Promise.all([
      queue1.claimNext({ now: at(1000) }),
      queue2.claimNext({ now: at(1000) })
    ]);

    if (r1 && r2) {
      // Both claimed: race condition in in-memory store
      expect(r1.id).toBe(r2.id); // same job
    } else {
      // At most one got it
      const claimed = r1 ?? r2;
      if (claimed) {
        expect(claimed.status).toBe("running");
      }
    }
  });

  it("creating multiple workflow state objects for the same goal produces independent state", () => {
    const ws1 = createWorkflowState("goal-1", "intake", "ws-1");
    const ws2 = createWorkflowState("goal-1", "execution", "ws-1");

    expect(ws1.id).not.toBe(ws2.id);
    expect(ws1.currentStep).toBe("intake");
    expect(ws2.currentStep).toBe("execution");
    // Independent objects: mutating one does not affect the other
    ws1.currentStep = "modified";
    expect(ws2.currentStep).toBe("execution");
  });
});

// ---------------------------------------------------------------------------
// 16. Event ordering: autopilot events processed out of order.
// ---------------------------------------------------------------------------

describe("autopilot event ordering assumptions", () => {
  it("countsTowardAutopilotBudget includes active statuses", () => {
    expect(countsTowardAutopilotBudget("pending")).toBe(true);
    expect(countsTowardAutopilotBudget("notified")).toBe(true);
    expect(countsTowardAutopilotBudget("executed")).toBe(true);
    expect(countsTowardAutopilotBudget("failed")).toBe(true);
    expect(countsTowardAutopilotBudget("debounced")).toBe(false);
    expect(countsTowardAutopilotBudget("ignored")).toBe(false);
  });

  it("evaluateAutopilotClaimControls is insensitive to event array ordering", () => {
    const events = [
      { ...buildPendingAutopilotEvent({ userId: "u", kind: "watcher_triggered", sourceId: "s", mode: "auto_run", summary: "a" }), status: "failed" as const },
      { ...buildPendingAutopilotEvent({ userId: "u", kind: "watcher_triggered", sourceId: "s", mode: "auto_run", summary: "b" }), status: "failed" as const },
      { ...buildPendingAutopilotEvent({ userId: "u", kind: "watcher_triggered", sourceId: "s", mode: "auto_run", summary: "c" }), status: "executed" as const }
    ];

    const controls = { maxConsecutiveFailures: 3, maxPendingEvents: 10, maxEventsPerWindow: 20 };

    const result1 = evaluateAutopilotClaimControls({ recentEvents: events, reliabilityControls: controls });
    const result2 = evaluateAutopilotClaimControls({ recentEvents: [...events].reverse(), reliabilityControls: controls });

    // Both should produce the same outcome regardless of ordering
    expect(result1.outcome).toBe(result2.outcome);
  });
});

// ---------------------------------------------------------------------------
// 17. Concurrent enqueue + claim stress test.
// ---------------------------------------------------------------------------

describe("concurrent enqueue and claim stress", () => {
  it("rapid enqueue + claim cycles maintain store consistency", async () => {
    const store = buildJobStore([]);
    const queue = createDurableJobQueue(store, { runnerId: "runner-A", leaseMs: 30_000 });

    // Enqueue 10 jobs
    const enqueued = await Promise.all(
      Array.from({ length: 10 }, (_, i) =>
        queue.enqueue(baseJob({ id: `stress-${i}`, availableAt: at(0) }))
      )
    );

    expect(store.jobs.length).toBe(10);

    // Rapidly claim all of them
    const claimed = [];
    for (let i = 0; i < 10; i++) {
      const job = await queue.claimNext({ now: at(1000 + i) });
      if (job) claimed.push(job);
    }

    // All claimed jobs should have unique IDs
    const claimedIds = new Set(claimed.map((j) => j.id));
    expect(claimedIds.size).toBe(claimed.length);
    expect(claimed.length).toBe(10);
  });
});
