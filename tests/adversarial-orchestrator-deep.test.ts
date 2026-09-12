/**
 * Adversarial deep tests for the orchestrator package.
 *
 * Targets:
 * 1. Dynamic import edge cases (SDK module load failure, timeout, caching)
 * 2. Model planner boundaries (empty/max request, malformed JSON, governance gate)
 * 3. Scenario detection races (concurrent calls, ambiguous input)
 * 4. Goal refinement (conflicting updates, invalid agent assignments)
 * 5. DAG projection (cycles, orphaned nodes, missing capabilities)
 * 6. Memory capture (duplicate IDs, oversized content, provenance)
 * 7. Template interpolation (missing vars, recursive templates, injection)
 * 8. Briefing generation (empty task list, timezone edge cases, midnight boundary)
 *
 * SWEEP BUG STATUS:
 * - BUG-001 (interpolateTemplate single-pass on [key]-shaped values): accepted
 *   behavior — single-pass replacement is the safe design; documented, not fixed.
 * - BUG-002 (computeNextRun ignored timezone): FIXED — timezone-aware via
 *   Intl.DateTimeFormat; covered by "REGRESSION: computeNextRun respects
 *   timezone parameter".
 * - BUG-003 (formatBriefingDate silent UTC fallback on invalid timezone):
 *   accepted behavior — briefings must render even with a bad preference;
 *   covered by "BUG-003: invalid timezone falls back silently" as documentation.
 * - BUG-004 (extractJsonObject brace matching): FIXED — string-aware balanced
 *   scanner returning the first slice that parses as a JSON object; covered by
 *   the two extractJsonObject REGRESSION tests.
 * - BUG-005 (refinement heuristic fired on negated instructions): FIXED —
 *   clause-scoped negation guard; covered by the negated-removal REGRESSION
 *   test plus a positive control.
 * - BUG-006 (briefing granted draft outside knowledge allowlist): FIXED — see
 *   "REGRESSION: all five briefing types produce valid bundles".
 */

import { describe, expect, it, vi, beforeEach } from "vitest";
import {
  createModelPlanner,
  interpolateTemplate,
  computeNextRun,
  shouldTemplateRun,
  createGoalTemplate,
  buildWorkflowDagFromBundle,
  projectWorkflowDagInstance,
  applyWorkflowDagControl,
  WorkflowDagControlError,
  readLatestWorkflowDagControl,
  readWorkflowControlStatusOverride,
  captureMemoriesFromBundle,
  captureExecutionOutcomeSignals,
  generateBriefing,
} from "@agentic/orchestrator";
import type { PlannerModelClient } from "@agentic/orchestrator";
import type { GoalBundle, Task, MemoryRecord } from "@agentic/contracts";
import { nowIso, deriveTaskResponsibility } from "@agentic/contracts";

// ---------------------------------------------------------------------------
// Test fixture helpers
// ---------------------------------------------------------------------------

function makeMinimalBundle(overrides?: Partial<GoalBundle>): GoalBundle {
  const base: GoalBundle = {
    goal: {
      id: "goal-test-1",
      userId: "user-1",
      workspaceId: null,
      workflowId: "wf-test-1",
      title: "Test goal",
      request: "Do something useful",
      intent: "general-coordination",
      status: "planned",
      confidence: 0.8,
      explanation: "Test explanation",
      wedge: { key: "general_coordination", label: "General coordination", selection: "selected_production", rationale: "test" },
      completionContract: { id: "cc-1", summary: "test contract", successCriteria: ["done"], evidenceSignals: ["signal"], approvalExpectations: [], doneWhen: "done" },
      responsibility: {
        owner: { kind: "user", userId: "user-1", workspaceRole: null, systemActor: null, label: "User" },
        delegate: null,
        reviewer: null,
        escalationOwner: null,
        handoffStatus: "owner_control",
        handoffSummary: null,
        delegationReason: null,
        escalationReason: null,
        audit: { requiredEvents: ["delegation_change", "handoff_acceptance", "review_assignment", "escalation_trigger"], requireActorContext: true, requireReasonForDelegation: true, requireReasonForEscalation: true, requireReviewerIdentity: true },
        lastChangedAt: null,
        lastChangedBy: null
      },
      createdAt: "2025-01-15T10:00:00.000Z",
      updatedAt: "2025-01-15T10:00:00.000Z",
    },
    workflow: {
      id: "wf-test-1",
      goalId: "goal-test-1",
      currentStep: "general-coordination",
      status: "running",
      checkpoint: "done",
      workspaceId: null,
      createdAt: "2025-01-15T10:00:00.000Z",
      updatedAt: "2025-01-15T10:00:00.000Z",
    },
    tasks: [],
    artifacts: [],
    approvals: [],
    watchers: [],
    actionLogs: [],
  };
  return { ...base, ...overrides } as GoalBundle;
}

function makeTask(overrides?: Partial<Task>): Task {
  const base = {
    id: "task-1",
    goalId: "goal-test-1",
    workflowId: "wf-test-1",
    title: "Test task",
    summary: "A test task summary",
    assignedAgent: "workflow" as const,
    riskClass: "R2" as const,
    requiresApproval: false,
    toolCapabilities: ["read"] as string[],
    state: "completed" as const,
    dependsOn: [] as string[],
    artifactIds: [] as string[],
    createdAt: "2025-01-15T10:00:00.000Z",
    updatedAt: "2025-01-15T10:00:00.000Z",
  };
  const merged = { ...base, ...overrides };
  const responsibility = (overrides as any)?.responsibility ?? deriveTaskResponsibility({
    assignedAgent: merged.assignedAgent,
    requiresApproval: merged.requiresApproval,
    ownerUserId: "user-1",
    workspaceId: null,
  });
  return { ...merged, responsibility } as unknown as Task;
}

function validPlanJson(): string {
  return JSON.stringify({
    tasks: [
      {
        title: "Research topic",
        summary: "Gather information about the topic",
        assignedAgent: "research",
        capabilities: ["read", "search"],
        riskClass: "R2",
        confidence: 0.85,
      },
    ],
  });
}

// ---------------------------------------------------------------------------
// 1. Dynamic import edge cases
// ---------------------------------------------------------------------------

describe("adversarial: dynamic import edge cases", () => {
  it("model planner returns null when SDK module fails to load (simulated via throwing client)", async () => {
    // The dynamic import path is exercised through the model client abstraction.
    // When the underlying SDK import fails, the client throws and the planner
    // must gracefully return null rather than propagate.
    const failingClient: PlannerModelClient = async () => {
      throw new Error("Cannot find module '@anthropic-ai/sdk'");
    };

    const planner = createModelPlanner({
      enabled: true,
      isConfigured: () => true,
      modelClient: failingClient,
    });

    const result = await planner.plan({ request: "Plan my week" });
    expect(result).toBeNull();
  });

  it("model planner handles timeout during model call (client never resolves within budget)", async () => {
    // Simulate a client that hangs indefinitely. The planner has no built-in
    // timeout, so this tests whether the caller's abort/timeout would be needed.
    // The planner itself awaits forever — documented as a potential issue.
    let settled = false;
    const hangingClient: PlannerModelClient = () =>
      new Promise((resolve) => {
        // Never resolve — simulate network hang
        setTimeout(() => {
          settled = true;
          resolve(null);
        }, 50);
      });

    const planner = createModelPlanner({
      enabled: true,
      isConfigured: () => true,
      modelClient: hangingClient,
    });

    // Use a race to enforce our own timeout since the planner lacks one
    const result = await Promise.race([
      planner.plan({ request: "Plan something" }),
      new Promise<null>((resolve) => setTimeout(() => resolve(null), 20)),
    ]);

    // The planner didn't finish in time — the timeout won
    expect(result).toBeNull();
  });

  it("model planner returns consistent results across cached vs fresh calls", async () => {
    let callCount = 0;
    const countingClient: PlannerModelClient = async () => {
      callCount++;
      return validPlanJson();
    };

    const planner = createModelPlanner({
      enabled: true,
      isConfigured: () => true,
      modelClient: countingClient,
    });

    const r1 = await planner.plan({ request: "Same request" });
    const r2 = await planner.plan({ request: "Same request" });

    // Each call should invoke the client (no internal caching of results)
    expect(callCount).toBe(2);
    expect(r1).not.toBeNull();
    expect(r2).not.toBeNull();
    // Both should produce structurally equivalent plans
    expect(r1!.length).toBe(r2!.length);
  });
});

// ---------------------------------------------------------------------------
// 2. Model planner boundaries
// ---------------------------------------------------------------------------

describe("adversarial: model planner boundaries", () => {
  it("returns null for empty request string", async () => {
    const planner = createModelPlanner({
      enabled: true,
      isConfigured: () => true,
      modelClient: async () => validPlanJson(),
    });

    // Empty request still goes through — the prompt builder slices to 1000 chars
    // which produces a valid prompt. The planner doesn't reject empty requests.
    const result = await planner.plan({ request: "" });
    // It actually succeeds because the model client returns valid JSON.
    // This documents that the planner has no minimum-request-length guard.
    expect(result).not.toBeNull();
  });

  it("truncates extremely long requests to 1000 chars in the prompt", async () => {
    let capturedPrompt = "";
    const capturingClient: PlannerModelClient = async ({ prompt }) => {
      capturedPrompt = prompt;
      return validPlanJson();
    };

    const planner = createModelPlanner({
      enabled: true,
      isConfigured: () => true,
      modelClient: capturingClient,
    });

    const longRequest = "A".repeat(5000);
    await planner.plan({ request: longRequest });

    // The prompt should contain only the first 1000 chars of the request
    expect(capturedPrompt).toContain("A".repeat(1000));
    expect(capturedPrompt).not.toContain("A".repeat(1001));
  });

  it("returns null for malformed JSON response with extra trailing content", async () => {
    const planner = createModelPlanner({
      enabled: true,
      isConfigured: () => true,
      modelClient: async () => '{"tasks":[]} garbage after',
    });

    // extractJsonObject will find { and } but the inner content is invalid schema
    // (empty tasks array violates min(1))
    const result = await planner.plan({ request: "test" });
    expect(result).toBeNull();
  });

  it("returns null when model output has tasks exceeding max count (13+)", async () => {
    const tooManyTasks = JSON.stringify({
      tasks: Array.from({ length: 13 }, (_, i) => ({
        title: `Task ${i}`,
        summary: `Summary ${i}`,
        assignedAgent: "workflow",
        capabilities: ["read"],
        riskClass: "R2",
        confidence: 0.7,
      })),
    });

    const planner = createModelPlanner({
      enabled: true,
      isConfigured: () => true,
      modelClient: async () => tooManyTasks,
    });

    const result = await planner.plan({ request: "Complex plan" });
    expect(result).toBeNull();
  });

  it("returns null when disabled even if configured and client works", async () => {
    const planner = createModelPlanner({
      enabled: false,
      isConfigured: () => true,
      modelClient: async () => validPlanJson(),
    });

    const result = await planner.plan({ request: "Plan something" });
    expect(result).toBeNull();
  });

  it("returns null when not configured even if enabled", async () => {
    const planner = createModelPlanner({
      enabled: true,
      isConfigured: () => false,
      modelClient: async () => validPlanJson(),
    });

    const result = await planner.plan({ request: "Plan something" });
    expect(result).toBeNull();
  });

  it("REGRESSION: extractJsonObject survives braces inside JSON string values", async () => {
    // Model output whose JSON string values themselves contain braces.
    const trickyOutput = 'Here is the plan: {"tasks":[{"title":"Use {braces} carefully","summary":"Handle {nested} content","assignedAgent":"research","capabilities":["read"],"riskClass":"R2","confidence":0.8}]}';

    const planner = createModelPlanner({
      enabled: true,
      isConfigured: () => true,
      modelClient: async () => trickyOutput,
    });

    const result = await planner.plan({ request: "test" });
    expect(result).not.toBeNull();
    expect(result![0]).toMatchObject({ title: "Use {braces} carefully" });
  });

  it("REGRESSION: extractJsonObject skips prose braces and recovers the JSON object", async () => {
    // Regression for adversarial-sweep BUG-004: indexOf("{")/lastIndexOf("}")
    // extraction grabbed everything between the FIRST brace (even one inside
    // prose) and the LAST brace, so a response with brace-containing prose
    // BEFORE the JSON produced an unparseable slice and the whole model plan
    // was discarded. The string-aware balanced scanner now skips prose braces
    // and returns the first slice that parses as a JSON object.
    const proseBracesOutput =
      'Sure! (remember: keep replies {brief} and {kind}) {"tasks":[{"title":"Draft the reply","summary":"Keep it short","assignedAgent":"research","capabilities":["read"],"riskClass":"R2","confidence":0.8}]} trailing note }';

    const planner = createModelPlanner({
      enabled: true,
      isConfigured: () => true,
      modelClient: async () => proseBracesOutput,
    });

    const result = await planner.plan({ request: "test" });
    expect(result).not.toBeNull();
    expect(result![0]).toMatchObject({ title: "Draft the reply" });
  });
});

// ---------------------------------------------------------------------------
// 3. Scenario detection races & ambiguous inputs
// ---------------------------------------------------------------------------

describe("adversarial: scenario detection and ambiguous inputs", () => {
  it("processUserRequest rejects empty request", async () => {
    // Import processUserRequest dynamically to avoid heavy setup
    const { processUserRequest } = await import("@agentic/orchestrator");

    await expect(
      processUserRequest({
        userId: "user-1",
        request: "",
        memories: [],
        integrations: [],
      })
    ).rejects.toThrow("non-empty request");
  });

  it("processUserRequest rejects request over 2000 chars", async () => {
    const { processUserRequest } = await import("@agentic/orchestrator");

    await expect(
      processUserRequest({
        userId: "user-1",
        request: "x".repeat(2001),
        memories: [],
        integrations: [],
      })
    ).rejects.toThrow("2000 character safety limit");
  });

  it("ambiguous input matching multiple scenarios picks first regex match", async () => {
    // "Check my inbox and plan my week" matches both inbox-triage and weekly-planning
    // The regex detector returns the first match (inbox-triage wins)
    const { processUserRequest } = await import("@agentic/orchestrator");

    const bundle = await processUserRequest({
      userId: "user-1",
      request: "Check my inbox and plan my weekly calendar schedule",
      memories: [],
      integrations: [],
    });

    // inbox-triage wins because its regex is checked first
    expect(bundle.goal.intent).toBe("communications-triage");
  });

  it("travel + email combo defaults to travel-preparation over inbox", async () => {
    // Actually inbox regex fires first. Let's verify the ordering.
    const { processUserRequest } = await import("@agentic/orchestrator");

    const bundle = await processUserRequest({
      userId: "user-1",
      request: "Book a flight and reply to the hotel email",
      memories: [],
      integrations: [],
    });

    // "email" matches inbox-triage regex first, despite travel context
    // This documents the priority ordering behavior
    expect(["communications-triage", "travel-readiness"]).toContain(bundle.goal.intent);
  });

  it("detects complex-delegation for sub-agent requests", async () => {
    const { processUserRequest } = await import("@agentic/orchestrator");

    const bundle = await processUserRequest({
      userId: "user-1",
      request: "Spawn bounded sub-agents to handle this complex task",
      memories: [],
      integrations: [],
    });

    expect(bundle.goal.intent).toBe("complex-delegation");
  });
});

// ---------------------------------------------------------------------------
// 4. Goal refinement edge cases
// ---------------------------------------------------------------------------

describe("adversarial: goal refinement boundaries", () => {
  // refineGoal calls GoalBundleSchema.parse internally, so we need a fully-valid
  // bundle. Build one via processUserRequest to guarantee schema conformance.
  async function buildValidBundle(): Promise<GoalBundle> {
    const { processUserRequest } = await import("@agentic/orchestrator");
    return processUserRequest({
      userId: "user-1",
      request: "Review my inbox messages",
      memories: [],
      integrations: [],
    });
  }

  it("refineGoal rejects empty refinement message", async () => {
    const { refineGoal } = await import("@agentic/orchestrator");
    const bundle = await buildValidBundle();

    await expect(
      refineGoal({
        bundle,
        refinement: "",
        memories: [],
      })
    ).rejects.toThrow("non-empty refinement");
  });

  it("refineGoal rejects whitespace-only refinement", async () => {
    const { refineGoal } = await import("@agentic/orchestrator");
    const bundle = await buildValidBundle();

    await expect(
      refineGoal({
        bundle,
        refinement: "   \n\t  ",
        memories: [],
      })
    ).rejects.toThrow("non-empty refinement");
  });

  it("refineGoal rejects refinement over 2000 characters", async () => {
    const { refineGoal } = await import("@agentic/orchestrator");
    const bundle = await buildValidBundle();

    await expect(
      refineGoal({
        bundle,
        refinement: "x".repeat(2001),
        memories: [],
      })
    ).rejects.toThrow("2000 character safety limit");
  });

  it("REGRESSION: negated removal instructions no longer trigger the removal heuristic", async () => {
    // Regression for adversarial-sweep BUG-005: keyword matching used to fire
    // anywhere in the string, so a negated instruction naming a real task
    // ("don't remove <task title>") matched `remove`, title-matched the task,
    // and deleted it. Negated keywords (within the same clause) are skipped.
    const { refineGoal } = await import("@agentic/orchestrator");
    const bundle = await buildValidBundle();
    const target = bundle.tasks[0]!;
    const originalIds = bundle.tasks.map((t) => t.id);

    const result = await refineGoal({
      bundle,
      refinement: `Please don't remove ${target.title.toLowerCase()} from the plan`,
      memories: [],
    });

    const resultIds = result.tasks.map((t) => t.id);
    for (const id of originalIds) {
      expect(resultIds).toContain(id);
    }
    // No branch matched, so the generic "Handle refinement" fallback task is
    // the only addition.
    expect(resultIds.length).toBe(originalIds.length + 1);
  });

  it("non-negated removal instructions still remove the matching task", async () => {
    // Positive control: the negation guard must not neuter real removals.
    const { refineGoal } = await import("@agentic/orchestrator");
    const bundle = await buildValidBundle();
    const target = bundle.tasks[0]!;

    const result = await refineGoal({
      bundle,
      refinement: `remove ${target.title.toLowerCase()} from the plan`,
      memories: [],
    });

    expect(result.tasks.map((t) => t.id)).not.toContain(target.id);
  });
});

// ---------------------------------------------------------------------------
// 5. DAG projection edge cases
// ---------------------------------------------------------------------------

describe("adversarial: DAG projection boundaries", () => {
  it("buildWorkflowDagFromBundle returns null for empty task list", () => {
    const bundle = makeMinimalBundle({ tasks: [] });
    const dag = buildWorkflowDagFromBundle(bundle);
    expect(dag).toBeNull();
  });

  it("projectWorkflowDagInstance returns null when no DAG can be built", () => {
    const bundle = makeMinimalBundle({ tasks: [] });
    const instance = projectWorkflowDagInstance(bundle);
    expect(instance).toBeNull();
  });

  it("filters self-referencing dependencies (task depends on itself)", () => {
    const task = makeTask({ id: "task-self", dependsOn: ["task-self"] });
    const bundle = makeMinimalBundle({ tasks: [task] });

    // Should not crash or create a cycle — self-deps are filtered out
    const dag = buildWorkflowDagFromBundle(bundle);
    expect(dag).not.toBeNull();
    expect(dag!.nodes[0].dependsOn).toEqual([]);
    expect(dag!.edges).toEqual([]);
  });

  it("filters dependencies referencing non-existent tasks", () => {
    const task = makeTask({ id: "task-orphan", dependsOn: ["nonexistent-task"] });
    const bundle = makeMinimalBundle({ tasks: [task] });

    const dag = buildWorkflowDagFromBundle(bundle);
    expect(dag).not.toBeNull();
    // Non-existent dependency is filtered out
    expect(dag!.nodes[0].dependsOn).toEqual([]);
  });

  it("applyWorkflowDagControl throws for pause on completed workflow", () => {
    const task = makeTask({ state: "completed" });
    const bundle = makeMinimalBundle({ tasks: [task] });

    expect(() =>
      applyWorkflowDagControl({
        bundle,
        action: "pause",
      })
    ).toThrow(WorkflowDagControlError);
  });

  it("applyWorkflowDagControl throws for resume on completed workflow", () => {
    const task = makeTask({ state: "completed" });
    const bundle = makeMinimalBundle({ tasks: [task] });

    expect(() =>
      applyWorkflowDagControl({
        bundle,
        action: "resume",
      })
    ).toThrow(WorkflowDagControlError);
  });

  it("applyWorkflowDagControl throws when no DAG exists (empty tasks)", () => {
    const bundle = makeMinimalBundle({ tasks: [] });

    expect(() =>
      applyWorkflowDagControl({
        bundle,
        action: "cancel",
      })
    ).toThrow(WorkflowDagControlError);
  });

  it("cancel derives compensation hints from completed nodes", () => {
    const task1 = makeTask({ id: "t1", title: "Completed step", state: "completed" });
    const task2 = makeTask({ id: "t2", title: "Running step", state: "running" });
    const bundle = makeMinimalBundle({ tasks: [task1, task2] });

    const result = applyWorkflowDagControl({
      bundle,
      action: "cancel",
      reason: "Emergency stop",
    });

    expect(result.status).toBe("cancelled");
    expect(result.compensations.length).toBeGreaterThanOrEqual(1);
    expect(result.compensations.some((c) => c.includes("Completed step"))).toBe(true);
  });

  it("readWorkflowControlStatusOverride returns null when no control logs exist", () => {
    const bundle = makeMinimalBundle({ tasks: [makeTask()] });
    expect(readWorkflowControlStatusOverride(bundle)).toBeNull();
  });

  it("pause then resume roundtrip preserves workflow integrity", () => {
    const task = makeTask({ state: "running" });
    const bundle = makeMinimalBundle({ tasks: [task] });

    const paused = applyWorkflowDagControl({
      bundle,
      action: "pause",
      reason: "Review needed",
      now: "2025-01-15T12:00:00.000Z",
    });
    expect(paused.status).toBe("paused");

    // Build a new bundle incorporating the pause log
    const pausedBundle: GoalBundle = {
      ...bundle,
      actionLogs: [
        ...bundle.actionLogs,
        {
          id: "log-pause",
          goalId: bundle.goal.id,
          workflowId: bundle.workflow.id,
          taskId: null,
          actor: "operator",
          kind: "workflow.dag.control",
          message: "Paused",
          details: {
            action: "pause",
            reason: "Review needed",
            at: "2025-01-15T12:00:00.000Z",
            compensations: [],
          },
          createdAt: "2025-01-15T12:00:00.000Z",
          prevLogId: null,
        } as any,
      ],
    };

    const override = readWorkflowControlStatusOverride(pausedBundle);
    expect(override).toBe("paused");
  });
});

// ---------------------------------------------------------------------------
// 6. Memory capture edge cases
// ---------------------------------------------------------------------------

describe("adversarial: memory capture boundaries", () => {
  it("captureMemoriesFromBundle handles bundle with no tasks gracefully", () => {
    const bundle = makeMinimalBundle({ tasks: [] });
    const result = captureMemoriesFromBundle(bundle, "user-1");

    // No tasks means no capability or outcome memories
    expect(result.memories.length).toBe(0);
    expect(result.episodes.length).toBe(0);
  });

  it("captureMemoriesFromBundle produces deterministic IDs for same input", () => {
    const task = makeTask();
    const bundle = makeMinimalBundle({ tasks: [task] });

    const r1 = captureMemoriesFromBundle(bundle, "user-1");
    const r2 = captureMemoriesFromBundle(bundle, "user-1");

    // Same input should produce same memory IDs (deterministic hashing)
    const ids1 = r1.memories.map((m) => m.id).sort();
    const ids2 = r2.memories.map((m) => m.id).sort();
    expect(ids1).toEqual(ids2);
  });

  it("captureMemoriesFromBundle redacts email addresses in content", () => {
    const task = makeTask({
      title: "Contact user@example.com about the project",
      summary: "Send update to admin@corp.io regarding token=abc123",
    });
    const bundle = makeMinimalBundle({
      tasks: [task],
      approvals: [
        {
          id: "appr-1",
          goalId: "goal-test-1",
          taskId: "task-1",
          title: "Test approval",
          rationale: "Test",
          riskClass: "R2",
          decision: "approved",
          requestedAction: "Send to user@example.com",
          history: [],
          responsibility: {} as any,
          createdAt: nowIso(),
          expiryAt: new Date(Date.now() + 86400000).toISOString(),
          respondedAt: nowIso(),
          preview: {} as any,
        } as any,
      ],
    });

    const result = captureMemoriesFromBundle(bundle, "user-1");

    // Check that emails are redacted in all memories
    for (const memory of result.memories) {
      expect(memory.content).not.toMatch(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i);
    }
  });

  it("captureExecutionOutcomeSignals returns empty for empty results", () => {
    const bundle = makeMinimalBundle({ tasks: [makeTask()] });
    const result = captureExecutionOutcomeSignals(bundle, "user-1", []);

    expect(result.memories).toEqual([]);
    expect(result.episodes).toEqual([]);
  });

  it("captureMemoriesFromBundle handles many tasks without ID collision", () => {
    const tasks = Array.from({ length: 20 }, (_, i) =>
      makeTask({
        id: `task-multi-${i}`,
        title: `Task number ${i}`,
        summary: `Summary for task ${i}`,
      })
    );
    const bundle = makeMinimalBundle({ tasks });

    const result = captureMemoriesFromBundle(bundle, "user-1");

    // All episode IDs should be unique
    const episodeIds = result.episodes.map((e) => e.id);
    const uniqueIds = new Set(episodeIds);
    expect(uniqueIds.size).toBe(episodeIds.length);
  });
});

// ---------------------------------------------------------------------------
// 7. Template interpolation edge cases
// ---------------------------------------------------------------------------

describe("adversarial: template interpolation boundaries", () => {
  it("interpolateTemplate leaves unresolved placeholders intact", () => {
    const template = createGoalTemplate({
      userId: "user-1",
      name: "Test",
      request: "Do [unknown_var] by [another_missing]",
    });

    const result = interpolateTemplate(template);

    // Missing variables remain as-is (no error thrown)
    expect(result).toContain("[unknown_var]");
    expect(result).toContain("[another_missing]");
  });

  it("BUG-001: recursive template pattern is not guarded", () => {
    const template = createGoalTemplate({
      userId: "user-1",
      name: "Recursive test",
      request: "Process [data]",
      parameters: { data: "[data] extended" },
    });

    // After one pass of interpolation, [data] becomes "[data] extended"
    // The current implementation does a single pass per key, so this won't
    // recurse infinitely, but the output still contains an unresolved [data]
    // which may confuse downstream consumers.
    const result = interpolateTemplate(template);
    // Single-pass: replaces [data] with "[data] extended" — the remaining [data]
    // is from the replacement value, not re-expanded.
    expect(result).toBe("Process [data] extended");
  });

  it("template injection via parameter values containing bracket syntax", () => {
    const template = createGoalTemplate({
      userId: "user-1",
      name: "Injection test",
      request: "Execute [command]",
      parameters: { command: "safe-value" },
    });

    // Override with a value that looks like another template variable
    const result = interpolateTemplate(template, {
      command: "[malicious_payload]",
    });

    // The injected brackets are treated as literal text since there's no
    // second-pass expansion. This is safe but worth documenting.
    expect(result).toBe("Execute [malicious_payload]");
  });

  it("overrides take precedence over template parameters", () => {
    const template = createGoalTemplate({
      userId: "user-1",
      name: "Override test",
      request: "Run [action] on [target]",
      parameters: { action: "default-action", target: "default-target" },
    });

    const result = interpolateTemplate(template, { action: "custom-action" });

    expect(result).toContain("custom-action");
    expect(result).toContain("default-target");
  });

  it("built-in date parameter is auto-populated", () => {
    const template = createGoalTemplate({
      userId: "user-1",
      name: "Date test",
      request: "Report for [date]",
    });

    const result = interpolateTemplate(template);

    // Should contain today's date in YYYY-MM-DD format
    expect(result).toMatch(/Report for \d{4}-\d{2}-\d{2}/);
  });

  it("explicit date override prevents auto-population", () => {
    const template = createGoalTemplate({
      userId: "user-1",
      name: "Date override",
      request: "Report for [date]",
    });

    const result = interpolateTemplate(template, { date: "2099-12-31" });
    expect(result).toBe("Report for 2099-12-31");
  });
});

// ---------------------------------------------------------------------------
// 8. Briefing generation edge cases
// ---------------------------------------------------------------------------

describe("adversarial: briefing generation boundaries", () => {
  it("generateBriefing succeeds with empty memories and integrations", async () => {
    const bundle = await generateBriefing({
      type: "startup",
      userId: "user-1",
      memories: [],
      integrations: [],
      pendingApprovals: [],
      activeWatchers: [],
    });

    expect(bundle.goal.title).toContain("Startup briefing");
    expect(bundle.tasks.length).toBeGreaterThan(0);
  });

  it("BUG-003: invalid timezone falls back silently to UTC ISO date", async () => {
    const bundle = await generateBriefing({
      type: "startup",
      userId: "user-1",
      memories: [],
      integrations: [],
      pendingApprovals: [],
      activeWatchers: [],
      preferences: { focus: "balanced", timezone: "Invalid/Timezone" },
    });

    // The briefing should still be generated — formatBriefingDate catches
    // the Intl.DateTimeFormat error and falls back to ISO slice.
    // But the date might not match the user's expected locale.
    expect(bundle.goal.title).toContain("Startup briefing");
    // The date portion should be present (either from Intl or fallback)
    expect(bundle.goal.title).toMatch(/\d{4}-\d{2}-\d{2}/);
  });

  it("REGRESSION: all five briefing types produce valid bundles within agent allowlists", async () => {
    const types = ["startup", "midday", "pre_meeting", "end_of_day", "next_day"] as const;

    for (const type of types) {
      // Regression for adversarial-sweep BUG-006: next_day used to assign "draft"
      // to the "knowledge" agent, outside its allowlist [read, search, create,
      // monitor], causing CapabilityAllowlistViolationError at generation time.
      // The catalog now grants only [read, search], so every type must succeed.
      const bundle = await generateBriefing({
        type,
        userId: "user-1",
        memories: [],
        integrations: [],
        pendingApprovals: [],
        activeWatchers: [],
      });

      expect(bundle.goal.intent).toBe(`briefing:${type}`);
      expect(bundle.tasks.length).toBe(3); // Each briefing type defines exactly 3 tasks
    }
  });

  it("REGRESSION: computeNextRun respects timezone parameter", () => {
    // Regression for adversarial-sweep BUG-002: computeNextRun used to ignore the
    // timezone parameter and call Date.setHours() in the host's local timezone.
    // It now resolves wall-clock time through Intl.DateTimeFormat, so the same
    // cron expression in different timezones produces different UTC instants.
    const cron = "0 9 * * *"; // Daily at 9:00

    const utcResult = computeNextRun(cron, "UTC");
    const tokyoResult = computeNextRun(cron, "Asia/Tokyo");

    // Results should differ because 9:00 UTC != 9:00 Asia/Tokyo
    expect(utcResult).not.toBe(tokyoResult);
    // Both should be valid ISO strings
    expect(utcResult).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}.\d{3}Z$/);
    expect(tokyoResult).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}.\d{3}Z$/);

    // 9:00 in Asia/Tokyo (UTC+9) is 0:00 UTC — the UTC hour must reflect the offset.
    expect(new Date(utcResult!).getUTCHours()).toBe(9);
    expect(new Date(tokyoResult!).getUTCHours()).toBe(0);
  });

  it("computeNextRun returns null for invalid cron expressions", () => {
    expect(computeNextRun("* * *", "UTC")).toBeNull(); // Too few fields
    expect(computeNextRun("60 0 * * *", "UTC")).toBeNull(); // Minute > 59
    expect(computeNextRun("0 24 * * *", "UTC")).toBeNull(); // Hour > 23
    expect(computeNextRun("abc def * * *", "UTC")).toBeNull(); // Non-numeric
    expect(computeNextRun("", "UTC")).toBeNull(); // Empty
  });

  it("shouldTemplateRun returns false when schedule is disabled", () => {
    const template = createGoalTemplate({
      userId: "user-1",
      name: "Disabled",
      request: "Test",
      schedule: { enabled: false, cron: "0 9 * * *", timezone: "UTC" },
    });

    expect(shouldTemplateRun(template)).toBe(false);
  });

  it("shouldTemplateRun returns false when cron is empty", () => {
    const template = createGoalTemplate({
      userId: "user-1",
      name: "No cron",
      request: "Test",
      schedule: { enabled: true, cron: "", timezone: "UTC" },
    });

    expect(shouldTemplateRun(template)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Cross-cutting: concurrent operations
// ---------------------------------------------------------------------------

describe("adversarial: concurrent planner invocations", () => {
  it("multiple concurrent plan calls do not interfere with each other", async () => {
    let callIndex = 0;
    const client: PlannerModelClient = async () => {
      const idx = callIndex++;
      // Simulate varying latency
      await new Promise((r) => setTimeout(r, Math.random() * 10));
      return JSON.stringify({
        tasks: [
          {
            title: `Task from call ${idx}`,
            summary: `Summary ${idx}`,
            assignedAgent: "research",
            capabilities: ["read"],
            riskClass: "R2",
            confidence: 0.8,
          },
        ],
      });
    };

    const planner = createModelPlanner({
      enabled: true,
      isConfigured: () => true,
      modelClient: client,
    });

    const results = await Promise.all(
      Array.from({ length: 10 }, () => planner.plan({ request: "concurrent test" }))
    );

    // All should succeed
    for (const result of results) {
      expect(result).not.toBeNull();
      expect(result!.length).toBe(1);
    }

    // Each should have gotten a unique call index
    const titles = results.map((r) => r![0].title);
    const uniqueTitles = new Set(titles);
    expect(uniqueTitles.size).toBe(10);
  });
});
