"use client";

import { useCallback, useEffect, useRef, useState } from "react";

type Command = {
  id: string;
  label: string;
  description: string;
  category: "quick-goal" | "navigate" | "action";
  action: () => void;
  keywords: string[];
};

type CommandPaletteProps = {
  onCreateGoal: (request: string) => void;
  onLogout: () => void;
  isPending: boolean;
};

export function CommandPalette({ onCreateGoal, onLogout, isPending }: CommandPaletteProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [selectedIndex, setSelectedIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  const commands: Command[] = [
    {
      id: "triage-inbox",
      label: "Triage my inbox",
      description: "Scan emails, prioritize urgent threads, draft replies",
      category: "quick-goal",
      action: () => { onCreateGoal("Triage my inbox and draft replies for anything urgent."); close(); },
      keywords: ["inbox", "email", "triage", "messages"]
    },
    {
      id: "plan-week",
      label: "Plan my week",
      description: "Review calendar, set focus blocks, identify overload",
      category: "quick-goal",
      action: () => { onCreateGoal("Plan my week — review calendar commitments, set focus blocks, and flag scheduling conflicts."); close(); },
      keywords: ["week", "weekly", "plan", "calendar", "schedule"]
    },
    {
      id: "prep-travel",
      label: "Prepare travel",
      description: "Assemble itinerary, checklist, and travel brief",
      category: "quick-goal",
      action: () => { onCreateGoal("Prepare travel readiness — assemble itinerary, checklist, and monitor booking status."); close(); },
      keywords: ["travel", "trip", "flight", "hotel"]
    },
    {
      id: "custom-goal",
      label: "Create custom goal...",
      description: "Focus the request input to type a custom goal",
      category: "action",
      action: () => { close(); document.querySelector<HTMLTextAreaElement>(".request-card textarea")?.focus(); },
      keywords: ["goal", "create", "new", "request", "custom"]
    },
    {
      id: "go-approvals",
      label: "View approvals",
      description: "Jump to the approvals inbox",
      category: "navigate",
      action: () => { close(); document.getElementById("section-approvals")?.scrollIntoView({ behavior: "smooth" }); },
      keywords: ["approvals", "approve", "reject", "pending"]
    },
    {
      id: "go-memories",
      label: "Search memories",
      description: "Jump to the memory inspector",
      category: "navigate",
      action: () => { close(); document.getElementById("section-memory")?.scrollIntoView({ behavior: "smooth" }); },
      keywords: ["memory", "memories", "search", "knowledge"]
    },
    {
      id: "go-artifacts",
      label: "View artifacts",
      description: "Jump to recent artifacts",
      category: "navigate",
      action: () => { close(); document.getElementById("section-artifacts")?.scrollIntoView({ behavior: "smooth" }); },
      keywords: ["artifacts", "output", "results"]
    },
    {
      id: "go-notes",
      label: "Open notes",
      description: "Jump to local notes editor",
      category: "navigate",
      action: () => { close(); document.getElementById("section-notes")?.scrollIntoView({ behavior: "smooth" }); },
      keywords: ["notes", "local", "editor"]
    },
    {
      id: "go-integrations",
      label: "View integrations",
      description: "Jump to integration adapters",
      category: "navigate",
      action: () => { close(); document.getElementById("section-integrations")?.scrollIntoView({ behavior: "smooth" }); },
      keywords: ["integrations", "gmail", "calendar", "adapters"]
    },
    {
      id: "lock-session",
      label: "Lock session",
      description: "Sign out and lock the dashboard",
      category: "action",
      action: () => { close(); onLogout(); },
      keywords: ["lock", "logout", "sign out", "session"]
    }
  ];

  const filteredCommands = query.trim()
    ? commands.filter((cmd) => {
        const q = query.toLowerCase();
        return cmd.label.toLowerCase().includes(q)
          || cmd.description.toLowerCase().includes(q)
          || cmd.keywords.some((k) => k.includes(q));
      })
    : commands;

  const close = useCallback(() => {
    setIsOpen(false);
    setQuery("");
    setSelectedIndex(0);
  }, []);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "k") {
        e.preventDefault();
        setIsOpen((prev) => !prev);
        setQuery("");
        setSelectedIndex(0);
      }
      if (e.key === "Escape" && isOpen) {
        e.preventDefault();
        close();
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [isOpen, close]);

  useEffect(() => {
    if (isOpen && inputRef.current) {
      inputRef.current.focus();
    }
  }, [isOpen]);

  useEffect(() => {
    setSelectedIndex(0);
  }, [query]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setSelectedIndex((prev) => Math.min(prev + 1, filteredCommands.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setSelectedIndex((prev) => Math.max(prev - 1, 0));
    } else if (e.key === "Enter" && filteredCommands[selectedIndex]) {
      e.preventDefault();
      if (!isPending) filteredCommands[selectedIndex].action();
    }
  };

  // Scroll selected item into view
  useEffect(() => {
    if (listRef.current) {
      const selected = listRef.current.querySelector("[data-selected='true']");
      if (selected) selected.scrollIntoView({ block: "nearest" });
    }
  }, [selectedIndex]);

  if (!isOpen) return null;

  const categoryLabels: Record<string, string> = {
    "quick-goal": "Quick Goals",
    navigate: "Navigate",
    action: "Actions"
  };

  // Group by category
  const grouped = filteredCommands.reduce<Record<string, Command[]>>((acc, cmd) => {
    if (!acc[cmd.category]) acc[cmd.category] = [];
    acc[cmd.category].push(cmd);
    return acc;
  }, {});

  let globalIndex = 0;

  return (
    <div className="palette-overlay" onClick={close}>
      <div className="palette-container" onClick={(e) => e.stopPropagation()}>
        <div className="palette-input-row">
          <svg className="palette-search-icon" width="16" height="16" viewBox="0 0 16 16" fill="none">
            <circle cx="7" cy="7" r="5.5" stroke="currentColor" strokeWidth="1.5" />
            <line x1="11" y1="11" x2="14.5" y2="14.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
          </svg>
          <input
            ref={inputRef}
            className="palette-input"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Type a command..."
            autoComplete="off"
            spellCheck={false}
          />
          <kbd className="palette-kbd">esc</kbd>
        </div>
        <div className="palette-list" ref={listRef}>
          {filteredCommands.length === 0 && (
            <div className="palette-empty">No matching commands</div>
          )}
          {Object.entries(grouped).map(([category, cmds]) => (
            <div key={category}>
              <div className="palette-category">{categoryLabels[category] ?? category}</div>
              {cmds.map((cmd) => {
                const idx = globalIndex++;
                return (
                  <button
                    key={cmd.id}
                    className={`palette-item ${idx === selectedIndex ? "palette-item-selected" : ""}`}
                    data-selected={idx === selectedIndex}
                    onClick={() => { if (!isPending) cmd.action(); }}
                    onMouseEnter={() => setSelectedIndex(idx)}
                    disabled={isPending}
                    type="button"
                  >
                    <div>
                      <span className="palette-item-label">{cmd.label}</span>
                      <span className="palette-item-desc">{cmd.description}</span>
                    </div>
                    {cmd.category === "quick-goal" && <span className="pill">goal</span>}
                  </button>
                );
              })}
            </div>
          ))}
        </div>
        <div className="palette-footer">
          <span><kbd>↑↓</kbd> navigate</span>
          <span><kbd>↵</kbd> select</span>
          <span><kbd>esc</kbd> close</span>
        </div>
      </div>
    </div>
  );
}
