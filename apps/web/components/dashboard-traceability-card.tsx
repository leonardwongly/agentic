"use client";

import type {
  DashboardMemoryProvenance,
  DashboardTraceability,
  DashboardWorkflowTrace
} from "@agentic/repository";
import {
  ActionGroup,
  DataTable,
  MetricCard,
  Panel,
  RelativeTime,
  RiskPill,
  SectionHeader,
  StatusPill
} from "./ui";

type DashboardTraceabilityCardProps = {
  traceability: DashboardTraceability;
  openTarget: (section: string, itemId?: string) => void;
};

function freshnessTone(memory: DashboardMemoryProvenance): "healthy" | "attention" | "critical" | "neutral" {
  if (memory.freshness === "expired") {
    return "critical";
  }

  if (memory.reviewRequired || memory.freshness === "review_due" || memory.freshness === "low_confidence") {
    return "attention";
  }

  return "healthy";
}

function workflowTone(trace: DashboardWorkflowTrace): "healthy" | "attention" | "critical" | "idle" {
  if (trace.failureCount > 0) {
    return "critical";
  }

  if (trace.staleMemoryIds.length > 0 || trace.status === "waiting") {
    return "attention";
  }

  return trace.status === "completed" ? "healthy" : "idle";
}

export function DashboardTraceabilityCard({ traceability, openTarget }: DashboardTraceabilityCardProps) {
  const topMemories = traceability.memoryProvenance.slice(0, 6);

  return (
    <Panel
      id="section-provenance"
      title="Traceability"
      subtitle="Scoped task graph, evidence, approvals, artifacts, and memory provenance for the active workspace."
      actions={
        <ActionGroup label="Traceability actions">
          <button type="button" className="secondary-button" onClick={() => openTarget("artifacts")}>
            Open artifacts
          </button>
          <button type="button" className="secondary-button" onClick={() => openTarget("memory")}>
            Open memory
          </button>
        </ActionGroup>
      }
    >
      <div className="ui-metric-grid" aria-label="Traceability summary">
        <MetricCard label="Workflows" value={traceability.workflowTraces.length} detail="scoped to current workspace" status="idle" />
        <MetricCard label="Tasks" value={traceability.taskTraces.length} detail="with assigned agents" status="idle" />
        <MetricCard label="Approvals" value={traceability.approvalTraces.length} detail="linked to evidence" status="idle" />
        <MetricCard
          label="Memory evidence"
          value={traceability.trustLane.scopedMemoryCount}
          detail={`${traceability.trustLane.autonomyEligibleMemoryCount} autonomy eligible`}
          status={traceability.trustLane.staleOrReviewRequiredMemoryCount > 0 ? "attention" : "healthy"}
        />
      </div>

      <SectionHeader
        eyebrow="Trust lane"
        title="Memory provenance"
        subtitle={traceability.trustLane.policy}
      />
      <div className="traceability-memory-list">
        {topMemories.length === 0 ? (
          <div className="traceability-memory-empty">
            <StatusPill label="no linked evidence" tone="idle" />
            <p className="empty-state">No scoped memory records are linked to active workflow evidence yet.</p>
          </div>
        ) : (
          topMemories.map((memory) => (
            <div className="traceability-memory-row" key={memory.id}>
              <div>
                <strong>{memory.category}</strong>
                <p className="detail-list-summary">
                  {memory.source} · {Math.round(memory.confidence * 100)}% confidence · used by {memory.usedByGoalIds.length} workflow
                  {memory.usedByGoalIds.length === 1 ? "" : "s"}
                </p>
              </div>
              <div className="detail-list-badges">
                <StatusPill label={memory.memoryType} tone={memory.advisoryOnly ? "attention" : "healthy"} />
                <StatusPill label={memory.freshness.replaceAll("_", " ")} tone={freshnessTone(memory)} />
                {memory.advisoryOnly ? <RiskPill label="advisory only" tone="attention" /> : null}
              </div>
            </div>
          ))
        )}
      </div>

      <DataTable
        caption="Workflow traceability"
        columns={[
          {
            key: "workflow",
            header: "Workflow",
            render: (trace) => (
              <button
                type="button"
                className="link-button"
                onClick={() => openTarget("goals", trace.goalId)}
              >
                {trace.title}
              </button>
            )
          },
          {
            key: "status",
            header: "Status",
            render: (trace) => <StatusPill label={trace.status} tone={workflowTone(trace)} />
          },
          {
            key: "agents",
            header: "Agents",
            render: (trace) => trace.agents.join(", ") || "Unassigned"
          },
          {
            key: "coverage",
            header: "Evidence",
            render: (trace) =>
              `${trace.taskCount} tasks · ${trace.approvalCount} approvals · ${trace.artifactCount} artifacts · ${trace.memoryIds.length} memories`
          },
          {
            key: "freshness",
            header: "Memory state",
            render: (trace) =>
              trace.staleMemoryIds.length > 0 || trace.inferredMemoryIds.length > 0 ? (
                <div className="detail-list-badges">
                  {trace.staleMemoryIds.length > 0 ? (
                    <RiskPill label={`${trace.staleMemoryIds.length} stale/review`} tone="attention" />
                  ) : null}
                  {trace.inferredMemoryIds.length > 0 ? (
                    <RiskPill label={`${trace.inferredMemoryIds.length} inferred`} tone="attention" />
                  ) : null}
                </div>
              ) : (
                <StatusPill label="fresh linked evidence" tone="healthy" />
              )
          },
          {
            key: "activity",
            header: "Last activity",
            render: (trace) => <RelativeTime date={trace.lastActivityAt} />
          }
        ]}
        rows={traceability.workflowTraces}
        getRowKey={(trace) => trace.goalId}
        emptyLabel="No workflow traces are available for the active workspace."
      />
    </Panel>
  );
}
