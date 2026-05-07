"use client";

import type { Dispatch, SetStateAction } from "react";
import type { Commitment, NowQueueItem } from "@agentic/contracts";
import type { DashboardData, DashboardDiagnosticTarget } from "@agentic/repository";
import {
  CopyButton,
  ExecutionModeBadge,
  extractArtifactExecutionMode,
  ArtifactPreview,
  FeatureHelp,
  formatConfidencePercentage,
  getExecutionModePresentation,
  getImplementationTierPresentation,
  HealthIndicator,
  ImplementationTierBadge,
  NoArtifactsEmpty,
  RelativeTime,
  RiskBadge,
  ShareLinkButton,
  StatusBadge,
  TimelineFilter,
  type HealthStatus,
  type TimelineFilters
} from "./ui";

type ReliabilityHealth = {
  status: HealthStatus;
  score: number;
  issues: string[];
  lastCheck: Date;
};

type DashboardHeroPanelProps = {
  coreLoopSummary: {
    counts: {
      commitments: number;
      pendingApprovals: number;
      activeGoals: number;
      recentActivity: number;
      memories: number;
    };
    health: string;
  };
  coreLoopHealthCopy: string;
  eventFreshnessLabel: string;
  eventSummary: string;
  docsState: {
    kind: string;
    message: string;
  };
  isPending: boolean;
  focusRequestComposer: () => void;
  generateStartupBriefing: () => void;
  renderDocs: () => void;
  logout: () => void;
  getShareableUrl: () => string;
};

type ReliabilityCardProps = {
  data: DashboardData;
  reliabilityHealth: ReliabilityHealth;
  reliabilitySummary: string;
  isPending: boolean;
  openDiagnosticTarget: (target: DashboardDiagnosticTarget) => void;
  runDiagnosticAction: (target: DashboardDiagnosticTarget) => void;
};

type NowQueueCardProps = {
  data: DashboardData;
  highlightedItemId: string | null;
  getItemAnchorId: (itemId: string) => string;
  formatCommitmentUrgencyLabel: (value: string) => string;
  isPending: boolean;
  openDiagnosticTarget: (target: DashboardDiagnosticTarget) => void;
  updateCommitment: (commitmentId: string, updatedAt: string, action: "complete" | "dismiss" | "reopen") => void;
};

type ArtifactsPanelProps = {
  artifacts: DashboardData["latestArtifacts"];
  totalArtifactCount: number;
  goalConfidenceById: Map<string, number>;
};

type ActivityTimelineProps = {
  logs: DashboardData["actionLogs"];
  filteredLogs: DashboardData["actionLogs"];
  setFilters: Dispatch<SetStateAction<TimelineFilters>>;
};

function resolveCommitment(data: DashboardData, item: NowQueueItem): Commitment | null {
  return data.commitments.find((candidate) => candidate.id === item.commitmentId) ?? null;
}

export function DashboardHeroPanel({
  coreLoopSummary,
  coreLoopHealthCopy,
  eventFreshnessLabel,
  eventSummary,
  docsState,
  isPending,
  focusRequestComposer,
  generateStartupBriefing,
  renderDocs,
  logout,
  getShareableUrl
}: DashboardHeroPanelProps) {
  return (
    <section className="hero-panel">
      <div>
        <p className="eyebrow">Trusted execution control plane</p>
        <h1>Run commitments, approvals, and automations from one governed loop.</h1>
        <p className="lede">
          Start with what needs attention now, resolve what is blocked, confirm what can run safely, and review what
          changed recently. The reproducible document export stays available as an evidence snapshot instead of
          driving the main operating flow.
        </p>
        <div className="advanced-operations-summary" aria-label="Governed loop summary">
          <span className="pill">Decide: {coreLoopSummary.counts.commitments} commitments</span>
          <span className="pill">Approve: {coreLoopSummary.counts.pendingApprovals} pending</span>
          <span className="pill">Execute: {coreLoopSummary.counts.activeGoals} active</span>
          <span className="pill">Observe: {coreLoopSummary.counts.recentActivity} events</span>
          <span className="pill">Improve: {coreLoopSummary.counts.memories} memories</span>
          <span className="pill">Events: {eventFreshnessLabel}</span>
          <span className="pill">{eventSummary}</span>
        </div>
      </div>
      <div className="hero-actions">
        <div className="hero-button-row">
          <button type="button" className="primary-button" onClick={focusRequestComposer} disabled={isPending}>
            Request work
          </button>
          <button type="button" className="secondary-button" onClick={generateStartupBriefing} disabled={isPending}>
            Startup briefing
          </button>
          <button type="button" className="secondary-button" onClick={renderDocs} disabled={isPending}>
            Rebuild `agentic.docx`
          </button>
          <button type="button" className="secondary-button" onClick={logout} disabled={isPending}>
            Lock session
          </button>
          <ShareLinkButton getUrl={getShareableUrl} label="Share view" />
        </div>
        <p className="palette-hint">Press <kbd>Cmd+K</kbd> to open command palette · <kbd>?</kbd> for shortcuts</p>
        <p className={`status-chip ${docsState.kind}`}>
          {docsState.message || "The governed document snapshot is ready whenever you need an exportable record."}
        </p>
        <p className={`status-chip ${coreLoopSummary.health === "idle" ? "idle" : "success"}`}>{coreLoopHealthCopy}</p>
      </div>
    </section>
  );
}

export function ReliabilityCard({
  data,
  reliabilityHealth,
  reliabilitySummary,
  isPending,
  openDiagnosticTarget,
  runDiagnosticAction
}: ReliabilityCardProps) {
  return (
    <article className="card reliability-card">
      <div className="card-header reliability-card-header">
        <div className="reliability-heading">
          <HealthIndicator health={reliabilityHealth} size="lg" showScore />
          <div>
            <h2>Reliability</h2>
            <p className="reliability-summary">{reliabilitySummary}</p>
          </div>
        </div>
        <span>
          Checked <RelativeTime date={data.diagnostics.generatedAt} />
        </span>
      </div>
      {data.diagnostics.items.length === 0 ? (
        <p className="empty-state">
          The dashboard is clear. New reliability issues will appear here as soon as approvals expire, memories go stale,
          context signals conflict, queues degrade, connectors lose health, workflows block, or watchers outlive their goals.
        </p>
      ) : (
        <div className="diagnostic-grid">
          {data.diagnostics.items.map((item) => (
            <div className={`diagnostic-item ${item.severity}`} key={item.kind}>
              <div className="diagnostic-item-header">
                <strong>{item.title}</strong>
                <span className={`pill diagnostic-pill ${item.severity}`}>{item.count}</span>
              </div>
              <div className="diagnostic-reasons">
                {item.reasons.map((reason) => (
                  <p key={`${item.kind}-${reason}`}>{reason}</p>
                ))}
              </div>
              {item.targets.length > 0 ? (
                <div className="diagnostic-targets">
                  {item.targets.map((target) => (
                    <div
                      className="diagnostic-target-row"
                      key={`${item.kind}-${target.section}-${target.itemId ?? target.label}`}
                    >
                      <button
                        type="button"
                        className="secondary-button diagnostic-target-button"
                        onClick={() => openDiagnosticTarget(target)}
                      >
                        {target.label}
                      </button>
                      {target.action ? (
                        <button
                          type="button"
                          className="secondary-button diagnostic-action-button"
                          onClick={() => runDiagnosticAction(target)}
                          disabled={isPending}
                        >
                          {target.actionLabel ?? "Resolve"}
                        </button>
                      ) : null}
                    </div>
                  ))}
                </div>
              ) : null}
            </div>
          ))}
        </div>
      )}
    </article>
  );
}

export function NowQueueCard({
  data,
  highlightedItemId,
  getItemAnchorId,
  formatCommitmentUrgencyLabel,
  isPending,
  openDiagnosticTarget,
  updateCommitment
}: NowQueueCardProps) {
  return (
    <article className="card now-queue-card" id="section-now">
      <div className="card-header">
        <h2>Now queue</h2>
        <span>
          {data.nowQueue.items.length} of {data.nowQueue.totalCount} ready now
        </span>
      </div>
      <p className="empty-state">
        Server-derived sequencing keeps the next few commitments bounded, urgency-aware, and aligned with reliability
        signals already present in the control plane.
      </p>
      <div className="list-stack">
        {data.nowQueue.items.length === 0 ? (
          <p className="empty-state">No commitments are currently ready for immediate action.</p>
        ) : null}
        {data.nowQueue.items.map((item) => {
          const suggestedNextAction = item.suggestedNextAction;
          const currentCommitment = resolveCommitment(data, item);

          return (
            <div
              className={`list-item vertical ${highlightedItemId === item.commitmentId ? "selection-highlight" : ""}`}
              id={getItemAnchorId(item.commitmentId)}
              key={item.commitmentId}
            >
              <div>
                <strong>{item.title}</strong>
                <p>{item.summary}</p>
              </div>
              <div className="approval-actions">
                <StatusBadge status={item.status} />
                <span className={`pill now-queue-urgency urgency-${item.urgency}`}>
                  {formatCommitmentUrgencyLabel(item.urgency)}
                </span>
                {item.riskClass ? <RiskBadge riskClass={item.riskClass} /> : null}
                <span className="pill">{Math.round(item.confidence * 100)}%</span>
                {item.dueAt ? <RelativeTime date={item.dueAt} /> : null}
                {item.status === "completed" || item.status === "dismissed" ? (
                  <button
                    type="button"
                    className="secondary-button"
                    onClick={() => {
                      if (currentCommitment) {
                        updateCommitment(item.commitmentId, currentCommitment.updatedAt, "reopen");
                      }
                    }}
                    disabled={isPending || !currentCommitment}
                  >
                    Reopen
                  </button>
                ) : (
                  <>
                    {suggestedNextAction ? (
                      <button
                        type="button"
                        className="secondary-button"
                        onClick={() => openDiagnosticTarget(suggestedNextAction)}
                      >
                        {suggestedNextAction.label}
                      </button>
                    ) : null}
                    <button
                      type="button"
                      className="secondary-button"
                      onClick={() => {
                        if (currentCommitment) {
                          updateCommitment(item.commitmentId, currentCommitment.updatedAt, "complete");
                        }
                      }}
                      disabled={isPending || !currentCommitment}
                    >
                      Complete
                    </button>
                  </>
                )}
              </div>
              {item.reasons.length > 0 ? (
                <div className="now-queue-reasons">
                  {item.reasons.map((reason) => (
                    <span className="pill" key={`${item.commitmentId}-${reason}`}>
                      {reason}
                    </span>
                  ))}
                </div>
              ) : null}
            </div>
          );
        })}
      </div>
    </article>
  );
}

export function ArtifactsPanel({
  artifacts,
  totalArtifactCount,
  goalConfidenceById
}: ArtifactsPanelProps) {
  return (
    <article className="card" id="section-artifacts">
      <div className="card-header">
        <FeatureHelp feature="artifacts">
          <h2>Artifacts</h2>
        </FeatureHelp>
        <span>{artifacts.length} / {totalArtifactCount} recent</span>
      </div>
      <div className="artifact-stack">
        {artifacts.length === 0 ? (
          totalArtifactCount === 0 ? (
            <NoArtifactsEmpty />
          ) : (
            <p className="status-chip idle">No artifacts match the current execution-mode filter.</p>
          )
        ) : null}
        {artifacts.map((artifact) => {
          const executionMode = extractArtifactExecutionMode(artifact);
          const goalConfidence = goalConfidenceById.get(artifact.goalId);

          return (
            <div className="artifact-card" key={artifact.id}>
              <div className="card-header">
                <ArtifactPreview artifact={artifact}>
                  <strong>{artifact.title}</strong>
                </ArtifactPreview>
                <div className="detail-list-badges">
                  <StatusBadge status={artifact.artifactType} />
                  <ImplementationTierBadge mode={executionMode} />
                  <ExecutionModeBadge mode={executionMode} />
                </div>
              </div>
              <div className="detail-list-meta">
                <span>
                  Implementation tier:{" "}
                  <strong>{getImplementationTierPresentation(executionMode).label}</strong>
                </span>
              </div>
              <div className="detail-list-meta">
                <span>
                  Execution mode:{" "}
                  <strong>{getExecutionModePresentation(executionMode).label}</strong>
                </span>
                <span>
                  Goal confidence:{" "}
                  <strong>{typeof goalConfidence === "number" ? formatConfidencePercentage(goalConfidence) : "Unavailable"}</strong>
                </span>
              </div>
              <pre>{artifact.content}</pre>
              <div className="artifact-actions">
                <CopyButton value={artifact.content} label="Copy content" />
              </div>
            </div>
          );
        })}
      </div>
    </article>
  );
}

export function ActivityTimeline({ logs, filteredLogs, setFilters }: ActivityTimelineProps) {
  return (
    <article className="card">
      <div className="card-header">
        <h2>Activity timeline</h2>
        <span>{filteredLogs.length} / {logs.length} events</span>
      </div>
      <TimelineFilter logs={logs} onFilterChange={setFilters} />
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
  );
}
