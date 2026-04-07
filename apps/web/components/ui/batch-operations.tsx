"use client";

import { useCallback, useState } from "react";

type BatchItem = {
  id: string;
  type: "goal" | "approval" | "memory" | "template" | "agent";
  label: string;
  data: unknown;
};

export function useBatchSelection<T extends { id: string }>(items: T[], type: BatchItem["type"]) {
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

  const toggle = useCallback((id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  }, []);

  const selectAll = useCallback(() => {
    setSelectedIds(new Set(items.map((i) => i.id)));
  }, [items]);

  const deselectAll = useCallback(() => {
    setSelectedIds(new Set());
  }, []);

  const isSelected = useCallback((id: string) => selectedIds.has(id), [selectedIds]);

  const selectedItems = items.filter((i) => selectedIds.has(i.id));
  const selectedCount = selectedIds.size;
  const hasSelection = selectedCount > 0;
  const allSelected = selectedCount === items.length && items.length > 0;

  return {
    selectedIds,
    selectedItems,
    selectedCount,
    hasSelection,
    allSelected,
    toggle,
    selectAll,
    deselectAll,
    isSelected
  };
}

type BatchActionsBarProps = {
  selectedCount: number;
  entityType: string;
  onSelectAll: () => void;
  onDeselectAll: () => void;
  allSelected: boolean;
  children: React.ReactNode;
};

export function BatchActionsBar({
  selectedCount,
  entityType,
  onSelectAll,
  onDeselectAll,
  allSelected,
  children
}: BatchActionsBarProps) {
  if (selectedCount === 0) return null;

  return (
    <div className="batch-actions-bar">
      <div className="batch-actions-info">
        <span className="batch-count">{selectedCount}</span>
        <span className="batch-label">{entityType}{selectedCount !== 1 ? "s" : ""} selected</span>
      </div>
      <div className="batch-actions-buttons">
        <button
          type="button"
          className="batch-action-button secondary"
          onClick={allSelected ? onDeselectAll : onSelectAll}
        >
          {allSelected ? "Deselect All" : "Select All"}
        </button>
        {children}
      </div>
      <button
        type="button"
        className="batch-close"
        onClick={onDeselectAll}
        aria-label="Clear selection"
      >
        ✕
      </button>
    </div>
  );
}

type SelectableItemProps = {
  id: string;
  isSelected: boolean;
  onToggle: (id: string) => void;
  children: React.ReactNode;
  className?: string;
};

export function SelectableItem({
  id,
  isSelected,
  onToggle,
  children,
  className = ""
}: SelectableItemProps) {
  return (
    <div className={`selectable-item ${isSelected ? "selected" : ""} ${className}`}>
      <label className="selectable-checkbox" onClick={(e) => e.stopPropagation()}>
        <input
          type="checkbox"
          checked={isSelected}
          onChange={() => onToggle(id)}
          aria-label="Select item"
        />
        <span className="checkbox-visual" />
      </label>
      <div className="selectable-content">{children}</div>
    </div>
  );
}

type BatchConfirmDialogProps = {
  isOpen: boolean;
  title: string;
  message: string;
  count: number;
  actionLabel: string;
  actionVariant?: "primary" | "danger";
  onConfirm: () => void;
  onCancel: () => void;
  isPending?: boolean;
};

export function BatchConfirmDialog({
  isOpen,
  title,
  message,
  count,
  actionLabel,
  actionVariant = "primary",
  onConfirm,
  onCancel,
  isPending = false
}: BatchConfirmDialogProps) {
  if (!isOpen) return null;

  return (
    <div className="batch-confirm-overlay" onClick={onCancel}>
      <div className="batch-confirm-dialog" onClick={(e) => e.stopPropagation()}>
        <h3>{title}</h3>
        <p>
          {message.replace("{count}", String(count))}
        </p>
        <div className="batch-confirm-actions">
          <button
            type="button"
            className="secondary-button"
            onClick={onCancel}
            disabled={isPending}
          >
            Cancel
          </button>
          <button
            type="button"
            className={`${actionVariant === "danger" ? "danger-button" : "primary-button"}`}
            onClick={onConfirm}
            disabled={isPending}
          >
            {isPending ? "Processing..." : actionLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
