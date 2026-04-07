"use client";

import { useCallback, useState } from "react";

// Bulk memory operations: Select multiple memories, bulk delete, bulk re-categorize, bulk export

export type Memory = {
  id: string;
  category: string;
  content: string;
  memoryType: string;
  confidence: number;
  createdAt: string;
  agentId?: string;
};

type BulkMemoryOperation = "delete" | "recategorize" | "export" | "change-type";

type BulkMemoryActionsProps = {
  selectedMemories: Memory[];
  categories: string[];
  memoryTypes: string[];
  onDelete: (ids: string[]) => Promise<void>;
  onRecategorize: (ids: string[], newCategory: string) => Promise<void>;
  onChangeType: (ids: string[], newType: string) => Promise<void>;
  onExport: (memories: Memory[]) => void;
  onClear: () => void;
};

export function BulkMemoryActions({
  selectedMemories,
  categories,
  memoryTypes,
  onDelete,
  onRecategorize,
  onChangeType,
  onExport,
  onClear
}: BulkMemoryActionsProps) {
  const [operation, setOperation] = useState<BulkMemoryOperation | null>(null);
  const [targetValue, setTargetValue] = useState("");
  const [isProcessing, setIsProcessing] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);

  const handleOperation = async () => {
    if (!operation || selectedMemories.length === 0) return;
    setIsProcessing(true);

    try {
      const ids = selectedMemories.map((m) => m.id);

      switch (operation) {
        case "delete":
          if (!confirmDelete) {
            setConfirmDelete(true);
            setIsProcessing(false);
            return;
          }
          await onDelete(ids);
          break;
        case "recategorize":
          if (!targetValue) return;
          await onRecategorize(ids, targetValue);
          break;
        case "change-type":
          if (!targetValue) return;
          await onChangeType(ids, targetValue);
          break;
        case "export":
          onExport(selectedMemories);
          break;
      }

      // Reset state
      setOperation(null);
      setTargetValue("");
      setConfirmDelete(false);
      onClear();
    } finally {
      setIsProcessing(false);
    }
  };

  if (selectedMemories.length === 0) return null;

  return (
    <div className="bulk-memory-actions">
      <div className="bulk-memory-header">
        <span className="bulk-count">{selectedMemories.length} memories selected</span>
        <button type="button" className="bulk-clear" onClick={onClear}>
          Clear selection
        </button>
      </div>

      <div className="bulk-memory-operations">
        <button
          type="button"
          className={`bulk-op-btn ${operation === "delete" ? "active" : ""}`}
          onClick={() => {
            setOperation("delete");
            setConfirmDelete(false);
          }}
        >
          🗑️ Delete
        </button>
        <button
          type="button"
          className={`bulk-op-btn ${operation === "recategorize" ? "active" : ""}`}
          onClick={() => setOperation("recategorize")}
        >
          📁 Re-categorize
        </button>
        <button
          type="button"
          className={`bulk-op-btn ${operation === "change-type" ? "active" : ""}`}
          onClick={() => setOperation("change-type")}
        >
          🏷️ Change type
        </button>
        <button
          type="button"
          className={`bulk-op-btn ${operation === "export" ? "active" : ""}`}
          onClick={() => {
            setOperation("export");
            onExport(selectedMemories);
          }}
        >
          📤 Export
        </button>
      </div>

      {operation === "delete" && (
        <div className="bulk-memory-confirm">
          {confirmDelete ? (
            <>
              <p className="confirm-warning">
                ⚠️ This will permanently delete {selectedMemories.length} memories. This action cannot be undone.
              </p>
              <div className="confirm-actions">
                <button
                  type="button"
                  className="danger-button"
                  onClick={handleOperation}
                  disabled={isProcessing}
                >
                  {isProcessing ? "Deleting..." : "Confirm Delete"}
                </button>
                <button
                  type="button"
                  className="secondary-button"
                  onClick={() => {
                    setOperation(null);
                    setConfirmDelete(false);
                  }}
                >
                  Cancel
                </button>
              </div>
            </>
          ) : (
            <button
              type="button"
              className="danger-button"
              onClick={handleOperation}
            >
              Delete {selectedMemories.length} memories
            </button>
          )}
        </div>
      )}

      {operation === "recategorize" && (
        <div className="bulk-memory-form">
          <label>New category:</label>
          <select
            value={targetValue}
            onChange={(e) => setTargetValue(e.target.value)}
            className="bulk-select"
          >
            <option value="">Select category...</option>
            {categories.map((cat) => (
              <option key={cat} value={cat}>
                {cat}
              </option>
            ))}
          </select>
          <div className="bulk-form-actions">
            <button
              type="button"
              className="primary-button"
              onClick={handleOperation}
              disabled={!targetValue || isProcessing}
            >
              {isProcessing ? "Updating..." : `Update ${selectedMemories.length} memories`}
            </button>
            <button
              type="button"
              className="secondary-button"
              onClick={() => setOperation(null)}
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {operation === "change-type" && (
        <div className="bulk-memory-form">
          <label>New memory type:</label>
          <select
            value={targetValue}
            onChange={(e) => setTargetValue(e.target.value)}
            className="bulk-select"
          >
            <option value="">Select type...</option>
            {memoryTypes.map((type) => (
              <option key={type} value={type}>
                {type}
              </option>
            ))}
          </select>
          <div className="bulk-form-actions">
            <button
              type="button"
              className="primary-button"
              onClick={handleOperation}
              disabled={!targetValue || isProcessing}
            >
              {isProcessing ? "Updating..." : `Update ${selectedMemories.length} memories`}
            </button>
            <button
              type="button"
              className="secondary-button"
              onClick={() => setOperation(null)}
            >
              Cancel
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

// Export memories as JSON
export function exportMemoriesAsJson(memories: Memory[]): void {
  const data = JSON.stringify(memories, null, 2);
  const blob = new Blob([data], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `agentic-memories-${new Date().toISOString().split("T")[0]}.json`;
  link.click();
  URL.revokeObjectURL(url);
}

// Export memories as CSV
export function exportMemoriesAsCsv(memories: Memory[]): void {
  const headers = ["id", "category", "content", "memoryType", "confidence", "createdAt", "agentId"];
  const rows = memories.map((m) => [
    m.id,
    m.category,
    `"${m.content.replace(/"/g, '""')}"`,
    m.memoryType,
    m.confidence.toString(),
    m.createdAt,
    m.agentId || ""
  ]);

  const csv = [headers.join(","), ...rows.map((r) => r.join(","))].join("\n");
  const blob = new Blob([csv], { type: "text/csv" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `agentic-memories-${new Date().toISOString().split("T")[0]}.csv`;
  link.click();
  URL.revokeObjectURL(url);
}

// Hook for bulk memory selection
export function useBulkMemorySelection() {
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

  const selectAll = useCallback((ids: string[]) => {
    setSelectedIds(new Set(ids));
  }, []);

  const deselectAll = useCallback(() => {
    setSelectedIds(new Set());
  }, []);

  const isSelected = useCallback((id: string) => selectedIds.has(id), [selectedIds]);

  return {
    selectedIds,
    toggle,
    selectAll,
    deselectAll,
    isSelected,
    count: selectedIds.size
  };
}
