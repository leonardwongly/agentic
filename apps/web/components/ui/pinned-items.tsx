"use client";

import { useCallback, useEffect, useState } from "react";

const STORAGE_KEY = "agentic-pinned-items";

type PinnedItem = {
  id: string;
  type: "goal" | "template" | "agent" | "memory" | "approval";
  label: string;
  pinnedAt: number;
};

function getStoredPins(): PinnedItem[] {
  if (typeof window === "undefined") return [];
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored) {
      return JSON.parse(stored) as PinnedItem[];
    }
  } catch {
    // Ignore
  }
  return [];
}

function saveStoredPins(pins: PinnedItem[]): void {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(pins));
  } catch {
    // Ignore
  }
}

export function usePinnedItems() {
  const [pinnedItems, setPinnedItems] = useState<PinnedItem[]>([]);

  useEffect(() => {
    setPinnedItems(getStoredPins());
  }, []);

  const pinItem = useCallback((item: Omit<PinnedItem, "pinnedAt">) => {
    setPinnedItems((prev) => {
      // Don't add duplicates
      if (prev.some((p) => p.id === item.id && p.type === item.type)) {
        return prev;
      }
      const updated = [{ ...item, pinnedAt: Date.now() }, ...prev];
      saveStoredPins(updated);
      return updated;
    });
  }, []);

  const unpinItem = useCallback((id: string, type: PinnedItem["type"]) => {
    setPinnedItems((prev) => {
      const updated = prev.filter((p) => !(p.id === id && p.type === type));
      saveStoredPins(updated);
      return updated;
    });
  }, []);

  const isPinned = useCallback((id: string, type: PinnedItem["type"]) => {
    return pinnedItems.some((p) => p.id === id && p.type === type);
  }, [pinnedItems]);

  const togglePin = useCallback((item: Omit<PinnedItem, "pinnedAt">) => {
    if (isPinned(item.id, item.type)) {
      unpinItem(item.id, item.type);
    } else {
      pinItem(item);
    }
  }, [isPinned, pinItem, unpinItem]);

  const getPinnedByType = useCallback((type: PinnedItem["type"]) => {
    return pinnedItems.filter((p) => p.type === type);
  }, [pinnedItems]);

  return {
    pinnedItems,
    pinItem,
    unpinItem,
    isPinned,
    togglePin,
    getPinnedByType
  };
}

type PinButtonProps = {
  id: string;
  type: PinnedItem["type"];
  label: string;
  isPinned: boolean;
  onToggle: (item: Omit<PinnedItem, "pinnedAt">) => void;
};

export function PinButton({ id, type, label, isPinned, onToggle }: PinButtonProps) {
  return (
    <button
      type="button"
      className={`pin-button ${isPinned ? "pinned" : ""}`}
      onClick={() => onToggle({ id, type, label })}
      title={isPinned ? "Unpin" : "Pin to top"}
      aria-label={isPinned ? "Unpin item" : "Pin item to top"}
    >
      <span className="pin-icon">{isPinned ? "📌" : "📍"}</span>
    </button>
  );
}

type PinnedItemsBadgeProps = {
  type: PinnedItem["type"];
  pinnedItems: PinnedItem[];
  onSelect: (item: PinnedItem) => void;
};

export function PinnedItemsBadge({ type, pinnedItems, onSelect }: PinnedItemsBadgeProps) {
  const items = pinnedItems.filter((p) => p.type === type);
  
  if (items.length === 0) return null;

  return (
    <div className="pinned-items-badge">
      <span className="pinned-items-icon">📌</span>
      <span className="pinned-items-count">{items.length}</span>
      <div className="pinned-items-dropdown">
        {items.map((item) => (
          <button
            key={`${item.type}-${item.id}`}
            type="button"
            className="pinned-item-link"
            onClick={() => onSelect(item)}
          >
            {item.label}
          </button>
        ))}
      </div>
    </div>
  );
}

type SortWithPinsOptions<T extends { id: string }> = {
  items: T[];
  pinnedIds: Set<string>;
  sortFn?: (a: T, b: T) => number;
};

export function sortWithPins<T extends { id: string }>({
  items,
  pinnedIds,
  sortFn
}: SortWithPinsOptions<T>): T[] {
  const pinned = items.filter((item) => pinnedIds.has(item.id));
  const unpinned = items.filter((item) => !pinnedIds.has(item.id));

  if (sortFn) {
    pinned.sort(sortFn);
    unpinned.sort(sortFn);
  }

  return [...pinned, ...unpinned];
}
