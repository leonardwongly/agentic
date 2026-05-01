"use client";

type DashboardAdvancedOperationsCardProps = {
  activeWorkspaceName: string | null;
  readyIntegrations: number;
  totalIntegrations: number;
  watcherCount: number;
  autopilotMode: string;
  watchersReadiness: string;
  watchersReason: string;
  autopilotReadiness: string;
  autopilotReason: string;
  coreOperationalCount: number;
  coreTotalCount: number;
  advancedOperationalCount: number;
  advancedTotalCount: number;
  trackedContractCount: number;
  expanded: boolean;
  onToggle: () => void;
};

export function DashboardAdvancedOperationsCard(props: DashboardAdvancedOperationsCardProps) {
  const {
    activeWorkspaceName,
    readyIntegrations,
    totalIntegrations,
    watcherCount,
    autopilotMode,
    watchersReadiness,
    watchersReason,
    autopilotReadiness,
    autopilotReason,
    coreOperationalCount,
    coreTotalCount,
    advancedOperationalCount,
    advancedTotalCount,
    trackedContractCount,
    expanded,
    onToggle
  } = props;
  const watcherReadinessLabel = watchersReadiness.replace(/_/gu, " ");
  const autopilotReadinessLabel = autopilotReadiness.replace(/_/gu, " ");

  return (
    <article className="card advanced-operations-card" id="section-advanced-operations">
      <div className="card-header">
        <div>
          <h2>Advanced operations</h2>
          <p className="operator-product-subtitle">
            Workspace setup, governance, autopilot, connectors, notes, watchers, templates, and custom agents stay behind
            an explicit boundary so the default screen stays centered on commitments, approvals, and recent changes.
          </p>
        </div>
        <span>{expanded ? "Expanded" : "Hidden by default"}</span>
      </div>
      <div className="advanced-operations-summary" aria-label="Advanced operations summary">
        <span className="pill">{activeWorkspaceName ? `Workspace: ${activeWorkspaceName}` : "No workspace selected"}</span>
        <span className="pill">
          Integrations: {readyIntegrations}/{totalIntegrations} ready
        </span>
        <span className="pill">
          Core loop: {coreOperationalCount}/{coreTotalCount} operational+
        </span>
        <span className="pill">
          Advanced lane: {advancedOperationalCount}/{advancedTotalCount} operational+
        </span>
        <span className="pill">
          {watcherCount} watcher{watcherCount === 1 ? "" : "s"}
        </span>
        <span className="pill">Watchers: {watcherReadinessLabel}</span>
        <span className="pill">Autopilot: {autopilotMode.replace(/_/gu, " ")}</span>
        <span className="pill">Autopilot surface: {autopilotReadinessLabel}</span>
      </div>
      <p className="empty-state advanced-operations-copy">
        Open this area when you need to change how the system runs, not when you just need to run the queue. The
        feature registry tracks {trackedContractCount} route contracts so advanced surfaces do not drift away from
        their backing APIs.
      </p>
      <div className="advanced-operations-expanded">
        <span className="pill">Watcher readiness: {watcherReadinessLabel}</span>
        <span className="pill">{watchersReason}</span>
        <span className="pill">Autopilot readiness: {autopilotReadinessLabel}</span>
        <span className="pill">{autopilotReason}</span>
      </div>
      {expanded ? (
        <div className="advanced-operations-expanded">
          <p className="status-chip success">
            Advanced surfaces are visible. Deep links and command navigation now land directly inside the expanded admin lane.
          </p>
          <button type="button" className="secondary-button" onClick={onToggle}>
            Hide advanced operations
          </button>
        </div>
      ) : (
        <div className="advanced-operations-expanded">
          <button type="button" className="secondary-button" onClick={onToggle}>
            Show advanced operations
          </button>
        </div>
      )}
    </article>
  );
}
