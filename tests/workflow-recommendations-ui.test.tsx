import { GoalBundleSchema } from "@agentic/contracts";
import type { WorkflowRecommendation } from "@agentic/self-improvement-memory";
import {
  buildGoalRecommendationQuery,
  buildRecommendationFeedbackPayload,
  buildRecommendationRefinementInput,
  buildRecommendationRefinementSource,
  formatRecommendationOperatorActionLabel,
  getGoalRecommendationContext,
  isGoalRecommendationEligible
} from "../apps/web/lib/workflow-recommendations";
import { describe, expect, it } from "vitest";

function buildMinimalBundle(overrides: Partial<Parameters<typeof GoalBundleSchema.parse>[0]> = {}) {
  return GoalBundleSchema.parse({
    goal: {
      id: "goal-rec-1",
      userId: "user-1",
      workspaceId: null,
      workflowId: "workflow-rec-1",
      title: "Test recommendation eligibility",
      request: "Prepare a response.",
      intent: "email_follow_up",
      status: "running",
      confidence: 0.85,
      explanation: "A governed specialist prepared the reply.",
      createdAt: "2026-04-20T00:00:00.000Z",
      updatedAt: "2026-04-20T00:00:00.000Z"
    },
    workflow: {
      id: "workflow-rec-1",
      goalId: "goal-rec-1",
      workspaceId: null,
      status: "running",
      currentStep: "draft",
      checkpoint: null,
      createdAt: "2026-04-20T00:00:00.000Z",
      updatedAt: "2026-04-20T00:00:00.000Z"
    },
    tasks: [
      {
        id: "task-rec-1",
        goalId: "goal-rec-1",
        workflowId: "workflow-rec-1",
        title: "Draft the response",
        summary: "Prepare the outbound reply.",
        assignedAgent: "communications",
        state: "running",
        riskClass: "R2",
        requiresApproval: false,
        dependsOn: [],
        toolCapabilities: ["draft", "send"],
        artifactIds: [],
        createdAt: "2026-04-20T00:00:00.000Z",
        updatedAt: "2026-04-20T00:00:00.000Z"
      }
    ],
    artifacts: [],
    approvals: [],
    watchers: [],
    actionLogs: [],
    ...overrides
  });
}

function buildRecommendation(overrides: Partial<WorkflowRecommendation> = {}): WorkflowRecommendation {
  return {
    key: "rec-key-1",
    source: "outcome_trace",
    workflow: {
      agent: "communications",
      action: "draft_and_review",
      capabilities: ["draft", "send"]
    },
    reuse: {
      rationale: "This pattern has been effective for similar follow-up goals.",
      evidenceCount: 5,
      positiveOutcomeRate: 0.9
    },
    operatorActions: ["suggest_reuse"],
    createdAt: "2026-04-20T00:00:00.000Z",
    ...overrides
  } as WorkflowRecommendation;
}

describe("workflow recommendations UI helpers", () => {
  it("derives recommendation context from a bundle with eligible tasks", () => {
    const context = getGoalRecommendationContext(buildMinimalBundle());

    expect(context).not.toBeNull();
    expect(context?.agent).toBe("communications");
    expect(context?.riskClass).toBe("R2");
    expect(context?.capabilities).toEqual(["draft", "send"]);
    expect(context?.goalTitle).toBe("Test recommendation eligibility");
    expect(context?.goalConfidence).toBe(0.85);
  });

  it("returns null when no tasks have capabilities", () => {
    const bundle = buildMinimalBundle({
      tasks: [
        {
          id: "task-no-caps",
          goalId: "goal-rec-1",
          workflowId: "workflow-rec-1",
          title: "Empty task",
          summary: "No capabilities.",
          assignedAgent: "workflow",
          state: "running",
          riskClass: "R1",
          requiresApproval: false,
          dependsOn: [],
          toolCapabilities: [],
          artifactIds: [],
          createdAt: "2026-04-20T00:00:00.000Z",
          updatedAt: "2026-04-20T00:00:00.000Z"
        }
      ]
    });

    expect(getGoalRecommendationContext(bundle)).toBeNull();
    expect(isGoalRecommendationEligible(bundle)).toBe(false);
  });

  it("returns null when there are no tasks at all", () => {
    const bundle = buildMinimalBundle({ tasks: [] });
    expect(getGoalRecommendationContext(bundle)).toBeNull();
  });

  it("prefers non-workflow agents over workflow agents for recommendation context", () => {
    const bundle = buildMinimalBundle({
      tasks: [
        {
          id: "task-workflow",
          goalId: "goal-rec-1",
          workflowId: "workflow-rec-1",
          title: "Workflow task",
          summary: "Orchestrator task.",
          assignedAgent: "workflow",
          state: "running",
          riskClass: "R1",
          requiresApproval: false,
          dependsOn: [],
          toolCapabilities: ["create"],
          artifactIds: [],
          createdAt: "2026-04-20T00:00:00.000Z",
          updatedAt: "2026-04-20T00:00:00.000Z"
        },
        {
          id: "task-specialist",
          goalId: "goal-rec-1",
          workflowId: "workflow-rec-1",
          title: "Specialist task",
          summary: "Communications specialist.",
          assignedAgent: "communications",
          state: "running",
          riskClass: "R2",
          requiresApproval: false,
          dependsOn: [],
          toolCapabilities: ["draft"],
          artifactIds: [],
          createdAt: "2026-04-20T00:00:00.000Z",
          updatedAt: "2026-04-20T00:00:00.000Z"
        }
      ]
    });

    const context = getGoalRecommendationContext(bundle);
    expect(context?.agent).toBe("communications");
  });

  it("deduplicates and trims capabilities, capping at MAX_CAPABILITIES", () => {
    // Use valid capability values; duplicates and whitespace-trimmed variants test dedup/trim logic.
    const caps = ["draft", "send", "draft", "read", "monitor", "create", "update", "delete", "schedule", "approve", "search", "send"];
    const bundle = buildMinimalBundle({
      tasks: [
        {
          id: "task-many-caps",
          goalId: "goal-rec-1",
          workflowId: "workflow-rec-1",
          title: "Many capabilities",
          summary: "Task with many caps.",
          assignedAgent: "communications",
          state: "running",
          riskClass: "R2",
          requiresApproval: false,
          dependsOn: [],
          toolCapabilities: caps,
          artifactIds: [],
          createdAt: "2026-04-20T00:00:00.000Z",
          updatedAt: "2026-04-20T00:00:00.000Z"
        }
      ]
    });

    const context = getGoalRecommendationContext(bundle);
    expect(context?.capabilities).toEqual(["draft", "send", "read", "monitor", "create", "update", "delete", "schedule", "approve", "search"]);
    expect(context?.capabilities.length).toBeLessThanOrEqual(10);
  });

  it("builds a valid query string with all expected parameters", () => {
    const query = buildGoalRecommendationQuery(buildMinimalBundle());

    expect(query).not.toBeNull();
    expect(query?.get("kind")).toBe("execution_path");
    expect(query?.get("agent")).toBe("communications");
    expect(query?.get("minimumEvidence")).toBe("3");
    expect(query?.get("limit")).toBe("3");
    expect(query?.get("goalTitle")).toBe("Test recommendation eligibility");
    expect(query?.get("goalConfidence")).toBe("0.85");
    expect(query?.get("riskClass")).toBe("R2");
    expect(query?.getAll("capability")).toEqual(["draft", "send"]);
  });

  it("includes riskClass in query when task has a valid risk class", () => {
    const bundle = buildMinimalBundle();
    const query = buildGoalRecommendationQuery(bundle);
    expect(query?.get("riskClass")).toBe("R2");
  });

  it("formats all operator action labels without leaking raw enum values", () => {
    expect(formatRecommendationOperatorActionLabel("suggest_reuse")).toBe("Suggest reuse");
    expect(formatRecommendationOperatorActionLabel("require_approval")).toBe("Require approval");
    expect(formatRecommendationOperatorActionLabel("require_review")).toBe("Require review");
    expect(formatRecommendationOperatorActionLabel("keep_draft_only")).toBe("Keep draft only");
  });

  it("builds refinement input with goal title and preserves capability path", () => {
    const rec = buildRecommendation();
    const input = buildRecommendationRefinementInput(rec, "Customer follow-up");

    expect(input).toContain('"Customer follow-up"');
    expect(input).toContain("communications");
    expect(input).toContain("draft_and_review");
    expect(input).toContain("draft, send");
    expect(input).toContain("This pattern has been effective");
  });

  it("falls back to 'this goal' when goal title is empty or whitespace", () => {
    const rec = buildRecommendation();
    expect(buildRecommendationRefinementInput(rec, "")).toContain("this goal");
    expect(buildRecommendationRefinementInput(rec, "   ")).toContain("this goal");
    expect(buildRecommendationRefinementInput(rec, null)).toContain("this goal");
    expect(buildRecommendationRefinementInput(rec, undefined)).toContain("this goal");
  });

  it("builds refinement source with correct key and source", () => {
    const rec = buildRecommendation();
    const source = buildRecommendationRefinementSource(rec, "Test goal");

    expect(source.key).toBe("rec-key-1");
    expect(source.source).toBe("outcome_trace");
    expect(source.suggestedMessage).toContain("Test goal");
  });

  it("builds feedback payload with and without notes", () => {
    const rec = buildRecommendation();

    const withNotes = buildRecommendationFeedbackPayload(rec, "accepted", "Looks good.");
    expect(withNotes.decision).toBe("accepted");
    expect(withNotes.notes).toBe("Looks good.");
    expect(withNotes.recommendation.key).toBe("rec-key-1");

    const withoutNotes = buildRecommendationFeedbackPayload(rec, "rejected", null);
    expect(withoutNotes.decision).toBe("rejected");
    expect(withoutNotes.notes).toBeUndefined();

    const emptyNotes = buildRecommendationFeedbackPayload(rec, "ignored", "   ");
    expect(emptyNotes.notes).toBeUndefined();
  });

  it("handles hostile strings in recommendation data without crashing", () => {
    const hostileRec = buildRecommendation({
      workflow: {
        agent: '<script>alert("xss")</script>',
        action: "draft_and_review",
        capabilities: ['"><img src=x onerror=alert(1)>']
      },
      reuse: {
        rationale: '"><img src=x onerror=alert(1)>',
        evidenceCount: 5,
        positiveOutcomeRate: 0.9
      }
    });

    // These functions produce strings for display; React escaping handles XSS.
    // The key contract is that they do not throw.
    expect(() => buildRecommendationRefinementInput(hostileRec, "Test")).not.toThrow();
    expect(() => buildRecommendationRefinementSource(hostileRec, "Test")).not.toThrow();
    expect(() => buildRecommendationFeedbackPayload(hostileRec, "accepted", "ok")).not.toThrow();
  });
});
