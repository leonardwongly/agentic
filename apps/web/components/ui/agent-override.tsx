"use client";

import { useState, useEffect, useMemo } from "react";
import type { AgentDefinition } from "@agentic/contracts";

// Agent override selector for goal creation
// Allows users to optionally specify a preferred agent for the goal

type AgentOverrideProps = {
  agents?: AgentDefinition[];
  value: string | null | undefined;
  onChange: (agentId: string | undefined) => void;
  disabled?: boolean;
  className?: string;
};

export function AgentOverride({
  agents = [],
  value,
  onChange,
  disabled = false,
  className = ""
}: AgentOverrideProps) {
  const [isExpanded, setIsExpanded] = useState(false);
  const { agents: fetchedAgents, loading } = useAgentsList();
  
  // Use provided agents or fetch them
  const agentList = agents.length > 0 ? agents : fetchedAgents;

  // Group agents by category
  const groupedAgents = useMemo(() => {
    const groups = new Map<string, AgentDefinition[]>();
    
    // Add built-in agents first
    const builtIn = agentList.filter(a => a.isBuiltIn);
    if (builtIn.length > 0) {
      groups.set("Built-in", builtIn);
    }
    
    // Then custom agents by category
    const custom = agentList.filter(a => !a.isBuiltIn);
    for (const agent of custom) {
      const category = agent.category.charAt(0).toUpperCase() + agent.category.slice(1);
      const existing = groups.get(category) || [];
      groups.set(category, [...existing, agent]);
    }
    
    return groups;
  }, [agentList]);

  const selectedAgent = agentList.find(a => a.id === value);

  if (loading && agentList.length === 0) {
    return null;
  }

  if (agentList.length === 0) {
    return null;
  }

  return (
    <div className={`agent-override ${className}`}>
      <button
        type="button"
        className="agent-override-toggle"
        onClick={() => setIsExpanded(!isExpanded)}
        disabled={disabled}
      >
        <span className="agent-override-icon">🤖</span>
        <span className="agent-override-label">
          {selectedAgent ? (
            <>
              <span className="agent-selected-icon">{selectedAgent.icon}</span>
              {selectedAgent.displayName}
            </>
          ) : (
            "Auto-assign agent"
          )}
        </span>
        <span className="agent-override-chevron">{isExpanded ? "▲" : "▼"}</span>
      </button>
      
      {isExpanded && (
        <div className="agent-override-dropdown">
          <button
            type="button"
            className={`agent-option ${!value ? "selected" : ""}`}
            onClick={() => {
              onChange(undefined);
              setIsExpanded(false);
            }}
          >
            <span className="agent-option-icon">🎯</span>
            <span className="agent-option-name">Auto-assign</span>
            <span className="agent-option-desc">Let the system choose the best agent</span>
          </button>
          
          {Array.from(groupedAgents.entries()).map(([category, categoryAgents]) => (
            <div key={category} className="agent-group">
              <div className="agent-group-header">{category}</div>
              {categoryAgents.map(agent => (
                <button
                  key={agent.id}
                  type="button"
                  className={`agent-option ${value === agent.id ? "selected" : ""}`}
                  onClick={() => {
                    onChange(agent.id);
                    setIsExpanded(false);
                  }}
                  disabled={agent.status !== "active"}
                >
                  <span className="agent-option-icon">{agent.icon}</span>
                  <span className="agent-option-name">{agent.displayName}</span>
                  <span className="agent-option-desc">{agent.description.slice(0, 50)}</span>
                  {agent.status !== "active" && (
                    <span className="agent-option-badge">{agent.status}</span>
                  )}
                </button>
              ))}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// Hook to fetch agents for the override selector
export function useAgentsList() {
  const [agents, setAgents] = useState<AgentDefinition[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function fetchAgents() {
      try {
        const response = await fetch("/api/agents");
        if (!response.ok) throw new Error("Failed to fetch agents");
        const data = await response.json();
        if (!cancelled) {
          setAgents(data.agents || []);
          setLoading(false);
        }
      } catch (e) {
        if (!cancelled) {
          setError(e instanceof Error ? e.message : "Unknown error");
          setLoading(false);
        }
      }
    }

    fetchAgents();
    return () => { cancelled = true; };
  }, []);

  return { agents, loading, error };
}

// Compact inline selector for smaller spaces
type AgentSelectProps = {
  agents: AgentDefinition[];
  value: string | null;
  onChange: (agentId: string | null) => void;
  disabled?: boolean;
  placeholder?: string;
};

export function AgentSelect({
  agents,
  value,
  onChange,
  disabled = false,
  placeholder = "Auto-assign"
}: AgentSelectProps) {
  const activeAgents = agents.filter(a => a.status === "active");
  
  return (
    <select
      className="agent-select"
      value={value || ""}
      onChange={(e) => onChange(e.target.value || null)}
      disabled={disabled}
    >
      <option value="">{placeholder}</option>
      <optgroup label="Built-in Agents">
        {activeAgents.filter(a => a.isBuiltIn).map(agent => (
          <option key={agent.id} value={agent.id}>
            {agent.icon} {agent.displayName}
          </option>
        ))}
      </optgroup>
      {activeAgents.some(a => !a.isBuiltIn) && (
        <optgroup label="Custom Agents">
          {activeAgents.filter(a => !a.isBuiltIn).map(agent => (
            <option key={agent.id} value={agent.id}>
              {agent.icon} {agent.displayName}
            </option>
          ))}
        </optgroup>
      )}
    </select>
  );
}
