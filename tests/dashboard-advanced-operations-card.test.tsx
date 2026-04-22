import { renderToStaticMarkup } from "react-dom/server";
import { DashboardAdvancedOperationsCard } from "../apps/web/components/dashboard-advanced-operations-card";
import { resolveFeatureCapabilities, summarizeFeatureCapabilities } from "../apps/web/lib/feature-capabilities";

const resolvedOperationalFeatures = resolveFeatureCapabilities({
  activeWorkspaceName: "Operations",
  watcherCount: 3,
  autopilotMode: "notify_only",
  operations: {
    asyncExecutionStatus: "healthy",
    asyncIssueCount: 0,
    connectorHealthStatus: "healthy",
    connectorIssueCount: 0,
    autonomyPostureStatus: "healthy",
    hasOverridePaths: true
  }
});
const featureSummary = summarizeFeatureCapabilities(resolvedOperationalFeatures);

describe("DashboardAdvancedOperationsCard", () => {
  it("renders a collapsed summary by default", () => {
    const markup = renderToStaticMarkup(
      <DashboardAdvancedOperationsCard
        activeWorkspaceName="Operations"
        readyIntegrations={2}
        totalIntegrations={4}
        watcherCount={3}
        autopilotMode="notify_only"
        watchersReadiness="operational"
        watchersReason="3 active watchers are already feeding the durable automation path. Watchers now run with queue recovery, connector diagnostics, and operator remediation paths."
        autopilotReadiness="operational"
        autopilotReason="Autopilot control is operational in notify only mode with durable execution, replay, and operator recovery tooling."
        coreOperationalCount={featureSummary.core.operationalOrBetter}
        coreTotalCount={featureSummary.core.total}
        advancedOperationalCount={featureSummary.advanced.operationalOrBetter}
        advancedTotalCount={featureSummary.advanced.total}
        trackedContractCount={featureSummary.trackedContracts}
        expanded={false}
        onToggle={() => {}}
      />
    );

    expect(markup).toContain("Advanced operations");
    expect(markup).toContain("Hidden by default");
    expect(markup).toContain("Workspace: Operations");
    expect(markup).toContain("Integrations: 2/4 ready");
    expect(markup).toContain(
      `Core loop: ${featureSummary.core.operationalOrBetter}/${featureSummary.core.total} operational+`
    );
    expect(markup).toContain(
      `Advanced lane: ${featureSummary.advanced.operationalOrBetter}/${featureSummary.advanced.total} operational+`
    );
    expect(markup).toContain("Watchers: operational");
    expect(markup).toContain("Autopilot surface: operational");
    expect(markup).toContain("Watcher readiness: operational");
    expect(markup).toContain("Autopilot readiness: operational");
    expect(markup).toContain("Watchers now run with queue recovery");
    expect(markup).toContain("Autopilot control is operational in notify only mode");
    expect(markup).toContain(`feature registry tracks ${featureSummary.trackedContracts} route contracts`);
    expect(markup).toContain("Show advanced operations");
    expect(markup).not.toContain("Advanced surfaces are visible.");
  });

  it("renders the expanded state copy when advanced surfaces are open", () => {
    const markup = renderToStaticMarkup(
      <DashboardAdvancedOperationsCard
        activeWorkspaceName={null}
        readyIntegrations={0}
        totalIntegrations={3}
        watcherCount={0}
        autopilotMode="auto_run"
        watchersReadiness="preview"
        watchersReason="Operational telemetry is unavailable, so this surface remains fail-closed in preview."
        autopilotReadiness="preview"
        autopilotReason="Operator recovery paths are unavailable, so autopilot control stays preview."
        coreOperationalCount={featureSummary.core.operationalOrBetter}
        coreTotalCount={featureSummary.core.total}
        advancedOperationalCount={featureSummary.advanced.operationalOrBetter}
        advancedTotalCount={featureSummary.advanced.total}
        trackedContractCount={featureSummary.trackedContracts}
        expanded
        onToggle={() => {}}
      />
    );

    expect(markup).toContain("Expanded");
    expect(markup).toContain("No workspace selected");
    expect(markup).toContain("Autopilot: auto run");
    expect(markup).toContain("Watchers: preview");
    expect(markup).toContain("Autopilot surface: preview");
    expect(markup).toContain("Operator recovery paths are unavailable");
    expect(markup).toContain("Advanced surfaces are visible.");
    expect(markup).toContain("Hide advanced operations");
  });
});
