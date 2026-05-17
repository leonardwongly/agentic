"use client";

import type { CommitmentInboxBucket } from "@agentic/contracts";
import type { DashboardData, DashboardDiagnosticTarget } from "@agentic/repository";
import { buildOperatorPriorityModel, type OperatorPrioritySeverity } from "../lib/operator-priority-model";
import { RiskBadge, SlideOutPanel, StatusBadge } from "./ui";

export type DashboardDetailSelection = {
  kind: "goal" | "approval" | "job" | "connector" | "memory" | "watcher" | "artifact" | "diagnostic" | "workspace";
  title: string;
  summary: string;
  metadata: string[];
  targetSection: string;
  targetItemId?: string;
  targetFilter?: CommitmentInboxBucket | null;
};

type DashboardCockpitLanesProps = {
  data: DashboardData;
  openView: (section: string, itemId?: string, filter?: CommitmentInboxBucket | null) => void;
  openDiagnosticTarget: (target: DashboardDiagnosticTarget) => void;
  openDetail: (detail: DashboardDetailSelection) => void;
};

type DashboardDetailDrawerProps = {
  detail: DashboardDetailSelection | null;
  onClose: () => void;
  openView: (section: string, itemId?: string, filter?: CommitmentInboxBucket | null) => void;
};

type CockpitLane = {
  key: string;
  title: string;
  status: "healthy" | "attention" | "critical" | "idle";
  summary: string;
  metrics: string[];
  targetSection: string;
  targetItemId?: string;
  targetFilter?: CommitmentInboxBucket | null;
  detail: DashboardDetailSelection;
};

function formatCount(count: number, singular: string, plural = `${singular}s`) {
  return `${count} ${count === 1 ? singular : plural}`;
}

function buildFreshnessLabel(generatedAt: string): { status: "healthy" | "attention" | "critical"; label: string } {
  const ageMs = Date.now() - Date.parse(generatedAt);
  if (!Number.isFinite(ageMs) || ageMs < 0) {
    return { status: "attention", label: "Freshness unknown" };
  }

  const ageMinutes = Math.round(ageMs / 60_000);
  if (ageMinutes <= 2) {
    return { status: "healthy", label: "Live snapshot" };
  }
  if (ageMinutes <= 10) {
    return { status: "attention", label: `${ageMinutes}m old` };
  }
  return { status: "critical", label: `${ageMinutes}m old` };
}

function highestSeverityDiagnostic(data: DashboardData) {
  return (
    data.diagnostics.items.find((item) => item.severity === "critical") ??
    data.diagnostics.items.find((item) => item.severity === "warning") ??
    null
  );
}

function buildApprovalRiskMetrics(data: DashboardData) {
  const pendingApprovals = data.approvals.filter((approval) => approval.decision === "pending");
  const riskCounts = pendingApprovals.reduce<Record<string, number>>((counts, approval) => {
    counts[approval.riskClass] = (counts[approval.riskClass] ?? 0) + 1;
    return counts;
  }, {});

  return {
    pendingApprovals,
    metrics: ["R4", "R3", "R2", "R1"].map((riskClass) => `${riskClass}: ${riskCounts[riskClass] ?? 0}`)
  };
}

function priorityStatus(severity: OperatorPrioritySeverity): "healthy" | "attention" | "critical" {
  return severity === "critical" ? "critical" : "attention";
}

function buildCockpitLanes(data: DashboardData): CockpitLane[] {
  const urgentNowItem = data.nowQueue.items[0] ?? null;
  const { pendingApprovals, metrics: approvalMetrics } = buildApprovalRiskMetrics(data);
  const firstApproval = pendingApprovals[0] ?? null;
  const diagnostic = highestSeverityDiagnostic(data);
  const asyncIssueCount = data.operations?.asyncExecution.issueCount ?? 0;
  const connectorIssueCount = data.operations?.connectorHealth.issueCount ?? 0;
  const staleMemoryCount = data.diagnostics.items.find((item) => item.kind === "stale_memories")?.count ?? 0;
  const freshness = buildFreshnessLabel(data.diagnostics.generatedAt);

  return [
    {
      key: "operate",
      title: "Operate",
      status: data.nowQueue.totalCount > 0 ? "attention" : "healthy",
      summary: urgentNowItem ? urgentNowItem.title : "No immediate queue items are waiting.",
      metrics: [
        formatCount(data.nowQueue.totalCount, "ready item"),
        freshness.label,
        data.operatingSections.nextBestAction.label
      ],
      targetSection: urgentNowItem ? "now" : data.operatingSections.nextBestAction.targetSection,
      targetItemId: urgentNowItem?.commitmentId ?? data.operatingSections.nextBestAction.targetItemId,
      detail: {
        kind: "goal",
        title: urgentNowItem ? urgentNowItem.title : data.operatingSections.nextBestAction.label,
        summary: urgentNowItem ? urgentNowItem.summary : data.operatingSections.nextBestAction.summary,
        metadata: [
          urgentNowItem ? `Urgency: ${urgentNowItem.urgency}` : `Status: ${data.operatingSections.nextBestAction.status}`,
          freshness.label
        ],
        targetSection: urgentNowItem ? "now" : data.operatingSections.nextBestAction.targetSection,
        targetItemId: urgentNowItem?.commitmentId ?? data.operatingSections.nextBestAction.targetItemId
      }
    },
    {
      key: "approve",
      title: "Approve",
      status: pendingApprovals.some((approval) => approval.riskClass === "R4" || approval.riskClass === "R3")
        ? "critical"
        : pendingApprovals.length > 0
          ? "attention"
          : "healthy",
      summary: firstApproval ? firstApproval.title : "No pending approvals.",
      metrics: approvalMetrics,
      targetSection: "approvals",
      targetItemId: firstApproval?.id,
      detail: {
        kind: "approval",
        title: firstApproval ? firstApproval.title : "Approvals clear",
        summary: firstApproval ? firstApproval.rationale : "No approval debt is blocking the operating loop.",
        metadata: firstApproval ? [`Risk: ${firstApproval.riskClass}`, `Requested: ${firstApproval.requestedAction}`] : approvalMetrics,
        targetSection: "approvals",
        targetItemId: firstApproval?.id
      }
    },
    {
      key: "recover",
      title: "Recover",
      status: asyncIssueCount + connectorIssueCount > 0 ? "critical" : "healthy",
      summary: diagnostic ? diagnostic.title : "No recovery blockers are open.",
      metrics: [
        formatCount(asyncIssueCount, "runtime issue"),
        formatCount(connectorIssueCount, "connector issue"),
        diagnostic ? `${diagnostic.count} ${diagnostic.severity}` : "No high-severity diagnostic"
      ],
      targetSection: diagnostic?.targets[0]?.section ?? "operations",
      targetItemId: diagnostic?.targets[0]?.itemId,
      detail: {
        kind: diagnostic?.kind === "connector_degradation" ? "connector" : "diagnostic",
        title: diagnostic ? diagnostic.title : "Recovery clear",
        summary: diagnostic ? diagnostic.reasons[0] ?? "Open diagnostic requires attention." : "Runtime and connector recovery lanes are clear.",
        metadata: diagnostic ? diagnostic.reasons.slice(0, 4) : ["No dead letters", "No degraded connectors"],
        targetSection: diagnostic?.targets[0]?.section ?? "operations",
        targetItemId: diagnostic?.targets[0]?.itemId
      }
    },
    {
      key: "govern",
      title: "Govern",
      status:
        data.governanceConformance?.status === "non_conformant"
          ? "critical"
          : data.governanceConformance?.status === "needs_attention"
            ? "attention"
            : data.activeWorkspace
              ? "healthy"
              : "attention",
      summary: data.activeWorkspace ? data.activeWorkspace.name : "Activate a workspace before widening governance.",
      metrics: [
        data.workspaceGovernance?.approvalMode ?? "setup",
        data.governanceConformance?.status ?? "no conformance report",
        data.workspaceGovernance?.requireAuditExports ? "Audit required" : "Audit optional"
      ],
      targetSection: "governance",
      detail: {
        kind: "workspace",
        title: data.activeWorkspace?.name ?? "Workspace setup",
        summary: data.activeWorkspace?.description || "Workspace activation is required before shared governance is meaningful.",
        metadata: [
          `Approval mode: ${data.workspaceGovernance?.approvalMode ?? "unconfigured"}`,
          `Conformance: ${data.governanceConformance?.status ?? "not evaluated"}`
        ],
        targetSection: "governance"
      }
    },
    {
      key: "build",
      title: "Build",
      status: data.integrations.some((integration) => integration.status === "ready") ? "healthy" : "attention",
      summary: `${formatCount(data.goals.length, "goal")} and ${formatCount(data.watchers.length, "watcher")} in scope.`,
      metrics: [
        formatCount(data.integrations.filter((integration) => integration.status === "ready").length, "ready integration"),
        formatCount(data.watchers.length, "watcher"),
        formatCount(data.goals.length, "goal")
      ],
      targetSection: "operator-products",
      detail: {
        kind: "watcher",
        title: "Build lane",
        summary: "Agents, templates, integrations, and watchers make the operating loop repeatable.",
        metadata: [
          `${data.integrations.length} integrations`,
          `${data.watchers.length} watchers`,
          `${data.goals.length} goals`
        ],
        targetSection: "operator-products"
      }
    },
    {
      key: "learn",
      title: "Learn",
      status: staleMemoryCount > 0 ? "attention" : "healthy",
      summary: data.actionLogs[0]?.message ?? "No recent activity has been captured yet.",
      metrics: [
        formatCount(data.memories.length, "memory", "memories"),
        formatCount(staleMemoryCount, "stale memory", "stale memories"),
        formatCount(data.latestArtifacts.length, "artifact")
      ],
      targetSection: staleMemoryCount > 0 ? "memory" : "artifacts",
      targetItemId: data.latestArtifacts[0]?.id,
      detail: {
        kind: data.latestArtifacts[0] ? "artifact" : "memory",
        title: data.latestArtifacts[0]?.title ?? "Memory and provenance",
        summary: data.latestArtifacts[0]?.content.slice(0, 180) ?? "Memory, artifacts, and action logs are the learning substrate.",
        metadata: [
          `${data.memories.length} memories`,
          `${data.latestArtifacts.length} artifacts`,
          `${data.actionLogs.length} action logs`
        ],
        targetSection: staleMemoryCount > 0 ? "memory" : "artifacts",
        targetItemId: data.latestArtifacts[0]?.id
      }
    }
  ];
}

export function DashboardCockpitLanes({ data, openView, openDiagnosticTarget, openDetail }: DashboardCockpitLanesProps) {
  const lanes = buildCockpitLanes(data);
  const diagnostic = highestSeverityDiagnostic(data);
  const freshness = buildFreshnessLabel(data.diagnostics.generatedAt);
  const priorityModel = buildOperatorPriorityModel(data);

  return (
    <article className="card control-plane-card" id="section-operate">
      <div className="card-header">
        <div>
          <h2>Operating cockpit</h2>
          <p className="operator-product-subtitle">Exception-first lanes for immediate operator triage.</p>
        </div>
        <StatusBadge status={freshness.status}>{freshness.label}</StatusBadge>
      </div>

      <section className="diagnostic-item attention" aria-label="Operator priority queue">
        <div className="diagnostic-item-header">
          <strong>Operator priority queue</strong>
          <span className="pill diagnostic-pill attention">
            {priorityModel.priorities.length}/{priorityModel.limits.maxPriorities}
          </span>
        </div>
        {priorityModel.priorities.length > 0 ? (
          <div className="control-plane-detail-grid compact" data-testid="operator-priority-model">
            {priorityModel.priorities.slice(0, 3).map((priority) => (
              <button
                key={priority.id}
                type="button"
                className="control-plane-detail-card"
                onClick={() => openView(priority.targetSection, priority.targetItemId)}
                aria-label={`Priority ${priority.rank}: ${priority.title}`}
              >
                <div className="control-plane-section-header">
                  <div>
                    <strong>{priority.rank}. {priority.title}</strong>
                    <p>{priority.summary}</p>
                  </div>
                  <StatusBadge status={priorityStatus(priority.severity)}>{priority.severity}</StatusBadge>
                </div>
                <div className="control-plane-stats">
                  <span className="control-plane-stat">{priority.countLabel}</span>
                  {priority.evidence.slice(0, 2).map((item) => (
                    <span key={`${priority.id}-${item}`} className="control-plane-stat">
                      {item}
                    </span>
                  ))}
                </div>
                {priority.recoveryActions[0] ? (
                  <span className="command-center-priority-action">{priority.recoveryActions[0].label}</span>
                ) : null}
              </button>
            ))}
          </div>
        ) : (
          <p className="empty-state">No blocking operator priorities are open. Continue from the operating lanes below.</p>
        )}
      </section>

      {diagnostic ? (
        <div className={`diagnostic-item ${diagnostic.severity}`}>
          <div className="diagnostic-item-header">
            <strong>Latest high-severity diagnostic: {diagnostic.title}</strong>
            <span className={`pill diagnostic-pill ${diagnostic.severity}`}>{diagnostic.count}</span>
          </div>
          <div className="diagnostic-reasons">
            {diagnostic.reasons.slice(0, 2).map((reason) => (
              <p key={reason}>{reason}</p>
            ))}
          </div>
          {diagnostic.targets[0] ? (
            <button type="button" className="secondary-button" onClick={() => openDiagnosticTarget(diagnostic.targets[0]!)}>
              {diagnostic.targets[0].label}
            </button>
          ) : null}
        </div>
      ) : null}

      <div className="control-plane-detail-grid">
        {lanes.map((lane) => (
          <button
            key={lane.key}
            type="button"
            className="control-plane-detail-card"
            onClick={() => openDetail(lane.detail)}
          >
            <div className="control-plane-section-header">
              <div>
                <strong>{lane.title}</strong>
                <p>{lane.summary}</p>
              </div>
              <StatusBadge status={lane.status}>{lane.status}</StatusBadge>
            </div>
            <div className="control-plane-stats">
              {lane.metrics.slice(0, 3).map((metric) => (
                <span key={`${lane.key}-${metric}`} className="control-plane-stat">
                  {metric}
                </span>
              ))}
            </div>
            {lane.key === "approve" && lane.detail.metadata[0]?.startsWith("Risk: ") ? (
              <RiskBadge riskClass={lane.detail.metadata[0].replace("Risk: ", "") as "R1" | "R2" | "R3" | "R4"} />
            ) : null}
          </button>
        ))}
      </div>

      <div className="hero-button-row">
        {lanes.slice(0, 3).map((lane) => (
          <button
            key={`${lane.key}-open`}
            type="button"
            className={lane.status === "critical" ? "primary-button" : "secondary-button"}
            onClick={() => openView(lane.targetSection, lane.targetItemId, lane.targetFilter)}
          >
            Open {lane.title}
          </button>
        ))}
      </div>
    </article>
  );
}

export function DashboardDetailDrawer({ detail, onClose, openView }: DashboardDetailDrawerProps) {
  return (
    <SlideOutPanel
      isOpen={detail !== null}
      onClose={onClose}
      title={detail?.title ?? "Detail"}
      subtitle={detail ? `${detail.kind} detail` : undefined}
      width="lg"
      footer={
        detail ? (
          <button
            type="button"
            className="primary-button"
            onClick={() => {
              openView(detail.targetSection, detail.targetItemId, detail.targetFilter);
              onClose();
            }}
          >
            Open surface
          </button>
        ) : null
      }
    >
      {detail ? (
        <div className="list-stack">
          <p>{detail.summary}</p>
          <div className="control-plane-stats">
            {detail.metadata.map((item) => (
              <span key={item} className="control-plane-stat">
                {item}
              </span>
            ))}
          </div>
          {detail.targetItemId ? (
            <p className="detail-list-summary">
              Target item <code>{detail.targetItemId}</code>
            </p>
          ) : null}
        </div>
      ) : null}
    </SlideOutPanel>
  );
}
