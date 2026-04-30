import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import {
  WorkspaceGovernanceSchema,
  enterpriseWorkspaceGovernanceDefaults,
  defaultWorkspaceShadowReplayPolicy
} from "@agentic/contracts";
import { assessWorkspaceGovernanceConformance, evaluateTaskPolicy } from "@agentic/policy";

describe("enterprise governance defaults", () => {
  it("parses legacy governance records into the enterprise-safe default-deny posture", () => {
    const governance = WorkspaceGovernanceSchema.parse({
      workspaceId: "workspace-legacy",
      updatedBy: "user-1",
      createdAt: "2026-04-29T00:00:00.000Z",
      updatedAt: "2026-04-29T00:00:00.000Z"
    });

    expect(governance).toMatchObject({
      approvalMode: "always_review",
      requireAuditExports: true,
      maxAutoRunRiskClass: "R1",
      publicSharingEnabled: false,
      providerAccessRequiresApproval: true,
      escalationRequiresApproval: true,
      externalSendRequiresApproval: true,
      calendarWriteRequiresApproval: true,
      retentionDays: 90,
      shadowReplayPolicy: defaultWorkspaceShadowReplayPolicy
    });
    expect(assessWorkspaceGovernanceConformance(governance)).toMatchObject({
      status: "conformant"
    });
  });

  it("keeps external sends and calendar writes approval-gated under defaults", () => {
    const governance = WorkspaceGovernanceSchema.parse({
      workspaceId: "workspace-default",
      ...enterpriseWorkspaceGovernanceDefaults,
      updatedBy: "user-1",
      createdAt: "2026-04-29T00:00:00.000Z",
      updatedAt: "2026-04-29T00:00:00.000Z"
    });

    expect(
      evaluateTaskPolicy({
        title: "Send the account follow-up",
        capabilities: ["send"],
        confidence: 0.98,
        governance
      })
    ).toMatchObject({
      outcome: "allowed_with_confirmation",
      requiresApproval: true
    });
    expect(
      evaluateTaskPolicy({
        title: "Schedule the customer review",
        capabilities: ["schedule"],
        confidence: 0.98,
        governance
      })
    ).toMatchObject({
      outcome: "allowed_with_confirmation",
      requiresApproval: true
    });
  });

  it("keeps the operator classification registry aligned with code defaults", async () => {
    const raw = await readFile("config/governance/defaults.json", "utf8");
    const registry = JSON.parse(raw) as {
      classification: Array<{ key: string; default: unknown }>;
    };
    const defaultsByKey = new Map(registry.classification.map((entry) => [entry.key, entry.default]));

    expect(defaultsByKey.get("approvalMode")).toBe(enterpriseWorkspaceGovernanceDefaults.approvalMode);
    expect(defaultsByKey.get("maxAutoRunRiskClass")).toBe(enterpriseWorkspaceGovernanceDefaults.maxAutoRunRiskClass);
    expect(defaultsByKey.get("publicSharingEnabled")).toBe(enterpriseWorkspaceGovernanceDefaults.publicSharingEnabled);
    expect(defaultsByKey.get("requireAuditExports")).toBe(enterpriseWorkspaceGovernanceDefaults.requireAuditExports);
    expect(defaultsByKey.get("providerAccessRequiresApproval")).toBe(
      enterpriseWorkspaceGovernanceDefaults.providerAccessRequiresApproval
    );
    expect(defaultsByKey.get("escalationRequiresApproval")).toBe(enterpriseWorkspaceGovernanceDefaults.escalationRequiresApproval);
    expect(defaultsByKey.get("externalSendRequiresApproval")).toBe(
      enterpriseWorkspaceGovernanceDefaults.externalSendRequiresApproval
    );
    expect(defaultsByKey.get("calendarWriteRequiresApproval")).toBe(
      enterpriseWorkspaceGovernanceDefaults.calendarWriteRequiresApproval
    );
    expect(defaultsByKey.get("retentionDays")).toBe(enterpriseWorkspaceGovernanceDefaults.retentionDays);
    expect(defaultsByKey.get("shadowReplayPolicy.promotionMode")).toBe(
      enterpriseWorkspaceGovernanceDefaults.shadowReplayPolicy.promotionMode
    );
    expect(defaultsByKey.get("shadowReplayPolicy.rollbackOutcome")).toBe(
      enterpriseWorkspaceGovernanceDefaults.shadowReplayPolicy.rollbackOutcome
    );
  });
});
