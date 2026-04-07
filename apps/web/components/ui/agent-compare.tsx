"use client";

import { useState, useMemo, useCallback } from "react";
import type { AgentDefinition } from "@agentic/contracts";

// Agent comparison - side-by-side diff view for comparing agents

type AgentCompareProps = {
  agents: AgentDefinition[];
  selectedIds: [string | null, string | null];
  onSelectAgent: (slot: 0 | 1, agentId: string | null) => void;
  className?: string;
};

export function AgentCompare({
  agents,
  selectedIds,
  onSelectAgent,
  className = ""
}: AgentCompareProps) {
  const [agent1, agent2] = useMemo(() => {
    return [
      agents.find(a => a.id === selectedIds[0]) ?? null,
      agents.find(a => a.id === selectedIds[1]) ?? null
    ];
  }, [agents, selectedIds]);

  const differences = useMemo(() => {
    if (!agent1 || !agent2) return [];
    
    const diffs: Array<{
      field: string;
      label: string;
      value1: string | number | boolean;
      value2: string | number | boolean;
      isDifferent: boolean;
    }> = [];

    const fields = [
      { key: "category", label: "Category" },
      { key: "model", label: "Model" },
      { key: "temperature", label: "Temperature" },
      { key: "maxTokens", label: "Max Tokens" },
      { key: "status", label: "Status" },
      { key: "isBuiltIn", label: "Built-in" },
      { key: "riskTolerance", label: "Risk Tolerance" }
    ];

    for (const field of fields) {
      const v1 = (agent1 as Record<string, unknown>)[field.key];
      const v2 = (agent2 as Record<string, unknown>)[field.key];
      diffs.push({
        field: field.key,
        label: field.label,
        value1: v1 as string | number | boolean,
        value2: v2 as string | number | boolean,
        isDifferent: v1 !== v2
      });
    }

    return diffs;
  }, [agent1, agent2]);

  const capabilityDiff = useMemo(() => {
    if (!agent1 || !agent2) return { only1: [], only2: [], shared: [] };
    
    const caps1 = new Set(agent1.allowedCapabilities);
    const caps2 = new Set(agent2.allowedCapabilities);
    
    return {
      only1: agent1.allowedCapabilities.filter(c => !caps2.has(c)),
      only2: agent2.allowedCapabilities.filter(c => !caps1.has(c)),
      shared: agent1.allowedCapabilities.filter(c => caps2.has(c))
    };
  }, [agent1, agent2]);

  return (
    <div className={`agent-compare ${className}`}>
      <div className="agent-compare-header">
        <h3>Agent Comparison</h3>
        <p className="agent-compare-subtitle">Compare capabilities and settings</p>
      </div>

      <div className="agent-compare-selectors">
        <AgentSelector
          agents={agents}
          value={selectedIds[0]}
          onChange={(id) => onSelectAgent(0, id)}
          excludeId={selectedIds[1]}
          placeholder="Select first agent..."
        />
        <span className="agent-compare-vs">VS</span>
        <AgentSelector
          agents={agents}
          value={selectedIds[1]}
          onChange={(id) => onSelectAgent(1, id)}
          excludeId={selectedIds[0]}
          placeholder="Select second agent..."
        />
      </div>

      {agent1 && agent2 ? (
        <div className="agent-compare-content">
          {/* Overview cards */}
          <div className="agent-compare-overview">
            <AgentCompareCard agent={agent1} />
            <AgentCompareCard agent={agent2} />
          </div>

          {/* Field-by-field comparison */}
          <div className="agent-compare-fields">
            <h4>Settings Comparison</h4>
            <div className="agent-compare-table">
              <div className="agent-compare-row header">
                <div className="agent-compare-field">Field</div>
                <div className="agent-compare-value">{agent1.displayName}</div>
                <div className="agent-compare-value">{agent2.displayName}</div>
              </div>
              {differences.map(diff => (
                <div 
                  key={diff.field} 
                  className={`agent-compare-row ${diff.isDifferent ? "different" : ""}`}
                >
                  <div className="agent-compare-field">{diff.label}</div>
                  <div className="agent-compare-value">{String(diff.value1)}</div>
                  <div className="agent-compare-value">{String(diff.value2)}</div>
                </div>
              ))}
            </div>
          </div>

          {/* Capability comparison */}
          <div className="agent-compare-capabilities">
            <h4>Capabilities</h4>
            <div className="agent-compare-caps-grid">
              <div className="agent-compare-caps-column">
                <div className="agent-compare-caps-header only-first">
                  Only in {agent1.displayName}
                </div>
                {capabilityDiff.only1.length === 0 ? (
                  <div className="agent-compare-caps-empty">None</div>
                ) : (
                  capabilityDiff.only1.map(cap => (
                    <div key={cap} className="agent-compare-cap only-first">{cap}</div>
                  ))
                )}
              </div>
              
              <div className="agent-compare-caps-column">
                <div className="agent-compare-caps-header shared">
                  Shared
                </div>
                {capabilityDiff.shared.length === 0 ? (
                  <div className="agent-compare-caps-empty">None</div>
                ) : (
                  capabilityDiff.shared.map(cap => (
                    <div key={cap} className="agent-compare-cap shared">{cap}</div>
                  ))
                )}
              </div>
              
              <div className="agent-compare-caps-column">
                <div className="agent-compare-caps-header only-second">
                  Only in {agent2.displayName}
                </div>
                {capabilityDiff.only2.length === 0 ? (
                  <div className="agent-compare-caps-empty">None</div>
                ) : (
                  capabilityDiff.only2.map(cap => (
                    <div key={cap} className="agent-compare-cap only-second">{cap}</div>
                  ))
                )}
              </div>
            </div>
          </div>

          {/* System prompt comparison */}
          <div className="agent-compare-prompts">
            <h4>System Prompts</h4>
            <div className="agent-compare-prompts-grid">
              <div className="agent-compare-prompt">
                <div className="agent-compare-prompt-header">{agent1.displayName}</div>
                <pre className="agent-compare-prompt-text">{agent1.systemPrompt}</pre>
              </div>
              <div className="agent-compare-prompt">
                <div className="agent-compare-prompt-header">{agent2.displayName}</div>
                <pre className="agent-compare-prompt-text">{agent2.systemPrompt}</pre>
              </div>
            </div>
          </div>
        </div>
      ) : (
        <div className="agent-compare-empty">
          <span className="agent-compare-empty-icon">⚖️</span>
          <span>Select two agents to compare</span>
        </div>
      )}
    </div>
  );
}

type AgentSelectorProps = {
  agents: AgentDefinition[];
  value: string | null;
  onChange: (id: string | null) => void;
  excludeId?: string | null;
  placeholder?: string;
};

function AgentSelector({ agents, value, onChange, excludeId, placeholder }: AgentSelectorProps) {
  const availableAgents = useMemo(() => {
    return agents.filter(a => a.id !== excludeId);
  }, [agents, excludeId]);

  return (
    <select
      value={value ?? ""}
      onChange={(e) => onChange(e.target.value || null)}
      className="agent-compare-selector"
    >
      <option value="">{placeholder}</option>
      {availableAgents.map(agent => (
        <option key={agent.id} value={agent.id}>
          {agent.icon} {agent.displayName}
        </option>
      ))}
    </select>
  );
}

function AgentCompareCard({ agent }: { agent: AgentDefinition }) {
  return (
    <div className="agent-compare-card">
      <div className="agent-compare-card-icon">{agent.icon}</div>
      <div className="agent-compare-card-info">
        <div className="agent-compare-card-name">{agent.displayName}</div>
        <div className="agent-compare-card-category">{agent.category}</div>
      </div>
      <div className="agent-compare-card-badges">
        <span className={`agent-compare-card-status ${agent.status}`}>
          {agent.status}
        </span>
        {agent.isBuiltIn && (
          <span className="agent-compare-card-builtin">Built-in</span>
        )}
      </div>
    </div>
  );
}

// Hook for managing comparison state
export function useAgentCompare() {
  const [selectedIds, setSelectedIds] = useState<[string | null, string | null]>([null, null]);

  const selectAgent = useCallback((slot: 0 | 1, agentId: string | null) => {
    setSelectedIds(prev => {
      const next = [...prev] as [string | null, string | null];
      next[slot] = agentId;
      return next;
    });
  }, []);

  const swap = useCallback(() => {
    setSelectedIds(prev => [prev[1], prev[0]]);
  }, []);

  const clear = useCallback(() => {
    setSelectedIds([null, null]);
  }, []);

  return {
    selectedIds,
    selectAgent,
    swap,
    clear,
    hasSelection: selectedIds[0] !== null || selectedIds[1] !== null,
    isComplete: selectedIds[0] !== null && selectedIds[1] !== null
  };
}
