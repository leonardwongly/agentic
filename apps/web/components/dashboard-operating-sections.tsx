"use client";

import type { DashboardOperatingSection, DashboardOperatingSections } from "@agentic/contracts";
import { StatusBadge } from "./ui";

type DashboardOperatingSectionsCardProps = {
  operatingSections: DashboardOperatingSections;
  openTarget: (section: string, itemId?: string) => void;
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

export function DashboardOperatingSectionsCard({ operatingSections, openTarget }: DashboardOperatingSectionsCardProps) {
  return (
    <article className="card control-plane-card">
      <div className="card-header">
        <h2>Operating loop</h2>
        <span>Server-derived section ownership</span>
      </div>
      <div className="control-plane-grid">
        {operatingSections.sections.map((section) => (
          <button
            key={section.key}
            type="button"
            className="control-plane-section"
            onClick={() => openTarget(section.targetSection, section.targetItemId)}
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
