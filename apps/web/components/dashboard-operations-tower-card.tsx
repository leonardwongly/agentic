"use client";

import type { DashboardData } from "@agentic/repository";
import { RelativeTime } from "./ui";

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

export function DashboardOperationsTowerCard(props: DashboardOperationsTowerCardProps) {
  const { operations, expanded, highlightedItemId, getItemAnchorId, navigateToSection } = props;

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
        <span className="pill">Async: {describeStatus(operations.asyncExecution.status)}</span>
        <span className="pill">Queue issues: {operations.asyncExecution.issueCount}</span>
        <span className="pill">Connectors degraded: {operations.connectorHealth.issueCount}</span>
        <span className="pill">Retrying: {operations.asyncExecution.retryingJobs}</span>
        <span className="pill">Dead letters: {operations.asyncExecution.deadLetterJobs}</span>
      </div>

      <div className="list-stack compact">
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
              {item.target ? (
                <button
                  type="button"
                  className="secondary-button"
                  onClick={() => navigateToSection(item.target!.section, item.target!.itemId)}
                >
                  {item.target.label}
                </button>
              ) : null}
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
