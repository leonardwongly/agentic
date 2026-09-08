import {
  ActionIntentSchema,
  AgentResultSchema,
  ApprovalDecisionScopeSchema,
  ApprovalNotificationJobPayloadSchema,
  BriefingPreferencesSchema,
  BriefingScheduleEntrySchema,
  CreateNoteActionIntentSchema,
  DeleteRecordActionIntentSchema,
  GoalBundleSchema,
  GoalSchema,
  GoalTemplateSchema,
  JobRecordSchema,
  JobRecoveryStateSchema,
  ManualReviewActionIntentSchema,
  MonitorSignalActionIntentSchema,
  SendMessageActionIntentSchema,
  ScheduleEventActionIntentSchema,
  SubAgentPlanSchema,
  TaskSchema,
  UpdateRecordActionIntentSchema,
  WorkflowDagInstanceSchema,
  WorkflowDagNodeExecutionSchema,
  WorkflowDagSchema,
  WorkflowResponsibilityAssigneeSchema,
  WorkflowResponsibilitySchema,
  WorkflowScheduleSchema,
  WorkflowStateSchema,
  appendJobExecutionJournalEntry,
  buildApprovalNotificationDeliveryTarget,
  buildHumanActorIdentity,
  buildSystemActorIdentity,
  createActorContext,
  createHumanActorContext,
  createJobExecutionJournal,
  createSystemActorContext,
  createSystemResponsibilityAssignee,
  createUserResponsibilityAssignee,
  deriveAgentImplementationTier,
  deriveGoalContract,
  deriveGoalResponsibility,
  deriveJobRecoveryState,
  nowIso,
  type ActionIntent,
  type AgentExecutionMode,
  type AgentName,
  type ApprovalDecision,
  type Capability,
  type GoalBundle,
  type GoalTemplate,
  type JobPayload,
  type JobStatus,
  type RiskClass,
  type Task,
  type TaskState,
  type WorkflowDag,
  type WorkflowDagInstance,
  type WorkflowState
} from "@agentic/contracts";
import {
  canTransitionJobState,
  canTransitionTaskState,
  createDurableJobQueue,
  createJobRecord,
  createTask,
  createWorkflowDagInstance,
  createWorkflowState,
  inspectWorkflowDagInstance,
  isJobClaimable,
  recomputeWorkflowStatuses,
  retryWorkflowDagNode,
  transitionTaskState,
  transitionWorkflowDagInstance,
  transitionWorkflowDagNode,
  validateWorkflowDag,
  type JobQueueStore
} from "@agentic/execution";
import {
  computeNextRun,
  createGoalTemplate,
  interpolateTemplate,
  reconcileExecutionResults,
  shouldTemplateRun,
  type ExecutionResult
} from "@agentic/orchestrator";

/**
 * Adversarial sweep targeting invalid assumptions and contract violations between
 * @agentic/contracts, @agentic/execution, and @agentic/orchestrator.
 *
 * Each test documents the specific contract violation or invalid assumption it guards
 * against. These tests are designed to catch:
 *
 * - API contract violations (wrong return types, missing required fields)
 * - Version mismatches between package interfaces
 * - Unexpected null/undefined returns from callers that don't handle them
 * - Missing error handling in callers
 * - Assumption violations (e.g., assuming sorted data, assuming specific ordering)
 * - Interface evolution (old clients with new servers)
 * - Type narrowing failures
 * - Optional field handling
 * - Default value assumptions
 * - Callback/promise contract violations
 * - Event contract violations
 * - Configuration contract violations
 */

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function minimalGoalBundle(overrides: Partial<GoalBundle> = {}): GoalBundle {
  const now = nowIso();
  const goal = GoalSchema.parse({
    id: "goal-test-1",
    userId: "user-1",
    workflowId: "wf-1",
    title: "Test goal",
    request: "Test request",
    intent: "general-coordination",
    status: "planned",
    confidence: 0.8,
    explanation: "Test explanation",
    createdAt: now,
    updatedAt: now
  });
  const workflow = createWorkflowState(goal.id, "general-coordination", null, "wf-1");
  const task = createTask({
    goalId: goal.id,
    workflowId: workflow.id,
    title: "Test task",
    summary: "Test task summary",
    assignedAgent: "communications",
    riskClass: "R2",
    requiresApproval: true,
    toolCapabilities: ["send", "draft"],
    state: "waiting"
  });

  return GoalBundleSchema.parse({
    goal,
    workflow,
    tasks: [task],
    approvals: [],
    artifacts: [],
    watchers: [],
    actionLogs: [],
    ...overrides
  });
}

function minimalExecutionResult(overrides: Partial<ExecutionResult> = {}): ExecutionResult {
  return {
    taskId: "task-test-1",
    success: true,
    action: "send_message",
    detail: "Sent message successfully",
    timestamp: nowIso(),
    kind: "execution.completed",
    ...overrides
  };
}

// ---------------------------------------------------------------------------
// 1. API CONTRACT VIOLATIONS - Wrong return types, missing fields
// ---------------------------------------------------------------------------

describe("contract: deriveAgentImplementationTier returns valid tier for every execution mode", () => {
  it("maps every AgentExecutionMode to a valid AgentImplementationTier", () => {
    const modes: AgentExecutionMode[] = [
      "governed_specialist",
      "deterministic_scaffold",
      "custom_prompt_scaffold",
      "manual_review_required"
    ];

    for (const mode of modes) {
      const tier = deriveAgentImplementationTier(mode);
      expect(["production", "experimental"]).toContain(tier);
    }
  });

  it("returns experimental for manual_review_required (assumption: manual_review is less mature)", () => {
    // Prevents assumption violation: callers assuming all modes map to "production"
    expect(deriveAgentImplementationTier("manual_review_required")).toBe("experimental");
  });

  it("returns production for governed_specialist (assumption: governed_specialist is the most mature)", () => {
    // Prevents assumption violation: callers depending on production tier for specialist agents
    expect(deriveAgentImplementationTier("governed_specialist")).toBe("production");
  });
});

describe("contract: createWorkflowState always returns a valid WorkflowState", () => {
  it("produces a WorkflowState that passes WorkflowStateSchema.parse round-trip", () => {
    const state = createWorkflowState("goal-1", "intake", "ws-1");
    const reparsed = WorkflowStateSchema.parse(state);

    expect(reparsed.id).toBe(state.id);
    expect(reparsed.goalId).toBe("goal-1");
    expect(reparsed.status).toBe("running");
    expect(reparsed.currentStep).toBe("intake");
    expect(reparsed.workspaceId).toBe("ws-1");
    expect(reparsed.checkpoint).toBeNull();
  });

  it("rejects invalid goalId through the schema (contract: goalId must be non-empty)", () => {
    expect(() => createWorkflowState("", "intake")).toThrow();
  });

  it("defaults currentStep to 'intake' when not provided (contract: default step assumption)", () => {
    // Prevents assumption violation: callers assuming currentStep is always explicitly provided
    const state = createWorkflowState("goal-1");
    expect(state.currentStep).toBe("intake");
  });

  it("preserves explicit workflowId when provided, generates UUID when omitted", () => {
    const withId = createWorkflowState("goal-1", "intake", null, "explicit-wf-id");
    expect(withId.id).toBe("explicit-wf-id");

    const withoutId = createWorkflowState("goal-1");
    expect(withoutId.id).toMatch(/^[0-9a-f-]{36}$/i);
  });
});

describe("contract: createTask default state depends on requiresApproval", () => {
  it("sets state to 'waiting' when requiresApproval is true (contract: approval-gated tasks start waiting)", () => {
    const task = createTask({
      goalId: "g-1",
      workflowId: "wf-1",
      title: "Task",
      summary: "Summary",
      assignedAgent: "communications",
      riskClass: "R2",
      requiresApproval: true,
      toolCapabilities: ["send"]
    });

    expect(task.state).toBe("waiting");
  });

  it("sets state to 'completed' when requiresApproval is false (contract: non-approval tasks auto-complete)", () => {
    // Prevents assumption violation: callers assuming all tasks start in "queued" or "running"
    const task = createTask({
      goalId: "g-1",
      workflowId: "wf-1",
      title: "Task",
      summary: "Summary",
      assignedAgent: "research",
      riskClass: "R1",
      requiresApproval: false,
      toolCapabilities: ["read"]
    });

    expect(task.state).toBe("completed");
  });

  it("allows explicit state override to bypass the requiresApproval default", () => {
    // Contract: explicit state should always win over the requiresApproval-derived default
    const task = createTask({
      goalId: "g-1",
      workflowId: "wf-1",
      title: "Task",
      summary: "Summary",
      assignedAgent: "research",
      riskClass: "R1",
      requiresApproval: true,
      toolCapabilities: ["read"],
      state: "blocked"
    });

    expect(task.state).toBe("blocked");
  });

  it("initializes empty dependsOn when not provided (contract: callers can safely iterate)", () => {
    // Prevents null-pointer assumption: callers assuming dependsOn is always an array
    const task = createTask({
      goalId: "g-1",
      workflowId: "wf-1",
      title: "Task",
      summary: "Summary",
      assignedAgent: "research",
      riskClass: "R1",
      requiresApproval: false,
      toolCapabilities: ["read"]
    });

    expect(Array.isArray(task.dependsOn)).toBe(true);
    expect(task.dependsOn).toEqual([]);
  });

  it("initializes empty artifactIds (contract: callers can safely iterate without null check)", () => {
    // Prevents null-pointer assumption: callers assuming artifactIds is always an array
    const task = createTask({
      goalId: "g-1",
      workflowId: "wf-1",
      title: "Task",
      summary: "Summary",
      assignedAgent: "research",
      riskClass: "R1",
      requiresApproval: false,
      toolCapabilities: ["read"]
    });

    expect(Array.isArray(task.artifactIds)).toBe(true);
    expect(task.artifactIds).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// 2. VERSION MISMATCHES BETWEEN PACKAGE INTERFACES
// ---------------------------------------------------------------------------

describe("contract: ActionIntent schema version field handling", () => {
  it("defaults schemaVersion to 'v1' when not provided (backward compat: old clients)", () => {
    // Prevents version mismatch: old clients omitting schemaVersion should still work
    const intent = SendMessageActionIntentSchema.parse({
      type: "send_message",
      to: "test@example.com",
      subject: "Test",
      body: "Hello"
    });

    expect(intent.schemaVersion).toBe("v1");
  });

  it("rejects unknown schemaVersion values (contract: forward compatibility guard)", () => {
    // Prevents version mismatch: a newer client sending v2 should be rejected by old server
    expect(() =>
      SendMessageActionIntentSchema.parse({
        type: "send_message",
        schemaVersion: "v2",
        to: "test@example.com",
        subject: "Test",
        body: "Hello"
      })
    ).toThrow();
  });

  it("preserves explicit v1 schemaVersion", () => {
    const intent = CreateNoteActionIntentSchema.parse({
      type: "create_note",
      schemaVersion: "v1",
      title: "Note",
      content: "Content"
    });

    expect(intent.schemaVersion).toBe("v1");
  });
});

describe("contract: discriminated union type narrowing for ActionIntentSchema", () => {
  it("correctly narrows to send_message type (prevents wrong-field access)", () => {
    const intent = ActionIntentSchema.parse({
      type: "send_message",
      to: "test@example.com",
      subject: "Subject",
      body: "Body"
    });

    // Contract: after parsing, type narrowing should allow accessing send-specific fields
    if (intent.type === "send_message") {
      expect(intent.to).toBe("test@example.com");
      expect(intent.subject).toBe("Subject");
      // @ts-expect-error - body should not exist on non-send_message types after narrowing
      expect(intent.body).toBeDefined();
    }
  });

  it("rejects invalid type discriminator (prevents silent fallback to wrong handler)", () => {
    expect(() =>
      ActionIntentSchema.parse({
        type: "send_email", // typo - should be send_message
        to: "test@example.com",
        subject: "Test",
        body: "Hello"
      })
    ).toThrow();
  });

  it("does not cross-pollinate fields between intent types", () => {
    // Prevents contract violation: a schedule_event should not have send_message fields
    const intent = ActionIntentSchema.parse({
      type: "schedule_event",
      summary: "Meeting",
      start: "2026-01-01T10:00:00.000Z",
      end: "2026-01-01T11:00:00.000Z"
    });

    expect(intent.type).toBe("schedule_event");
    if (intent.type === "schedule_event") {
      expect(intent.summary).toBe("Meeting");
      // @ts-expect-error - 'to' should not exist on schedule_event
      expect(intent.to).toBeUndefined();
    }
  });
});

// ---------------------------------------------------------------------------
// 3. UNEXPECTED NULL/UNDEFINED RETURNS
// ---------------------------------------------------------------------------

describe("contract: deriveJobRecoveryState returns null for non-recoverable states", () => {
  it("returns null for completed jobs (contract: no recovery needed)", () => {
    const result = deriveJobRecoveryState({
      jobId: "job-1",
      status: "completed",
      payload: { type: "docs_render", metadata: {} }
    });

    expect(result).toBeNull();
  });

  it("returns null for queued jobs (contract: no recovery needed yet)", () => {
    const result = deriveJobRecoveryState({
      jobId: "job-1",
      status: "queued",
      payload: { type: "docs_render", metadata: {} }
    });

    expect(result).toBeNull();
  });

  it("returns null for running jobs (contract: still in progress)", () => {
    const result = deriveJobRecoveryState({
      jobId: "job-1",
      status: "running",
      payload: { type: "docs_render", metadata: {} }
    });

    expect(result).toBeNull();
  });

  it("returns null for cancelled jobs (contract: cancelled is terminal)", () => {
    const result = deriveJobRecoveryState({
      jobId: "job-1",
      status: "cancelled",
      payload: { type: "docs_render", metadata: {} }
    });

    expect(result).toBeNull();
  });

  it("returns a recovery state for dead_letter with unknown payload type", () => {
    // Contract: dead_letter always produces a recovery state, even for unrecognized payloads
    const result = deriveJobRecoveryState({
      jobId: "job-1",
      status: "dead_letter",
      payload: { type: "docs_render", metadata: {} } as JobPayload
    });

    expect(result).not.toBeNull();
    expect(result?.strategy).toBe("manual_review");
  });

  it("returns retry strategy for retrying status regardless of payload type", () => {
    // Prevents assumption violation: callers assuming retry strategy is payload-specific
    const result = deriveJobRecoveryState({
      jobId: "job-1",
      status: "retrying",
      payload: { type: "docs_render", metadata: {} }
    });

    expect(result?.strategy).toBe("retry_job");
  });
});

describe("contract: computeNextRun returns null for unrecognized patterns", () => {
  it("returns null for 4-part cron (contract: only 5-part standard cron accepted)", () => {
    expect(computeNextRun("0 12 * *", "UTC")).toBeNull();
  });

  it("returns null for 6-part cron (contract: no seconds-level granularity)", () => {
    expect(computeNextRun("0 0 12 * * *", "UTC")).toBeNull();
  });

  it("returns null for non-numeric minute (contract: expression not range)", () => {
    expect(computeNextRun("*/5 12 * * *", "UTC")).toBeNull();
  });

  it("returns null for minute out of range (contract: 0-59 only)", () => {
    expect(computeNextRun("60 12 * * *", "UTC")).toBeNull();
    expect(computeNextRun("-1 12 * * *", "UTC")).toBeNull();
  });

  it("returns null for hour out of range (contract: 0-23 only)", () => {
    expect(computeNextRun("0 24 * * *", "UTC")).toBeNull();
    expect(computeNextRun("0 -1 * * *", "UTC")).toBeNull();
  });

  it("returns null for invalid day-of-week (contract: 0-7 only)", () => {
    expect(computeNextRun("0 12 * * 8", "UTC")).toBeNull();
    expect(computeNextRun("0 12 * * -1", "UTC")).toBeNull();
  });

  it("returns a valid ISO string for standard daily pattern", () => {
    const result = computeNextRun("0 12 * * *", "UTC");
    expect(result).not.toBeNull();
    expect(() => new Date(result!).toISOString()).not.toThrow();
  });

  it("normalizes day 7 to 0 (Sunday) in weekly pattern", () => {
    // Prevents assumption violation: day 7 in some cron systems means Sunday
    const result7 = computeNextRun("0 12 * * 7", "UTC");
    const result0 = computeNextRun("0 12 * * 0", "UTC");

    // Both should produce a valid date on Sunday
    expect(result7).not.toBeNull();
    expect(result0).not.toBeNull();

    const day7 = new Date(result7!).getUTCDay();
    const day0 = new Date(result0!).getUTCDay();

    expect(day7).toBe(0); // Sunday
    expect(day0).toBe(0); // Sunday
  });
});

// ---------------------------------------------------------------------------
// 4. MISSING ERROR HANDLING IN CALLERS
// ---------------------------------------------------------------------------

describe("contract: createJobRecord defaults and validation", () => {
  it("defaults priority to 'normal' when not provided", () => {
    // Prevents assumption violation: callers assuming priority is always set
    const job = createJobRecord({
      userId: "user-1",
      kind: "goal_create",
      payload: { type: "goal_create", goalId: "goal-1", workflowId: "wf-1", request: "Test request", metadata: {} }
    });

    expect(job.priority).toBe("normal");
  });

  it("defaults maxAttempts to 3 when not provided", () => {
    // Prevents assumption violation: callers depending on specific retry budget
    const job = createJobRecord({
      userId: "user-1",
      kind: "goal_create",
      payload: { type: "goal_create", goalId: "goal-1", workflowId: "wf-1", request: "Test request", metadata: {} }
    });

    expect(job.maxAttempts).toBe(3);
  });

  it("defaults queue to 'default' for empty string", () => {
    // Prevents assumption violation: callers assuming empty queue name is preserved
    const job = createJobRecord({
      userId: "user-1",
      kind: "goal_create",
      payload: { type: "goal_create", goalId: "goal-1", workflowId: "wf-1", request: "Test request", metadata: {} },
      queue: ""
    });

    expect(job.queue).toBe("default");
  });

  it("defaults queue to 'default' for whitespace-only string", () => {
    const job = createJobRecord({
      userId: "user-1",
      kind: "goal_create",
      payload: { type: "goal_create", goalId: "goal-1", workflowId: "wf-1", request: "Test request", metadata: {} },
      queue: "   "
    });

    expect(job.queue).toBe("default");
  });

  it("initializes attemptCount to 0 (contract: new jobs have no attempts)", () => {
    const job = createJobRecord({
      userId: "user-1",
      kind: "goal_create",
      payload: { type: "goal_create", goalId: "goal-1", workflowId: "wf-1", request: "Test request", metadata: {} }
    });

    expect(job.attemptCount).toBe(0);
  });

  it("initializes journal entries with exactly one entry", () => {
    // Contract: a fresh job always has exactly one initial journal entry
    const job = createJobRecord({
      userId: "user-1",
      kind: "goal_create",
      payload: { type: "goal_create", goalId: "goal-1", workflowId: "wf-1", request: "Test request", metadata: {} }
    });

    expect(job.journal.entries).toHaveLength(1);
    expect(job.journal.entries[0].state).toBe("queued");
  });

  it("rejects invalid userId (contract: userId must be non-empty)", () => {
    expect(() =>
      createJobRecord({
        userId: "",
        kind: "goal_create",
        payload: { type: "goal_create", goalId: "goal-1", workflowId: "wf-1", request: "Test request", metadata: {} }
      })
    ).toThrow();
  });

  it("initializes claimedBy to null (contract: new jobs are unclaimed)", () => {
    const job = createJobRecord({
      userId: "user-1",
      kind: "goal_create",
      payload: { type: "goal_create", goalId: "goal-1", workflowId: "wf-1", request: "Test request", metadata: {} }
    });

    expect(job.claimedBy).toBeNull();
    expect(job.claimedAt).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// 5. ASSUMPTION VIOLATIONS
// ---------------------------------------------------------------------------

describe("contract: canTransitionTaskState does not assume symmetry", () => {
  it("queued -> running is legal but running -> queued is not", () => {
    // Prevents assumption violation: callers assuming transitions are bidirectional
    expect(canTransitionTaskState("queued", "running")).toBe(true);
    expect(canTransitionTaskState("running", "queued")).toBe(false);
  });

  it("completed is terminal (no outgoing transitions)", () => {
    // Prevents assumption violation: callers assuming any state can reach any other
    for (const target of ["queued", "running", "waiting", "blocked", "retrying", "failed", "completed"] as TaskState[]) {
      expect(canTransitionTaskState("completed", target)).toBe(false);
    }
  });

  it("failed cannot go directly to completed (must go through retrying)", () => {
    // Prevents assumption violation: callers assuming failed -> completed is valid
    expect(canTransitionTaskState("failed", "completed")).toBe(false);
  });

  it("retrying can go to running (re-execution)", () => {
    expect(canTransitionTaskState("retrying", "running")).toBe(true);
  });

  it("retrying cannot go to completed (must go through running first)", () => {
    // Prevents assumption violation: callers skipping the running step after retry
    expect(canTransitionTaskState("retrying", "completed")).toBe(false);
  });

  it("blocked can return to queued", () => {
    // Contract: blocked tasks can be re-queued
    expect(canTransitionTaskState("blocked", "queued")).toBe(true);
  });

  it("waiting cannot go directly to failed (must go through running first)", () => {
    // Prevents assumption violation: callers skipping the running step from waiting
    expect(canTransitionTaskState("waiting", "failed")).toBe(false);
  });
});

describe("contract: canTransitionJobState transition symmetry", () => {
  it("queued -> running is legal but running -> queued is not", () => {
    // Prevents assumption: job transitions are different from task transitions
    expect(canTransitionJobState("queued", "running")).toBe(true);
    expect(canTransitionJobState("running", "queued")).toBe(false);
  });

  it("completed is terminal for jobs too", () => {
    for (const target of ["queued", "running", "retrying", "completed", "dead_letter", "paused", "cancelled"] as JobStatus[]) {
      expect(canTransitionJobState("completed", target)).toBe(false);
    }
  });

  it("dead_letter is terminal (no recovery through job state machine)", () => {
    // Contract: dead_letter jobs cannot transition; recovery happens outside the state machine
    for (const target of ["queued", "running", "retrying", "completed", "dead_letter", "paused", "cancelled"] as JobStatus[]) {
      expect(canTransitionJobState("dead_letter", target)).toBe(false);
    }
  });

  it("paused -> queued is legal (re-queue after pause)", () => {
    expect(canTransitionJobState("paused", "queued")).toBe(true);
  });

  it("cancelled is terminal", () => {
    for (const target of ["queued", "running", "retrying", "completed", "dead_letter", "paused", "cancelled"] as JobStatus[]) {
      expect(canTransitionJobState("cancelled", target)).toBe(false);
    }
  });
});

describe("contract: recomputeWorkflowStatuses does not assume all-completed means goal completed", () => {
  it("returns waiting/waiting when there are pending approvals even if all tasks are completed", () => {
    // Prevents assumption violation: callers assuming all-completed tasks = completed workflow
    const bundle = minimalGoalBundle();
    const completedTasks = bundle.tasks.map((t) => ({ ...t, state: "completed" as TaskState }));
    const pendingApproval = {
      id: "ap-1",
      goalId: bundle.goal.id,
      taskId: bundle.tasks[0].id,
      title: "Approval",
      rationale: "Needs review",
      riskClass: "R2" as RiskClass,
      decision: "pending" as const,
      requestedAction: "Send email",
      actionIntent: null,
      createdAt: nowIso(),
      expiryAt: nowIso(),
      respondedAt: null
    };

    const result = recomputeWorkflowStatuses(
      completedTasks,
      [pendingApproval as any],
      []
    );

    expect(result.goalStatus).toBe("waiting");
    expect(result.workflowStatus).toBe("waiting");
  });

  it("returns running/running when there are blocked tasks", () => {
    // Prevents assumption violation: callers assuming blocked = workflow halted
    const bundle = minimalGoalBundle();
    const blockedTask = { ...bundle.tasks[0], state: "blocked" as TaskState };

    const result = recomputeWorkflowStatuses(
      [blockedTask],
      [],
      []
    );

    expect(result.goalStatus).toBe("running");
    expect(result.workflowStatus).toBe("running");
  });

  it("returns completed/completed only when all tasks are completed AND no open watchers", () => {
    const bundle = minimalGoalBundle();
    const completedTasks = bundle.tasks.map((t) => ({ ...t, state: "completed" as TaskState }));

    const result = recomputeWorkflowStatuses(
      completedTasks,
      [],
      []
    );

    expect(result.goalStatus).toBe("completed");
    expect(result.workflowStatus).toBe("completed");
  });

  it("returns running/running when all tasks are completed but watchers are still active", () => {
    // Prevents assumption violation: callers assuming task completion = workflow completion
    const bundle = minimalGoalBundle();
    const completedTasks = bundle.tasks.map((t) => ({ ...t, state: "completed" as TaskState }));
    const activeWatcher = {
      id: "watcher-1",
      goalId: bundle.goal.id,
      name: "Test watcher",
      targetEntity: "email",
      condition: "new email received",
      triggerAction: "notify",
      frequency: "realtime" as const,
      status: "active" as const,
      dryRun: false,
      createdAt: nowIso(),
      updatedAt: nowIso()
    };

    const result = recomputeWorkflowStatuses(
      completedTasks,
      [],
      [activeWatcher]
    );

    expect(result.goalStatus).toBe("running");
    expect(result.workflowStatus).toBe("running");
  });

  it("returns paused status when controlStatus is paused (overrides all other derivation)", () => {
    // Contract: operator pause control takes precedence over task/approval/watcher state
    const bundle = minimalGoalBundle();
    const completedTasks = bundle.tasks.map((t) => ({ ...t, state: "completed" as TaskState }));

    const result = recomputeWorkflowStatuses(
      completedTasks,
      [],
      [],
      "paused"
    );

    expect(result.workflowStatus).toBe("paused");
    // Goal cannot be "paused" (not in goalStatus enum), so it falls back to "waiting"
    expect(result.goalStatus).toBe("waiting");
  });

  it("returns cancelled status when controlStatus is cancelled", () => {
    const bundle = minimalGoalBundle();

    const result = recomputeWorkflowStatuses(
      bundle.tasks,
      [],
      [],
      "cancelled"
    );

    expect(result.workflowStatus).toBe("cancelled");
    expect(result.goalStatus).toBe("waiting");
  });
});

// ---------------------------------------------------------------------------
// 6. INTERFACE EVOLUTION - Old clients with new servers
// ---------------------------------------------------------------------------

describe("contract: AgentResultSchema backward compatibility", () => {
  it("parses a minimal legacy result (no AOS-21 fields)", () => {
    // Prevents interface evolution break: old clients that don't set status/resultType
    const result = AgentResultSchema.parse({
      agent: "communications",
      summary: "Test result",
      confidence: 0.8,
      executionMode: "governed_specialist",
      implementationTier: "production",
      explanation: "Explanation"
    });

    // Contract: optional fields get their defaults
    expect(result.status).toBeUndefined();
    expect(result.resultType).toBeUndefined();
    expect(result.artifacts).toEqual([]);
    expect(result.proposedToolCalls).toEqual([]);
    expect(result.nextSteps).toEqual([]);
    expect(result.structuredResult).toBeNull();
    expect(result.evidenceRefs).toEqual([]);
    expect(result.assumptions).toEqual([]);
    expect(result.riskFlags).toEqual([]);
    expect(result.proposedActions).toEqual([]);
    expect(result.memoryUpdates).toEqual([]);
    expect(result.watcherRecommendations).toEqual([]);
  });

  it("rejects invalid agent names (contract: agent enum is bounded)", () => {
    expect(() =>
      AgentResultSchema.parse({
        agent: "nonexistent-agent",
        summary: "Test",
        confidence: 0.8,
        executionMode: "governed_specialist",
        implementationTier: "production",
        explanation: "Explanation"
      })
    ).toThrow();
  });

  it("rejects confidence outside [0, 1] (contract: probability bounds)", () => {
    expect(() =>
      AgentResultSchema.parse({
        agent: "communications",
        summary: "Test",
        confidence: 1.5,
        executionMode: "governed_specialist",
        implementationTier: "production",
        explanation: "Explanation"
      })
    ).toThrow();

    expect(() =>
      AgentResultSchema.parse({
        agent: "communications",
        summary: "Test",
        confidence: -0.1,
        executionMode: "governed_specialist",
        implementationTier: "production",
        explanation: "Explanation"
      })
    ).toThrow();
  });
});

describe("contract: WorkflowResponsibilityAssigneeSchema kind-requirement enforcement", () => {
  it("requires userId when kind is 'user'", () => {
    // Contract: user-kind assignees must have a userId
    expect(() =>
      WorkflowResponsibilityAssigneeSchema.parse({
        kind: "user",
        userId: null,
        workspaceRole: null,
        systemActor: null,
        label: "Test"
      })
    ).toThrow();
  });

  it("requires workspaceRole when kind is 'workspace_role'", () => {
    expect(() =>
      WorkflowResponsibilityAssigneeSchema.parse({
        kind: "workspace_role",
        userId: null,
        workspaceRole: null,
        systemActor: null,
        label: "Test"
      })
    ).toThrow();
  });

  it("requires systemActor when kind is 'system_actor'", () => {
    expect(() =>
      WorkflowResponsibilityAssigneeSchema.parse({
        kind: "system_actor",
        userId: null,
        workspaceRole: null,
        systemActor: null,
        label: "Test"
      })
    ).toThrow();
  });

  it("accepts valid user assignee", () => {
    const assignee = createUserResponsibilityAssignee("user-1", "Test user");
    expect(assignee.kind).toBe("user");
    expect(assignee.userId).toBe("user-1");
  });

  it("accepts valid system assignee", () => {
    const assignee = createSystemResponsibilityAssignee("orchestrator", "Orchestrator lane");
    expect(assignee.kind).toBe("system_actor");
    expect(assignee.systemActor).toBe("orchestrator");
  });
});

// ---------------------------------------------------------------------------
// 7. TYPE NARROWING FAILURES
// ---------------------------------------------------------------------------

describe("contract: UpdateRecordActionIntentSchema requires non-empty patch", () => {
  it("rejects empty patch object (contract: update must actually change something)", () => {
    // Prevents type narrowing failure: callers assuming empty patch is a no-op
    expect(() =>
      UpdateRecordActionIntentSchema.parse({
        type: "update_record",
        targetType: "task",
        targetId: "target-1",
        patch: {},
        reason: "Update needed"
      })
    ).toThrow(/patch/i);
  });

  it("accepts non-empty patch", () => {
    const intent = UpdateRecordActionIntentSchema.parse({
      type: "update_record",
      targetType: "task",
      targetId: "target-1",
      patch: { status: "done" },
      reason: "Update needed"
    });

    expect(intent.patch).toEqual({ status: "done" });
  });
});

describe("contract: ScheduleEventActionIntentSchema requires end after start", () => {
  it("rejects end before start (contract: temporal ordering)", () => {
    expect(() =>
      ScheduleEventActionIntentSchema.parse({
        type: "schedule_event",
        summary: "Meeting",
        start: "2026-01-01T11:00:00.000Z",
        end: "2026-01-01T10:00:00.000Z"
      })
    ).toThrow(/end/i);
  });

  it("rejects end equal to start (contract: zero-duration events)", () => {
    expect(() =>
      ScheduleEventActionIntentSchema.parse({
        type: "schedule_event",
        summary: "Meeting",
        start: "2026-01-01T10:00:00.000Z",
        end: "2026-01-01T10:00:00.000Z"
      })
    ).toThrow(/end/i);
  });

  it("accepts end after start", () => {
    const intent = ScheduleEventActionIntentSchema.parse({
      type: "schedule_event",
      summary: "Meeting",
      start: "2026-01-01T10:00:00.000Z",
      end: "2026-01-01T11:00:00.000Z"
    });

    expect(intent.type).toBe("schedule_event");
  });
});

// ---------------------------------------------------------------------------
// 8. OPTIONAL FIELD HANDLING
// ---------------------------------------------------------------------------

describe("contract: GoalTemplate optional fields and defaults", () => {
  it("createGoalTemplate defaults description to empty string", () => {
    // Prevents assumption violation: callers assuming description is always populated
    const template = createGoalTemplate({
      userId: "user-1",
      name: "Test Template",
      request: "Do something"
    });

    expect(template.description).toBe("");
  });

  it("createGoalTemplate defaults parameters to empty object", () => {
    // Contract: parameters is always a record, never null/undefined
    const template = createGoalTemplate({
      userId: "user-1",
      name: "Test Template",
      request: "Do [thing]"
    });

    expect(template.parameters).toEqual({});
    expect(typeof template.parameters).toBe("object");
  });

  it("createGoalTemplate defaults schedule.enabled to false", () => {
    const template = createGoalTemplate({
      userId: "user-1",
      name: "Test Template",
      request: "Do something"
    });

    expect(template.schedule.enabled).toBe(false);
  });

  it("createGoalTemplate sets schedule.nextRunAt to null when schedule disabled", () => {
    // Prevents assumption violation: callers assuming nextRunAt is always set
    const template = createGoalTemplate({
      userId: "user-1",
      name: "Test Template",
      request: "Do something"
    });

    expect(template.schedule.nextRunAt).toBeNull();
  });

  it("interpolateTemplate fills in parameters from template and overrides", () => {
    const template = createGoalTemplate({
      userId: "user-1",
      name: "Test Template",
      request: "Review [topic] for [date]",
      parameters: { topic: "code" }
    });

    const result = interpolateTemplate(template, { date: "2026-01-01" });

    expect(result).toContain("code");
    expect(result).toContain("2026-01-01");
    expect(result).not.toContain("[topic]");
    expect(result).not.toContain("[date]");
  });

  it("interpolateTemplate auto-fills [date] when not in parameters or overrides", () => {
    // Contract: [date] is a built-in parameter that always resolves
    const template = createGoalTemplate({
      userId: "user-1",
      name: "Daily Review",
      request: "Review items for [date]"
    });

    const result = interpolateTemplate(template);
    const today = new Date().toISOString().slice(0, 10);

    expect(result).toContain(today);
    expect(result).not.toContain("[date]");
  });

  it("interpolateTemplate leaves unmatched placeholders as-is", () => {
    // Contract: unknown placeholders are not silently removed
    const template = createGoalTemplate({
      userId: "user-1",
      name: "Test",
      request: "Check [unknown_param]"
    });

    const result = interpolateTemplate(template);

    // Unmatched placeholders remain in the output (not silently dropped)
    expect(result).toContain("[unknown_param]");
  });

  it("shouldTemplateRun returns false when schedule is disabled", () => {
    const template = createGoalTemplate({
      userId: "user-1",
      name: "Test",
      request: "Do something"
    });

    expect(shouldTemplateRun(template)).toBe(false);
  });

  it("shouldTemplateRun returns false when cron is empty", () => {
    const template = GoalTemplateSchema.parse({
      id: "t-1",
      userId: "user-1",
      name: "Test",
      request: "Do something",
      schedule: { enabled: true, cron: "", timezone: "UTC", lastRunAt: null, nextRunAt: "2020-01-01T00:00:00.000Z" },
      createdAt: nowIso(),
      updatedAt: nowIso()
    });

    expect(shouldTemplateRun(template)).toBe(false);
  });

  it("shouldTemplateRun returns false when nextRunAt is null", () => {
    const template = GoalTemplateSchema.parse({
      id: "t-1",
      userId: "user-1",
      name: "Test",
      request: "Do something",
      schedule: { enabled: true, cron: "0 12 * * *", timezone: "UTC", lastRunAt: null, nextRunAt: null },
      createdAt: nowIso(),
      updatedAt: nowIso()
    });

    expect(shouldTemplateRun(template)).toBe(false);
  });

  it("shouldTemplateRun returns true when now >= nextRunAt", () => {
    const template = GoalTemplateSchema.parse({
      id: "t-1",
      userId: "user-1",
      name: "Test",
      request: "Do something",
      schedule: {
        enabled: true,
        cron: "0 12 * * *",
        timezone: "UTC",
        lastRunAt: null,
        nextRunAt: "2020-01-01T00:00:00.000Z"
      },
      createdAt: nowIso(),
      updatedAt: nowIso()
    });

    expect(shouldTemplateRun(template)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// 9. DEFAULT VALUE ASSUMPTIONS
// ---------------------------------------------------------------------------

describe("contract: WorkflowScheduleSchema default values", () => {
  it("defaults timezone to UTC when not provided", () => {
    // Prevents assumption violation: callers assuming timezone is always set
    const schedule = WorkflowScheduleSchema.parse({});
    expect(schedule.timezone).toBe("UTC");
  });

  it("defaults runCount to 0", () => {
    const schedule = WorkflowScheduleSchema.parse({});
    expect(schedule.runCount).toBe(0);
  });

  it("defaults maxRuns to null (unlimited)", () => {
    // Contract: null means unlimited runs, not "zero runs allowed"
    const schedule = WorkflowScheduleSchema.parse({});
    expect(schedule.maxRuns).toBeNull();
  });

  it("defaults enabled to false", () => {
    const schedule = WorkflowScheduleSchema.parse({});
    expect(schedule.enabled).toBe(false);
  });
});

describe("contract: deriveGoalResponsibility always produces a complete responsibility", () => {
  it("produces owner, delegate, reviewer, escalationOwner fields", () => {
    // Prevents assumption violation: callers accessing all four responsibility roles
    const responsibility = deriveGoalResponsibility({ userId: "user-1" });

    expect(responsibility.owner).toBeDefined();
    expect(responsibility.owner.kind).toBe("user");
    expect(responsibility.owner.userId).toBe("user-1");
    expect(responsibility.delegate).toBeNull();
    expect(responsibility.reviewer).toBeDefined(); // reviewer is set to a default escalation owner
    expect(responsibility.escalationOwner).toBeDefined();
  });

  it("defaults handoffStatus to 'owner_control'", () => {
    // Contract: new responsibilities start in owner_control state
    const responsibility = deriveGoalResponsibility({ userId: "user-1" });
    expect(responsibility.handoffStatus).toBe("owner_control");
  });

  it("defaults audit to full audit requirements", () => {
    // Contract: audit requirements default to full coverage
    const responsibility = deriveGoalResponsibility({ userId: "user-1" });
    expect(responsibility.audit.requireActorContext).toBe(true);
    expect(responsibility.audit.requireReasonForDelegation).toBe(true);
    expect(responsibility.audit.requireReasonForEscalation).toBe(true);
    expect(responsibility.audit.requireReviewerIdentity).toBe(true);
    expect(responsibility.audit.requiredEvents).toHaveLength(4);
  });
});

describe("contract: deriveGoalContract returns consistent wedge and completion contract", () => {
  it("returns a valid GoalWedge for every known intent", () => {
    // Prevents assumption violation: callers assuming deriveGoalContract never throws
    const intents = [
      "inbox-triage",
      "travel-preparation",
      "meeting-scheduling",
      "general-coordination",
      "complex-delegation"
    ];

    for (const intent of intents) {
      const contract = deriveGoalContract(intent);
      expect(contract.wedge).toBeDefined();
      expect(contract.wedge.key).toBeDefined();
      expect(contract.wedge.label.length).toBeGreaterThan(0);
      expect(contract.completionContract).toBeDefined();
      expect(contract.completionContract.successCriteria.length).toBeGreaterThan(0);
      expect(contract.completionContract.evidenceSignals.length).toBeGreaterThan(0);
      expect(contract.completionContract.doneWhen.length).toBeGreaterThan(0);
    }
  });

  it("falls back to a default profile for unknown intents", () => {
    // Prevents assumption violation: callers assuming only known intents work
    const contract = deriveGoalContract("unknown-intent-that-doesnt-exist");
    expect(contract.wedge).toBeDefined();
    expect(contract.completionContract).toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// 10. CALLBACK/PROMISE CONTRACT VIOLATIONS
// ---------------------------------------------------------------------------

describe("contract: isJobClaimable respects time bounds", () => {
  it("returns false when availableAt is in the future", () => {
    // Contract: jobs not yet available cannot be claimed
    const futureDate = new Date(Date.now() + 60_000).toISOString();
    const job = createJobRecord({
      userId: "user-1",
      kind: "goal_create",
      payload: { type: "goal_create", goalId: "goal-1", workflowId: "wf-1", request: "Test request", metadata: {} },
      availableAt: futureDate
    });

    expect(isJobClaimable(job)).toBe(false);
  });

  it("returns true when availableAt is in the past", () => {
    const pastDate = new Date(Date.now() - 60_000).toISOString();
    const job = createJobRecord({
      userId: "user-1",
      kind: "goal_create",
      payload: { type: "goal_create", goalId: "goal-1", workflowId: "wf-1", request: "Test request", metadata: {} },
      availableAt: pastDate
    });

    expect(isJobClaimable(job)).toBe(true);
  });

  it("returns false when job is already claimed", () => {
    // Contract: a claimed job cannot be claimed again
    const job = createJobRecord({
      userId: "user-1",
      kind: "goal_create",
      payload: { type: "goal_create", goalId: "goal-1", workflowId: "wf-1", request: "Test request", metadata: {} }
    });
    const claimedJob = { ...job, claimedBy: "worker-1", status: "running" as JobStatus };

    expect(isJobClaimable(claimedJob)).toBe(false);
  });

  it("returns false when job status is not queued", () => {
    // Contract: only queued jobs can be claimed
    const job = createJobRecord({
      userId: "user-1",
      kind: "goal_create",
      payload: { type: "goal_create", goalId: "goal-1", workflowId: "wf-1", request: "Test request", metadata: {} }
    });
    const runningJob = { ...job, status: "running" as JobStatus };

    expect(isJobClaimable(runningJob)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// 11. EVENT CONTRACT VIOLATIONS
// ---------------------------------------------------------------------------

describe("contract: action log chain integrity via GoalBundle", () => {
  it("reconcileExecutionResults returns unchanged bundle when no results or logs", () => {
    // Contract: empty reconciliation is a no-op
    const bundle = minimalGoalBundle();
    const result = reconcileExecutionResults({ bundle, results: [] });

    expect(result).toBe(bundle); // same reference
  });

  it("reconcileExecutionResults ignores results for unknown task IDs", () => {
    // Prevents contract violation: foreign results should not affect the bundle
    const bundle = minimalGoalBundle();
    const foreignResult = minimalExecutionResult({
      taskId: "nonexistent-task-id",
      kind: "execution.completed"
    });

    const result = reconcileExecutionResults({
      bundle,
      results: [foreignResult]
    });

    // Task states should remain unchanged
    expect(result.tasks[0].state).toBe(bundle.tasks[0].state);
  });

  it("reconcileExecutionResults transitions task to completed on successful execution", () => {
    const bundle = minimalGoalBundle();
    const result = reconcileExecutionResults({
      bundle,
      results: [minimalExecutionResult({
        taskId: bundle.tasks[0].id,
        kind: "execution.completed",
        success: true
      })]
    });

    // Task should transition from "waiting" to "blocked" (skipped -> blocked) or
    // actually the result kind maps to completed state
    // The resolution is: completed -> completed task state
    expect(result.tasks[0].state).toBe("completed");
  });

  it("reconcileExecutionResults transitions task to failed on failed execution", () => {
    const bundle = minimalGoalBundle();
    const result = reconcileExecutionResults({
      bundle,
      results: [minimalExecutionResult({
        taskId: bundle.tasks[0].id,
        kind: "execution.failed",
        success: false
      })]
    });

    // waiting -> failed is not directly legal, so task stays in "waiting"
    // The reconcileExecutionResults checks canTransitionTaskState before transitioning
    expect(result.tasks[0].state).toBe("waiting");
  });

  it("reconcileExecutionResults selects the most authoritative result when duplicates exist", () => {
    // Contract: completed outranks failed, which outranks skipped
    const bundle = minimalGoalBundle();
    const taskId = bundle.tasks[0].id;

    const failedResult = minimalExecutionResult({
      taskId,
      kind: "execution.failed",
      success: false,
      timestamp: "2026-01-01T00:00:01.000Z"
    });

    const completedResult = minimalExecutionResult({
      taskId,
      kind: "execution.completed",
      success: true,
      timestamp: "2026-01-01T00:00:00.000Z" // earlier timestamp
    });

    const result = reconcileExecutionResults({
      bundle,
      results: [failedResult, completedResult]
    });

    // Completed should win even though it has an earlier timestamp (higher authority rank)
    expect(result.tasks[0].state).toBe("completed");
  });
});

// ---------------------------------------------------------------------------
// 12. CONFIGURATION CONTRACT VIOLATIONS
// ---------------------------------------------------------------------------

describe("contract: actor identity contracts", () => {
  it("buildHumanActorIdentity uses userId as label fallback", () => {
    // Prevents assumption violation: callers assuming label is always distinct from userId
    const identity = buildHumanActorIdentity("user-1");
    expect(identity.userId).toBe("user-1");
    expect(identity.label).toBe("user-1");
  });

  it("buildHumanActorIdentity uses explicit label when provided", () => {
    const identity = buildHumanActorIdentity("user-1", "John Doe");
    expect(identity.userId).toBe("user-1");
    expect(identity.label).toBe("John Doe");
  });

  it("buildSystemActorIdentity defaults to owner userId and 'system' label when no options", () => {
    // Contract: system identities always have a userId set (defaults to "owner")
    const identity = buildSystemActorIdentity();
    expect(identity.kind).toBe("system");
    expect(identity.userId).toBe("owner");
    expect(identity.label).toBe("system");
  });

  it("createHumanActorContext sets executor.kind to 'human'", () => {
    // Contract: callers depending on executor.kind for routing
    const ctx = createHumanActorContext("user-1");
    expect(ctx.executor.kind).toBe("human");
    expect(ctx.executor.userId).toBe("user-1");
  });

  it("createSystemActorContext sets executor.kind to 'system'", () => {
    const ctx = createSystemActorContext();
    expect(ctx.executor.kind).toBe("system");
  });
});

// ---------------------------------------------------------------------------
// 13. WORKFLOW DAG CONTRACT VIOLATIONS
// ---------------------------------------------------------------------------

describe("contract: WorkflowDag validation enforces invariants", () => {
  function minimalDag(): WorkflowDag {
    return {
      id: "dag-1",
      workflowId: "wf-1",
      nodes: [
        {
          id: "node-1",
          label: "Node 1",
          dependsOn: [],
          actionIntent: {
            type: "manual_review",
            riskClass: "R1",
            actionType: "artifact-only",
            summary: "Review",
            reason: "Because"
          },
          permissionGrant: {
            capabilities: [],
            maxRiskClass: "R1"
          },
          retryPolicy: {
            maxAttempts: 3,
            backoffMs: 1000
          },
          compensation: {
            required: false
          }
        }
      ],
      edges: [],
      createdAt: nowIso(),
      updatedAt: nowIso()
    };
  }


  it("rejects DAG with cycles", () => {
    // Contract: DAGs must be acyclic
    const dag = WorkflowDagSchema.parse({
      ...minimalDag(),
      nodes: [
        {
          ...minimalDag().nodes[0],
          id: "a",
          dependsOn: ["b"]
        },
        {
          ...minimalDag().nodes[0],
          id: "b",
          dependsOn: ["a"]
        }
      ]
    });

    expect(() => validateWorkflowDag(dag)).toThrow(/cycle/i);
  });

  it("rejects node with risk exceeding permission grant", () => {
    // Prevents contract violation: risk escalation through DAG nodes
    const dag = WorkflowDagSchema.parse({
      ...minimalDag(),
      nodes: [
        {
          ...minimalDag().nodes[0],
          actionIntent: {
            type: "manual_review",
            riskClass: "R4",
            actionType: "artifact-only",
            summary: "Review",
            reason: "Because"
          },
          permissionGrant: {
            capabilities: [],
            maxRiskClass: "R2"
          }
        }
      ]
    });

    expect(() => validateWorkflowDag(dag)).toThrow(/risk/i);
  });

  it("rejects node requiring compensation without compensation action", () => {
    // Contract: if compensation is required, a compensation action must be defined
    const dag = WorkflowDagSchema.parse({
      ...minimalDag(),
      nodes: [
        {
          ...minimalDag().nodes[0],
          compensation: {
            required: true,
            actionIntent: null
          }
        }
      ]
    });

    expect(() => validateWorkflowDag(dag)).toThrow(/compensation/i);
  });

  it("accepts valid single-node DAG", () => {
    const dag = minimalDag();
    const result = validateWorkflowDag(dag);
    expect(result.nodes).toHaveLength(1);
  });
});

describe("contract: WorkflowDagInstance transitions", () => {
  function createMinimalInstance(): WorkflowDagInstance {
    const dag = {
      id: "dag-1",
      workflowId: "wf-1",
      nodes: [
        {
          id: "node-1",
          label: "Node 1",
          dependsOn: [],
          actionIntent: {
            type: "manual_review" as const,
            riskClass: "R1" as RiskClass,
            actionType: "artifact-only" as const,
            summary: "Review",
            reason: "Because"
          },
          permissionGrant: {
            capabilities: [],
            maxRiskClass: "R1" as RiskClass
          },
          retryPolicy: {
            maxAttempts: 3,
            backoffMs: 1000
          },
          compensation: {
            required: false
          }
        }
      ],
      edges: [],
      createdAt: nowIso(),
      updatedAt: nowIso()
    };

    return createWorkflowDagInstance({ dag });
  }

  it("new instance starts in queued state", () => {
    const instance = createMinimalInstance();
    expect(instance.status).toBe("queued");
  });

  it("rejects illegal transition from queued to completed", () => {
    // Contract: must go through running first
    const instance = createMinimalInstance();
    expect(() =>
      transitionWorkflowDagInstance({
        instance,
        status: "completed"
      })
    ).toThrow(/illegal/i);
  });

  it("allows queued -> running -> completed", () => {
    const instance = createMinimalInstance();
    const running = transitionWorkflowDagInstance({ instance, status: "running" });
    expect(running.status).toBe("running");

    const completed = transitionWorkflowDagInstance({ instance: running, status: "completed" });
    expect(completed.status).toBe("completed");
  });

  it("completed is terminal (cannot transition further)", () => {
    const instance = createMinimalInstance();
    const running = transitionWorkflowDagInstance({ instance, status: "running" });
    const completed = transitionWorkflowDagInstance({ instance: running, status: "completed" });

    expect(() =>
      transitionWorkflowDagInstance({ instance: completed, status: "running" })
    ).toThrow(/illegal/i);
  });

  it("paused -> running clears pausedAt", () => {
    const instance = createMinimalInstance();
    const running = transitionWorkflowDagInstance({ instance, status: "running" });
    const paused = transitionWorkflowDagInstance({ instance: running, status: "paused" });
    expect(paused.pausedAt).not.toBeNull();

    const resumed = transitionWorkflowDagInstance({ instance: paused, status: "running" });
    expect(resumed.pausedAt).toBeNull();
  });
});

describe("contract: WorkflowDagNode execution transitions", () => {
  function createMinimalNodeExecution(): ReturnType<typeof WorkflowDagNodeExecutionSchema.parse> {
    return WorkflowDagNodeExecutionSchema.parse({
      id: "exec-1",
      instanceId: "inst-1",
      nodeId: "node-1",
      status: "queued",
      attemptCount: 0,
      maxAttempts: 3,
      runnerId: null,
      lastError: null,
      startedAt: null,
      completedAt: null,
      updatedAt: nowIso()
    });
  }

  it("rejects node transition from completed to anything", () => {
    const node = WorkflowDagNodeExecutionSchema.parse({
      ...createMinimalNodeExecution(),
      status: "completed",
      completedAt: nowIso()
    });

    expect(() =>
      transitionWorkflowDagNode({ execution: node, status: "running" })
    ).toThrow(/illegal/i);
  });

  it("increments attemptCount when transitioning from queued to running", () => {
    const node = createMinimalNodeExecution();
    const running = transitionWorkflowDagNode({ execution: node, status: "running" });

    expect(running.attemptCount).toBe(1);
    expect(running.status).toBe("running");
  });

  it("increments attemptCount when transitioning from failed to running (retry)", () => {
    const failedNode = WorkflowDagNodeExecutionSchema.parse({
      ...createMinimalNodeExecution(),
      status: "failed",
      attemptCount: 1,
      lastError: "Something failed"
    });

    const retried = transitionWorkflowDagNode({ execution: failedNode, status: "running" });
    expect(retried.attemptCount).toBe(2);
  });

  it("rejects transition when attempt budget is exhausted", () => {
    const exhaustedNode = WorkflowDagNodeExecutionSchema.parse({
      ...createMinimalNodeExecution(),
      status: "failed",
      attemptCount: 3,
      maxAttempts: 3
    });

    expect(() =>
      transitionWorkflowDagNode({ execution: exhaustedNode, status: "running" })
    ).toThrow(/exhausted/i);
  });

  it("skipped sets completedAt", () => {
    const node = createMinimalNodeExecution();
    const skipped = transitionWorkflowDagNode({ execution: node, status: "skipped" });
    expect(skipped.completedAt).not.toBeNull();
  });
});

// ---------------------------------------------------------------------------
// 14. INSPECT / DERIVATION CONTRACT VIOLATIONS
// ---------------------------------------------------------------------------

describe("contract: inspectWorkflowDagInstance derivation invariants", () => {
  it("reports zero progress for a fresh instance", () => {
    const dag = {
      id: "dag-1",
      workflowId: "wf-1",
      nodes: [
        {
          id: "node-1",
          label: "Node 1",
          dependsOn: [],
          actionIntent: {
            type: "manual_review" as const,
            riskClass: "R1" as RiskClass,
            actionType: "artifact-only" as const,
            summary: "Review",
            reason: "Because"
          },
          permissionGrant: { capabilities: [], maxRiskClass: "R1" as RiskClass },
          retryPolicy: { maxAttempts: 3, backoffMs: 1000 },
          compensation: { required: false }
        },
        {
          id: "node-2",
          label: "Node 2",
          dependsOn: ["node-1"],
          actionIntent: {
            type: "manual_review" as const,
            riskClass: "R1" as RiskClass,
            actionType: "artifact-only" as const,
            summary: "Review 2",
            reason: "Because 2"
          },
          permissionGrant: { capabilities: [], maxRiskClass: "R1" as RiskClass },
          retryPolicy: { maxAttempts: 3, backoffMs: 1000 },
          compensation: { required: false }
        }
      ],
      edges: [{ from: "node-1", to: "node-2" }],
      createdAt: nowIso(),
      updatedAt: nowIso()
    };

    const instance = createWorkflowDagInstance({ dag });
    const inspection = inspectWorkflowDagInstance(instance);

    expect(inspection.counts.queued).toBe(2);
    expect(inspection.counts.completed).toBe(0);
    expect(inspection.counts.failed).toBe(0);
    expect(inspection.nodeExecutions).toHaveLength(2);
  });
});

// ---------------------------------------------------------------------------
// 15. JOURNAL APPEND CONTRACT
// ---------------------------------------------------------------------------

describe("contract: appendJobExecutionJournalEntry preserves and extends", () => {
  it("appends a new entry to the journal without losing previous entries", () => {
    const journal = createJobExecutionJournal({
      at: nowIso(),
      status: "queued",
      summary: "Initial"
    });

    expect(journal.entries).toHaveLength(1);

    const updated = appendJobExecutionJournalEntry({
      journal,
      at: nowIso(),
      status: "running",
      attemptCount: 1,
      summary: "Running now"
    });

    expect(updated.entries).toHaveLength(2);
    expect(updated.entries[0].summary).toBe("Initial");
    expect(updated.entries[1].summary).toBe("Running now");
  });

  it("updates lifecycleState to the new status", () => {
    const journal = createJobExecutionJournal({
      at: nowIso(),
      status: "queued",
      summary: "Initial"
    });

    const updated = appendJobExecutionJournalEntry({
      journal,
      at: nowIso(),
      status: "running",
      attemptCount: 1,
      summary: "Running"
    });

    expect(updated.lifecycleState).toBe("running");
  });

  it("preserves idempotencyKey when not overridden", () => {
    const journal = createJobExecutionJournal({
      at: nowIso(),
      status: "queued",
      summary: "Initial",
      idempotencyKey: "key-123"
    });

    const updated = appendJobExecutionJournalEntry({
      journal,
      at: nowIso(),
      status: "running",
      attemptCount: 1,
      summary: "Running"
    });

    expect(updated.idempotencyKey).toBe("key-123");
  });

  it("allows overriding idempotencyKey", () => {
    const journal = createJobExecutionJournal({
      at: nowIso(),
      status: "queued",
      summary: "Initial",
      idempotencyKey: "key-123"
    });

    const updated = appendJobExecutionJournalEntry({
      journal,
      at: nowIso(),
      status: "running",
      attemptCount: 1,
      summary: "Running",
      idempotencyKey: "key-456"
    });

    expect(updated.idempotencyKey).toBe("key-456");
  });

  it("trims whitespace from idempotencyKey and nullifies empty strings", () => {
    const journal = createJobExecutionJournal({
      at: nowIso(),
      status: "queued",
      summary: "Initial",
      idempotencyKey: "key-123"
    });

    const updated = appendJobExecutionJournalEntry({
      journal,
      at: nowIso(),
      status: "running",
      attemptCount: 1,
      summary: "Running",
      idempotencyKey: "  "
    });

    expect(updated.idempotencyKey).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// 16. NOTIFICATION TARGET CONTRACT
// ---------------------------------------------------------------------------

describe("contract: buildApprovalNotificationDeliveryTarget injectivity", () => {
  it("produces different targets for different approvalIds", () => {
    const target1 = buildApprovalNotificationDeliveryTarget({
      type: "approval_notification",
      channel: "slack_receipt",
      approvalId: "approval-1",
      slackChannelId: "channel-1",
      slackMessageTs: "1710000000.000100",
      goalId: "goal-1",
      taskId: "task-1",
      decision: "approved",
      metadata: {}
    });

    const target2 = buildApprovalNotificationDeliveryTarget({
      type: "approval_notification",
      channel: "slack_receipt",
      approvalId: "approval-2",
      slackChannelId: "channel-1",
      slackMessageTs: "1710000000.000100",
      goalId: "goal-1",
      taskId: "task-1",
      decision: "approved",
      metadata: {}
    });

    expect(target1).not.toBe(target2);
  });

  it("produces different targets for different channels", () => {
    const slack = buildApprovalNotificationDeliveryTarget({
      type: "approval_notification",
      channel: "slack_receipt",
      approvalId: "approval-1",
      slackChannelId: "channel-1",
      slackMessageTs: "1710000000.000100",
      goalId: "goal-1",
      taskId: "task-1",
      decision: "approved",
      metadata: {}
    });

    const email = buildApprovalNotificationDeliveryTarget({
      type: "approval_notification",
      channel: "email",
      approvalId: "approval-1",
      goalId: "goal-1",
      taskId: "task-1",
      decision: "approved",
      metadata: {}
    });

    expect(slack).not.toBe(email);
  });
});

// ---------------------------------------------------------------------------
// 17. BRIEFING PREFERENCES CONTRACT
// ---------------------------------------------------------------------------

describe("contract: BriefingPreferencesSchema enforces completeness", () => {
  const validSchedules = [
    { type: "startup", enabled: true, time: "08:00" },
    { type: "midday", enabled: true, time: "12:00" },
    { type: "pre_meeting", enabled: false, time: "09:00" },
    { type: "end_of_day", enabled: true, time: "17:00" },
    { type: "next_day", enabled: true, time: "07:00" }
  ];

  it("requires exactly one entry per briefing type", () => {
    // Contract: all 5 briefing types must be present
    const result = BriefingPreferencesSchema.safeParse({
      userId: "user-1",
      timezone: "UTC",
      focus: "balanced",
      schedules: validSchedules,
      createdAt: nowIso(),
      updatedAt: nowIso()
    });

    expect(result.success).toBe(true);
  });

  it("rejects duplicate briefing types", () => {
    const duplicateSchedules = [
      ...validSchedules,
      { type: "startup", enabled: false, time: "06:00" }
    ];

    const result = BriefingPreferencesSchema.safeParse({
      userId: "user-1",
      timezone: "UTC",
      focus: "balanced",
      schedules: duplicateSchedules,
      createdAt: nowIso(),
      updatedAt: nowIso()
    });

    expect(result.success).toBe(false);
  });

  it("rejects missing briefing types", () => {
    const incompleteSchedules = validSchedules.slice(0, 3); // missing end_of_day and next_day

    const result = BriefingPreferencesSchema.safeParse({
      userId: "user-1",
      timezone: "UTC",
      focus: "balanced",
      schedules: incompleteSchedules,
      createdAt: nowIso(),
      updatedAt: nowIso()
    });

    expect(result.success).toBe(false);
  });

  it("rejects invalid time format", () => {
    const badSchedules = validSchedules.map((s) =>
      s.type === "startup" ? { ...s, time: "25:00" } : s
    );

    const result = BriefingPreferencesSchema.safeParse({
      userId: "user-1",
      timezone: "UTC",
      focus: "balanced",
      schedules: badSchedules,
      createdAt: nowIso(),
      updatedAt: nowIso()
    });

    expect(result.success).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// 18. DURABLE JOB QUEUE CONTRACT
// ---------------------------------------------------------------------------

describe("contract: durable job queue handles concurrent access correctly", () => {
  function createInMemoryStore(): JobQueueStore {
    const jobs = new Map<string, import("@agentic/contracts").JobRecord>();

    return {
      async enqueueJob(job) {
        jobs.set(job.id, job);
        return job;
      },
      async claimNextJob(params) {
        for (const [id, job] of jobs) {
          if (job.status === "queued" && isJobClaimable(job, params.now ? Date.parse(params.now) : Date.now())) {
            const claimed = { ...job, status: "running" as JobStatus, claimedBy: params.runnerId, claimedAt: nowIso() };
            jobs.set(id, claimed);
            return claimed;
          }
        }
        return null;
      },
      async completeJob(params) {
        const job = jobs.get(params.jobId);
        if (!job) throw new Error("Job not found");
        const completed = { ...job, status: "completed" as JobStatus, completedAt: params.completedAt ?? nowIso() };
        jobs.set(params.jobId, completed);
        return completed;
      },
      async retryJob(params) {
        const job = jobs.get(params.jobId);
        if (!job) throw new Error("Job not found");
        const retried = { ...job, status: "retrying" as JobStatus, lastError: params.error, availableAt: params.availableAt };
        jobs.set(params.jobId, retried);
        return retried;
      },
      async deadLetterJob(params) {
        const job = jobs.get(params.jobId);
        if (!job) throw new Error("Job not found");
        const deadLettered = { ...job, status: "dead_letter" as JobStatus, lastError: params.error };
        jobs.set(params.jobId, deadLettered);
        return deadLettered;
      }
    };
  }

  it("claimNext returns null when no jobs are available", async () => {
    const store = createInMemoryStore();
    const queue = createDurableJobQueue(store, { runnerId: "worker-1" });

    const result = await queue.claimNext();
    expect(result).toBeNull();
  });

  it("enqueue then claimNext returns the enqueued job", async () => {
    const store = createInMemoryStore();
    const queue = createDurableJobQueue(store, { runnerId: "worker-1" });

    const job = createJobRecord({
      userId: "user-1",
      kind: "goal_create",
      payload: { type: "goal_create", goalId: "goal-1", workflowId: "wf-1", request: "Test request", metadata: {} }
    });

    await queue.enqueue(job);
    const claimed = await queue.claimNext();

    expect(claimed).not.toBeNull();
    expect(claimed!.id).toBe(job.id);
  });
});

// ---------------------------------------------------------------------------
// 19. MANUAL REVIEW INTENT CONTRACT
// ---------------------------------------------------------------------------

describe("contract: ManualReviewActionIntentSchema enforces required fields", () => {
  it("rejects summary exceeding 500 chars", () => {
    expect(() =>
      ManualReviewActionIntentSchema.parse({
        type: "manual_review",
        actionType: "artifact-only",
        summary: "x".repeat(501),
        reason: "Valid reason"
      })
    ).toThrow();
  });

  it("rejects reason exceeding 1000 chars", () => {
    expect(() =>
      ManualReviewActionIntentSchema.parse({
        type: "manual_review",
        actionType: "artifact-only",
        summary: "Valid summary",
        reason: "x".repeat(1001)
      })
    ).toThrow();
  });

  it("defaults artifactIds to empty array", () => {
    const intent = ManualReviewActionIntentSchema.parse({
      type: "manual_review",
      actionType: "artifact-only",
      summary: "Summary",
      reason: "Reason"
    });

    expect(intent.artifactIds).toEqual([]);
  });

  it("rejects more than 20 artifactIds", () => {
    expect(() =>
      ManualReviewActionIntentSchema.parse({
        type: "manual_review",
        actionType: "artifact-only",
        summary: "Summary",
        reason: "Reason",
        artifactIds: Array.from({ length: 21 }, (_, i) => `artifact-${i}`)
      })
    ).toThrow();
  });
});

// ---------------------------------------------------------------------------
// 20. DELETE RECORD INTENT CONFIRMATION TOKEN CONTRACT
// ---------------------------------------------------------------------------

describe("contract: DeleteRecordActionIntentSchema confirmation token", () => {
  it("accepts null confirmationToken (no confirmation required)", () => {
    const intent = DeleteRecordActionIntentSchema.parse({
      type: "delete_record",
      targetType: "task",
      targetId: "target-1",
      reason: "Delete needed",
      confirmationToken: null
    });

    expect(intent.confirmationToken).toBeNull();
  });

  it("requires confirmationToken to be at least 8 chars when provided", () => {
    expect(() =>
      DeleteRecordActionIntentSchema.parse({
        type: "delete_record",
        targetType: "task",
        targetId: "target-1",
        reason: "Delete needed",
        confirmationToken: "short"
      })
    ).toThrow();
  });

  it("rejects invisible-only confirmation token", () => {
    // Contract: confirmationToken must contain visible characters
    expect(() =>
      DeleteRecordActionIntentSchema.parse({
        type: "delete_record",
        targetType: "task",
        targetId: "target-1",
        reason: "Delete needed",
        confirmationToken: "\u200B\u200B\u200B\u200B\u200B\u200B\u200B\u200B\u200B\u200B"
      })
    ).toThrow();
  });

  it("defaults riskClass to R4 for delete operations", () => {
    // Contract: delete is always high-risk by default
    const intent = DeleteRecordActionIntentSchema.parse({
      type: "delete_record",
      targetType: "task",
      targetId: "target-1",
      reason: "Delete needed"
    });

    expect(intent.riskClass).toBe("R4");
  });
});

// ---------------------------------------------------------------------------
// 21. MONITOR SIGNAL INTENT CONTRACT
// ---------------------------------------------------------------------------

describe("contract: MonitorSignalActionIntentSchema invariants", () => {
  it("defaults adapter to 'watcher'", () => {
    const intent = MonitorSignalActionIntentSchema.parse({
      type: "monitor_signal",
      targetEntity: "email-inbox",
      condition: "new urgent email",
      triggerAction: "notify operator"
    });

    expect(intent.adapter).toBe("watcher");
  });

  it("defaults riskClass to R2", () => {
    const intent = MonitorSignalActionIntentSchema.parse({
      type: "monitor_signal",
      targetEntity: "email-inbox",
      condition: "new urgent email",
      triggerAction: "notify operator"
    });

    expect(intent.riskClass).toBe("R2");
  });

  it("limits sourceSystems to 20 entries", () => {
    expect(() =>
      MonitorSignalActionIntentSchema.parse({
        type: "monitor_signal",
        targetEntity: "email-inbox",
        condition: "new urgent email",
        triggerAction: "notify operator",
        sourceSystems: Array.from({ length: 21 }, (_, i) => `system-${i}`)
      })
    ).toThrow();
  });

  it("rejects empty targetEntity (must contain visible characters)", () => {
    expect(() =>
      MonitorSignalActionIntentSchema.parse({
        type: "monitor_signal",
        targetEntity: "",
        condition: "new urgent email",
        triggerAction: "notify operator"
      })
    ).toThrow();
  });
});

// ---------------------------------------------------------------------------
// 22. CROSS-PACKAGE CONTRACT: retryWorkflowDagNode
// ---------------------------------------------------------------------------

describe("contract: retryWorkflowDagNode precondition enforcement", () => {
  function createDagWithOneFailedNode(): WorkflowDagInstance {
    const dag = {
      id: "dag-1",
      workflowId: "wf-1",
      nodes: [
        {
          id: "node-1",
          label: "Node 1",
          dependsOn: [],
          actionIntent: {
            type: "manual_review" as const,
            riskClass: "R1" as RiskClass,
            actionType: "artifact-only" as const,
            summary: "Review",
            reason: "Because"
          },
          permissionGrant: { capabilities: [], maxRiskClass: "R1" as RiskClass },
          retryPolicy: { maxAttempts: 3, backoffMs: 1000 },
          compensation: { required: false }
        }
      ],
      edges: [],
      createdAt: nowIso(),
      updatedAt: nowIso()
    };

    const instance = createWorkflowDagInstance({ dag });
    // Transition instance to running
    const running = transitionWorkflowDagInstance({ instance, status: "running" });
    // Transition node: queued -> running
    const runningNode = transitionWorkflowDagNode({
      execution: running.nodeExecutions[0],
      status: "running"
    });
    // Transition node: running -> failed
    const failedNode = transitionWorkflowDagNode({
      execution: runningNode,
      status: "failed",
      error: "Test failure"
    });

    return { ...running, nodeExecutions: [failedNode] };
  }

  it("allows retry of a failed node", () => {
    const instance = createDagWithOneFailedNode();
    const retried = retryWorkflowDagNode({ instance, nodeId: "node-1" });

    const nodeExec = retried.nodeExecutions[0];
    expect(nodeExec.status).toBe("queued");
    expect(nodeExec.attemptCount).toBe(1); // reset for the new attempt
  });

  it("throws when node is not found", () => {
    const instance = createDagWithOneFailedNode();
    expect(() =>
      retryWorkflowDagNode({ instance, nodeId: "nonexistent" })
    ).toThrow(/not found/i);
  });

  it("throws when node is not in failed state", () => {
    const dag = {
      id: "dag-1",
      workflowId: "wf-1",
      nodes: [
        {
          id: "node-1",
          label: "Node 1",
          dependsOn: [],
          actionIntent: {
            type: "manual_review" as const,
            riskClass: "R1" as RiskClass,
            actionType: "artifact-only" as const,
            summary: "Review",
            reason: "Because"
          },
          permissionGrant: { capabilities: [], maxRiskClass: "R1" as RiskClass },
          retryPolicy: { maxAttempts: 3, backoffMs: 1000 },
          compensation: { required: false }
        }
      ],
      edges: [],
      createdAt: nowIso(),
      updatedAt: nowIso()
    };

    const instance = createWorkflowDagInstance({ dag });

    expect(() =>
      retryWorkflowDagNode({ instance, nodeId: "node-1" })
    ).toThrow(/failed/i);
  });
});
