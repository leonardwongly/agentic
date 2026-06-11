"use client";

import type { AgentDefinition, AgentMetrics } from "@agentic/contracts";

type AgentDetailProps = {
  agent: AgentDefinition;
  metrics?: AgentMetrics | null;
  onEdit?: () => void;
  onClone?: () => void;
  onExport?: () => void;
  onDelete?: () => void;
  onClose: () => void;
};

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en-US", {
    timeZone: "UTC",
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit"
  });
}

function formatPercent(value: number): string {
  return `${Math.round(value * 100)}%`;
}

export function AgentDetail({
  agent,
  metrics,
  onEdit,
  onClone,
  onExport,
  onDelete,
  onClose
}: AgentDetailProps) {
  return (
    <div className="agent-detail">
      <div className="detail-header">
        <button type="button" className="back-btn" onClick={onClose}>
          ← Back
        </button>
        <div className="detail-title">
          <span className="agent-icon">{agent.icon}</span>
          <div>
            <h2>{agent.displayName}</h2>
            <span className="agent-name">@{agent.name}</span>
          </div>
        </div>
        <div className="detail-actions">
          {onEdit && !agent.isBuiltIn && (
            <button type="button" className="action-btn primary" onClick={onEdit}>
              Edit
            </button>
          )}
          {onClone && (
            <button type="button" className="action-btn" onClick={onClone}>
              Clone
            </button>
          )}
          {onExport && (
            <button type="button" className="action-btn" onClick={onExport}>
              Export
            </button>
          )}
          {onDelete && !agent.isBuiltIn && (
            <button type="button" className="action-btn danger" onClick={onDelete}>
              Delete
            </button>
          )}
        </div>
      </div>

      <div className="detail-content">
        <section className="detail-section">
          <h3>Overview</h3>
          <div className="detail-grid">
            <div className="detail-item">
              <label>Status</label>
              <span className={`status-badge ${agent.status}`}>{agent.status}</span>
            </div>
            <div className="detail-item">
              <label>Category</label>
              <span>{agent.category}</span>
            </div>
            <div className="detail-item">
              <label>Version</label>
              <span>v{agent.version}</span>
            </div>
            <div className="detail-item">
              <label>Type</label>
              <span>{agent.isBuiltIn ? "Built-in" : "Custom"}</span>
            </div>
            <div className="detail-item">
              <label>Created</label>
              <span>{formatDate(agent.createdAt)}</span>
            </div>
            <div className="detail-item">
              <label>Updated</label>
              <span>{formatDate(agent.updatedAt)}</span>
            </div>
          </div>

          {agent.description && (
            <div className="detail-description">
              <label>Description</label>
              <p>{agent.description}</p>
            </div>
          )}

          {agent.tags.length > 0 && (
            <div className="detail-tags">
              <label>Tags</label>
              <div className="tags-list">
                {agent.tags.map((tag) => (
                  <span key={tag} className="tag">{tag}</span>
                ))}
              </div>
            </div>
          )}
        </section>

        <section className="detail-section">
          <h3>System Prompt</h3>
          <pre className="system-prompt">{agent.systemPrompt}</pre>
        </section>

        <section className="detail-section">
          <h3>Behavior Configuration</h3>
          <div className="detail-grid">
            <div className="detail-item">
              <label>Temperature</label>
              <span>{agent.behaviorConfig.temperature}</span>
            </div>
            <div className="detail-item">
              <label>Max Tokens</label>
              <span>{agent.behaviorConfig.maxTokens}</span>
            </div>
            <div className="detail-item">
              <label>Response Style</label>
              <span>{agent.behaviorConfig.responseStyle}</span>
            </div>
            <div className="detail-item">
              <label>Formality</label>
              <span>{agent.behaviorConfig.formality}</span>
            </div>
            <div className="detail-item">
              <label>Artifact Type</label>
              <span>{agent.artifactType}</span>
            </div>
            <div className="detail-item">
              <label>Max Risk Class</label>
              <span>{agent.maxRiskClass}</span>
            </div>
          </div>
        </section>

        <section className="detail-section">
          <h3>Capabilities</h3>
          <div className="capabilities-grid">
            <div className="capability-group">
              <label>Allowed</label>
              <div className="capability-list">
                {agent.allowedCapabilities.length === 0 ? (
                  <span className="empty">None</span>
                ) : (
                  agent.allowedCapabilities.map((cap) => (
                    <span key={cap} className="capability allowed">{cap}</span>
                  ))
                )}
              </div>
            </div>
            <div className="capability-group">
              <label>Blocked</label>
              <div className="capability-list">
                {agent.blockedCapabilities.length === 0 ? (
                  <span className="empty">None</span>
                ) : (
                  agent.blockedCapabilities.map((cap) => (
                    <span key={cap} className="capability blocked">{cap}</span>
                  ))
                )}
              </div>
            </div>
          </div>
        </section>

        {metrics && (
          <section className="detail-section">
            <h3>Performance Metrics</h3>
            <div className="metrics-grid">
              <div className="metric-card">
                <span className="metric-value">{metrics.tasksTotal}</span>
                <span className="metric-label">Total Tasks</span>
              </div>
              <div className="metric-card">
                <span className="metric-value">{formatPercent(metrics.successRate)}</span>
                <span className="metric-label">Success Rate</span>
              </div>
              <div className="metric-card">
                <span className="metric-value">{formatPercent(metrics.approvalRate)}</span>
                <span className="metric-label">Approval Rate</span>
              </div>
              <div className="metric-card">
                <span className="metric-value">{Math.round(metrics.averageExecutionTimeMs / 1000)}s</span>
                <span className="metric-label">Avg Duration</span>
              </div>
              <div className="metric-card">
                <span className="metric-value">{formatPercent(metrics.averageConfidence)}</span>
                <span className="metric-label">Avg Confidence</span>
              </div>
              <div className="metric-card">
                <span className="metric-value">{metrics.artifactsProduced}</span>
                <span className="metric-label">Artifacts</span>
              </div>
            </div>
          </section>
        )}

        {agent.parentAgentId && (
          <section className="detail-section">
            <h3>Lineage</h3>
            <p className="lineage-info">
              This agent was cloned from <code>{agent.parentAgentId}</code>
            </p>
          </section>
        )}
      </div>

      <style jsx>{`
        .agent-detail {
          background: var(--color-background, #121212);
          min-height: 100%;
        }

        .detail-header {
          display: flex;
          align-items: center;
          gap: 16px;
          padding: 16px;
          border-bottom: 1px solid var(--color-border, #333);
          position: sticky;
          top: 0;
          background: var(--color-background, #121212);
          z-index: 10;
        }

        .back-btn {
          padding: 8px 12px;
          background: none;
          border: 1px solid var(--color-border, #333);
          border-radius: 6px;
          color: var(--color-text-secondary, #aaa);
          font-size: 13px;
          cursor: pointer;
        }

        .back-btn:hover {
          background: var(--color-surface, #1e1e1e);
        }

        .detail-title {
          display: flex;
          align-items: center;
          gap: 12px;
          flex: 1;
        }

        .agent-icon {
          font-size: 32px;
        }

        .detail-title h2 {
          margin: 0;
          font-size: 20px;
          color: var(--color-text, #fff);
        }

        .agent-name {
          font-size: 13px;
          color: var(--color-text-muted, #888);
        }

        .detail-actions {
          display: flex;
          gap: 8px;
        }

        .action-btn {
          padding: 8px 16px;
          background: var(--color-surface, #1e1e1e);
          border: 1px solid var(--color-border, #333);
          border-radius: 6px;
          color: var(--color-text, #fff);
          font-size: 13px;
          cursor: pointer;
        }

        .action-btn:hover {
          background: var(--color-surface-secondary, #2a2a2a);
        }

        .action-btn.primary {
          background: var(--color-primary, #0ea5e9);
          border-color: var(--color-primary, #0ea5e9);
        }

        .action-btn.primary:hover {
          background: var(--color-primary-hover, #0284c7);
        }

        .action-btn.danger {
          color: var(--color-error, #ef4444);
          border-color: var(--color-error, #ef4444);
        }

        .action-btn.danger:hover {
          background: rgba(239, 68, 68, 0.1);
        }

        .detail-content {
          padding: 24px;
          max-width: 900px;
        }

        .detail-section {
          margin-bottom: 32px;
        }

        .detail-section h3 {
          margin: 0 0 16px;
          font-size: 14px;
          font-weight: 600;
          color: var(--color-text-secondary, #aaa);
          text-transform: uppercase;
          letter-spacing: 0.5px;
        }

        .detail-grid {
          display: grid;
          grid-template-columns: repeat(auto-fill, minmax(140px, 1fr));
          gap: 16px;
        }

        .detail-item {
          display: flex;
          flex-direction: column;
          gap: 4px;
        }

        .detail-item label {
          font-size: 11px;
          color: var(--color-text-muted, #888);
          text-transform: uppercase;
        }

        .detail-item span {
          font-size: 14px;
          color: var(--color-text, #fff);
        }

        .status-badge {
          display: inline-block;
          padding: 2px 8px;
          border-radius: 12px;
          font-size: 12px;
          font-weight: 500;
        }

        .status-badge.active {
          background: rgba(34, 197, 94, 0.2);
          color: #22c55e;
        }

        .status-badge.paused {
          background: rgba(234, 179, 8, 0.2);
          color: #eab308;
        }

        .status-badge.draft {
          background: rgba(59, 130, 246, 0.2);
          color: #3b82f6;
        }

        .status-badge.archived {
          background: rgba(107, 114, 128, 0.2);
          color: #6b7280;
        }

        .detail-description,
        .detail-tags {
          margin-top: 16px;
        }

        .detail-description label,
        .detail-tags label {
          display: block;
          font-size: 11px;
          color: var(--color-text-muted, #888);
          text-transform: uppercase;
          margin-bottom: 8px;
        }

        .detail-description p {
          margin: 0;
          font-size: 14px;
          color: var(--color-text-secondary, #aaa);
          line-height: 1.6;
        }

        .tags-list {
          display: flex;
          flex-wrap: wrap;
          gap: 6px;
        }

        .tag {
          padding: 4px 10px;
          background: var(--color-surface, #1e1e1e);
          border-radius: 12px;
          font-size: 12px;
          color: var(--color-text-secondary, #aaa);
        }

        .system-prompt {
          margin: 0;
          padding: 16px;
          background: var(--color-surface, #1e1e1e);
          border: 1px solid var(--color-border, #333);
          border-radius: 8px;
          font-size: 13px;
          color: var(--color-text, #fff);
          white-space: pre-wrap;
          word-break: break-word;
          max-height: 300px;
          overflow-y: auto;
        }

        .capabilities-grid {
          display: grid;
          grid-template-columns: 1fr 1fr;
          gap: 24px;
        }

        .capability-group label {
          display: block;
          font-size: 12px;
          color: var(--color-text-muted, #888);
          margin-bottom: 8px;
        }

        .capability-list {
          display: flex;
          flex-wrap: wrap;
          gap: 6px;
        }

        .capability {
          padding: 4px 10px;
          border-radius: 12px;
          font-size: 12px;
        }

        .capability.allowed {
          background: rgba(34, 197, 94, 0.15);
          color: #22c55e;
        }

        .capability.blocked {
          background: rgba(239, 68, 68, 0.15);
          color: #ef4444;
        }

        .empty {
          font-size: 12px;
          color: var(--color-text-muted, #888);
          font-style: italic;
        }

        .metrics-grid {
          display: grid;
          grid-template-columns: repeat(auto-fill, minmax(120px, 1fr));
          gap: 12px;
        }

        .metric-card {
          display: flex;
          flex-direction: column;
          align-items: center;
          padding: 16px;
          background: var(--color-surface, #1e1e1e);
          border: 1px solid var(--color-border, #333);
          border-radius: 8px;
        }

        .metric-value {
          font-size: 24px;
          font-weight: 600;
          color: var(--color-text, #fff);
        }

        .metric-label {
          font-size: 11px;
          color: var(--color-text-muted, #888);
          text-transform: uppercase;
          margin-top: 4px;
        }

        .lineage-info {
          font-size: 14px;
          color: var(--color-text-secondary, #aaa);
        }

        .lineage-info code {
          padding: 2px 6px;
          background: var(--color-surface, #1e1e1e);
          border-radius: 4px;
          font-size: 12px;
        }
      `}</style>
    </div>
  );
}
