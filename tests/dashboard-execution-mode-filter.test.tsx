import { renderToStaticMarkup } from "react-dom/server";
import { CommitmentInboxPageSchema, briefingTypeValues } from "@agentic/contracts";
import type { DashboardData } from "@agentic/repository";
import { Dashboard } from "../apps/web/components/dashboard";

function buildDashboardData(): DashboardData {
  return {
    workspaces: [],
    activeWorkspace: null,
    workspaceSelection: null,
    workspaceMembers: [],
    workspaceGovernance: null,
    goalShares: [],
    privacyOperations: [],
    controlPlane: {
      workspace: { status: "attention", summary: "Missing workspace.", updatedAt: "2026-04-18T00:00:00.000Z" },
      commitments: { status: "idle", summary: "No commitments.", updatedAt: "2026-04-18T00:00:00.000Z" },
      automation: { status: "idle", summary: "No automation.", updatedAt: "2026-04-18T00:00:00.000Z" },
      execution: { status: "attention", summary: "Execution metadata is visible.", updatedAt: "2026-04-18T00:00:00.000Z" },
      trust: { status: "idle", summary: "No trust signals.", updatedAt: "2026-04-18T00:00:00.000Z" }
    },
    operatingSections: {
      generatedAt: "2026-04-18T00:00:00.000Z",
      roleView: {
        role: null,
        label: "Setup view",
        summary: "No active workspace is selected.",
        focusAreas: ["Activate a workspace."],
        prioritizedSectionKeys: ["build", "now", "trust"]
      },
      teamWorkflow: {
        mode: "setup",
        label: "Team workflow not active",
        summary: "No active workspace is selected.",
        visibilityLabel: "Setup-only visibility",
        queueMetrics: [],
        ownershipAssignments: [],
        queues: [],
        controls: [],
        auditCoverage: {
          required: false,
          status: "attention",
          summary: "Activate a workspace before evaluating whether audit export coverage is meeting the governed baseline.",
          latestStatus: null,
          latestCompletedAt: null
        },
        actionBoundaries: [],
        handoffGuidance: [],
        queues: [],
        controls: [],
        permissions: {
          manageMembers: {
            allowed: false,
            reason: "Select or create a workspace before managing members."
          },
          editGovernance: {
            allowed: false,
            reason: "Select a workspace before editing governance controls."
          },
          exportAudit: {
            allowed: false,
            reason: "Select a workspace before exporting workspace audit evidence."
          },
          managePrivacyOperations: {
            allowed: false,
            reason: "Select a workspace before running privacy lifecycle operations."
          }
        },
        escalationTargetRole: null,
        slaStatus: "attention",
        slaSummary: "A workspace must be activated before team ownership can be enforced."
      },
      nextBestAction: {
        kind: "configure_workspace",
        label: "Activate a workspace",
        summary: "Select or create a workspace before using the operator shell.",
        status: "attention",
        targetSection: "workspaces",
        role: null
      },
      sections: []
    },
    nowQueue: {
      generatedAt: "2026-04-18T00:00:00.000Z",
      totalCount: 0,
      items: []
    },
    goals: [
      {
        goal: {
          id: "goal-1",
          userId: "user-1",
          workspaceId: null,
          workflowId: "workflow-1",
          title: "Ship a reviewed response",
          request: "Prepare a response with visible execution metadata.",
          intent: "email_follow_up",
          status: "running",
          confidence: 0.87,
          explanation: "A governed specialist prepared the reply and surfaced confidence.",
          createdAt: "2026-04-18T00:00:00.000Z",
          updatedAt: "2026-04-18T00:00:00.000Z"
        },
        workflow: {
          id: "workflow-1",
          goalId: "goal-1",
          workspaceId: null,
          status: "running",
          currentStep: "approval",
          checkpoint: null,
          createdAt: "2026-04-18T00:00:00.000Z",
          updatedAt: "2026-04-18T00:00:00.000Z"
        },
        tasks: [
          {
            id: "task-1",
            goalId: "goal-1",
            workflowId: "workflow-1",
            title: "Draft the customer response",
            summary: "Prepare the reviewed message for approval.",
            assignedAgent: "communications",
            state: "waiting",
            riskClass: "R3",
            requiresApproval: true,
            dependsOn: [],
            toolCapabilities: ["draft", "send"],
            artifactIds: ["artifact-1"],
            createdAt: "2026-04-18T00:00:00.000Z",
            updatedAt: "2026-04-18T00:00:00.000Z"
          }
        ],
        artifacts: [
          {
            id: "artifact-1",
            goalId: "goal-1",
            taskId: "task-1",
            artifactType: "draft",
            title: "Reviewed response",
            content: "Prepared response content.",
            metadata: {
              executionMode: "governed_specialist"
            },
            createdAt: "2026-04-18T00:00:00.000Z"
          }
        ],
        approvals: [
          {
            id: "approval-1",
            goalId: "goal-1",
            taskId: "task-1",
            title: "Approve reviewed response",
            rationale: "External send requires approval.",
            riskClass: "R3",
            decision: "pending",
            requestedAction: "Send the prepared response to the customer.",
            preview: {
              actionType: "send",
              summary: "Send the prepared response to the customer.",
              target: "customer@example.com",
              changes: [],
              impact: {
                affectedPeople: ["customer@example.com"],
                affectedSystems: ["email"],
                permissions: ["send"],
                rollback: "manual"
              }
            },
            explanation: null,
            history: [],
            createdAt: "2026-04-18T00:00:00.000Z",
            expiryAt: "2026-04-19T00:00:00.000Z",
            respondedAt: null
          }
        ],
        watchers: [],
        actionLogs: []
      }
    ],
    approvals: [
      {
        id: "approval-1",
        goalId: "goal-1",
        taskId: "task-1",
        title: "Approve reviewed response",
        rationale: "External send requires approval.",
        riskClass: "R3",
        decision: "pending",
        requestedAction: "Send the prepared response to the customer.",
        preview: {
          actionType: "send",
          summary: "Send the prepared response to the customer.",
          target: "customer@example.com",
          changes: [],
          impact: {
            affectedPeople: ["customer@example.com"],
            affectedSystems: ["email"],
            permissions: ["send"],
            rollback: "manual"
          }
        },
        explanation: null,
        history: [],
        createdAt: "2026-04-18T00:00:00.000Z",
        expiryAt: "2026-04-19T00:00:00.000Z",
        respondedAt: null
      }
    ],
    commitments: [],
    briefingPreferences: {
      userId: "user-1",
      timezone: "Asia/Singapore",
      focus: "balanced",
      schedules: briefingTypeValues.map((type) => ({
        type,
        enabled: type === "startup",
        time: type === "startup" ? "09:00" : type === "midday" ? "13:00" : "18:00"
      })),
      createdAt: "2026-04-18T00:00:00.000Z",
      updatedAt: "2026-04-18T00:00:00.000Z"
    },
    briefingHistory: [],
    autopilotSettings: {
      userId: "user-1",
      mode: "notify_only",
      debounceMinutes: 30,
      createdAt: "2026-04-18T00:00:00.000Z",
      updatedAt: "2026-04-18T00:00:00.000Z"
    },
    autopilotEvents: [],
    memories: [],
    watchers: [],
    integrations: [],
    latestArtifacts: [
      {
        id: "artifact-1",
        userId: "user-1",
        goalId: "goal-1",
        taskId: "task-1",
        title: "Reviewed response",
        artifactType: "draft",
        status: "ready",
        storagePath: "/tmp/reviewed-response.md",
        content: "Prepared response content.",
        metadata: {
          executionMode: "governed_specialist"
        },
        createdAt: "2026-04-18T00:00:00.000Z",
        updatedAt: "2026-04-18T00:00:00.000Z"
      }
    ],
    actionLogs: [],
    diagnostics: {
      generatedAt: "2026-04-18T00:00:00.000Z",
      status: "healthy",
      totalCount: 0,
      items: []
    }
  } as DashboardData;
}

describe("Dashboard execution mode filter", () => {
  it("renders the shared execution visibility control and filtered-total transparency copy", () => {
    const commitmentInbox = CommitmentInboxPageSchema.parse({
      bucket: "all",
      items: [],
      counts: {
        all: 0,
        unresolved: 0,
        urgent: 0,
        due_soon: 0,
        waiting_on_others: 0,
        low_confidence: 0,
        completed: 0
      },
      totalCount: 0,
      limit: 20,
      nextCursor: null,
      generatedAt: "2026-04-18T00:00:00.000Z"
    });

    const markup = renderToStaticMarkup(
      <Dashboard initialData={buildDashboardData()} initialNotes={[]} initialCommitmentInbox={commitmentInbox} />
    );

    expect(markup).toContain("Execution visibility");
    expect(markup).toContain("Execution mode filter");
    expect(markup).toContain("Filters goals, approvals, and artifacts together");
    expect(markup).toContain("Recommendation-backed suggestions");
    expect(markup).toContain("Loading suggestion history");
    expect(markup).toContain("1 / 1 goals");
    expect(markup).toContain("1 / 1 pending");
    expect(markup).toContain("1 / 1 recent");
    expect(markup).toContain("All execution modes");
  });
});
