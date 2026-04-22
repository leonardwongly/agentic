import { renderToStaticMarkup } from "react-dom/server";
import { DashboardOperatingSectionsCard } from "../apps/web/components/dashboard-operating-sections";

describe("DashboardOperatingSectionsCard", () => {
  it("renders the role-aware view and next best action from server-derived operating sections", () => {
    const markup = renderToStaticMarkup(
      <DashboardOperatingSectionsCard
        operatingSections={{
          generatedAt: "2026-04-22T00:00:00.000Z",
          roleView: {
            role: "editor",
            label: "Editor view",
            summary: "Editors should work the queue, recover execution, and keep automation bounded in Operations.",
            focusAreas: [
              "Recover async execution before trusting fresh autopilot or queue activity.",
              "Clear pending approvals that are holding governed work at the boundary."
            ],
            prioritizedSectionKeys: ["now", "execution", "automation", "trust", "build"]
          },
          teamWorkflow: {
            mode: "editor_execution",
            label: "Editor execution workflow",
            summary:
              "Editors should keep the shared queue moving in Operations and escalate overdue policy decisions back to the owner boundary.",
            visibilityLabel: "Execution-first queue visibility",
            queueMetrics: ["2 collaborators", "1 pending approval", "1 urgent queue item"],
            ownershipAssignments: [
              {
                key: "shared_queue",
                label: "Shared queue",
                ownerRole: "editor",
                status: "attention",
                summary: "1 urgent queue item should be worked in queue order by the editor."
              },
              {
                key: "approval_boundary",
                label: "Approval boundary",
                ownerRole: "owner",
                status: "critical",
                summary: "1 approval already exceeded the owner response window."
              },
              {
                key: "execution_recovery",
                label: "Execution recovery",
                ownerRole: "editor",
                status: "critical",
                summary: "Recovery stays with the editor until retrying jobs are stale and need operator recovery before new queue work can be trusted."
              }
            ],
            queues: [
              {
                key: "mine",
                label: "Mine",
                ownerRole: "editor",
                status: "critical",
                count: 2,
                summary: "1 urgent queue item and one execution recovery issue are in the editor lane.",
                oldestAgeLabel: "7h old",
                targetSection: "commitments",
                targetItemId: "commitment-1",
                targetFilter: "urgent"
              },
              {
                key: "delegated",
                label: "Delegated",
                ownerRole: "owner",
                status: "critical",
                count: 1,
                summary: "1 approval is delegated back to the owner boundary for policy decisions.",
                oldestAgeLabel: "7h old",
                targetSection: "approvals",
                targetItemId: "approval-1",
                targetFilter: null
              }
            ],
            controls: [
              {
                key: "open_mine",
                label: "Open editor lane",
                summary: "Work the execution lane in queue order before widening the surface.",
                status: "critical",
                targetSection: "commitments",
                targetItemId: "commitment-1",
                targetFilter: "urgent",
                permission: {
                  allowed: true,
                  reason: "Workspace members can inspect the active queue lane."
                }
              },
              {
                key: "rebalance_queue",
                label: "Review ownership boundaries",
                summary: "Only owners can reassign queue ownership; use this surface to confirm who should hold the lane.",
                status: "attention",
                targetSection: "workspaces",
                targetFilter: null,
                permission: {
                  allowed: false,
                  reason: "Only the workspace owner can change membership, governance posture, or privacy lifecycle state."
                }
              }
            ],
            auditCoverage: {
              required: true,
              status: "attention",
              summary: "Audit exports are required for this workspace, but no completed export is recorded yet.",
              latestStatus: null,
              latestCompletedAt: null
            },
            actionBoundaries: [
              "Editors can triage queue work, recover execution, and prepare approvals, but governance changes stay with the owner."
            ],
            handoffGuidance: ["Oldest overdue approval: Budget release"],
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
            slaStatus: "critical",
            slaSummary: "1 approval needs owner response before shared execution can widen safely."
          },
          nextBestAction: {
            kind: "recover_execution",
            label: "Recover async execution",
            summary: "Retrying jobs are stale and need operator recovery before new queue work can be trusted.",
            status: "critical",
            targetSection: "operations",
            targetItemId: "operations-job-1",
            reason: "Queue recovery is the highest-priority blocker before more governed work can be trusted.",
            role: "editor"
          },
          sections: [
            {
              key: "execution",
              title: "Execution",
              description: "Async execution needs operator recovery before queued work can be trusted again.",
              status: "critical",
              targetSection: "operations",
              targetItemId: "operations-job-1",
              metrics: ["1 active goal", "1 queue issue", "1 recent artifact"],
              highlights: ["Retry the oldest dead-letter job."]
            }
          ]
        }}
        openView={() => {}}
      />
    );

    expect(markup).toContain("Editor view");
    expect(markup).toContain("editor role");
    expect(markup).toContain("Recover async execution before trusting fresh autopilot or queue activity.");
    expect(markup).toContain("Focus Execution");
    expect(markup).toContain("Editor execution workflow");
    expect(markup).toContain("Execution-first queue visibility");
    expect(markup).toContain("Escalate to owner");
    expect(markup).toContain("Audit required");
    expect(markup).toContain("Audit exports are required for this workspace, but no completed export is recorded yet.");
    expect(markup).toContain("Shared queue: editor");
    expect(markup).toContain("Approval boundary: owner");
    expect(markup).toContain("Mine");
    expect(markup).toContain("2 items");
    expect(markup).toContain("7h old");
    expect(markup).toContain("Open editor lane");
    expect(markup).toContain("Action available");
    expect(markup).toContain("Review ownership boundaries");
    expect(markup).toContain("Restricted");
    expect(markup).toContain("Shared queue: 1 urgent queue item should be worked in queue order by the editor.");
    expect(markup).toContain("1 approval needs owner response before shared execution can widen safely.");
    expect(markup).toContain("Next best action: Recover async execution");
    expect(markup).toContain("Open operations");
    expect(markup).toContain("Queue recovery is the highest-priority blocker");
    expect(markup).toContain("Execution");
  });

  it("renders setup mode when no active workspace is selected", () => {
    const markup = renderToStaticMarkup(
      <DashboardOperatingSectionsCard
        operatingSections={{
          generatedAt: "2026-04-22T00:00:00.000Z",
          roleView: {
            role: null,
            label: "Setup view",
            summary:
              "No active workspace is selected, so the operator shell stays in setup mode until a governed workspace is activated.",
            focusAreas: [
              "Activate a workspace before treating the dashboard like an operator command center.",
              "Connect integrations and watchers before widening automation."
            ],
            prioritizedSectionKeys: ["build", "now", "trust"]
          },
          teamWorkflow: {
            mode: "setup",
            label: "Team workflow not active",
            summary: "No active workspace is selected, so there is no shared queue or role-scoped handoff model to operate yet.",
            visibilityLabel: "Setup-only visibility",
            queueMetrics: ["0 collaborators", "0 pending approvals", "0 urgent queue items"],
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
            actionBoundaries: [
              "Select or create a workspace before treating this dashboard like a multi-actor operating surface."
            ],
            handoffGuidance: [
              "Connect at least one governed workspace before assigning responsibilities or escalation targets."
            ],
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
            slaSummary: "A workspace must be activated before team ownership, SLA tracking, or escalation can be enforced."
          },
          nextBestAction: {
            kind: "configure_workspace",
            label: "Activate a workspace",
            summary: "Select or create a workspace before treating this dashboard like an exception-first operator shell.",
            status: "attention",
            targetSection: "workspaces",
            reason: "No active workspace is selected.",
            role: null
          },
          sections: []
        }}
        openView={() => {}}
      />
    );

    expect(markup).toContain("Setup view");
    expect(markup).toContain("setup mode");
    expect(markup).toContain("Team workflow not active");
    expect(markup).toContain("Setup-only visibility");
    expect(markup).toContain("Activate a workspace before treating the dashboard like an operator command center.");
    expect(markup).toContain("Next best action: Activate a workspace");
    expect(markup).toContain("Open workspaces");
  });
});
