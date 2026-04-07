"use client";

import { useCallback, useEffect, useState, createContext, useContext, type ReactNode } from "react";

type Shortcut = {
  key: string;
  description: string;
  category: string;
  action: () => void;
  enabled?: boolean;
};

type KeyboardContextValue = {
  shortcuts: Map<string, Shortcut>;
  registerShortcut: (id: string, shortcut: Shortcut) => void;
  unregisterShortcut: (id: string) => void;
  showHelp: boolean;
  setShowHelp: (show: boolean) => void;
};

const KeyboardContext = createContext<KeyboardContextValue | null>(null);

export function useKeyboardShortcuts() {
  const context = useContext(KeyboardContext);
  if (!context) {
    throw new Error("useKeyboardShortcuts must be used within KeyboardShortcutsProvider");
  }
  return context;
}

export function useShortcut(id: string, key: string, description: string, category: string, action: () => void, enabled = true) {
  const { registerShortcut, unregisterShortcut } = useKeyboardShortcuts();

  useEffect(() => {
    registerShortcut(id, { key, description, category, action, enabled });
    return () => unregisterShortcut(id);
  }, [id, key, description, category, action, enabled, registerShortcut, unregisterShortcut]);
}

type KeyboardShortcutsProviderProps = {
  children: ReactNode;
};

export function KeyboardShortcutsProvider({ children }: KeyboardShortcutsProviderProps) {
  const [shortcuts, setShortcuts] = useState<Map<string, Shortcut>>(new Map());
  const [showHelp, setShowHelp] = useState(false);

  const registerShortcut = useCallback((id: string, shortcut: Shortcut) => {
    setShortcuts((prev) => new Map(prev).set(id, shortcut));
  }, []);

  const unregisterShortcut = useCallback((id: string) => {
    setShortcuts((prev) => {
      const next = new Map(prev);
      next.delete(id);
      return next;
    });
  }, []);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Ignore when typing in inputs
      const target = e.target as HTMLElement;
      if (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable) {
        // Allow Escape to close help
        if (e.key === "Escape" && showHelp) {
          setShowHelp(false);
          e.preventDefault();
        }
        return;
      }

      // Help modal toggle
      if (e.key === "?" && !e.ctrlKey && !e.metaKey && !e.altKey) {
        e.preventDefault();
        setShowHelp((prev) => !prev);
        return;
      }

      // Close help with Escape
      if (e.key === "Escape" && showHelp) {
        setShowHelp(false);
        e.preventDefault();
        return;
      }

      // Build key string
      const parts: string[] = [];
      if (e.ctrlKey) parts.push("ctrl");
      if (e.metaKey) parts.push("cmd");
      if (e.altKey) parts.push("alt");
      if (e.shiftKey) parts.push("shift");

      const key = e.key.toLowerCase();
      if (!["control", "meta", "alt", "shift"].includes(key)) {
        parts.push(key);
      }
      const keyString = parts.join("+");

      // Find matching shortcut
      for (const shortcut of shortcuts.values()) {
        if (shortcut.enabled !== false && shortcut.key.toLowerCase() === keyString) {
          e.preventDefault();
          shortcut.action();
          return;
        }
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [shortcuts, showHelp]);

  return (
    <KeyboardContext.Provider value={{ shortcuts, registerShortcut, unregisterShortcut, showHelp, setShowHelp }}>
      {children}
      {showHelp && <KeyboardHelpModal onClose={() => setShowHelp(false)} shortcuts={shortcuts} />}
    </KeyboardContext.Provider>
  );
}

function KeyboardHelpModal({ onClose, shortcuts }: { onClose: () => void; shortcuts: Map<string, Shortcut> }) {
  // Group by category
  const grouped = new Map<string, Shortcut[]>();
  for (const shortcut of shortcuts.values()) {
    if (shortcut.enabled === false) continue;
    const list = grouped.get(shortcut.category) ?? [];
    list.push(shortcut);
    grouped.set(shortcut.category, list);
  }

  // Add built-in shortcuts
  const builtIn: Shortcut[] = [
    { key: "?", description: "Show keyboard shortcuts", category: "General", action: () => {} },
    { key: "Escape", description: "Close modal/panel", category: "General", action: () => {} },
    { key: "cmd+k", description: "Open command palette", category: "General", action: () => {} }
  ];
  const generalList = grouped.get("General") ?? [];
  grouped.set("General", [...builtIn, ...generalList]);

  const categoryOrder = ["General", "Navigation", "Actions", "Lists"];

  return (
    <div className="keyboard-help-overlay" onClick={onClose}>
      <div className="keyboard-help-modal" onClick={(e) => e.stopPropagation()}>
        <div className="keyboard-help-header">
          <h2>Keyboard Shortcuts</h2>
          <button type="button" className="keyboard-help-close" onClick={onClose} aria-label="Close">
            <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
              <path d="M15 5L5 15M5 5L15 15" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
            </svg>
          </button>
        </div>
        <div className="keyboard-help-content">
          {categoryOrder.map((category) => {
            const items = grouped.get(category);
            if (!items || items.length === 0) return null;
            return (
              <div key={category} className="keyboard-help-category">
                <h3>{category}</h3>
                <div className="keyboard-help-list">
                  {items.map((shortcut, i) => (
                    <div key={i} className="keyboard-help-item">
                      <kbd className="keyboard-help-key">{formatKey(shortcut.key)}</kbd>
                      <span className="keyboard-help-desc">{shortcut.description}</span>
                    </div>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
        <div className="keyboard-help-footer">
          <span>Press <kbd>?</kbd> to toggle this help</span>
        </div>
      </div>
    </div>
  );
}

function formatKey(key: string): string {
  return key
    .split("+")
    .map((part) => {
      if (part === "cmd") return "⌘";
      if (part === "ctrl") return "⌃";
      if (part === "alt") return "⌥";
      if (part === "shift") return "⇧";
      if (part === "enter") return "↵";
      if (part === "escape") return "Esc";
      if (part === "arrowup") return "↑";
      if (part === "arrowdown") return "↓";
      if (part === "arrowleft") return "←";
      if (part === "arrowright") return "→";
      return part.toUpperCase();
    })
    .join(" ");
}

export function useListNavigation<T>(items: T[], onSelect?: (item: T, index: number) => void) {
  const [selectedIndex, setSelectedIndex] = useState(0);

  const { registerShortcut, unregisterShortcut } = useKeyboardShortcuts();

  useEffect(() => {
    if (selectedIndex >= items.length) {
      setSelectedIndex(Math.max(0, items.length - 1));
    }
  }, [items.length, selectedIndex]);

  useEffect(() => {
    registerShortcut("list-nav-down", {
      key: "j",
      description: "Move down in list",
      category: "Lists",
      action: () => setSelectedIndex((prev) => Math.min(prev + 1, items.length - 1))
    });
    registerShortcut("list-nav-up", {
      key: "k",
      description: "Move up in list",
      category: "Lists",
      action: () => setSelectedIndex((prev) => Math.max(prev - 1, 0))
    });
    registerShortcut("list-nav-select", {
      key: "enter",
      description: "Select item",
      category: "Lists",
      action: () => {
        if (items[selectedIndex] && onSelect) {
          onSelect(items[selectedIndex], selectedIndex);
        }
      }
    });

    return () => {
      unregisterShortcut("list-nav-down");
      unregisterShortcut("list-nav-up");
      unregisterShortcut("list-nav-select");
    };
  }, [items, selectedIndex, onSelect, registerShortcut, unregisterShortcut]);

  return { selectedIndex, setSelectedIndex };
}
