"use client";

import { useMemo, useState } from "react";
import type { ActionLog } from "@agentic/contracts";

// Timeline filtering: Filter by event type, agent, goal, time range, severity

export type TimelineFilters = {
  eventTypes?: string[];
  agentIds?: string[];
  goalIds?: string[];
  severity?: "info" | "warning" | "error" | "all";
  timeRange?: {
    start?: Date;
    end?: Date;
  };
  search?: string;
};

export function filterTimeline(logs: ActionLog[], filters: TimelineFilters): ActionLog[] {
  let results = [...logs];

  // Event type filter
  if (filters.eventTypes && filters.eventTypes.length > 0) {
    results = results.filter((log) => {
      const eventType = log.kind.split(".")[0];
      return filters.eventTypes!.includes(eventType) || filters.eventTypes!.includes(log.kind);
    });
  }

  // Agent filter (extracted from context or message)
  if (filters.agentIds && filters.agentIds.length > 0) {
    results = results.filter((log) => {
      // Check if any agent ID appears in the log
      return filters.agentIds!.some(
        (agentId) => log.message.includes(agentId) || log.kind.includes(agentId)
      );
    });
  }

  // Goal filter
  if (filters.goalIds && filters.goalIds.length > 0) {
    results = results.filter((log) => {
      return filters.goalIds!.some((goalId) => log.goalId === goalId);
    });
  }

  // Severity filter
  if (filters.severity && filters.severity !== "all") {
    results = results.filter((log) => {
      const severity = getLogSeverity(log);
      return severity === filters.severity;
    });
  }

  // Time range filter
  if (filters.timeRange?.start) {
    results = results.filter((log) => new Date(log.createdAt) >= filters.timeRange!.start!);
  }
  if (filters.timeRange?.end) {
    results = results.filter((log) => new Date(log.createdAt) <= filters.timeRange!.end!);
  }

  // Search filter
  if (filters.search?.trim()) {
    const lowerSearch = filters.search.toLowerCase();
    results = results.filter(
      (log) =>
        log.kind.toLowerCase().includes(lowerSearch) ||
        log.message.toLowerCase().includes(lowerSearch)
    );
  }

  return results;
}

function getLogSeverity(log: ActionLog): "info" | "warning" | "error" {
  if (log.kind.includes("error") || log.kind.includes("failed") || log.kind.includes("failure")) {
    return "error";
  }
  if (log.kind.includes("warning") || log.kind.includes("rejected")) {
    return "warning";
  }
  return "info";
}

// Extract unique event types from logs
function extractEventTypes(logs: ActionLog[]): string[] {
  const types = new Set<string>();
  for (const log of logs) {
    types.add(log.kind.split(".")[0]);
    types.add(log.kind);
  }
  return Array.from(types).sort();
}

// Timeline filter component
type TimelineFilterProps = {
  logs: ActionLog[];
  onFilterChange: (filters: TimelineFilters) => void;
  className?: string;
};

export function TimelineFilter({ logs, onFilterChange, className = "" }: TimelineFilterProps) {
  const [filters, setFilters] = useState<TimelineFilters>({});
  const [showAdvanced, setShowAdvanced] = useState(false);

  const eventTypes = useMemo(() => {
    const types = new Set<string>();
    for (const log of logs) {
      types.add(log.kind.split(".")[0]);
    }
    return Array.from(types).sort();
  }, [logs]);

  const goalIds = useMemo(() => {
    const ids = new Set<string>();
    for (const log of logs) {
      if (log.goalId) ids.add(log.goalId);
    }
    return Array.from(ids);
  }, [logs]);

  const updateFilters = (update: Partial<TimelineFilters>) => {
    const newFilters = { ...filters, ...update };
    setFilters(newFilters);
    onFilterChange(newFilters);
  };

  const toggleEventType = (type: string) => {
    const current = filters.eventTypes || [];
    const newTypes = current.includes(type)
      ? current.filter((t) => t !== type)
      : [...current, type];
    updateFilters({ eventTypes: newTypes.length > 0 ? newTypes : undefined });
  };

  const clearFilters = () => {
    setFilters({});
    onFilterChange({});
  };

  const hasFilters = Object.values(filters).some((v) => v !== undefined);

  return (
    <div className={`timeline-filter ${className}`}>
      <div className="timeline-filter-header">
        <input
          type="text"
          value={filters.search || ""}
          onChange={(e) => updateFilters({ search: e.target.value || undefined })}
          placeholder="Search activity..."
          className="timeline-search"
        />
        <button
          type="button"
          className={`timeline-filter-toggle ${showAdvanced ? "active" : ""}`}
          onClick={() => setShowAdvanced(!showAdvanced)}
        >
          🔽 Filters
        </button>
        {hasFilters && (
          <button type="button" className="timeline-filter-clear" onClick={clearFilters}>
            Clear
          </button>
        )}
      </div>

      {showAdvanced && (
        <div className="timeline-filter-advanced">
          <div className="filter-section">
            <label>Event Type</label>
            <div className="filter-chips">
              {eventTypes.map((type) => (
                <button
                  key={type}
                  type="button"
                  className={`filter-chip ${filters.eventTypes?.includes(type) ? "active" : ""}`}
                  onClick={() => toggleEventType(type)}
                >
                  {type}
                </button>
              ))}
            </div>
          </div>

          <div className="filter-section">
            <label>Severity</label>
            <div className="filter-chips">
              {(["all", "info", "warning", "error"] as const).map((sev) => (
                <button
                  key={sev}
                  type="button"
                  className={`filter-chip severity-${sev} ${(filters.severity || "all") === sev ? "active" : ""}`}
                  onClick={() => updateFilters({ severity: sev === "all" ? undefined : sev })}
                >
                  {sev === "all" ? "All" : sev.charAt(0).toUpperCase() + sev.slice(1)}
                </button>
              ))}
            </div>
          </div>

          {goalIds.length > 0 && (
            <div className="filter-section">
              <label>Goal</label>
              <select
                value={filters.goalIds?.[0] || ""}
                onChange={(e) =>
                  updateFilters({ goalIds: e.target.value ? [e.target.value] : undefined })
                }
                className="filter-select"
              >
                <option value="">All goals</option>
                {goalIds.map((id) => (
                  <option key={id} value={id}>
                    {id.slice(0, 8)}...
                  </option>
                ))}
              </select>
            </div>
          )}

          <div className="filter-section">
            <label>Time Range</label>
            <div className="filter-time-range">
              <button
                type="button"
                className={`filter-chip ${!filters.timeRange ? "active" : ""}`}
                onClick={() => updateFilters({ timeRange: undefined })}
              >
                All time
              </button>
              <button
                type="button"
                className="filter-chip"
                onClick={() => {
                  const start = new Date();
                  start.setHours(0, 0, 0, 0);
                  updateFilters({ timeRange: { start } });
                }}
              >
                Today
              </button>
              <button
                type="button"
                className="filter-chip"
                onClick={() => {
                  const start = new Date();
                  start.setDate(start.getDate() - 7);
                  updateFilters({ timeRange: { start } });
                }}
              >
                Last 7 days
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// Hook for filtered timeline
export function useFilteredTimeline(logs: ActionLog[]) {
  const [filters, setFilters] = useState<TimelineFilters>({});

  const filteredLogs = useMemo(() => filterTimeline(logs, filters), [logs, filters]);

  const stats = useMemo(() => {
    const total = logs.length;
    const filtered = filteredLogs.length;
    const byType = new Map<string, number>();
    const bySeverity = { info: 0, warning: 0, error: 0 };

    for (const log of filteredLogs) {
      const type = log.kind.split(".")[0];
      byType.set(type, (byType.get(type) || 0) + 1);
      bySeverity[getLogSeverity(log)]++;
    }

    return { total, filtered, byType, bySeverity };
  }, [logs, filteredLogs]);

  return {
    filters,
    setFilters,
    filteredLogs,
    stats
  };
}

// Timeline stats bar
type TimelineStatsProps = {
  stats: {
    total: number;
    filtered: number;
    bySeverity: { info: number; warning: number; error: number };
  };
};

export function TimelineStats({ stats }: TimelineStatsProps) {
  return (
    <div className="timeline-stats">
      <span className="timeline-stat">
        {stats.filtered} of {stats.total} events
      </span>
      {stats.bySeverity.error > 0 && (
        <span className="timeline-stat error">🔴 {stats.bySeverity.error} errors</span>
      )}
      {stats.bySeverity.warning > 0 && (
        <span className="timeline-stat warning">🟡 {stats.bySeverity.warning} warnings</span>
      )}
    </div>
  );
}
