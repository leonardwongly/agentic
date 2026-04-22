import { getMemoryFreshness } from "@agentic/memory";
import type {
  ActionLog,
  Artifact,
  AutopilotEvent,
  AutopilotSettings,
  ApprovalRequest,
  CommitmentInboxBucket,
  DashboardPermission,
  DashboardNextBestAction,
  Commitment,
  DashboardOperatingSection,
  DashboardOperatingSections,
  DashboardRoleView,
  DashboardTeamWorkflowAssignment,
  DashboardTeamWorkflowAuditCoverage,
  DashboardTeamWorkflowControl,
  DashboardTeamWorkflow,
  DashboardTeamWorkflowQueue,
  EvidenceRecord,
  GoalBundle,
  IntegrationAccount,
  MemoryRecord,
  NowQueue,
  PrivacyOperation,
  Watcher,
  Workspace,
  WorkspaceGovernance,
  WorkspaceMember,
  WorkspaceRole
} from "@agentic/contracts";
import type { DashboardDiagnostics } from "./index";
import type { DashboardOperationsTower } from "./dashboard-operations";

const APPROVAL_WAIT_SLA_MS = 6 * 60 * 60 * 1000;

type BuildDashboardOperatingSectionsParams = {
  userId: string;
  activeWorkspace: Workspace | null;
  workspaceMembers: WorkspaceMember[];
  workspaceGovernance: WorkspaceGovernance | null;
  privacyOperations: PrivacyOperation[];
  goals: GoalBundle[];
  approvals: ApprovalRequest[];
  evidenceRecords: EvidenceRecord[];
  commitments: Commitment[];
  nowQueue: NowQueue;
  autopilotSettings: AutopilotSettings;
  autopilotEvents: AutopilotEvent[];
  memories: MemoryRecord[];
  watchers: Watcher[];
  integrations: IntegrationAccount[];
  latestArtifacts: Artifact[];
  actionLogs: ActionLog[];
  diagnostics: DashboardDiagnostics;
  operations?: DashboardOperationsTower;
};

function pluralize(count: number, noun: string): string {
  if (count === 1) {
    return `${count} ${noun}`;
  }

  if (noun.endsWith("y") && noun.length > 1) {
    return `${count} ${noun.slice(0, -1)}ies`;
  }

  return `${count} ${noun}s`;
}

function compactHighlights(...highlights: Array<string | null>): string[] {
  return highlights.filter((highlight): highlight is string => highlight !== null && highlight.trim().length > 0);
}

function parseTimestampMs(value: string | null | undefined): number | null {
  if (!value) {
    return null;
  }

  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function formatAgeLabel(timestampMs: number | null, nowMs: number): string | null {
  if (timestampMs === null) {
    return null;
  }

  const ageMs = Math.max(0, nowMs - timestampMs);
  const minutes = Math.floor(ageMs / (60 * 1000));

  if (minutes < 1) {
    return "just now";
  }

  if (minutes < 60) {
    return `${minutes}m old`;
  }

  const hours = Math.floor(minutes / 60);

  if (hours < 48) {
    return `${hours}h old`;
  }

  return `${Math.floor(hours / 24)}d old`;
}

function oldestTimestampMs(values: Array<number | null>): number | null {
  return values.reduce<number | null>((oldest, candidate) => {
    if (candidate === null) {
      return oldest;
    }

    if (oldest === null || candidate < oldest) {
      return candidate;
    }

    return oldest;
  }, null);
}

function toAttentionStatus(status: DashboardDiagnostics["status"]): DashboardOperatingSection["status"] {
  if (status === "critical") {
    return "critical";
  }

  if (status === "warning") {
    return "attention";
  }

  return "healthy";
}

function maxSectionStatus(
  left: DashboardOperatingSection["status"],
  right: DashboardOperatingSection["status"]
): DashboardOperatingSection["status"] {
  const weight: Record<DashboardOperatingSection["status"], number> = {
    critical: 3,
    attention: 2,
    healthy: 1,
    idle: 0
  };

  return weight[left] >= weight[right] ? left : right;
}

function buildTeamWorkflowQueue(params: {
  key: DashboardTeamWorkflowQueue["key"];
  label: string;
  ownerRole: WorkspaceRole | null;
  status: DashboardOperatingSection["status"];
  count: number;
  summary: string;
  oldestTimestampMs: number | null;
  targetSection: string;
  targetItemId?: string;
  targetFilter?: CommitmentInboxBucket | null;
  nowMs: number;
}): DashboardTeamWorkflowQueue {
  return {
    key: params.key,
    label: params.label,
    ownerRole: params.ownerRole,
    status: params.status,
    count: params.count,
    summary: params.summary,
    oldestAgeLabel: formatAgeLabel(params.oldestTimestampMs, params.nowMs),
    targetSection: params.targetSection,
    targetItemId: params.targetItemId,
    targetFilter: params.targetFilter ?? null
  };
}

function buildTeamWorkflowControl(params: {
  key: DashboardTeamWorkflowControl["key"];
  label: string;
  summary: string;
  status: DashboardOperatingSection["status"];
  targetSection: string;
  targetItemId?: string;
  targetFilter?: CommitmentInboxBucket | null;
  permission: DashboardPermission;
}): DashboardTeamWorkflowControl {
  return {
    key: params.key,
    label: params.label,
    summary: params.summary,
    status: params.status,
    targetSection: params.targetSection,
    targetItemId: params.targetItemId,
    targetFilter: params.targetFilter ?? null,
    permission: params.permission
  };
}

function resolveOperatorRole(params: Pick<BuildDashboardOperatingSectionsParams, "userId" | "activeWorkspace" | "workspaceMembers">): WorkspaceRole | null {
  if (!params.activeWorkspace) {
    return null;
  }

  if (params.activeWorkspace.ownerUserId === params.userId) {
    return "owner";
  }

  const member = params.workspaceMembers.find(
    (candidate) => candidate.workspaceId === params.activeWorkspace?.id && candidate.userId === params.userId
  );

  return member?.role ?? null;
}

function buildDashboardPermission(allowed: boolean, reason: string): DashboardPermission {
  return {
    allowed,
    reason
  };
}

function buildRoleView(params: {
  role: WorkspaceRole | null;
  activeWorkspace: Workspace | null;
  pendingApprovals: ApprovalRequest[];
  nowQueue: NowQueue;
  operations?: DashboardOperationsTower;
}): DashboardRoleView {
  const firstAsyncIssue = params.operations?.asyncExecution?.items[0] ?? null;
  const firstConnectorIssue = params.operations?.connectorHealth?.items[0] ?? null;
  const focusAreas: string[] = [];

  if (!params.activeWorkspace) {
    return {
      role: null,
      label: "Setup view",
      summary: "No active workspace is selected, so the operator shell stays in setup mode until a governed workspace is activated.",
      focusAreas: [
        "Activate a workspace before treating the dashboard like an operator command center.",
        "Connect integrations and watchers before widening automation."
      ],
      prioritizedSectionKeys: ["build", "now", "trust"]
    };
  }

  if (firstAsyncIssue) {
    focusAreas.push("Recover async execution before trusting fresh autopilot or queue activity.");
  }

  if (params.pendingApprovals.length > 0) {
    focusAreas.push("Clear pending approvals that are holding governed work at the boundary.");
  }

  if (firstConnectorIssue) {
    focusAreas.push("Repair degraded connector health before widening automation or autonomy.");
  }

  if (params.nowQueue.totalCount > 0) {
    focusAreas.push("Keep the immediate queue moving so operator work does not accumulate silently.");
  }

  switch (params.role) {
    case "owner":
      return {
        role: "owner",
        label: "Owner view",
        summary:
          focusAreas[0] ??
          `Owners should clear blockers, approvals, and trust risks first in ${params.activeWorkspace.name}.`,
        focusAreas:
          focusAreas.length > 0
            ? focusAreas
            : [
                "Own the approval boundary and decide when autonomy can widen.",
                "Keep queue recovery and connector posture inside safe operating bounds."
              ],
        prioritizedSectionKeys: ["now", "execution", "trust", "automation", "build"]
      };
    case "viewer":
      return {
        role: "viewer",
        label: "Viewer view",
        summary:
          focusAreas[0] ??
          `Viewers can inspect evidence and escalate blockers in ${params.activeWorkspace.name}, but they should not act as the policy authority.`,
        focusAreas:
          focusAreas.length > 0
            ? focusAreas
            : [
                "Review operator evidence and surface the highest-signal blockers.",
                "Escalate trust or execution risks to an editor or owner."
              ],
        prioritizedSectionKeys: ["trust", "now", "execution", "automation", "build"]
      };
    default:
      return {
        role: "editor",
        label: "Editor view",
        summary:
          focusAreas[0] ??
          `Editors should work the queue, recover execution, and keep automation bounded in ${params.activeWorkspace.name}.`,
        focusAreas:
          focusAreas.length > 0
            ? focusAreas
            : [
                "Triage the immediate queue and recover stalled execution.",
                "Keep autopilot bounded and route trust blockers back to the owner."
              ],
        prioritizedSectionKeys: ["now", "execution", "automation", "trust", "build"]
      };
  }
}

function buildNextBestAction(params: {
  role: WorkspaceRole | null;
  activeWorkspace: Workspace | null;
  nowQueue: NowQueue;
  approvals: ApprovalRequest[];
  operations?: DashboardOperationsTower;
}): DashboardNextBestAction {
  const firstAsyncIssue = params.operations?.asyncExecution?.items[0] ?? null;
  const firstConnectorIssue = params.operations?.connectorHealth?.items[0] ?? null;
  const topNowItem = params.nowQueue.items[0] ?? null;
  const pendingApproval = params.approvals.find((approval) => approval.decision === "pending") ?? null;

  if (!params.activeWorkspace) {
    return {
      kind: "configure_workspace",
      label: "Activate a workspace",
      summary: "Select or create a workspace before treating this dashboard like an exception-first operator shell.",
      status: "attention",
      targetSection: "workspaces",
      reason: "No active workspace is selected.",
      role: null
    };
  }

  if (firstAsyncIssue) {
    return {
      kind: "recover_execution",
      label: "Recover async execution",
      summary: firstAsyncIssue.summary,
      status: params.operations?.asyncExecution?.status === "critical" ? "critical" : "attention",
      targetSection: "operations",
      targetItemId: firstAsyncIssue.id,
      reason: "Queue recovery is the highest-priority blocker before more governed work can be trusted.",
      role: params.role
    };
  }

  if (pendingApproval) {
    return {
      kind: "review_approval",
      label: "Review the oldest approval",
      summary: `Approval "${pendingApproval.title}" is still pending and is holding governed work at the decision boundary.`,
      status: topNowItem?.suggestedNextAction?.kind === "review_approval" ? "critical" : "attention",
      targetSection: "approvals",
      targetItemId: pendingApproval.id,
      reason: "Pending approvals should be cleared before widening execution or autonomy.",
      role: params.role
    };
  }

  if (topNowItem) {
    return {
      kind: "review_now",
      label: "Work the top queue item",
      summary: `${topNowItem.title} is the highest-priority item in the immediate queue.`,
      status: topNowItem.status === "stale" || topNowItem.status === "needs-review" ? "critical" : "attention",
      targetSection: topNowItem.suggestedNextAction?.section ?? "now",
      targetItemId: topNowItem.suggestedNextAction?.itemId ?? topNowItem.commitmentId,
      reason: topNowItem.reasons[0] ?? "The immediate operator queue should be kept current.",
      role: params.role
    };
  }

  if (firstConnectorIssue) {
    return {
      kind: "repair_connector",
      label: "Repair connector health",
      summary: firstConnectorIssue.summary,
      status: firstConnectorIssue.severity === "critical" ? "critical" : "attention",
      targetSection: "operations",
      targetItemId: firstConnectorIssue.id,
      reason: "Connector degradation should be repaired before widening automation coverage.",
      role: params.role
    };
  }

  return {
    kind: "review_now",
    label: "Inspect the live queue",
    summary: "The operator shell is clear enough to inspect live queue health and keep the workspace moving.",
    status: "healthy",
    targetSection: "now",
    reason: "No blocking execution, approval, or connector issue is currently dominating the loop.",
    role: params.role
  };
}

function buildTeamWorkflow(params: {
  role: WorkspaceRole | null;
  activeWorkspace: Workspace | null;
  workspaceMembers: WorkspaceMember[];
  workspaceGovernance: WorkspaceGovernance | null;
  privacyOperations: PrivacyOperation[];
  approvals: ApprovalRequest[];
  commitments: Commitment[];
  nowQueue: NowQueue;
  operations?: DashboardOperationsTower;
  generatedAt: string;
}): DashboardTeamWorkflow {
  if (!params.activeWorkspace) {
    return {
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
        manageMembers: buildDashboardPermission(false, "Select or create a workspace before managing members."),
        editGovernance: buildDashboardPermission(false, "Select a workspace before editing governance controls."),
        exportAudit: buildDashboardPermission(false, "Select a workspace before exporting workspace audit evidence."),
        managePrivacyOperations: buildDashboardPermission(false, "Select a workspace before running privacy lifecycle operations.")
      },
      escalationTargetRole: null,
      slaStatus: "attention",
      slaSummary: "A workspace must be activated before team ownership, SLA tracking, or escalation can be enforced."
    };
  }

  const nowMs = parseTimestampMs(params.generatedAt) ?? Date.now();
  const workspaceMemberCount = params.workspaceMembers.filter(
    (member) => member.workspaceId === params.activeWorkspace?.id
  ).length;
  const collaboratorCount = Math.max(0, workspaceMemberCount - 1);
  const openCommitments = params.commitments.filter(
    (commitment) => commitment.status !== "completed" && commitment.status !== "dismissed"
  );
  const pendingApprovals = params.approvals.filter((approval) => approval.decision === "pending");
  const overdueApprovals = pendingApprovals.filter((approval) => {
    const expiryAtMs = parseTimestampMs(approval.expiryAt);
    const createdAtMs = parseTimestampMs(approval.createdAt);

    if (expiryAtMs !== null && expiryAtMs <= nowMs) {
      return true;
    }

    return createdAtMs !== null && nowMs - createdAtMs >= APPROVAL_WAIT_SLA_MS;
  });
  const urgentQueueItems = params.nowQueue.items.filter(
    (item) => item.urgency === "immediate" || item.status === "needs-review" || item.status === "stale"
  );
  const urgentCommitments = openCommitments.filter((commitment) => urgentQueueItems.some((item) => item.commitmentId === commitment.id));
  const blockedCommitments = openCommitments.filter((commitment) => commitment.status === "blocked");
  const waitingCommitments = openCommitments.filter((commitment) => commitment.status === "scheduled");
  const firstAsyncIssue = params.operations?.asyncExecution?.items[0] ?? null;
  const firstConnectorIssue = params.operations?.connectorHealth?.items[0] ?? null;
  const latestAuditExport = [...params.privacyOperations]
    .filter((operation) => operation.kind === "workspace_export")
    .sort((left, right) => right.createdAt.localeCompare(left.createdAt))[0] ?? null;
  const auditExportsRequired = params.workspaceGovernance?.requireAuditExports ?? false;
  const hasSharedQueue = collaboratorCount > 0 || pendingApprovals.length > 0 || params.nowQueue.totalCount > 0;
  const ownerOnlyReason = "Only the workspace owner can change membership, governance posture, or privacy lifecycle state.";
  const queueMetrics = [
    `${pluralize(collaboratorCount, "collaborator")}`,
    `${pluralize(pendingApprovals.length, "pending approval")}`,
    `${pluralize(urgentQueueItems.length, "urgent queue item")}`
  ];
  const sharedQueueOwnerRole: WorkspaceRole = collaboratorCount > 0 ? "editor" : "owner";
  const queueAssignmentStatus: DashboardOperatingSection["status"] =
    urgentQueueItems.some((item) => item.status === "stale" || item.status === "needs-review")
      ? "critical"
      : urgentQueueItems.length > 0 || params.nowQueue.totalCount > 0
        ? "attention"
        : "healthy";
  const ownershipAssignments: DashboardTeamWorkflowAssignment[] = [
    {
      key: "shared_queue",
      label: "Shared queue",
      ownerRole: sharedQueueOwnerRole,
      status: queueAssignmentStatus,
      summary:
        urgentQueueItems.length > 0
          ? `${pluralize(urgentQueueItems.length, "urgent queue item")} should be worked in queue order by the ${sharedQueueOwnerRole}.`
          : params.nowQueue.totalCount > 0
            ? `${pluralize(params.nowQueue.totalCount, "queue item")} are active, and the ${sharedQueueOwnerRole} should keep the shared queue current.`
            : `No urgent shared-queue work is currently waiting on the ${sharedQueueOwnerRole}.`
    },
    {
      key: "approval_boundary",
      label: "Approval boundary",
      ownerRole: "owner",
      status: overdueApprovals.length > 0 ? "critical" : pendingApprovals.length > 0 ? "attention" : "healthy",
      summary:
        overdueApprovals.length > 0
          ? `${pluralize(overdueApprovals.length, "approval")} already exceeded the owner response window.`
          : pendingApprovals.length > 0
            ? `${pluralize(pendingApprovals.length, "approval")} are waiting on the owner decision boundary.`
            : "No shared approvals are currently waiting on the owner boundary."
    },
    {
      key: "execution_recovery",
      label: "Execution recovery",
      ownerRole: sharedQueueOwnerRole,
      status:
        firstAsyncIssue !== null
          ? params.operations?.asyncExecution?.status === "critical"
            ? "critical"
            : "attention"
          : "healthy",
      summary:
        firstAsyncIssue !== null
          ? `Recovery stays with the ${sharedQueueOwnerRole} until ${firstAsyncIssue.summary.toLowerCase()}.`
          : `No active execution recovery lane is currently assigned to the ${sharedQueueOwnerRole}.`
    }
  ];
  const auditCoverage: DashboardTeamWorkflowAuditCoverage =
    latestAuditExport?.status === "failed"
      ? {
          required: auditExportsRequired,
          status: auditExportsRequired ? "critical" : "attention",
          summary:
            "The latest workspace audit export failed and should be retried before widening governed execution.",
          latestStatus: latestAuditExport.status,
          latestCompletedAt: latestAuditExport.completedAt
        }
      : latestAuditExport?.status === "queued" || latestAuditExport?.status === "running"
        ? {
            required: auditExportsRequired,
            status: "attention",
            summary: "A workspace audit export is in flight through the durable worker path.",
            latestStatus: latestAuditExport.status,
            latestCompletedAt: latestAuditExport.completedAt
          }
        : latestAuditExport?.status === "completed" && latestAuditExport.completedAt
          ? {
              required: auditExportsRequired,
              status: "healthy",
              summary: `Latest workspace audit export completed at ${latestAuditExport.completedAt}.`,
              latestStatus: latestAuditExport.status,
              latestCompletedAt: latestAuditExport.completedAt
            }
          : auditExportsRequired
            ? {
                required: true,
                status: "attention",
                summary:
                  "Audit exports are required for this workspace, but no completed export is recorded yet.",
                latestStatus: latestAuditExport?.status ?? null,
                latestCompletedAt: latestAuditExport?.completedAt ?? null
              }
            : {
                required: false,
                status: "healthy",
                summary:
                  "Audit exports are optional right now, and the export route remains available for review and compliance.",
                latestStatus: latestAuditExport?.status ?? null,
                latestCompletedAt: latestAuditExport?.completedAt ?? null
              };
  const handoffGuidance = compactHighlights(
    overdueApprovals[0] ? `Oldest overdue approval: ${overdueApprovals[0].title}` : null,
    firstAsyncIssue ? `Execution recovery owner: ${firstAsyncIssue.summary}` : null,
    auditCoverage.status !== "healthy" ? auditCoverage.summary : null,
    firstConnectorIssue ? `Connector escalation: ${firstConnectorIssue.summary}` : null,
    hasSharedQueue ? "Use the shared queue ordering before pulling in new ad hoc work." : null
  );
  const ownerPermissions = {
    manageMembers: buildDashboardPermission(true, "Owners can change workspace membership."),
    editGovernance: buildDashboardPermission(true, "Owners can change workspace governance posture."),
    exportAudit: buildDashboardPermission(true, "Workspace members can export audit evidence."),
    managePrivacyOperations: buildDashboardPermission(true, "Owners can run privacy lifecycle operations.")
  };
  const collaboratorPermissions = {
    manageMembers: buildDashboardPermission(false, ownerOnlyReason),
    editGovernance: buildDashboardPermission(false, ownerOnlyReason),
    exportAudit: buildDashboardPermission(true, "Workspace members can export audit evidence for review and compliance."),
    managePrivacyOperations: buildDashboardPermission(false, ownerOnlyReason)
  };
  const nonOverduePendingApprovals = pendingApprovals.filter((approval) => !overdueApprovals.includes(approval));
  const delegatedQueueCount = params.role === "owner" ? (sharedQueueOwnerRole === "editor" ? urgentCommitments.length : 0) : pendingApprovals.length;
  const mineQueueCount =
    params.role === "owner"
      ? pendingApprovals.length + (sharedQueueOwnerRole === "owner" ? urgentCommitments.length : 0)
      : params.role === "editor"
        ? urgentCommitments.length + (firstAsyncIssue ? 1 : 0)
        : 0;
  const escalatedQueueStatus: DashboardOperatingSection["status"] =
    overdueApprovals.length > 0
      ? "critical"
      : firstConnectorIssue
        ? firstConnectorIssue.severity === "critical"
          ? "critical"
          : "attention"
        : "healthy";
  const mineQueueStatus: DashboardOperatingSection["status"] =
    params.role === "owner"
      ? overdueApprovals.length > 0
        ? "critical"
        : pendingApprovals.length > 0 || urgentCommitments.length > 0
          ? "attention"
          : "healthy"
      : params.role === "editor"
        ? firstAsyncIssue
          ? params.operations?.asyncExecution?.status === "critical"
            ? "critical"
            : "attention"
          : urgentCommitments.some((commitment) => commitment.status === "stale" || commitment.status === "needs-review")
            ? "critical"
            : urgentCommitments.length > 0
              ? "attention"
              : "healthy"
        : "healthy";
  const delegatedQueueStatus: DashboardOperatingSection["status"] =
    params.role === "owner"
      ? urgentCommitments.some((commitment) => commitment.status === "stale" || commitment.status === "needs-review")
        ? "critical"
        : delegatedQueueCount > 0
          ? "attention"
          : "healthy"
      : overdueApprovals.length > 0
        ? "critical"
        : delegatedQueueCount > 0
          ? "attention"
          : "healthy";
  const queues: DashboardTeamWorkflowQueue[] = [
    buildTeamWorkflowQueue({
      key: "mine",
      label: "Mine",
      ownerRole: params.role,
      status: mineQueueStatus,
      count: mineQueueCount,
      summary:
        params.role === "owner"
          ? mineQueueCount > 0
            ? sharedQueueOwnerRole === "owner"
              ? `${pluralize(pendingApprovals.length, "approval")} and ${pluralize(urgentCommitments.length, "urgent queue item")} are still sitting in the owner lane because no editor handoff is available.`
              : `${pluralize(pendingApprovals.length, "approval")} are sitting with the owner decision boundary right now.`
            : "The owner lane is clear right now."
          : params.role === "editor"
            ? mineQueueCount > 0
              ? firstAsyncIssue
                ? `${pluralize(urgentCommitments.length, "urgent queue item")} and one execution recovery issue are in the editor lane.`
                : `${pluralize(urgentCommitments.length, "urgent queue item")} are currently assigned to the editor lane.`
              : "The editor execution lane is currently clear."
            : "Viewers do not own an execution lane; use this view to inspect and escalate only.",
      oldestTimestampMs: oldestTimestampMs([
        ...pendingApprovals.map((approval) => parseTimestampMs(approval.createdAt)),
        ...urgentCommitments.map((commitment) => parseTimestampMs(commitment.updatedAt))
      ]),
      targetSection:
        params.role === "owner" && pendingApprovals.length > 0
          ? "approvals"
          : params.role === "editor" && firstAsyncIssue
            ? "operations"
            : "commitments",
      targetItemId:
        params.role === "owner" && pendingApprovals.length > 0
          ? pendingApprovals[0]?.id
          : params.role === "editor" && firstAsyncIssue
            ? firstAsyncIssue.id
            : urgentCommitments[0]?.id,
      targetFilter: params.role === "owner" && pendingApprovals.length > 0 ? null : "urgent",
      nowMs
    }),
    buildTeamWorkflowQueue({
      key: "delegated",
      label: "Delegated",
      ownerRole: params.role === "owner" ? sharedQueueOwnerRole : "owner",
      status: delegatedQueueStatus,
      count: delegatedQueueCount,
      summary:
        params.role === "owner"
          ? delegatedQueueCount > 0
            ? `${pluralize(delegatedQueueCount, "urgent queue item")} are delegated to the editor queue for execution-first handling.`
            : "There is no active editor delegation right now."
          : params.role === "editor"
            ? delegatedQueueCount > 0
              ? `${pluralize(delegatedQueueCount, "approval")} are delegated back to the owner boundary for policy decisions.`
              : "There are no delegated approval decisions waiting on the owner."
            : delegatedQueueCount > 0
              ? `${pluralize(urgentCommitments.length, "queue item")} stay with editors while ${pluralize(pendingApprovals.length, "approval")} stay with owners.`
              : "No delegated team work is active right now.",
      oldestTimestampMs:
        params.role === "owner"
          ? oldestTimestampMs(urgentCommitments.map((commitment) => parseTimestampMs(commitment.updatedAt)))
          : oldestTimestampMs(pendingApprovals.map((approval) => parseTimestampMs(approval.createdAt))),
      targetSection: params.role === "owner" ? "commitments" : "approvals",
      targetItemId: params.role === "owner" ? urgentCommitments[0]?.id : pendingApprovals[0]?.id,
      targetFilter: params.role === "owner" ? "urgent" : null,
      nowMs
    }),
    buildTeamWorkflowQueue({
      key: "escalated",
      label: "Escalated",
      ownerRole: "owner",
      status: escalatedQueueStatus,
      count: overdueApprovals.length + (firstConnectorIssue ? 1 : 0),
      summary:
        overdueApprovals.length > 0
          ? `${pluralize(overdueApprovals.length, "approval")} breached SLA and should be escalated to the owner boundary immediately.`
          : firstConnectorIssue
            ? `Connector escalation is open: ${firstConnectorIssue.summary}`
            : "No escalations are currently open.",
      oldestTimestampMs: oldestTimestampMs([
        ...overdueApprovals.map((approval) => parseTimestampMs(approval.createdAt)),
        firstConnectorIssue ? nowMs : null
      ]),
      targetSection: overdueApprovals.length > 0 ? "approvals" : firstConnectorIssue ? "operations" : "approvals",
      targetItemId: overdueApprovals[0]?.id ?? firstConnectorIssue?.id,
      nowMs
    }),
    buildTeamWorkflowQueue({
      key: "blocked",
      label: "Blocked",
      ownerRole: sharedQueueOwnerRole,
      status: firstAsyncIssue || blockedCommitments.length > 0 ? "critical" : "healthy",
      count: blockedCommitments.length + (firstAsyncIssue ? 1 : 0),
      summary:
        firstAsyncIssue
          ? `${firstAsyncIssue.summary} ${blockedCommitments.length > 0 ? `There are also ${pluralize(blockedCommitments.length, "blocked commitment")} waiting behind recovery.` : ""}`.trim()
          : blockedCommitments.length > 0
            ? `${pluralize(blockedCommitments.length, "commitment")} are blocked and need explicit operator recovery or unblocking.`
            : "No blocked work is currently open.",
      oldestTimestampMs: oldestTimestampMs([
        firstAsyncIssue ? nowMs : null,
        ...blockedCommitments.map((commitment) => parseTimestampMs(commitment.updatedAt))
      ]),
      targetSection: firstAsyncIssue ? "operations" : "commitments",
      targetItemId: firstAsyncIssue?.id ?? blockedCommitments[0]?.id,
      targetFilter: firstAsyncIssue ? null : "waiting_on_others",
      nowMs
    }),
    buildTeamWorkflowQueue({
      key: "waiting",
      label: "Waiting",
      ownerRole: params.role === "owner" ? "owner" : sharedQueueOwnerRole,
      status: nonOverduePendingApprovals.length > 0 || waitingCommitments.length > 0 ? "attention" : "healthy",
      count: nonOverduePendingApprovals.length + waitingCommitments.length,
      summary:
        nonOverduePendingApprovals.length > 0
          ? `${pluralize(nonOverduePendingApprovals.length, "approval")} are still inside SLA but waiting for the next bounded decision.`
          : waitingCommitments.length > 0
            ? `${pluralize(waitingCommitments.length, "commitment")} are waiting on dependencies or scheduled follow-through.`
            : "No queued work is waiting on a later handoff right now.",
      oldestTimestampMs: oldestTimestampMs([
        ...nonOverduePendingApprovals.map((approval) => parseTimestampMs(approval.createdAt)),
        ...waitingCommitments.map((commitment) => parseTimestampMs(commitment.updatedAt))
      ]),
      targetSection: nonOverduePendingApprovals.length > 0 ? "approvals" : "commitments",
      targetItemId: nonOverduePendingApprovals[0]?.id ?? waitingCommitments[0]?.id,
      targetFilter: nonOverduePendingApprovals.length > 0 ? null : "waiting_on_others",
      nowMs
    })
  ];
  const controls: DashboardTeamWorkflowControl[] = [
    buildTeamWorkflowControl({
      key: "open_mine",
      label: params.role === "owner" ? "Open owner lane" : params.role === "editor" ? "Open editor lane" : "Open shared queue",
      summary:
        params.role === "owner"
          ? "Review the owner-held queue first so approvals do not quietly accumulate past SLA."
          : params.role === "editor"
            ? "Work the execution lane in queue order before widening the surface."
            : "Inspect the shared queue and escalate the highest-signal blocker.",
      status: mineQueueStatus,
      targetSection: queues[0].targetSection,
      targetItemId: queues[0].targetItemId,
      targetFilter: queues[0].targetFilter,
      permission: buildDashboardPermission(true, "Workspace members can inspect the active queue lane.")
    }),
    buildTeamWorkflowControl({
      key: "rebalance_queue",
      label: params.role === "owner" ? "Rebalance queue ownership" : "Review ownership boundaries",
      summary:
        params.role === "owner"
          ? "Use membership and role boundaries to rebalance shared-queue ownership before ambiguity compounds."
          : "Only owners can reassign queue ownership; use this surface to confirm who should hold the lane.",
      status: collaboratorCount === 0 ? "attention" : "healthy",
      targetSection: "workspaces",
      permission:
        params.role === "owner"
          ? ownerPermissions.manageMembers
          : collaboratorPermissions.manageMembers
    }),
    buildTeamWorkflowControl({
      key: "escalate_overdue",
      label: overdueApprovals.length > 0 ? "Escalate overdue approvals" : "Review escalation path",
      summary:
        overdueApprovals.length > 0
          ? "Move overdue policy decisions back to the owner boundary before execution widens."
          : "Confirm which role should receive the next escalation when policy or connector risk breaches SLA.",
      status: escalatedQueueStatus,
      targetSection: overdueApprovals.length > 0 ? "approvals" : firstConnectorIssue ? "operations" : "approvals",
      targetItemId: overdueApprovals[0]?.id ?? firstConnectorIssue?.id,
      permission: buildDashboardPermission(
        params.role !== null,
        "Only workspace members can review and escalate shared approvals."
      )
    }),
    buildTeamWorkflowControl({
      key: "review_blockers",
      label: "Review blockers",
      summary: "Inspect execution recovery and blocked commitments together so the queue does not split across hidden workarounds.",
      status: firstAsyncIssue || blockedCommitments.length > 0 ? "critical" : "healthy",
      targetSection: firstAsyncIssue ? "operations" : "commitments",
      targetItemId: firstAsyncIssue?.id ?? blockedCommitments[0]?.id,
      targetFilter: firstAsyncIssue ? null : "waiting_on_others",
      permission: buildDashboardPermission(true, "Workspace members can inspect blocked execution and recovery posture.")
    }),
    buildTeamWorkflowControl({
      key: "export_audit",
      label: "Export audit trail",
      summary: "Pull audit evidence after handoffs or escalations so the next operator can verify the chain of custody.",
      status: auditCoverage.status,
      targetSection: "privacy",
      permission:
        params.role === "owner"
          ? ownerPermissions.exportAudit
          : collaboratorPermissions.exportAudit
    })
  ];

  if (params.role === "owner") {
    return {
      mode: "owner_control",
      label: "Owner-controlled team workflow",
      summary:
        overdueApprovals.length > 0
          ? `Owners should clear overdue approvals and rebalance role boundaries before widening execution in ${params.activeWorkspace.name}.`
          : `Owners are the policy authority for ${params.activeWorkspace.name} and should keep delegation, approvals, and recovery inside bounded operating limits.`,
      visibilityLabel: "Full queue, approval, and governance visibility",
      queueMetrics,
      ownershipAssignments,
      queues,
      controls,
      auditCoverage,
      actionBoundaries: [
        "Owners can manage membership, governance posture, and approval decisions.",
        "Use owner authority to unblock policy gates instead of routing around them."
      ],
      handoffGuidance:
        handoffGuidance.length > 0
          ? handoffGuidance
          : ["Route execution triage to editors and keep final policy decisions with the owner boundary."],
      permissions: ownerPermissions,
      escalationTargetRole: overdueApprovals.length > 0 ? "owner" : firstAsyncIssue ? "editor" : null,
      slaStatus:
        overdueApprovals.length > 0
          ? "critical"
          : urgentQueueItems.length > 0 || pendingApprovals.length > 0
            ? "attention"
            : "healthy",
      slaSummary:
        overdueApprovals.length > 0
          ? `${pluralize(overdueApprovals.length, "approval")} exceeded the shared-team response window.`
          : pendingApprovals.length > 0 || urgentQueueItems.length > 0
            ? "The team loop is active and should be cleared before risk compounds."
            : "Shared approvals and queue ownership are currently inside the expected response window."
    };
  }

  if (params.role === "viewer") {
    return {
      mode: "viewer_review",
      label: "Viewer review workflow",
      summary:
        overdueApprovals.length > 0
          ? `Viewers can inspect evidence and surface overdue blockers in ${params.activeWorkspace.name}, but they should escalate action ownership instead of acting as the authority.`
          : `Viewers can review queue evidence in ${params.activeWorkspace.name} and should escalate execution or policy blockers to editors or owners.`,
      visibilityLabel: "Read-only review visibility",
      queueMetrics,
      ownershipAssignments,
      queues,
      controls,
      auditCoverage,
      actionBoundaries: [
        "Viewers can inspect approvals, queue evidence, and execution posture but cannot change policy or membership.",
        "Escalate blocked execution to editors and policy gates to owners."
      ],
      handoffGuidance:
        handoffGuidance.length > 0 ? handoffGuidance : ["Escalate the highest-signal blocker instead of distributing parallel asks."],
      permissions: collaboratorPermissions,
      escalationTargetRole: overdueApprovals.length > 0 ? "owner" : hasSharedQueue ? "editor" : null,
      slaStatus:
        overdueApprovals.length > 0
          ? "critical"
          : pendingApprovals.length > 0 || urgentQueueItems.length > 0
            ? "attention"
            : "healthy",
      slaSummary:
        overdueApprovals.length > 0
          ? "A policy-bound approval is overdue and should be escalated to the owner."
          : pendingApprovals.length > 0 || urgentQueueItems.length > 0
            ? "The review queue is active and should be escalated through the assigned execution owner."
            : "There are no active SLA breaches requiring viewer escalation right now."
    };
  }

  return {
    mode: "editor_execution",
    label: "Editor execution workflow",
    summary:
      overdueApprovals.length > 0
        ? `Editors should keep the shared queue moving in ${params.activeWorkspace.name} and escalate overdue policy decisions back to the owner boundary.`
        : `Editors own shared execution flow in ${params.activeWorkspace.name}: keep the queue current, recover failures, and escalate governance gates instead of bypassing them.`,
    visibilityLabel: "Execution-first queue visibility",
    queueMetrics,
    ownershipAssignments,
    queues,
    controls,
    auditCoverage,
    actionBoundaries: [
      "Editors can triage queue work, recover execution, and prepare approvals, but governance changes stay with the owner.",
      "Use the shared queue ordering before widening automation or escalating new work."
    ],
    handoffGuidance:
      handoffGuidance.length > 0
        ? handoffGuidance
        : ["Route governance and membership changes to owners once execution recovery is stable."],
    permissions: collaboratorPermissions,
    escalationTargetRole: overdueApprovals.length > 0 || firstConnectorIssue ? "owner" : null,
    slaStatus:
      overdueApprovals.length > 0
        ? "critical"
        : pendingApprovals.length > 0 || urgentQueueItems.length > 0 || (hasSharedQueue && collaboratorCount === 0)
          ? "attention"
          : "healthy",
    slaSummary:
      overdueApprovals.length > 0
        ? `${pluralize(overdueApprovals.length, "approval")} need owner response before shared execution can widen safely.`
        : pendingApprovals.length > 0 || urgentQueueItems.length > 0
          ? "Execution is active and should be worked in queue order before the team accumulates hidden latency."
          : hasSharedQueue && collaboratorCount === 0
            ? "Shared work is flowing through a thin team surface, so handoffs should stay explicit."
            : "The shared execution loop is operating inside the current SLA budget."
  };
}

export function buildDashboardOperatingSections(params: BuildDashboardOperatingSectionsParams): DashboardOperatingSections {
  const freshnessNow = Date.parse(params.diagnostics.generatedAt);
  const openCommitments = params.commitments.filter(
    (commitment) => commitment.status !== "completed" && commitment.status !== "dismissed"
  );
  const needsReviewCommitments = openCommitments.filter(
    (commitment) => commitment.status === "needs-review" || commitment.status === "stale"
  );
  const blockedCommitments = openCommitments.filter((commitment) => commitment.status === "blocked");
  const pendingApprovals = params.approvals.filter((approval) => approval.decision === "pending");
  const activeGoals = params.goals.filter((bundle) => bundle.goal.status !== "completed");
  const blockedTasks = activeGoals.flatMap((bundle) =>
    bundle.tasks.filter((task) => task.state === "blocked" || task.state === "failed")
  );
  const activeWatchers = params.watchers.filter((watcher) => watcher.status === "active");
  const pendingEvents = params.autopilotEvents.filter((event) => event.status === "pending");
  const failedEvents = params.autopilotEvents.filter((event) => event.status === "failed");
  const executedEvents = params.autopilotEvents.filter((event) => event.status === "executed");
  const readyIntegrations = params.integrations.filter((integration) => integration.status === "ready");
  const staleMemories = params.memories.filter((record) => getMemoryFreshness(record, freshnessNow) !== "fresh");
  const learnedMemories = params.memories.filter((record) => record.source !== "project-default");
  const respondedApprovals = params.approvals.filter((approval) => approval.decision !== "pending");
  const tracedApprovalIds = new Set(params.evidenceRecords.map((record) => record.approvalId));
  const tracedApprovals = respondedApprovals.filter((approval) => tracedApprovalIds.has(approval.id));
  const missingEvidenceApprovals = respondedApprovals.filter((approval) => !tracedApprovalIds.has(approval.id));
  const topNowItem = params.nowQueue.items[0] ?? null;
  const firstDiagnosticTarget = params.diagnostics.items[0]?.targets[0] ?? null;
  const recentArtifactSignals = params.latestArtifacts.length > 0 ? 1 : 0;
  const asyncExecution = params.operations?.asyncExecution;
  const connectorHealth = params.operations?.connectorHealth;
  const firstAsyncIssue = asyncExecution?.items[0] ?? null;
  const firstConnectorIssue = connectorHealth?.items[0] ?? null;
  const role = resolveOperatorRole(params);
  const roleView = buildRoleView({
    role,
    activeWorkspace: params.activeWorkspace,
    pendingApprovals,
    nowQueue: params.nowQueue,
    operations: params.operations
  });
  const teamWorkflow = buildTeamWorkflow({
    role,
    activeWorkspace: params.activeWorkspace,
    workspaceMembers: params.workspaceMembers,
    workspaceGovernance: params.workspaceGovernance,
    privacyOperations: params.privacyOperations,
    approvals: params.approvals,
    commitments: params.commitments,
    nowQueue: params.nowQueue,
    operations: params.operations,
    generatedAt: params.diagnostics.generatedAt
  });
  const nextBestAction = buildNextBestAction({
    role,
    activeWorkspace: params.activeWorkspace,
    nowQueue: params.nowQueue,
    approvals: params.approvals,
    operations: params.operations
  });

  const sections: DashboardOperatingSection[] = [
    {
      key: "now",
      title: "Now",
      description:
        params.nowQueue.totalCount > 0
          ? `${pluralize(params.nowQueue.totalCount, "commitment")} are ready for action right now.`
          : "The immediate queue is clear and there is no urgent operator work waiting.",
      status:
        needsReviewCommitments.length > 0
          ? "critical"
          : params.nowQueue.totalCount > 0 || blockedCommitments.length > 0
            ? "attention"
            : "healthy",
      targetSection: "now",
      targetItemId: topNowItem?.commitmentId,
      metrics: [
        `${pluralize(params.nowQueue.totalCount, "ready item")}`,
        `${pluralize(needsReviewCommitments.length, "review gate")}`,
        `${pluralize(blockedCommitments.length, "blocked item")}`
      ],
      highlights: compactHighlights(
        topNowItem ? `Top queue item: ${topNowItem.title}` : null,
        blockedCommitments[0] ? `Blocked: ${blockedCommitments[0].title}` : null,
        params.activeWorkspace ? `Workspace: ${params.activeWorkspace.name}` : null
      )
    },
    {
      key: "automation",
      title: "Automation",
      description:
        failedEvents.length > 0
          ? "Automation needs review because one or more autopilot events failed."
          : pendingEvents.length > 0
            ? "Automation is queued with pending events that still need a bounded decision."
            : "Automation is bounded by workspace policy, watcher coverage, and execution mode.",
      status:
        failedEvents.length > 0
          ? "critical"
          : pendingEvents.length > 0 ||
              activeWatchers.length > 0 ||
              params.autopilotSettings.mode !== "notify_only"
            ? "attention"
            : "healthy",
      targetSection: "autopilot",
      targetItemId: pendingEvents[0]?.id ?? failedEvents[0]?.id,
      metrics: [
        `Mode ${params.autopilotSettings.mode.replaceAll("_", " ")}`,
        `${pluralize(activeWatchers.length, "active watcher")}`,
        `${pluralize(failedEvents.length, "failed event")}`
      ],
      highlights: compactHighlights(
        executedEvents[0] ? `Last executed event: ${executedEvents[0].kind.replaceAll("_", " ")}` : null,
        pendingEvents[0] ? `Pending event: ${pendingEvents[0].kind.replaceAll("_", " ")}` : null,
        activeWatchers[0] ? `Watcher: ${activeWatchers[0].targetEntity}` : null
      )
    },
    {
      key: "execution",
      title: "Execution",
      description:
        firstAsyncIssue
          ? "Async execution needs operator recovery before queued work can be trusted again."
          : blockedTasks.length > 0
          ? `${pluralize(blockedTasks.length, "task")} are blocked or failed inside active goal execution.`
          : activeGoals.length > 0
            ? "Goals are in motion and producing artifacts and action logs that can be audited."
            : "No active goals are currently executing.",
      status:
        asyncExecution?.status === "critical" || blockedTasks.length > 0
          ? "critical"
          : asyncExecution?.status === "attention" || activeGoals.length > 0
            ? "attention"
            : "idle",
      targetSection: firstAsyncIssue ? "operations" : pendingApprovals[0] ? "approvals" : "goals",
      targetItemId: firstAsyncIssue?.id ?? pendingApprovals[0]?.id ?? activeGoals[0]?.goal.id,
      metrics: [
        `${pluralize(activeGoals.length, "active goal")}`,
        `${pluralize(asyncExecution?.issueCount ?? 0, "queue issue")}`,
        `${pluralize(recentArtifactSignals, "recent artifact")}`
      ],
      highlights: compactHighlights(
        firstAsyncIssue ? firstAsyncIssue.summary : null,
        asyncExecution && asyncExecution.stalePendingCount > 0
          ? `${pluralize(asyncExecution.stalePendingCount, "stale pending job")} breached the queue age threshold`
          : null,
        blockedTasks[0] ? `Blocked task: ${blockedTasks[0].title}` : null,
        params.latestArtifacts[0] ? `Latest artifact: ${params.latestArtifacts[0].title}` : null,
        params.actionLogs[0] ? `Latest action: ${params.actionLogs[0].kind}` : null
      )
    },
    {
      key: "trust",
      title: "Trust",
      description:
        firstConnectorIssue
          ? "Connector health degraded and should be recovered before widening automation."
          : params.diagnostics.totalCount > 0
          ? `${pluralize(params.diagnostics.totalCount, "reliability signal")} need review before widening autonomy.`
          : "Trust signals are clean: no active reliability findings are currently open.",
      status: maxSectionStatus(
        toAttentionStatus(params.diagnostics.status),
        connectorHealth?.status === "critical"
          ? "critical"
          : connectorHealth?.status === "attention"
            ? "attention"
            : "healthy"
      ),
      targetSection:
        firstConnectorIssue
          ? "operations"
          : firstDiagnosticTarget?.section ?? (pendingApprovals[0] ? "approvals" : "memory"),
      targetItemId: firstConnectorIssue?.id ?? firstDiagnosticTarget?.itemId ?? pendingApprovals[0]?.id,
      metrics: [
        `${pluralize(params.diagnostics.totalCount, "reliability signal")}`,
        `${pluralize(staleMemories.length, "stale memory")}`,
        respondedApprovals.length > 0
          ? `${tracedApprovals.length}/${respondedApprovals.length} approvals traced`
          : `${pluralize(pendingApprovals.length, "pending approval")}`
      ],
      highlights: compactHighlights(
        firstConnectorIssue ? firstConnectorIssue.summary : firstDiagnosticTarget ? `Investigate: ${firstDiagnosticTarget.label}` : null,
        connectorHealth && connectorHealth.refreshFailedCount > 0
          ? `${pluralize(connectorHealth.refreshFailedCount, "refresh failure")} need credential repair`
          : null,
        params.workspaceGovernance ? `Max auto ${params.workspaceGovernance.maxAutoRunRiskClass}` : null,
        missingEvidenceApprovals[0] ? `Missing evidence: ${missingEvidenceApprovals[0].title}` : null,
        pendingApprovals[0] ? `Pending approval: ${pendingApprovals[0].title}` : null
      )
    },
    {
      key: "build",
      title: "Build",
      description:
        readyIntegrations.length > 0 || activeWatchers.length > 0
          ? "Integrations, watchers, and memory coverage define how repeatable this control plane can become."
          : "Connect systems and watchers before treating this workspace like a durable operating surface.",
      status:
        readyIntegrations.length === 0 && activeWatchers.length === 0
          ? "attention"
          : params.activeWorkspace
            ? "healthy"
            : "idle",
      targetSection: readyIntegrations.length > 0 ? "integrations" : activeWatchers.length > 0 ? "watchers" : "workspaces",
      targetItemId: activeWatchers[0]?.id,
      metrics: [
        `${pluralize(readyIntegrations.length, "ready integration")}`,
        `${pluralize(activeWatchers.length, "active watcher")}`,
        `${pluralize(learnedMemories.length, "memory")}`
      ],
      highlights: compactHighlights(
        readyIntegrations[0] ? `Connected: ${readyIntegrations[0].name}` : null,
        activeWatchers[0] ? `Signal source: ${activeWatchers[0].targetEntity}` : null,
        params.workspaceMembers.length > 0 ? `${pluralize(params.workspaceMembers.length, "workspace member")}` : null
      )
    }
  ];

  return {
    generatedAt: params.diagnostics.generatedAt,
    roleView,
    teamWorkflow,
    nextBestAction,
    sections
  };
}
