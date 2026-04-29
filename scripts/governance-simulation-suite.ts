import { WorkspaceGovernanceSchema, enterpriseWorkspaceGovernanceDefaults } from "@agentic/contracts";
import { buildContinuousGovernanceSimulationReport } from "@agentic/policy";

async function main() {
  const timestamp = new Date("2026-04-29T00:00:00.000Z").toISOString();
  const governance = WorkspaceGovernanceSchema.parse({
    workspaceId: "ci-governance-simulation",
    ...enterpriseWorkspaceGovernanceDefaults,
    approvalMode: "risk_based",
    maxAutoRunRiskClass: "R2",
    externalSendRequiresApproval: true,
    calendarWriteRequiresApproval: true,
    updatedBy: "ci",
    createdAt: timestamp,
    updatedAt: timestamp
  });
  const report = buildContinuousGovernanceSimulationReport({
    governance
  });
  const output = {
    status: report.status,
    autonomyExpansionAllowed: report.autonomyExpansionAllowed,
    thresholds: report.thresholds,
    metrics: report.metrics,
    findings: report.findings,
    simulations: report.simulations.map((simulation) => ({
      id: simulation.id,
      expectedDecision: simulation.expectedDecision ?? null,
      outcome: simulation.result.decision.outcome,
      requiresApproval: simulation.result.decision.requiresApproval,
      riskClass: simulation.result.decision.riskClass
    }))
  };

  console.log(JSON.stringify(output, null, 2));

  if (report.status !== "pass") {
    process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : "Governance simulation suite failed.");
  process.exitCode = 1;
});
