"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

const STORAGE_KEY = "agentic-smart-defaults";

type DefaultsHistory = {
  memoryCategory: string[];
  goalPrefixes: string[];
  lastUsedTemplate?: string;
  timePreferences: {
    morningStart: number; // hour
    morningEnd: number;
    workdayStart: number;
    workdayEnd: number;
  };
};

function getDefaults(): DefaultsHistory {
  if (typeof window === "undefined") {
    return {
      memoryCategory: ["working-style"],
      goalPrefixes: [],
      timePreferences: {
        morningStart: 6,
        morningEnd: 10,
        workdayStart: 9,
        workdayEnd: 17
      }
    };
  }
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored) {
      return JSON.parse(stored) as DefaultsHistory;
    }
  } catch {
    // Ignore
  }
  return {
    memoryCategory: ["working-style"],
    goalPrefixes: [],
    timePreferences: {
      morningStart: 6,
      morningEnd: 10,
      workdayStart: 9,
      workdayEnd: 17
    }
  };
}

function saveDefaults(defaults: DefaultsHistory): void {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(defaults));
  } catch {
    // Ignore
  }
}

export function useSmartDefaults() {
  const [defaults, setDefaults] = useState<DefaultsHistory>(getDefaults);

  useEffect(() => {
    setDefaults(getDefaults());
  }, []);

  const recordMemoryCategory = useCallback((category: string) => {
    setDefaults((prev) => {
      const categories = [category, ...prev.memoryCategory.filter((c) => c !== category)].slice(0, 5);
      const updated = { ...prev, memoryCategory: categories };
      saveDefaults(updated);
      return updated;
    });
  }, []);

  const recordGoalPrefix = useCallback((goal: string) => {
    const prefix = goal.split(" ").slice(0, 3).join(" ");
    if (prefix.length < 5) return;
    setDefaults((prev) => {
      const prefixes = [prefix, ...prev.goalPrefixes.filter((p) => p !== prefix)].slice(0, 10);
      const updated = { ...prev, goalPrefixes: prefixes };
      saveDefaults(updated);
      return updated;
    });
  }, []);

  const recordTemplateUsed = useCallback((templateId: string) => {
    setDefaults((prev) => {
      const updated = { ...prev, lastUsedTemplate: templateId };
      saveDefaults(updated);
      return updated;
    });
  }, []);

  const suggestedMemoryCategory = useMemo(() => {
    return defaults.memoryCategory[0] || "working-style";
  }, [defaults.memoryCategory]);

  const suggestedGoal = useMemo(() => {
    const hour = new Date().getHours();
    const { morningStart, morningEnd, workdayEnd } = defaults.timePreferences;

    if (hour >= morningStart && hour < morningEnd) {
      return "Generate morning briefing";
    }
    if (hour >= workdayEnd) {
      return "Summarize today's activity";
    }
    
    // Return most common prefix if available
    return defaults.goalPrefixes[0] || "";
  }, [defaults.goalPrefixes, defaults.timePreferences]);

  const isWorkHours = useMemo(() => {
    const hour = new Date().getHours();
    const { workdayStart, workdayEnd } = defaults.timePreferences;
    return hour >= workdayStart && hour < workdayEnd;
  }, [defaults.timePreferences]);

  const isMorning = useMemo(() => {
    const hour = new Date().getHours();
    const { morningStart, morningEnd } = defaults.timePreferences;
    return hour >= morningStart && hour < morningEnd;
  }, [defaults.timePreferences]);

  return {
    defaults,
    suggestedMemoryCategory,
    suggestedGoal,
    isWorkHours,
    isMorning,
    recordMemoryCategory,
    recordGoalPrefix,
    recordTemplateUsed
  };
}

type SmartInputProps = {
  value: string;
  onChange: (value: string) => void;
  suggestions: string[];
  placeholder?: string;
  onSelect?: (suggestion: string) => void;
  className?: string;
};

export function SmartInput({
  value,
  onChange,
  suggestions,
  placeholder,
  onSelect,
  className = ""
}: SmartInputProps) {
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [selectedIndex, setSelectedIndex] = useState(-1);

  const filteredSuggestions = useMemo(() => {
    if (!value.trim()) return suggestions.slice(0, 5);
    const lower = value.toLowerCase();
    return suggestions
      .filter((s) => s.toLowerCase().includes(lower))
      .slice(0, 5);
  }, [value, suggestions]);

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (!showSuggestions || filteredSuggestions.length === 0) return;

    switch (e.key) {
      case "ArrowDown":
        e.preventDefault();
        setSelectedIndex((i) => Math.min(i + 1, filteredSuggestions.length - 1));
        break;
      case "ArrowUp":
        e.preventDefault();
        setSelectedIndex((i) => Math.max(i - 1, -1));
        break;
      case "Enter":
        if (selectedIndex >= 0) {
          e.preventDefault();
          const selected = filteredSuggestions[selectedIndex];
          onChange(selected);
          onSelect?.(selected);
          setShowSuggestions(false);
          setSelectedIndex(-1);
        }
        break;
      case "Escape":
        setShowSuggestions(false);
        setSelectedIndex(-1);
        break;
    }
  }, [showSuggestions, filteredSuggestions, selectedIndex, onChange, onSelect]);

  return (
    <div className={`smart-input-container ${className}`}>
      <input
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onFocus={() => setShowSuggestions(true)}
        onBlur={() => setTimeout(() => setShowSuggestions(false), 150)}
        onKeyDown={handleKeyDown}
        placeholder={placeholder}
        className="smart-input"
      />
      {showSuggestions && filteredSuggestions.length > 0 && (
        <ul className="smart-input-suggestions">
          {filteredSuggestions.map((suggestion, i) => (
            <li
              key={suggestion}
              className={`smart-input-suggestion ${i === selectedIndex ? "selected" : ""}`}
              onMouseDown={() => {
                onChange(suggestion);
                onSelect?.(suggestion);
              }}
              onMouseEnter={() => setSelectedIndex(i)}
            >
              {suggestion}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

type ContextualSuggestionProps = {
  type: "goal" | "memory" | "template";
  currentValue: string;
  onApply: (suggestion: string) => void;
};

export function ContextualSuggestion({ type, currentValue, onApply }: ContextualSuggestionProps) {
  const { suggestedGoal, isMorning } = useSmartDefaults();

  if (currentValue.trim()) return null;

  let suggestion = "";
  let label = "";

  switch (type) {
    case "goal":
      if (isMorning && suggestedGoal) {
        suggestion = suggestedGoal;
        label = "Morning suggestion";
      }
      break;
  }

  if (!suggestion) return null;

  return (
    <div className="contextual-suggestion">
      <span className="contextual-suggestion-label">{label}:</span>
      <button
        type="button"
        className="contextual-suggestion-button"
        onClick={() => onApply(suggestion)}
      >
        {suggestion}
      </button>
    </div>
  );
}
