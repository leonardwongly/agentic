import {
  defaultWorkspaceShadowReplayPolicy,
  enterpriseWorkspaceGovernanceDefaults,
  type WorkspaceGovernance
} from "@agentic/contracts";

export type WorkspaceGovernanceDraft = Omit<WorkspaceGovernance, "workspaceId" | "updatedBy" | "createdAt" | "updatedAt">;

function resolveClientGovernanceDefaults(): WorkspaceGovernanceDraft {
  const profile =
    process.env.NEXT_PUBLIC_AGENTIC_GOVERNANCE_DEFAULT_PROFILE ?? process.env.AGENTIC_GOVERNANCE_DEFAULT_PROFILE;
  if (profile?.trim().toLowerCase() !== "demo") {
    return enterpriseWorkspaceGovernanceDefaults;
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

export function buildWorkspaceGovernanceDraft(governance: WorkspaceGovernance | null): WorkspaceGovernanceDraft {
  const defaults = resolveClientGovernanceDefaults();
  return {
    approvalMode: governance?.approvalMode ?? defaults.approvalMode,
    requireAuditExports: governance?.requireAuditExports ?? defaults.requireAuditExports,
    maxAutoRunRiskClass: governance?.maxAutoRunRiskClass ?? defaults.maxAutoRunRiskClass,
    publicSharingEnabled: governance?.publicSharingEnabled ?? defaults.publicSharingEnabled,
    providerAccessRequiresApproval:
      governance?.providerAccessRequiresApproval ?? defaults.providerAccessRequiresApproval,
    escalationRequiresApproval: governance?.escalationRequiresApproval ?? defaults.escalationRequiresApproval,
    externalSendRequiresApproval:
      governance?.externalSendRequiresApproval ?? defaults.externalSendRequiresApproval,
    calendarWriteRequiresApproval:
      governance?.calendarWriteRequiresApproval ?? defaults.calendarWriteRequiresApproval,
    shadowReplayPolicy: {
      enabled: governance?.shadowReplayPolicy?.enabled ?? defaults.shadowReplayPolicy.enabled,
      promotionMode:
        governance?.shadowReplayPolicy?.promotionMode ?? defaults.shadowReplayPolicy.promotionMode,
      rollbackOutcome:
        governance?.shadowReplayPolicy?.rollbackOutcome ?? defaults.shadowReplayPolicy.rollbackOutcome,
      minimumMatchedEpisodes:
        governance?.shadowReplayPolicy?.minimumMatchedEpisodes ?? defaults.shadowReplayPolicy.minimumMatchedEpisodes,
      minimumPrecision:
        governance?.shadowReplayPolicy?.minimumPrecision ?? defaults.shadowReplayPolicy.minimumPrecision,
      maximumNegativeOutcomeRate:
        governance?.shadowReplayPolicy?.maximumNegativeOutcomeRate ?? defaults.shadowReplayPolicy.maximumNegativeOutcomeRate,
      maximumFailureCostRate:
        governance?.shadowReplayPolicy?.maximumFailureCostRate ?? defaults.shadowReplayPolicy.maximumFailureCostRate
    },
    retentionDays: governance?.retentionDays ?? defaults.retentionDays
  };
}
