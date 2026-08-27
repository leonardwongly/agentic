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
  type Task,
  type TaskState
} from "@agentic/contracts";
import type { ActionExecutionAdapters, ActionExecutionConnectorReadiness } from "@agentic/integrations";
import {
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
  it("makes a pending approval permanently unanswerable once its task has advanced", async () => {
    // DEFECT: respondToApproval() hard-transitions the approval's task to "queued"
    // (approve) or "blocked" (reject) with transitionTaskState(), which throws a raw
    // Error("Illegal task transition ..."). Nothing in the schema/store keeps the
    // invariant "a pending approval's task must still be answerable" - saveGoalBundle()
    // accepts a bundle whose task already advanced - so from that moment on every
    // reviewer response throws, the approval stays pending forever and
    // recomputeWorkflowStatuses() keeps the goal pinned in "waiting": the only way out
    // is deleting the goal. It is also asymmetric: from "failed"/"retrying" a reviewer can
    // still reject but can never approve.
    // Suggested fix: guard with canTransitionTaskState() and either leave the task
    // untouched (logging why) or throw a typed ApprovalMutationError so the route layer
    // can surface a reconcilable 409 instead of an unhandled 500.
    const actor = createHumanActorContext(DEFAULT_OWNER_USER_ID);
    const pending = buildPendingBundle();

    for (const state of ["running", "retrying", "failed", "completed"] as const) {
      expect(() =>
        respondToApproval({
          bundle: withTaskState(pending, state),
          approvalId: "approval-pending",
          decision: "approved",
          actor
        })
      ).toThrow(/Illegal task transition from "[a-z_]+" to "queued"/);
    }

    // Rejection survives two of those states, proving the asymmetry is the transition
    // table rather than a general "no answers after execution" rule.
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
    ).toThrow(/Illegal task transition from "completed" to "blocked"/);

    // Same escape through the durable path: the store accepts the advanced task, then
    // the answer throws an untyped error and persists nothing.
    const repository = await createApprovalRepository();
    const bundle = buildPendingBundle();
    await repository.saveGoalBundle(bundle);
    const approval = bundle.approvals[0]!;
    await repository.saveGoalBundle(withTaskState(bundle, "running"));

    const failure = await repository
      .respondToApproval({ approvalId: approval.id, decision: "approved", actor })
      .then(() => null, (error: unknown) => error);

    expect(failure).toBeInstanceOf(Error);
    expect(failure).not.toBeInstanceOf(ApprovalMutationError);
    expect((failure as Error).message).toMatch(/Illegal task transition/);

    const stranded = await repository.getGoalBundleForUser(GOAL_ID, DEFAULT_OWNER_USER_ID);
    expect(stranded?.approvals.find((candidate) => candidate.id === approval.id)?.decision).toBe("pending");
    expect(stranded?.tasks.find((task) => task.id === approval.taskId)?.state).toBe("running");
    expect(stranded?.workflow.status).toBe("waiting");
  });

  it("silently drops every approved action after the first one on a task", async () => {
    // DEFECT: findApprovedApproval()/resolveActionIntent() resolve the action by
    // taskId and take the first approved approval in array order, while the worker
    // dispatches one follow-up job per approval with approvedTaskIds: [approval.taskId].
    // The approval that actually triggered the job is therefore discarded: the second
    // approved action can never be executed (its job re-runs the first action instead),
    // yet it is marked answered. Nothing in GoalBundleSchema forbids two approvals on
    // one task, so the data model and the dispatcher disagree.
    // Suggested fix: thread the triggering approvalId through the follow-up payload and
    // select the intent by approval id (or reject/merge multi-approval tasks at plan time).
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

    // Two follow-up jobs -> two dispatches of the same task, one per approved approval.
    const dispatches = await executeApprovedTasks({
      bundle,
      approvedTaskIds: [TASK_ID, TASK_ID],
      adapters,
      connectorReadiness: approvalGradeConnectors
    });

    expect(dispatches.results).toHaveLength(2);
    expect(dispatches.results.every((result) => result.action === "create_note")).toBe(true);
    expect(dispatches.results.every((result) => result.success)).toBe(true);
    expect(createLocalNote).toHaveBeenCalledTimes(2);
    expect(createEvent).not.toHaveBeenCalled();

    // The loss is positional, not semantic: reversing the array swaps the victim.
    const reversed = buildBundle({ approvals: [secondApproved, firstApproved] });
    const single = await executeApprovedTask({
      task: reversed.tasks[0]!,
      bundle: reversed,
      adapters,
      connectorReadiness: approvalGradeConnectors
    });

    expect(single.result.action).toBe("schedule_event");
    expect(createLocalNote).toHaveBeenCalledTimes(2);
    expect(createEvent).toHaveBeenCalledTimes(1);
  });

  it("keeps the first result envelope per task and discards the authoritative one", async () => {
    // DEFECT: reconcileExecutionResults() picks results.find(taskId) - first match wins -
    // while executeApprovedTasks() happily emits one result per requested id. So a
    // duplicate delivery whose first attempt failed and whose retry actually created the
    // external artifact leaves the durable task "failed" (the success envelope is dropped
    // entirely), and in the reverse order the discarded failure still pollutes the audit
    // log. Suggested fix: reduce to one result per taskId (prefer the latest timestamp /
    // the successful one), and only derive hasFailures from applied results.
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
    expect(reconciled.tasks[0]?.state).toBe("failed");
    expect(reconciled.workflow.checkpoint).toBe("execution-recovery");
    expect(reconciled.actionLogs.filter((log) => log.kind === "task.state_changed")).toHaveLength(1);

    // Reverse arrival order (out-of-order callbacks): the task does land on completed and
    // the stale failure envelope is dropped from the state machine, but its audit log is
    // still appended - so the history shows a failure that reconciliation ignored while
    // the checkpoint quietly returns to "done".
    const reversedBundle = buildBundle();
    const reversed = reconcileExecutionResults({
      bundle: reversedBundle,
      results: [results[1]!, results[0]!],
      logs: [logs[1]!, logs[0]!]
    });

    expect(reversed.tasks[0]?.state).toBe("completed");
    expect(reversed.workflow.checkpoint).toBe("done");
    expect(reversed.actionLogs.filter((log) => log.kind === "execution.failed")).toHaveLength(1);
  });

  it("flips the recovery checkpoint for a failure envelope that matches no task", () => {
    // A result for a foreign/unknown task can never move a task, but it still counts
    // towards hasFailures, so one poison envelope rewrites the workflow checkpoint of an
    // untouched bundle. Reconciliation must attribute results before deriving recovery
    // state.
    const bundle = buildBundle();

    const reconciled = reconcileExecutionResults({
      bundle,
      results: [executionResult({ taskId: "task-that-does-not-exist", kind: "execution.failed" })]
    });

    expect(reconciled.tasks).toEqual(bundle.tasks);
    expect(reconciled.actionLogs).toHaveLength(0);
    expect(reconciled.workflow.checkpoint).toBe("execution-recovery");

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

  it("loses an approved action forever when the fallback enqueue fails", async () => {
    // DEFECT: when a port only implements respondToApproval + enqueueJob, the helper
    // commits the decision first and enqueues the follow-up job second. If that second
    // write fails, the decision is durable, no job exists, and the reviewer cannot retry
    // (already_handled) - so the approved action never executes and, unlike a
    // dead-lettered job, there is nothing left to replay: the task stays "queued"
    // forever. Suggested fix: keep the two-step fallback but recover by writing the job
    // first as a "pending-decision" record, or re-drive the follow-up from the persisted
    // approval instead of requiring a second mutation.
    const bundle = buildBundle({
      tasks: [buildTask({ state: "waiting" })],
      approvals: [buildApproval({ id: "approval-fallback", taskId: TASK_ID, decision: "pending" })]
    });
    let stored = bundle;
    const jobs: Array<{ id: string; idempotencyKey: string | null }> = [];
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

        jobs.push({ id: job.id, idempotencyKey: job.idempotencyKey ?? null });
        return job;
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
    // The decision survived the failed enqueue, and the follow-up job does not exist.
    expect(stored.approvals[0]?.decision).toBe("approved");
    expect(stored.tasks[0]?.state).toBe("queued");
    expect(jobs).toHaveLength(0);

    // Every later attempt is now rejected as a duplicate answer, so the action is lost.
    await expect(respondToApprovalAndEnqueueFollowUpJob(params)).rejects.toThrowError(ApprovalMutationError);
    expect(jobs).toHaveLength(0);
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
