"use client";

import { useEffect, useState } from "react";

type StatsBarProps = {
  goalsActive: number;
  goalsTotal: number;
  approvalsPending: number;
  memoriesCount: number;
  agentStatus?: "idle" | "working" | "waiting";
  agentName?: string;
  lastSyncAt?: Date;
};

function formatRelativeSync(date: Date): string {
  const seconds = Math.floor((Date.now() - date.getTime()) / 1000);
  if (seconds < 5) return "just now";
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  return `${hours}h ago`;
}

export function StatsBar({
  goalsActive,
  goalsTotal,
  approvalsPending,
  memoriesCount,
  agentStatus = "idle",
  agentName,
  lastSyncAt
}: StatsBarProps) {
  const [syncText, setSyncText] = useState(lastSyncAt ? formatRelativeSync(lastSyncAt) : "—");

  useEffect(() => {
    if (!lastSyncAt) return;
    setSyncText(formatRelativeSync(lastSyncAt));
    const interval = setInterval(() => {
      setSyncText(formatRelativeSync(lastSyncAt));
    }, 5000);
    return () => clearInterval(interval);
  }, [lastSyncAt]);

  const agentStatusIcon = {
    idle: "○",
    working: "●",
    waiting: "◐"
  }[agentStatus];

  const agentStatusLabel = {
    idle: "idle",
    working: agentName ? `${agentName} working...` : "working...",
    waiting: "waiting for approval"
  }[agentStatus];

  return (
    <div className="stats-bar">
      <div className="stats-bar-item">
        <span className="stats-bar-label">Goals</span>
        <span className="stats-bar-value">
          <strong>{goalsActive}</strong> active
          {goalsTotal > goalsActive && <span className="stats-bar-secondary"> · {goalsTotal} total</span>}
        </span>
      </div>

      <div className="stats-bar-divider" />

      <div className="stats-bar-item">
        <span className="stats-bar-label">Approvals</span>
        <span className={`stats-bar-value ${approvalsPending > 0 ? "stats-bar-alert" : ""}`}>
          <strong>{approvalsPending}</strong> pending
        </span>
      </div>

      <div className="stats-bar-divider" />

      <div className="stats-bar-item">
        <span className="stats-bar-label">Memory</span>
        <span className="stats-bar-value">
          <strong>{memoriesCount}</strong> items
        </span>
      </div>

      <div className="stats-bar-divider" />

      <div className="stats-bar-item">
        <span className="stats-bar-label">Last sync</span>
        <span className="stats-bar-value">{syncText}</span>
      </div>

      <div className="stats-bar-divider" />

      <div className="stats-bar-item stats-bar-agent">
        <span className={`stats-bar-dot stats-bar-dot-${agentStatus}`}>{agentStatusIcon}</span>
        <span className="stats-bar-value">{agentStatusLabel}</span>
      </div>
    </div>
  );
}

export function useStatsBar(data: {
  goals: { goal: { status: string } }[];
  approvals: { decision: string }[];
  memories: unknown[];
}) {
  const [lastSyncAt, setLastSyncAt] = useState<Date>(new Date());
  const [agentStatus, setAgentStatus] = useState<"idle" | "working" | "waiting">("idle");
  const [agentName, setAgentName] = useState<string | undefined>();

  const goalsActive = data.goals.filter((g) => g.goal.status !== "completed").length;
  const goalsTotal = data.goals.length;
  const approvalsPending = data.approvals.filter((a) => a.decision === "pending").length;
  const memoriesCount = data.memories.length;

  const updateSync = () => setLastSyncAt(new Date());
  const setWorking = (name?: string) => {
    setAgentStatus("working");
    setAgentName(name);
  };
  const setWaiting = () => setAgentStatus("waiting");
  const setIdle = () => {
    setAgentStatus("idle");
    setAgentName(undefined);
  };

  return {
    props: {
      goalsActive,
      goalsTotal,
      approvalsPending,
      memoriesCount,
      agentStatus,
      agentName,
      lastSyncAt
    },
    updateSync,
    setWorking,
    setWaiting,
    setIdle
  };
}
