import { renderToStaticMarkup } from "react-dom/server";
import { GoalBundleSchema } from "@agentic/contracts";
import { GoalDetailPanel } from "../apps/web/components/panels/goal-detail-panel";

describe("GoalDetailPanel", () => {
  it("renders the selected wedge contract for operator review", () => {
    const bundle = GoalBundleSchema.parse({
      goal: {
        id: "goal-contract-1",
        userId: "user-1",
        workspaceId: null,
        workflowId: "workflow-contract-1",
        title: "Inbox execution",
        request: "Review the inbox and stage follow-up drafts.",
        intent: "communications-triage",
        status: "running",
        confidence: 0.88,
        explanation: "The goal should make the selected production wedge explicit to operators.",
        wedge: {
          key: "communications_execution",
          label: "Communications execution",
          selection: "selected_production",
          rationale: "Inbox triage is one of the selected production wedges."
        },
        completionContract: {
          id: "communications-execution-v1",
          summary: "Prepare ranked inbox follow-up artifacts behind approval.",
          successCriteria: [
            "Urgent threads are ranked.",
            "Reply drafts are prepared."
          ],
          evidenceSignals: [
            "Priority triage artifact exists.",
            "Reply draft artifact exists."
          ],
          approvalExpectations: [
            "External sends remain approval-gated."
          ],
          doneWhen: "The inbox is triaged and outward delivery stays behind approval."
        },
        createdAt: "2024-01-01T00:00:00.000Z",
        updatedAt: "2024-01-01T00:00:00.000Z"
      },
      workflow: {
        id: "workflow-contract-1",
        goalId: "goal-contract-1",
        workspaceId: null,
        status: "running",
        currentStep: "review",
        checkpoint: null,
        createdAt: "2024-01-01T00:00:00.000Z",
        updatedAt: "2024-01-01T00:00:00.000Z"
      },
      tasks: [],
      artifacts: [],
      approvals: [],
      watchers: [],
      actionLogs: []
    });

    const markup = renderToStaticMarkup(
      <GoalDetailPanel bundle={bundle} onClose={() => {}} />
    );

    expect(markup).toContain("Goal Contract");
    expect(markup).toContain("Communications execution");
    expect(markup).toContain("selected production");
    expect(markup).toContain("Done when");
    expect(markup).toContain("Success criteria");
    expect(markup).toContain("Evidence signals");
    expect(markup).toContain("Approval expectations");
    expect(markup).toContain("communications-execution-v1");
  });
});
