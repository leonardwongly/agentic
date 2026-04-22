import { renderToStaticMarkup } from "react-dom/server";
import { ApprovalRequestSchema, GoalBundleSchema } from "@agentic/contracts";
import { ApprovalDetailPanel } from "../apps/web/components/panels/approval-detail-panel";

describe("ApprovalDetailPanel", () => {
  it("renders explicit approval rationale, impact scope, rollback, and confidence context", () => {
    const approval = ApprovalRequestSchema.parse({
      id: "approval-1",
      goalId: "goal-1",
      taskId: "task-1",
      title: "Send customer reply",
      rationale: "Workspace governance requires approval before external sends.",
      riskClass: "R3",
      decision: "pending",
      requestedAction: "Send the drafted reply to the customer.",
      preview: {
        actionType: "send",
        summary: "Send a customer reply.",
        target: "customer@example.com",
        changes: [],
        impact: {
          affectedPeople: ["customer@example.com"],
          affectedSystems: ["email", "crm"],
          permissions: ["send"],
          rollback: "manual"
        }
      },
      explanation: {
        requestReason: "External replies need confirmation before sending.",
        impactSummary: "The customer will receive a new external message.",
        decisionSummary: "Approve only if the tone and facts match the current thread.",
        outcomeSummary: null,
        evidenceSummary: null,
        evidence: {
          actionLogCount: 1,
          artifactCount: 1,
          memoryCount: 0,
          updatedAt: "2024-01-01T00:04:00.000Z"
        }
      },
      history: [],
      createdAt: "2024-01-01T00:00:00.000Z",
      expiryAt: "2024-01-02T00:00:00.000Z",
      respondedAt: null
    });

    const relatedGoal = GoalBundleSchema.parse({
      goal: {
        id: "goal-1",
        userId: "user-1",
        workspaceId: null,
        workflowId: "workflow-1",
        title: "Handle customer follow-up",
        request: "Reply to the customer update.",
        intent: "email_follow_up",
        status: "running",
        confidence: 0.86,
        explanation: "A customer follow-up requires a reviewed external response.",
        createdAt: "2024-01-01T00:00:00.000Z",
        updatedAt: "2024-01-01T00:00:00.000Z"
      },
      tasks: [
        {
          id: "task-1",
          goalId: "goal-1",
          workflowId: "workflow-1",
          title: "Draft customer reply",
          summary: "Prepare an external response for approval.",
          assignedAgent: "communications",
          state: "waiting",
          riskClass: "R3",
          requiresApproval: true,
          dependsOn: [],
          toolCapabilities: ["draft", "send"],
          artifactIds: [],
          createdAt: "2024-01-01T00:00:00.000Z",
          updatedAt: "2024-01-01T00:00:00.000Z"
        }
      ],
      artifacts: [
        {
          id: "artifact-1",
          goalId: "goal-1",
          taskId: "task-1",
          artifactType: "summary",
          title: "Reviewed draft",
          content: "Reply draft content",
          metadata: {
            executionMode: "governed_specialist"
          },
          createdAt: "2024-01-01T00:01:00.000Z"
        }
      ],
      approvals: [approval],
      watchers: [],
      actionLogs: [],
      workflow: {
        id: "workflow-1",
        goalId: "goal-1",
        workspaceId: null,
        status: "running",
        currentStep: "approval",
        checkpoint: null,
        createdAt: "2024-01-01T00:00:00.000Z",
        updatedAt: "2024-01-01T00:00:00.000Z"
      }
    });

    const markup = renderToStaticMarkup(
      <ApprovalDetailPanel approval={approval} relatedGoal={relatedGoal} onApprove={() => {}} onReject={() => {}} />
    );

    expect(markup).toContain("Why This Needs Approval");
    expect(markup).toContain("Policy rationale");
    expect(markup).toContain("Workspace governance requires approval before external sends.");
    expect(markup).toContain("Review trigger");
    expect(markup).toContain("External replies need confirmation before sending.");
    expect(markup).toContain("Decision guidance");
    expect(markup).toContain("Approve only if the tone and facts match the current thread.");
    expect(markup).toContain("Goal confidence");
    expect(markup).toContain("86%");
    expect(markup).toContain("Implementation tier");
    expect(markup).toContain("Production");
    expect(markup).toContain("Execution mode");
    expect(markup).toContain("Governed specialist");
    expect(markup).toContain("Required permissions");
    expect(markup).toContain("Affected people");
    expect(markup).toContain("Affected systems");
    expect(markup).toContain("Rollback");
    expect(markup).toContain("Manual");
    expect(markup).toContain("Risk posture");
  });
});
