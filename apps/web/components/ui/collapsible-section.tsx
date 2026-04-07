"use client";

import { useCallback, useEffect, useState } from "react";

const STORAGE_KEY = "agentic-collapsed-sections";

function getCollapsedSections(): Set<string> {
  if (typeof window === "undefined") return new Set();
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored) {
      return new Set(JSON.parse(stored) as string[]);
    }
  } catch {
    // Ignore parse errors
  }
  return new Set();
}

function saveCollapsedSections(sections: Set<string>): void {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify([...sections]));
  } catch {
    // Ignore storage errors
  }
}

type CollapsibleSectionProps = {
  id: string;
  title: string;
  count?: number;
  countLabel?: string;
  defaultCollapsed?: boolean;
  children: React.ReactNode;
  actions?: React.ReactNode;
  className?: string;
};

export function CollapsibleSection({
  id,
  title,
  count,
  countLabel,
  defaultCollapsed = false,
  children,
  actions,
  className = ""
}: CollapsibleSectionProps) {
  const [isCollapsed, setIsCollapsed] = useState(() => {
    const stored = getCollapsedSections();
    return stored.has(id) ? true : defaultCollapsed;
  });

  const toggle = useCallback(() => {
    setIsCollapsed((prev) => {
      const newValue = !prev;
      const stored = getCollapsedSections();
      if (newValue) {
        stored.add(id);
      } else {
        stored.delete(id);
      }
      saveCollapsedSections(stored);
      return newValue;
    });
  }, [id]);

  return (
    <article className={`card collapsible-section ${isCollapsed ? "collapsed" : ""} ${className}`} id={`section-${id}`}>
      <div className="card-header collapsible-header" onClick={toggle} role="button" tabIndex={0} onKeyDown={(e) => e.key === "Enter" && toggle()}>
        <div className="collapsible-title-row">
          <span className={`collapsible-chevron ${isCollapsed ? "collapsed" : ""}`}>▼</span>
          <h2>{title}</h2>
          {count !== undefined && (
            <span className="collapsible-count">
              {count} {countLabel || ""}
            </span>
          )}
        </div>
        {actions && <div className="collapsible-actions" onClick={(e) => e.stopPropagation()}>{actions}</div>}
      </div>
      {!isCollapsed && <div className="collapsible-content">{children}</div>}
    </article>
  );
}

export function useCollapsedSections() {
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());

  useEffect(() => {
    setCollapsed(getCollapsedSections());
  }, []);

  const collapseAll = useCallback((sectionIds: string[]) => {
    const newSet = new Set(sectionIds);
    saveCollapsedSections(newSet);
    setCollapsed(newSet);
  }, []);

  const expandAll = useCallback(() => {
    saveCollapsedSections(new Set());
    setCollapsed(new Set());
  }, []);

  const isCollapsed = useCallback((id: string) => collapsed.has(id), [collapsed]);

  return { collapsed, collapseAll, expandAll, isCollapsed };
}
