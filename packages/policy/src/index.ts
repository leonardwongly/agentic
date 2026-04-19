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
export {
  buildPrivacyControlSummary,
  loadPrivacyControlRegistry,
  parsePrivacyControlRegistry,
  type PrivacyClassification,
  type PrivacyControlRegistry,
  type PrivacyControlSummary,
  type PrivacyDataset,
  type PrivacyTokenizationStrategy
} from "./privacy-controls";

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

export type GovernanceConformanceCheck = {
  id: string;
  status: "pass" | "warn" | "fail";
  summary: string;
  detail: string;
};

export type GovernanceConformanceReport = {
  status: "conformant" | "needs_attention" | "non_conformant";
  summary: string;
  checks: GovernanceConformanceCheck[];
};

export type PolicySimulationCheck = {
  id: string;
  stage: "input" | "risk" | "governance" | "trust" | "decision";
  status: "pass" | "warn" | "fail" | "info";
  summary: string;
  detail: string;
};

export type PolicySimulationResult = {
  decision: PolicyDecision;
  checks: PolicySimulationCheck[];
  trust: TrustSignal;
  scorecardTrust: ScorecardTrustSignal;
  conformance: GovernanceConformanceReport | null;
};

export type GovernanceSimulationScenario = {
  id: string;
  title: string;
  description: string;
  capabilities: Capability[];
  confidence: number;
};

export type GovernanceSimulationScenarioResult = GovernanceSimulationScenario & {
  result: PolicySimulationResult;
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

function buildDecision(params: {
  riskClass: RiskClass;
  outcome: PolicyDecision["outcome"];
  rationale: string;
  confidence: number;
  requiresApproval: boolean;
}): PolicyDecision {
  return PolicyDecisionSchema.parse(params);
}

function classifyConformanceStatus(checks: GovernanceConformanceCheck[]): GovernanceConformanceReport["status"] {
  if (checks.some((check) => check.status === "fail")) {
    return "non_conformant";
  }

  if (checks.some((check) => check.status === "warn")) {
    return "needs_attention";
  }

  return "conformant";
}

export function assessWorkspaceGovernanceConformance(
  governance: WorkspaceGovernance | null | undefined
): GovernanceConformanceReport | null {
  if (!governance) {
    return null;
  }

  const checks: GovernanceConformanceCheck[] = [
    governance.requireAuditExports
      ? {
          id: "audit-exports",
          status: "pass",
          summary: "Audit exports are enabled.",
          detail: "Workspace governance retains the ability to export evidence and audit data."
        }
      : {
          id: "audit-exports",
          status: "fail",
          summary: "Audit exports are disabled.",
          detail: "Enterprise governance should require audit exports so reviewers can validate approvals and execution history."
        },
    governance.externalSendRequiresApproval
      ? {
          id: "external-send-approval",
          status: "pass",
          summary: "External send actions require approval.",
          detail: "Outbound communication remains gated behind user approval."
        }
      : {
          id: "external-send-approval",
          status: "fail",
          summary: "External send actions can run autonomously.",
          detail: "High-impact external communication should stay approval-gated for enterprise governance."
        },
    governance.calendarWriteRequiresApproval
      ? {
          id: "calendar-write-approval",
          status: "pass",
          summary: "Calendar writes require approval.",
          detail: "Scheduling changes remain reviewable before they create external commitments."
        }
      : {
          id: "calendar-write-approval",
          status: "warn",
          summary: "Calendar writes can run without approval.",
          detail: "Removing approval from scheduling can create external commitments without human review."
        }
  ];

  if (governance.approvalMode === "risk_based") {
    if (governance.maxAutoRunRiskClass === "R1" || governance.maxAutoRunRiskClass === "R2") {
      checks.push({
        id: "risk-ceiling",
        status: "pass",
        summary: `Autonomous execution is capped at ${governance.maxAutoRunRiskClass}.`,
        detail: "The workspace keeps the auto-run ceiling inside a conservative enterprise range."
      });
    } else if (governance.maxAutoRunRiskClass === "R3") {
      checks.push({
        id: "risk-ceiling",
        status: "warn",
        summary: "Autonomous execution is capped at R3.",
        detail: "R3 actions create external commitments and usually deserve tighter default controls."
      });
    } else {
      checks.push({
        id: "risk-ceiling",
        status: "fail",
        summary: "Autonomous execution is capped at R4.",
        detail: "Irreversible or highly sensitive actions should never be inside the workspace auto-run ceiling."
      });
    }
  } else {
    checks.push(
      governance.maxAutoRunRiskClass === "R1"
        ? {
            id: "always-review-ceiling",
            status: "pass",
            summary: "Always-review mode keeps the auto-run ceiling at R1.",
            detail: "The risk ceiling matches the strict review posture."
          }
        : {
            id: "always-review-ceiling",
            status: "warn",
            summary: `Always-review mode keeps a relaxed ${governance.maxAutoRunRiskClass} ceiling.`,
            detail: "The approval mode is strict, but the stored ceiling is looser than necessary and can confuse operators."
          }
    );
  }

  if (governance.retentionDays < 30) {
    checks.push({
      id: "retention-window",
      status: "warn",
      summary: `Retention is set to ${governance.retentionDays} days.`,
      detail: "Very short retention windows can remove audit evidence before investigators or reviewers can use it."
    });
  } else if (governance.retentionDays > 730) {
    checks.push({
      id: "retention-window",
      status: "warn",
      summary: `Retention is set to ${governance.retentionDays} days.`,
      detail: "Long retention windows increase data holding risk and should be justified explicitly."
    });
  } else {
    checks.push({
      id: "retention-window",
      status: "pass",
      summary: `Retention is set to ${governance.retentionDays} days.`,
      detail: "The retention window stays inside a balanced enterprise operating range."
    });
  }

  const status = classifyConformanceStatus(checks);
  return {
    status,
    summary:
      status === "conformant"
        ? "Governance configuration meets the current enterprise conformance checks."
        : status === "needs_attention"
          ? "Governance configuration is usable but has drift that should be corrected."
          : "Governance configuration fails one or more enterprise conformance checks.",
    checks
  };
}

export function buildGovernanceSimulationScenarios(): GovernanceSimulationScenario[] {
  return [
    {
      id: "low-risk-read",
      title: "Read project notes",
      description: "Low-risk information retrieval inside the workspace.",
      capabilities: ["read", "search"],
      confidence: 0.94
    },
    {
      id: "draft-update",
      title: "Draft and update the weekly operating note",
      description: "Normal internal drafting and update work.",
      capabilities: ["create", "update", "draft"],
      confidence: 0.9
    },
    {
      id: "external-send",
      title: "Send an external stakeholder update",
      description: "External commitment with communication risk.",
      capabilities: ["send"],
      confidence: 0.9
    },
    {
      id: "calendar-write",
      title: "Schedule an executive review meeting",
      description: "Calendar write that creates an external commitment.",
      capabilities: ["schedule"],
      confidence: 0.9
    },
    {
      id: "destructive-action",
      title: "Delete a workspace note permanently",
      description: "Irreversible destructive action.",
      capabilities: ["delete"],
      confidence: 0.95
    }
  ];
}

export function simulateGovernanceScenarios(params: {
  governance?: WorkspaceGovernance | null;
  memories?: MemoryRecord[];
  scorecard?: AgentMetrics | null;
  scenarios?: GovernanceSimulationScenario[];
}): GovernanceSimulationScenarioResult[] {
  const scenarios = params.scenarios ?? buildGovernanceSimulationScenarios();
  return scenarios.map((scenario) => ({
    ...scenario,
    result: simulateTaskPolicy({
      capabilities: scenario.capabilities,
      confidence: scenario.confidence,
      title: scenario.title,
      governance: params.governance,
      memories: params.memories,
      scorecard: params.scorecard
    })
  }));
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

export function simulateTaskPolicy(params: {
  capabilities: Capability[];
  confidence: number;
  title: string;
  memories?: MemoryRecord[];
  scorecard?: AgentMetrics | null;
  governance?: WorkspaceGovernance | null;
}): PolicySimulationResult {
  const riskClass = riskFromCapabilities(params.capabilities);
  const trust = params.memories
    ? computeTrustFromMemories(params.memories, params.title, params.capabilities)
    : { approvedCount: 0, rejectedCount: 0, trustScore: 0 };
  const scorecardTrust = computeTrustFromScorecard(params.scorecard);
  const conformance = assessWorkspaceGovernanceConformance(params.governance);
  const checks: PolicySimulationCheck[] = [
    {
      id: "risk-classification",
      stage: "risk",
      status: "info",
      summary: `Task classified as ${riskClass}.`,
      detail: `Capabilities [${params.capabilities.join(", ")}] map to ${riskClass}.`
    }
  ];

  if (params.confidence < 0.55) {
    checks.push({
      id: "confidence-threshold",
      stage: "input",
      status: "warn",
      summary: "Confidence is below the autonomous threshold.",
      detail: `Confidence ${params.confidence.toFixed(2)} is below the minimum 0.55 threshold.`
    });
    return {
      decision: buildDecision({
        riskClass,
        outcome: "downgrade_to_draft",
        rationale: `Confidence is below the autonomous threshold for "${params.title}".`,
        confidence: params.confidence,
        requiresApproval: false
      }),
      checks,
      trust,
      scorecardTrust,
      conformance
    };
  }

  if (riskClass === "R4") {
    checks.push({
      id: "irreversible-action",
      stage: "decision",
      status: "fail",
      summary: "Irreversible or highly sensitive action detected.",
      detail: `Tasks with ${riskClass} risk stay blocked even when confidence is high.`
    });
    return {
      decision: buildDecision({
        riskClass,
        outcome: "blocked",
        rationale: `The task "${params.title}" includes an irreversible or highly sensitive action.`,
        confidence: params.confidence,
        requiresApproval: true
      }),
      checks,
      trust,
      scorecardTrust,
      conformance
    };
  }

  const governanceApprovalReason = getGovernanceApprovalReason({
    capabilities: params.capabilities,
    riskClass,
    governance: params.governance
  });

  if (governanceApprovalReason) {
    checks.push({
      id: "governance-gate",
      stage: "governance",
      status: "warn",
      summary: "Workspace governance requires approval.",
      detail: governanceApprovalReason
    });
    return {
      decision: buildDecision({
        riskClass,
        outcome: "allowed_with_confirmation",
        rationale: `The task "${params.title}" requires approval. ${governanceApprovalReason}`,
        confidence: params.confidence,
        requiresApproval: true
      }),
      checks,
      trust,
      scorecardTrust,
      conformance
    };
  }

  if (riskClass === "R3") {
    // Scorecards only strengthen autonomy when memory trust is already strong.
    if (trust.trustScore >= 0.7 && trust.approvedCount >= 3 && scorecardTrust.strong) {
      checks.push({
        id: "trust-elevation",
        stage: "trust",
        status: "pass",
        summary: "Strong trust and scorecard signals allow autonomous execution.",
        detail: `Learned trust score ${trust.trustScore.toFixed(2)} with ${trust.approvedCount} prior approvals and a strong scorecard cleared the R3 review gate.`
      });
      return {
        decision: buildDecision({
          riskClass,
          outcome: "allowed",
          rationale: `The task "${params.title}" would normally require approval, but learned trust (${trust.approvedCount} prior approvals, trust score ${trust.trustScore.toFixed(2)}) and a strong execution scorecard allow autonomous execution.`,
          confidence: params.confidence,
          requiresApproval: false
        }),
        checks,
        trust,
        scorecardTrust,
        conformance
      };
    }

    if (scorecardTrust.weak) {
      checks.push({
        id: "scorecard-weakness",
        stage: "trust",
        status: "warn",
        summary: "Execution scorecard is too weak for autonomous R3 execution.",
        detail: scorecardTrust.rationale ?? "Recent execution history is not strong enough for autonomy."
      });
      return {
        decision: buildDecision({
          riskClass,
          outcome: "allowed_with_confirmation",
          rationale: `The task "${params.title}" creates an external commitment and requires user approval. ${scorecardTrust.rationale ?? "Prior execution history is not yet strong enough for autonomy."}`,
          confidence: params.confidence,
          requiresApproval: true
        }),
        checks,
        trust,
        scorecardTrust,
        conformance
      };
    }

    // If user has rejected similar tasks, add stricter language
    if (trust.rejectedCount > 0 && trust.trustScore < -0.3) {
      checks.push({
        id: "rejection-history",
        stage: "trust",
        status: "warn",
        summary: "Recent rejection history keeps the task in approval-required mode.",
        detail: `Similar tasks were rejected ${trust.rejectedCount} time(s), producing a trust score of ${trust.trustScore.toFixed(2)}.`
      });
      return {
        decision: buildDecision({
          riskClass,
          outcome: "allowed_with_confirmation",
          rationale: `The task "${params.title}" creates an external commitment and requires user approval. Note: similar tasks have been rejected ${trust.rejectedCount} time(s) previously.`,
          confidence: params.confidence,
          requiresApproval: true
        }),
        checks,
        trust,
        scorecardTrust,
        conformance
      };
    }

    checks.push({
      id: "default-r3-gate",
      stage: "decision",
      status: "warn",
      summary: "R3 tasks stay approval-gated by default.",
      detail: scorecardTrust.rationale ?? "External commitments require approval unless trust and execution quality are both strong."
    });
    return {
      decision: buildDecision({
        riskClass,
        outcome: "allowed_with_confirmation",
        rationale: `The task "${params.title}" creates an external commitment and requires user approval.${scorecardTrust.rationale ? ` ${scorecardTrust.rationale}` : ""}`,
        confidence: params.confidence,
        requiresApproval: true
      }),
      checks,
      trust,
      scorecardTrust,
      conformance
    };
  }

  checks.push({
    id: "low-risk-allow",
    stage: "decision",
    status: "pass",
    summary: "Task stays inside the low-risk automation envelope.",
    detail: `No governance gate or trust restriction blocked the ${riskClass} task.`
  });
  return {
    decision: buildDecision({
      riskClass,
      outcome: "allowed",
      rationale: `The task "${params.title}" stays within the low-risk automation policy.`,
      confidence: params.confidence,
      requiresApproval: false
    }),
    checks,
    trust,
    scorecardTrust,
    conformance
  };
}

export function evaluateTaskPolicy(params: {
  capabilities: Capability[];
  confidence: number;
  title: string;
  memories?: MemoryRecord[];
  scorecard?: AgentMetrics | null;
  governance?: WorkspaceGovernance | null;
}): PolicyDecision {
  return simulateTaskPolicy(params).decision;
}
