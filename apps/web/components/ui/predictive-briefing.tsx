"use client";

import { useState, useEffect, useMemo, useCallback } from "react";
import type { GoalBundle, ApprovalRequest, MemoryRecord } from "@agentic/contracts";

// Predictive Briefings - Time and calendar-aware proactive briefings
// Generates contextual summaries based on time of day and upcoming events

export type BriefingType = "morning" | "midday" | "evening" | "urgent" | "weekly";

export type BriefingSection = {
  id: string;
  title: string;
  icon: string;
  priority: "high" | "medium" | "low";
  items: BriefingItem[];
};

export type BriefingItem = {
  id: string;
  type: "goal" | "approval" | "reminder" | "insight" | "recommendation";
  title: string;
  description: string;
  actionLabel?: string;
  actionUrl?: string;
  metadata?: Record<string, unknown>;
};

export type Briefing = {
  id: string;
  type: BriefingType;
  title: string;
  greeting: string;
  summary: string;
  sections: BriefingSection[];
  generatedAt: string;
  expiresAt: string;
};

type PredictiveBriefingProps = {
  goals: GoalBundle[];
  approvals: ApprovalRequest[];
  memories: MemoryRecord[];
  onAction?: (itemId: string, action: string) => void;
  className?: string;
};

export function PredictiveBriefing({
  goals,
  approvals,
  memories,
  onAction,
  className = ""
}: PredictiveBriefingProps) {
  const [briefing, setBriefing] = useState<Briefing | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isExpanded, setIsExpanded] = useState(true);

  // Generate briefing based on current time and data
  useEffect(() => {
    const briefing = generateBriefing(goals, approvals, memories);
    setBriefing(briefing);
    setIsLoading(false);
  }, [goals, approvals, memories]);

  if (isLoading) {
    return (
      <div className={`predictive-briefing loading ${className}`}>
        <div className="predictive-briefing-skeleton">
          <div className="skeleton-line wide" />
          <div className="skeleton-line medium" />
          <div className="skeleton-line narrow" />
        </div>
      </div>
    );
  }

  if (!briefing) return null;

  return (
    <div className={`predictive-briefing ${className}`}>
      <div className="predictive-briefing-header">
        <div className="predictive-briefing-title-row">
          <span className="predictive-briefing-icon">
            {briefing.type === "morning" && "🌅"}
            {briefing.type === "midday" && "☀️"}
            {briefing.type === "evening" && "🌙"}
            {briefing.type === "urgent" && "⚡"}
            {briefing.type === "weekly" && "📊"}
          </span>
          <h3 className="predictive-briefing-title">{briefing.title}</h3>
          <button
            type="button"
            className="predictive-briefing-toggle"
            onClick={() => setIsExpanded(!isExpanded)}
          >
            {isExpanded ? "▲" : "▼"}
          </button>
        </div>
        <p className="predictive-briefing-greeting">{briefing.greeting}</p>
      </div>

      {isExpanded && (
        <>
          <div className="predictive-briefing-summary">
            <p>{briefing.summary}</p>
          </div>

          <div className="predictive-briefing-sections">
            {briefing.sections.map(section => (
              <div 
                key={section.id} 
                className={`predictive-briefing-section priority-${section.priority}`}
              >
                <div className="predictive-briefing-section-header">
                  <span className="predictive-briefing-section-icon">{section.icon}</span>
                  <h4>{section.title}</h4>
                  <span className="predictive-briefing-section-count">
                    {section.items.length}
                  </span>
                </div>
                <div className="predictive-briefing-items">
                  {section.items.map(item => (
                    <BriefingItemComponent 
                      key={item.id} 
                      item={item} 
                      onAction={onAction}
                    />
                  ))}
                </div>
              </div>
            ))}
          </div>

          <div className="predictive-briefing-footer">
            <span className="predictive-briefing-generated">
              Generated at {new Date(briefing.generatedAt).toLocaleTimeString()}
            </span>
          </div>
        </>
      )}
    </div>
  );
}

function BriefingItemComponent({ 
  item, 
  onAction 
}: { 
  item: BriefingItem; 
  onAction?: (itemId: string, action: string) => void;
}) {
  return (
    <div className={`briefing-item ${item.type}`}>
      <div className="briefing-item-content">
        <span className="briefing-item-title">{item.title}</span>
        <span className="briefing-item-description">{item.description}</span>
      </div>
      {item.actionLabel && onAction && (
        <button
          type="button"
          className="briefing-item-action"
          onClick={() => onAction(item.id, item.actionLabel!)}
        >
          {item.actionLabel}
        </button>
      )}
    </div>
  );
}

function generateBriefing(
  goals: GoalBundle[],
  approvals: ApprovalRequest[],
  memories: MemoryRecord[]
): Briefing {
  const hour = new Date().getHours();
  const type: BriefingType = hour < 12 ? "morning" : hour < 17 ? "midday" : "evening";
  
  const pendingApprovals = approvals.filter(a => a.decision === "pending");
  const activeGoals = goals.filter(g => g.goal.status === "running" || g.goal.status === "planned");
  const completedToday = goals.filter(g => {
    const completed = g.goal.status === "completed";
    const today = new Date().toDateString();
    return completed && new Date(g.goal.updatedAt).toDateString() === today;
  });

  const greetings = {
    morning: "Good morning! Here's what's on your radar today.",
    midday: "Quick midday check-in. Here's where things stand.",
    evening: "End of day summary. Great progress today!"
  };

  const sections: BriefingSection[] = [];

  // Urgent section (pending approvals)
  if (pendingApprovals.length > 0) {
    sections.push({
      id: "urgent",
      title: "Needs Your Attention",
      icon: "⚠️",
      priority: "high",
      items: pendingApprovals.slice(0, 3).map(a => ({
        id: a.id,
        type: "approval",
        title: a.title,
        description: a.requestedAction,
        actionLabel: "Review",
        actionUrl: `/approvals/${a.id}`
      }))
    });
  }

  // Active goals section
  if (activeGoals.length > 0) {
    sections.push({
      id: "active-goals",
      title: "In Progress",
      icon: "🎯",
      priority: "medium",
      items: activeGoals.slice(0, 4).map(g => ({
        id: g.goal.id,
        type: "goal",
        title: g.goal.title,
        description: `${g.tasks.filter(t => t.state === "completed").length}/${g.tasks.length} tasks completed`,
        metadata: { progress: g.tasks.filter(t => t.state === "completed").length / g.tasks.length }
      }))
    });
  }

  // Completed today section
  if (completedToday.length > 0) {
    sections.push({
      id: "completed",
      title: "Completed Today",
      icon: "✅",
      priority: "low",
      items: completedToday.slice(0, 3).map(g => ({
        id: g.goal.id,
        type: "goal",
        title: g.goal.title,
        description: "Successfully completed"
      }))
    });
  }

  // Insights based on patterns
  const recentMemories = memories.filter(m => {
    const created = new Date(m.createdAt);
    const weekAgo = new Date();
    weekAgo.setDate(weekAgo.getDate() - 7);
    return created > weekAgo;
  });

  if (recentMemories.length > 0) {
    sections.push({
      id: "insights",
      title: "Recent Learnings",
      icon: "💡",
      priority: "low",
      items: recentMemories.slice(0, 2).map(m => ({
        id: m.id,
        type: "insight",
        title: m.category,
        description: m.content.slice(0, 100) + (m.content.length > 100 ? "..." : "")
      }))
    });
  }

  // Generate summary
  const summaryParts = [];
  if (pendingApprovals.length > 0) {
    summaryParts.push(`${pendingApprovals.length} approval${pendingApprovals.length > 1 ? "s" : ""} pending`);
  }
  if (activeGoals.length > 0) {
    summaryParts.push(`${activeGoals.length} goal${activeGoals.length > 1 ? "s" : ""} in progress`);
  }
  if (completedToday.length > 0) {
    summaryParts.push(`${completedToday.length} completed today`);
  }

  return {
    id: `briefing-${Date.now()}`,
    type,
    title: type === "morning" ? "Morning Briefing" : type === "midday" ? "Midday Update" : "Evening Summary",
    greeting: greetings[type],
    summary: summaryParts.length > 0 ? summaryParts.join(" • ") : "All caught up! No pressing items.",
    sections,
    generatedAt: new Date().toISOString(),
    expiresAt: new Date(Date.now() + 4 * 60 * 60 * 1000).toISOString() // 4 hours
  };
}

// Hook for managing briefing state
export function usePredictiveBriefing(
  goals: GoalBundle[],
  approvals: ApprovalRequest[],
  memories: MemoryRecord[]
) {
  const [lastGenerated, setLastGenerated] = useState<Date | null>(null);
  const [isDismissed, setIsDismissed] = useState(false);

  const briefing = useMemo(() => {
    return generateBriefing(goals, approvals, memories);
  }, [goals, approvals, memories]);

  const dismiss = useCallback(() => {
    setIsDismissed(true);
  }, []);

  const refresh = useCallback(() => {
    setLastGenerated(new Date());
    setIsDismissed(false);
  }, []);

  const shouldShow = useMemo(() => {
    if (isDismissed) return false;
    if (briefing.sections.length === 0) return false;
    return true;
  }, [isDismissed, briefing]);

  return {
    briefing,
    shouldShow,
    dismiss,
    refresh,
    lastGenerated
  };
}

// Briefing notification for urgent items
export function BriefingNotification({
  briefing,
  onDismiss,
  onView
}: {
  briefing: Briefing;
  onDismiss: () => void;
  onView: () => void;
}) {
  const urgentCount = briefing.sections
    .filter(s => s.priority === "high")
    .reduce((sum, s) => sum + s.items.length, 0);

  if (urgentCount === 0) return null;

  return (
    <div className="briefing-notification">
      <span className="briefing-notification-icon">⚡</span>
      <span className="briefing-notification-text">
        {urgentCount} item{urgentCount > 1 ? "s" : ""} need{urgentCount === 1 ? "s" : ""} your attention
      </span>
      <button type="button" onClick={onView} className="briefing-notification-view">
        View
      </button>
      <button type="button" onClick={onDismiss} className="briefing-notification-dismiss">
        ✕
      </button>
    </div>
  );
}
