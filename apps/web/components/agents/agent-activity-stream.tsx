"use client";

import { useEffect, useRef, useState } from "react";
import type { AgentActivityEvent } from "@agentic/contracts";

type AgentActivityStreamProps = {
  initialEvents?: AgentActivityEvent[];
  maxEvents?: number;
  autoScroll?: boolean;
  agentFilter?: string;
};

function getEventIcon(kind: AgentActivityEvent["kind"]): string {
  switch (kind) {
    case "agent.started":
      return "🚀";
    case "agent.thinking":
      return "🤔";
    case "agent.integration_call":
      return "📡";
    case "agent.integration_response":
      return "📥";
    case "agent.artifact_created":
      return "📄";
    case "agent.completed":
      return "✅";
    case "agent.failed":
      return "❌";
    case "agent.waiting_approval":
      return "⏳";
    case "agent.resumed":
      return "▶️";
    default:
      return "📌";
  }
}

function getEventColor(kind: AgentActivityEvent["kind"]): string {
  switch (kind) {
    case "agent.started":
    case "agent.resumed":
      return "var(--color-info, #3b82f6)";
    case "agent.thinking":
      return "var(--color-warning, #eab308)";
    case "agent.integration_call":
    case "agent.integration_response":
      return "var(--color-primary, #0ea5e9)";
    case "agent.artifact_created":
      return "var(--color-success, #22c55e)";
    case "agent.completed":
      return "var(--color-success, #22c55e)";
    case "agent.failed":
      return "var(--color-error, #ef4444)";
    case "agent.waiting_approval":
      return "var(--color-warning, #eab308)";
    default:
      return "var(--color-text-muted, #888)";
  }
}

function formatTime(iso: string): string {
  const date = new Date(iso);
  return date.toLocaleTimeString(undefined, {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit"
  });
}

function formatRelativeTime(iso: string): string {
  const now = Date.now();
  const then = new Date(iso).getTime();
  const diff = now - then;

  if (diff < 1000) return "just now";
  if (diff < 60000) return `${Math.floor(diff / 1000)}s ago`;
  if (diff < 3600000) return `${Math.floor(diff / 60000)}m ago`;
  if (diff < 86400000) return `${Math.floor(diff / 3600000)}h ago`;
  return formatTime(iso);
}

export function AgentActivityStream({
  initialEvents = [],
  maxEvents = 100,
  autoScroll = true,
  agentFilter
}: AgentActivityStreamProps) {
  const [events, setEvents] = useState<AgentActivityEvent[]>(initialEvents);
  const [isConnected, setIsConnected] = useState(false);
  const [isPaused, setIsPaused] = useState(false);
  const [selectedEvent, setSelectedEvent] = useState<AgentActivityEvent | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const eventSourceRef = useRef<EventSource | null>(null);

  useEffect(() => {
    if (isPaused) return;

    const url = new URL("/api/agents/activity", window.location.origin);
    if (agentFilter) {
      url.searchParams.set("agentId", agentFilter);
    }

    const eventSource = new EventSource(url.toString());
    eventSourceRef.current = eventSource;

    eventSource.onopen = () => {
      setIsConnected(true);
    };

    eventSource.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data) as AgentActivityEvent;
        setEvents((prev) => {
          const updated = [data, ...prev].slice(0, maxEvents);
          return updated;
        });
      } catch {
        // Ignore parse errors
      }
    };

    eventSource.onerror = () => {
      setIsConnected(false);
    };

    return () => {
      eventSource.close();
      eventSourceRef.current = null;
    };
  }, [isPaused, agentFilter, maxEvents]);

  useEffect(() => {
    if (autoScroll && containerRef.current && !isPaused) {
      containerRef.current.scrollTop = 0;
    }
  }, [events, autoScroll, isPaused]);

  const clearEvents = () => {
    setEvents([]);
    setSelectedEvent(null);
  };

  const filteredEvents = agentFilter
    ? events.filter((e) => e.agentId === agentFilter)
    : events;

  return (
    <div className="activity-stream">
      <div className="stream-header">
        <h3>Activity Stream</h3>
        <div className="stream-controls">
          <span className={`connection-status ${isConnected ? "connected" : "disconnected"}`}>
            {isConnected ? "● Live" : "○ Disconnected"}
          </span>
          <button
            type="button"
            className={`control-btn ${isPaused ? "paused" : ""}`}
            onClick={() => setIsPaused(!isPaused)}
            title={isPaused ? "Resume" : "Pause"}
          >
            {isPaused ? "▶" : "⏸"}
          </button>
          <button
            type="button"
            className="control-btn"
            onClick={clearEvents}
            title="Clear events"
          >
            🗑️
          </button>
        </div>
      </div>

      <div className="stream-content" ref={containerRef}>
        {filteredEvents.length === 0 ? (
          <div className="empty-state">
            <p>No activity yet</p>
            <span>Events will appear here as agents work</span>
          </div>
        ) : (
          <div className="events-list">
            {filteredEvents.map((event) => (
              <div
                key={event.id}
                className={`event-item ${selectedEvent?.id === event.id ? "selected" : ""}`}
                onClick={() => setSelectedEvent(event)}
                role="button"
                tabIndex={0}
                onKeyDown={(e) => e.key === "Enter" && setSelectedEvent(event)}
              >
                <div className="event-icon" style={{ color: getEventColor(event.kind) }}>
                  {getEventIcon(event.kind)}
                </div>
                <div className="event-content">
                  <div className="event-header">
                    <span className="event-agent">{event.agentName}</span>
                    <span className="event-kind">{event.kind.replace("agent.", "")}</span>
                  </div>
                  <p className="event-message">{event.message}</p>
                  {event.progress !== null && (
                    <div className="event-progress">
                      <div
                        className="progress-bar"
                        style={{ width: `${event.progress}%` }}
                      />
                    </div>
                  )}
                </div>
                <span className="event-time" title={formatTime(event.timestamp)}>
                  {formatRelativeTime(event.timestamp)}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>

      {selectedEvent && (
        <div className="event-detail-panel">
          <div className="detail-header">
            <h4>Event Details</h4>
            <button type="button" onClick={() => setSelectedEvent(null)}>×</button>
          </div>
          <div className="detail-content">
            <div className="detail-row">
              <label>Agent</label>
              <span>{selectedEvent.agentName} ({selectedEvent.agentId})</span>
            </div>
            <div className="detail-row">
              <label>Event</label>
              <span style={{ color: getEventColor(selectedEvent.kind) }}>
                {getEventIcon(selectedEvent.kind)} {selectedEvent.kind}
              </span>
            </div>
            <div className="detail-row">
              <label>Time</label>
              <span>{formatTime(selectedEvent.timestamp)}</span>
            </div>
            {selectedEvent.goalId && (
              <div className="detail-row">
                <label>Goal</label>
                <span>{selectedEvent.goalId}</span>
              </div>
            )}
            {selectedEvent.taskId && (
              <div className="detail-row">
                <label>Task</label>
                <span>{selectedEvent.taskId}</span>
              </div>
            )}
            <div className="detail-row full">
              <label>Message</label>
              <p>{selectedEvent.message}</p>
            </div>
            {Object.keys(selectedEvent.details).length > 0 && (
              <div className="detail-row full">
                <label>Details</label>
                <pre>{JSON.stringify(selectedEvent.details, null, 2)}</pre>
              </div>
            )}
          </div>
        </div>
      )}

      <style jsx>{`
        .activity-stream {
          display: flex;
          flex-direction: column;
          height: 100%;
          background: var(--color-background, #121212);
          border: 1px solid var(--color-border, #333);
          border-radius: 8px;
          overflow: hidden;
        }

        .stream-header {
          display: flex;
          justify-content: space-between;
          align-items: center;
          padding: 12px 16px;
          border-bottom: 1px solid var(--color-border, #333);
          background: var(--color-surface, #1e1e1e);
        }

        .stream-header h3 {
          margin: 0;
          font-size: 14px;
          color: var(--color-text, #fff);
        }

        .stream-controls {
          display: flex;
          align-items: center;
          gap: 8px;
        }

        .connection-status {
          font-size: 11px;
          padding: 2px 8px;
          border-radius: 10px;
        }

        .connection-status.connected {
          color: var(--color-success, #22c55e);
          background: rgba(34, 197, 94, 0.15);
        }

        .connection-status.disconnected {
          color: var(--color-error, #ef4444);
          background: rgba(239, 68, 68, 0.15);
        }

        .control-btn {
          padding: 4px 8px;
          background: none;
          border: 1px solid var(--color-border, #333);
          border-radius: 4px;
          color: var(--color-text-muted, #888);
          font-size: 12px;
          cursor: pointer;
        }

        .control-btn:hover {
          background: var(--color-surface-secondary, #2a2a2a);
        }

        .control-btn.paused {
          color: var(--color-warning, #eab308);
          border-color: var(--color-warning, #eab308);
        }

        .stream-content {
          flex: 1;
          overflow-y: auto;
        }

        .empty-state {
          display: flex;
          flex-direction: column;
          align-items: center;
          justify-content: center;
          height: 200px;
          color: var(--color-text-muted, #888);
        }

        .empty-state p {
          margin: 0;
          font-size: 14px;
        }

        .empty-state span {
          font-size: 12px;
          margin-top: 4px;
        }

        .events-list {
          display: flex;
          flex-direction: column;
        }

        .event-item {
          display: flex;
          gap: 12px;
          padding: 12px 16px;
          border-bottom: 1px solid var(--color-border, #333);
          cursor: pointer;
          transition: background 0.1s;
        }

        .event-item:hover {
          background: var(--color-surface, #1e1e1e);
        }

        .event-item.selected {
          background: var(--color-surface-active, #252525);
        }

        .event-icon {
          font-size: 16px;
          flex-shrink: 0;
        }

        .event-content {
          flex: 1;
          min-width: 0;
        }

        .event-header {
          display: flex;
          align-items: center;
          gap: 8px;
          margin-bottom: 4px;
        }

        .event-agent {
          font-size: 12px;
          font-weight: 500;
          color: var(--color-text, #fff);
        }

        .event-kind {
          font-size: 10px;
          padding: 1px 6px;
          background: var(--color-surface-secondary, #2a2a2a);
          border-radius: 8px;
          color: var(--color-text-muted, #888);
        }

        .event-message {
          margin: 0;
          font-size: 13px;
          color: var(--color-text-secondary, #aaa);
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
        }

        .event-progress {
          height: 3px;
          background: var(--color-surface-secondary, #2a2a2a);
          border-radius: 2px;
          margin-top: 6px;
          overflow: hidden;
        }

        .progress-bar {
          height: 100%;
          background: var(--color-primary, #0ea5e9);
          transition: width 0.3s;
        }

        .event-time {
          font-size: 11px;
          color: var(--color-text-muted, #888);
          flex-shrink: 0;
        }

        .event-detail-panel {
          border-top: 1px solid var(--color-border, #333);
          background: var(--color-surface, #1e1e1e);
          max-height: 40%;
          overflow-y: auto;
        }

        .detail-header {
          display: flex;
          justify-content: space-between;
          align-items: center;
          padding: 12px 16px;
          border-bottom: 1px solid var(--color-border, #333);
        }

        .detail-header h4 {
          margin: 0;
          font-size: 13px;
          color: var(--color-text, #fff);
        }

        .detail-header button {
          background: none;
          border: none;
          font-size: 18px;
          color: var(--color-text-muted, #888);
          cursor: pointer;
        }

        .detail-content {
          padding: 12px 16px;
        }

        .detail-row {
          display: flex;
          gap: 12px;
          margin-bottom: 10px;
          font-size: 13px;
        }

        .detail-row.full {
          flex-direction: column;
          gap: 4px;
        }

        .detail-row label {
          width: 60px;
          flex-shrink: 0;
          color: var(--color-text-muted, #888);
          font-size: 11px;
          text-transform: uppercase;
        }

        .detail-row span,
        .detail-row p {
          color: var(--color-text, #fff);
          margin: 0;
        }

        .detail-row pre {
          margin: 0;
          padding: 8px;
          background: var(--color-background, #121212);
          border-radius: 4px;
          font-size: 11px;
          overflow-x: auto;
        }
      `}</style>
    </div>
  );
}
