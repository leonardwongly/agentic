"use client";

import { useMemo, useState } from "react";
import type { AgentCategory, AgentDefinition, AgentStatus } from "@agentic/contracts";
import { AgentCard } from "./agent-card";

type AgentCatalogProps = {
  agents: AgentDefinition[];
  onSelect: (agent: AgentDefinition) => void;
  onClone?: (agent: AgentDefinition) => void;
  onCreate?: () => void;
  selectedAgentId?: string;
};

type ViewMode = "grid" | "list";
type SortField = "name" | "category" | "status" | "updatedAt";

const categoryLabels: Record<AgentCategory, string> = {
  productivity: "Productivity",
  communication: "Communication",
  research: "Research",
  scheduling: "Scheduling",
  finance: "Finance",
  development: "Development",
  creative: "Creative",
  administrative: "Administrative",
  custom: "Custom"
};

const statusLabels: Record<AgentStatus, string> = {
  active: "Active",
  paused: "Paused",
  archived: "Archived",
  draft: "Draft"
};

export function AgentCatalog({
  agents,
  onSelect,
  onClone,
  onCreate,
  selectedAgentId
}: AgentCatalogProps) {
  const [search, setSearch] = useState("");
  const [categoryFilter, setCategoryFilter] = useState<AgentCategory | "all">("all");
  const [statusFilter, setStatusFilter] = useState<AgentStatus | "all">("all");
  const [viewMode, setViewMode] = useState<ViewMode>("grid");
  const [sortField, setSortField] = useState<SortField>("name");
  const [sortAsc, setSortAsc] = useState(true);
  const [showBuiltInOnly, setShowBuiltInOnly] = useState(false);

  const filteredAgents = useMemo(() => {
    let result = agents;

    if (search) {
      const lower = search.toLowerCase();
      result = result.filter(
        (agent) =>
          agent.name.toLowerCase().includes(lower) ||
          agent.displayName.toLowerCase().includes(lower) ||
          agent.description.toLowerCase().includes(lower) ||
          agent.tags.some((tag) => tag.toLowerCase().includes(lower))
      );
    }

    if (categoryFilter !== "all") {
      result = result.filter((agent) => agent.category === categoryFilter);
    }

    if (statusFilter !== "all") {
      result = result.filter((agent) => agent.status === statusFilter);
    }

    if (showBuiltInOnly) {
      result = result.filter((agent) => agent.isBuiltIn);
    }

    result = [...result].sort((a, b) => {
      let cmp = 0;
      switch (sortField) {
        case "name":
          cmp = a.displayName.localeCompare(b.displayName);
          break;
        case "category":
          cmp = a.category.localeCompare(b.category);
          break;
        case "status":
          cmp = a.status.localeCompare(b.status);
          break;
        case "updatedAt":
          cmp = a.updatedAt.localeCompare(b.updatedAt);
          break;
      }
      return sortAsc ? cmp : -cmp;
    });

    return result;
  }, [agents, search, categoryFilter, statusFilter, showBuiltInOnly, sortField, sortAsc]);

  const handleSortChange = (field: SortField) => {
    if (sortField === field) {
      setSortAsc(!sortAsc);
    } else {
      setSortField(field);
      setSortAsc(true);
    }
  };

  const usedCategories = useMemo(
    () => [...new Set(agents.map((a) => a.category))].sort(),
    [agents]
  );

  const usedStatuses = useMemo(
    () => [...new Set(agents.map((a) => a.status))].sort(),
    [agents]
  );

  return (
    <div className="agent-catalog">
      <div className="catalog-header">
        <h2>Agent Catalog</h2>
        <span className="catalog-count">{filteredAgents.length} of {agents.length} agents</span>
        {onCreate && (
          <button type="button" className="create-agent-btn" onClick={onCreate}>
            + Create Agent
          </button>
        )}
      </div>

      <div className="catalog-toolbar">
        <input
          type="search"
          className="catalog-search"
          placeholder="Search agents..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />

        <div className="catalog-filters">
          <select
            value={categoryFilter}
            onChange={(e) => setCategoryFilter(e.target.value as AgentCategory | "all")}
            className="filter-select"
          >
            <option value="all">All Categories</option>
            {usedCategories.map((cat) => (
              <option key={cat} value={cat}>
                {categoryLabels[cat]}
              </option>
            ))}
          </select>

          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value as AgentStatus | "all")}
            className="filter-select"
          >
            <option value="all">All Statuses</option>
            {usedStatuses.map((status) => (
              <option key={status} value={status}>
                {statusLabels[status]}
              </option>
            ))}
          </select>

          <label className="filter-checkbox">
            <input
              type="checkbox"
              checked={showBuiltInOnly}
              onChange={(e) => setShowBuiltInOnly(e.target.checked)}
            />
            Built-in only
          </label>
        </div>

        <div className="catalog-view-controls">
          <div className="sort-controls">
            <span>Sort:</span>
            {(["name", "category", "status", "updatedAt"] as SortField[]).map((field) => (
              <button
                key={field}
                type="button"
                className={`sort-btn ${sortField === field ? "active" : ""}`}
                onClick={() => handleSortChange(field)}
              >
                {field === "updatedAt" ? "Updated" : field.charAt(0).toUpperCase() + field.slice(1)}
                {sortField === field && (sortAsc ? " ↑" : " ↓")}
              </button>
            ))}
          </div>

          <div className="view-toggle">
            <button
              type="button"
              className={viewMode === "grid" ? "active" : ""}
              onClick={() => setViewMode("grid")}
              title="Grid view"
            >
              ⊞
            </button>
            <button
              type="button"
              className={viewMode === "list" ? "active" : ""}
              onClick={() => setViewMode("list")}
              title="List view"
            >
              ☰
            </button>
          </div>
        </div>
      </div>

      {filteredAgents.length === 0 ? (
        <div className="catalog-empty">
          <p>No agents match your filters.</p>
          {agents.length === 0 && onCreate && (
            <button type="button" onClick={onCreate}>
              Create your first agent
            </button>
          )}
        </div>
      ) : (
        <div className={`catalog-grid ${viewMode}`}>
          {filteredAgents.map((agent) => (
            <AgentCard
              key={agent.id}
              agent={agent}
              onSelect={onSelect}
              onClone={onClone}
              isSelected={agent.id === selectedAgentId}
            />
          ))}
        </div>
      )}

      <style jsx>{`
        .agent-catalog {
          display: flex;
          flex-direction: column;
          gap: 16px;
        }

        .catalog-header {
          display: flex;
          align-items: center;
          gap: 12px;
        }

        .catalog-header h2 {
          margin: 0;
          font-size: 18px;
          color: var(--color-text, #fff);
        }

        .catalog-count {
          font-size: 13px;
          color: var(--color-text-muted, #888);
        }

        .create-agent-btn {
          margin-left: auto;
          padding: 8px 16px;
          background: var(--color-primary, #0ea5e9);
          color: white;
          border: none;
          border-radius: 6px;
          font-size: 13px;
          font-weight: 500;
          cursor: pointer;
          transition: background 0.2s;
        }

        .create-agent-btn:hover {
          background: var(--color-primary-hover, #0284c7);
        }

        .catalog-toolbar {
          display: flex;
          flex-wrap: wrap;
          gap: 12px;
          align-items: center;
        }

        .catalog-search {
          flex: 1;
          min-width: 200px;
          padding: 8px 12px;
          background: var(--color-surface, #1e1e1e);
          border: 1px solid var(--color-border, #333);
          border-radius: 6px;
          color: var(--color-text, #fff);
          font-size: 13px;
        }

        .catalog-search::placeholder {
          color: var(--color-text-muted, #888);
        }

        .catalog-filters {
          display: flex;
          gap: 8px;
          flex-wrap: wrap;
        }

        .filter-select {
          padding: 6px 10px;
          background: var(--color-surface, #1e1e1e);
          border: 1px solid var(--color-border, #333);
          border-radius: 6px;
          color: var(--color-text, #fff);
          font-size: 12px;
        }

        .filter-checkbox {
          display: flex;
          align-items: center;
          gap: 6px;
          font-size: 12px;
          color: var(--color-text-secondary, #aaa);
          cursor: pointer;
        }

        .catalog-view-controls {
          display: flex;
          gap: 12px;
          align-items: center;
          margin-left: auto;
        }

        .sort-controls {
          display: flex;
          align-items: center;
          gap: 4px;
          font-size: 12px;
          color: var(--color-text-muted, #888);
        }

        .sort-btn {
          padding: 4px 8px;
          background: none;
          border: 1px solid transparent;
          border-radius: 4px;
          color: var(--color-text-secondary, #aaa);
          font-size: 11px;
          cursor: pointer;
        }

        .sort-btn:hover {
          background: var(--color-surface-secondary, #2a2a2a);
        }

        .sort-btn.active {
          border-color: var(--color-primary, #0ea5e9);
          color: var(--color-primary, #0ea5e9);
        }

        .view-toggle {
          display: flex;
          border: 1px solid var(--color-border, #333);
          border-radius: 6px;
          overflow: hidden;
        }

        .view-toggle button {
          padding: 6px 10px;
          background: var(--color-surface, #1e1e1e);
          border: none;
          color: var(--color-text-muted, #888);
          cursor: pointer;
          font-size: 14px;
        }

        .view-toggle button:hover {
          background: var(--color-surface-secondary, #2a2a2a);
        }

        .view-toggle button.active {
          background: var(--color-primary, #0ea5e9);
          color: white;
        }

        .catalog-grid {
          display: grid;
          gap: 16px;
        }

        .catalog-grid.grid {
          grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
        }

        .catalog-grid.list {
          grid-template-columns: 1fr;
        }

        .catalog-empty {
          text-align: center;
          padding: 48px 16px;
          color: var(--color-text-muted, #888);
        }

        .catalog-empty button {
          margin-top: 16px;
          padding: 10px 20px;
          background: var(--color-primary, #0ea5e9);
          color: white;
          border: none;
          border-radius: 6px;
          cursor: pointer;
        }
      `}</style>
    </div>
  );
}
