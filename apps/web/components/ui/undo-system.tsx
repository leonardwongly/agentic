"use client";

import { useCallback, useEffect, useState, createContext, useContext, useRef, type ReactNode } from "react";

// Undo system: Every destructive action has a 5-second undo window

type UndoableAction = {
  id: string;
  type: string;
  description: string;
  undo: () => Promise<void>;
  createdAt: number;
  expiresAt: number;
};

type UndoContextValue = {
  actions: UndoableAction[];
  registerUndo: (type: string, description: string, undo: () => Promise<void>, timeoutMs?: number) => string;
  executeUndo: (id: string) => Promise<void>;
  dismissUndo: (id: string) => void;
  clearAll: () => void;
};

const UndoContext = createContext<UndoContextValue | null>(null);

export function useUndo() {
  const context = useContext(UndoContext);
  if (!context) {
    throw new Error("useUndo must be used within UndoProvider");
  }
  return context;
}

type UndoProviderProps = {
  children: ReactNode;
  maxActions?: number;
  defaultTimeout?: number;
};

export function UndoProvider({ children, maxActions = 5, defaultTimeout = 5000 }: UndoProviderProps) {
  const [actions, setActions] = useState<UndoableAction[]>([]);
  const timersRef = useRef<Map<string, NodeJS.Timeout>>(new Map());

  const dismissUndo = useCallback((id: string) => {
    setActions((prev) => prev.filter((a) => a.id !== id));
    const timer = timersRef.current.get(id);
    if (timer) {
      clearTimeout(timer);
      timersRef.current.delete(id);
    }
  }, []);

  const registerUndo = useCallback(
    (type: string, description: string, undo: () => Promise<void>, timeoutMs = defaultTimeout): string => {
      const id = `undo-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      const now = Date.now();
      const action: UndoableAction = {
        id,
        type,
        description,
        undo,
        createdAt: now,
        expiresAt: now + timeoutMs
      };

      setActions((prev) => {
        const next = [action, ...prev];
        if (next.length > maxActions) {
          const removed = next.pop();
          if (removed) {
            const timer = timersRef.current.get(removed.id);
            if (timer) clearTimeout(timer);
            timersRef.current.delete(removed.id);
          }
        }
        return next;
      });

      // Auto-dismiss after timeout
      const timer = setTimeout(() => dismissUndo(id), timeoutMs);
      timersRef.current.set(id, timer);

      return id;
    },
    [defaultTimeout, maxActions, dismissUndo]
  );

  const executeUndo = useCallback(
    async (id: string) => {
      const action = actions.find((a) => a.id === id);
      if (!action) return;

      try {
        await action.undo();
      } finally {
        dismissUndo(id);
      }
    },
    [actions, dismissUndo]
  );

  const clearAll = useCallback(() => {
    for (const timer of timersRef.current.values()) {
      clearTimeout(timer);
    }
    timersRef.current.clear();
    setActions([]);
  }, []);

  // Cleanup timers on unmount
  useEffect(() => {
    return () => {
      for (const timer of timersRef.current.values()) {
        clearTimeout(timer);
      }
    };
  }, []);

  return (
    <UndoContext.Provider value={{ actions, registerUndo, executeUndo, dismissUndo, clearAll }}>
      {children}
      <UndoToastContainer actions={actions} onUndo={executeUndo} onDismiss={dismissUndo} />
    </UndoContext.Provider>
  );
}

// Undo toast container
function UndoToastContainer({
  actions,
  onUndo,
  onDismiss
}: {
  actions: UndoableAction[];
  onUndo: (id: string) => void;
  onDismiss: (id: string) => void;
}) {
  if (actions.length === 0) return null;

  return (
    <div className="undo-toast-container">
      {actions.map((action) => (
        <UndoToast key={action.id} action={action} onUndo={() => onUndo(action.id)} onDismiss={() => onDismiss(action.id)} />
      ))}
    </div>
  );
}

function UndoToast({
  action,
  onUndo,
  onDismiss
}: {
  action: UndoableAction;
  onUndo: () => void;
  onDismiss: () => void;
}) {
  const [progress, setProgress] = useState(100);

  useEffect(() => {
    const duration = action.expiresAt - action.createdAt;
    const interval = setInterval(() => {
      const remaining = action.expiresAt - Date.now();
      setProgress(Math.max(0, (remaining / duration) * 100));
    }, 50);

    return () => clearInterval(interval);
  }, [action.createdAt, action.expiresAt]);

  return (
    <div className="undo-toast">
      <div className="undo-toast-content">
        <span className="undo-toast-icon">↩️</span>
        <span className="undo-toast-message">{action.description}</span>
        <button type="button" className="undo-toast-button" onClick={onUndo}>
          Undo
        </button>
        <button type="button" className="undo-toast-dismiss" onClick={onDismiss} aria-label="Dismiss">
          ×
        </button>
      </div>
      <div className="undo-toast-progress" style={{ width: `${progress}%` }} />
    </div>
  );
}

// Hook for common undo patterns
export function useUndoableAction() {
  const { registerUndo } = useUndo();

  const withUndo = useCallback(
    <T,>(
      action: () => Promise<T>,
      undoAction: () => Promise<void>,
      description: string,
      type = "action"
    ): Promise<T> => {
      return action().then((result) => {
        registerUndo(type, description, undoAction);
        return result;
      });
    },
    [registerUndo]
  );

  return { withUndo, registerUndo };
}

// Common undo actions factory
export function createUndoActions(refreshDashboard: () => Promise<void>) {
  return {
    approval: (id: string, previousDecision: "pending" | "approved" | "rejected") => ({
      description: `Approval ${previousDecision === "pending" ? "decision" : "restored to " + previousDecision}`,
      undo: async () => {
        await fetch(`/api/approvals/${id}`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ decision: previousDecision })
        });
        await refreshDashboard();
      }
    }),

    memory: (memory: { id: string; category: string; content: string; memoryType: string; confidence: number }) => ({
      description: `Memory "${memory.content.slice(0, 30)}..." deleted`,
      undo: async () => {
        await fetch("/api/memory", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            id: memory.id,
            category: memory.category,
            content: memory.content,
            memoryType: memory.memoryType,
            confidence: memory.confidence
          })
        });
        await refreshDashboard();
      }
    }),

    goal: (goal: { id: string; request: string }) => ({
      description: `Goal "${goal.request.slice(0, 30)}..." cancelled`,
      undo: async () => {
        // Re-submit the goal
        await fetch("/api/goals", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ request: goal.request })
        });
        await refreshDashboard();
      }
    })
  };
}
