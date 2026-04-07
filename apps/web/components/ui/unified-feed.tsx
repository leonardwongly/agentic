"use client";

import { useMemo } from "react";
import type { ApprovalRequest, Artifact, GoalBundle, ActionLog } from "@agentic/contracts";

type FeedItemType = "approval" | "goal" | "artifact" | "insight" | "alert";

type FeedItem = {
  id: string;
  type: FeedItemType;
  priority: number; // 1-10, higher is more urgent
  title: string;
  subtitle: string;
  timestamp: string;
  status?: string;
  riskClass?: string;
  data: unknown;
  actions?: FeedAction[];
};

type FeedAction = {
  id: string;
  label: string;
  variant?: "primary" | "secondary" | "danger";
  handler: () => void;
};

type UnifiedFeedProps = {
  items: FeedItem[];
  onAction?: (itemId: string, actionId: string) => void;
  maxItems?: number;
  emptyMessage?: string;
};

export function UnifiedFeed({
  items,
  onAction,
  maxItems = 10,
  emptyMessage = "Nothing needs your attention right now."
}: UnifiedFeedProps) {
  const sortedItems = useMemo(() => {
    return [...items]
      .sort((a, b) => {
        // Sort by priority first (higher first)
        if (b.priority !== a.priority) {
          return b.priority - a.priority;
        }
        // Then by timestamp (newer first)
        return new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime();
      })
      .slice(0, maxItems);
  }, [items, maxItems]);

  if (sortedItems.length === 0) {
    return (
      <div className="unified-feed-empty">
        <span className="unified-feed-empty-icon">✓</span>
        <p>{emptyMessage}</p>
      </div>
    );
  }

  return (
    <div className="unified-feed">
      {sortedItems.map((item) => (
        <FeedItemCard
          key={item.id}
          item={item}
          onAction={(actionId) => onAction?.(item.id, actionId)}
        />
      ))}
    </div>
  );
}

type FeedItemCardProps = {
  item: FeedItem;
  onAction?: (actionId: string) => void;
};

function FeedItemCard({ item, onAction }: FeedItemCardProps) {
  const urgencyClass = item.priority >= 8 ? "urgent" : item.priority >= 5 ? "important" : "normal";
  const typeIcons: Record<FeedItemType, string> = {
    approval: "🔐",
    goal: "🎯",
    artifact: "📄",
    insight: "💡",
    alert: "⚠️"
  };

  const relativeTime = formatRelativeTime(item.timestamp);

  return (
    <div className={`feed-item feed-item-${item.type} feed-item-${urgencyClass}`}>
      <div className="feed-item-icon">{typeIcons[item.type]}</div>
      <div className="feed-item-content">
        <div className="feed-item-header">
          <strong className="feed-item-title">{item.title}</strong>
          {item.riskClass && (
            <span className={`feed-item-risk feed-item-risk-${item.riskClass}`}>
              {item.riskClass}
            </span>
          )}
          {item.status && (
            <span className={`feed-item-status feed-item-status-${item.status}`}>
              {item.status}
            </span>
          )}
        </div>
        <p className="feed-item-subtitle">{item.subtitle}</p>
        <span className="feed-item-time">{relativeTime}</span>
      </div>
      {item.actions && item.actions.length > 0 && (
        <div className="feed-item-actions">
          {item.actions.map((action) => (
            <button
              key={action.id}
              type="button"
              className={`feed-action feed-action-${action.variant || "secondary"}`}
              onClick={() => onAction?.(action.id)}
            >
              {action.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function formatRelativeTime(timestamp: string): string {
  const date = new Date(timestamp);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMins = Math.floor(diffMs / 60000);

  if (diffMins < 1) return "just now";
  if (diffMins < 60) return `${diffMins} min`;
  const diffHours = Math.floor(diffMins / 60);
  if (diffHours < 24) return `${diffHours}h`;
  const diffDays = Math.floor(diffHours / 24);
  return `${diffDays}d`;
}

type UseUnifiedFeedOptions = {
  goals: GoalBundle[];
  approvals: ApprovalRequest[];
  artifacts: Artifact[];
  actionLogs: ActionLog[];
  onApprove: (id: string) => void;
  onReject: (id: string) => void;
  onViewGoal: (id: string) => void;
  onViewArtifact: (id: string) => void;
};

export function useUnifiedFeed({
  goals,
  approvals,
  artifacts,
  actionLogs,
  onApprove,
  onReject,
  onViewGoal,
  onViewArtifact
}: UseUnifiedFeedOptions): FeedItem[] {
  return useMemo(() => {
    const items: FeedItem[] = [];

    // Add pending approvals with high priority
    for (const approval of approvals.filter((a) => a.decision === "pending")) {
      const riskPriority: Record<string, number> = {
        R4: 10,
        R3: 8,
        R2: 5,
        R1: 3
      };
      items.push({
        id: `approval-${approval.id}`,
        type: "approval",
        priority: riskPriority[approval.riskClass] || 5,
        title: approval.title,
        subtitle: approval.rationale,
        timestamp: approval.createdAt,
        riskClass: approval.riskClass,
        data: approval,
        actions: [
          { id: "approve", label: "Approve", variant: "primary", handler: () => onApprove(approval.id) },
          { id: "reject", label: "Reject", variant: "secondary", handler: () => onReject(approval.id) }
        ]
      });
    }

    // Add active goals
    for (const bundle of goals.filter((g) => g.goal.status !== "completed")) {
      items.push({
        id: `goal-${bundle.goal.id}`,
        type: "goal",
        priority: bundle.goal.status === "running" ? 6 : 4,
        title: bundle.goal.title,
        subtitle: bundle.goal.explanation,
        timestamp: bundle.goal.updatedAt,
        status: bundle.goal.status,
        data: bundle,
        actions: [
          { id: "view", label: "View", variant: "secondary", handler: () => onViewGoal(bundle.goal.id) }
        ]
      });
    }

    // Add recent artifacts (last 3)
    for (const artifact of artifacts.slice(0, 3)) {
      items.push({
        id: `artifact-${artifact.id}`,
        type: "artifact",
        priority: 3,
        title: artifact.title,
        subtitle: artifact.content.slice(0, 100) + (artifact.content.length > 100 ? "..." : ""),
        timestamp: artifact.createdAt,
        status: artifact.artifactType,
        data: artifact,
        actions: [
          { id: "view", label: "View", variant: "secondary", handler: () => onViewArtifact(artifact.id) }
        ]
      });
    }

    // Detect insights from recent activity
    const recentLogs = actionLogs.filter((log) => {
      const logDate = new Date(log.createdAt);
      const hourAgo = new Date(Date.now() - 60 * 60 * 1000);
      return logDate > hourAgo;
    });

    // Add insight if many approvals recently
    const recentApprovals = recentLogs.filter((l) => l.kind.includes("approval"));
    if (recentApprovals.length >= 5) {
      items.push({
        id: "insight-high-activity",
        type: "insight",
        priority: 4,
        title: "High approval activity",
        subtitle: `${recentApprovals.length} approvals processed in the last hour`,
        timestamp: new Date().toISOString(),
        data: { type: "activity-spike", count: recentApprovals.length }
      });
    }

    return items;
  }, [goals, approvals, artifacts, actionLogs, onApprove, onReject, onViewGoal, onViewArtifact]);
}
