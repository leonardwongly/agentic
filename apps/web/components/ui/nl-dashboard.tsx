"use client";

import { useCallback, useState, useRef, useEffect } from "react";
import type { NLIntentCapabilitySummary } from "../../lib/nl-capabilities";
import { parseIntent, type NLIntent } from "./nl-intent";

export type NLResult = {
  success: boolean;
  message: string;
  data?: unknown;
  suggestedActions?: Array<{ label: string; action: () => void }>;
};

export type NLExecutionPayload = Omit<NLResult, "success">;

function integrationCapabilityTone(readinessTier: string, connectionStatus: string) {
  if (connectionStatus === "missing" || connectionStatus === "disabled") {
    return "experimental";
  }

  return readinessTier;
}

// NL Input component
type NLInputProps = {
  onExecute: (intent: NLIntent) => Promise<NLResult>;
  placeholder?: string;
  className?: string;
  capabilitySummary?: NLIntentCapabilitySummary;
};

function buildCapabilityPlaceholder(capabilitySummary?: NLIntentCapabilitySummary, fallback?: string) {
  if (!capabilitySummary) {
    return fallback ?? "Ask anything or type a command...";
  }

  const examples = capabilitySummary.commands
    .filter((command) => command.status !== "unavailable")
    .slice(0, 3)
    .map((command) => command.example);

  if (examples.length === 0) {
    return fallback ?? "Use a bounded control command...";
  }

  return examples.join(" | ");
}

export function NLInput({
  onExecute,
  placeholder = "Ask anything or type a command...",
  className = "",
  capabilitySummary
}: NLInputProps) {
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

    if (parsedIntent.type === "clarify") {
      setLastResult({
        success: false,
        message: parsedIntent.question,
        suggestedActions: (parsedIntent.options ?? []).map((option) => ({
          label: option,
          action: () => {
            setQuery(option);
            setShowPreview(false);
            inputRef.current?.focus();
          }
        }))
      });
      return;
    }

    if (parsedIntent.type === "unknown") {
      const suggestedExamples =
        capabilitySummary?.commands
          .filter((command) => command.status !== "unavailable")
          .slice(0, 3)
          .map((command) => command.example) ?? [];

      setLastResult({
        success: false,
        message: "The NL bar only supports a bounded set of control commands right now.",
        suggestedActions: suggestedExamples.map((example) => ({
          label: example,
          action: () => {
            setQuery(example);
            setShowPreview(false);
            inputRef.current?.focus();
          }
        }))
      });
      return;
    }
    
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
          placeholder={buildCapabilityPlaceholder(capabilitySummary, placeholder)}
          className="nl-input"
          disabled={isProcessing}
        />
        <button type="submit" className="nl-submit" disabled={isProcessing || !query.trim()}>
          {isProcessing ? "..." : "→"}
        </button>
      </form>

      {capabilitySummary ? (
        <div className="nl-capability-summary">
          <p className="nl-capability-headline">{capabilitySummary.headline}</p>
          <div className="nl-capability-pills">
            {capabilitySummary.commands
              .filter((command) => command.status !== "unavailable")
              .map((command) => (
                <button
                  key={command.id}
                  type="button"
                  className={`nl-capability-pill ${command.status}`}
                  onClick={() => {
                    setQuery(command.example);
                    setShowPreview(false);
                    inputRef.current?.focus();
                  }}
                  title={command.reason}
                >
                  {command.example}
                </button>
              ))}
          </div>
          <div className="nl-capability-integrations">
            {capabilitySummary.integrations.map((integration) => (
              <span
                key={integration.label}
                className={`nl-capability-integration ${integrationCapabilityTone(integration.readinessTier, integration.connectionStatus)}`}
                title={integration.reason}
              >
                {integration.label}: {integration.readinessLabel}
              </span>
            ))}
          </div>
          <p className="nl-capability-note">{capabilitySummary.unsupportedNote}</p>
        </div>
      ) : null}

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
  capabilitySummary?: NLIntentCapabilitySummary;
};

export function NLFloatingBar({ onExecute, isVisible = true, capabilitySummary }: NLFloatingBarProps) {
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
          capabilitySummary={capabilitySummary}
        />
      ) : (
        <button type="button" className="nl-expand-btn" onClick={() => setIsExpanded(true)}>
          <span className="nl-expand-icon">💬</span>
          <span className="nl-expand-hint">Press / for bounded control commands</span>
        </button>
      )}
    </div>
  );
}

// Hook to execute NL intents
export function useNLExecutor(handlers: {
  onQuery: (target: string, filters?: Record<string, string>) => Promise<NLExecutionPayload>;
  onCommand: (action: string, params: Record<string, unknown>) => Promise<NLExecutionPayload>;
  onSummary: (timeRange: string) => Promise<NLExecutionPayload>;
}) {
  const execute = useCallback(
    async (intent: NLIntent): Promise<NLResult> => {
      try {
        switch (intent.type) {
          case "query": {
            const result = await handlers.onQuery(intent.target, intent.filters);
            return {
              success: true,
              ...result
            };
          }
          case "command": {
            const result = await handlers.onCommand(intent.action, intent.params);
            return {
              success: true,
              ...result
            };
          }
          case "summary": {
            const result = await handlers.onSummary(intent.timeRange);
            return {
              success: true,
              ...result
            };
          }
          case "clarify": {
            return {
              success: false,
              message: intent.question
            };
          }
          case "unknown": {
            return {
              success: false,
              message: "The NL bar only supports a bounded control-command set right now."
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
