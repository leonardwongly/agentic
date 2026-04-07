"use client";

import { useMemo } from "react";
import type { AgentMetrics } from "@agentic/contracts";

type AgentMetricsDisplayProps = {
  metrics: AgentMetrics;
  comparisonMetrics?: AgentMetrics;
};

function formatPercent(value: number): string {
  return `${Math.round(value * 100)}%`;
}

function formatDuration(ms: number): string {
  if (ms < 1000) return `${Math.round(ms)}ms`;
  if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
  return `${(ms / 60000).toFixed(1)}m`;
}

function formatNumber(value: number): string {
  if (value >= 1000000) return `${(value / 1000000).toFixed(1)}M`;
  if (value >= 1000) return `${(value / 1000).toFixed(1)}K`;
  return value.toString();
}

function getChangeIndicator(current: number, previous: number): { direction: "up" | "down" | "same"; value: string } {
  if (previous === 0) return { direction: "same", value: "—" };
  const change = ((current - previous) / previous) * 100;
  if (Math.abs(change) < 1) return { direction: "same", value: "—" };
  return {
    direction: change > 0 ? "up" : "down",
    value: `${change > 0 ? "+" : ""}${change.toFixed(1)}%`
  };
}

type MetricCardProps = {
  label: string;
  value: string;
  previousValue?: number;
  currentValue?: number;
  positiveIsGood?: boolean;
  subtitle?: string;
};

function MetricCard({ label, value, previousValue, currentValue, positiveIsGood = true, subtitle }: MetricCardProps) {
  const change = previousValue !== undefined && currentValue !== undefined
    ? getChangeIndicator(currentValue, previousValue)
    : null;

  const changeColor = change
    ? change.direction === "same"
      ? "var(--color-text-muted, #888)"
      : (change.direction === "up" && positiveIsGood) || (change.direction === "down" && !positiveIsGood)
        ? "var(--color-success, #22c55e)"
        : "var(--color-error, #ef4444)"
    : undefined;

  return (
    <div className="metric-card">
      <div className="metric-value">{value}</div>
      <div className="metric-label">{label}</div>
      {change && (
        <div className="metric-change" style={{ color: changeColor }}>
          {change.direction === "up" ? "↑" : change.direction === "down" ? "↓" : ""}
          {change.value}
        </div>
      )}
      {subtitle && <div className="metric-subtitle">{subtitle}</div>}

      <style jsx>{`
        .metric-card {
          background: var(--color-surface, #1e1e1e);
          border: 1px solid var(--color-border, #333);
          border-radius: 8px;
          padding: 16px;
          text-align: center;
        }

        .metric-value {
          font-size: 28px;
          font-weight: 600;
          color: var(--color-text, #fff);
          line-height: 1.2;
        }

        .metric-label {
          font-size: 11px;
          color: var(--color-text-muted, #888);
          text-transform: uppercase;
          margin-top: 4px;
        }

        .metric-change {
          font-size: 12px;
          margin-top: 8px;
          font-weight: 500;
        }

        .metric-subtitle {
          font-size: 11px;
          color: var(--color-text-muted, #888);
          margin-top: 4px;
        }
      `}</style>
    </div>
  );
}

type SimpleBarChartProps = {
  data: { label: string; value: number; color?: string }[];
  maxValue?: number;
};

function SimpleBarChart({ data, maxValue }: SimpleBarChartProps) {
  const max = maxValue ?? Math.max(...data.map((d) => d.value), 1);

  return (
    <div className="bar-chart">
      {data.map((item) => (
        <div key={item.label} className="bar-row">
          <span className="bar-label">{item.label}</span>
          <div className="bar-container">
            <div
              className="bar-fill"
              style={{
                width: `${(item.value / max) * 100}%`,
                backgroundColor: item.color ?? "var(--color-primary, #0ea5e9)"
              }}
            />
          </div>
          <span className="bar-value">{formatNumber(item.value)}</span>
        </div>
      ))}

      <style jsx>{`
        .bar-chart {
          display: flex;
          flex-direction: column;
          gap: 8px;
        }

        .bar-row {
          display: flex;
          align-items: center;
          gap: 12px;
        }

        .bar-label {
          width: 80px;
          font-size: 12px;
          color: var(--color-text-secondary, #aaa);
          text-align: right;
        }

        .bar-container {
          flex: 1;
          height: 12px;
          background: var(--color-surface-secondary, #2a2a2a);
          border-radius: 6px;
          overflow: hidden;
        }

        .bar-fill {
          height: 100%;
          border-radius: 6px;
          transition: width 0.3s ease;
        }

        .bar-value {
          width: 50px;
          font-size: 12px;
          color: var(--color-text, #fff);
        }
      `}</style>
    </div>
  );
}

export function AgentMetricsDisplay({ metrics, comparisonMetrics }: AgentMetricsDisplayProps) {
  const taskBreakdown = useMemo(() => [
    { label: "Completed", value: metrics.tasksCompleted, color: "var(--color-success, #22c55e)" },
    { label: "Failed", value: metrics.tasksFailed, color: "var(--color-error, #ef4444)" },
    { label: "Blocked", value: metrics.tasksBlocked, color: "var(--color-warning, #eab308)" }
  ], [metrics]);

  const approvalBreakdown = useMemo(() => [
    { label: "Approved", value: metrics.approvalsApproved, color: "var(--color-success, #22c55e)" },
    { label: "Rejected", value: metrics.approvalsRejected, color: "var(--color-error, #ef4444)" },
    { label: "Requested", value: metrics.approvalsRequested, color: "var(--color-info, #3b82f6)" }
  ], [metrics]);

  const artifactBreakdown = useMemo(() => {
    return Object.entries(metrics.artifactsByType).map(([type, count]) => ({
      label: type,
      value: count,
      color: "var(--color-primary, #0ea5e9)"
    }));
  }, [metrics]);

  return (
    <div className="metrics-display">
      <div className="metrics-header">
        <h3>Performance Metrics</h3>
        <span className="metrics-period">
          {metrics.period === "all" ? "All Time" : `Last ${metrics.period}`}
        </span>
      </div>

      <div className="metrics-grid">
        <MetricCard
          label="Total Tasks"
          value={formatNumber(metrics.tasksTotal)}
          currentValue={metrics.tasksTotal}
          previousValue={comparisonMetrics?.tasksTotal}
        />
        <MetricCard
          label="Success Rate"
          value={formatPercent(metrics.successRate)}
          currentValue={metrics.successRate}
          previousValue={comparisonMetrics?.successRate}
        />
        <MetricCard
          label="Approval Rate"
          value={formatPercent(metrics.approvalRate)}
          currentValue={metrics.approvalRate}
          previousValue={comparisonMetrics?.approvalRate}
        />
        <MetricCard
          label="Avg Duration"
          value={formatDuration(metrics.averageExecutionTimeMs)}
          currentValue={metrics.averageExecutionTimeMs}
          previousValue={comparisonMetrics?.averageExecutionTimeMs}
          positiveIsGood={false}
        />
        <MetricCard
          label="Avg Confidence"
          value={formatPercent(metrics.averageConfidence)}
          currentValue={metrics.averageConfidence}
          previousValue={comparisonMetrics?.averageConfidence}
        />
        <MetricCard
          label="Artifacts"
          value={formatNumber(metrics.artifactsProduced)}
          currentValue={metrics.artifactsProduced}
          previousValue={comparisonMetrics?.artifactsProduced}
        />
      </div>

      <div className="metrics-sections">
        <section className="metrics-section">
          <h4>Task Breakdown</h4>
          <SimpleBarChart data={taskBreakdown} maxValue={metrics.tasksTotal || 1} />
        </section>

        <section className="metrics-section">
          <h4>Approval Breakdown</h4>
          <SimpleBarChart data={approvalBreakdown} maxValue={metrics.approvalsRequested || 1} />
        </section>

        {artifactBreakdown.length > 0 && (
          <section className="metrics-section">
            <h4>Artifacts by Type</h4>
            <SimpleBarChart data={artifactBreakdown} />
          </section>
        )}

        {metrics.errorCount > 0 && (
          <section className="metrics-section error-section">
            <h4>Errors</h4>
            <div className="error-info">
              <span className="error-count">{metrics.errorCount} errors</span>
              {metrics.lastErrorAt && (
                <span className="last-error">
                  Last: {new Date(metrics.lastErrorAt).toLocaleString()}
                </span>
              )}
              {metrics.lastErrorMessage && (
                <p className="error-message">{metrics.lastErrorMessage}</p>
              )}
            </div>
          </section>
        )}

        {metrics.feedbackCount > 0 && metrics.averageRating !== null && (
          <section className="metrics-section">
            <h4>User Feedback</h4>
            <div className="feedback-info">
              <span className="rating">
                {"★".repeat(Math.round(metrics.averageRating / 2))}
                {"☆".repeat(5 - Math.round(metrics.averageRating / 2))}
              </span>
              <span className="feedback-count">
                {metrics.averageRating.toFixed(1)}/10 from {metrics.feedbackCount} ratings
              </span>
            </div>
          </section>
        )}
      </div>

      <style jsx>{`
        .metrics-display {
          display: flex;
          flex-direction: column;
          gap: 24px;
        }

        .metrics-header {
          display: flex;
          justify-content: space-between;
          align-items: center;
        }

        .metrics-header h3 {
          margin: 0;
          font-size: 16px;
          color: var(--color-text, #fff);
        }

        .metrics-period {
          font-size: 12px;
          padding: 4px 10px;
          background: var(--color-surface, #1e1e1e);
          border-radius: 12px;
          color: var(--color-text-muted, #888);
        }

        .metrics-grid {
          display: grid;
          grid-template-columns: repeat(auto-fill, minmax(140px, 1fr));
          gap: 12px;
        }

        .metrics-sections {
          display: flex;
          flex-direction: column;
          gap: 24px;
        }

        .metrics-section {
          background: var(--color-surface, #1e1e1e);
          border: 1px solid var(--color-border, #333);
          border-radius: 8px;
          padding: 16px;
        }

        .metrics-section h4 {
          margin: 0 0 16px;
          font-size: 13px;
          color: var(--color-text-secondary, #aaa);
        }

        .error-section {
          border-color: var(--color-error, #ef4444);
        }

        .error-info {
          display: flex;
          flex-direction: column;
          gap: 8px;
        }

        .error-count {
          font-size: 14px;
          color: var(--color-error, #ef4444);
          font-weight: 500;
        }

        .last-error {
          font-size: 12px;
          color: var(--color-text-muted, #888);
        }

        .error-message {
          margin: 0;
          font-size: 12px;
          color: var(--color-text-secondary, #aaa);
          padding: 8px;
          background: rgba(239, 68, 68, 0.1);
          border-radius: 4px;
        }

        .feedback-info {
          display: flex;
          align-items: center;
          gap: 12px;
        }

        .rating {
          font-size: 18px;
          color: var(--color-warning, #eab308);
        }

        .feedback-count {
          font-size: 13px;
          color: var(--color-text-secondary, #aaa);
        }
      `}</style>
    </div>
  );
}
