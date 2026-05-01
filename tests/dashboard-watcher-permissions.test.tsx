import { renderToStaticMarkup } from "react-dom/server";
import { CommitmentInboxPageSchema, briefingTypeValues } from "@agentic/contracts";
import type { DashboardData } from "@agentic/repository";
import { Dashboard } from "../apps/web/components/dashboard";

vi.mock("next/navigation", () => ({
  useRouter: () => ({
    refresh: vi.fn()
  })
}));

function buildDashboardData(role: "editor" | "viewer"): DashboardData {
  return {
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
    workspaceSelection: {
      userId: `workspace-${role}`,
      workspaceId: "workspace-operations",
      selectedAt: "2026-04-22T00:00:00.000Z",
      updatedAt: "2026-04-22T00:00:00.000Z"
    },
    workspaceMembers: [
      {
        id: `member-${role}`,
        workspaceId: "workspace-operations",
        userId: `workspace-${role}`,
        role,
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
      workspace: { status: "healthy", summary: "Workspace is active.", updatedAt: "2026-04-22T00:00:00.000Z" },
      commitments: { status: "idle", summary: "No commitments.", updatedAt: "2026-04-22T00:00:00.000Z" },
      automation: { status: "healthy", summary: "Automation is bounded.", updatedAt: "2026-04-22T00:00:00.000Z" },
      execution: { status: "healthy", summary: "Execution is healthy.", updatedAt: "2026-04-22T00:00:00.000Z" },
      trust: { status: "healthy", summary: "Trust posture is healthy.", updatedAt: "2026-04-22T00:00:00.000Z" }
    },
    operatingSections: {
      generatedAt: "2026-04-22T00:00:00.000Z",
      roleView: {
        role,
        label: role === "viewer" ? "Viewer view" : "Editor view",
        summary:
          role === "viewer"
            ? "Viewers can inspect the shared queue but cannot change workflow controls."
            : "Editors can operate shared workflow controls.",
        focusAreas: ["Keep shared workflow state visible."],
        prioritizedSectionKeys: ["now", "execution", "trust"]
      },
      teamWorkflow: {
        mode: role === "viewer" ? "viewer_visibility" : "editor_execution",
        label: role === "viewer" ? "Viewer shared workflow" : "Editor shared workflow",
        summary:
          role === "viewer"
            ? "Viewer access is read-only for shared workflow controls."
            : "Editors can manage shared workflow controls and escalate owner-only actions.",
        visibilityLabel: "Shared workspace visibility",
        queueMetrics: [],
        ownershipAssignments: [],
        queues: [],
        controls: [],
        auditCoverage: {
          required: true,
          status: "healthy",
          summary: "Audit coverage is available.",
          latestStatus: "completed",
          latestCompletedAt: "2026-04-22T00:00:00.000Z"
        },
        actionBoundaries: [],
        handoffGuidance: [],
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
        slaStatus: "healthy",
        slaSummary: "Shared workflow controls stay inside the workspace role boundary."
      },
      nextBestAction: {
        kind: "review_now",
        label: "Inspect shared workflow state",
        summary: "The watcher lane is visible from the dashboard.",
        status: "healthy",
        targetSection: "watchers",
        role
      },
      sections: []
    },
    nowQueue: {
      generatedAt: "2026-04-22T00:00:00.000Z",
      totalCount: 0,
      items: []
    },
    goals: [
      {
        goal: {
          id: "goal-shared-watcher",
          userId: "workspace-owner",
          workspaceId: "workspace-operations",
          workflowId: "workflow-shared-watcher",
          title: "Protect the shared escalation lane",
          request: "Monitor the shared queue for stale escalations.",
          intent: "workflow_automation",
          status: "running",
          confidence: 0.91,
          explanation: "Shared watcher keeps the escalation lane visible.",
          createdAt: "2026-04-22T00:00:00.000Z",
          updatedAt: "2026-04-22T00:00:00.000Z"
        },
        workflow: {
          id: "workflow-shared-watcher",
          goalId: "goal-shared-watcher",
          workspaceId: "workspace-operations",
          status: "running",
          currentStep: "watching",
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
    ],
    approvals: [],
    commitments: [],
    briefingPreferences: {
      userId: `workspace-${role}`,
      timezone: "Asia/Singapore",
      focus: "balanced",
      schedules: briefingTypeValues.map((type) => ({
        type,
        enabled: type === "startup",
        time: type === "startup" ? "09:00" : type === "midday" ? "13:00" : "18:00"
      })),
      createdAt: "2026-04-22T00:00:00.000Z",
      updatedAt: "2026-04-22T00:00:00.000Z"
    },
    briefingHistory: [],
    autopilotSettings: {
      userId: `workspace-${role}`,
      mode: "notify_only",
      debounceMinutes: 30,
      createdAt: "2026-04-22T00:00:00.000Z",
      updatedAt: "2026-04-22T00:00:00.000Z"
    },
    autopilotEvents: [],
    memories: [],
    watchers: [
      {
        id: "watcher-shared-queue",
        goalId: "goal-shared-watcher",
        targetEntity: "shared-escalation-queue",
        condition: "Escalations stay stale for more than 15 minutes.",
        frequency: "hourly",
        triggerAction: "Draft an escalation digest.",
        status: "active",
        createdAt: "2026-04-22T00:00:00.000Z",
        updatedAt: "2026-04-22T00:00:00.000Z",
        actorContext: null,
        lastTriggeredAt: null,
        responsibility: {
          kind: "workspace_role",
          workspaceRole: "owner"
        }
      }
    ],
    integrations: [],
    latestArtifacts: [],
    actionLogs: [],
    diagnostics: {
      generatedAt: "2026-04-22T00:00:00.000Z",
      status: "healthy",
      totalCount: 0,
      items: []
    },
    operations: {
      generatedAt: "2026-04-22T00:00:00.000Z",
      autonomyPosture: {
        status: "attention",
        level: "approval_gated",
        label: "Approval gated",
        summary: "Recovery remains operator-visible.",
        reasons: [],
        stats: [],
        overridePaths: []
      },
      shellEffectiveness: {
        status: "attention",
        summary: "Shared queue recovery is visible.",
        measurementWindowDays: 30,
        windowStartedAt: "2026-03-23T00:00:00.000Z",
        approvalSampleCount: 0,
        medianApprovalDecisionSeconds: null,
        recoveryStartCount: 0,
        recoveryResolvedCount: 0,
        medianRecoveryStartSeconds: null,
        pendingApprovalCount: 0,
        openRuntimeIssueCount: 1,
        metrics: [],
        highlights: []
      },
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
            id: "operations-job-job-1",
            jobId: "job-1",
            label: "Shared queue replay",
            summary: "Dead-lettered after 1/3 attempts.",
            severity: "critical",
            status: "dead_letter",
            updatedAt: "2026-04-22T00:00:00.000Z",
            target: {
              section: "goals",
              itemId: "goal-shared-watcher",
              label: "Open shared goal"
            },
            remediation: {
              kind: "replay_job",
              label: "Replay job",
              note: "Recover the shared workflow queue item from the control tower.",
              permission: "owner",
              statusUrl: "/api/jobs/job-1"
            }
          }
        ]
      },
      connectorHealth: {
        status: "idle",
        totalCount: 0,
        connectedCount: 0,
        degradedCount: 0,
        reconnectRequiredCount: 0,
        refreshFailedCount: 0,
        revokedCount: 0,
        expiredCount: 0,
        validationStaleCount: 0,
        issueCount: 0,
        items: []
      }
    }
  } as DashboardData;
}

function buildCommitmentInbox() {
  return CommitmentInboxPageSchema.parse({
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
    generatedAt: "2026-04-22T00:00:00.000Z"
  });
}

function extractButtonMarkup(markup: string, label: string): string {
  const escapedLabel = label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = markup.match(new RegExp(`<button[^>]*>${escapedLabel}</button>`));

  if (!match) {
    throw new Error(`Button "${label}" was not rendered.`);
  }

  return match[0];
}

function extractInputMarkup(markup: string, placeholder: string): string {
  const escapedPlaceholder = placeholder.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = markup.match(new RegExp(`<input[^>]*placeholder="${escapedPlaceholder}"[^>]*>`));

  if (!match) {
    throw new Error(`Input with placeholder "${placeholder}" was not rendered.`);
  }

  return match[0];
}

describe("Dashboard watcher permissions", () => {
  it("keeps shared workflow controls visible but disabled for shared-workspace viewers", () => {
    const markup = renderToStaticMarkup(
      <Dashboard initialData={buildDashboardData("viewer")} initialNotes={[]} initialCommitmentInbox={buildCommitmentInbox()} />
    );

    expect(markup).toContain("shared-escalation-queue");
    expect(markup).toContain("Viewers can inspect shared workflow watchers, but only workspace owners and editors can create or change them.");
    expect(markup).toContain("Viewers can inspect shared goals, but only workspace owners and editors can refine them.");
    expect(markup).toContain(
      "Viewers can inspect shared runtime issues, but only workspace owners and editors can replay dead-letter jobs."
    );
    expect(extractButtonMarkup(markup, "Pause")).toContain("disabled");
    expect(extractInputMarkup(markup, "Refine this goal...")).toContain("disabled");
    expect(extractButtonMarkup(markup, "Replay job")).toContain("disabled");
  });

  it("leaves shared workflow controls enabled for shared-workspace editors", () => {
    const markup = renderToStaticMarkup(
      <Dashboard initialData={buildDashboardData("editor")} initialNotes={[]} initialCommitmentInbox={buildCommitmentInbox()} />
    );

    expect(markup).toContain("shared-escalation-queue");
    expect(markup).not.toContain(
      "Viewers can inspect shared workflow watchers, but only workspace owners and editors can create or change them."
    );
    expect(markup).not.toContain("Viewers can inspect shared goals, but only workspace owners and editors can refine them.");
    expect(markup).not.toContain(
      "Viewers can inspect shared runtime issues, but only workspace owners and editors can replay dead-letter jobs."
    );
    expect(extractButtonMarkup(markup, "Pause")).not.toContain("disabled");
    expect(extractInputMarkup(markup, "Refine this goal...")).not.toContain("disabled");
    expect(extractButtonMarkup(markup, "Replay job")).not.toContain("disabled");
  });
});
