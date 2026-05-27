import { renderToStaticMarkup } from "react-dom/server";
import { AutopilotEventSchema } from "@agentic/contracts";
import type { DashboardData } from "@agentic/repository";
import { DashboardOperationsSections } from "../apps/web/components/dashboard-operations-sections";

function buildDashboardData(): DashboardData {
  return {
    activeWorkspace: {
      id: "workspace-operations",
      ownerUserId: "workspace-owner",
      slug: "operations",
      name: "Operations",
      description: "Shared team workspace.",
      isPersonal: false,
      createdAt: "2026-04-22T00:00:00.000Z",
      updatedAt: "2026-04-22T00:00:00.000Z"
    },
    workspaces: [
      {
        id: "workspace-operations",
        ownerUserId: "workspace-owner",
        slug: "operations",
        name: "Operations",
        description: "Shared team workspace.",
        isPersonal: false,
        createdAt: "2026-04-22T00:00:00.000Z",
        updatedAt: "2026-04-22T00:00:00.000Z"
      }
    ],
    workspaceSelection: {
      userId: "workspace-editor",
      workspaceId: "workspace-operations",
      selectedAt: "2026-04-22T00:00:00.000Z",
      updatedAt: "2026-04-22T00:00:00.000Z"
    },
    workspaceMembers: [
      {
        id: "member-editor",
        workspaceId: "workspace-operations",
        userId: "workspace-editor",
        role: "editor",
        joinedAt: "2026-04-22T00:00:00.000Z",
        updatedAt: "2026-04-22T00:00:00.000Z"
      }
    ],
    workspaceGovernance: {
      workspaceId: "workspace-operations",
      approvalMode: "risk_based",
      requireAuditExports: true,
      maxAutoRunRiskClass: "R2",
      externalSendRequiresApproval: true,
      calendarWriteRequiresApproval: true,
      shadowReplayPolicy: {
        enabled: true,
        promotionMode: "validated_autonomy",
        rollbackOutcome: "allowed_with_confirmation",
        minimumMatchedEpisodes: 5,
        minimumPrecision: 0.8,
        maximumNegativeOutcomeRate: 0.15,
        maximumFailureCostRate: 0.2
      },
      retentionDays: 365,
      updatedBy: "workspace-owner",
      createdAt: "2026-04-22T00:00:00.000Z",
      updatedAt: "2026-04-22T00:00:00.000Z"
    },
    goalShares: [],
    privacyOperations: [],
    controlPlane: {
      workspace: {
        status: "healthy",
        summary: "Workspace is active.",
        updatedAt: "2026-04-22T00:00:00.000Z"
      },
      commitments: {
        status: "idle",
        summary: "No commitment pressure.",
        updatedAt: "2026-04-22T00:00:00.000Z"
      },
      automation: {
        status: "idle",
        summary: "Automation is bounded.",
        updatedAt: "2026-04-22T00:00:00.000Z"
      },
      execution: {
        status: "healthy",
        summary: "Execution is stable.",
        updatedAt: "2026-04-22T00:00:00.000Z"
      },
      trust: {
        status: "healthy",
        summary: "Trust signals are healthy.",
        updatedAt: "2026-04-22T00:00:00.000Z"
      }
    },
    operatingSections: {
      generatedAt: "2026-04-22T00:00:00.000Z",
      roleView: {
        role: "editor",
        label: "Editor view",
        summary: "Editors work the queue and escalate owner-only policy changes.",
        focusAreas: ["Keep queue execution moving."],
        prioritizedSectionKeys: ["now", "execution", "trust"]
      },
      teamWorkflow: {
        mode: "editor_execution",
        label: "Editor execution workflow",
        summary: "Editors can work the shared queue but must escalate owner-only controls.",
        visibilityLabel: "Execution-first queue visibility",
        queueMetrics: ["1 collaborator", "0 pending approvals", "0 urgent queue items"],
        ownershipAssignments: [],
        queues: [],
        controls: [],
        auditCoverage: {
          required: true,
          status: "attention",
          summary: "Audit exports are required for this workspace, but no completed export is recorded yet.",
          latestStatus: null,
          latestCompletedAt: null
        },
        actionBoundaries: [
          "Editors can triage queue work and prepare approvals, but governance and membership stay with the owner."
        ],
        handoffGuidance: ["Escalate owner-only controls instead of widening them locally."],
        permissions: {
          manageMembers: {
            allowed: false,
            reason: "Only the workspace owner can change membership, governance posture, or privacy lifecycle state."
          },
          editGovernance: {
            allowed: false,
            reason: "Only the workspace owner can change membership, governance posture, or privacy lifecycle state."
          },
          exportAudit: {
            allowed: true,
            reason: "Workspace members can export audit evidence for review and compliance."
          },
          managePrivacyOperations: {
            allowed: false,
            reason: "Only the workspace owner can change membership, governance posture, or privacy lifecycle state."
          }
        },
        escalationTargetRole: "owner",
        slaStatus: "attention",
        slaSummary: "Owner escalation is required before policy boundaries change."
      },
      nextBestAction: {
        kind: "review_now",
        label: "Inspect the live queue",
        summary: "Queue work is available and governance changes should stay escalated.",
        status: "attention",
        targetSection: "now",
        role: "editor"
      },
      sections: []
    },
    nowQueue: {
      generatedAt: "2026-04-22T00:00:00.000Z",
      totalCount: 0,
      items: []
    },
    goals: [],
    approvals: [],
    commitments: [],
    briefingPreferences: {
      userId: "workspace-editor",
      timezone: "UTC",
      focus: "balanced",
      schedules: [],
      createdAt: "2026-04-22T00:00:00.000Z",
      updatedAt: "2026-04-22T00:00:00.000Z"
    },
    briefingHistory: [],
    autopilotSettings: {
      userId: "workspace-editor",
      mode: "notify_only",
      debounceMinutes: 15,
      createdAt: "2026-04-22T00:00:00.000Z",
      updatedAt: "2026-04-22T00:00:00.000Z"
    },
    autopilotEvents: [],
    memories: [],
    watchers: [],
    integrations: [],
    latestArtifacts: [],
    actionLogs: [],
    diagnostics: {
      generatedAt: "2026-04-22T00:00:00.000Z",
      items: []
    }
  };
}

function extractButtonMarkup(markup: string, label: string): string {
  const escapedLabel = label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = markup.match(new RegExp(`<button[^>]*>${escapedLabel}</button>`));

  if (!match) {
    throw new Error(`Button "${label}" was not rendered.`);
  }

  return match[0];
}

describe("DashboardOperationsSections", () => {
  it("greys out owner-only controls and keeps audit export available for collaborators", () => {
    const markup = renderToStaticMarkup(
      <DashboardOperationsSections
        data={buildDashboardData()}
        isPending={false}
        highlightedItemId={null}
        workspaceState={{ kind: "idle", message: "" }}
        governanceState={{ kind: "idle", message: "" }}
        autopilotState={{ kind: "idle", message: "" }}
        privacyState={{ kind: "idle", message: "" }}
        workspaceName=""
        setWorkspaceName={() => {}}
        workspaceSlug=""
        setWorkspaceSlug={() => {}}
        workspaceDescription=""
        setWorkspaceDescription={() => {}}
        workspaceMemberUserId=""
        setWorkspaceMemberUserId={() => {}}
        workspaceMemberRole="viewer"
        setWorkspaceMemberRole={() => {}}
        governanceDraft={{
          approvalMode: "risk_based",
          requireAuditExports: true,
          maxAutoRunRiskClass: "R2",
          externalSendRequiresApproval: true,
          calendarWriteRequiresApproval: true,
          shadowReplayPolicy: {
            enabled: true,
            promotionMode: "validated_autonomy",
            rollbackOutcome: "allowed_with_confirmation",
            minimumMatchedEpisodes: 5,
            minimumPrecision: 0.8,
            maximumNegativeOutcomeRate: 0.15,
            maximumFailureCostRate: 0.2
          },
          retentionDays: 365
        }}
        setGovernanceDraft={() => {}}
        autopilotDraft={{
          userId: "workspace-editor",
          mode: "notify_only",
          debounceMinutes: 15,
          createdAt: "2026-04-22T00:00:00.000Z",
          updatedAt: "2026-04-22T00:00:00.000Z"
        }}
        setAutopilotDraft={() => {}}
        getItemAnchorId={(itemId) => itemId}
        openDiagnosticTarget={() => {}}
        createWorkspace={async () => {}}
        selectWorkspace={async () => {}}
        addWorkspaceMember={async () => {}}
        saveWorkspaceGovernance={async () => {}}
        exportWorkspaceAudit={async () => {}}
        saveAutopilotSettings={async () => {}}
        runPrivacyOperation={async () => {}}
        revokeGoalShare={async () => {}}
      />
    );

    expect(markup).toContain("Only the workspace owner can change membership, governance posture, or privacy lifecycle state.");
    expect(markup).toContain("Workspace members can export audit evidence for review and compliance.");
    expect(markup).toContain('style="opacity:0.65"');
    expect(extractButtonMarkup(markup, "Add member")).toContain('disabled=""');
    expect(extractButtonMarkup(markup, "Save governance")).toContain('disabled=""');
    expect(extractButtonMarkup(markup, "Run retention enforcement")).toContain('disabled=""');
    expect(extractButtonMarkup(markup, "Export audit")).not.toContain('disabled=""');
  });

  it("keeps share history visible but disables revoke controls for viewers", () => {
    const data = buildDashboardData();
    data.workspaceSelection = {
      userId: "workspace-viewer",
      workspaceId: "workspace-operations",
      selectedAt: "2026-04-22T00:00:00.000Z",
      updatedAt: "2026-04-22T00:00:00.000Z"
    };
    data.workspaceMembers = [
      {
        id: "member-viewer",
        workspaceId: "workspace-operations",
        userId: "workspace-viewer",
        role: "viewer",
        joinedAt: "2026-04-22T00:00:00.000Z",
        updatedAt: "2026-04-22T00:00:00.000Z"
      }
    ];
    data.goalShares = [
      {
        id: "share-1",
        goalId: "goal-1",
        userId: "workspace-owner",
        workspaceId: "workspace-operations",
        tokenFingerprint: "fingerprint-1",
        status: "active",
        actorContext: null,
        expiresAt: "2026-04-23T00:00:00.000Z",
        lastViewedAt: null,
        revokedAt: null,
        createdAt: "2026-04-22T00:00:00.000Z",
        updatedAt: "2026-04-22T00:00:00.000Z"
      }
    ];
    data.goals = [
      {
        goal: {
          id: "goal-1",
          userId: "workspace-owner",
          workspaceId: "workspace-operations",
          workflowId: "workflow-1",
          title: "Escalate reviewer access",
          request: "Share the current queue context.",
          intent: "email_follow_up",
          status: "running",
          confidence: 0.85,
          explanation: "Viewer should inspect but not mutate share links.",
          createdAt: "2026-04-22T00:00:00.000Z",
          updatedAt: "2026-04-22T00:00:00.000Z"
        },
        workflow: {
          id: "workflow-1",
          goalId: "goal-1",
          workspaceId: "workspace-operations",
          status: "running",
          currentStep: "draft",
          checkpoint: null,
          createdAt: "2026-04-22T00:00:00.000Z",
          updatedAt: "2026-04-22T00:00:00.000Z"
        },
        tasks: [],
        artifacts: [],
        approvals: [],
        watchers: [],
        actionLogs: []
      }
    ];
    data.operatingSections.roleView.role = "viewer";
    data.operatingSections.roleView.label = "Viewer view";
    data.operatingSections.teamWorkflow.mode = "viewer_review";

    const markup = renderToStaticMarkup(
      <DashboardOperationsSections
        data={data}
        isPending={false}
        highlightedItemId={null}
        workspaceState={{ kind: "idle", message: "" }}
        governanceState={{ kind: "idle", message: "" }}
        autopilotState={{ kind: "idle", message: "" }}
        privacyState={{ kind: "idle", message: "" }}
        workspaceName=""
        setWorkspaceName={() => {}}
        workspaceSlug=""
        setWorkspaceSlug={() => {}}
        workspaceDescription=""
        setWorkspaceDescription={() => {}}
        workspaceMemberUserId=""
        setWorkspaceMemberUserId={() => {}}
        workspaceMemberRole="viewer"
        setWorkspaceMemberRole={() => {}}
        governanceDraft={{
          approvalMode: "risk_based",
          requireAuditExports: true,
          maxAutoRunRiskClass: "R2",
          externalSendRequiresApproval: true,
          calendarWriteRequiresApproval: true,
          shadowReplayPolicy: {
            enabled: true,
            promotionMode: "validated_autonomy",
            rollbackOutcome: "allowed_with_confirmation",
            minimumMatchedEpisodes: 5,
            minimumPrecision: 0.8,
            maximumNegativeOutcomeRate: 0.15,
            maximumFailureCostRate: 0.2
          },
          retentionDays: 365
        }}
        setGovernanceDraft={() => {}}
        autopilotDraft={{
          userId: "workspace-viewer",
          mode: "notify_only",
          debounceMinutes: 15,
          createdAt: "2026-04-22T00:00:00.000Z",
          updatedAt: "2026-04-22T00:00:00.000Z"
        }}
        setAutopilotDraft={() => {}}
        getItemAnchorId={(itemId) => itemId}
        openDiagnosticTarget={() => {}}
        createWorkspace={async () => {}}
        selectWorkspace={async () => {}}
        addWorkspaceMember={async () => {}}
        saveWorkspaceGovernance={async () => {}}
        exportWorkspaceAudit={async () => {}}
        saveAutopilotSettings={async () => {}}
        runPrivacyOperation={async () => {}}
        revokeGoalShare={async () => {}}
      />
    );

    expect(markup).toContain("Only workspace owners and editors can manage public goal share links.");
    expect(extractButtonMarkup(markup, "Revoke")).toContain('disabled=""');
  });

  it("renders autopilot exception metadata and operator routes in the command center", () => {
    const data = buildDashboardData();
    data.goals = [
      {
        goal: {
          id: "goal-approval-recovery",
          userId: "workspace-owner",
          workspaceId: "workspace-operations",
          workflowId: "workflow-approval-recovery",
          title: "Recover the blocked outbound approval",
          request: "Investigate the stalled approval queue and recover execution.",
          intent: "approval_follow_up",
          status: "running",
          confidence: 0.9,
          explanation: "Operator needs a fast path into the failing approval context.",
          createdAt: "2026-04-22T00:00:00.000Z",
          updatedAt: "2026-04-22T00:00:00.000Z"
        },
        workflow: {
          id: "workflow-approval-recovery",
          goalId: "goal-approval-recovery",
          workspaceId: "workspace-operations",
          status: "running",
          currentStep: "approval-escalation",
          checkpoint: null,
          createdAt: "2026-04-22T00:00:00.000Z",
          updatedAt: "2026-04-22T00:00:00.000Z"
        },
        tasks: [],
        artifacts: [],
        approvals: [],
        watchers: [],
        actionLogs: []
      }
    ];
    data.autopilotEvents = [
      AutopilotEventSchema.parse({
        id: "event-approval-escalation",
        userId: "workspace-editor",
        kind: "approval_sla_breached",
        sourceId: "approval-security-review",
        idempotencyKey: null,
        mode: "notify_only",
        summary: "Approval SLA breached: Security review for outbound send",
        status: "failed",
        details: {
          eventEnvelope: {
            family: "approval",
            trigger: "approval_sla_breached",
            priority: "critical",
            tags: ["approval", "escalation"],
            correlationKey: "approval-security-review"
          },
          policy: {
            family: "approval",
            severity: "critical",
            queue: "approval_escalations",
            modeRecommendation: "notify_only"
          },
          operatorRoute: {
            section: "approvals",
            itemId: "approval-security-review",
            label: "Security review for outbound send",
            actionLabel: "Open approval"
          },
          suppression: {
            outcome: "allowed",
            reason: null,
            relatedEventId: null,
            budgetKey: null,
            observedCount: null
          }
        },
        actorContext: null,
        createdAt: "2026-04-22T00:00:00.000Z",
        processedAt: "2026-04-22T00:05:00.000Z",
        resultGoalId: "goal-approval-recovery",
        error: "Autopilot execution failed."
      })
    ];

    const markup = renderToStaticMarkup(
      <DashboardOperationsSections
        data={data}
        isPending={false}
        highlightedItemId="event-approval-escalation"
        workspaceState={{ kind: "idle", message: "" }}
        governanceState={{ kind: "idle", message: "" }}
        autopilotState={{ kind: "idle", message: "" }}
        privacyState={{ kind: "idle", message: "" }}
        workspaceName=""
        setWorkspaceName={() => {}}
        workspaceSlug=""
        setWorkspaceSlug={() => {}}
        workspaceDescription=""
        setWorkspaceDescription={() => {}}
        workspaceMemberUserId=""
        setWorkspaceMemberUserId={() => {}}
        workspaceMemberRole="viewer"
        setWorkspaceMemberRole={() => {}}
        governanceDraft={{
          approvalMode: "risk_based",
          requireAuditExports: true,
          maxAutoRunRiskClass: "R2",
          externalSendRequiresApproval: true,
          calendarWriteRequiresApproval: true,
          shadowReplayPolicy: {
            enabled: true,
            promotionMode: "validated_autonomy",
            rollbackOutcome: "allowed_with_confirmation",
            minimumMatchedEpisodes: 5,
            minimumPrecision: 0.8,
            maximumNegativeOutcomeRate: 0.15,
            maximumFailureCostRate: 0.2
          },
          retentionDays: 365
        }}
        setGovernanceDraft={() => {}}
        autopilotDraft={{
          userId: "workspace-editor",
          mode: "notify_only",
          debounceMinutes: 15,
          createdAt: "2026-04-22T00:00:00.000Z",
          updatedAt: "2026-04-22T00:00:00.000Z"
        }}
        setAutopilotDraft={() => {}}
        getItemAnchorId={(itemId) => itemId}
        openDiagnosticTarget={() => {}}
        createWorkspace={async () => {}}
        selectWorkspace={async () => {}}
        addWorkspaceMember={async () => {}}
        saveWorkspaceGovernance={async () => {}}
        exportWorkspaceAudit={async () => {}}
        saveAutopilotSettings={async () => {}}
        runPrivacyOperation={async () => {}}
        revokeGoalShare={async () => {}}
      />
    );

    expect(markup).toContain("Approval SLA breached: Security review for outbound send");
    expect(markup).toContain("Approval Sla Breached via notify only");
    expect(markup).toContain("Approval Escalations");
    expect(markup).toContain("Approval");
    expect(markup).toContain("Critical priority");
    expect(markup).toContain("Open approval");
    expect(markup).toContain("Open goal");
    expect(markup).toContain("Autopilot execution failed.");
  });
});
