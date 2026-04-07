"use client";

import type { AgentDefinition } from "@agentic/contracts";

type AgentCardProps = {
  agent: AgentDefinition;
  onSelect: (agent: AgentDefinition) => void;
  onClone?: (agent: AgentDefinition) => void;
  isSelected?: boolean;
};

function getStatusColor(status: AgentDefinition["status"]): string {
  switch (status) {
    case "active":
      return "var(--color-success, #22c55e)";
    case "paused":
      return "var(--color-warning, #eab308)";
    case "archived":
      return "var(--color-muted, #6b7280)";
    case "draft":
      return "var(--color-info, #3b82f6)";
    default:
      return "var(--color-muted, #6b7280)";
  }
}

function getCategoryBadge(category: AgentDefinition["category"]): string {
  const badges: Record<AgentDefinition["category"], string> = {
    productivity: "⚡",
    communication: "💬",
    research: "🔍",
    scheduling: "📅",
    finance: "💰",
    development: "💻",
    creative: "🎨",
    administrative: "📋",
    custom: "🛠️"
  };
  return badges[category] || "🤖";
}

export function AgentCard({ agent, onSelect, onClone, isSelected }: AgentCardProps) {
  const handleKeyDown = (event: React.KeyboardEvent) => {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      onSelect(agent);
    }
  };

  return (
    <div
      className={`agent-card ${isSelected ? "selected" : ""}`}
      onClick={() => onSelect(agent)}
      onKeyDown={handleKeyDown}
      role="button"
      tabIndex={0}
      aria-selected={isSelected}
    >
      <div className="agent-card-header">
        <span className="agent-icon">{agent.icon}</span>
        <div className="agent-card-title">
          <h3>{agent.displayName}</h3>
          <span className="agent-name">@{agent.name}</span>
        </div>
        <span
          className="agent-status"
          style={{ backgroundColor: getStatusColor(agent.status) }}
          title={agent.status}
        />
      </div>

      <p className="agent-description">
        {agent.description || "No description provided."}
      </p>

      <div className="agent-card-footer">
        <div className="agent-tags">
          <span className="agent-category" title={agent.category}>
            {getCategoryBadge(agent.category)} {agent.category}
          </span>
          {agent.isBuiltIn && <span className="agent-badge built-in">Built-in</span>}
          {agent.parentAgentId && <span className="agent-badge variant">Variant</span>}
        </div>

        <div className="agent-card-actions">
          {onClone && !agent.isBuiltIn && (
            <button
              type="button"
              className="agent-action-btn"
              onClick={(e) => {
                e.stopPropagation();
                onClone(agent);
              }}
              title="Clone agent"
            >
              📋
            </button>
          )}
        </div>
      </div>

      <style jsx>{`
        .agent-card {
          background: var(--color-surface, #1e1e1e);
          border: 1px solid var(--color-border, #333);
          border-radius: 8px;
          padding: 16px;
          cursor: pointer;
          transition: all 0.2s ease;
        }

        .agent-card:hover {
          border-color: var(--color-primary, #0ea5e9);
          transform: translateY(-2px);
          box-shadow: 0 4px 12px rgba(0, 0, 0, 0.3);
        }

        .agent-card.selected {
          border-color: var(--color-primary, #0ea5e9);
          background: var(--color-surface-active, #252525);
        }

        .agent-card-header {
          display: flex;
          align-items: flex-start;
          gap: 12px;
          margin-bottom: 12px;
        }

        .agent-icon {
          font-size: 24px;
          line-height: 1;
        }

        .agent-card-title {
          flex: 1;
          min-width: 0;
        }

        .agent-card-title h3 {
          margin: 0;
          font-size: 14px;
          font-weight: 600;
          color: var(--color-text, #fff);
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
        }

        .agent-name {
          font-size: 12px;
          color: var(--color-text-muted, #888);
        }

        .agent-status {
          width: 8px;
          height: 8px;
          border-radius: 50%;
          flex-shrink: 0;
        }

        .agent-description {
          font-size: 13px;
          color: var(--color-text-secondary, #aaa);
          margin: 0 0 12px;
          line-height: 1.5;
          display: -webkit-box;
          -webkit-line-clamp: 2;
          -webkit-box-orient: vertical;
          overflow: hidden;
        }

        .agent-card-footer {
          display: flex;
          justify-content: space-between;
          align-items: center;
          gap: 8px;
        }

        .agent-tags {
          display: flex;
          flex-wrap: wrap;
          gap: 6px;
        }

        .agent-category {
          font-size: 11px;
          padding: 2px 8px;
          background: var(--color-surface-secondary, #2a2a2a);
          border-radius: 12px;
          color: var(--color-text-secondary, #aaa);
        }

        .agent-badge {
          font-size: 10px;
          padding: 2px 6px;
          border-radius: 8px;
          font-weight: 500;
        }

        .agent-badge.built-in {
          background: var(--color-info-bg, rgba(59, 130, 246, 0.2));
          color: var(--color-info, #3b82f6);
        }

        .agent-badge.variant {
          background: var(--color-warning-bg, rgba(234, 179, 8, 0.2));
          color: var(--color-warning, #eab308);
        }

        .agent-card-actions {
          display: flex;
          gap: 4px;
        }

        .agent-action-btn {
          background: none;
          border: none;
          padding: 4px;
          cursor: pointer;
          font-size: 14px;
          opacity: 0.6;
          transition: opacity 0.2s;
        }

        .agent-action-btn:hover {
          opacity: 1;
        }
      `}</style>
    </div>
  );
}
