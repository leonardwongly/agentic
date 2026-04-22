"use client";

import { useRouter } from "next/navigation";
import { startTransition, useState } from "react";
import type { DashboardData } from "@agentic/repository";
import { RelativeTime, toast } from "./ui";

type DashboardOperationsTowerCardProps = {
  operations: NonNullable<DashboardData["operations"]>;
  expanded: boolean;
  highlightedItemId: string | null;
  getItemAnchorId: (itemId: string) => string;
  navigateToSection: (section: string, itemId?: string) => void;
};

function describeStatus(status: NonNullable<DashboardData["operations"]>["asyncExecution"]["status"]): string {
  switch (status) {
    case "critical":
      return "critical";
    case "attention":
      return "attention";
    case "healthy":
      return "healthy";
    case "idle":
      return "idle";
  }
}

function describeExpectedModes(
  modes: NonNullable<DashboardData["operations"]>["connectorHealth"]["items"][number]["expectedSupportedModes"]
): string | null {
  return modes.length > 0 ? modes.join(" · ") : null;
}

function describeLinkedIntegrations(
  names: NonNullable<DashboardData["operations"]>["connectorHealth"]["items"][number]["linkedIntegrationNames"]
): string | null {
  return names.length > 0 ? names.join(" · ") : null;
}

function renderPostureAction(
  item: NonNullable<DashboardData["operations"]>["autonomyPosture"]["overridePaths"][number],
  navigateToSection: DashboardOperationsTowerCardProps["navigateToSection"]
) {
  return (
    <button
      type="button"
      className="secondary-button"
      onClick={() => navigateToSection(item.target.section, item.target.itemId)}
    >
      {item.label}
    </button>
  );
}

export function DashboardOperationsTowerCard(props: DashboardOperationsTowerCardProps) {
  const { operations, expanded, highlightedItemId, getItemAnchorId, navigateToSection } = props;
  const router = useRouter();
  const [replayingJobId, setReplayingJobId] = useState<string | null>(null);

  const replayJob = async (jobId: string) => {
    setReplayingJobId(jobId);

    try {
      const response = await fetch(`/api/jobs/${jobId}/replay`, {
        method: "POST"
      });
      const payload = (await response.json().catch(() => null)) as { error?: string } | null;

      if (!response.ok) {
        throw new Error(payload?.error ?? "Failed to replay job.");
      }

      startTransition(() => {
        router.refresh();
      });
      toast.success("Queued job replay.");
    } catch (error) {
      toast.error("Replay failed", error instanceof Error ? error.message : "Failed to replay job.");
    } finally {
      setReplayingJobId(null);
    }
  };

  const renderAsyncIssueAction = (
    item: NonNullable<DashboardData["operations"]>["asyncExecution"]["items"][number]
  ) => {
    if (!item.remediation) {
      return item.target ? (
        <button
          type="button"
          className="secondary-button"
          onClick={() => navigateToSection(item.target!.section, item.target!.itemId)}
        >
          {item.target.label}
        </button>
      ) : null;
    }

    if (item.remediation.kind === "replay_job") {
      return (
        <button
          type="button"
          className="secondary-button"
          onClick={() => void replayJob(item.jobId)}
          disabled={replayingJobId === item.jobId}
        >
          {replayingJobId === item.jobId ? "Replaying..." : item.remediation.label}
        </button>
      );
    }

    if (!item.target) {
      return null;
    }

    return (
      <button
        type="button"
        className="secondary-button"
        onClick={() => navigateToSection(item.target!.section, item.target!.itemId)}
      >
        {item.remediation.label}
      </button>
    );
  };

  return (
    <article className={`card ${expanded ? "" : "advanced-surface-hidden"}`.trim()} id="section-operations">
      <div className="card-header">
        <div>
          <h2>Operations control tower</h2>
          <p className="operator-product-subtitle">
            Queue pressure, dead letters, stale leases, and degraded connector credentials are surfaced here so operators
            can recover the runtime from one bounded control surface.
          </p>
        </div>
        <span>
          Checked <RelativeTime date={operations.generatedAt} />
        </span>
      </div>

      <div className="advanced-operations-summary" aria-label="Operations control tower summary">
        <span className="pill">Autonomy: {operations.autonomyPosture.label}</span>
        <span className="pill">Async: {describeStatus(operations.asyncExecution.status)}</span>
        <span className="pill">Shell: {describeStatus(operations.shellEffectiveness.status)}</span>
        <span className="pill">Queue issues: {operations.asyncExecution.issueCount}</span>
        <span className="pill">Connectors degraded: {operations.connectorHealth.issueCount}</span>
        <span className="pill">Retrying: {operations.asyncExecution.retryingJobs}</span>
        <span className="pill">Dead letters: {operations.asyncExecution.deadLetterJobs}</span>
      </div>

      <div className="list-stack compact">
        <div className="list-item vertical">
          <div className="operator-product-row-heading">
            <div>
              <strong>Autonomy posture</strong>
              <p>{operations.autonomyPosture.summary}</p>
            </div>
            <div className="goal-item-actions">
              <span className="pill">{operations.autonomyPosture.label}</span>
              <span className="pill">{describeStatus(operations.autonomyPosture.status)}</span>
            </div>
          </div>
          <div className="advanced-operations-summary">
            {operations.autonomyPosture.stats.map((stat) => (
              <span className="pill" key={stat}>
                {stat}
              </span>
            ))}
          </div>
          {operations.autonomyPosture.reasons.length > 0 || operations.autonomyPosture.overridePaths.length > 0 ? (
            <div className="advanced-operations-expanded">
              {operations.autonomyPosture.reasons.map((reason) => (
                <span className="pill" key={reason}>
                  {reason}
                </span>
              ))}
              {operations.autonomyPosture.overridePaths.map((item) => (
                <span className="goal-item-actions" key={item.id}>
                  {renderPostureAction(item, navigateToSection)}
                  <span className="pill">{item.note}</span>
                  <span className="pill">{item.permission.replace("_", " ")} access</span>
                </span>
              ))}
            </div>
          ) : null}
        </div>

        <div className="list-item vertical">
          <div className="operator-product-row-heading">
            <div>
              <strong>Shell effectiveness</strong>
              <p>{operations.shellEffectiveness.summary}</p>
            </div>
            <div className="goal-item-actions">
              <span className="pill">{describeStatus(operations.shellEffectiveness.status)}</span>
              <span className="pill">{operations.shellEffectiveness.measurementWindowDays}d window</span>
            </div>
          </div>
          <div className="advanced-operations-summary">
            {operations.shellEffectiveness.metrics.map((metric) => (
              <span className="pill" key={metric}>
                {metric}
              </span>
            ))}
          </div>
          {operations.shellEffectiveness.highlights.length > 0 ? (
            <div className="advanced-operations-expanded">
              {operations.shellEffectiveness.highlights.map((highlight) => (
                <span className="pill" key={highlight}>
                  {highlight}
                </span>
              ))}
              <span className="pill">
                Window start <RelativeTime date={operations.shellEffectiveness.windowStartedAt} />
              </span>
            </div>
          ) : null}
        </div>

        <div className="list-item vertical">
          <div className="operator-product-row-heading">
            <div>
              <strong>Async execution</strong>
              <p>
                {operations.asyncExecution.issueCount > 0
                  ? "Jobs need recovery before the queue can be treated as healthy."
                  : operations.asyncExecution.queuedJobs + operations.asyncExecution.runningJobs > 0
                    ? "The queue is active and currently within its expected bounds."
                    : "No active queue pressure is visible for this workspace."}
              </p>
            </div>
            <span className="pill">{describeStatus(operations.asyncExecution.status)}</span>
          </div>
          <div className="advanced-operations-summary">
            <span className="pill">Queued {operations.asyncExecution.queuedJobs}</span>
            <span className="pill">Running {operations.asyncExecution.runningJobs}</span>
            <span className="pill">Retrying {operations.asyncExecution.retryingJobs}</span>
            <span className="pill">Dead letter {operations.asyncExecution.deadLetterJobs}</span>
            <span className="pill">Expired lease {operations.asyncExecution.expiredLeaseCount}</span>
          </div>
        </div>

        {operations.asyncExecution.items.map((item) => (
          <div
            className={`list-item vertical ${highlightedItemId === item.id ? "selection-highlight" : ""}`}
            id={getItemAnchorId(item.id)}
            key={item.id}
          >
            <div className="operator-product-row-heading">
              <div>
                <strong>{item.label}</strong>
                <p>{item.summary}</p>
              </div>
              <div className="goal-item-actions">
                <span className="pill">{item.severity}</span>
                <span className="pill">{item.status.replaceAll("_", " ")}</span>
              </div>
            </div>
            <div className="advanced-operations-expanded">
              <span className="pill">
                Updated <RelativeTime date={item.updatedAt} />
              </span>
              {renderAsyncIssueAction(item)}
              {item.remediation ? <span className="pill">{item.remediation.permission.replace("_", " ")} access</span> : null}
              {item.remediation ? <span className="pill">{item.remediation.note}</span> : null}
            </div>
          </div>
        ))}

        <div className="list-item vertical">
          <div className="operator-product-row-heading">
            <div>
              <strong>Connector health</strong>
              <p>
                {operations.connectorHealth.issueCount > 0
                  ? "Connector credentials are degraded and need repair before automation can be trusted."
                  : operations.connectorHealth.totalCount > 0
                    ? "Connected providers are healthy in the current dashboard scope."
                    : "No provider credentials are configured in the current dashboard scope."}
              </p>
            </div>
            <span className="pill">{describeStatus(operations.connectorHealth.status)}</span>
          </div>
          <div className="advanced-operations-summary">
            <span className="pill">Visible {operations.connectorHealth.totalCount}</span>
            <span className="pill">Connected {operations.connectorHealth.connectedCount}</span>
            <span className="pill">Reconnect {operations.connectorHealth.reconnectRequiredCount}</span>
            <span className="pill">Refresh failed {operations.connectorHealth.refreshFailedCount}</span>
            <span className="pill">Validation stale {operations.connectorHealth.validationStaleCount}</span>
          </div>
        </div>

        {operations.connectorHealth.items.map((item) => (
          <div
            className={`list-item vertical ${highlightedItemId === item.id ? "selection-highlight" : ""}`}
            id={getItemAnchorId(item.id)}
            key={item.id}
          >
            <div className="operator-product-row-heading">
              <div>
                <strong>{item.label}</strong>
                <p>{item.summary}</p>
              </div>
              <div className="goal-item-actions">
                <span className="pill">{item.severity}</span>
                <span className="pill">{item.status.replaceAll("_", " ")}</span>
              </div>
            </div>
            <div className="advanced-operations-expanded">
              <span className="pill">
                Updated <RelativeTime date={item.updatedAt} />
              </span>
              {item.expectedReadinessLabel ? <span className="pill">Target {item.expectedReadinessLabel}</span> : null}
              {item.meetingReadinessTarget === false ? <span className="pill">Below target</span> : null}
              {describeExpectedModes(item.expectedSupportedModes) ? (
                <span className="pill">Expected {describeExpectedModes(item.expectedSupportedModes)}</span>
              ) : null}
              {describeLinkedIntegrations(item.linkedIntegrationNames) ? (
                <span className="pill">{describeLinkedIntegrations(item.linkedIntegrationNames)}</span>
              ) : null}
              <button
                type="button"
                className="secondary-button"
                onClick={() => navigateToSection(item.target.section, item.target.itemId)}
              >
                {item.target.label}
              </button>
            </div>
          </div>
        ))}
      </div>
    </article>
  );
}
