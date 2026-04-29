import {
  AutonomyBudgetSchema,
  PolicyDecisionSchema,
  PolicyDecisionTraceSchema,
  WorkspaceGovernanceSchema,
  defaultWorkspaceShadowReplayPolicy,
  type AgentMetrics,
  type AutonomyBudget,
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

export type PolicyReplayValidation = {
  replayValidated: boolean;
  matchedPatterns: number;
  matchedEpisodes: number;
  suggestedPatterns: number;
  safeSuggestionPrecision: number;
  negativeOutcomeRate: number;
  failureCostRate: number;
  driftStatus: "improving" | "stable" | "regressing" | "insufficient_data";
  rationale: string;
};

export type PolicyShadowReplayReadiness = {
  status: "ready" | "missing" | "insufficient" | "disabled" | "shadow_only" | "not_required";
  summary: string;
  thresholdSummary: string[];
};

export type PolicyLearningInfluenceComparison = {
  baseline: PolicyDecision;
  influenced: PolicyDecision;
  changed: boolean;
  promoted: boolean;
  rollbackApplied: boolean;
  summary: string;
};

export type PolicySimulationResult = {
  decision: PolicyDecision;
  checks: PolicySimulationCheck[];
  trust: TrustSignal;
  scorecardTrust: ScorecardTrustSignal;
  autonomyBudget: AutonomyBudget | null;
  conformance: GovernanceConformanceReport | null;
  learningValidation: PolicyReplayValidation | null;
};

export type GovernanceSimulationScenario = {
  id: string;
  title: string;
  description: string;
  capabilities: Capability[];
  confidence: number;
  expectedDecision?: "allow" | "approval" | "block" | "draft";
};

export type GovernanceSimulationScenarioResult = GovernanceSimulationScenario & {
  result: PolicySimulationResult;
};

export type GovernanceSimulationCalibrationThresholds = {
  maximumFalseAllowRate: number;
  maximumFalseDenyRate: number;
  maximumLatencyMs: number;
  minimumScenarioCoverageRate: number;
};

export type GovernanceSimulationCalibrationReport = {
  status: "pass" | "degraded" | "fail";
  autonomyExpansionAllowed: boolean;
  thresholds: GovernanceSimulationCalibrationThresholds;
  metrics: {
    totalScenarios: number;
    expectedScenarioCount: number;
    scenarioCoverageRate: number;
    falseAllowCount: number;
    falseDenyCount: number;
    escalationCount: number;
    falseAllowRate: number;
    falseDenyRate: number;
    escalationRate: number;
    latencyMs: number;
  };
  findings: string[];
  simulations: GovernanceSimulationScenarioResult[];
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

function summarizeShadowReplayThresholds(governance: WorkspaceGovernance): string[] {
  const policy = governance.shadowReplayPolicy ?? defaultWorkspaceShadowReplayPolicy;

  return [
    `${policy.minimumMatchedEpisodes}+ matched episode${policy.minimumMatchedEpisodes === 1 ? "" : "s"}`,
    `${Math.round(policy.minimumPrecision * 100)}%+ precision`,
    `<= ${Math.round(policy.maximumNegativeOutcomeRate * 100)}% negative outcomes`,
    `<= ${Math.round(policy.maximumFailureCostRate * 100)}% failure cost`
  ];
}

function buildLearningRollbackDecision(params: {
  riskClass: RiskClass;
  title: string;
  confidence: number;
  rollbackOutcome: WorkspaceGovernance["shadowReplayPolicy"]["rollbackOutcome"];
  reason: string;
}): PolicyDecision {
  if (params.rollbackOutcome === "downgrade_to_draft") {
    return buildDecision({
      riskClass: params.riskClass,
      outcome: "downgrade_to_draft",
      rationale: `The task "${params.title}" was rolled back to draft-only execution because ${params.reason}`,
      confidence: params.confidence,
      requiresApproval: false
    });
  }

  return buildDecision({
    riskClass: params.riskClass,
    outcome: "allowed_with_confirmation",
    rationale: `The task "${params.title}" still requires approval because ${params.reason}`,
    confidence: params.confidence,
    requiresApproval: true
  });
}

export function buildAutonomyBudget(rawGovernance: WorkspaceGovernance | null | undefined): AutonomyBudget | null {
  if (!rawGovernance) {
    return null;
  }

  const governance = WorkspaceGovernanceSchema.parse(rawGovernance);
  const shadowReplayPolicy = governance.shadowReplayPolicy ?? defaultWorkspaceShadowReplayPolicy;

  const requiresExplicitApprovalCapabilities: Capability[] = [];

  if (governance.externalSendRequiresApproval) {
    requiresExplicitApprovalCapabilities.push("send");
  }

  if (governance.calendarWriteRequiresApproval) {
    requiresExplicitApprovalCapabilities.push("schedule");
  }

  const r3AutonomyEligible = governance.approvalMode === "risk_based" && governance.maxAutoRunRiskClass === "R3";
  const shadowReplayRequired = r3AutonomyEligible;
  const thresholdSummary = summarizeShadowReplayThresholds(governance);
  const learningPromotionSummary =
    shadowReplayPolicy.promotionMode === "validated_autonomy"
      ? "Replay-validated learning can widen autonomy once the replay gate clears."
      : shadowReplayPolicy.promotionMode === "shadow_only"
        ? "Learning signals remain shadow-only and cannot widen live autonomy yet."
        : "The learning-promotion kill switch is active, so learning signals cannot widen live autonomy.";

  const summary =
    governance.approvalMode === "always_review"
      ? "Always-review governance keeps every task on the approval path, so confidence and learning signals can explain decisions but do not widen autonomy."
      : r3AutonomyEligible
        ? `Risk-based governance can consider R3 autonomy up to ${governance.maxAutoRunRiskClass}, but elevated paths still depend on trust, scorecard, and replay-validation inputs.`
        : `Risk-based governance caps autonomous execution at ${governance.maxAutoRunRiskClass}, with higher-risk work staying on the approval path.`;

  const shadowReplaySummary = shadowReplayRequired
    ? shadowReplayPolicy.enabled
      ? `${learningPromotionSummary} R3 autonomy depends on replay validation meeting ${thresholdSummary.join(", ")}.`
      : "R3 autonomy is configured, but shadow replay is disabled, so elevated autonomy should remain held back until replay thresholds are restored."
    : shadowReplayPolicy.enabled
      ? `${learningPromotionSummary} Shadow replay thresholds are staged for future R3 widening: ${thresholdSummary.join(", ")}.`
      : "Shadow replay is inactive because workspace autonomy is currently capped below R3.";

  return AutonomyBudgetSchema.parse({
    approvalMode: governance.approvalMode,
    governanceCeilingRiskClass: governance.maxAutoRunRiskClass,
    requiresExplicitApprovalCapabilities,
    r3AutonomyEligible,
    shadowReplay: {
      eligibleForR3: r3AutonomyEligible,
      enabled: shadowReplayPolicy.enabled,
      required: shadowReplayRequired,
      promotionMode: shadowReplayPolicy.promotionMode,
      rollbackOutcome: shadowReplayPolicy.rollbackOutcome,
      thresholdSummary,
      summary: shadowReplaySummary
    },
    decisionInputs: [
      {
        id: "confidence_threshold",
        category: "input",
        active: true,
        summary: "Minimum confidence gates autonomous execution.",
        detail: "Tasks below 0.55 confidence are downgraded to draft behavior before other autonomy checks are considered."
      },
      {
        id: "capability_risk_class",
        category: "input",
        active: true,
        summary: "Capabilities are mapped into a bounded risk class.",
        detail: "Read/search stay low risk, create/update/draft/monitor raise the task to R2, send/schedule raise it to R3, and delete/approve remain R4."
      },
      {
        id: "approval_mode",
        category: "governance",
        active: true,
        summary: `Workspace approval mode is ${governance.approvalMode}.`,
        detail:
          governance.approvalMode === "always_review"
            ? "Always-review mode keeps all tasks on the approval path regardless of confidence or trust signals."
            : "Risk-based mode lets the policy engine evaluate confidence, risk, governance, and trust before deciding whether approval is still required."
      },
      {
        id: "governance_ceiling",
        category: "governance",
        active: true,
        summary: `Autonomous execution ceiling is ${governance.maxAutoRunRiskClass}.`,
        detail: `Tasks above ${governance.maxAutoRunRiskClass} stay approval-gated even when confidence is high.`
      },
      {
        id: "external_send_gate",
        category: "governance",
        active: governance.externalSendRequiresApproval,
        summary: governance.externalSendRequiresApproval
          ? "External sends remain approval-gated."
          : "External sends can be considered for autonomous execution.",
        detail: governance.externalSendRequiresApproval
          ? "Customer-facing or outbound communication must receive approval before execution."
          : "External send tasks still pass through the broader policy checks, but governance does not force review at the capability boundary."
      },
      {
        id: "calendar_write_gate",
        category: "governance",
        active: governance.calendarWriteRequiresApproval,
        summary: governance.calendarWriteRequiresApproval
          ? "Calendar writes remain approval-gated."
          : "Calendar writes can be considered for autonomous execution.",
        detail: governance.calendarWriteRequiresApproval
          ? "Scheduling changes that create external commitments stay behind approval."
          : "Calendar writes still pass through the broader policy checks, but governance does not force review at the capability boundary."
      },
      {
        id: "shadow_replay_policy",
        category: "governance",
        active: r3AutonomyEligible,
        summary: shadowReplaySummary,
        detail: r3AutonomyEligible
          ? "When the workspace widens autonomy to R3, replay thresholds determine whether learned elevated paths can clear the final review gate."
          : "Replay thresholds are configuration-only until the workspace widens autonomy to R3."
      },
      {
        id: "learning_promotion_mode",
        category: "learning",
        active: r3AutonomyEligible,
        summary: `Learning promotion mode is ${governance.shadowReplayPolicy.promotionMode}.`,
        detail:
          governance.shadowReplayPolicy.promotionMode === "validated_autonomy"
            ? "Replay-validated learning can widen autonomy after the replay gate clears."
            : governance.shadowReplayPolicy.promotionMode === "shadow_only"
              ? "Learning influence is measured in shadow mode but cannot affect live autonomy decisions."
              : "A hard kill switch blocks learning influence from widening autonomy until operators re-enable it."
      },
      {
        id: "learning_rollback_control",
        category: "learning",
        active: r3AutonomyEligible,
        summary: `Learning rollback falls back to ${governance.shadowReplayPolicy.rollbackOutcome}.`,
        detail:
          governance.shadowReplayPolicy.rollbackOutcome === "downgrade_to_draft"
            ? "If replay validation regresses or operators disable learning promotion, the task falls back to draft-only execution instead of live execution."
            : "If replay validation regresses or operators disable learning promotion, the task stays reviewable on the approval path."
      },
      {
        id: "memory_trust",
        category: "trust",
        active: r3AutonomyEligible,
        summary: "Fresh approval history can strengthen R3 autonomy decisions.",
        detail: "The policy engine only considers memory trust when evaluating whether a learned R3 path has enough approval history to clear review."
      },
      {
        id: "scorecard_trust",
        category: "trust",
        active: r3AutonomyEligible,
        summary: "Execution scorecards can strengthen R3 autonomy decisions.",
        detail: "Strong task success, approval, and correction metrics are required alongside memory trust before elevated autonomy can clear R3 review."
      },
      {
        id: "replay_validation",
        category: "learning",
        active: r3AutonomyEligible,
        summary: "Replay validation protects learned R3 autonomy signals.",
        detail: "Matched episodes, precision, negative outcomes, failure cost, and drift must all stay inside replay thresholds before learned elevated autonomy is trusted."
      }
    ],
    summary
  });
}

export function assessShadowReplayReadiness(params: {
  governance?: WorkspaceGovernance | null;
  learningValidation?: PolicyReplayValidation | null;
  targetRiskClass?: RiskClass;
}): PolicyShadowReplayReadiness {
  const governance = params.governance;
  const targetRiskClass = params.targetRiskClass ?? governance?.maxAutoRunRiskClass;

  if (!governance || targetRiskClass !== "R3") {
    return {
      status: "not_required",
      summary: "Shadow replay is not required because the evaluated path does not widen autonomy to R3.",
      thresholdSummary: []
    };
  }

  const thresholdSummary = summarizeShadowReplayThresholds(governance);
  const policy = governance.shadowReplayPolicy;

  if (policy.promotionMode === "disabled") {
    return {
      status: "disabled",
      summary:
        "The learning-promotion kill switch is active, so replay evidence stays observational and cannot widen live autonomy.",
      thresholdSummary
    };
  }

  if (policy.promotionMode === "shadow_only") {
    return {
      status: "shadow_only",
      summary:
        "Learning signals are held in shadow-only mode, so replay evidence is collected but cannot widen live autonomy yet.",
      thresholdSummary
    };
  }

  if (!policy.enabled) {
    return {
      status: "disabled",
      summary:
        "Shadow replay is disabled while workspace governance still allows R3 autonomy. Keep elevated autonomy gated until replay thresholds are restored.",
      thresholdSummary
    };
  }

  const learningValidation = params.learningValidation;

  if (!learningValidation) {
    return {
      status: "missing",
      summary:
        "Shadow replay evidence is still missing for this learned R3 path, so elevated autonomy must remain approval-gated.",
      thresholdSummary
    };
  }

  const failures: string[] = [];

  if (!learningValidation.replayValidated) {
    failures.push(learningValidation.rationale);
  }

  if (learningValidation.matchedEpisodes < policy.minimumMatchedEpisodes) {
    failures.push(
      `Only ${learningValidation.matchedEpisodes} matched episode${learningValidation.matchedEpisodes === 1 ? "" : "s"} were observed.`
    );
  }

  if (learningValidation.safeSuggestionPrecision < policy.minimumPrecision) {
    failures.push(
      `Replay precision ${learningValidation.safeSuggestionPrecision.toFixed(2)} is below the ${policy.minimumPrecision.toFixed(2)} minimum.`
    );
  }

  if (learningValidation.negativeOutcomeRate > policy.maximumNegativeOutcomeRate) {
    failures.push(
      `Negative outcome rate ${learningValidation.negativeOutcomeRate.toFixed(2)} exceeds the ${policy.maximumNegativeOutcomeRate.toFixed(2)} maximum.`
    );
  }

  if (learningValidation.failureCostRate > policy.maximumFailureCostRate) {
    failures.push(
      `Failure cost rate ${learningValidation.failureCostRate.toFixed(2)} exceeds the ${policy.maximumFailureCostRate.toFixed(2)} maximum.`
    );
  }

  if (failures.length > 0) {
    return {
      status: "insufficient",
      summary: failures.join(" "),
      thresholdSummary
    };
  }

  return {
    status: "ready",
    summary:
      "Shadow replay thresholds are satisfied, so elevated R3 autonomy can rely on replay-validated learning evidence for this path.",
    thresholdSummary
  };
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
  rawGovernance: WorkspaceGovernance | null | undefined
): GovernanceConformanceReport | null {
  if (!rawGovernance) {
    return null;
  }

  const governance = WorkspaceGovernanceSchema.parse(rawGovernance);
  const shadowReplayPolicy = governance.shadowReplayPolicy ?? defaultWorkspaceShadowReplayPolicy;

  const checks: GovernanceConformanceCheck[] = [
    governance.approvalMode === "always_review"
      ? {
          id: "approval-mode",
          status: "pass",
          summary: "Every task defaults to explicit review.",
          detail: "Always-review mode prevents confidence, scorecards, or learning signals from widening live autonomy by default."
        }
      : governance.maxAutoRunRiskClass === "R1" || governance.maxAutoRunRiskClass === "R2"
        ? {
            id: "approval-mode",
            status: "pass",
            summary: "Risk-based approval mode is bounded by conservative defaults.",
            detail: "Risk-based mode remains inside the enterprise-safe posture while the auto-run ceiling and capability gates stay restrictive."
          }
      : {
          id: "approval-mode",
          status: "warn",
          summary: "Risk-based approval mode is enabled.",
          detail: "Risk-based mode is an explicit override and should stay paired with conservative ceilings and capability gates."
        },
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
    governance.publicSharingEnabled
      ? {
          id: "public-sharing",
          status: "warn",
          summary: "Public share links are enabled.",
          detail: "Public sharing is an explicit override and should be paired with expiry, audit review, and disclosure controls."
        }
      : {
          id: "public-sharing",
          status: "pass",
          summary: "Public share links are disabled by default.",
          detail: "Externally visible share links fail closed until the workspace owner explicitly enables the capability."
        },
    governance.providerAccessRequiresApproval
      ? {
          id: "provider-access",
          status: "pass",
          summary: "Provider-backed actions stay approval-gated.",
          detail: "Connector/provider access can support drafting and readiness checks without silently widening side effects."
        }
      : {
          id: "provider-access",
          status: "fail",
          summary: "Provider-backed actions can bypass explicit approval.",
          detail: "Enterprise governance should require review before provider access can create external side effects."
        },
    governance.escalationRequiresApproval
      ? {
          id: "escalation-approval",
          status: "pass",
          summary: "Escalation actions require approval.",
          detail: "Escalation remains a governed operator decision rather than an ambient automation default."
        }
      : {
          id: "escalation-approval",
          status: "warn",
          summary: "Escalation actions can proceed without explicit approval.",
          detail: "Automatic escalation can change ownership and priority, so relaxed settings should be intentional and audited."
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

  if (governance.maxAutoRunRiskClass === "R3") {
    checks.push(
      !shadowReplayPolicy.enabled
        ? {
            id: "shadow-replay",
            status: "fail",
            summary: "R3 autonomy is configured without shadow replay gating.",
            detail:
              "Workspace governance allows widened autonomy but has disabled the replay-shadow gate that should validate learned high-impact execution paths first."
          }
        : shadowReplayPolicy.promotionMode === "validated_autonomy"
        ? {
            id: "shadow-replay",
            status: "pass",
            summary: "Shadow replay and replay-validated learning protect widened R3 autonomy.",
            detail: `Replay thresholds require ${summarizeShadowReplayThresholds(governance).join(", ")} before elevated autonomy is considered ready.`
          }
        : shadowReplayPolicy.promotionMode === "shadow_only"
          ? {
              id: "shadow-replay",
              status: "warn",
              summary: "R3 autonomy is configured, but learning promotion is shadow-only.",
              detail:
                "Replay evidence is still being collected, but live autonomy will not widen until operators switch the promotion mode back to validated autonomy."
            }
          : {
              id: "shadow-replay",
              status: "warn",
              summary: "R3 autonomy is configured, but the learning-promotion kill switch is active.",
              detail:
                "Replay evidence remains observable, but live autonomy promotion is intentionally disabled until operators restore the promotion mode."
            }
    );
  } else {
    checks.push(
      shadowReplayPolicy.enabled
        ? {
            id: "shadow-replay",
            status: "pass",
            summary: "Shadow replay thresholds are configured for future autonomy widening.",
            detail: `If the workspace later widens autonomy to R3, replay thresholds will require ${summarizeShadowReplayThresholds(governance).join(", ")}.`
          }
        : {
            id: "shadow-replay",
            status: "pass",
            summary: "Shadow replay is inactive because autonomy is capped below R3.",
            detail: "The current risk ceiling does not rely on replay-shadow evidence because elevated autonomy is not enabled."
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
      confidence: 0.94,
      expectedDecision: "allow"
    },
    {
      id: "draft-update",
      title: "Draft and update the weekly operating note",
      description: "Normal internal drafting and update work.",
      capabilities: ["create", "update", "draft"],
      confidence: 0.9,
      expectedDecision: "allow"
    },
    {
      id: "external-send",
      title: "Send an external stakeholder update",
      description: "External commitment with communication risk.",
      capabilities: ["send"],
      confidence: 0.9,
      expectedDecision: "approval"
    },
    {
      id: "calendar-write",
      title: "Schedule an executive review meeting",
      description: "Calendar write that creates an external commitment.",
      capabilities: ["schedule"],
      confidence: 0.9,
      expectedDecision: "approval"
    },
    {
      id: "destructive-action",
      title: "Delete a workspace note permanently",
      description: "Irreversible destructive action.",
      capabilities: ["delete"],
      confidence: 0.95,
      expectedDecision: "block"
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

function classifyPolicyDecision(decision: PolicyDecision): NonNullable<GovernanceSimulationScenario["expectedDecision"]> {
  if (decision.outcome === "blocked") {
    return "block";
  }

  if (decision.outcome === "downgrade_to_draft") {
    return "draft";
  }

  if (decision.requiresApproval || decision.outcome === "allowed_with_confirmation" || decision.outcome === "escalate") {
    return "approval";
  }

  return "allow";
}

export function evaluateGovernanceSimulationCalibration(params: {
  simulations: GovernanceSimulationScenarioResult[];
  latencyMs: number;
  thresholds?: Partial<GovernanceSimulationCalibrationThresholds>;
}): GovernanceSimulationCalibrationReport {
  const thresholds: GovernanceSimulationCalibrationThresholds = {
    maximumFalseAllowRate: params.thresholds?.maximumFalseAllowRate ?? 0,
    maximumFalseDenyRate: params.thresholds?.maximumFalseDenyRate ?? 0.2,
    maximumLatencyMs: params.thresholds?.maximumLatencyMs ?? 250,
    minimumScenarioCoverageRate: params.thresholds?.minimumScenarioCoverageRate ?? 0.8
  };
  const expectedScenarios = params.simulations.filter((scenario) => scenario.expectedDecision);
  const falseAllowCount = expectedScenarios.filter((scenario) => {
    const actual = classifyPolicyDecision(scenario.result.decision);
    return actual === "allow" && scenario.expectedDecision !== "allow";
  }).length;
  const falseDenyCount = expectedScenarios.filter((scenario) => {
    const actual = classifyPolicyDecision(scenario.result.decision);
    return actual !== "allow" && scenario.expectedDecision === "allow";
  }).length;
  const escalationCount = params.simulations.filter((scenario) => scenario.result.decision.requiresApproval).length;
  const expectedScenarioCount = expectedScenarios.length;
  const scenarioCoverageRate = params.simulations.length > 0 ? expectedScenarioCount / params.simulations.length : 0;
  const falseAllowRate = expectedScenarioCount > 0 ? falseAllowCount / expectedScenarioCount : 0;
  const falseDenyRate = expectedScenarioCount > 0 ? falseDenyCount / expectedScenarioCount : 0;
  const escalationRate = params.simulations.length > 0 ? escalationCount / params.simulations.length : 0;
  const findings: string[] = [];

  if (scenarioCoverageRate < thresholds.minimumScenarioCoverageRate) {
    findings.push(
      `Scenario coverage ${(scenarioCoverageRate * 100).toFixed(0)}% is below the ${(thresholds.minimumScenarioCoverageRate * 100).toFixed(0)}% minimum.`
    );
  }

  if (falseAllowRate > thresholds.maximumFalseAllowRate) {
    findings.push(
      `False allow rate ${(falseAllowRate * 100).toFixed(0)}% exceeds the ${(thresholds.maximumFalseAllowRate * 100).toFixed(0)}% maximum.`
    );
  }

  if (falseDenyRate > thresholds.maximumFalseDenyRate) {
    findings.push(
      `False deny rate ${(falseDenyRate * 100).toFixed(0)}% exceeds the ${(thresholds.maximumFalseDenyRate * 100).toFixed(0)}% maximum.`
    );
  }

  if (params.latencyMs > thresholds.maximumLatencyMs) {
    findings.push(`Simulation latency ${params.latencyMs}ms exceeds the ${thresholds.maximumLatencyMs}ms maximum.`);
  }

  const status = findings.some((finding) => finding.includes("False allow")) ? "fail" : findings.length > 0 ? "degraded" : "pass";

  return {
    status,
    autonomyExpansionAllowed: status === "pass",
    thresholds,
    metrics: {
      totalScenarios: params.simulations.length,
      expectedScenarioCount,
      scenarioCoverageRate,
      falseAllowCount,
      falseDenyCount,
      escalationCount,
      falseAllowRate,
      falseDenyRate,
      escalationRate,
      latencyMs: params.latencyMs
    },
    findings,
    simulations: params.simulations
  };
}

export function buildContinuousGovernanceSimulationReport(params: {
  governance?: WorkspaceGovernance | null;
  memories?: MemoryRecord[];
  scorecard?: AgentMetrics | null;
  scenarios?: GovernanceSimulationScenario[];
  thresholds?: Partial<GovernanceSimulationCalibrationThresholds>;
}): GovernanceSimulationCalibrationReport {
  const startedAt = Date.now();
  const simulations = simulateGovernanceScenarios(params);

  return evaluateGovernanceSimulationCalibration({
    simulations,
    latencyMs: Date.now() - startedAt,
    thresholds: params.thresholds
  });
}

export function getGovernanceApprovalReason(params: {
  capabilities: Capability[];
  riskClass: RiskClass;
  governance?: WorkspaceGovernance | null;
}): string | null {
  const { capabilities, riskClass } = params;

  if (!params.governance) {
    return null;
  }

  const governance = WorkspaceGovernanceSchema.parse(params.governance);

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
  learningValidation?: PolicyReplayValidation | null;
}): PolicySimulationResult {
  const riskClass = riskFromCapabilities(params.capabilities);
  const autonomyBudget = buildAutonomyBudget(params.governance);
  const trust = params.memories
    ? computeTrustFromMemories(params.memories, params.title, params.capabilities)
    : { approvedCount: 0, rejectedCount: 0, trustScore: 0 };
  const scorecardTrust = computeTrustFromScorecard(params.scorecard);
  const conformance = assessWorkspaceGovernanceConformance(params.governance);
  const learningValidation = params.learningValidation ?? null;
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
      autonomyBudget,
      conformance,
      learningValidation
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
      autonomyBudget,
      conformance,
      learningValidation
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
      autonomyBudget,
      conformance,
      learningValidation
    };
  }

  if (riskClass === "R3") {
    // Scorecards only strengthen autonomy when memory trust is already strong.
    if (trust.trustScore >= 0.7 && trust.approvedCount >= 3 && scorecardTrust.strong) {
      const learningPromotionMode = params.governance?.shadowReplayPolicy.promotionMode ?? "validated_autonomy";
      const learningRollbackOutcome = params.governance?.shadowReplayPolicy.rollbackOutcome ?? "allowed_with_confirmation";

      if (learningPromotionMode === "disabled") {
        checks.push({
          id: "learning-kill-switch",
          stage: "trust",
          status: "warn",
          summary: "Learning promotion is disabled by governance.",
          detail: "The workspace kill switch keeps replay-backed learning from widening live autonomy."
        });
        return {
          decision: buildLearningRollbackDecision({
            riskClass,
            title: params.title,
            confidence: params.confidence,
            rollbackOutcome: learningRollbackOutcome,
            reason: "the workspace learning-promotion kill switch is active"
          }),
          checks,
          trust,
          scorecardTrust,
          autonomyBudget,
          conformance,
          learningValidation
        };
      }

      if (learningPromotionMode === "shadow_only") {
        checks.push({
          id: "learning-shadow-only",
          stage: "trust",
          status: "warn",
          summary: "Learning promotion is still in shadow-only mode.",
          detail: "Replay evidence is being collected, but it cannot widen live autonomy until operators promote the mode."
        });
        return {
          decision: buildLearningRollbackDecision({
            riskClass,
            title: params.title,
            confidence: params.confidence,
            rollbackOutcome: learningRollbackOutcome,
            reason: "learning promotion is still staged in shadow-only mode"
          }),
          checks,
          trust,
          scorecardTrust,
          autonomyBudget,
          conformance,
          learningValidation
        };
      }

      if (!learningValidation) {
        checks.push({
          id: "replay-validation-missing",
          stage: "trust",
          status: "warn",
          summary: "Replay validation evidence is missing for the learned path.",
          detail: "Live autonomy promotion stays blocked until the same path is replay-validated."
        });
        return {
          decision: buildLearningRollbackDecision({
            riskClass,
            title: params.title,
            confidence: params.confidence,
            rollbackOutcome: learningRollbackOutcome,
            reason: "replay validation evidence is still missing for the learned path"
          }),
          checks,
          trust,
          scorecardTrust,
          autonomyBudget,
          conformance,
          learningValidation
        };
      }

      const shadowReplayReadiness = assessShadowReplayReadiness({
        governance: params.governance,
        learningValidation
      });

      if (params.governance?.maxAutoRunRiskClass === "R3" && shadowReplayReadiness.status !== "ready") {
        checks.push({
          id: "shadow-replay-gate",
          stage: "trust",
          status: "warn",
          summary: "Shadow replay has not yet cleared the learned R3 path.",
          detail: shadowReplayReadiness.summary
        });
        return {
          decision: buildLearningRollbackDecision({
            riskClass,
            title: params.title,
            confidence: params.confidence,
            rollbackOutcome: learningRollbackOutcome,
            reason: `the workspace shadow replay gate has not cleared the learned R3 path. ${shadowReplayReadiness.summary}`
          }),
          checks,
          trust,
          scorecardTrust,
          autonomyBudget,
          conformance,
          learningValidation
        };
      }

      if (learningValidation && !learningValidation.replayValidated) {
        checks.push({
          id: "replay-validation-gate",
          stage: "trust",
          status: "warn",
          summary: "Outcome-trace learning is not yet replay-validated for autonomy.",
          detail: learningValidation.rationale
        });
        return {
          decision: buildLearningRollbackDecision({
            riskClass,
            title: params.title,
            confidence: params.confidence,
            rollbackOutcome: learningRollbackOutcome,
            reason: `replay validation has not cleared the learned automation signal. ${learningValidation.rationale}`
          }),
          checks,
          trust,
          scorecardTrust,
          autonomyBudget,
          conformance,
          learningValidation
        };
      }

      checks.push({
        id: "trust-elevation",
        stage: "trust",
        status: "pass",
        summary: "Strong trust and scorecard signals allow autonomous execution.",
        detail: learningValidation
          ? `Learned trust score ${trust.trustScore.toFixed(2)} with ${trust.approvedCount} prior approvals, a strong scorecard, and replay precision ${learningValidation.safeSuggestionPrecision.toFixed(2)} cleared the R3 review gate.`
          : `Learned trust score ${trust.trustScore.toFixed(2)} with ${trust.approvedCount} prior approvals and a strong scorecard cleared the R3 review gate.`
      });
      return {
        decision: buildDecision({
          riskClass,
          outcome: "allowed",
          rationale: learningValidation
            ? `The task "${params.title}" would normally require approval, but learned trust (${trust.approvedCount} prior approvals, trust score ${trust.trustScore.toFixed(2)}), a strong execution scorecard, and replay-validated outcome traces with replay precision ${learningValidation.safeSuggestionPrecision.toFixed(2)} allow autonomous execution.`
            : `The task "${params.title}" would normally require approval, but learned trust (${trust.approvedCount} prior approvals, trust score ${trust.trustScore.toFixed(2)}) and a strong execution scorecard allow autonomous execution.`,
          confidence: params.confidence,
          requiresApproval: false
        }),
        checks,
        trust,
        scorecardTrust,
        autonomyBudget,
        conformance,
        learningValidation
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
        autonomyBudget,
        conformance,
        learningValidation
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
        autonomyBudget,
        conformance,
        learningValidation
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
      autonomyBudget,
      conformance,
      learningValidation
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
    autonomyBudget,
    conformance,
    learningValidation
  };
}

export function buildPolicyDecisionTrace(result: PolicySimulationResult) {
  return PolicyDecisionTraceSchema.parse({
    decision: result.decision,
    checks: result.checks,
    trust: result.trust,
    scorecardTrust: {
      strong: result.scorecardTrust.strong,
      weak: result.scorecardTrust.weak,
      rationale: result.scorecardTrust.rationale ?? null
    },
    autonomyBudget: result.autonomyBudget,
    conformance: result.conformance,
    learningValidation: result.learningValidation
  });
}

export function evaluateTaskPolicy(params: {
  capabilities: Capability[];
  confidence: number;
  title: string;
  memories?: MemoryRecord[];
  scorecard?: AgentMetrics | null;
  governance?: WorkspaceGovernance | null;
  learningValidation?: PolicyReplayValidation | null;
}): PolicyDecision {
  return simulateTaskPolicy(params).decision;
}

export function comparePolicyWithAndWithoutLearning(params: {
  capabilities: Capability[];
  confidence: number;
  title: string;
  memories?: MemoryRecord[];
  scorecard?: AgentMetrics | null;
  governance?: WorkspaceGovernance | null;
  learningValidation?: PolicyReplayValidation | null;
}): PolicyLearningInfluenceComparison {
  const baseline = simulateTaskPolicy({
    capabilities: params.capabilities,
    confidence: params.confidence,
    title: params.title,
    governance: params.governance
  }).decision;
  const influenced = simulateTaskPolicy(params).decision;
  const changed =
    baseline.outcome !== influenced.outcome ||
    baseline.requiresApproval !== influenced.requiresApproval ||
    baseline.riskClass !== influenced.riskClass;
  const promoted = baseline.requiresApproval && !influenced.requiresApproval;
  const rollbackApplied =
    influenced.outcome === "downgrade_to_draft" &&
    baseline.outcome !== "downgrade_to_draft" &&
    (params.governance?.shadowReplayPolicy.rollbackOutcome ?? "allowed_with_confirmation") === "downgrade_to_draft";

  const summary = promoted
    ? "Replay-validated learning widened the task from approval-required to autonomous execution."
    : rollbackApplied
      ? "Learning controls rolled the task back to draft-only execution after comparing the path with and without learning influence."
      : changed
        ? "Learning influence changed the task policy decision, but it did not widen the task all the way to autonomous execution."
        : "Learning influence did not change the task policy decision.";

  return {
    baseline,
    influenced,
    changed,
    promoted,
    rollbackApplied,
    summary
  };
}
