"use client";

import { type ReactNode } from "react";

type EmptyStateProps = {
  icon?: ReactNode;
  title: string;
  description?: string;
  action?: {
    label: string;
    onClick: () => void;
  };
  suggestions?: string[];
  className?: string;
};

export function EmptyState({ icon, title, description, action, suggestions, className = "" }: EmptyStateProps) {
  return (
    <div className={`empty-state ${className}`}>
      {icon && <div className="empty-state-icon">{icon}</div>}
      <h4 className="empty-state-title">{title}</h4>
      {description && <p className="empty-state-description">{description}</p>}
      {suggestions && suggestions.length > 0 && (
        <div className="empty-state-suggestions">
          <p className="empty-state-suggestions-label">Try:</p>
          <ul>
            {suggestions.map((suggestion, i) => (
              <li key={i}>{suggestion}</li>
            ))}
          </ul>
        </div>
      )}
      {action && (
        <button type="button" className="primary-button empty-state-action" onClick={action.onClick}>
          {action.label}
        </button>
      )}
    </div>
  );
}

export function NoApprovalsEmpty() {
  return (
    <EmptyState
      icon={<span aria-hidden="true">✓</span>}
      title="All clear!"
      description="No pending approvals. Actions within your risk tolerance execute automatically."
      suggestions={[
        "Create a goal that requires external action (R2+)",
        "Enable stricter policy rules to require more approvals"
      ]}
    />
  );
}

export function NoGoalsEmpty({ onCreate }: { onCreate: () => void }) {
  return (
    <EmptyState
      icon={<span aria-hidden="true">🎯</span>}
      title="No active goals"
      description="Start by creating a goal. Describe what you want to accomplish."
      action={{ label: "Create goal", onClick: onCreate }}
      suggestions={[
        "Triage my inbox and draft replies",
        "Plan my week and identify conflicts",
        "Research competitors and summarize findings"
      ]}
    />
  );
}

export function NoMemoriesEmpty({ onAdd }: { onAdd: () => void }) {
  return (
    <EmptyState
      icon={<span aria-hidden="true">🧠</span>}
      title="No memories yet"
      description="Memories help agents understand your preferences and context."
      action={{ label: "Add memory", onClick: onAdd }}
      suggestions={[
        "Add your working style preferences",
        "Note important project context",
        "Record communication preferences"
      ]}
    />
  );
}

export function NoArtifactsEmpty() {
  return (
    <EmptyState
      icon={<span aria-hidden="true">📄</span>}
      title="No artifacts yet"
      description="Artifacts appear when agents complete tasks."
      suggestions={[
        "Create a goal to generate summaries or briefs",
        "Complete pending tasks to produce outputs"
      ]}
    />
  );
}

export function NoWatchersEmpty() {
  return (
    <EmptyState
      icon={<span aria-hidden="true">👁</span>}
      title="No active watchers"
      description="Watchers monitor conditions and trigger actions."
      suggestions={[
        "Create a goal that sets up monitoring",
        "Watchers are auto-created for time-sensitive goals"
      ]}
    />
  );
}

export function NoTemplatesEmpty({ onLoad }: { onLoad: () => void }) {
  return (
    <EmptyState
      icon={<span aria-hidden="true">📋</span>}
      title="No saved templates"
      description="Save completed goals as reusable templates."
      action={{ label: "Load templates", onClick: onLoad }}
      suggestions={[
        "Complete a goal and click 'Save as template'",
        "Templates can be scheduled to run automatically"
      ]}
    />
  );
}

export function NoAgentsEmpty({ onCreate }: { onCreate: () => void }) {
  return (
    <EmptyState
      icon={<span aria-hidden="true">🤖</span>}
      title="No custom agents"
      description="Create specialized agents for your workflows."
      action={{ label: "Create agent", onClick: onCreate }}
      suggestions={[
        "Clone a built-in agent and customize it",
        "Build from scratch with custom prompts"
      ]}
    />
  );
}

export function NoResultsEmpty({ query, onClear }: { query: string; onClear: () => void }) {
  return (
    <EmptyState
      icon={<span aria-hidden="true">🔍</span>}
      title={`No results for "${query}"`}
      description="Try adjusting your search or filters."
      action={{ label: "Clear search", onClick: onClear }}
    />
  );
}
