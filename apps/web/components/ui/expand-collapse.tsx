"use client";

import { useState, useCallback, type ReactNode } from "react";

type ExpandCollapseProps = {
  title: string;
  count?: number;
  children: ReactNode;
  defaultExpanded?: boolean;
  className?: string;
  onToggle?: (expanded: boolean) => void;
};

export function ExpandCollapseSection({ title, count, children, defaultExpanded = true, className = "", onToggle }: ExpandCollapseProps) {
  const [expanded, setExpanded] = useState(defaultExpanded);

  const toggle = useCallback(() => {
    setExpanded((prev) => {
      const next = !prev;
      onToggle?.(next);
      return next;
    });
  }, [onToggle]);

  return (
    <div className={`expand-collapse-section ${expanded ? "expanded" : "collapsed"} ${className}`}>
      <button type="button" className="expand-collapse-header" onClick={toggle} aria-expanded={expanded}>
        <span className="expand-collapse-icon" aria-hidden="true">
          {expanded ? "▼" : "▶"}
        </span>
        <span className="expand-collapse-title">{title}</span>
        {typeof count === "number" && <span className="expand-collapse-count">{count}</span>}
        <span className="expand-collapse-action">{expanded ? "Collapse" : "Expand"}</span>
      </button>
      {expanded && <div className="expand-collapse-content">{children}</div>}
    </div>
  );
}

type ExpandAllControlsProps = {
  sections: string[];
  expandedSections: Set<string>;
  onExpandAll: () => void;
  onCollapseAll: () => void;
};

export function ExpandAllControls({ sections, expandedSections, onExpandAll, onCollapseAll }: ExpandAllControlsProps) {
  const allExpanded = sections.every((s) => expandedSections.has(s));
  const allCollapsed = sections.every((s) => !expandedSections.has(s));

  return (
    <div className="expand-all-controls">
      <button type="button" className="expand-all-btn" onClick={onExpandAll} disabled={allExpanded}>
        Expand all
      </button>
      <button type="button" className="expand-all-btn" onClick={onCollapseAll} disabled={allCollapsed}>
        Collapse all
      </button>
    </div>
  );
}
