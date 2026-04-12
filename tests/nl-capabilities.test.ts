import { buildDefaultIntegrationAccounts } from "@agentic/integrations";
import { buildNlCapabilitySummary } from "../apps/web/lib/nl-capabilities";

describe("buildNlCapabilitySummary", () => {
  it("marks batch approval as ready only when pending R2 approvals exist", () => {
    const summary = buildNlCapabilitySummary({
      activeWorkspaceName: "Operations",
      approvals: [
        {
          id: "approval-1",
          goalId: "goal-1",
          taskId: "task-1",
          title: "Approve reply",
          rationale: "External sends need confirmation.",
          riskClass: "R2",
          decision: "pending",
          requestedAction: "Send the reply.",
          actionIntent: {
            type: "send_message",
            adapter: "gmail",
            mode: "send",
            to: "customer@example.com",
            subject: "Follow-up",
            body: "Thanks."
          },
          preview: {
            actionType: "send",
            summary: "Send the reply",
            target: "customer@example.com",
            changes: [],
            impact: {
              affectedPeople: ["customer@example.com"],
              affectedSystems: ["email"],
              permissions: [],
              rollback: "manual"
            }
          },
          explanation: null,
          decisionScope: null,
          decisionRationale: null,
          history: [],
          createdAt: "2024-01-01T00:00:00.000Z",
          expiryAt: "2024-01-02T00:00:00.000Z",
          respondedAt: null
        }
      ],
      integrations: buildDefaultIntegrationAccounts("user-1"),
      workspaceGovernance: null
    });

    expect(summary.headline).toContain("Operations");
    expect(summary.commands.find((command) => command.id === "approve-all-r2")).toEqual(
      expect.objectContaining({
        status: "ready"
      })
    );
  });

  it("downgrades briefings when live connectors are unavailable", () => {
    const summary = buildNlCapabilitySummary({
      activeWorkspaceName: null,
      approvals: [],
      integrations: [
        {
          ...buildDefaultIntegrationAccounts("user-1").find((integration) => integration.system === "notes")!,
          userId: "user-1"
        },
        {
          ...buildDefaultIntegrationAccounts("user-1").find((integration) => integration.system === "email")!,
          userId: "user-1",
          status: "manual"
        },
        {
          ...buildDefaultIntegrationAccounts("user-1").find((integration) => integration.system === "calendar")!,
          userId: "user-1",
          status: "disabled"
        }
      ],
      workspaceGovernance: null
    });

    expect(summary.commands.find((command) => command.id === "briefing")).toEqual(
      expect.objectContaining({
        status: "limited"
      })
    );
    expect(summary.integrations).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          label: "Email",
          connectionStatus: "manual",
          readinessTier: "draft-grade",
          readinessLabel: "Draft-grade"
        }),
        expect.objectContaining({
          label: "Calendar",
          connectionStatus: "disabled",
          readinessTier: "experimental",
          readinessLabel: "Experimental"
        }),
        expect.objectContaining({
          label: "Notes",
          connectionStatus: "ready",
          readinessTier: "autonomous-grade",
          readinessLabel: "Autonomous-grade"
        })
      ])
    );
  });
});
