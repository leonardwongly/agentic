import type { DashboardData } from "@agentic/repository";
import { describe, expect, it } from "vitest";
import { describeCoreLoopHealth, summarizeCoreLoopTelemetry } from "../apps/web/lib/core-loop-telemetry";

function buildDashboardData(overrides: Partial<DashboardData> = {}): DashboardData {
  return {
    workspaces: [],
    activeWorkspace: null,
    workspaceSelection: null,
    workspaceMembers: [],
    workspaceGovernance: null,
    goalShares: [],
    privacyOperations: [],
    controlPlane: {
      generatedAt: "2026-04-18T00:00:00.000Z",
      sections: []
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
    goals: [],
    approvals: [],
    commitments: [],
    briefingPreferences: {
      userId: "system",
      timezone: "UTC",
      focus: "balanced",
      schedules: [],
      actorContext: null,
      createdAt: "2026-04-18T00:00:00.000Z",
      updatedAt: "2026-04-18T00:00:00.000Z"
    },
    briefingHistory: [],
    autopilotSettings: {
      userId: "system",
      mode: "notify_only",
      debounceMinutes: 30,
      reliabilityControls: {
        budgetWindowMinutes: 60,
        maxEventsPerWindow: 10,
        maxPendingEvents: 5,
        maxConsecutiveFailures: 3
      },
      actorContext: null,
      createdAt: "2026-04-18T00:00:00.000Z",
      updatedAt: "2026-04-18T00:00:00.000Z"
    },
    autopilotEvents: [],
    memories: [],
    watchers: [],
    integrations: [],
    latestArtifacts: [],
    actionLogs: [],
    diagnostics: {
      generatedAt: "2026-04-18T00:00:00.000Z",
      status: "healthy",
      totalCount: 0,
      items: []
    },
    traceability: {
      generatedAt: "2026-04-18T00:00:00.000Z",
      workspaceId: null,
      workflowTraces: [],
      taskTraces: [],
      approvalTraces: [],
      memoryProvenance: [],
      eventCount: 0,
      artifactCount: 0,
      jobCount: 0,
      trustLane: {
        scopedMemoryCount: 0,
        autonomyEligibleMemoryCount: 0,
        advisoryInferredMemoryCount: 0,
        staleOrReviewRequiredMemoryCount: 0,
        blockedUnscopedMemoryCount: 0,
        policy: "default"
      }
    },
    cockpitRollout: {
      enabled: false,
      variant: "legacy",
      flagName: "AGENTIC_DASHBOARD_COCKPIT" as const,
      source: "default" as const,
      rawValue: null,
      runbookPath: "docs/runbooks/dashboard-cockpit-rollout.md",
      thresholds: {
        firstMeaningfulRenderMs: 2500,
        summaryLatencyMs: 1000,
        tableEndpointLatencyMs: 750,
        eventReconnects: 2,
        approvalLatencyMs: 600000,
        deadLetterRecoveryMs: 900000
      }
    },
    ...overrides
  } as DashboardData;
}

describe("core loop telemetry summary", () => {
  it("reports an idle loop without an active workspace", () => {
    const summary = summarizeCoreLoopTelemetry(buildDashboardData());

    expect(summary.health).toBe("idle");
    expect(summary.workspaceState).toBe("missing");
    expect(summary.hasActivation).toBe(false);
    expect(describeCoreLoopHealth(summary)).toContain("Seed a workspace");
  });

  it("reports activation when governed work exists in an active workspace", () => {
    const summary = summarizeCoreLoopTelemetry(
      buildDashboardData({
        activeWorkspace: {
          id: "workspace-1",
          ownerUserId: "system",
          name: "Operations",
          slug: "operations",
          description: "",
          isPersonal: true,
          createdAt: "2026-04-18T00:00:00.000Z",
          updatedAt: "2026-04-18T00:00:00.000Z"
        },
        commitments: [
          {
            id: "commitment-1",
            userId: "system",
            goalId: null,
            title: "Confirm staffing plan",
            status: "pending",
            summary: "Confirm staffing plan.",
            sourceKind: "goal",
            sourceId: "commitment-source",
            dueAt: null,
            createdAt: "2026-04-18T00:00:00.000Z",
            updatedAt: "2026-04-18T00:00:00.000Z"
          } as unknown as DashboardData["commitments"][number]
        ]
      })
    );

    expect(summary.health).toBe("activation_ready");
    expect(summary.hasActivation).toBe(true);
    expect(summary.hasRepeatUsage).toBe(false);
    expect(summary.hasValueRealization).toBe(false);
    expect(summary.counts.commitments).toBe(1);
  });

  it("reports repeat engagement and realized value from persisted activity", () => {
    const summary = summarizeCoreLoopTelemetry(
      buildDashboardData({
        activeWorkspace: {
          id: "workspace-1",
          ownerUserId: "system",
          name: "Operations",
          slug: "operations",
          description: "",
          isPersonal: true,
          createdAt: "2026-04-18T00:00:00.000Z",
          updatedAt: "2026-04-18T00:00:00.000Z"
        },
        goals: [
          {
            goal: {
              id: "goal-1",
              ownerUserId: "system",
              title: "Close approval queue",
              prompt: "Close the approval queue.",
              status: "completed",
              createdAt: "2026-04-18T00:00:00.000Z",
              updatedAt: "2026-04-18T00:00:00.000Z"
            },
            tasks: [],
            artifacts: [],
            approvals: [],
            actionLogs: []
          } as unknown as DashboardData["goals"][number]
        ],
        approvals: [
          {
            id: "approval-1",
            ownerUserId: "system",
            goalId: "goal-1",
            type: "task_execution",
            decision: "pending",
            requestedAt: "2026-04-18T00:00:00.000Z",
            respondedAt: null,
            rationale: null,
            artifactType: "summary",
            taskTitle: "Review next step",
            payload: {}
          } as unknown as DashboardData["approvals"][number]
        ],
        latestArtifacts: [
          {
            id: "artifact-1",
            ownerUserId: "system",
            goalId: "goal-1",
            title: "Closure summary",
            artifactType: "summary",
            status: "ready",
            storagePath: "/tmp/closure.md",
            createdAt: "2026-04-18T00:00:00.000Z",
            updatedAt: "2026-04-18T00:00:00.000Z"
          } as unknown as DashboardData["latestArtifacts"][number]
        ],
        actionLogs: [{ id: "log-1" }, { id: "log-2" }, { id: "log-3" }] as DashboardData["actionLogs"],
        memories: [
          {
            id: "memory-1",
            ownerUserId: "system",
            category: "workflow",
            memoryType: "confirmed",
            content: "Previous closure pattern.",
            confidence: 0.9,
            source: "test",
            createdAt: "2026-04-18T00:00:00.000Z",
            updatedAt: "2026-04-18T00:00:00.000Z",
            actorContext: null,
            agentId: null,
            agentScope: "global"
          } as unknown as DashboardData["memories"][number]
        ]
      })
    );

    expect(summary.health).toBe("value_realized");
    expect(summary.hasActivation).toBe(true);
    expect(summary.hasRepeatUsage).toBe(true);
    expect(summary.hasValueRealization).toBe(true);
    expect(summary.counts.completedGoals).toBe(1);
    expect(summary.counts.recentActivity).toBe(3);
    expect(describeCoreLoopHealth(summary)).toContain("Value is being realized");
  });
});
