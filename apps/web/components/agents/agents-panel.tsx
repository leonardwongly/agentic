"use client";

import { useCallback, useEffect, useState } from "react";
import type { AgentDefinition, AgentMetrics } from "@agentic/contracts";
import { AgentBuilder } from "./agent-builder";
import { AgentCatalog } from "./agent-catalog";
import { AgentDetail } from "./agent-detail";

type AgentsPanelProps = {
  initialAgents?: AgentDefinition[];
};

type ViewMode = "catalog" | "detail" | "create" | "edit";

async function readJson<T>(response: Response): Promise<T> {
  const payload = (await response.json()) as T & { error?: string };
  if (!response.ok) {
    throw new Error(typeof payload === "object" && payload && "error" in payload ? String(payload.error) : "Request failed.");
  }
  return payload;
}

export function AgentsPanel({ initialAgents = [] }: AgentsPanelProps) {
  const [agents, setAgents] = useState<AgentDefinition[]>(initialAgents);
  const [selectedAgent, setSelectedAgent] = useState<AgentDefinition | null>(null);
  const [selectedMetrics, setSelectedMetrics] = useState<AgentMetrics | null>(null);
  const [viewMode, setViewMode] = useState<ViewMode>("catalog");
  const [isPending, setIsPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadAgents = useCallback(async () => {
    try {
      setIsPending(true);
      const data = await readJson<{ agents: AgentDefinition[] }>(await fetch("/api/agents"));
      setAgents(data.agents);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load agents");
    } finally {
      setIsPending(false);
    }
  }, []);

  const loadMetrics = useCallback(async (agentId: string) => {
    try {
      const data = await readJson<{ metrics: AgentMetrics | null }>(
        await fetch(`/api/agents/${agentId}/metrics`)
      );
      setSelectedMetrics(data.metrics);
    } catch {
      setSelectedMetrics(null);
    }
  }, []);

  const handleSelectAgent = useCallback(async (agent: AgentDefinition) => {
    setSelectedAgent(agent);
    setViewMode("detail");
    await loadMetrics(agent.id);
  }, [loadMetrics]);

  const handleCreateAgent = useCallback(async (agentData: Partial<AgentDefinition>) => {
    setIsPending(true);
    setError(null);
    try {
      const data = await readJson<{ agent: AgentDefinition }>(
        await fetch("/api/agents", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(agentData)
        })
      );
      setAgents((prev) => [data.agent, ...prev]);
      setSelectedAgent(data.agent);
      setViewMode("detail");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create agent");
      throw err;
    } finally {
      setIsPending(false);
    }
  }, []);

  const handleUpdateAgent = useCallback(async (agentData: Partial<AgentDefinition>) => {
    if (!selectedAgent) return;
    setIsPending(true);
    setError(null);
    try {
      const data = await readJson<{ agent: AgentDefinition }>(
        await fetch(`/api/agents/${selectedAgent.id}`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(agentData)
        })
      );
      setAgents((prev) => prev.map((a) => (a.id === data.agent.id ? data.agent : a)));
      setSelectedAgent(data.agent);
      setViewMode("detail");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to update agent");
      throw err;
    } finally {
      setIsPending(false);
    }
  }, [selectedAgent]);

  const handleCloneAgent = useCallback(async (agent: AgentDefinition) => {
    setIsPending(true);
    setError(null);
    try {
      const cloneName = `${agent.name}-copy-${Date.now().toString(36).slice(-4)}`;
      const data = await readJson<{ agent: AgentDefinition }>(
        await fetch(`/api/agents/${agent.id}/clone`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            name: cloneName,
            displayName: `${agent.displayName} (Copy)`
          })
        })
      );
      setAgents((prev) => [data.agent, ...prev]);
      setSelectedAgent(data.agent);
      setViewMode("detail");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to clone agent");
    } finally {
      setIsPending(false);
    }
  }, []);

  const handleDeleteAgent = useCallback(async () => {
    if (!selectedAgent) return;
    if (!window.confirm(`Delete agent "${selectedAgent.displayName}"? This cannot be undone.`)) return;

    setIsPending(true);
    setError(null);
    try {
      await readJson<{ success: boolean }>(
        await fetch(`/api/agents/${selectedAgent.id}`, { method: "DELETE" })
      );
      setAgents((prev) => prev.filter((a) => a.id !== selectedAgent.id));
      setSelectedAgent(null);
      setViewMode("catalog");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to delete agent");
    } finally {
      setIsPending(false);
    }
  }, [selectedAgent]);

  const handleExportAgent = useCallback(async () => {
    if (!selectedAgent) return;
    try {
      const response = await fetch(`/api/agents/${selectedAgent.id}/export`);
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `${selectedAgent.name}.agent.json`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to export agent");
    }
  }, [selectedAgent]);

  useEffect(() => {
    if (initialAgents.length === 0) {
      loadAgents();
    }
  }, [initialAgents.length, loadAgents]);

  return (
    <div className="agents-panel">
      {error && (
        <div className="panel-error">
          {error}
          <button type="button" onClick={() => setError(null)}>×</button>
        </div>
      )}

      {viewMode === "catalog" && (
        <AgentCatalog
          agents={agents}
          onSelect={handleSelectAgent}
          onClone={handleCloneAgent}
          onCreate={() => setViewMode("create")}
          selectedAgentId={selectedAgent?.id}
        />
      )}

      {viewMode === "detail" && selectedAgent && (
        <AgentDetail
          agent={selectedAgent}
          metrics={selectedMetrics}
          onEdit={() => setViewMode("edit")}
          onClone={() => handleCloneAgent(selectedAgent)}
          onExport={handleExportAgent}
          onDelete={handleDeleteAgent}
          onClose={() => {
            setSelectedAgent(null);
            setSelectedMetrics(null);
            setViewMode("catalog");
          }}
        />
      )}

      {viewMode === "create" && (
        <AgentBuilder
          onSave={handleCreateAgent}
          onCancel={() => setViewMode("catalog")}
          isPending={isPending}
        />
      )}

      {viewMode === "edit" && selectedAgent && (
        <AgentBuilder
          initialAgent={selectedAgent}
          onSave={handleUpdateAgent}
          onCancel={() => setViewMode("detail")}
          isPending={isPending}
        />
      )}

      <style jsx>{`
        .agents-panel {
          height: 100%;
          display: flex;
          flex-direction: column;
        }

        .panel-error {
          display: flex;
          justify-content: space-between;
          align-items: center;
          margin: 0 0 16px;
          padding: 12px 16px;
          background: rgba(239, 68, 68, 0.1);
          border: 1px solid var(--color-error, #ef4444);
          border-radius: 8px;
          color: var(--color-error, #ef4444);
          font-size: 13px;
        }

        .panel-error button {
          background: none;
          border: none;
          color: inherit;
          font-size: 18px;
          cursor: pointer;
        }
      `}</style>
    </div>
  );
}
