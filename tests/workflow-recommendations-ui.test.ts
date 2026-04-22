import type { GoalBundle } from "@agentic/contracts";
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

function buildBundle(overrides?: Partial<GoalBundle>): GoalBundle {
  return {
    goal: {
      id: "goal-1",
      userId: "user-1",
      workspaceId: null,
      workflowId: "workflow-1",
      title: "Ship a reviewed response",
      request: "Prepare a response with visible execution metadata.",
      intent: "email_follow_up",
      status: "running",
      confidence: 0.81,
      explanation: "A governed specialist prepared the reply.",
      createdAt: "2026-04-20T00:00:00.000Z",
      updatedAt: "2026-04-20T00:00:00.000Z"
    },
    workflow: {
      id: "workflow-1",
      goalId: "goal-1",
      workspaceId: null,
      status: "running",
      currentStep: "approval",
      checkpoint: null,
      createdAt: "2026-04-20T00:00:00.000Z",
      updatedAt: "2026-04-20T00:00:00.000Z"
    },
    tasks: [
      {
        id: "task-1",
        goalId: "goal-1",
        workflowId: "workflow-1",
        title: "Coordinate the workflow",
        summary: "Keep the plan moving.",
        assignedAgent: "workflow",
        state: "waiting",
        riskClass: "R2",
        requiresApproval: false,
        dependsOn: [],
        toolCapabilities: ["read"],
        artifactIds: [],
        createdAt: "2026-04-20T00:00:00.000Z",
        updatedAt: "2026-04-20T00:00:00.000Z"
      },
      {
        id: "task-2",
        goalId: "goal-1",
        workflowId: "workflow-1",
        title: "Draft the external message",
        summary: "Prepare the outbound reply.",
        assignedAgent: "communications",
        state: "waiting",
        riskClass: "R3",
        requiresApproval: true,
        dependsOn: [],
        toolCapabilities: ["draft", "send", "send"],
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
  };
}

function buildRecommendation(): WorkflowRecommendation {
  return {
    key: "execution_path:communications:send_message:R3:send",
    source: "outcome_trace",
    workflow: {
      kind: "execution_path",
      agent: "communications",
      action: "send_message",
      riskClass: "R3",
      capabilities: ["draft", "send"]
    },
    reuse: {
      replayMode: "approval_required",
      operatorAction: "require_approval",
      rationale: "Reviewed outbound messages succeed when communications keeps the send path."
    },
    evidence: {
      count: 7,
      approvalCount: 7,
      successCount: 6,
      partialCount: 1,
      failureCount: 0,
      rejectionCount: 0,
      userCorrectionCount: 1,
      averageConfidence: 0.78,
      approvalRate: 1,
      successRate: 0.93,
      negativeRate: 0.14,
      score: 0.81,
      lastSeenAt: "2026-04-20T00:00:00.000Z"
    }
  };
}

describe("workflow recommendation ui helpers", () => {
  it("prefers a specialist task when building the recommendation context and query", () => {
    const bundle = buildBundle();
    const context = getGoalRecommendationContext(bundle);
    const query = buildGoalRecommendationQuery(bundle);

    expect(context).toEqual({
      agent: "communications",
      riskClass: "R3",
      capabilities: ["draft", "send"]
    });
    expect(query?.get("kind")).toBe("execution_path");
    expect(query?.get("agent")).toBe("communications");
    expect(query?.get("riskClass")).toBe("R3");
    expect(query?.getAll("capability")).toEqual(["draft", "send"]);
    expect(query?.get("minimumEvidence")).toBe("3");
    expect(query?.get("limit")).toBe("3");
    expect(isGoalRecommendationEligible(bundle)).toBe(true);
  });

  it("fails closed when no task exposes any capabilities", () => {
    const bundle = buildBundle({
      tasks: [
        {
          ...buildBundle().tasks[0],
          toolCapabilities: []
        }
      ]
    });

    expect(getGoalRecommendationContext(bundle)).toBeNull();
    expect(buildGoalRecommendationQuery(bundle)).toBeNull();
    expect(isGoalRecommendationEligible(bundle)).toBe(false);
  });

  it("builds operator-safe refinement and feedback payloads", () => {
    const recommendation = buildRecommendation();
    const refinement = buildRecommendationRefinementInput(recommendation, "Ship a reviewed response");
    const source = buildRecommendationRefinementSource(recommendation, "Ship a reviewed response");
    const payload = buildRecommendationFeedbackPayload(recommendation, "edited", "Preserve the approval step.");

    expect(refinement).toContain('Refine "Ship a reviewed response"');
    expect(refinement).toContain("communications send_message");
    expect(refinement).toContain("draft, send");
    expect(source).toEqual({
      key: recommendation.key,
      source: "outcome_trace",
      suggestedMessage: refinement
    });
    expect(payload).toEqual({
      decision: "edited",
      recommendation,
      notes: "Preserve the approval step."
    });
    expect(formatRecommendationOperatorActionLabel(recommendation.reuse.operatorAction)).toBe("Require approval");
  });
});
