import { mkdtemp } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import {
  DEFAULT_OWNER_USER_ID,
  ActionIntentSchema,
  ApprovalRequestSchema,
  GoalBundleSchema,
  GoalSchema,
  TaskSchema,
  WorkflowStateSchema,
  createHumanActorContext,
  nowIso,
  type ActionIntent,
  type GoalBundle,
  type JobRecord,
  type Task,
  type TaskState
} from "@agentic/contracts";
import type { ActionExecutionAdapters, ActionExecutionConnectorReadiness } from "@agentic/integrations";
import {
  ApprovalResponseConflictError,
  executeApprovedTask,
  executeApprovedTasks,
  reconcileExecutionResults,
  respondToApproval,
  type ExecutionResult
} from "@agentic/orchestrator";
import { ApprovalMutationError, createRepository, type ApprovalQueueRepositoryPort } from "@agentic/repository";
import { respondToApprovalAndEnqueueFollowUpJob } from "@agentic/worker-runtime";

// ---------------------------------------------------------------------------
// Adversarial sweep #2: approval -> orchestrator -> execution-dispatch hand-off.
//
// orchestrator.test.ts, execution-dispatch.test.ts and repository.test.ts prove
// the cooperative path: one pending approval per task, a reviewer answers it, the
// follow-up job executes the typed intent and the results are reconciled. This
// file attacks the seams of that hand-off instead: approvals whose task moved on,
// more than one approved action per task, duplicate/out-of-order result
// envelopes, hostile batches of task ids, and the non-atomic fallback used when a
// repository port cannot commit "decide + enqueue" in one mutation.
//
// Deterministic by construction: synthetic goal bundles, in-process mock
// adapters, no network, no Postgres, no timers.
// ---------------------------------------------------------------------------

const GOAL_ID = "goal-adversarial-dispatch";
const WORKFLOW_ID = "workflow-adversarial-dispatch";
const TASK_ID = "task-adversarial-dispatch";

function noteIntent(title: string) {
  return ActionIntentSchema.parse({
    type: "create_note",
    title,
    content: `Body for ${title}.`
  });
}

function scheduleIntent(summary: string) {
  return ActionIntentSchema.parse({
    type: "schedule_event",
    summary,
    start: "2026-04-20T09:00:00.000Z",
    end: "2026-04-20T09:30:00.000Z",
    description: "Adversarial sweep placeholder.",
    attendees: ["owner@example.com"]
  });
}

function buildTask(overrides?: { id?: string; state?: TaskState; capabilities?: Task["toolCapabilities"] }): Task {
  return TaskSchema.parse({
    id: overrides?.id ?? TASK_ID,
    goalId: GOAL_ID,
    workflowId: WORKFLOW_ID,
    title: "Adversarial dispatch task",
    summary: "Execute a typed intent.",
    assignedAgent: "orchestrator",
    state: overrides?.state ?? "queued",
    riskClass: "R3",
    requiresApproval: true,
    toolCapabilities: overrides?.capabilities ?? ["read", "create", "schedule"],
    artifactIds: [],
    createdAt: nowIso(),
    updatedAt: nowIso()
  });
}

function buildApproval(params: {
  id: string;
  taskId: string;
  decision: "pending" | "approved" | "rejected";
  actionIntent?: ActionIntent;
}) {
  return ApprovalRequestSchema.parse({
    id: params.id,
    goalId: GOAL_ID,
    taskId: params.taskId,
    title: `Approval ${params.id}`,
    rationale: "Needs explicit confirmation.",
    riskClass: "R3",
    decision: params.decision,
    requestedAction: "Execute a typed intent.",
    actionIntent: params.actionIntent ?? noteIntent(`Note ${params.id}`),
    createdAt: nowIso(),
    expiryAt: new Date(Date.now() + 600_000).toISOString(),
    respondedAt: params.decision === "pending" ? null : nowIso()
  });
}

function buildBundle(params: {
  tasks?: Task[];
  approvals?: ReturnType<typeof buildApproval>[];
} = {}): GoalBundle {
  const tasks = params.tasks ?? [buildTask()];
  const approvals = params.approvals ?? [
    buildApproval({ id: "approval-1", taskId: tasks[0]!.id, decision: "approved" })
  ];

  return GoalBundleSchema.parse({
    goal: GoalSchema.parse({
      id: GOAL_ID,
      userId: DEFAULT_OWNER_USER_ID,
      workflowId: WORKFLOW_ID,
      title: "Adversarial dispatch goal",
      request: "Adversarial dispatch probe.",
      intent: "general-coordination",
      status: "running",
      confidence: 0.8,
      explanation: "Adversarial dispatch bundle.",
      createdAt: nowIso(),
      updatedAt: nowIso()
    }),
    workflow: WorkflowStateSchema.parse({
      id: WORKFLOW_ID,
      goalId: GOAL_ID,
      status: "waiting",
      currentStep: "approval-gate",
      checkpoint: "approval-gate",
      createdAt: nowIso(),
      updatedAt: nowIso()
    }),
    tasks,
    artifacts: [],
    approvals,
    watchers: [],
    actionLogs: []
  });
}

function withTaskState(bundle: GoalBundle, state: TaskState): GoalBundle {
  return {
    ...bundle,
    tasks: bundle.tasks.map((task) => ({ ...task, state }))
  };
}

// A bundle in the shape the planner produces: task parked in "waiting" behind a
// pending approval. Approving it is what moves the task to "queued".
function buildPendingBundle(taskState: TaskState = "waiting"): GoalBundle {
  return buildBundle({
    tasks: [buildTask({ state: taskState })],
    approvals: [buildApproval({ id: "approval-pending", taskId: TASK_ID, decision: "pending" })]
  });
}

function executionResult(params: {
  taskId: string;
  kind: ExecutionResult["kind"];
  detail?: string;
}): ExecutionResult {
  return {
    taskId: params.taskId,
    success: params.kind === "execution.completed",
    action: "create_note",
    detail: params.detail ?? "adversarial result envelope",
    timestamp: nowIso(),
    kind: params.kind
  };
}

const approvalGradeConnectors: ActionExecutionConnectorReadiness = {
  calendar: {
    tier: "approval-grade",
    label: "Approval-grade",
    reason: "Test Calendar readiness.",
    supportedModes: ["draft", "approval"],
    modeSupport: { draft: true, approval: true, autonomous: false },
    issues: [],
    managedProvider: null
  },
  gmail: {
    tier: "approval-grade",
    label: "Approval-grade",
    reason: "Test Gmail readiness.",
    supportedModes: ["draft", "approval"],
    modeSupport: { draft: true, approval: true, autonomous: false },
    issues: [],
    managedProvider: null
  }
};

function noteAdapters(createLocalNote: ActionExecutionAdapters["notes"]): ActionExecutionAdapters {
  return { notes: createLocalNote };
}

async function createApprovalRepository() {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "agentic-adversarial-orchestrator-"));
  const repository = createRepository({ storePath: path.join(tempDir, "runtime-store.json") });
  await repository.seedDefaults(DEFAULT_OWNER_USER_ID);
  return repository;
}

describe("adversarial approval/orchestrator hand-off", () => {
  it("refuses a stale approval with a typed conflict instead of stranding it", async () => {
    // Regression: respondToApproval() hard-transitioned the gated task to "queued"/"blocked"
    // with transitionTaskState(), so a reviewer answering an approval whose task had already
    // advanced threw a raw Error("Illegal task transition ...") - the route 500ed, nothing was
    // persisted, the approval stayed pending forever and the goal was pinned in "waiting".
    const actor = createHumanActorContext(DEFAULT_OWNER_USER_ID);
    const pending = buildPendingBundle();

    for (const state of ["running", "retrying", "failed", "completed"] as const) {
      const untouched = withTaskState(pending, state);

      expect(() =>
        respondToApproval({
          bundle: untouched,
          approvalId: "approval-pending",
          decision: "approved",
          actor
        })
      ).toThrow(ApprovalResponseConflictError);
      expect(() =>
        respondToApproval({ bundle: untouched, approvalId: "approval-pending", decision: "approved", actor })
      ).toThrow(new RegExp(`Cannot approve approval "approval-pending": task "${TASK_ID}" is "${state}"`));

      // The guard fires before anything is mutated, so the caller's bundle stays consistent.
      expect(untouched.approvals[0]?.decision).toBe("pending");
      expect(untouched.tasks[0]?.state).toBe(state);
    }

    // Rejection stays available wherever the transition table allows it - the guard follows
    // the table symmetrically instead of blanket-banning answers after execution started.
    const rejectedFromRunning = respondToApproval({
      bundle: withTaskState(pending, "running"),
      approvalId: "approval-pending",
      decision: "rejected",
      actor
    });
    expect(rejectedFromRunning.approvals[0]?.decision).toBe("rejected");
    expect(() =>
      respondToApproval({
        bundle: withTaskState(pending, "completed"),
        approvalId: "approval-pending",
        decision: "rejected",
        actor
      })
    ).toThrow(ApprovalResponseConflictError);

    // Same path through the durable mutation: the repository translates the conflict into its
    // own typed error (routes answer 409) and persists nothing.
    const repository = await createApprovalRepository();
    const bundle = buildPendingBundle();
    await repository.saveGoalBundle(bundle);
    const approval = bundle.approvals[0]!;
    await repository.saveGoalBundle(withTaskState(bundle, "running"));

    const failure = await repository
      .respondToApproval({ approvalId: approval.id, decision: "approved", actor })
      .then(() => null, (error: unknown) => error);

    expect(failure).toBeInstanceOf(ApprovalMutationError);
    expect((failure as ApprovalMutationError).code).toBe("conflict");
    expect((failure as Error).message).toMatch(/Cannot approve approval "approval-pending"/);

    const stranded = await repository.getGoalBundleForUser(GOAL_ID, DEFAULT_OWNER_USER_ID);
    expect(stranded?.approvals.find((candidate) => candidate.id === approval.id)?.decision).toBe("pending");
    expect(stranded?.tasks.find((task) => task.id === approval.taskId)?.state).toBe("running");
    expect(stranded?.workflow.status).toBe("waiting");
  });

  it("executes every approved action of a task once the approval is threaded through", async () => {
    // Regression: findApprovedApproval()/resolveActionIntent() resolved by taskId and took the
    // first approved approval in array order, so a second approved action on the same task
    // could never execute - its follow-up job re-ran the first intent forever while marking
    // itself answered. The follow-up payload now carries the approvalId that selected it.
    const firstApproved = buildApproval({
      id: "approval-note",
      taskId: TASK_ID,
      decision: "approved",
      actionIntent: noteIntent("Note that was approved first")
    });
    const secondApproved = buildApproval({
      id: "approval-calendar",
      taskId: TASK_ID,
      decision: "approved",
      actionIntent: scheduleIntent("Meeting that was approved second")
    });
    const bundle = buildBundle({ approvals: [firstApproved, secondApproved] });
    const createLocalNote = vi.fn().mockResolvedValue({ slug: "note-first" });
    const createEvent = vi.fn().mockResolvedValue({ id: "event-1", htmlLink: null });
    const adapters: ActionExecutionAdapters = {
      notes: { createLocalNote },
      calendar: { createEvent, updateEvent: vi.fn(), listUpcomingEvents: vi.fn() }
    };

    // Two follow-up jobs -> two dispatches of the same task, each naming its own approval.
    const dispatches = await executeApprovedTasks({
      bundle,
      approvedTaskIds: [TASK_ID],
      approvalId: "approval-note",
      adapters,
      connectorReadiness: approvalGradeConnectors
    });
    const secondDispatch = await executeApprovedTasks({
      bundle,
      approvedTaskIds: [TASK_ID],
      approvalId: "approval-calendar",
      adapters,
      connectorReadiness: approvalGradeConnectors
    });

    expect(dispatches.results.map((result) => result.action)).toEqual(["create_note"]);
    expect(secondDispatch.results.map((result) => result.action)).toEqual(["schedule_event"]);
    expect(secondDispatch.results.every((result) => result.success)).toBe(true);
    expect(createLocalNote).toHaveBeenCalledTimes(1);
    expect(createEvent).toHaveBeenCalledTimes(1);

    // The loss used to be positional, not semantic: array order no longer decides the victim.
    const reversed = buildBundle({ approvals: [secondApproved, firstApproved] });
    const byId = await executeApprovedTask({
      task: reversed.tasks[0]!,
      bundle: reversed,
      approvalId: "approval-note",
      adapters,
      connectorReadiness: approvalGradeConnectors
    });

    expect(byId.result.action).toBe("create_note");
    expect(createLocalNote).toHaveBeenCalledTimes(2);
    expect(createEvent).toHaveBeenCalledTimes(1);

    // Backwards compatibility: callers that cannot name an approval keep the historical
    // first-match resolution instead of failing.
    const legacy = await executeApprovedTask({
      task: reversed.tasks[0]!,
      bundle: reversed,
      adapters,
      connectorReadiness: approvalGradeConnectors
    });
    expect(legacy.result.action).toBe("schedule_event");
    expect(createEvent).toHaveBeenCalledTimes(2);
  });

  it("blocks execution when the named approval for the task is not approved instead of substituting", async () => {
    // Regression: findApprovedApproval() fell back to the task's first approved approval whenever
    // the named approvalId did not resolve to an *approved* one, so a stale or rejected id
    // silently ran a different approved intent. A named-but-not-approved approval for this task
    // must authorise nothing.
    const approvedNote = buildApproval({
      id: "approval-note",
      taskId: TASK_ID,
      decision: "approved",
      actionIntent: noteIntent("Note that must not run")
    });
    const rejectedOther = buildApproval({
      id: "approval-calendar-rejected",
      taskId: TASK_ID,
      decision: "rejected",
      actionIntent: scheduleIntent("Meeting that was rejected")
    });
    const bundle = buildBundle({ approvals: [approvedNote, rejectedOther] });
    const createLocalNote = vi.fn().mockResolvedValue({ slug: "note-must-not-exist" });
    const createEvent = vi.fn().mockResolvedValue({ id: "event-1", htmlLink: null });
    const adapters: ActionExecutionAdapters = {
      notes: { createLocalNote },
      calendar: { createEvent, updateEvent: vi.fn(), listUpcomingEvents: vi.fn() }
    };

    const { result } = await executeApprovedTask({
      task: bundle.tasks[0]!,
      bundle,
      approvalId: "approval-calendar-rejected",
      adapters,
      connectorReadiness: approvalGradeConnectors
    });

    // The rejected approval does not authorise the approved note intent.
    expect(createLocalNote).not.toHaveBeenCalled();
    expect(result.action).not.toBe("create_note");
  });

  it("keeps the authoritative result envelope per task when deliveries duplicate", async () => {
    // Regression: reconcileExecutionResults() took results.find(taskId) - first match wins -
    // while executeApprovedTasks() emits one result per requested id. A duplicate delivery
    // whose first attempt failed and whose retry actually created the external artifact left
    // the durable task "failed" and pinned the workflow in "execution-recovery".
    const bundle = buildBundle();
    const createLocalNote = vi
      .fn()
      .mockRejectedValueOnce(new Error("provider 500"))
      .mockResolvedValueOnce({ slug: "created-on-retry" });

    const { results, logs } = await executeApprovedTasks({
      bundle,
      approvedTaskIds: [TASK_ID, TASK_ID],
      adapters: noteAdapters({ createLocalNote })
    });
    expect(results.map((result) => result.kind)).toEqual(["execution.failed", "execution.completed"]);

    const reconciled = reconcileExecutionResults({ bundle, results, logs });
    expect(reconciled.tasks[0]?.state).toBe("completed");
    expect(reconciled.workflow.checkpoint).toBe("done");
    expect(reconciled.actionLogs.filter((log) => log.kind === "task.state_changed")).toHaveLength(1);

    // Reverse arrival order (out-of-order callbacks) reconciles to the same authoritative
    // state: one effective result per task, whichever order the envelopes arrived in.
    const reversedBundle = buildBundle();
    const reversed = reconcileExecutionResults({
      bundle: reversedBundle,
      results: [results[1]!, results[0]!],
      logs: [logs[1]!, logs[0]!]
    });

    expect(reversed.tasks[0]?.state).toBe("completed");
    expect(reversed.workflow.checkpoint).toBe("done");
    // The failed attempt really happened, so its audit entry stays in the history; only the
    // effective result drives task state and recovery checkpoint.
    expect(reversed.actionLogs.filter((log) => log.kind === "execution.failed")).toHaveLength(1);
  });

  it("ignores a failure envelope that matches no task in the bundle", () => {
    // Regression: a result for a foreign/unknown task could never move a task, but it still
    // counted towards hasFailures, so one poison envelope rewrote the workflow checkpoint of
    // an untouched bundle. Reconciliation attributes results before deriving recovery state.
    const bundle = buildBundle();

    const reconciled = reconcileExecutionResults({
      bundle,
      results: [executionResult({ taskId: "task-that-does-not-exist", kind: "execution.failed" })]
    });

    expect(reconciled.tasks).toEqual(bundle.tasks);
    expect(reconciled.actionLogs).toHaveLength(0);
    expect(reconciled.workflow.checkpoint).not.toBe("execution-recovery");
    expect(reconciled.workflow.checkpoint).toBe("resumed-after-approval");

    // A failure that does belong to a task still drives the recovery checkpoint.
    const attributed = reconcileExecutionResults({
      bundle: buildBundle(),
      results: [executionResult({ taskId: TASK_ID, kind: "execution.failed" })]
    });
    expect(attributed.tasks[0]?.state).toBe("failed");
    expect(attributed.workflow.checkpoint).toBe("execution-recovery");

    // Boundary: an empty batch with no logs is a true no-op (identity, not a rewrite).
    expect(reconcileExecutionResults({ bundle, results: [], logs: [] })).toBe(bundle);
  });

  it("treats unknown, duplicate and empty id batches as silent no-ops", async () => {
    // Boundary/robustness probe of the batch contract: the caller gets no signal for a
    // dropped id (no result, no log, no error) and no dedupe for a repeated one, so a
    // duplicated delivery is re-charged against the provider whenever the optional
    // sideEffectLedger is not injected, and the results array grows unboundedly.
    const bundle = buildBundle();
    const createLocalNote = vi.fn().mockResolvedValue({ slug: "note" });
    const adapters = noteAdapters({ createLocalNote });

    const empty = await executeApprovedTasks({ bundle, approvedTaskIds: [], adapters });
    expect(empty).toEqual({ results: [], logs: [] });

    const dropped = await executeApprovedTasks({
      bundle,
      approvedTaskIds: ["ghost-task", TASK_ID, "also-ghost"],
      adapters
    });
    expect(dropped.results).toHaveLength(1);
    expect(dropped.logs).toHaveLength(1);
    expect(dropped.results[0]?.taskId).toBe(TASK_ID);

    const duplicated = await executeApprovedTasks({
      bundle,
      approvedTaskIds: Array.from({ length: 100 }, () => TASK_ID),
      adapters
    });
    // 100 identical ids -> 100 provider calls and 100 envelopes; nothing collapses them.
    expect(duplicated.results).toHaveLength(100);
    expect(createLocalNote).toHaveBeenCalledTimes(101);
    expect(new Set(duplicated.results.map((result) => result.taskId))).toHaveLength(1);
  });

  it("isolates a mid-batch provider throw instead of aborting the remaining tasks", async () => {
    const tasks = [buildTask({ id: "task-a" }), buildTask({ id: "task-b" }), buildTask({ id: "task-c" })];
    const bundle = buildBundle({
      tasks,
      approvals: tasks.map((task, index) =>
        buildApproval({ id: `approval-${index}`, taskId: task.id, decision: "approved" })
      )
    });
    const createLocalNote = vi
      .fn()
      .mockResolvedValueOnce({ slug: "a" })
      .mockRejectedValueOnce(new Error("provider exploded"))
      .mockResolvedValueOnce({ slug: "c" });

    const { results, logs } = await executeApprovedTasks({
      bundle,
      approvedTaskIds: tasks.map((task) => task.id),
      adapters: noteAdapters({ createLocalNote })
    });

    expect(results.map((result) => [result.taskId, result.kind])).toEqual([
      ["task-a", "execution.completed"],
      ["task-b", "execution.failed"],
      ["task-c", "execution.completed"]
    ]);
    expect(logs.map((log) => log.taskId)).toEqual(["task-a", "task-b", "task-c"]);

    // Partial failure: only the two survivors move, the failed one is reconciled by the
    // caller into "failed" while the completed work stays committed.
    const reconciled = reconcileExecutionResults({ bundle, results });
    expect(reconciled.tasks.map((task) => task.state)).toEqual(["completed", "failed", "completed"]);
    expect(reconciled.workflow.checkpoint).toBe("execution-recovery");
  });

  it("re-drives the follow-up job when the fallback enqueue is lost", async () => {
    // Regression: with a port that only implements respondToApproval + enqueueJob, the helper
    // committed the decision first and enqueued second. If that second write failed the
    // decision was durable, no job existed, and every later response was rejected as
    // already_handled - the approved action was lost with nothing left to replay.
    const bundle = buildBundle({
      tasks: [buildTask({ state: "waiting" })],
      approvals: [buildApproval({ id: "approval-fallback", taskId: TASK_ID, decision: "pending" })]
    });
    let stored = bundle;
    const jobs: JobRecord[] = [];
    let breakEnqueue = true;
    const actor = createHumanActorContext(DEFAULT_OWNER_USER_ID);

    const port: ApprovalQueueRepositoryPort = {
      async respondToApproval(params) {
        const approval = stored.approvals.find((candidate) => candidate.id === params.approvalId);

        if (!approval || approval.decision !== "pending") {
          throw new ApprovalMutationError("already_handled", `Approval ${params.approvalId} has already been handled.`);
        }

        stored = respondToApproval({
          bundle: stored,
          approvalId: params.approvalId,
          decision: params.decision,
          actor: params.actor
        });
        return stored;
      },
      async enqueueJob(job) {
        if (breakEnqueue) {
          throw new Error("store write failed");
        }

        // Mirrors the real store: enqueueJob dedupes on the deterministic idempotency key.
        const existing = jobs.find((candidate) => candidate.idempotencyKey === job.idempotencyKey);

        if (existing) {
          return existing;
        }

        jobs.push(job);
        return job;
      },
      async listApprovals() {
        return stored.approvals;
      },
      async getGoalBundleForUser(goalId) {
        return stored.goal.id === goalId ? stored : null;
      }
    };

    const params = {
      repository: port,
      userId: DEFAULT_OWNER_USER_ID,
      approvalId: "approval-fallback",
      decision: "approved" as const,
      actorContext: actor
    };

    await expect(respondToApprovalAndEnqueueFollowUpJob(params)).rejects.toThrow("store write failed");
    // The decision survived the failed enqueue, and the follow-up job does not exist yet.
    expect(stored.approvals[0]?.decision).toBe("approved");
    expect(stored.tasks[0]?.state).toBe("queued");
    expect(jobs).toHaveLength(0);

    // Once the store is writable again, the next response re-drives the lost job from the
    // durable decision instead of being rejected as a duplicate answer.
    breakEnqueue = false;
    const redriven = await respondToApprovalAndEnqueueFollowUpJob(params);

    expect(redriven.job.kind).toBe("approval_follow_up");
    expect(redriven.job.maxAttempts).toBe(1);
    expect(redriven.job.payload).toMatchObject({
      type: "approval_follow_up",
      approvalId: "approval-fallback",
      goalId: GOAL_ID,
      taskId: TASK_ID,
      decision: "approved"
    });
    expect(redriven.job.idempotencyKey).toMatch(/^approval-follow-up:approval-fallback:/);
    expect(redriven.bundle.approvals[0]?.decision).toBe("approved");
    expect(jobs).toHaveLength(1);

    // A further replay of the same response stays harmless: exactly one job exists.
    const replayed = await respondToApprovalAndEnqueueFollowUpJob(params);
    expect(replayed.job.id).toBe(jobs[0]!.id);
    expect(jobs).toHaveLength(1);
  });

  it("commits decision plus exactly one follow-up job through the atomic port", async () => {
    // Control for the fallback above, and the only coverage of this entry point: the
    // atomic repository mutation must be all-or-nothing and idempotent per
    // (approval, action, decision). Also pins the zero-retry budget of approval
    // follow-up jobs: one transient provider failure dead-letters an approved action.
    const repository = await createApprovalRepository();
    const pending = buildBundle({
      tasks: [buildTask({ state: "waiting" })],
      approvals: [buildApproval({ id: "approval-atomic", taskId: TASK_ID, decision: "pending" })]
    });
    await repository.saveGoalBundle(pending);
    const actor = createHumanActorContext(DEFAULT_OWNER_USER_ID);
    const params = {
      repository,
      userId: DEFAULT_OWNER_USER_ID,
      approvalId: "approval-atomic",
      decision: "approved" as const,
      actorContext: actor
    };

    const { bundle, job } = await respondToApprovalAndEnqueueFollowUpJob(params);

    expect(bundle.approvals.find((candidate) => candidate.id === "approval-atomic")?.decision).toBe("approved");
    expect(job.kind).toBe("approval_follow_up");
    expect(job.maxAttempts).toBe(1);
    expect(job.attemptCount).toBe(0);
    expect(job.payload).toMatchObject({
      type: "approval_follow_up",
      approvalId: "approval-atomic",
      goalId: GOAL_ID,
      taskId: TASK_ID,
      decision: "approved"
    });
    expect(job.idempotencyKey).toMatch(/^approval-follow-up:approval-atomic:/);

    // A replayed response cannot fork a second job: the decision guard fires first.
    await expect(respondToApprovalAndEnqueueFollowUpJob(params)).rejects.toThrowError(ApprovalMutationError);
    const followUps = (await repository.listJobs({ userId: DEFAULT_OWNER_USER_ID })).filter(
      (candidate) => candidate.kind === "approval_follow_up"
    );
    expect(followUps).toHaveLength(1);

    // The decision and its follow-up job are both durable, not just returned in memory.
    const persisted = await repository.getGoalBundleForUser(GOAL_ID, DEFAULT_OWNER_USER_ID);
    expect(persisted?.approvals.find((candidate) => candidate.id === "approval-atomic")?.decision).toBe("approved");
    expect(await repository.getJob(job.id, DEFAULT_OWNER_USER_ID)).not.toBeNull();
  });
});
