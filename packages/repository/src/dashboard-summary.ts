import type { DashboardData, DashboardDiagnosticSeverity } from "./repository-types";

export type DashboardSummaryLane = {
  key: "operate" | "approve" | "recover" | "govern" | "build" | "learn";
  label: string;
  status: "healthy" | "attention" | "critical" | "idle";
  summary: string;
  targetSection: string;
  targetItemId?: string;
};

export type DashboardSummary = {
  generatedAt: string;
  activeWorkspace: {
    id: string;
    name: string;
    slug: string;
    isPersonal: boolean;
  } | null;
  counts: {
    goals: number;
    pendingApprovals: number;
    commitments: number;
    nowQueue: number;
    memories: number;
    integrations: number;
    artifacts: number;
    activity: number;
    diagnostics: number;
  };
  approvalsByRisk: Record<"R1" | "R2" | "R3" | "R4", number>;
  freshness: {
    generatedAt: string;
    source: "dashboard";
  };
  topDiagnostic: {
    title: string;
    severity: DashboardDiagnosticSeverity;
    count: number;
    targetSection: string | null;
    targetItemId: string | null;
  } | null;
  operations: {
    asyncIssueCount: number;
    connectorIssueCount: number;
    shellStatus: string | null;
  };
  lanes: DashboardSummaryLane[];
};

function formatCount(count: number, singular: string, plural = `${singular}s`) {
  return `${count} ${count === 1 ? singular : plural}`;
}

function resolveSummaryStatus(hasCritical: boolean, hasAttention: boolean): DashboardSummaryLane["status"] {
  if (hasCritical) {
    return "critical";
  }
  if (hasAttention) {
    return "attention";
  }
  return "healthy";
}

export function buildDashboardSummary(data: DashboardData): DashboardSummary {
  const pendingApprovals = data.approvals.filter((approval) => approval.decision === "pending");
  const approvalsByRisk = pendingApprovals.reduce<DashboardSummary["approvalsByRisk"]>(
    (counts, approval) => {
      counts[approval.riskClass] += 1;
      return counts;
    },
    { R1: 0, R2: 0, R3: 0, R4: 0 }
  );
  const topDiagnostic =
    data.diagnostics.items.find((item) => item.severity === "critical") ??
    data.diagnostics.items.find((item) => item.severity === "warning") ??
    null;
  const firstNowItem = data.nowQueue.items[0] ?? null;
  const firstPendingApproval = pendingApprovals[0] ?? null;
  const asyncIssueCount = data.operations?.asyncExecution.issueCount ?? 0;
  const connectorIssueCount = data.operations?.connectorHealth.issueCount ?? 0;
  const staleMemoryCount = data.diagnostics.items.find((item) => item.kind === "stale_memories")?.count ?? 0;

  return {
    generatedAt: data.diagnostics.generatedAt,
    activeWorkspace: data.activeWorkspace
      ? {
          id: data.activeWorkspace.id,
          name: data.activeWorkspace.name,
          slug: data.activeWorkspace.slug,
          isPersonal: data.activeWorkspace.isPersonal
        }
      : null,
    counts: {
      goals: data.goals.length,
      pendingApprovals: pendingApprovals.length,
      commitments: data.commitments.length,
      nowQueue: data.nowQueue.totalCount,
      memories: data.memories.length,
      integrations: data.integrations.length,
      artifacts: data.latestArtifacts.length,
      activity: data.actionLogs.length,
      diagnostics: data.diagnostics.totalCount
    },
    approvalsByRisk,
    freshness: {
      generatedAt: data.diagnostics.generatedAt,
      source: "dashboard"
    },
    topDiagnostic: topDiagnostic
      ? {
          title: topDiagnostic.title,
          severity: topDiagnostic.severity,
          count: topDiagnostic.count,
          targetSection: topDiagnostic.targets[0]?.section ?? null,
          targetItemId: topDiagnostic.targets[0]?.itemId ?? null
        }
      : null,
    operations: {
      asyncIssueCount,
      connectorIssueCount,
      shellStatus: data.operations?.shellEffectiveness?.status ?? null
    },
    lanes: [
      {
        key: "operate",
        label: "Operate",
        status: data.nowQueue.totalCount > 0 ? "attention" : "healthy",
        summary: firstNowItem?.title ?? "No immediate queue items are waiting.",
        targetSection: "now",
        targetItemId: firstNowItem?.commitmentId
      },
      {
        key: "approve",
        label: "Approve",
        status: resolveSummaryStatus(approvalsByRisk.R4 + approvalsByRisk.R3 > 0, pendingApprovals.length > 0),
        summary: firstPendingApproval?.title ?? "No pending approvals.",
        targetSection: "approvals",
        targetItemId: firstPendingApproval?.id
      },
      {
        key: "recover",
        label: "Recover",
        status: resolveSummaryStatus(asyncIssueCount + connectorIssueCount > 0, data.diagnostics.totalCount > 0),
        summary: topDiagnostic?.title ?? "No recovery blockers are open.",
        targetSection: topDiagnostic?.targets[0]?.section ?? "operations",
        targetItemId: topDiagnostic?.targets[0]?.itemId
      },
      {
        key: "govern",
        label: "Govern",
        status:
          data.governanceConformance?.status === "non_conformant"
            ? "critical"
            : data.governanceConformance?.status === "needs_attention" || !data.activeWorkspace
              ? "attention"
              : "healthy",
        summary: data.activeWorkspace?.name ?? "Activate a workspace before widening governance.",
        targetSection: "governance"
      },
      {
        key: "build",
        label: "Build",
        status: data.integrations.some((integration) => integration.status === "ready") ? "healthy" : "attention",
        summary: `${formatCount(data.goals.length, "goal")} and ${formatCount(data.watchers.length, "watcher")} in scope.`,
        targetSection: "operator-products"
      },
      {
        key: "learn",
        label: "Learn",
        status: staleMemoryCount > 0 ? "attention" : "healthy",
        summary: data.actionLogs[0]?.message ?? "No recent activity has been captured yet.",
        targetSection: staleMemoryCount > 0 ? "memory" : "artifacts",
        targetItemId: data.latestArtifacts[0]?.id
      }
    ]
  };
}
