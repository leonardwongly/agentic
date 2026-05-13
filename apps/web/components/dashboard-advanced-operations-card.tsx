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
  selectedOperatorProductName: string | null;
  templateCount: number;
  expanded: boolean;
  onToggle: () => void;
  onOpenSection: (section: "operator-products" | "integrations" | "templates" | "watchers") => void;
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
    selectedOperatorProductName,
    templateCount,
    expanded,
    onToggle,
    onOpenSection
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
      <div className="advanced-operations-setup" aria-label="First-run setup checklist">
        <div>
          <strong>First-run setup</strong>
          <p className="operator-product-subtitle">
            Start with the role pack, verify integrations, then create or run repeatable templates when the core loop is working.
          </p>
        </div>
        <div className="advanced-operations-summary">
          <button type="button" className="secondary-button" onClick={() => onOpenSection("operator-products")}>
            {selectedOperatorProductName ? `Role pack: ${selectedOperatorProductName}` : "Choose role pack"}
          </button>
          <button type="button" className="secondary-button" onClick={() => onOpenSection("integrations")}>
            Review integrations
          </button>
          <button type="button" className="secondary-button" onClick={() => onOpenSection("templates")}>
            {templateCount > 0 ? `Templates: ${templateCount}` : "Load templates"}
          </button>
          <button type="button" className="secondary-button" onClick={() => onOpenSection("watchers")}>
            Review watchers
          </button>
        </div>
      </div>
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
