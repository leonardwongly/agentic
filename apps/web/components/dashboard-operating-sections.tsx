"use client";

import type {
  CommitmentInboxBucket,
  DashboardOperatingSection,
  DashboardOperatingSectionKey,
  DashboardOperatingSections
} from "@agentic/contracts";
import { StatusBadge } from "./ui";

type DashboardOperatingSectionsCardProps = {
  operatingSections: DashboardOperatingSections;
  openView: (section: string, itemId?: string, filter?: CommitmentInboxBucket | null) => void;
};

function sectionBadgeStatus(status: DashboardOperatingSection["status"]): string {
  switch (status) {
    case "healthy":
      return "active";
    case "attention":
      return "pending";
    case "critical":
      return "blocked";
    default:
      return "paused";
  }
}

function sectionStatusLabel(status: DashboardOperatingSection["status"]): string {
  switch (status) {
    case "healthy":
      return "Healthy";
    case "attention":
      return "Attention";
    case "critical":
      return "Critical";
    default:
      return "Idle";
  }
}

function humanizeSectionKey(key: DashboardOperatingSectionKey): string {
  switch (key) {
    case "now":
      return "Now";
    case "automation":
      return "Automation";
    case "execution":
      return "Execution";
    case "trust":
      return "Trust";
    default:
      return "Build";
  }
}

export function DashboardOperatingSectionsCard({ operatingSections, openView }: DashboardOperatingSectionsCardProps) {
  return (
    <article className="card control-plane-card">
      <div className="card-header">
        <h2>Operating loop</h2>
        <span>Server-derived section ownership</span>
      </div>
      <div className="control-plane-section">
        <div className="control-plane-section-header">
          <div>
            <strong>{operatingSections.roleView.label}</strong>
            <p>{operatingSections.roleView.summary}</p>
          </div>
          <StatusBadge status="active">
            {operatingSections.roleView.role ? `${operatingSections.roleView.role} role` : "setup mode"}
          </StatusBadge>
        </div>
        {operatingSections.roleView.focusAreas.length > 0 ? (
          <ul className="control-plane-highlights">
            {operatingSections.roleView.focusAreas.map((focusArea) => (
              <li key={focusArea}>{focusArea}</li>
            ))}
          </ul>
        ) : null}
        {operatingSections.roleView.prioritizedSectionKeys.length > 0 ? (
          <div className="control-plane-stats">
            {operatingSections.roleView.prioritizedSectionKeys.map((sectionKey) => (
              <span key={sectionKey} className="control-plane-stat">
                Focus {humanizeSectionKey(sectionKey)}
              </span>
            ))}
          </div>
        ) : null}
      </div>
      <div className="control-plane-section">
        <div className="control-plane-section-header">
          <div>
            <strong>{operatingSections.teamWorkflow.label}</strong>
            <p>{operatingSections.teamWorkflow.summary}</p>
          </div>
          <StatusBadge status={sectionBadgeStatus(operatingSections.teamWorkflow.slaStatus)}>
            {sectionStatusLabel(operatingSections.teamWorkflow.slaStatus)}
          </StatusBadge>
        </div>
        <div className="control-plane-stats">
          <span className="control-plane-stat">{operatingSections.teamWorkflow.visibilityLabel}</span>
          {operatingSections.teamWorkflow.escalationTargetRole ? (
            <span className="control-plane-stat">Escalate to {operatingSections.teamWorkflow.escalationTargetRole}</span>
          ) : null}
          <span className="control-plane-stat">
            Audit {operatingSections.teamWorkflow.auditCoverage.required ? "required" : "optional"}
          </span>
          {operatingSections.teamWorkflow.auditCoverage.latestStatus ? (
            <span className="control-plane-stat">
              Audit export {operatingSections.teamWorkflow.auditCoverage.latestStatus}
            </span>
          ) : null}
          {operatingSections.teamWorkflow.queueMetrics.map((metric) => (
            <span key={metric} className="control-plane-stat">
              {metric}
            </span>
          ))}
        </div>
        {operatingSections.teamWorkflow.ownershipAssignments.length > 0 ? (
          <div className="control-plane-stats">
            {operatingSections.teamWorkflow.ownershipAssignments.map((assignment) => (
              <span key={assignment.key} className="control-plane-stat">
                {assignment.label}: {assignment.ownerRole ?? "monitor"}
              </span>
            ))}
          </div>
        ) : null}
        {operatingSections.teamWorkflow.queues.length > 0 ? (
          <div className="control-plane-detail-grid">
            {operatingSections.teamWorkflow.queues.map((queue) => (
              <button
                key={queue.key}
                type="button"
                className="control-plane-detail-card"
                onClick={() => openView(queue.targetSection, queue.targetItemId, queue.targetFilter)}
              >
                <div className="control-plane-section-header">
                  <div>
                    <strong>{queue.label}</strong>
                    <p>{queue.summary}</p>
                  </div>
                  <StatusBadge status={sectionBadgeStatus(queue.status)}>{sectionStatusLabel(queue.status)}</StatusBadge>
                </div>
                <div className="control-plane-stats">
                  <span className="control-plane-stat">{pluralizeQueueItem(queue.count)}</span>
                  {queue.ownerRole ? <span className="control-plane-stat">{queue.ownerRole} lane</span> : null}
                  {queue.oldestAgeLabel ? <span className="control-plane-stat">{queue.oldestAgeLabel}</span> : null}
                </div>
              </button>
            ))}
          </div>
        ) : null}
        {operatingSections.teamWorkflow.controls.length > 0 ? (
          <div className="control-plane-detail-grid">
            {operatingSections.teamWorkflow.controls.map((control) => (
              <button
                key={control.key}
                type="button"
                className="control-plane-detail-card"
                onClick={() => openView(control.targetSection, control.targetItemId, control.targetFilter)}
                disabled={!control.permission.allowed}
              >
                <div className="control-plane-section-header">
                  <div>
                    <strong>{control.label}</strong>
                    <p>{control.summary}</p>
                  </div>
                  <StatusBadge status={sectionBadgeStatus(control.status)}>
                    {control.permission.allowed ? sectionStatusLabel(control.status) : "Restricted"}
                  </StatusBadge>
                </div>
                <div className="control-plane-stats">
                  <span className="control-plane-stat">
                    {control.permission.allowed ? "Action available" : control.permission.reason}
                  </span>
                </div>
              </button>
            ))}
          </div>
        ) : null}
        <ul className="control-plane-highlights">
          <li>{operatingSections.teamWorkflow.slaSummary}</li>
          <li>{operatingSections.teamWorkflow.auditCoverage.summary}</li>
          {operatingSections.teamWorkflow.ownershipAssignments.map((assignment) => (
            <li key={assignment.key}>
              {assignment.label}: {assignment.summary}
            </li>
          ))}
          {operatingSections.teamWorkflow.actionBoundaries.map((boundary) => (
            <li key={boundary}>{boundary}</li>
          ))}
          {operatingSections.teamWorkflow.handoffGuidance.map((guidance) => (
            <li key={guidance}>{guidance}</li>
          ))}
        </ul>
      </div>
      <button
        type="button"
        className="control-plane-section"
        onClick={() => openView(operatingSections.nextBestAction.targetSection, operatingSections.nextBestAction.targetItemId)}
      >
        <div className="control-plane-section-header">
          <div>
            <strong>Next best action: {operatingSections.nextBestAction.label}</strong>
            <p>{operatingSections.nextBestAction.summary}</p>
          </div>
          <StatusBadge status={sectionBadgeStatus(operatingSections.nextBestAction.status)}>
            {sectionStatusLabel(operatingSections.nextBestAction.status)}
          </StatusBadge>
        </div>
        <div className="control-plane-stats">
          <span className="control-plane-stat">
            {operatingSections.nextBestAction.role ? `${operatingSections.nextBestAction.role} route` : "setup route"}
          </span>
          <span className="control-plane-stat">Open {operatingSections.nextBestAction.targetSection}</span>
        </div>
        {operatingSections.nextBestAction.reason ? (
          <ul className="control-plane-highlights">
            <li>{operatingSections.nextBestAction.reason}</li>
          </ul>
        ) : null}
      </button>
      <div className="control-plane-grid">
        {operatingSections.sections.map((section) => (
          <button
            key={section.key}
            type="button"
            className="control-plane-section"
            onClick={() => openView(section.targetSection, section.targetItemId)}
          >
            <div className="control-plane-section-header">
              <div>
                <strong>{section.title}</strong>
                <p>{section.description}</p>
              </div>
              <StatusBadge status={sectionBadgeStatus(section.status)}>{sectionStatusLabel(section.status)}</StatusBadge>
            </div>
            <div className="control-plane-stats">
              {section.metrics.map((metric) => (
                <span key={metric} className="control-plane-stat">
                  {metric}
                </span>
              ))}
            </div>
            {section.highlights.length > 0 ? (
              <ul className="control-plane-highlights">
                {section.highlights.map((highlight) => (
                  <li key={highlight}>{highlight}</li>
                ))}
              </ul>
            ) : null}
          </button>
        ))}
      </div>
    </article>
  );
}

function pluralizeQueueItem(count: number): string {
  return `${count} item${count === 1 ? "" : "s"}`;
}
