import type { ApprovalRequest, IntegrationAccount, WorkspaceGovernance } from "@agentic/contracts";
import { describeIntegrationReadiness, type IntegrationReadinessTier } from "@agentic/integrations/client";

export type NLCommandCapabilityStatus = "ready" | "limited" | "unavailable";

export type NLCommandCapability = {
  id:
    | "query-approvals"
    | "query-goals"
    | "query-agents"
    | "query-memories"
    | "summary-catch-up"
    | "create-goal"
    | "briefing"
    | "approve-all-r2";
  label: string;
  example: string;
  status: NLCommandCapabilityStatus;
  reason: string;
};

export type NLIntegrationCapability = {
  system: string;
  label: string;
  connectionStatus: IntegrationAccount["status"] | "missing";
  readinessTier: IntegrationReadinessTier;
  readinessLabel: string;
  reason: string;
};

export type NLIntentCapabilitySummary = {
  headline: string;
  commands: NLCommandCapability[];
  integrations: NLIntegrationCapability[];
  unsupportedNote: string;
};

type BuildNlCapabilitySummaryParams = {
  activeWorkspaceName?: string | null;
  approvals: ApprovalRequest[];
  integrations: IntegrationAccount[];
  workspaceGovernance: WorkspaceGovernance | null;
};

function isLiveExecutionTier(tier: IntegrationReadinessTier): boolean {
  return tier === "approval-grade" || tier === "autonomous-grade";
}

function describeIntegrationState(account: IntegrationAccount | null, label: string): NLIntegrationCapability {
  if (!account) {
    return {
      system: label.toLowerCase(),
      label,
      connectionStatus: "missing",
      readinessTier: "experimental",
      readinessLabel: "Not connected",
      reason: `${label} is not connected for this user, so it remains outside the governed execution path.`
    };
  }

  const readiness = describeIntegrationReadiness(account);

  return {
    system: account.system,
    label,
    connectionStatus: account.status,
    readinessTier: readiness.tier,
    readinessLabel: readiness.label,
    reason: readiness.reason
  };
}

export function buildNlCapabilitySummary(params: BuildNlCapabilitySummaryParams): NLIntentCapabilitySummary {
  const workspaceLabel = params.activeWorkspaceName ? ` for ${params.activeWorkspaceName}` : "";
  const integrationBySystem = new Map(params.integrations.map((integration) => [integration.system, integration]));
  const emailIntegration = describeIntegrationState(integrationBySystem.get("email") ?? null, "Email");
  const calendarIntegration = describeIntegrationState(integrationBySystem.get("calendar") ?? null, "Calendar");
  const notesIntegration = describeIntegrationState(integrationBySystem.get("notes") ?? null, "Notes");
  const hasLiveBriefingConnector = [emailIntegration, calendarIntegration].some((integration) =>
    isLiveExecutionTier(integration.readinessTier)
  );
  const pendingR2Approvals = params.approvals.filter(
    (approval) => approval.decision === "pending" && approval.riskClass === "R2"
  ).length;
  const approvalModeLabel = params.workspaceGovernance
    ? ` Governance mode is ${params.workspaceGovernance.approvalMode.replaceAll("_", " ")}.`
    : "";

  const commands: NLCommandCapability[] = [
    {
      id: "query-approvals",
      label: "Query approvals",
      example: "show approvals",
      status: "ready",
      reason: "Lists approvals already stored in the control plane."
    },
    {
      id: "query-goals",
      label: "Query goals",
      example: "show running goals",
      status: "ready",
      reason: "Lists scoped goal bundles from the dashboard read model."
    },
    {
      id: "query-agents",
      label: "Query agents",
      example: "show agents",
      status: "ready",
      reason: "Lists the current agent catalog for the signed-in user."
    },
    {
      id: "query-memories",
      label: "Query memories",
      example: "show memories",
      status: "ready",
      reason: "Reads memory records already persisted for this user."
    },
    {
      id: "summary-catch-up",
      label: "Catch-up summary",
      example: "what happened while I was away",
      status: "ready",
      reason: "Summaries are computed from the server-side dashboard state."
    },
    {
      id: "create-goal",
      label: "Create goal",
      example: "create goal to draft a Q2 operating plan",
      status: "ready",
      reason: "Creates a new goal bundle through the orchestrator."
    },
    {
      id: "briefing",
      label: "Generate briefing",
      example: "daily brief",
      status: hasLiveBriefingConnector ? "ready" : "limited",
      reason:
        hasLiveBriefingConnector
          ? "Briefings can pull from live email or calendar connectors."
          : "Briefings still work, but without live email or calendar data they rely on local memory, approvals, and watcher state."
    },
    {
      id: "approve-all-r2",
      label: "Batch approve R2",
      example: "approve all R2",
      status: pendingR2Approvals > 0 ? "ready" : "limited",
      reason:
        pendingR2Approvals > 0
          ? `${pendingR2Approvals} pending R2 approval${pendingR2Approvals === 1 ? "" : "s"} can be approved in one bounded batch.`
          : "Batch approval is only available when there are pending R2 approvals."
    }
  ];

  const integrations = [emailIntegration, calendarIntegration, notesIntegration];

  return {
    headline: `The NL bar is limited to bounded control commands${workspaceLabel}.${approvalModeLabel}`.trim(),
    commands,
    integrations,
    unsupportedNote: "Reject decisions and one-off approval decisions stay in the approvals queue until those flows are explicitly hardened."
  };
}
