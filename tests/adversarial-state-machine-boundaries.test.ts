import { describe, expect, it } from "vitest";
import { ApprovalRequestSchema, WatcherSchema, nowIso } from "@agentic/contracts";
import {
  canTransitionTaskState,
  canTransitionJobState,
  isJobClaimable,
  recomputeWorkflowStatuses,
  createTask,
  createJobRecord,
  computeJobRetryDelayMs
} from "@agentic/execution";

describe("adversarial task state machine boundaries", () => {
  it("completed is a terminal state with no legal outgoing transitions", () => {
    const targets = ["queued", "running", "waiting", "blocked", "retrying", "failed", "completed"];
    for (const target of targets) {
      expect(canTransitionTaskState("completed", target)).toBe(false);
    }
  });

  it("every non-terminal state has at least one legal outgoing transition", () => {
    const states = ["queued", "running", "waiting", "blocked", "retrying", "failed"];
    const targets = ["queued", "running", "waiting", "blocked", "retrying", "failed", "completed"];
    for (const state of states) {
      const hasLegalTransition = targets.some((target) => canTransitionTaskState(state, target));
      expect(hasLegalTransition, `${state} should have at least one legal transition`).toBe(true);
    }
  });

  it("self-transitions are always illegal", () => {
    const states = ["queued", "running", "waiting", "blocked", "retrying", "failed", "completed"];
    for (const state of states) {
      expect(canTransitionTaskState(state, state)).toBe(false);
    }
  });
});

describe("adversarial job state machine boundaries", () => {
  it("terminal job states have no legal outgoing transitions", () => {
    const targets = ["queued", "running", "retrying", "paused", "cancelled", "completed", "dead_letter"];
    for (const target of targets) {
      expect(canTransitionJobState("completed", target)).toBe(false);
      expect(canTransitionJobState("cancelled", target)).toBe(false);
      expect(canTransitionJobState("dead_letter", target)).toBe(false);
    }
  });

  it("self-transitions are always illegal for jobs", () => {
    const states = ["queued", "running", "retrying", "paused", "cancelled", "completed", "dead_letter"];
    for (const state of states) {
      expect(canTransitionJobState(state, state)).toBe(false);
    }
  });
});

describe("adversarial isJobClaimable boundary values", () => {
  it("refuses a job whose attemptCount equals maxAttempts", () => {
    const job = createJobRecord({
      userId: "user-1",
      kind: "docs_render",
      maxAttempts: 3,
      payload: { type: "docs_render", metadata: {} }
    });
    const exhausted = { ...job, attemptCount: 3, status: "queued" as const };
    expect(isJobClaimable(exhausted)).toBe(false);
  });

  it("refuses a job whose attemptCount exceeds maxAttempts", () => {
    const job = createJobRecord({
      userId: "user-1",
      kind: "docs_render",
      maxAttempts: 3,
      payload: { type: "docs_render", metadata: {} }
    });
    const overBudget = { ...job, attemptCount: 5, status: "queued" as const };
    expect(isJobClaimable(overBudget)).toBe(false);
  });

  it("refuses a queued job whose availableAt is in the future", () => {
    const job = createJobRecord({
      userId: "user-1",
      kind: "docs_render",
      availableAt: new Date(Date.now() + 60_000).toISOString(),
      payload: { type: "docs_render", metadata: {} }
    });
    expect(isJobClaimable(job)).toBe(false);
  });

  it("accepts a queued job whose availableAt is exactly now", () => {
    const now = Date.now();
    const job = createJobRecord({
      userId: "user-1",
      kind: "docs_render",
      availableAt: new Date(now).toISOString(),
      payload: { type: "docs_render", metadata: {} }
    });
    expect(isJobClaimable(job, now)).toBe(true);
  });

  it("refuses a job with an unparseable availableAt", () => {
    const job = createJobRecord({
      userId: "user-1",
      kind: "docs_render",
      payload: { type: "docs_render", metadata: {} }
    });
    const corrupt = { ...job, availableAt: "not-a-date" };
    expect(isJobClaimable(corrupt)).toBe(false);
  });

  it("claims an expired-lease running job", () => {
    const now = Date.now();
    const job = createJobRecord({
      userId: "user-1",
      kind: "docs_render",
      payload: { type: "docs_render", metadata: {} }
    });
    const expiredLease = {
      ...job,
      status: "running" as const,
      claimedBy: "other-worker",
      leaseExpiresAt: new Date(now - 1_000).toISOString()
    };
    expect(isJobClaimable(expiredLease, now)).toBe(true);
  });

  it("refuses a running job whose lease has not expired", () => {
    const now = Date.now();
    const job = createJobRecord({
      userId: "user-1",
      kind: "docs_render",
      payload: { type: "docs_render", metadata: {} }
    });
    const activeLease = {
      ...job,
      status: "running" as const,
      claimedBy: "other-worker",
      leaseExpiresAt: new Date(now + 30_000).toISOString()
    };
    expect(isJobClaimable(activeLease, now)).toBe(false);
  });

  it("refuses a running job with no leaseExpiresAt", () => {
    const job = createJobRecord({
      userId: "user-1",
      kind: "docs_render",
      payload: { type: "docs_render", metadata: {} }
    });
    const noLease = {
      ...job,
      status: "running" as const,
      claimedBy: "other-worker",
      leaseExpiresAt: null
    };
    expect(isJobClaimable(noLease)).toBe(false);
  });
});

describe("adversarial recomputeWorkflowStatuses edge cases", () => {
  it("returns completed when there are no tasks, no approvals, and no watchers", () => {
    const result = recomputeWorkflowStatuses([], [], []);
    expect(result).toEqual({ goalStatus: "completed", workflowStatus: "completed" });
  });

  it("paused control overrides everything including pending approvals", () => {
    const task = createTask({
      goalId: "g",
      workflowId: "w",
      title: "T",
      summary: "S",
      assignedAgent: "workflow",
      riskClass: "R2",
      requiresApproval: true,
      toolCapabilities: ["draft"],
      state: "waiting"
    });
    const approval = ApprovalRequestSchema.parse({
      id: "a",
      goalId: "g",
      taskId: task.id,
      title: "A",
      rationale: "R",
      riskClass: "R2",
      decision: "pending",
      requestedAction: "Act",
      createdAt: nowIso(),
      expiryAt: new Date(Date.now() + 60_000).toISOString(),
      respondedAt: null
    });
    const result = recomputeWorkflowStatuses([task], [approval], [], "paused");
    expect(result).toEqual({ goalStatus: "waiting", workflowStatus: "paused" });
  });

  it("cancelled control overrides everything including active watchers", () => {
    const watcher = WatcherSchema.parse({
      id: "w1",
      goalId: "g",
      targetEntity: "inbox",
      condition: "new email",
      frequency: "hourly",
      triggerAction: "notify",
      sourceSystems: ["email"],
      status: "active",
      expiryAt: null,
      createdAt: nowIso(),
      updatedAt: nowIso()
    });
    const result = recomputeWorkflowStatuses([], [], [watcher], "cancelled");
    expect(result).toEqual({ goalStatus: "waiting", workflowStatus: "cancelled" });
  });

  it("resumes normal recompute when control override is null", () => {
    const task = createTask({
      goalId: "g",
      workflowId: "w",
      title: "T",
      summary: "S",
      assignedAgent: "workflow",
      riskClass: "R1",
      requiresApproval: false,
      toolCapabilities: ["read"],
      state: "completed"
    });
    const result = recomputeWorkflowStatuses([task], [], [], null);
    expect(result).toEqual({ goalStatus: "completed", workflowStatus: "completed" });
  });
});

describe("adversarial computeJobRetryDelayMs additional boundaries", () => {
  it("handles negative attempt counts gracefully", () => {
    const delay = computeJobRetryDelayMs(-1, { baseDelayMs: 1_000, factor: 2 });
    expect(delay).toBe(1_000);
    expect(Number.isFinite(delay)).toBe(true);
  });

  it("handles zero baseDelayMs without producing NaN", () => {
    const delay = computeJobRetryDelayMs(5, { baseDelayMs: 0, factor: 2, maxDelayMs: 60_000 });
    expect(delay).toBe(0);
    expect(Number.isFinite(delay)).toBe(true);
  });

  it("handles extremely large attempt counts without overflow", () => {
    const delay = computeJobRetryDelayMs(Number.MAX_SAFE_INTEGER, {
      baseDelayMs: 1_000,
      factor: 2,
      maxDelayMs: 60_000
    });
    expect(delay).toBe(60_000);
    expect(Number.isFinite(delay)).toBe(true);
  });

  it("produces deterministic results with jitter ratio 0", () => {
    const a = computeJobRetryDelayMs(3, { baseDelayMs: 1_000, factor: 2, maxDelayMs: 60_000 }, { jitterRatio: 0 });
    const b = computeJobRetryDelayMs(3, { baseDelayMs: 1_000, factor: 2, maxDelayMs: 60_000 }, { jitterRatio: 0 });
    expect(a).toBe(b);
  });
});
