import { renderToStaticMarkup } from "react-dom/server";
import type { GoalBundle } from "@agentic/contracts";
import { computeWorkflowTrust, recommendWorkflowPromotion } from "@agentic/policy";
import type { WorkflowOutcomeAggregate } from "@agentic/self-improvement-memory";
import {
  DashboardGoalsCard,
  type RecommendationLoadState
} from "../apps/web/components/dashboard-goals-card";
import type { GoalWorkflowTrustEntry } from "../apps/web/components/dashboard-types";

function buildEligibleBundle(): GoalBundle {
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
        title: "Draft the external message",
        summary: "Prepare the outbound reply.",
        assignedAgent: "communications",
        state: "waiting",
        riskClass: "R2",
        requiresApproval: true,
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
    actionLogs: []
  };
}

function stageTally(total: number, positive: number) {
  const negative = total - positive;
  return {
    total,
    positive,
    negative,
    rate: total === 0 ? 0 : Math.min(1, Math.max(0, positive / total))
  };
}

function buildAggregate(overrides: Partial<WorkflowOutcomeAggregate> & { workflowId: string }): WorkflowOutcomeAggregate {
  return {
    sampleCount: 0,
    riskClass: null,
    firstObservedAt: "2026-04-20T00:00:00.000Z",
    lastObservedAt: "2026-04-20T00:00:00.000Z",
    draft: stageTally(0, 0),
    approval: stageTally(0, 0),
    execution: stageTally(0, 0),
    correction: stageTally(0, 0),
    recentNegativeOutcomeRate: 0,
    recentWindowSize: 0,
    ...overrides
  };
}

function buildTrustEntry(aggregate: WorkflowOutcomeAggregate): GoalWorkflowTrustEntry {
  const trust = computeWorkflowTrust(aggregate);
  const promotion = recommendWorkflowPromotion({ aggregate, trust });
  return { workflowId: aggregate.workflowId, trust, promotion };
}

function buildWorkflowTrust(): GoalWorkflowTrustEntry[] {
  // A clean, well-evidenced R2 workflow: every guardrail satisfied -> promote.
  const promote = buildAggregate({
    workflowId: "workflow-promote",
    sampleCount: 8,
    riskClass: "R2",
    draft: stageTally(8, 8),
    approval: stageTally(8, 8),
    execution: stageTally(8, 8),
    correction: stageTally(8, 8),
    recentNegativeOutcomeRate: 0,
    recentWindowSize: 5
  });
  // Enough evidence to evaluate, but recent negatives + sub-threshold trust -> hold.
  const hold = buildAggregate({
    workflowId: "workflow-hold",
    sampleCount: 6,
    riskClass: "R1",
    draft: stageTally(6, 5),
    approval: stageTally(6, 5),
    execution: stageTally(6, 5),
    correction: stageTally(6, 5),
    recentNegativeOutcomeRate: 0.4,
    recentWindowSize: 5
  });
  // Above the risk ceiling and too few samples -> structurally not ready.
  const notReady = buildAggregate({
    workflowId: "workflow-not-ready",
    sampleCount: 2,
    riskClass: "R3",
    draft: stageTally(2, 2),
    approval: stageTally(0, 0),
    execution: stageTally(1, 1),
    correction: stageTally(2, 2),
    recentNegativeOutcomeRate: 0,
    recentWindowSize: 2
  });

  return [buildTrustEntry(notReady), buildTrustEntry(hold), buildTrustEntry(promote)];
}

function renderCard(recommendationState: RecommendationLoadState): string {
  return renderToStaticMarkup(
    <DashboardGoalsCard
      filteredGoalBundles={[buildEligibleBundle()]}
      totalGoalCount={1}
      request=""
      setRequest={() => {}}
      selectedAgentId={undefined}
      setSelectedAgentId={() => {}}
      createGoal={() => {}}
      generateStartupBriefing={async () => {}}
      isPending={false}
      submitState={{ kind: "idle", message: "" }}
      shareState={{ kind: "idle", message: "" }}
      refinementState={{ kind: "idle", message: "" }}
      recommendationState={{ kind: "idle", message: "" }}
      lastShareUrl={null}
      focusRequestComposer={() => {}}
      canManageGoalShares={true}
      goalSharePermissionReason=""
      pendingShareReview={null}
      shareGoal={() => {}}
      confirmGoalShare={async () => {}}
      cancelGoalShareReview={() => {}}
      saveAsTemplate={() => {}}
      shareStatsByGoal={new Map()}
      highlightedItemId={null}
      getItemAnchorId={(itemId) => itemId}
      refinementInputs={{}}
      setRefinementInputs={() => {}}
      refineGoal={() => {}}
      goalRefinementStateById={new Map()}
      recommendationResultsByGoal={{ "goal-1": recommendationState }}
      recommendationPendingByGoal={{}}
      submitRecommendationFeedback={async () => {}}
    />
  );
}

describe("DashboardGoalsCard automation-readiness surface", () => {
  it("renders the per-workflow promotion decision, trust score, reasons, and guardrails", () => {
    const markup = renderCard({
      status: "ready",
      query: "kind=execution_path&agent=communications",
      recommendations: [],
      policyPromotion: null,
      workflowTrust: buildWorkflowTrust(),
      error: null
    });

    // Accessible, labelled surface.
    expect(markup).toContain("Automation readiness");
    expect(markup).toContain('aria-labelledby="automation-readiness-title-goal-1"');
    expect(markup).toContain('aria-describedby="automation-readiness-summary-goal-1"');

    // Promotion decisions for all three states are surfaced.
    expect(markup).toContain("Ready to promote to automation");
    expect(markup).toContain("Hold for now");
    expect(markup).toContain("Not ready for automation");

    // The trust score is rendered for the fully-trusted workflow.
    expect(markup).toContain("Trust 100%");

    // Guardrail signals are surfaced for held / not-ready workflows.
    expect(markup).toContain("Recent negative outcomes");
    expect(markup).toContain("Risk-class ceiling");

    // The promote candidate shows all guardrails satisfied.
    expect(markup).toContain("All promotion guardrails satisfied");

    // Operator-decides framing: advisory only, never auto-promoted.
    expect(markup).toContain("operator decision");
    expect(markup).toContain("nothing");
    expect(markup).toContain("promoted automatically");

    // A promotion reason from the policy layer is surfaced verbatim.
    expect(markup).toContain("eligible to suggest automation");
  });

  it("does not render the automation-readiness surface when there is no trust evidence", () => {
    const markup = renderCard({
      status: "ready",
      query: "kind=execution_path&agent=communications",
      recommendations: [],
      policyPromotion: null,
      workflowTrust: [],
      error: null
    });

    expect(markup).not.toContain("Automation readiness");
  });
});
