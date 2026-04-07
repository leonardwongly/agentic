"use client";

import { useCallback, useEffect, useState, type ReactNode } from "react";

export type ToastType = "success" | "error" | "warning" | "info";

export type Toast = {
  id: string;
  type: ToastType;
  title: string;
  description?: string;
  duration?: number;
  action?: {
    label: string;
    onClick: () => void;
  };
  undoAction?: () => void;
};

type ToastContextValue = {
  toasts: Toast[];
  addToast: (toast: Omit<Toast, "id">) => string;
  removeToast: (id: string) => void;
  success: (title: string, description?: string) => string;
  error: (title: string, description?: string) => string;
  warning: (title: string, description?: string) => string;
  info: (title: string, description?: string) => string;
  withUndo: (title: string, undoAction: () => void, duration?: number) => string;
};

let toastListeners: Array<(toasts: Toast[]) => void> = [];
let toasts: Toast[] = [];
let toastId = 0;

function notifyListeners() {
  toastListeners.forEach((listener) => listener([...toasts]));
}

export const toast = {
  add(t: Omit<Toast, "id">): string {
    const id = `toast-${++toastId}`;
    toasts = [...toasts, { ...t, id }];
    notifyListeners();

    const duration = t.duration ?? 5000;
    if (duration > 0) {
      setTimeout(() => toast.remove(id), duration);
    }

    return id;
  },

  remove(id: string) {
    toasts = toasts.filter((t) => t.id !== id);
    notifyListeners();
  },

  success(title: string, description?: string) {
    return toast.add({ type: "success", title, description });
  },

  error(title: string, description?: string) {
    return toast.add({ type: "error", title, description, duration: 8000 });
  },

  warning(title: string, description?: string) {
    return toast.add({ type: "warning", title, description });
  },

  info(title: string, description?: string) {
    return toast.add({ type: "info", title, description });
  },

  withUndo(title: string, undoAction: () => void, duration = 10000) {
    return toast.add({
      type: "info",
      title,
      duration,
      action: {
        label: "Undo",
        onClick: () => {
          undoAction();
          toast.success("Action undone");
        }
      }
    });
  }
};

export function useToasts(): Toast[] {
  const [state, setState] = useState<Toast[]>([]);

  useEffect(() => {
    const listener = (newToasts: Toast[]) => setState(newToasts);
    toastListeners.push(listener);
    setState(toasts);
    return () => {
      toastListeners = toastListeners.filter((l) => l !== listener);
    };
  }, []);

  return state;
}

export function ToastContainer() {
  const toastList = useToasts();

  if (toastList.length === 0) return null;

  return (
    <div className="toast-container" role="region" aria-label="Notifications">
      {toastList.map((t) => (
        <ToastItem key={t.id} toast={t} />
      ))}
    </div>
  );
}

function ToastItem({ toast: t }: { toast: Toast }) {
  const handleDismiss = useCallback(() => {
    toast.remove(t.id);
  }, [t.id]);

  const icon = {
    success: "✓",
    error: "✕",
    warning: "⚠",
    info: "ℹ"
  }[t.type];

  return (
    <div className={`toast toast-${t.type}`} role="alert">
      <span className="toast-icon" aria-hidden="true">{icon}</span>
      <div className="toast-content">
        <strong className="toast-title">{t.title}</strong>
        {t.description && <p className="toast-description">{t.description}</p>}
      </div>
      {t.action && (
        <button
          type="button"
          className="toast-action"
          onClick={() => {
            t.action?.onClick();
            handleDismiss();
          }}
        >
          {t.action.label}
        </button>
      )}
      <button type="button" className="toast-dismiss" onClick={handleDismiss} aria-label="Dismiss">
        ✕
      </button>
    </div>
  );
}
