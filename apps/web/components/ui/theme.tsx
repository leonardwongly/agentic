"use client";

import { useCallback, useState, useEffect } from "react";

// Dark mode: System preference sync with manual override

export type ThemeMode = "light" | "dark" | "system";

export function useTheme() {
  const [mode, setMode] = useState<ThemeMode>(() => {
    if (typeof window === "undefined") return "system";
    return (localStorage.getItem("agentic-theme") as ThemeMode) || "system";
  });

  const [resolvedTheme, setResolvedTheme] = useState<"light" | "dark">("light");

  // Resolve system preference
  useEffect(() => {
    const mediaQuery = window.matchMedia("(prefers-color-scheme: dark)");

    const updateResolvedTheme = () => {
      if (mode === "system") {
        setResolvedTheme(mediaQuery.matches ? "dark" : "light");
      } else {
        setResolvedTheme(mode);
      }
    };

    updateResolvedTheme();

    // Listen for system preference changes
    const handler = () => updateResolvedTheme();
    mediaQuery.addEventListener("change", handler);
    return () => mediaQuery.removeEventListener("change", handler);
  }, [mode]);

  // Apply theme to document
  useEffect(() => {
    document.documentElement.setAttribute("data-theme", resolvedTheme);
    document.documentElement.classList.toggle("dark", resolvedTheme === "dark");
  }, [resolvedTheme]);

  const setTheme = useCallback((newMode: ThemeMode) => {
    setMode(newMode);
    localStorage.setItem("agentic-theme", newMode);
  }, []);

  const toggleTheme = useCallback(() => {
    setTheme(resolvedTheme === "light" ? "dark" : "light");
  }, [resolvedTheme, setTheme]);

  const cycleTheme = useCallback(() => {
    const order: ThemeMode[] = ["light", "dark", "system"];
    const currentIndex = order.indexOf(mode);
    const nextIndex = (currentIndex + 1) % order.length;
    setTheme(order[nextIndex]);
  }, [mode, setTheme]);

  return {
    mode,
    resolvedTheme,
    setTheme,
    toggleTheme,
    cycleTheme,
    isDark: resolvedTheme === "dark"
  };
}

// Theme toggle button
type ThemeToggleProps = {
  className?: string;
  showLabel?: boolean;
};

export function ThemeToggle({ className = "", showLabel = false }: ThemeToggleProps) {
  const { mode, resolvedTheme, cycleTheme } = useTheme();

  const icons: Record<ThemeMode, string> = {
    light: "☀️",
    dark: "🌙",
    system: "💻"
  };

  const labels: Record<ThemeMode, string> = {
    light: "Light",
    dark: "Dark",
    system: "System"
  };

  return (
    <button
      type="button"
      className={`theme-toggle ${className}`}
      onClick={cycleTheme}
      title={`Theme: ${labels[mode]} (${resolvedTheme})`}
      aria-label={`Current theme: ${labels[mode]}. Click to change.`}
    >
      <span className="theme-icon">{icons[mode]}</span>
      {showLabel && <span className="theme-label">{labels[mode]}</span>}
    </button>
  );
}

// Theme selector dropdown
type ThemeSelectorProps = {
  className?: string;
};

export function ThemeSelector({ className = "" }: ThemeSelectorProps) {
  const { mode, setTheme } = useTheme();

  return (
    <div className={`theme-selector ${className}`}>
      <label htmlFor="theme-select">Theme</label>
      <select
        id="theme-select"
        value={mode}
        onChange={(e) => setTheme(e.target.value as ThemeMode)}
        className="theme-select"
      >
        <option value="light">☀️ Light</option>
        <option value="dark">🌙 Dark</option>
        <option value="system">💻 System</option>
      </select>
    </div>
  );
}

// CSS variables for dark mode (to be added to globals.css)
export const darkModeCSS = `
:root {
  --color-bg: #ffffff;
  --color-bg-secondary: #f9fafb;
  --color-bg-tertiary: #f3f4f6;
  --color-text: #111827;
  --color-text-secondary: #6b7280;
  --color-text-muted: #9ca3af;
  --color-border: #e5e7eb;
  --color-border-hover: #d1d5db;
  --color-primary: #3b82f6;
  --color-primary-hover: #2563eb;
  --color-success: #22c55e;
  --color-warning: #eab308;
  --color-danger: #ef4444;
  --color-info: #3b82f6;
}

[data-theme="dark"], .dark {
  --color-bg: #0f172a;
  --color-bg-secondary: #1e293b;
  --color-bg-tertiary: #334155;
  --color-text: #f1f5f9;
  --color-text-secondary: #94a3b8;
  --color-text-muted: #64748b;
  --color-border: #334155;
  --color-border-hover: #475569;
  --color-primary: #60a5fa;
  --color-primary-hover: #3b82f6;
  --color-success: #4ade80;
  --color-warning: #facc15;
  --color-danger: #f87171;
  --color-info: #60a5fa;
}

/* Apply colors */
body {
  background-color: var(--color-bg);
  color: var(--color-text);
}

.card, .modal, .dropdown {
  background-color: var(--color-bg-secondary);
  border-color: var(--color-border);
}

input, textarea, select {
  background-color: var(--color-bg);
  border-color: var(--color-border);
  color: var(--color-text);
}

input:focus, textarea:focus, select:focus {
  border-color: var(--color-primary);
}

/* Theme toggle styles */
.theme-toggle {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  padding: 0.5rem;
  background: transparent;
  border: 1px solid var(--color-border);
  border-radius: 0.375rem;
  cursor: pointer;
  transition: all 0.15s ease;
}

.theme-toggle:hover {
  background-color: var(--color-bg-secondary);
  border-color: var(--color-border-hover);
}

.theme-icon {
  font-size: 1.125rem;
}

.theme-label {
  font-size: 0.875rem;
  color: var(--color-text-secondary);
}

.theme-selector {
  display: flex;
  align-items: center;
  gap: 0.5rem;
}

.theme-select {
  padding: 0.375rem 0.75rem;
  border-radius: 0.375rem;
}
`;
