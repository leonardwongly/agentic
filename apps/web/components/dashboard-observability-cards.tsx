"use client";

import type { DashboardData } from "@agentic/repository";
import {
  ArtifactPreview,
  CopyButton,
  FeatureHelp,
  NoArtifactsEmpty,
  RelativeTime,
  StatusBadge,
  TimelineFilter,
  type TimelineFilters,
} from "./ui";

type DashboardObservabilityCardsProps = {
  latestArtifacts: DashboardData["latestArtifacts"];
  actionLogs: DashboardData["actionLogs"];
  filteredLogs: DashboardData["actionLogs"];
  onTimelineFilterChange: (filters: TimelineFilters) => void;
};

export function DashboardObservabilityCards({
  latestArtifacts,
  actionLogs,
  filteredLogs,
  onTimelineFilterChange,
}: DashboardObservabilityCardsProps) {
  return (
    <>
      <article className="card" id="section-artifacts">
        <div className="card-header">
          <FeatureHelp feature="artifacts">
            <h2>Artifacts</h2>
          </FeatureHelp>
          <span>{latestArtifacts.length} recent</span>
        </div>
        <div className="artifact-stack">
          {latestArtifacts.length === 0 ? <NoArtifactsEmpty /> : null}
          {latestArtifacts.map((artifact) => (
            <div className="artifact-card" key={artifact.id}>
              <div className="card-header">
                <ArtifactPreview artifact={artifact}>
                  <strong>{artifact.title}</strong>
                </ArtifactPreview>
                <StatusBadge status={artifact.artifactType} />
              </div>
              <pre>{artifact.content}</pre>
              <div className="artifact-actions">
                <CopyButton value={artifact.content} label="Copy content" />
              </div>
            </div>
          ))}
        </div>
      </article>

      <article className="card">
        <div className="card-header">
          <h2>Activity timeline</h2>
          <span>
            {filteredLogs.length} / {actionLogs.length} events
          </span>
        </div>
        <TimelineFilter
          logs={actionLogs}
          onFilterChange={onTimelineFilterChange}
        />
        <div className="timeline">
          {filteredLogs.map((log) => (
            <div className="timeline-row" key={log.id}>
              <div className="timeline-dot" />
              <div>
                <strong>{log.kind}</strong>
                <p>{log.message}</p>
                <RelativeTime date={log.createdAt} />
              </div>
            </div>
          ))}
        </div>
      </article>
    </>
  );
}
