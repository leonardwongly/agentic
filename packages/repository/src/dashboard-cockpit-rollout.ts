export type DashboardCockpitVariant = "legacy" | "redesigned";

export type DashboardCockpitRollout = {
  enabled: boolean;
  variant: DashboardCockpitVariant;
  flagName: "AGENTIC_DASHBOARD_COCKPIT";
  source: "default" | "env" | "invalid";
  rawValue: string | null;
  runbookPath: string;
  thresholds: {
    firstMeaningfulRenderMs: number;
    summaryLatencyMs: number;
    tableEndpointLatencyMs: number;
    eventReconnects: number;
    approvalLatencyMs: number;
    deadLetterRecoveryMs: number;
  };
};

const ENABLED_VALUES = new Set(["1", "true", "enabled", "on", "redesigned"]);
const DISABLED_VALUES = new Set(["0", "false", "disabled", "off", "legacy", ""]);

type DashboardCockpitRolloutEnv = {
  AGENTIC_DASHBOARD_COCKPIT?: string;
  NEXT_PUBLIC_AGENTIC_DASHBOARD_COCKPIT?: string;
};

export function resolveDashboardCockpitRollout(
  env: DashboardCockpitRolloutEnv = {
    AGENTIC_DASHBOARD_COCKPIT: process.env.AGENTIC_DASHBOARD_COCKPIT,
    NEXT_PUBLIC_AGENTIC_DASHBOARD_COCKPIT: process.env.NEXT_PUBLIC_AGENTIC_DASHBOARD_COCKPIT
  }
): DashboardCockpitRollout {
  const rawValue = env.AGENTIC_DASHBOARD_COCKPIT ?? env.NEXT_PUBLIC_AGENTIC_DASHBOARD_COCKPIT ?? null;
  const normalized = rawValue?.trim().toLowerCase() ?? null;
  const source: DashboardCockpitRollout["source"] =
    normalized === null ? "default" : ENABLED_VALUES.has(normalized) || DISABLED_VALUES.has(normalized) ? "env" : "invalid";
  const enabled = normalized !== null && ENABLED_VALUES.has(normalized);

  return {
    enabled,
    variant: enabled ? "redesigned" : "legacy",
    flagName: "AGENTIC_DASHBOARD_COCKPIT",
    source,
    rawValue,
    runbookPath: "docs/runbooks/dashboard-cockpit-rollout.md",
    thresholds: {
      firstMeaningfulRenderMs: 2500,
      summaryLatencyMs: 1000,
      tableEndpointLatencyMs: 750,
      eventReconnects: 2,
      approvalLatencyMs: 600000,
      deadLetterRecoveryMs: 900000
    }
  };
}
