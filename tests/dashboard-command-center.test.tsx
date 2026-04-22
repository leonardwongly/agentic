import { renderToStaticMarkup } from "react-dom/server";
import type { OperatorProduct } from "@agentic/contracts";
import type { DashboardData } from "@agentic/repository";
import {
  buildDashboardCommandCenterModel,
  getPreferredCommandCenterRole
} from "../apps/web/lib/command-center";
import { DashboardCommandCenter } from "../apps/web/components/dashboard-command-center";

function createDashboardFixture(): DashboardData {
  return {
    workspaces: [
      {
        id: "workspace-1",
        ownerUserId: "user-1",
        slug: "operations",
        name: "Operations",
        description: "Primary operating workspace.",
        isPersonal: false,
        createdAt: "2024-01-01T00:00:00.000Z",
        updatedAt: "2024-01-01T00:00:00.000Z"
      }
    ],
    activeWorkspace: {
      id: "workspace-1",
      ownerUserId: "user-1",
      slug: "operations",
      name: "Operations",
      description: "Primary operating workspace.",
      isPersonal: false,
      createdAt: "2024-01-01T00:00:00.000Z",
      updatedAt: "2024-01-01T00:00:00.000Z"
    },
    workspaceSelection: null,
    workspaceMembers: [],
    workspaceGovernance: null,
    goalShares: [],
    privacyOperations: [],
    controlPlane: {
      generatedAt: "2024-01-01T00:00:00.000Z",
      sections: []
    },
    operatingSections: {
      generatedAt: "2024-01-01T00:00:00.000Z",
      sections: [
        {
          key: "now",
          title: "Now",
          description: "Blocked queue items need review.",
          status: "critical",
          targetSection: "now",
          targetItemId: "commitment-1",
          metrics: ["2 ready items"],
          highlights: ["Review reply draft"]
        },
        {
          key: "execution",
          title: "Execution",
          description: "Async queue needs recovery.",
          status: "critical",
          targetSection: "operations",
          targetItemId: "job-issue-1",
          metrics: ["1 queue issue"],
          highlights: ["Dead-lettered job"]
        },
        {
          key: "trust",
          title: "Trust",
          description: "Connector health degraded.",
          status: "attention",
          targetSection: "operations",
          targetItemId: "connector-issue-1",
          metrics: ["2 reliability signals"],
          highlights: ["Reconnect Google"]
        },
        {
          key: "build",
          title: "Build",
          description: "Operator pack setup available.",
          status: "healthy",
          targetSection: "operator-products",
          targetItemId: "operator-product-communications",
          metrics: ["1 operator pack"],
          highlights: ["Communications operator"]
        }
      ]
    },
    nowQueue: {
      generatedAt: "2024-01-01T00:00:00.000Z",
      totalCount: 2,
      items: [
        {
          commitmentId: "commitment-1",
          title: "Send escalation reply",
          summary: "The outbound response is waiting on a risk decision.",
          status: "needs-review",
          urgency: "urgent",
          riskClass: "R3",
          confidence: 0.92,
          dueAt: "2024-01-02T00:00:00.000Z",
          reasons: ["Approval blocked"],
          suggestedNextAction: {
            kind: "open_evidence",
            label: "Open approval",
            section: "approvals",
            itemId: "approval-1"
          }
        },
        {
          commitmentId: "commitment-2",
          title: "Draft follow-up",
          summary: "Prepare tomorrow's follow-up message.",
          status: "pending",
          urgency: "soon",
          riskClass: "R2",
          confidence: 0.7,
          dueAt: null,
          reasons: [],
          suggestedNextAction: null
        }
      ]
    },
    goals: [
      {
        goal: {
          id: "goal-1",
          userId: "user-1",
          workspaceId: "workspace-1",
          title: "Triage communications",
          status: "running",
          successCriteria: "All urgent threads routed",
          summary: "Triage and respond to urgent threads.",
          sourceRequest: "Review urgent inbox items",
          explanation: "Handle urgent inbound work safely.",
          createdAt: "2024-01-01T00:00:00.000Z",
          updatedAt: "2024-01-01T00:00:00.000Z"
        },
        workflow: {
          id: "workflow-1",
          goalId: "goal-1",
          status: "running",
          checkpoint: "approval",
          updatedAt: "2024-01-01T00:00:00.000Z"
        },
        tasks: [
          {
            id: "task-1",
            goalId: "goal-1",
            title: "Escalate blocked thread",
            summary: "The escalation step is blocked.",
            assignedAgent: "communications",
            state: "blocked",
            riskClass: "R3",
            requiresApproval: true,
            dependsOn: [],
            toolCapabilities: ["draft"],
            artifactIds: [],
            createdAt: "2024-01-01T00:00:00.000Z",
            updatedAt: "2024-01-01T00:00:00.000Z"
          }
        ],
        artifacts: [],
        approvals: [],
        watchers: [],
        actionLogs: []
      }
    ],
    approvals: [
      {
        id: "approval-1",
        goalId: "goal-1",
        taskId: "task-1",
        title: "Approve escalation reply",
        rationale: "External send needs review.",
        riskClass: "R3",
        decision: "pending",
        requestedAction: "Send escalation reply",
        actionIntent: null,
        preview: {
          actionType: "send-external",
          summary: "Reply to the escalation thread.",
          target: "customer@example.com",
          changes: [],
          impact: {
            affectedPeople: ["customer@example.com"],
            affectedSystems: ["email"],
            permissions: ["send-external"],
            rollback: "manual"
          }
        },
        decisionScope: null,
        decisionRationale: null,
        history: [],
        explanation: null,
        createdAt: "2024-01-01T00:00:00.000Z",
        expiryAt: "2024-01-02T00:00:00.000Z",
        respondedAt: null
      }
    ],
    commitments: [
      {
        id: "commitment-1",
        userId: "user-1",
        title: "Send escalation reply",
        summary: "Waiting on approval before sending.",
        status: "needs-review",
        sourceKind: "approval",
        sourceId: "approval-1",
        goalId: "goal-1",
        approvalId: "approval-1",
        dueAt: "2024-01-02T00:00:00.000Z",
        actorContext: null,
        urgency: "urgent",
        riskClass: "R3",
        confidence: 0.9,
        provenanceSummary: "Created from approval request.",
        suggestedNextAction: {
          kind: "open_evidence",
          label: "Open approval",
          section: "approvals",
          itemId: "approval-1"
        },
        evidence: [
          {
            section: "approvals",
            itemId: "approval-1",
            label: "Approve escalation reply"
          }
        ],
        createdAt: "2024-01-01T00:00:00.000Z",
        updatedAt: "2024-01-01T00:00:00.000Z"
      }
    ],
    briefingPreferences: {
      userId: "user-1",
      timezone: "Asia/Singapore",
      focus: "balanced",
      schedules: [],
      actorContext: null,
      createdAt: "2024-01-01T00:00:00.000Z",
      updatedAt: "2024-01-01T00:00:00.000Z"
    } as DashboardData["briefingPreferences"],
    briefingHistory: [],
    autopilotSettings: {
      userId: "user-1",
      mode: "notify_only",
      debounceMinutes: 15,
      actorContext: null,
      createdAt: "2024-01-01T00:00:00.000Z",
      updatedAt: "2024-01-01T00:00:00.000Z"
    },
    autopilotEvents: [
      {
        id: "event-1",
        userId: "user-1",
        kind: "watcher_triggered",
        sourceId: "watcher-1",
        idempotencyKey: null,
        mode: "notify_only",
        summary: "Retry budget exhausted for inbox watcher.",
        status: "failed",
        details: {},
        actorContext: null,
        createdAt: "2024-01-01T00:00:00.000Z",
        processedAt: null,
        resultGoalId: null,
        error: "Retry budget exhausted"
      }
    ],
    memories: [],
    watchers: [],
    integrations: [],
    latestArtifacts: [
      {
        id: "artifact-1",
        goalId: "goal-1",
        taskId: "task-1",
        title: "Escalation draft",
        artifactType: "draft",
        uri: "file:///tmp/escalation.txt",
        summary: "Prepared draft reply.",
        createdAt: "2024-01-01T00:00:00.000Z",
        updatedAt: "2024-01-01T00:00:00.000Z"
      }
    ] as DashboardData["latestArtifacts"],
    actionLogs: [],
    diagnostics: {
      status: "critical",
      totalCount: 2,
      generatedAt: "2024-01-01T00:00:00.000Z",
      items: [
        {
          kind: "async_execution_issues",
          title: "Async execution issues",
          count: 1,
          severity: "critical",
          reasons: ["A queued job reached dead letter."],
          targets: [
            {
              section: "operations",
              itemId: "job-issue-1",
              label: "Open operations"
            }
          ]
        },
        {
          kind: "connector_degradation",
          title: "Connector degradation",
          count: 1,
          severity: "warning",
          reasons: ["Google connector needs reconnection."],
          targets: [
            {
              section: "operations",
              itemId: "connector-issue-1",
              label: "Review connector"
            }
          ]
        }
      ]
    },
    operations: {
      generatedAt: "2024-01-01T00:00:00.000Z",
      asyncExecution: {
        status: "critical",
        queuedJobs: 0,
        retryingJobs: 0,
        runningJobs: 0,
        deadLetterJobs: 1,
        expiredLeaseCount: 0,
        stalePendingCount: 0,
        issueCount: 1,
        oldestPendingJobAgeSeconds: null,
        maxPendingJobAgeSeconds: 900,
        items: [
          {
            id: "job-issue-1",
            jobId: "job-1",
            label: "Inbox watcher queue",
            summary: "Dead-lettered after retries.",
            severity: "critical",
            status: "dead_letter",
            updatedAt: "2024-01-01T00:00:00.000Z",
            target: {
              section: "operations",
              itemId: "job-issue-1",
              label: "Open operations"
            }
          }
        ]
      },
      connectorHealth: {
        status: "attention",
        totalCount: 1,
        connectedCount: 0,
        degradedCount: 1,
        reconnectRequiredCount: 1,
        refreshFailedCount: 1,
        revokedCount: 0,
        expiredCount: 0,
        validationStaleCount: 0,
        issueCount: 1,
        items: [
          {
            id: "connector-issue-1",
            credentialId: "credential-1",
            label: "Google connector",
            summary: "Reconnect required before mailbox automation can widen.",
            severity: "attention",
            provider: "google",
            status: "reconnect_required",
            updatedAt: "2024-01-01T00:00:00.000Z",
            target: {
              section: "operations",
              itemId: "connector-issue-1",
              label: "Review connector"
            }
          }
        ]
      }
    }
  } as DashboardData;
}

const communicationsProduct = {
  id: "operator-product-communications",
  userId: "user-1",
  slug: "communications-operator",
  name: "Communications Operator",
  tagline: "Run inbox, follow-up, and escalation workflows from one control surface.",
  description: "Focused operator product for communication-heavy work.",
  icon: "✉️",
  recommendedAgentIds: ["agent-builtin-communications"],
  recommendedTemplateIds: [],
  recommendedIntegrations: [],
  kpis: [],
  onboardingSteps: [],
  isBuiltIn: true,
  status: "active",
  createdAt: "2024-01-01T00:00:00.000Z",
  updatedAt: "2024-01-01T00:00:00.000Z"
} as OperatorProduct;

describe("dashboard command center", () => {
  it("prioritizes critical failures and approvals ahead of the rest of the dashboard", () => {
    const model = buildDashboardCommandCenterModel({
      data: createDashboardFixture(),
      selectedOperatorProduct: communicationsProduct
    });

    expect(model.blockedCount).toBe(2);
    expect(model.approvalCount).toBe(1);
    expect(model.failureCount).toBe(4);
    expect(model.nextBestAction?.label).toBe("Open operations");
    expect(model.priorities[0]?.title).toBe("Async execution issues");
    expect(model.priorities.some((priority) => priority.title === "Decision backlog is accumulating")).toBe(true);
    expect(model.roleViews.communications.description).toContain("Run inbox, follow-up, and escalation workflows");
  });

  it("defaults to the communications wedge when the communications pack is selected", () => {
    expect(getPreferredCommandCenterRole(communicationsProduct)).toBe("communications");
    expect(getPreferredCommandCenterRole(null)).toBe("command");
  });

  it("renders exception-first copy and role-aware wedges", () => {
    const model = buildDashboardCommandCenterModel({
      data: createDashboardFixture(),
      selectedOperatorProduct: communicationsProduct
    });
    const markup = renderToStaticMarkup(
      <DashboardCommandCenter
        model={model}
        role="communications"
        onRoleChange={() => {}}
        openTarget={() => {}}
      />
    );

    expect(markup).toContain("Command center");
    expect(markup).toContain("Immediate exceptions");
    expect(markup).toContain("Next best action");
    expect(markup).toContain("Communications");
    expect(markup).toContain("Selected operator product");
    expect(markup).toContain("Approvals inbox");
    expect(markup).toContain("Follow-up queue");
    expect(markup).toContain("Role pack");
    expect(markup).toContain('role="tablist"');
    expect(markup).toContain('role="tab"');
    expect(markup).toContain('aria-controls=');
    expect(markup).toContain('role="tabpanel"');
  });
});
