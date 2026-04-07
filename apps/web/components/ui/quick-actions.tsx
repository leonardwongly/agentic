"use client";

import { useMemo, type ReactNode } from "react";
import { useKeyboardShortcuts } from "./keyboard-shortcuts";

type QuickAction = {
  id: string;
  label: string;
  icon: ReactNode;
  onClick: () => void;
  shortcut?: string;
  disabled?: boolean;
  variant?: "primary" | "secondary" | "danger";
  badge?: number;
};

type QuickActionsBarProps = {
  actions: QuickAction[];
  contextActions?: QuickAction[];
  className?: string;
};

export function QuickActionsBar({ actions, contextActions, className = "" }: QuickActionsBarProps) {
  const allActions = useMemo(() => {
    if (!contextActions || contextActions.length === 0) return actions;
    return [...actions, { id: "divider", label: "", icon: null, onClick: () => {} }, ...contextActions];
  }, [actions, contextActions]);

  return (
    <div className={`quick-actions-bar ${className}`} role="toolbar" aria-label="Quick actions">
      {allActions.map((action) => {
        if (action.id === "divider") {
          return <div key="divider" className="quick-actions-divider" />;
        }

        const variantClass = action.variant ? `quick-action-${action.variant}` : "";

        return (
          <button
            key={action.id}
            type="button"
            className={`quick-action ${variantClass}`}
            onClick={action.onClick}
            disabled={action.disabled}
            title={action.shortcut ? `${action.label} (${action.shortcut})` : action.label}
            aria-label={action.label}
          >
            <span className="quick-action-icon">{action.icon}</span>
            <span className="quick-action-label">{action.label}</span>
            {typeof action.badge === "number" && action.badge > 0 && (
              <span className="quick-action-badge">{action.badge > 99 ? "99+" : action.badge}</span>
            )}
            {action.shortcut && <kbd className="quick-action-shortcut">{action.shortcut}</kbd>}
          </button>
        );
      })}
    </div>
  );
}

export function FloatingActionsBar({ children, position = "bottom" }: { children: ReactNode; position?: "top" | "bottom" }) {
  return (
    <div className={`floating-actions-bar floating-actions-${position}`}>
      {children}
    </div>
  );
}
