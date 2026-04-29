import {
  defaultWorkspaceShadowReplayPolicy,
  enterpriseWorkspaceGovernanceDefaults,
  type WorkspaceGovernance
} from "@agentic/contracts";

type WorkspaceGovernanceDefaults = Pick<
  WorkspaceGovernance,
  | "approvalMode"
  | "requireAuditExports"
  | "maxAutoRunRiskClass"
  | "publicSharingEnabled"
  | "providerAccessRequiresApproval"
  | "escalationRequiresApproval"
  | "externalSendRequiresApproval"
  | "calendarWriteRequiresApproval"
  | "shadowReplayPolicy"
  | "retentionDays"
>;

function readBooleanEnv(name: string): boolean | null {
  const raw = process.env[name]?.trim().toLowerCase();

  if (raw === undefined || raw === "") {
    return null;
  }

  if (["1", "true", "yes", "on"].includes(raw)) {
    return true;
  }

  if (["0", "false", "no", "off"].includes(raw)) {
    return false;
  }

  throw new Error(`${name} must be a boolean value.`);
}

export function resolveWorkspaceGovernanceDefaultsFromEnv(): WorkspaceGovernanceDefaults {
  const profile = process.env.AGENTIC_GOVERNANCE_DEFAULT_PROFILE?.trim().toLowerCase() || "enterprise";

  if (profile === "enterprise") {
    return enterpriseWorkspaceGovernanceDefaults;
  }

  if (profile !== "demo") {
    throw new Error("AGENTIC_GOVERNANCE_DEFAULT_PROFILE must be either enterprise or demo.");
  }

  return {
    approvalMode: "risk_based",
    requireAuditExports: true,
    maxAutoRunRiskClass: "R1",
    publicSharingEnabled: true,
    providerAccessRequiresApproval: true,
    escalationRequiresApproval: true,
    externalSendRequiresApproval: true,
    calendarWriteRequiresApproval: true,
    shadowReplayPolicy: defaultWorkspaceShadowReplayPolicy,
    retentionDays: 365
  };
}

export function assertWorkspaceGovernanceStartupConfig(): void {
  const defaults = resolveWorkspaceGovernanceDefaultsFromEnv();

  if (process.env.NODE_ENV === "production" && process.env.AGENTIC_GOVERNANCE_DEFAULT_PROFILE?.trim().toLowerCase() === "demo") {
    const allowDemoGovernanceDefaults = readBooleanEnv("AGENTIC_ALLOW_DEMO_GOVERNANCE_DEFAULTS") ?? false;

    if (!allowDemoGovernanceDefaults) {
      throw new Error(
        "AGENTIC_GOVERNANCE_DEFAULT_PROFILE=demo is not allowed in production unless AGENTIC_ALLOW_DEMO_GOVERNANCE_DEFAULTS=true is set."
      );
    }
  }

  if (defaults.publicSharingEnabled && !defaults.requireAuditExports) {
    throw new Error("Governance defaults cannot enable public sharing while audit exports are disabled.");
  }

  if (
    defaults.approvalMode === "risk_based" &&
    defaults.maxAutoRunRiskClass === "R3" &&
    !defaults.shadowReplayPolicy.enabled
  ) {
    throw new Error("Governance defaults cannot allow R3 autonomy while shadow replay is disabled.");
  }
}
