"use client";

import { useCallback, useState, useRef, useEffect, type ReactNode } from "react";

// Natural Language Dashboard: Query and command via conversation

export type NLIntent =
  | { type: "query"; target: string; filters?: Record<string, string>; timeRange?: string }
  | { type: "command"; action: string; params: Record<string, unknown>; requiresConfirm?: boolean }
  | { type: "summary"; timeRange: "today" | "week" | "since-last-login" | "custom" }
  | { type: "clarify"; question: string; options?: string[] }
  | { type: "unknown"; rawQuery: string };

export type NLResult = {
  success: boolean;
  message: string;
  data?: unknown;
  suggestedActions?: Array<{ label: string; action: () => void }>;
};

// Simple intent parser (would be replaced by LLM in production)
export function parseIntent(query: string): NLIntent {
  const lower = query.toLowerCase().trim();

  // Summary patterns
  if (lower.includes("what happened") || lower.includes("while i was away") || lower.includes("catch me up")) {
    return { type: "summary", timeRange: "since-last-login" };
  }
  if (lower.includes("today") && (lower.includes("summary") || lower.includes("brief"))) {
    return { type: "summary", timeRange: "today" };
  }
  if (lower.includes("this week") || lower.includes("weekly")) {
    return { type: "summary", timeRange: "week" };
  }

  // Query patterns
  if (lower.startsWith("show") || lower.startsWith("list") || lower.startsWith("find")) {
    if (lower.includes("approval")) {
      const filters: Record<string, string> = {};
      if (lower.includes("r2")) filters.riskClass = "R2";
      if (lower.includes("r3")) filters.riskClass = "R3";
      if (lower.includes("r4")) filters.riskClass = "R4";
      if (lower.includes("pending")) filters.status = "pending";
      return { type: "query", target: "approvals", filters };
    }
    if (lower.includes("goal")) {
      const filters: Record<string, string> = {};
      if (lower.includes("running") || lower.includes("active")) filters.status = "running";
      if (lower.includes("completed") || lower.includes("done")) filters.status = "completed";
      if (lower.includes("failed")) filters.status = "failed";
      return { type: "query", target: "goals", filters };
    }
    if (lower.includes("agent")) {
      return { type: "query", target: "agents" };
    }
    if (lower.includes("memory") || lower.includes("memories")) {
      return { type: "query", target: "memories" };
    }
  }

  // Command patterns
  if (lower.startsWith("approve")) {
    const params: Record<string, unknown> = {};
    if (lower.includes("all r2")) {
      params.riskClass = "R2";
      params.all = true;
    } else if (lower.includes("all")) {
      params.all = true;
    }
    return { type: "command", action: "approve", params, requiresConfirm: true };
  }
  if (lower.startsWith("reject")) {
    return { type: "command", action: "reject", params: {}, requiresConfirm: true };
  }
  if (lower.startsWith("create") && lower.includes("goal")) {
    const match = lower.match(/create (?:a )?goal (?:to )?(.+)/);
    const request = match ? match[1] : "";
    return { type: "command", action: "create-goal", params: { request } };
  }
  if (lower.includes("morning briefing") || lower.includes("daily brief")) {
    return { type: "command", action: "briefing", params: { type: "morning" } };
  }

  return { type: "unknown", rawQuery: query };
}

// NL Input component
type NLInputProps = {
  onExecute: (intent: NLIntent) => Promise<NLResult>;
  placeholder?: string;
  className?: string;
};

export function NLInput({ onExecute, placeholder = "Ask anything or type a command...", className = "" }: NLInputProps) {
  const [query, setQuery] = useState("");
  const [isProcessing, setIsProcessing] = useState(false);
  const [lastResult, setLastResult] = useState<NLResult | null>(null);
  const [showPreview, setShowPreview] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const intent = query.trim() ? parseIntent(query) : null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!query.trim() || isProcessing) return;

    const parsedIntent = parseIntent(query);
    
    // For commands that require confirmation, show preview first
    if (parsedIntent.type === "command" && parsedIntent.requiresConfirm && !showPreview) {
      setShowPreview(true);
      return;
    }

    setIsProcessing(true);
    setShowPreview(false);
    
    try {
      const result = await onExecute(parsedIntent);
      setLastResult(result);
      if (result.success) {
        setQuery("");
      }
    } catch (error) {
      setLastResult({
        success: false,
        message: error instanceof Error ? error.message : "Failed to execute"
      });
    } finally {
      setIsProcessing(false);
    }
  };

  const cancelPreview = () => {
    setShowPreview(false);
  };

  return (
    <div className={`nl-input-container ${className}`}>
      <form onSubmit={handleSubmit} className="nl-input-form">
        <input
          ref={inputRef}
          type="text"
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setShowPreview(false);
          }}
          placeholder={placeholder}
          className="nl-input"
          disabled={isProcessing}
        />
        <button type="submit" className="nl-submit" disabled={isProcessing || !query.trim()}>
          {isProcessing ? "..." : "→"}
        </button>
      </form>

      {/* Intent preview */}
      {intent && query.trim() && !showPreview && (
        <div className="nl-intent-preview">
          <span className="nl-intent-type">{intent.type}</span>
          {intent.type === "query" && <span className="nl-intent-target">→ {intent.target}</span>}
          {intent.type === "command" && <span className="nl-intent-action">→ {intent.action}</span>}
          {intent.type === "summary" && <span className="nl-intent-range">→ {intent.timeRange}</span>}
        </div>
      )}

      {/* Confirmation preview */}
      {showPreview && intent?.type === "command" && (
        <div className="nl-confirm-preview">
          <p>Confirm: {intent.action}</p>
          <div className="nl-confirm-actions">
            <button type="button" onClick={handleSubmit} className="nl-confirm-yes">
              Confirm
            </button>
            <button type="button" onClick={cancelPreview} className="nl-confirm-no">
              Cancel
            </button>
          </div>
        </div>
      )}

      {/* Result display */}
      {lastResult && (
        <div className={`nl-result ${lastResult.success ? "success" : "error"}`}>
          <span className="nl-result-icon">{lastResult.success ? "✓" : "✗"}</span>
          <span className="nl-result-message">{lastResult.message}</span>
          {lastResult.suggestedActions && lastResult.suggestedActions.length > 0 && (
            <div className="nl-suggested-actions">
              {lastResult.suggestedActions.map((action, i) => (
                <button key={i} type="button" onClick={action.action} className="nl-suggested-action">
                  {action.label}
                </button>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// Floating NL bar
type NLFloatingBarProps = {
  onExecute: (intent: NLIntent) => Promise<NLResult>;
  isVisible?: boolean;
};

export function NLFloatingBar({ onExecute, isVisible = true }: NLFloatingBarProps) {
  const [isExpanded, setIsExpanded] = useState(false);

  // Keyboard shortcut to toggle
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "/" && !e.ctrlKey && !e.metaKey && !e.altKey) {
        const target = e.target as HTMLElement;
        if (target.tagName === "INPUT" || target.tagName === "TEXTAREA") return;
        e.preventDefault();
        setIsExpanded(true);
      }
      if (e.key === "Escape" && isExpanded) {
        setIsExpanded(false);
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isExpanded]);

  if (!isVisible) return null;

  return (
    <div className={`nl-floating-bar ${isExpanded ? "expanded" : "collapsed"}`}>
      {isExpanded ? (
        <NLInput
          onExecute={async (intent) => {
            const result = await onExecute(intent);
            if (result.success) {
              setIsExpanded(false);
            }
            return result;
          }}
        />
      ) : (
        <button type="button" className="nl-expand-btn" onClick={() => setIsExpanded(true)}>
          <span className="nl-expand-icon">💬</span>
          <span className="nl-expand-hint">Press / to ask or command</span>
        </button>
      )}
    </div>
  );
}

// Hook to execute NL intents
export function useNLExecutor(handlers: {
  onQuery: (target: string, filters?: Record<string, string>) => Promise<unknown>;
  onCommand: (action: string, params: Record<string, unknown>) => Promise<void>;
  onSummary: (timeRange: string) => Promise<string>;
}) {
  const execute = useCallback(
    async (intent: NLIntent): Promise<NLResult> => {
      try {
        switch (intent.type) {
          case "query": {
            const data = await handlers.onQuery(intent.target, intent.filters);
            return {
              success: true,
              message: `Found results for ${intent.target}`,
              data
            };
          }
          case "command": {
            await handlers.onCommand(intent.action, intent.params);
            return {
              success: true,
              message: `Executed: ${intent.action}`
            };
          }
          case "summary": {
            const summary = await handlers.onSummary(intent.timeRange);
            return {
              success: true,
              message: summary
            };
          }
          case "clarify": {
            return {
              success: true,
              message: intent.question,
              suggestedActions: intent.options?.map((opt) => ({
                label: opt,
                action: () => console.log("Selected:", opt)
              }))
            };
          }
          case "unknown": {
            return {
              success: false,
              message: "I didn't understand that. Try 'show approvals', 'approve all R2', or 'create goal to...'",
              suggestedActions: [
                { label: "Show approvals", action: () => {} },
                { label: "Today's summary", action: () => {} },
                { label: "Create goal", action: () => {} }
              ]
            };
          }
        }
      } catch (error) {
        return {
          success: false,
          message: error instanceof Error ? error.message : "Failed to execute"
        };
      }
    },
    [handlers]
  );

  return { execute };
}
