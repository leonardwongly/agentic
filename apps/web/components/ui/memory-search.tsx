"use client";

import { useMemo, useState, type ReactNode } from "react";
import { formatDate } from "../../lib/format-date";

// Memory search: Full-text search across all memories with filters

export type Memory = {
  id: string;
  category: string;
  content: string;
  memoryType: string;
  confidence: number;
  createdAt: string;
  agentId?: string;
};

type MemorySearchFilters = {
  category?: string;
  memoryType?: string;
  agentId?: string;
  minConfidence?: number;
  dateRange?: {
    start?: Date;
    end?: Date;
  };
};

export function searchMemories(
  memories: Memory[],
  query: string,
  filters: MemorySearchFilters = {}
): Memory[] {
  let results = [...memories];

  // Apply filters
  if (filters.category) {
    results = results.filter((m) => m.category === filters.category);
  }
  if (filters.memoryType) {
    results = results.filter((m) => m.memoryType === filters.memoryType);
  }
  if (filters.agentId) {
    results = results.filter((m) => m.agentId === filters.agentId);
  }
  if (filters.minConfidence !== undefined) {
    const minConf = filters.minConfidence;
    results = results.filter((m) => m.confidence >= minConf);
  }
  if (filters.dateRange?.start) {
    results = results.filter((m) => new Date(m.createdAt) >= filters.dateRange!.start!);
  }
  if (filters.dateRange?.end) {
    results = results.filter((m) => new Date(m.createdAt) <= filters.dateRange!.end!);
  }

  // Text search
  if (query.trim()) {
    const lowerQuery = query.toLowerCase();
    results = results.filter((m) => {
      return (
        m.content.toLowerCase().includes(lowerQuery) ||
        m.category.toLowerCase().includes(lowerQuery)
      );
    });

    // Sort by relevance (exact match first, then position)
    results.sort((a, b) => {
      const aContent = a.content.toLowerCase();
      const bContent = b.content.toLowerCase();
      const aIndex = aContent.indexOf(lowerQuery);
      const bIndex = bContent.indexOf(lowerQuery);

      // Exact match in category ranks higher
      if (a.category.toLowerCase() === lowerQuery) return -1;
      if (b.category.toLowerCase() === lowerQuery) return 1;

      // Earlier position ranks higher
      return aIndex - bIndex;
    });
  }

  return results;
}

// Memory search component
type MemorySearchProps = {
  memories: Memory[];
  categories: string[];
  memoryTypes: string[];
  agentIds?: string[];
  onSelect?: (memory: Memory) => void;
  onBulkSelect?: (memories: Memory[]) => void;
};

export function MemorySearch({
  memories,
  categories,
  memoryTypes,
  agentIds = [],
  onSelect,
  onBulkSelect
}: MemorySearchProps) {
  const [query, setQuery] = useState("");
  const [filters, setFilters] = useState<MemorySearchFilters>({});
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [showFilters, setShowFilters] = useState(false);

  const results = useMemo(
    () => searchMemories(memories, query, filters),
    [memories, query, filters]
  );

  const toggleFilter = (key: keyof MemorySearchFilters, value: string | number | undefined) => {
    setFilters((prev) => ({
      ...prev,
      [key]: prev[key] === value ? undefined : value
    }));
  };

  const toggleSelect = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  };

  const selectAll = () => {
    setSelectedIds(new Set(results.map((m) => m.id)));
  };

  const deselectAll = () => {
    setSelectedIds(new Set());
  };

  const handleBulkAction = () => {
    const selected = results.filter((m) => selectedIds.has(m.id));
    onBulkSelect?.(selected);
  };

  return (
    <div className="memory-search">
      <div className="memory-search-header">
        <input
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search memories..."
          className="memory-search-input"
        />
        <button
          type="button"
          className={`memory-search-filter-toggle ${showFilters ? "active" : ""}`}
          onClick={() => setShowFilters(!showFilters)}
        >
          🔽 Filters
        </button>
      </div>

      {showFilters && (
        <div className="memory-search-filters">
          <div className="filter-group">
            <label>Category</label>
            <div className="filter-options">
              {categories.map((cat) => (
                <button
                  key={cat}
                  type="button"
                  className={`filter-chip ${filters.category === cat ? "active" : ""}`}
                  onClick={() => toggleFilter("category", cat)}
                >
                  {cat}
                </button>
              ))}
            </div>
          </div>

          <div className="filter-group">
            <label>Type</label>
            <div className="filter-options">
              {memoryTypes.map((type) => (
                <button
                  key={type}
                  type="button"
                  className={`filter-chip ${filters.memoryType === type ? "active" : ""}`}
                  onClick={() => toggleFilter("memoryType", type)}
                >
                  {type}
                </button>
              ))}
            </div>
          </div>

          {agentIds.length > 0 && (
            <div className="filter-group">
              <label>Agent</label>
              <div className="filter-options">
                {agentIds.map((id) => (
                  <button
                    key={id}
                    type="button"
                    className={`filter-chip ${filters.agentId === id ? "active" : ""}`}
                    onClick={() => toggleFilter("agentId", id)}
                  >
                    {id}
                  </button>
                ))}
              </div>
            </div>
          )}

          <div className="filter-group">
            <label>Min Confidence</label>
            <input
              type="range"
              min="0"
              max="100"
              value={(filters.minConfidence ?? 0) * 100}
              onChange={(e) =>
                setFilters((prev) => ({
                  ...prev,
                  minConfidence: Number(e.target.value) / 100 || undefined
                }))
              }
            />
            <span>{Math.round((filters.minConfidence ?? 0) * 100)}%</span>
          </div>
        </div>
      )}

      <div className="memory-search-results-header">
        <span>{results.length} results</span>
        {onBulkSelect && (
          <div className="bulk-controls">
            <button type="button" onClick={selectAll}>Select all</button>
            <button type="button" onClick={deselectAll}>Deselect all</button>
            {selectedIds.size > 0 && (
              <button type="button" className="bulk-action" onClick={handleBulkAction}>
                Bulk action ({selectedIds.size})
              </button>
            )}
          </div>
        )}
      </div>

      <div className="memory-search-results">
        {results.map((memory) => (
          <MemorySearchResult
            key={memory.id}
            memory={memory}
            query={query}
            isSelected={selectedIds.has(memory.id)}
            onSelect={() => onSelect?.(memory)}
            onToggleSelect={onBulkSelect ? () => toggleSelect(memory.id) : undefined}
          />
        ))}
        {results.length === 0 && (
          <div className="memory-search-empty">
            No memories found{query ? ` matching "${query}"` : ""}
          </div>
        )}
      </div>
    </div>
  );
}

// Individual result item
type MemorySearchResultProps = {
  memory: Memory;
  query: string;
  isSelected?: boolean;
  onSelect?: () => void;
  onToggleSelect?: () => void;
};

function MemorySearchResult({
  memory,
  query,
  isSelected,
  onSelect,
  onToggleSelect
}: MemorySearchResultProps) {
  return (
    <div
      className={`memory-search-result ${isSelected ? "selected" : ""}`}
      onClick={onSelect}
    >
      {onToggleSelect && (
        <input
          type="checkbox"
          checked={isSelected}
          onChange={onToggleSelect}
          onClick={(e) => e.stopPropagation()}
        />
      )}
      <div className="memory-result-content">
        <div className="memory-result-header">
          <span className="memory-category">{memory.category}</span>
          <span className="memory-type">{memory.memoryType}</span>
          <span className="memory-confidence">{Math.round(memory.confidence * 100)}%</span>
        </div>
        <p className="memory-text">{highlightText(memory.content, query)}</p>
        <div className="memory-meta">
          <span>{formatDate(memory.createdAt)}</span>
          {memory.agentId && <span>Agent: {memory.agentId}</span>}
        </div>
      </div>
    </div>
  );
}

// Highlight matching text
function highlightText(text: string, query: string): ReactNode {
  if (!query.trim()) return text;

  const lowerText = text.toLowerCase();
  const lowerQuery = query.toLowerCase();
  const index = lowerText.indexOf(lowerQuery);

  if (index === -1) return text;

  return (
    <>
      {text.slice(0, index)}
      <mark>{text.slice(index, index + query.length)}</mark>
      {text.slice(index + query.length)}
    </>
  );
}
