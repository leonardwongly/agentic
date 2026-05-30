"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";

// Command Palette 2.0: Context-aware, fuzzy search, recent commands, vim-style shortcuts

export type CommandCategory = "navigation" | "action" | "search" | "recent" | "contextual";

export type Command = {
  id: string;
  label: string;
  description?: string;
  category: CommandCategory;
  keywords?: string[];
  shortcut?: string;
  action: () => void | Promise<void>;
  icon?: ReactNode;
  disabled?: boolean;
  hidden?: boolean;
};

type CommandPaletteV2Props = {
  isOpen: boolean;
  onClose: () => void;
  commands: Command[];
  recentCommandIds?: string[];
  onCommandExecuted?: (id: string) => void;
  contextualCommands?: Command[];
  placeholder?: string;
  defaultAccountKeywords?: string[];
};

export function CommandPaletteV2({
  isOpen,
  onClose,
  commands,
  recentCommandIds = [],
  onCommandExecuted,
  contextualCommands = [],
  placeholder = "Type a command or search...",
  defaultAccountKeywords = []
}: CommandPaletteV2Props) {
  const [query, setQuery] = useState("");
  const [selectedIndex, setSelectedIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  // Combine and filter commands
  const filteredCommands = useMemo(() => {
    const allCommands = [...contextualCommands, ...commands].filter((c) => !c.hidden && !c.disabled);

    if (!query.trim()) {
      // Show contextual first, then recent, then all by category
      const contextual = allCommands.filter((c) => c.category === "contextual");
      const recent = recentCommandIds
        .map((id) => allCommands.find((c) => c.id === id))
        .filter((c): c is Command => !!c)
        .slice(0, 3);
      const rest = allCommands
        .filter((c) => c.category !== "contextual" && !recentCommandIds.includes(c.id))
        .slice(0, 10);

      return [...contextual, ...recent.map((c) => ({ ...c, category: "recent" as CommandCategory })), ...rest];
    }

    // Fuzzy search
    const lowerQuery = query.toLowerCase();
    const scored = allCommands.map((cmd) => {
      let score = 0;
      const label = cmd.label.toLowerCase();
      const desc = (cmd.description || "").toLowerCase();
      const keywords = (cmd.keywords || []).join(" ").toLowerCase();

      // Exact match in label
      if (label === lowerQuery) score += 100;
      // Starts with query
      else if (label.startsWith(lowerQuery)) score += 50;
      // Contains query
      else if (label.includes(lowerQuery)) score += 25;
      // Description match
      if (desc.includes(lowerQuery)) score += 10;
      // Keyword match
      if (keywords.includes(lowerQuery)) score += 15;
      // Fuzzy match (characters in order)
      if (fuzzyMatch(lowerQuery, label)) score += 5;

      // Default account prioritization
      if (defaultAccountKeywords.length > 0) {
        const matchesAccount = defaultAccountKeywords.some(
          (k) => label.includes(k.toLowerCase()) || desc.includes(k.toLowerCase()) || keywords.includes(k.toLowerCase())
        );
        if (matchesAccount) score += 20;
      }

      return { cmd, score };
    });

    return scored
      .filter((s) => s.score > 0)
      .sort((a, b) => b.score - a.score)
      .map((s) => s.cmd)
      .slice(0, 15);
  }, [commands, contextualCommands, query, recentCommandIds]);

  // Reset selection when results change
  useEffect(() => {
    setSelectedIndex(0);
  }, [filteredCommands.length]);

  // Focus input when opened
  useEffect(() => {
    if (isOpen) {
      inputRef.current?.focus();
      setQuery("");
    }
  }, [isOpen]);

  // Scroll selected item into view
  useEffect(() => {
    if (!listRef.current) return;
    const selected = listRef.current.querySelector(`[data-index="${selectedIndex}"]`);
    selected?.scrollIntoView({ block: "nearest" });
  }, [selectedIndex]);

  const executeCommand = useCallback(
    (cmd: Command) => {
      onClose();
      cmd.action();
      onCommandExecuted?.(cmd.id);
    },
    [onClose, onCommandExecuted]
  );

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      switch (e.key) {
        case "ArrowDown":
        case "Tab":
          if (!e.shiftKey) {
            e.preventDefault();
            setSelectedIndex((prev) => Math.min(prev + 1, filteredCommands.length - 1));
          }
          break;
        case "ArrowUp":
          e.preventDefault();
          setSelectedIndex((prev) => Math.max(prev - 1, 0));
          break;
        case "Enter":
          e.preventDefault();
          if (filteredCommands[selectedIndex]) {
            executeCommand(filteredCommands[selectedIndex]);
          }
          break;
        case "Escape":
          e.preventDefault();
          onClose();
          break;
        // Vim-style navigation
        case "j":
          if (e.ctrlKey) {
            e.preventDefault();
            setSelectedIndex((prev) => Math.min(prev + 1, filteredCommands.length - 1));
          }
          break;
        case "k":
          if (e.ctrlKey) {
            e.preventDefault();
            setSelectedIndex((prev) => Math.max(prev - 1, 0));
          }
          break;
      }
    },
    [filteredCommands, selectedIndex, executeCommand, onClose]
  );

  if (!isOpen) return null;

  // Group commands by category for display
  const groupedCommands = groupByCategory(filteredCommands);

  return (
    <div className="command-palette-v2-overlay" onClick={onClose}>
      <div className="command-palette-v2" onClick={(e) => e.stopPropagation()}>
        <div className="command-palette-v2-header">
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={placeholder}
            className="command-palette-v2-input"
            autoComplete="off"
            spellCheck={false}
          />
        </div>
        <div className="command-palette-v2-results" ref={listRef}>
          {filteredCommands.length === 0 ? (
            <div className="command-palette-v2-empty">No commands found</div>
          ) : (
            Object.entries(groupedCommands).map(([category, cmds]) => (
              <div key={category} className="command-palette-v2-group">
                <div className="command-palette-v2-group-label">{getCategoryLabel(category as CommandCategory)}</div>
                {cmds.map((cmd, idx) => {
                  const globalIndex = filteredCommands.indexOf(cmd);
                  return (
                    <div
                      key={cmd.id}
                      data-index={globalIndex}
                      className={`command-palette-v2-item ${globalIndex === selectedIndex ? "selected" : ""}`}
                      onClick={() => executeCommand(cmd)}
                      onMouseEnter={() => setSelectedIndex(globalIndex)}
                    >
                      {cmd.icon && <span className="command-icon">{cmd.icon}</span>}
                      <div className="command-content">
                        <span className="command-label">{highlightMatch(cmd.label, query)}</span>
                        {cmd.description && <span className="command-desc">{cmd.description}</span>}
                      </div>
                      {cmd.shortcut && <kbd className="command-shortcut">{cmd.shortcut}</kbd>}
                    </div>
                  );
                })}
              </div>
            ))
          )}
        </div>
        <div className="command-palette-v2-footer">
          <span>
            <kbd>↑↓</kbd> navigate
          </span>
          <span>
            <kbd>↵</kbd> select
          </span>
          <span>
            <kbd>esc</kbd> close
          </span>
        </div>
      </div>
    </div>
  );
}

// Fuzzy match helper
function fuzzyMatch(query: string, text: string): boolean {
  let qi = 0;
  for (let i = 0; i < text.length && qi < query.length; i++) {
    if (text[i] === query[qi]) qi++;
  }
  return qi === query.length;
}

// Group commands by category
function groupByCategory(commands: Command[]): Record<string, Command[]> {
  const groups: Record<string, Command[]> = {};
  for (const cmd of commands) {
    if (!groups[cmd.category]) groups[cmd.category] = [];
    groups[cmd.category].push(cmd);
  }
  return groups;
}

// Category labels
function getCategoryLabel(category: CommandCategory): string {
  const labels: Record<CommandCategory, string> = {
    contextual: "Suggested",
    recent: "Recent",
    action: "Actions",
    navigation: "Navigation",
    search: "Search"
  };
  return labels[category] || category;
}

// Highlight matching text
function highlightMatch(text: string, query: string): ReactNode {
  if (!query) return text;
  const lowerText = text.toLowerCase();
  const lowerQuery = query.toLowerCase();
  const index = lowerText.indexOf(lowerQuery);
  if (index === -1) return text;
  return (
    <>
      {text.slice(0, index)}
      <mark>{text.slice(index, index + query.length)}</mark>
      {text.slice(index + query.length)}
    </>
  );
}

// Hook to manage command palette state
export function useCommandPaletteV2() {
  const [isOpen, setIsOpen] = useState(false);
  const [recentCommands, setRecentCommands] = useState<string[]>(() => {
    if (typeof window === "undefined") return [];
    try {
      return JSON.parse(localStorage.getItem("agentic-recent-commands") || "[]");
    } catch {
      return [];
    }
  });

  const open = useCallback(() => setIsOpen(true), []);
  const close = useCallback(() => setIsOpen(false), []);
  const toggle = useCallback(() => setIsOpen((prev) => !prev), []);

  const recordCommand = useCallback((id: string) => {
    setRecentCommands((prev) => {
      const next = [id, ...prev.filter((c) => c !== id)].slice(0, 10);
      localStorage.setItem("agentic-recent-commands", JSON.stringify(next));
      return next;
    });
  }, []);

  // Global keyboard shortcut
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "k") {
        e.preventDefault();
        toggle();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [toggle]);

  return {
    isOpen,
    open,
    close,
    toggle,
    recentCommands,
    recordCommand
  };
}

// Context-aware command generator
export function useContextualCommands(context: {
  section?: string;
  pendingApprovals?: number;
  runningGoals?: number;
  selectedItems?: number;
}): Command[] {
  return useMemo(() => {
    const commands: Command[] = [];

    if (context.section === "approvals" && context.pendingApprovals) {
      commands.push({
        id: "ctx-approve-all-r2",
        label: "Approve all R2",
        description: `${context.pendingApprovals} pending approvals`,
        category: "contextual",
        action: () => {
          document.querySelector<HTMLButtonElement>('[data-action="approve-r2"]')?.click();
        }
      });
    }

    if (context.runningGoals && context.runningGoals > 0) {
      commands.push({
        id: "ctx-view-running",
        label: "View running goals",
        description: `${context.runningGoals} goals in progress`,
        category: "contextual",
        action: () => {
          document.getElementById("section-goals")?.scrollIntoView({ behavior: "smooth" });
        }
      });
    }

    if (context.selectedItems && context.selectedItems > 0) {
      commands.push({
        id: "ctx-batch-action",
        label: "Batch action",
        description: `${context.selectedItems} items selected`,
        category: "contextual",
        action: () => {
          document.querySelector<HTMLButtonElement>('[data-action="batch-approve"]')?.click();
        }
      });
    }

    return commands;
  }, [context]);
}
