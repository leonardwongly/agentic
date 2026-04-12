import type { IntegrationAccount } from "@agentic/contracts";

export const integrationReadinessTierValues = [
  "experimental",
  "draft-grade",
  "approval-grade",
  "autonomous-grade"
] as const;

export type IntegrationReadinessTier = (typeof integrationReadinessTierValues)[number];

export const integrationExecutionModeValues = ["draft", "approval", "autonomous"] as const;
export type IntegrationExecutionMode = (typeof integrationExecutionModeValues)[number];

export type IntegrationReadinessProfile = {
  tier: IntegrationReadinessTier;
  label: string;
  reason: string;
  supportedModes: IntegrationExecutionMode[];
};

const READINESS_LABELS: Record<IntegrationReadinessTier, string> = {
  experimental: "Experimental",
  "draft-grade": "Draft-grade",
  "approval-grade": "Approval-grade",
  "autonomous-grade": "Autonomous-grade"
};

const READINESS_MODES: Record<IntegrationReadinessTier, IntegrationExecutionMode[]> = {
  experimental: [],
  "draft-grade": ["draft"],
  "approval-grade": ["draft", "approval"],
  "autonomous-grade": ["draft", "approval", "autonomous"]
};

function buildReadinessProfile(tier: IntegrationReadinessTier, reason: string): IntegrationReadinessProfile {
  return {
    tier,
    label: READINESS_LABELS[tier],
    reason,
    supportedModes: READINESS_MODES[tier]
  };
}

export function describeIntegrationReadiness(account: IntegrationAccount): IntegrationReadinessProfile {
  switch (account.status) {
    case "disabled":
      return buildReadinessProfile(
        "experimental",
        `${account.name} is disabled, so no governed execution path should rely on it.`
      );
    case "mock":
      return buildReadinessProfile(
        "experimental",
        `${account.name} is backed by a mock adapter and remains unsafe for production execution or autonomy.`
      );
    case "manual":
      return buildReadinessProfile(
        "draft-grade",
        `${account.name} can still support draft and planning flows, but execution depends on manual or local fallback steps.`
      );
    case "ready":
    default: {
      switch (account.system) {
        case "notes":
          return buildReadinessProfile(
            "autonomous-grade",
            `${account.name} is live, deterministic, and suitable for autonomous local knowledge capture inside the governed loop.`
          );
        case "email":
        case "calendar":
          return buildReadinessProfile(
            "approval-grade",
            `${account.name} is live and can support governed execution, but autonomous execution should stay gated until the vertical quality bar is higher.`
          );
        case "messaging":
          return buildReadinessProfile(
            "approval-grade",
            `${account.name} is live for governed notifications and approval surfaces, but broader autonomous messaging remains intentionally constrained.`
          );
        default:
          return buildReadinessProfile(
            "approval-grade",
            `${account.name} is live, but it has not yet earned autonomous-grade guarantees.`
          );
      }
    }
  }
}

export function integrationSupportsExecutionMode(
  account: IntegrationAccount,
  mode: IntegrationExecutionMode
): boolean {
  return describeIntegrationReadiness(account).supportedModes.includes(mode);
}
