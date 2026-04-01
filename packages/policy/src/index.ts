import { PolicyDecisionSchema, type Capability, type PolicyDecision, type RiskClass } from "@agentic/contracts";

export function riskFromCapabilities(capabilities: Capability[]): RiskClass {
  if (capabilities.includes("delete") || capabilities.includes("approve")) {
    return "R4";
  }

  if (capabilities.includes("send") || capabilities.includes("schedule")) {
    return "R3";
  }

  if (capabilities.includes("create") || capabilities.includes("update") || capabilities.includes("draft") || capabilities.includes("monitor")) {
    return "R2";
  }

  return "R1";
}

export function evaluateTaskPolicy(params: {
  capabilities: Capability[];
  confidence: number;
  title: string;
}): PolicyDecision {
  const riskClass = riskFromCapabilities(params.capabilities);

  if (params.confidence < 0.55) {
    return PolicyDecisionSchema.parse({
      riskClass,
      outcome: "downgrade_to_draft",
      rationale: `Confidence is below the autonomous threshold for "${params.title}".`,
      confidence: params.confidence,
      requiresApproval: false
    });
  }

  if (riskClass === "R4") {
    return PolicyDecisionSchema.parse({
      riskClass,
      outcome: "blocked",
      rationale: `The task "${params.title}" includes an irreversible or highly sensitive action.`,
      confidence: params.confidence,
      requiresApproval: true
    });
  }

  if (riskClass === "R3") {
    return PolicyDecisionSchema.parse({
      riskClass,
      outcome: "allowed_with_confirmation",
      rationale: `The task "${params.title}" creates an external commitment and requires user approval.`,
      confidence: params.confidence,
      requiresApproval: true
    });
  }

  return PolicyDecisionSchema.parse({
    riskClass,
    outcome: "allowed",
    rationale: `The task "${params.title}" stays within the low-risk automation policy.`,
    confidence: params.confidence,
    requiresApproval: false
  });
}

