"use client";

import { useMemo, type ReactNode } from "react";
import type { AgentMetrics } from "@agentic/contracts";

// Agent health indicators: Traffic light based on recent metrics

export type HealthStatus = "healthy" | "degraded" | "failing" | "unknown";

export type AgentHealthData = {
  status: HealthStatus;
  score: number; // 0-100
  issues: string[];
  lastCheck: Date;
};

export function calculateAgentHealth(metrics: AgentMetrics | null | undefined): AgentHealthData {
  if (!metrics) {
    return {
      status: "unknown",
      score: 0,
      issues: ["No metrics available"],
      lastCheck: new Date()
    };
  }

  const issues: string[] = [];
  let score = 100;

  // Check success rate using tasks
  const totalTasks = metrics.tasksTotal;
  const successRate = totalTasks > 0 ? metrics.tasksCompleted / totalTasks : 1;
  if (successRate < 0.5) {
    score -= 40;
    issues.push(`Low success rate: ${Math.round(successRate * 100)}%`);
  } else if (successRate < 0.8) {
    score -= 20;
    issues.push(`Below target success rate: ${Math.round(successRate * 100)}%`);
  }

  // Check average latency
  if (metrics.averageExecutionTimeMs > 30000) {
    score -= 30;
    issues.push(`High latency: ${Math.round(metrics.averageExecutionTimeMs / 1000)}s`);
  } else if (metrics.averageExecutionTimeMs > 10000) {
    score -= 15;
    issues.push(`Elevated latency: ${Math.round(metrics.averageExecutionTimeMs / 1000)}s`);
  }

  // Check recent activity
  const lastRunAge = Date.now() - new Date(metrics.updatedAt).getTime();
  const oneDay = 24 * 60 * 60 * 1000;
  if (lastRunAge > 7 * oneDay) {
    score -= 10;
    issues.push("No recent activity (7+ days)");
  }

  // Check error rate
  const errorRate = totalTasks > 0 ? metrics.tasksFailed / totalTasks : 0;
  if (errorRate > 0.3) {
    score -= 20;
    issues.push(`High error rate: ${Math.round(errorRate * 100)}%`);
  }

  // Determine status
  let status: HealthStatus;
  if (score >= 80) status = "healthy";
  else if (score >= 50) status = "degraded";
  else status = "failing";

  return {
    status,
    score: Math.max(0, score),
    issues,
    lastCheck: new Date()
  };
}

// Health indicator badge
type HealthIndicatorProps = {
  health: AgentHealthData;
  size?: "sm" | "md" | "lg";
  showScore?: boolean;
  showTooltip?: boolean;
};

export function HealthIndicator({ health, size = "md", showScore = false, showTooltip = true }: HealthIndicatorProps) {
  const colors: Record<HealthStatus, string> = {
    healthy: "var(--color-success, #22c55e)",
    degraded: "var(--color-warning, #eab308)",
    failing: "var(--color-danger, #ef4444)",
    unknown: "var(--color-muted, #9ca3af)"
  };

  const sizes = {
    sm: 8,
    md: 12,
    lg: 16
  };

  const labels: Record<HealthStatus, string> = {
    healthy: "Healthy",
    degraded: "Degraded",
    failing: "Failing",
    unknown: "Unknown"
  };

  return (
    <span
      className={`health-indicator health-${health.status}`}
      title={showTooltip ? `${labels[health.status]}${health.issues.length > 0 ? `: ${health.issues[0]}` : ""}` : undefined}
      aria-label={labels[health.status]}
    >
      <span
        className="health-dot"
        style={{
          width: sizes[size],
          height: sizes[size],
          backgroundColor: colors[health.status],
          borderRadius: "50%",
          display: "inline-block",
          animation: health.status === "failing" ? "pulse 1s infinite" : undefined
        }}
      />
      {showScore && <span className="health-score">{health.score}%</span>}
    </span>
  );
}

// Detailed health card
type HealthCardProps = {
  agentName: string;
  health: AgentHealthData;
  onViewDetails?: () => void;
};

export function HealthCard({ agentName, health, onViewDetails }: HealthCardProps) {
  const statusEmoji: Record<HealthStatus, string> = {
    healthy: "🟢",
    degraded: "🟡",
    failing: "🔴",
    unknown: "⚪"
  };

  return (
    <div className={`health-card health-card-${health.status}`}>
      <div className="health-card-header">
        <span className="health-card-emoji">{statusEmoji[health.status]}</span>
        <span className="health-card-name">{agentName}</span>
        <span className="health-card-score">{health.score}%</span>
      </div>
      {health.issues.length > 0 && (
        <ul className="health-card-issues">
          {health.issues.slice(0, 3).map((issue, i) => (
            <li key={i}>{issue}</li>
          ))}
        </ul>
      )}
      {onViewDetails && (
        <button type="button" className="health-card-action" onClick={onViewDetails}>
          View details
        </button>
      )}
    </div>
  );
}

// Health summary for all agents
type HealthSummaryProps = {
  agents: Array<{ id: string; name: string; metrics: AgentMetrics | null }>;
};

export function HealthSummary({ agents }: HealthSummaryProps) {
  const summary = useMemo(() => {
    const counts = { healthy: 0, degraded: 0, failing: 0, unknown: 0 };
    for (const agent of agents) {
      const health = calculateAgentHealth(agent.metrics);
      counts[health.status]++;
    }
    return counts;
  }, [agents]);

  const total = agents.length;
  const healthyPercent = total > 0 ? Math.round((summary.healthy / total) * 100) : 0;

  return (
    <div className="health-summary">
      <div className="health-summary-bar">
        {summary.healthy > 0 && (
          <div
            className="health-bar-segment healthy"
            style={{ width: `${(summary.healthy / total) * 100}%` }}
            title={`${summary.healthy} healthy`}
          />
        )}
        {summary.degraded > 0 && (
          <div
            className="health-bar-segment degraded"
            style={{ width: `${(summary.degraded / total) * 100}%` }}
            title={`${summary.degraded} degraded`}
          />
        )}
        {summary.failing > 0 && (
          <div
            className="health-bar-segment failing"
            style={{ width: `${(summary.failing / total) * 100}%` }}
            title={`${summary.failing} failing`}
          />
        )}
        {summary.unknown > 0 && (
          <div
            className="health-bar-segment unknown"
            style={{ width: `${(summary.unknown / total) * 100}%` }}
            title={`${summary.unknown} unknown`}
          />
        )}
      </div>
      <div className="health-summary-text">
        <span className="health-summary-percent">{healthyPercent}%</span>
        <span className="health-summary-label">healthy</span>
        {summary.failing > 0 && <span className="health-summary-alert">⚠️ {summary.failing} failing</span>}
      </div>
    </div>
  );
}

// Hook to track health over time
export function useAgentHealth(metrics: AgentMetrics | null | undefined) {
  return useMemo(() => calculateAgentHealth(metrics), [metrics]);
}
