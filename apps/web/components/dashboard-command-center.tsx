"use client";

import { useId, useRef } from "react";
import { StatusBadge } from "./ui";
import type {
  CommandCenterRole,
  CommandCenterRoleView,
  DashboardCommandCenterModel
} from "../lib/command-center";
import { getCommandCenterStatusLabel } from "../lib/command-center";
import { postDashboardCoreLoopEvent, type CommandCenterTelemetrySource } from "../lib/core-loop-client";

type DashboardCommandCenterProps = {
  model: DashboardCommandCenterModel;
  role: CommandCenterRole;
  onRoleChange: (role: CommandCenterRole) => void;
  openTarget: (section: string, itemId?: string) => void;
};

function badgeStatus(status: CommandCenterRoleView["focusAreas"][number]["status"]): "active" | "pending" | "blocked" | "paused" {
  switch (status) {
    case "critical":
      return "blocked";
    case "attention":
      return "pending";
    case "healthy":
      return "active";
    default:
      return "paused";
  }
}

const roleOrder: CommandCenterRole[] = ["command", "communications", "executive"];

export function DashboardCommandCenter({
  model,
  role,
  onRoleChange,
  openTarget
}: DashboardCommandCenterProps) {
  const selectedRoleView = model.roleViews[role];
  const mountedAtRef = useRef(Date.now());
  const rolePanelId = `${useId()}-command-center-role-panel`;

  const trackAction = (
    source: CommandCenterTelemetrySource,
    targetSection: string,
    severity?: "critical" | "attention"
  ) => {
    void postDashboardCoreLoopEvent({
      event: "command_center_action",
      role,
      source,
      targetSection,
      elapsedMs: Math.max(0, Date.now() - mountedAtRef.current),
      ...(severity ? { severity } : {})
    }).catch(() => undefined);
  };

  return (
    <article className="card command-center-card" id="section-command-center">
      <div className="card-header command-center-header">
        <div>
          <p className="eyebrow">Exception-first operator shell</p>
          <h2>Command center</h2>
          <p className="command-center-summary">{model.summary}</p>
        </div>
        <div className="command-center-header-meta">
          {model.activeOperatorProductName ? (
            <span className="pill">Active pack: {model.activeOperatorProductName}</span>
          ) : null}
          <span className="pill">
            Next best action: {model.nextBestAction ? model.nextBestAction.label : "Queue review"}
          </span>
        </div>
      </div>

      <div className="command-center-topline" aria-label="Command center topline">
        <div className="command-center-metric">
          <span>Blocked work</span>
          <strong>{model.blockedCount}</strong>
        </div>
        <div className="command-center-metric">
          <span>Approvals</span>
          <strong>{model.approvalCount}</strong>
        </div>
        <div className="command-center-metric">
          <span>Failures</span>
          <strong>{model.failureCount}</strong>
        </div>
        <button
          type="button"
          className="command-center-metric action"
          onClick={() => {
            const targetSection = model.nextBestAction?.targetSection ?? "now";

            trackAction("next_best_action", targetSection, model.priorities[0]?.severity);
            openTarget(targetSection, model.nextBestAction?.targetItemId);
          }}
        >
          <span>Next best action</span>
          <strong>{model.nextBestAction?.label ?? "Open now queue"}</strong>
        </button>
      </div>

      <div className="command-center-layout">
        <section className="command-center-priorities">
          <div className="command-center-section-heading">
            <div>
              <strong>Immediate exceptions</strong>
              <p>Blocked work, approvals, automation failures, and trust degradations stay visible first.</p>
            </div>
            <span className="pill">{model.priorities.length} visible</span>
          </div>
          {model.priorities.length > 0 ? (
            <div className="command-center-priority-list">
              {model.priorities.map((priority) => (
                <button
                  key={priority.id}
                  type="button"
                  className={`command-center-priority priority-${priority.severity}`}
                  onClick={() => {
                    trackAction("priority", priority.action.targetSection, priority.severity);
                    openTarget(priority.action.targetSection, priority.action.targetItemId);
                  }}
                >
                  <div className="command-center-priority-header">
                    <span className={`pill command-center-priority-pill ${priority.severity}`}>
                      {priority.severity === "critical" ? "Critical" : "Attention"}
                    </span>
                    <span className="pill">{priority.countLabel}</span>
                  </div>
                  <strong>{priority.title}</strong>
                  <p>{priority.summary}</p>
                  <span className="command-center-priority-action">{priority.action.label}</span>
                </button>
              ))}
            </div>
          ) : (
            <p className="empty-state command-center-empty">
              No blocking exceptions are open. The role lenses below stay available for queue review, leadership checks,
              and operator-pack setup.
            </p>
          )}
        </section>

        <section className="command-center-role-view">
          <div className="command-center-section-heading">
            <div>
              <strong>Role-aware views</strong>
              <p>Switch the shell between the default loop and focused operator wedges.</p>
            </div>
            <div className="command-center-role-tabs" role="tablist" aria-label="Role-aware views">
              {roleOrder.map((candidate) => {
                const candidateView = model.roleViews[candidate];
                const tabId = `${rolePanelId}-${candidate}-tab`;

                return (
                  <button
                    key={candidate}
                    type="button"
                    id={tabId}
                    role="tab"
                    aria-selected={role === candidate}
                    aria-controls={rolePanelId}
                    tabIndex={role === candidate ? 0 : -1}
                    className={role === candidate ? "primary-button" : "secondary-button"}
                    onClick={() => {
                      if (candidate === role) {
                        return;
                      }

                      void postDashboardCoreLoopEvent({
                        event: "command_center_role_change",
                        role: candidate,
                        elapsedMs: Math.max(0, Date.now() - mountedAtRef.current)
                      }).catch(() => undefined);
                      onRoleChange(candidate);
                    }}
                  >
                    {candidateView.label}
                  </button>
                );
              })}
            </div>
          </div>

          <div
            id={rolePanelId}
            role="tabpanel"
            aria-labelledby={`${rolePanelId}-${role}-tab`}
            className="command-center-role-card"
          >
            <div className="command-center-role-intro">
              <div>
                <p className="eyebrow">{selectedRoleView.eyebrow}</p>
                <h3>{selectedRoleView.label}</h3>
              </div>
              <p>{selectedRoleView.description}</p>
            </div>

            <div className="command-center-role-stats" aria-label={`${selectedRoleView.label} stats`}>
              {selectedRoleView.stats.map((stat) => (
                <span key={stat} className="pill">
                  {stat}
                </span>
              ))}
            </div>

            <div className="command-center-role-actions">
              {selectedRoleView.actions.map((action) => (
                <button
                  key={action.id}
                  type="button"
                  className="secondary-button"
                  onClick={() => {
                    trackAction("role_action", action.targetSection);
                    openTarget(action.targetSection, action.targetItemId);
                  }}
                >
                  {action.label}
                </button>
              ))}
            </div>

            <div className="command-center-focus-grid">
              {selectedRoleView.focusAreas.map((focusArea) => (
                <button
                  key={focusArea.id}
                  type="button"
                  className="command-center-focus-card"
                  onClick={() => {
                    trackAction("focus_area", focusArea.targetSection);
                    openTarget(focusArea.targetSection, focusArea.targetItemId);
                  }}
                >
                  <div className="command-center-focus-header">
                    <div>
                      <strong>{focusArea.title}</strong>
                      <p>{focusArea.description}</p>
                    </div>
                    <StatusBadge status={badgeStatus(focusArea.status)}>
                      {getCommandCenterStatusLabel(focusArea.status)}
                    </StatusBadge>
                  </div>
                  <span className="pill">{focusArea.metric}</span>
                </button>
              ))}
            </div>
          </div>
        </section>
      </div>
    </article>
  );
}
