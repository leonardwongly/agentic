import {
  PolicyDecisionSchema,
  type AgentMetrics,
  type Capability,
  type MemoryRecord,
  type PolicyDecision,
  type RiskClass,
  type WorkspaceGovernance
} from "@agentic/contracts";
import { getMemoryFreshness } from "@agentic/memory";

const riskClassOrder: Record<RiskClass, number> = {
  R1: 1,
  R2: 2,
  R3: 3,
  R4: 4
};

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

type ScorecardTrustSignal = {
  strong: boolean;
  weak: boolean;
  rationale?: string;
};

export function computeTrustFromMemories(memories: MemoryRecord[], taskTitle: string, capabilities: Capability[]): TrustSignal {
  let approvedCount = 0;
  let rejectedCount = 0;

  const capabilityTerms = capabilities.map((c) => c.toLowerCase());
  const titleTerms = taskTitle.toLowerCase().split(/\s+/);

  for (const memory of memories) {
    if (memory.source !== "auto-capture") continue;
    if (memory.category !== "preferences") continue;
    if (getMemoryFreshness(memory) !== "fresh") continue;

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

export function computeTrustFromScorecard(metrics: AgentMetrics | null | undefined): ScorecardTrustSignal {
  if (!metrics) {
    return { strong: false, weak: false };
  }

  if (metrics.tasksTotal < 3) {
    return { strong: false, weak: false };
  }

  const successRate = metrics.successRate;
  const approvalRate = metrics.approvalRate;
  const failureRate = metrics.tasksTotal > 0 ? metrics.tasksFailed / metrics.tasksTotal : 0;
  const correctionRate = metrics.correctionRate;
  const postApprovalFailureRate = metrics.postApprovalFailureRate;

  if (
    successRate >= 0.9 &&
    approvalRate >= 0.8 &&
    failureRate <= 0.1 &&
    correctionRate <= 0.1 &&
    postApprovalFailureRate <= 0.1 &&
    metrics.errorCount <= 1
  ) {
    return {
      strong: true,
      weak: false,
      rationale: `Agent scorecard is strong (${metrics.tasksCompleted}/${metrics.tasksTotal} successful tasks, approval rate ${approvalRate.toFixed(2)}, correction rate ${correctionRate.toFixed(2)}).`
    };
  }

  if (
    successRate < 0.5 ||
    approvalRate < 0.5 ||
    failureRate >= 0.3 ||
    correctionRate >= 0.25 ||
    postApprovalFailureRate >= 0.2 ||
    metrics.errorCount >= 3
  ) {
    const weakReasons: string[] = [];

    if (metrics.tasksFailed > 0) {
      weakReasons.push(`${metrics.tasksFailed} failed task${metrics.tasksFailed === 1 ? "" : "s"}`);
    }

    if (metrics.userCorrectionCount > 0) {
      weakReasons.push(`${metrics.userCorrectionCount} user correction${metrics.userCorrectionCount === 1 ? "" : "s"}`);
    }

    if (metrics.postApprovalFailureCount > 0) {
      weakReasons.push(
        `${metrics.postApprovalFailureCount} post-approval failure${metrics.postApprovalFailureCount === 1 ? "" : "s"}`
      );
    }

    return {
      strong: false,
      weak: true,
      rationale: `Agent scorecard is weak (${weakReasons.join(", ") || "insufficient recent signal"}, approval rate ${approvalRate.toFixed(2)}, correction rate ${correctionRate.toFixed(2)}).`
    };
  }

  return { strong: false, weak: false };
}

function riskExceedsLimit(riskClass: RiskClass, maxAutoRunRiskClass: RiskClass): boolean {
  return riskClassOrder[riskClass] > riskClassOrder[maxAutoRunRiskClass];
}

export function getGovernanceApprovalReason(params: {
  capabilities: Capability[];
  riskClass: RiskClass;
  governance?: WorkspaceGovernance | null;
}): string | null {
  const { capabilities, riskClass, governance } = params;

  if (!governance) {
    return null;
  }

  if (governance.approvalMode === "always_review") {
    return "Workspace governance is configured for always-review mode.";
  }

  if (governance.externalSendRequiresApproval && capabilities.includes("send")) {
    return "Workspace governance requires approval before external sends.";
  }

  if (governance.calendarWriteRequiresApproval && capabilities.includes("schedule")) {
    return "Workspace governance requires approval before calendar writes.";
  }

  if (riskExceedsLimit(riskClass, governance.maxAutoRunRiskClass)) {
    return `Workspace governance limits autonomous execution to ${governance.maxAutoRunRiskClass}; this task is ${riskClass}.`;
  }

  return null;
}

export function evaluateTaskPolicy(params: {
  capabilities: Capability[];
  confidence: number;
  title: string;
  memories?: MemoryRecord[];
  scorecard?: AgentMetrics | null;
  governance?: WorkspaceGovernance | null;
}): PolicyDecision {
  const riskClass = riskFromCapabilities(params.capabilities);
  const trust = params.memories
    ? computeTrustFromMemories(params.memories, params.title, params.capabilities)
    : { approvedCount: 0, rejectedCount: 0, trustScore: 0 };
  const scorecardTrust = computeTrustFromScorecard(params.scorecard);

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

  const governanceApprovalReason = getGovernanceApprovalReason({
    capabilities: params.capabilities,
    riskClass,
    governance: params.governance
  });

  if (governanceApprovalReason) {
    return PolicyDecisionSchema.parse({
      riskClass,
      outcome: "allowed_with_confirmation",
      rationale: `The task "${params.title}" requires approval. ${governanceApprovalReason}`,
      confidence: params.confidence,
      requiresApproval: true
    });
  }

  if (riskClass === "R3") {
    // Scorecards only strengthen autonomy when memory trust is already strong.
    if (trust.trustScore >= 0.7 && trust.approvedCount >= 3 && scorecardTrust.strong) {
      return PolicyDecisionSchema.parse({
        riskClass,
        outcome: "allowed",
        rationale: `The task "${params.title}" would normally require approval, but learned trust (${trust.approvedCount} prior approvals, trust score ${trust.trustScore.toFixed(2)}) and a strong execution scorecard allow autonomous execution.`,
        confidence: params.confidence,
        requiresApproval: false
      });
    }

    if (scorecardTrust.weak) {
      return PolicyDecisionSchema.parse({
        riskClass,
        outcome: "allowed_with_confirmation",
        rationale: `The task "${params.title}" creates an external commitment and requires user approval. ${scorecardTrust.rationale ?? "Prior execution history is not yet strong enough for autonomy."}`,
        confidence: params.confidence,
        requiresApproval: true
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
      rationale: `The task "${params.title}" creates an external commitment and requires user approval.${scorecardTrust.rationale ? ` ${scorecardTrust.rationale}` : ""}`,
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
