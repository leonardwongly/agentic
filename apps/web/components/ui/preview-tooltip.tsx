"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { ApprovalRequest } from "@agentic/contracts";

type PreviewTooltipProps = {
  children: React.ReactNode;
  content: React.ReactNode;
  delay?: number;
  position?: "top" | "bottom" | "left" | "right";
  maxWidth?: number;
};

export function PreviewTooltip({
  children,
  content,
  delay = 300,
  position = "top",
  maxWidth = 320
}: PreviewTooltipProps) {
  const [isVisible, setIsVisible] = useState(false);
  const [coords, setCoords] = useState({ x: 0, y: 0 });
  const triggerRef = useRef<HTMLSpanElement>(null);
  const tooltipRef = useRef<HTMLDivElement>(null);
  const timeoutRef = useRef<NodeJS.Timeout | null>(null);

  const showTooltip = useCallback(() => {
    timeoutRef.current = setTimeout(() => {
      if (triggerRef.current) {
        const rect = triggerRef.current.getBoundingClientRect();
        const scrollX = window.scrollX;
        const scrollY = window.scrollY;

        let x = rect.left + scrollX + rect.width / 2;
        let y = rect.top + scrollY;

        switch (position) {
          case "bottom":
            y = rect.bottom + scrollY + 8;
            break;
          case "left":
            x = rect.left + scrollX - 8;
            y = rect.top + scrollY + rect.height / 2;
            break;
          case "right":
            x = rect.right + scrollX + 8;
            y = rect.top + scrollY + rect.height / 2;
            break;
          default: // top
            y = rect.top + scrollY - 8;
        }

        setCoords({ x, y });
        setIsVisible(true);
      }
    }, delay);
  }, [delay, position]);

  const hideTooltip = useCallback(() => {
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current);
    }
    setIsVisible(false);
  }, []);

  useEffect(() => {
    return () => {
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
      }
    };
  }, []);

  return (
    <>
      <span
        ref={triggerRef}
        className="preview-tooltip-trigger"
        onMouseEnter={showTooltip}
        onMouseLeave={hideTooltip}
        onFocus={showTooltip}
        onBlur={hideTooltip}
      >
        {children}
      </span>
      {isVisible && (
        <div
          ref={tooltipRef}
          className={`preview-tooltip preview-tooltip-${position}`}
          style={{
            left: coords.x,
            top: coords.y,
            maxWidth,
            transform: position === "top" ? "translate(-50%, -100%)" :
                       position === "bottom" ? "translate(-50%, 0)" :
                       position === "left" ? "translate(-100%, -50%)" :
                       "translate(0, -50%)"
          }}
        >
          {content}
        </div>
      )}
    </>
  );
}

type GoalPreviewProps = {
  goal: {
    id: string;
    title: string;
    status: string;
    explanation: string;
    createdAt: string;
  };
  children: React.ReactNode;
};

export function GoalPreview({ goal, children }: GoalPreviewProps) {
  return (
    <PreviewTooltip
      content={
        <div className="goal-preview">
          <div className="goal-preview-header">
            <strong>{goal.title}</strong>
            <span className={`preview-status preview-status-${goal.status}`}>{goal.status}</span>
          </div>
          <p className="goal-preview-explanation">{goal.explanation}</p>
          <div className="goal-preview-meta">
            <code>{goal.id.slice(0, 8)}...</code>
            <span>{new Date(goal.createdAt).toLocaleDateString()}</span>
          </div>
        </div>
      }
    >
      {children}
    </PreviewTooltip>
  );
}

type ArtifactPreviewProps = {
  artifact: {
    id: string;
    title: string;
    artifactType: string;
    content: string;
  };
  children: React.ReactNode;
};

export function ArtifactPreview({ artifact, children }: ArtifactPreviewProps) {
  const truncatedContent = artifact.content.length > 200 
    ? artifact.content.slice(0, 200) + "..." 
    : artifact.content;

  return (
    <PreviewTooltip
      content={
        <div className="artifact-preview">
          <div className="artifact-preview-header">
            <strong>{artifact.title}</strong>
            <span className="preview-badge">{artifact.artifactType}</span>
          </div>
          <pre className="artifact-preview-content">{truncatedContent}</pre>
        </div>
      }
      maxWidth={400}
    >
      {children}
    </PreviewTooltip>
  );
}

type AgentPreviewProps = {
  agent: {
    id: string;
    displayName: string;
    description: string;
    status: string;
    icon: string;
    category: string;
  };
  children: React.ReactNode;
};

export function AgentPreview({ agent, children }: AgentPreviewProps) {
  return (
    <PreviewTooltip
      content={
        <div className="agent-preview">
          <div className="agent-preview-header">
            <span className="agent-preview-icon">{agent.icon}</span>
            <strong>{agent.displayName}</strong>
            <span className={`preview-status preview-status-${agent.status}`}>{agent.status}</span>
          </div>
          <p className="agent-preview-description">{agent.description}</p>
          <div className="agent-preview-meta">
            <span className="preview-badge">{agent.category}</span>
          </div>
        </div>
      }
    >
      {children}
    </PreviewTooltip>
  );
}

type ApprovalPreviewProps = {
  approval: ApprovalRequest;
  children: React.ReactNode;
};

export function ApprovalPreview({ approval, children }: ApprovalPreviewProps) {
  const riskColors: Record<string, string> = {
    R1: "success",
    R2: "info",
    R3: "warning",
    R4: "error"
  };
  const latestDecision = approval.history.at(-1) ?? null;
  const hasImpact =
    approval.preview.impact.affectedPeople.length > 0 ||
    approval.preview.impact.affectedSystems.length > 0 ||
    approval.preview.impact.permissions.length > 0;

  return (
    <PreviewTooltip
      content={
        <div className="approval-preview">
          <div className="approval-preview-header">
            <strong>{approval.title}</strong>
            <span className={`preview-risk preview-risk-${riskColors[approval.riskClass] || "default"}`}>
              {approval.riskClass}
            </span>
          </div>
          <p className="approval-preview-rationale">{approval.rationale}</p>
          <div className="approval-preview-meta">
            <span className="preview-badge">{approval.preview.actionType}</span>
            {approval.preview.target ? <span>{approval.preview.target}</span> : null}
          </div>
          <p className="approval-preview-rationale">{approval.preview.summary}</p>
          {approval.preview.changes.length > 0 ? (
            <div className="approval-preview-changes">
              {approval.preview.changes.slice(0, 3).map((change) => (
                <div className="approval-preview-change" key={`${change.label}-${change.after}-${change.before}`}>
                  <strong>{change.label}:</strong> <span>{change.after || change.before}</span>
                </div>
              ))}
            </div>
          ) : null}
          {hasImpact ? (
            <div className="approval-preview-impact">
              {approval.preview.impact.affectedPeople.length > 0 ? (
                <p>People: {approval.preview.impact.affectedPeople.join(", ")}</p>
              ) : null}
              {approval.preview.impact.affectedSystems.length > 0 ? (
                <p>Systems: {approval.preview.impact.affectedSystems.join(", ")}</p>
              ) : null}
              {approval.preview.impact.permissions.length > 0 ? (
                <p>Permissions: {approval.preview.impact.permissions.join(", ")}</p>
              ) : null}
              <p>Rollback: {approval.preview.impact.rollback.replace(/_/g, " ")}</p>
            </div>
          ) : null}
          <div className="approval-preview-meta">
            <span>{new Date(approval.createdAt).toLocaleString()}</span>
            {approval.decisionScope ? <span>Scope: {approval.decisionScope.replace(/_/g, " ")}</span> : null}
          </div>
          {approval.decisionRationale ? (
            <p className="approval-preview-rationale">Decision note: {approval.decisionRationale}</p>
          ) : null}
          {latestDecision ? (
            <div className="approval-preview-history">
              <p>
                Last decision: {latestDecision.decision} · {latestDecision.scope.replace(/_/g, " ")}
              </p>
              {latestDecision.rationale ? <p>{latestDecision.rationale}</p> : null}
            </div>
          ) : null}
        </div>
      }
      maxWidth={440}
    >
      {children}
    </PreviewTooltip>
  );
}
