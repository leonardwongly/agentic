"use client";

import { useCallback, useEffect, useState } from "react";

type RecentAction = {
  id: string;
  type: "approve" | "reject" | "create" | "delete" | "save" | "share";
  label: string;
  timestamp: number;
  undoable: boolean;
  redo?: () => void;
  undo?: () => void;
};

const MAX_ACTIONS = 10;
const STORAGE_KEY = "agentic-recent-actions";

function getStoredActions(): RecentAction[] {
  if (typeof window === "undefined") return [];
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored) {
      const actions = JSON.parse(stored) as RecentAction[];
      // Filter out actions older than 24 hours
      const cutoff = Date.now() - 24 * 60 * 60 * 1000;
      return actions.filter((a) => a.timestamp > cutoff);
    }
  } catch {
    // Ignore
  }
  return [];
}

function saveStoredActions(actions: RecentAction[]): void {
  if (typeof window === "undefined") return;
  try {
    // Only store serializable parts
    const toStore = actions.map(({ id, type, label, timestamp, undoable }) => ({
      id,
      type,
      label,
      timestamp,
      undoable
    }));
    localStorage.setItem(STORAGE_KEY, JSON.stringify(toStore));
  } catch {
    // Ignore
  }
}

export function useRecentActions() {
  const [actions, setActions] = useState<RecentAction[]>([]);

  useEffect(() => {
    setActions(getStoredActions());
  }, []);

  const addAction = useCallback((action: Omit<RecentAction, "id" | "timestamp">) => {
    const newAction: RecentAction = {
      ...action,
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      timestamp: Date.now()
    };

    setActions((prev) => {
      const updated = [newAction, ...prev].slice(0, MAX_ACTIONS);
      saveStoredActions(updated);
      return updated;
    });

    return newAction.id;
  }, []);

  const removeAction = useCallback((id: string) => {
    setActions((prev) => {
      const updated = prev.filter((a) => a.id !== id);
      saveStoredActions(updated);
      return updated;
    });
  }, []);

  const clearActions = useCallback(() => {
    setActions([]);
    saveStoredActions([]);
  }, []);

  return {
    actions,
    addAction,
    removeAction,
    clearActions,
    recentActions: actions.slice(0, 5)
  };
}

type RecentActionsBarProps = {
  actions: RecentAction[];
  onRedo?: (action: RecentAction) => void;
  onClear?: () => void;
  maxDisplay?: number;
};

export function RecentActionsBar({
  actions,
  onRedo,
  onClear,
  maxDisplay = 5
}: RecentActionsBarProps) {
  if (actions.length === 0) return null;

  const displayActions = actions.slice(0, maxDisplay);

  const actionIcons: Record<RecentAction["type"], string> = {
    approve: "✓",
    reject: "✗",
    create: "+",
    delete: "−",
    save: "💾",
    share: "↗"
  };

  return (
    <div className="recent-actions-bar">
      <span className="recent-actions-label">Recent:</span>
      <div className="recent-actions-list">
        {displayActions.map((action) => (
          <button
            key={action.id}
            type="button"
            className={`recent-action-item recent-action-${action.type}`}
            onClick={() => action.redo ? action.redo() : onRedo?.(action)}
            title={`Redo: ${action.label}`}
          >
            <span className="recent-action-icon">{actionIcons[action.type]}</span>
            <span className="recent-action-label">{action.label}</span>
          </button>
        ))}
      </div>
      {onClear && (
        <button
          type="button"
          className="recent-actions-clear"
          onClick={onClear}
          title="Clear recent actions"
        >
          Clear
        </button>
      )}
    </div>
  );
}

type ActionIconProps = {
  type: RecentAction["type"];
  size?: "sm" | "md" | "lg";
};

export function ActionIcon({ type, size = "md" }: ActionIconProps) {
  const icons: Record<RecentAction["type"], string> = {
    approve: "✓",
    reject: "✗",
    create: "+",
    delete: "−",
    save: "💾",
    share: "↗"
  };

  return (
    <span className={`action-icon action-icon-${type} action-icon-${size}`}>
      {icons[type]}
    </span>
  );
}
