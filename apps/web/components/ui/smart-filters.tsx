"use client";

import { useState, useMemo, type ReactNode } from "react";

export type FilterOption<T = string> = {
  id: string;
  label: string;
  value: T;
};

export type FilterConfig = {
  id: string;
  label: string;
  type: "select" | "multi-select" | "date-range" | "search";
  options?: FilterOption[];
};

export type FilterValues = Record<string, string | string[] | { from?: string; to?: string }>;

type SmartFiltersProps = {
  filters: FilterConfig[];
  values: FilterValues;
  onChange: (values: FilterValues) => void;
  onSaveView?: (name: string) => void;
  savedViews?: Array<{ id: string; name: string; values: FilterValues }>;
  onLoadView?: (id: string) => void;
  className?: string;
};

export function SmartFilters({ filters, values, onChange, onSaveView, savedViews, onLoadView, className = "" }: SmartFiltersProps) {
  const [showSaveDialog, setShowSaveDialog] = useState(false);
  const [viewName, setViewName] = useState("");

  const activeFilterCount = useMemo(() => {
    let count = 0;
    for (const key in values) {
      const val = values[key];
      if (Array.isArray(val) && val.length > 0) count++;
      else if (typeof val === "object" && val !== null && !Array.isArray(val) && ("from" in val || "to" in val)) count++;
      else if (typeof val === "string" && val) count++;
    }
    return count;
  }, [values]);

  const handleClearAll = () => {
    onChange({});
  };

  const handleFilterChange = (id: string, value: string | string[] | { from?: string; to?: string }) => {
    onChange({ ...values, [id]: value });
  };

  const handleSaveView = () => {
    if (viewName.trim() && onSaveView) {
      onSaveView(viewName.trim());
      setViewName("");
      setShowSaveDialog(false);
    }
  };

  return (
    <div className={`smart-filters ${className}`}>
      <div className="smart-filters-row">
        {filters.map((filter) => (
          <div key={filter.id} className="smart-filter">
            <label className="smart-filter-label">{filter.label}</label>
            {filter.type === "select" && filter.options && (
              <select
                value={(values[filter.id] as string) ?? ""}
                onChange={(e) => handleFilterChange(filter.id, e.target.value)}
                className="smart-filter-select"
              >
                <option value="">All</option>
                {filter.options.map((opt) => (
                  <option key={opt.id} value={opt.value}>{opt.label}</option>
                ))}
              </select>
            )}
            {filter.type === "search" && (
              <input
                type="text"
                value={(values[filter.id] as string) ?? ""}
                onChange={(e) => handleFilterChange(filter.id, e.target.value)}
                placeholder={`Search ${filter.label.toLowerCase()}...`}
                className="smart-filter-input"
              />
            )}
            {filter.type === "multi-select" && filter.options && (
              <MultiSelectFilter
                options={filter.options}
                value={(values[filter.id] as string[]) ?? []}
                onChange={(v) => handleFilterChange(filter.id, v)}
              />
            )}
            {filter.type === "date-range" && (
              <DateRangeFilter
                value={(values[filter.id] as { from?: string; to?: string }) ?? {}}
                onChange={(v) => handleFilterChange(filter.id, v)}
              />
            )}
          </div>
        ))}
      </div>

      <div className="smart-filters-actions">
        {activeFilterCount > 0 && (
          <button type="button" className="smart-filter-clear" onClick={handleClearAll}>
            Clear all ({activeFilterCount})
          </button>
        )}

        {savedViews && savedViews.length > 0 && (
          <select
            className="smart-filter-views"
            value=""
            onChange={(e) => onLoadView?.(e.target.value)}
          >
            <option value="">Load saved view...</option>
            {savedViews.map((view) => (
              <option key={view.id} value={view.id}>{view.name}</option>
            ))}
          </select>
        )}

        {onSaveView && (
          <button type="button" className="smart-filter-save" onClick={() => setShowSaveDialog(true)}>
            Save view
          </button>
        )}
      </div>

      {showSaveDialog && (
        <div className="smart-filter-save-dialog">
          <input
            type="text"
            value={viewName}
            onChange={(e) => setViewName(e.target.value)}
            placeholder="View name..."
            autoFocus
          />
          <button type="button" onClick={handleSaveView}>Save</button>
          <button type="button" onClick={() => setShowSaveDialog(false)}>Cancel</button>
        </div>
      )}
    </div>
  );
}

function MultiSelectFilter({ options, value, onChange }: {
  options: FilterOption[];
  value: string[];
  onChange: (value: string[]) => void;
}) {
  const [isOpen, setIsOpen] = useState(false);

  const toggleOption = (optValue: string) => {
    if (value.includes(optValue)) {
      onChange(value.filter((v) => v !== optValue));
    } else {
      onChange([...value, optValue]);
    }
  };

  return (
    <div className="multi-select">
      <button type="button" className="multi-select-trigger" onClick={() => setIsOpen(!isOpen)}>
        {value.length === 0 ? "All" : `${value.length} selected`}
        <span className="multi-select-arrow">{isOpen ? "▲" : "▼"}</span>
      </button>
      {isOpen && (
        <div className="multi-select-dropdown">
          {options.map((opt) => (
            <label key={opt.id} className="multi-select-option">
              <input
                type="checkbox"
                checked={value.includes(opt.value)}
                onChange={() => toggleOption(opt.value)}
              />
              {opt.label}
            </label>
          ))}
        </div>
      )}
    </div>
  );
}

function DateRangeFilter({ value, onChange }: {
  value: { from?: string; to?: string };
  onChange: (value: { from?: string; to?: string }) => void;
}) {
  return (
    <div className="date-range">
      <input
        type="date"
        value={value.from ?? ""}
        onChange={(e) => onChange({ ...value, from: e.target.value })}
        className="date-range-input"
      />
      <span className="date-range-separator">to</span>
      <input
        type="date"
        value={value.to ?? ""}
        onChange={(e) => onChange({ ...value, to: e.target.value })}
        className="date-range-input"
      />
    </div>
  );
}

export function useSmartFilters<T>(items: T[], filters: FilterConfig[], applyFilters: (items: T[], values: FilterValues) => T[]) {
  const [values, setValues] = useState<FilterValues>({});

  const filteredItems = useMemo(() => applyFilters(items, values), [items, values, applyFilters]);

  return {
    values,
    setValues,
    filteredItems,
    filterProps: {
      filters,
      values,
      onChange: setValues
    }
  };
}
