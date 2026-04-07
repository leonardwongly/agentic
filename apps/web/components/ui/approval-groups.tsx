"use client";

import { useMemo, useState, type ReactNode } from "react";
import type { ApprovalRequest } from "@agentic/contracts";

// Approval grouping: Group by source goal, agent, or risk class

export type GroupBy = "none" | "agent" | "goal" | "riskClass";

type ApprovalGroup = {
  key: string;
  label: string;
  approvals: ApprovalRequest[];
  metadata: {
    riskClass?: "R1" | "R2" | "R3" | "R4";
    agentName?: string;
    goalId?: string;
  };
};

export function useApprovalGroups(approvals: ApprovalRequest[], groupBy: GroupBy) {
  return useMemo(() => {
    if (groupBy === "none") {
      return [
        {
          key: "all",
          label: "All Approvals",
          approvals,
          metadata: {}
        }
      ];
    }

    const groups = new Map<string, ApprovalGroup>();

    for (const approval of approvals) {
      let key: string;
      let label: string;
      let metadata: ApprovalGroup["metadata"] = {};

      switch (groupBy) {
        case "agent":
          // Extract agent from taskId (format: task-agentname-xxx) or title
          const agentMatch = approval.taskId.match(/^task-([^-]+)-/);
          const agentName = agentMatch ? agentMatch[1] : "unknown";
          key = agentName;
          label = agentName.charAt(0).toUpperCase() + agentName.slice(1).replace(/-/g, " ");
          metadata = { agentName };
          break;
        case "goal":
          key = approval.goalId;
          label = `Goal ${approval.goalId.slice(0, 8)}...`;
          metadata = { goalId: approval.goalId };
          break;
        case "riskClass":
          key = approval.riskClass;
          label = getRiskClassLabel(approval.riskClass);
          metadata = { riskClass: approval.riskClass };
          break;
        default:
          key = "other";
          label = "Other";
      }

      const existing = groups.get(key);
      if (existing) {
        existing.approvals.push(approval);
      } else {
        groups.set(key, { key, label, approvals: [approval], metadata });
      }
    }

    // Sort groups
    const sorted = Array.from(groups.values());
    if (groupBy === "riskClass") {
      const order = { R4: 0, R3: 1, R2: 2, R1: 3 };
      sorted.sort((a, b) => (order[a.metadata.riskClass!] ?? 99) - (order[b.metadata.riskClass!] ?? 99));
    } else {
      sorted.sort((a, b) => b.approvals.length - a.approvals.length);
    }

    return sorted;
  }, [approvals, groupBy]);
}

function getRiskClassLabel(riskClass: "R1" | "R2" | "R3" | "R4"): string {
  const labels = {
    R1: "R1 — Informational",
    R2: "R2 — Low Risk",
    R3: "R3 — Medium Risk",
    R4: "R4 — High Risk"
  };
  return labels[riskClass];
}

// Group selector dropdown
type GroupSelectorProps = {
  value: GroupBy;
  onChange: (value: GroupBy) => void;
};

export function ApprovalGroupSelector({ value, onChange }: GroupSelectorProps) {
  return (
    <div className="approval-group-selector">
      <label htmlFor="group-by">Group by:</label>
      <select
        id="group-by"
        value={value}
        onChange={(e) => onChange(e.target.value as GroupBy)}
        className="group-select"
      >
        <option value="none">No grouping</option>
        <option value="agent">Agent</option>
        <option value="goal">Source Goal</option>
        <option value="riskClass">Risk Class</option>
      </select>
    </div>
  );
}

// Collapsible group component
type ApprovalGroupViewProps = {
  group: ApprovalGroup;
  children: ReactNode;
  defaultExpanded?: boolean;
  onApproveAll?: (approvals: ApprovalRequest[]) => void;
};

export function ApprovalGroupView({ group, children, defaultExpanded = true, onApproveAll }: ApprovalGroupViewProps) {
  const [isExpanded, setIsExpanded] = useState(defaultExpanded);

  const riskClassColors: Record<string, string> = {
    R1: "var(--color-success)",
    R2: "var(--color-info)",
    R3: "var(--color-warning)",
    R4: "var(--color-danger)"
  };

  const accentColor = group.metadata.riskClass ? riskClassColors[group.metadata.riskClass] : undefined;

  return (
    <div className="approval-group" style={{ "--accent-color": accentColor } as React.CSSProperties}>
      <div className="approval-group-header" onClick={() => setIsExpanded(!isExpanded)} role="button" tabIndex={0}>
        <span className="approval-group-toggle">{isExpanded ? "▼" : "▶"}</span>
        <span className="approval-group-label">{group.label}</span>
        <span className="approval-group-count">{group.approvals.length}</span>
        {onApproveAll && group.approvals.length > 0 && group.metadata.riskClass !== "R4" && (
          <button
            type="button"
            className="approval-group-action"
            onClick={(e) => {
              e.stopPropagation();
              onApproveAll(group.approvals);
            }}
          >
            Approve all
          </button>
        )}
      </div>
      {isExpanded && <div className="approval-group-content">{children}</div>}
    </div>
  );
}

// Summary bar showing group stats
type ApprovalGroupSummaryProps = {
  groups: ApprovalGroup[];
  groupBy: GroupBy;
};

export function ApprovalGroupSummary({ groups, groupBy }: ApprovalGroupSummaryProps) {
  if (groupBy === "none" || groups.length <= 1) return null;

  const totalApprovals = groups.reduce((sum, g) => sum + g.approvals.length, 0);
  const r4Count = groups
    .filter((g) => g.metadata.riskClass === "R4")
    .reduce((sum, g) => sum + g.approvals.length, 0);

  return (
    <div className="approval-group-summary">
      <span>
        {groups.length} groups · {totalApprovals} approvals
      </span>
      {r4Count > 0 && <span className="r4-warning">⚠️ {r4Count} high-risk requiring review</span>}
    </div>
  );
}
