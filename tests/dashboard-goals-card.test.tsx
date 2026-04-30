import { renderToStaticMarkup } from "react-dom/server";
import { DashboardGoalsCard } from "../apps/web/components/dashboard-goals-card";
import type { GoalShareDisclosureReview } from "../apps/web/lib/share-disclosure";

function buildReview(): GoalShareDisclosureReview {
  return {
    expiresAt: "2026-04-09T00:00:00.000Z",
    expiryDays: 7,
    confirmationRequired: true,
    summary: "Potentially sensitive public fields were detected. Confirm the reviewed projection before creating a link.",
    redactedFields: ["goal.request", "approvals", "actionLogs", "artifacts.content"],
    sensitiveFindings: [
      {
        fieldPath: "goal.explanation",
        label: "Email address",
        detector: "email_address",
        severity: "medium"
      }
    ],
    dataClasses: [
      {
        id: "goal_summary",
        label: "Goal summary",
        disposition: "requires_confirmation",
        fields: ["goal.title", "goal.explanation"],
        reason: "Only the public summary projection is shared."
      },
      {
        id: "operator_context",
        label: "Operator context",
        disposition: "redacted",
        fields: ["goal.request", "approvals", "actionLogs"],
        reason: "Internal request text, approvals, execution history, and workflow state are never projected."
      }
    ]
  };
}

describe("DashboardGoalsCard", () => {
  it("renders an accessible public share disclosure review before confirmation", () => {
    const markup = renderToStaticMarkup(
      <DashboardGoalsCard
        filteredGoalBundles={[]}
        totalGoalCount={0}
        request=""
        setRequest={() => {}}
        selectedAgentId={undefined}
        setSelectedAgentId={() => {}}
        createGoal={() => {}}
        generateStartupBriefing={async () => {}}
        isPending={false}
        submitState={{ kind: "idle", message: "" }}
        shareState={{ kind: "success", message: "Review the public share projection before creating a link." }}
        refinementState={{ kind: "idle", message: "" }}
        recommendationState={{ kind: "idle", message: "" }}
        lastShareUrl={null}
        focusRequestComposer={() => {}}
        canManageGoalShares={true}
        goalSharePermissionReason=""
        pendingShareReview={{
          goalId: "goal-1",
          goalTitle: "Reviewed customer follow-up",
          review: buildReview(),
          reviewFingerprint: "a".repeat(64)
        }}
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
        recommendationResultsByGoal={{}}
        recommendationPendingByGoal={{}}
        submitRecommendationFeedback={async () => {}}
      />
    );

    expect(markup).toContain("aria-labelledby=\"share-disclosure-review-title\"");
    expect(markup).toContain("aria-describedby=\"share-disclosure-review-summary\"");
    expect(markup).toContain("Public Share Review");
    expect(markup).toContain("Reviewed customer follow-up");
    expect(markup).toContain("Email address");
    expect(markup).toContain("goal.explanation");
    expect(markup).toContain("Operator context");
    expect(markup).toContain("Create public link");
    expect(markup).not.toContain("tokenFingerprint");
  });
});
