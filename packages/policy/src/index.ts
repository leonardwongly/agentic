import { PolicyDecisionSchema, type Capability, type MemoryRecord, type PolicyDecision, type RiskClass } from "@agentic/contracts";

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

type TrustSignal = {
  approvedCount: number;
  rejectedCount: number;
  trustScore: number;
};

export function computeTrustFromMemories(memories: MemoryRecord[], taskTitle: string, capabilities: Capability[]): TrustSignal {
  let approvedCount = 0;
  let rejectedCount = 0;

  const capabilityTerms = capabilities.map((c) => c.toLowerCase());
  const titleTerms = taskTitle.toLowerCase().split(/\s+/);

  for (const memory of memories) {
    if (memory.source !== "auto-capture") continue;
    if (memory.category !== "preferences") continue;

    const content = memory.content.toLowerCase();

    // Check if this memory is relevant to the current task
    const isRelevant =
      capabilityTerms.some((term) => content.includes(term)) ||
      titleTerms.some((term) => term.length > 3 && content.includes(term));

    if (!isRelevant) continue;

    if (content.includes("approved") || content.includes("comfort")) {
      approvedCount++;
    } else if (content.includes("rejected") || content.includes("rejected")) {
      rejectedCount++;
    }
  }

  const total = approvedCount + rejectedCount;
  if (total === 0) return { approvedCount: 0, rejectedCount: 0, trustScore: 0 };

  // Trust score ranges from -1 (all rejected) to +1 (all approved)
  // Weighted by volume: more decisions = stronger signal
  const ratio = (approvedCount - rejectedCount) / total;
  const volumeWeight = Math.min(1, total / 5); // Full weight after 5 decisions
  return { approvedCount, rejectedCount, trustScore: ratio * volumeWeight };
}

export function evaluateTaskPolicy(params: {
  capabilities: Capability[];
  confidence: number;
  title: string;
  memories?: MemoryRecord[];
}): PolicyDecision {
  const riskClass = riskFromCapabilities(params.capabilities);
  const trust = params.memories
    ? computeTrustFromMemories(params.memories, params.title, params.capabilities)
    : { approvedCount: 0, rejectedCount: 0, trustScore: 0 };

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
    // Dynamic trust: if user has consistently approved similar tasks, auto-promote to allowed
    if (trust.trustScore >= 0.7 && trust.approvedCount >= 3) {
      return PolicyDecisionSchema.parse({
        riskClass,
        outcome: "allowed",
        rationale: `The task "${params.title}" would normally require approval, but learned trust (${trust.approvedCount} prior approvals, trust score ${trust.trustScore.toFixed(2)}) allows autonomous execution.`,
        confidence: params.confidence,
        requiresApproval: false
      });
    }

    // If user has rejected similar tasks, add stricter language
    if (trust.rejectedCount > 0 && trust.trustScore < -0.3) {
      return PolicyDecisionSchema.parse({
        riskClass,
        outcome: "allowed_with_confirmation",
        rationale: `The task "${params.title}" creates an external commitment and requires user approval. Note: similar tasks have been rejected ${trust.rejectedCount} time(s) previously.`,
        confidence: params.confidence,
        requiresApproval: true
      });
    }

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
