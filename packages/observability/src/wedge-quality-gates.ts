import {
  agentExecutionModeValues,
  type AgentExecutionMode,
  type EvidenceRecord,
  type GoalBundle
} from "@agentic/contracts";
import type { RolloutAlertOperator } from "./rollout-gates";

export const selectedProductionWedgeKeys = ["communications_execution", "scheduling_execution"] as const;

export type SelectedProductionWedgeKey = (typeof selectedProductionWedgeKeys)[number];

export type WedgeQualityMetricKey =
  | "workflow_completion_rate"
  | "governed_specialist_coverage_rate"
  | "approval_to_success_rate"
  | "correction_rate"
  | "post_approval_failure_rate";

export type WedgeQualityThresholdDefinition = {
  key: string;
  title: string;
  metric: WedgeQualityMetricKey;
  operator: RolloutAlertOperator;
  threshold: number;
  minimumSamples: number;
  severity: "warning" | "critical";
  rolloutGate: boolean;
  description: string;
  correctionAction: string;
};

export type WedgeQualityDefinition = {
  key: SelectedProductionWedgeKey;
  label: string;
  description: string;
  thresholds: WedgeQualityThresholdDefinition[];
};

export type WedgeQualityGateManifest = {
  version: 1;
  name: string;
  wedges: WedgeQualityDefinition[];
};

export type WedgeQualitySummary = {
  wedgeKey: SelectedProductionWedgeKey;
  wedgeLabel: string;
  workflowCount: number;
  completedWorkflowCount: number;
  workflowCompletionRate: number;
  governedSpecialistBundleCount: number;
  governedSpecialistCoverageRate: number;
  feedbackCount: number;
  approvedDecisionCount: number;
  approvedSuccessCount: number;
  approvalToSuccessRate: number;
  userCorrectionCount: number;
  correctionRate: number;
  postApprovalFailureCount: number;
  postApprovalFailureRate: number;
  contextPackWorkflowCount: number;
  clearContextWorkflowCount: number;
  reviewRequiredWorkflowCount: number;
  reviewRequiredWorkflowRate: number;
  conflictingWorkflowCount: number;
  conflictingWorkflowRate: number;
  averageContextReviewRequiredCount: number;
  averageContextConflictCount: number;
  clearContextCompletionRate: number;
  reviewRequiredCompletionRate: number;
  conflictingContextCompletionRate: number;
  recommendationEditCount: number;
  averageRecommendationEditDistance: number;
};

export type WedgeQualityResult = {
  wedgeKey: SelectedProductionWedgeKey;
  wedgeLabel: string;
  key: string;
  title: string;
  metric: WedgeQualityMetricKey;
  severity: "warning" | "critical";
  rolloutGate: boolean;
  passed: boolean;
  actual: number;
  threshold: number;
  operator: RolloutAlertOperator;
  sampleCount: number;
  minimumSamples: number;
  description: string;
  correctionAction: string;
  reason: string | null;
};

export type WedgeQualityGateEvaluation = {
  passed: boolean;
  evaluatedWedges: number;
  evaluatedBundles: number;
  summaries: WedgeQualitySummary[];
  results: WedgeQualityResult[];
};

const agentExecutionModeSet = new Set<AgentExecutionMode>(agentExecutionModeValues);

function isAgentExecutionMode(value: unknown): value is AgentExecutionMode {
  return typeof value === "string" && agentExecutionModeSet.has(value as AgentExecutionMode);
}

function compare(actual: number, operator: RolloutAlertOperator, threshold: number): boolean {
  switch (operator) {
    case "<":
      return actual < threshold;
    case "<=":
      return actual <= threshold;
    case ">":
      return actual > threshold;
    case ">=":
      return actual >= threshold;
    case "==":
      return actual === threshold;
    case "!=":
      return actual !== threshold;
  }
}

function rate(numerator: number, denominator: number): number {
  if (denominator <= 0) {
    return 0;
  }

  return numerator / denominator;
}

function metricActual(summary: WedgeQualitySummary, metric: WedgeQualityMetricKey): number {
  switch (metric) {
    case "workflow_completion_rate":
      return summary.workflowCompletionRate;
    case "governed_specialist_coverage_rate":
      return summary.governedSpecialistCoverageRate;
    case "approval_to_success_rate":
      return summary.approvalToSuccessRate;
    case "correction_rate":
      return summary.correctionRate;
    case "post_approval_failure_rate":
      return summary.postApprovalFailureRate;
  }
}

function metricSampleCount(summary: WedgeQualitySummary, metric: WedgeQualityMetricKey): number {
  switch (metric) {
    case "workflow_completion_rate":
    case "governed_specialist_coverage_rate":
      return summary.workflowCount;
    case "approval_to_success_rate":
    case "post_approval_failure_rate":
      return summary.approvedDecisionCount;
    case "correction_rate":
      return summary.feedbackCount;
  }
}

function buildThresholds(wedgeKey: SelectedProductionWedgeKey, wedgeLabel: string): WedgeQualityThresholdDefinition[] {
  return [
    {
      key: `${wedgeKey}.workflow_completion_rate`,
      title: `${wedgeLabel} workflow completion`,
      metric: "workflow_completion_rate",
      operator: ">=",
      threshold: 0.8,
      minimumSamples: 3,
      severity: "critical",
      rolloutGate: true,
      description: "Selected production wedges should complete most workflow bundles without stalling in waiting or failure states.",
      correctionAction: "Review blocked or failed bundles, tighten task decomposition, and remove workflow steps that repeatedly strand the wedge before widening rollout."
    },
    {
      key: `${wedgeKey}.governed_specialist_coverage_rate`,
      title: `${wedgeLabel} governed specialist coverage`,
      metric: "governed_specialist_coverage_rate",
      operator: ">=",
      threshold: 1,
      minimumSamples: 3,
      severity: "critical",
      rolloutGate: true,
      description: "Every selected production wedge bundle should emit at least one governed-specialist artifact instead of silently degrading to scaffolds.",
      correctionAction: "Trace any scaffold or manual-review artifact back to the wedge runner and restore governed-specialist execution before treating the wedge as production-ready."
    },
    {
      key: `${wedgeKey}.approval_to_success_rate`,
      title: `${wedgeLabel} approval-to-success rate`,
      metric: "approval_to_success_rate",
      operator: ">=",
      threshold: 0.75,
      minimumSamples: 2,
      severity: "critical",
      rolloutGate: true,
      description: "Approved wedge executions should usually finish cleanly after the operator allows the side effect.",
      correctionAction: "Inspect approved executions that did not complete, then fix adapter semantics, recovery metadata, or task shaping before further rollout."
    },
    {
      key: `${wedgeKey}.correction_rate`,
      title: `${wedgeLabel} user correction rate`,
      metric: "correction_rate",
      operator: "<=",
      threshold: 0.25,
      minimumSamples: 2,
      severity: "critical",
      rolloutGate: true,
      description: "Selected production wedges should not require frequent user rejection or correction at the approval boundary.",
      correctionAction: "Sample rejected approvals, classify the rejection reasons, and refine planning or preview quality until the wedge stops burning operator attention."
    },
    {
      key: `${wedgeKey}.post_approval_failure_rate`,
      title: `${wedgeLabel} post-approval failure rate`,
      metric: "post_approval_failure_rate",
      operator: "<=",
      threshold: 0.15,
      minimumSamples: 2,
      severity: "critical",
      rolloutGate: true,
      description: "Once approved, selected wedge side effects should rarely fail or block downstream execution.",
      correctionAction: "Treat post-approval failures as release blockers: inspect the job journal, repair adapter recovery, and replay only after the root cause is corrected."
    }
  ];
}

export const defaultSelectedProductionWedgeQualityManifest: WedgeQualityGateManifest = {
  version: 1,
  name: "selected production wedge quality gate",
  wedges: [
    {
      key: "communications_execution",
      label: "Communications execution",
      description: "Inbox triage and governed follow-up quality for the communications production wedge.",
      thresholds: buildThresholds("communications_execution", "Communications execution")
    },
    {
      key: "scheduling_execution",
      label: "Scheduling execution",
      description: "Weekly planning and governed calendar shaping quality for the scheduling production wedge.",
      thresholds: buildThresholds("scheduling_execution", "Scheduling execution")
    }
  ]
};

function isSelectedProductionWedge(bundle: GoalBundle, manifest: WedgeQualityGateManifest): boolean {
  return (
    bundle.goal.wedge.selection === "selected_production" &&
    manifest.wedges.some((candidate) => candidate.key === bundle.goal.wedge.key)
  );
}

function extractBundleExecutionModes(bundle: GoalBundle): AgentExecutionMode[] {
  return bundle.artifacts.flatMap((artifact) => {
    const candidate = artifact.metadata.executionMode;
    return isAgentExecutionMode(candidate) ? [candidate] : [];
  });
}

function matchesWedgeKey(
  bundle: GoalBundle,
  wedgeKey: SelectedProductionWedgeKey
): bundle is GoalBundle & { goal: { wedge: { key: SelectedProductionWedgeKey } } } {
  return bundle.goal.wedge.key === wedgeKey;
}

function extractRecommendationEditDistances(bundle: GoalBundle): number[] {
  return bundle.actionLogs.flatMap((log) => {
    if (log.kind !== "goal.refined") {
      return [];
    }

    const detailRecord = log.details as Record<string, unknown>;
    const sourceRecommendation =
      detailRecord.sourceRecommendation && typeof detailRecord.sourceRecommendation === "object"
        ? (detailRecord.sourceRecommendation as Record<string, unknown>)
        : null;
    const recommendationEditDistance =
      detailRecord.recommendationEditDistance && typeof detailRecord.recommendationEditDistance === "object"
        ? (detailRecord.recommendationEditDistance as Record<string, unknown>)
        : null;

    if (
      !sourceRecommendation ||
      sourceRecommendation.source !== "outcome_trace" ||
      !recommendationEditDistance ||
      typeof recommendationEditDistance.normalizedEditDistance !== "number" ||
      recommendationEditDistance.normalizedEditDistance < 0 ||
      recommendationEditDistance.normalizedEditDistance > 1
    ) {
      return [];
    }

    return [recommendationEditDistance.normalizedEditDistance];
  });
}

type ContextPackSummary = {
  reviewRequiredCount: number;
  conflictCount: number;
};

function isNonNegativeCount(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 0;
}

function extractLatestContextPackSummary(bundle: GoalBundle): ContextPackSummary | null {
  for (const log of [...bundle.actionLogs].reverse()) {
    if (!log.details || typeof log.details !== "object" || !("contextPack" in log.details)) {
      continue;
    }

    const detailRecord = log.details as Record<string, unknown>;
    const contextPack =
      detailRecord.contextPack && typeof detailRecord.contextPack === "object"
        ? (detailRecord.contextPack as Record<string, unknown>)
        : null;
    const evidenceSummary =
      contextPack?.evidenceSummary && typeof contextPack.evidenceSummary === "object"
        ? (contextPack.evidenceSummary as Record<string, unknown>)
        : null;

    if (
      !evidenceSummary ||
      !isNonNegativeCount(evidenceSummary.reviewRequiredCount) ||
      !isNonNegativeCount(evidenceSummary.conflictCount)
    ) {
      continue;
    }

    return {
      reviewRequiredCount: evidenceSummary.reviewRequiredCount,
      conflictCount: evidenceSummary.conflictCount
    };
  }

  return null;
}

export function deriveSelectedProductionWedgeSummaries(params: {
  goals: GoalBundle[];
  evidenceRecords: EvidenceRecord[];
  manifest?: WedgeQualityGateManifest;
}): WedgeQualitySummary[] {
  const manifest = params.manifest ?? defaultSelectedProductionWedgeQualityManifest;
  const selectedBundles = params.goals.filter((bundle) => isSelectedProductionWedge(bundle, manifest));

  return manifest.wedges.map((wedge) => {
    const wedgeBundles = selectedBundles.filter((bundle) => matchesWedgeKey(bundle, wedge.key));
    const goalIds = new Set(wedgeBundles.map((bundle) => bundle.goal.id));
    const feedbackRecords = params.evidenceRecords.filter(
      (record) => goalIds.has(record.goalId) && record.sourceKind === "approval_response"
    );
    const approvedRecords = feedbackRecords.filter((record) => record.decision === "approved");
    const approvedSuccessCount = approvedRecords.filter((record) => record.resultingTaskState === "completed").length;
    const postApprovalFailureCount = approvedRecords.filter(
      (record) => record.resultingTaskState === "failed" || record.resultingTaskState === "blocked"
    ).length;
    const governedSpecialistBundleCount = wedgeBundles.filter((bundle) =>
      extractBundleExecutionModes(bundle).includes("governed_specialist")
    ).length;
    const completedWorkflowCount = wedgeBundles.filter((bundle) => bundle.goal.status === "completed").length;
    const userCorrectionCount = feedbackRecords.filter((record) => record.decision === "rejected").length;
    const contextPackBundles = wedgeBundles.flatMap((bundle) => {
      const contextPack = extractLatestContextPackSummary(bundle);

      return contextPack ? [{ bundle, contextPack }] : [];
    });
    const clearContextBundles = contextPackBundles.filter(
      ({ contextPack }) => contextPack.reviewRequiredCount === 0 && contextPack.conflictCount === 0
    );
    const reviewRequiredBundles = contextPackBundles.filter(({ contextPack }) => contextPack.reviewRequiredCount > 0);
    const conflictingBundles = contextPackBundles.filter(({ contextPack }) => contextPack.conflictCount > 0);
    const clearContextCompletedCount = clearContextBundles.filter(({ bundle }) => bundle.goal.status === "completed").length;
    const reviewRequiredCompletedCount = reviewRequiredBundles.filter(
      ({ bundle }) => bundle.goal.status === "completed"
    ).length;
    const conflictingCompletedCount = conflictingBundles.filter(
      ({ bundle }) => bundle.goal.status === "completed"
    ).length;
    const averageContextReviewRequiredCount = contextPackBundles.length > 0
      ? contextPackBundles.reduce((sum, entry) => sum + entry.contextPack.reviewRequiredCount, 0) / contextPackBundles.length
      : 0;
    const averageContextConflictCount = contextPackBundles.length > 0
      ? contextPackBundles.reduce((sum, entry) => sum + entry.contextPack.conflictCount, 0) / contextPackBundles.length
      : 0;
    const recommendationEditDistances = wedgeBundles.flatMap((bundle) => extractRecommendationEditDistances(bundle));
    const averageRecommendationEditDistance = recommendationEditDistances.length > 0
      ? recommendationEditDistances.reduce((sum, distance) => sum + distance, 0) / recommendationEditDistances.length
      : 0;

    return {
      wedgeKey: wedge.key,
      wedgeLabel: wedge.label,
      workflowCount: wedgeBundles.length,
      completedWorkflowCount,
      workflowCompletionRate: rate(completedWorkflowCount, wedgeBundles.length),
      governedSpecialistBundleCount,
      governedSpecialistCoverageRate: rate(governedSpecialistBundleCount, wedgeBundles.length),
      feedbackCount: feedbackRecords.length,
      approvedDecisionCount: approvedRecords.length,
      approvedSuccessCount,
      approvalToSuccessRate: rate(approvedSuccessCount, approvedRecords.length),
      userCorrectionCount,
      correctionRate: rate(userCorrectionCount, feedbackRecords.length),
      postApprovalFailureCount,
      postApprovalFailureRate: rate(postApprovalFailureCount, approvedRecords.length),
      contextPackWorkflowCount: contextPackBundles.length,
      clearContextWorkflowCount: clearContextBundles.length,
      reviewRequiredWorkflowCount: reviewRequiredBundles.length,
      reviewRequiredWorkflowRate: rate(reviewRequiredBundles.length, contextPackBundles.length),
      conflictingWorkflowCount: conflictingBundles.length,
      conflictingWorkflowRate: rate(conflictingBundles.length, contextPackBundles.length),
      averageContextReviewRequiredCount,
      averageContextConflictCount,
      clearContextCompletionRate: rate(clearContextCompletedCount, clearContextBundles.length),
      reviewRequiredCompletionRate: rate(reviewRequiredCompletedCount, reviewRequiredBundles.length),
      conflictingContextCompletionRate: rate(conflictingCompletedCount, conflictingBundles.length),
      recommendationEditCount: recommendationEditDistances.length,
      averageRecommendationEditDistance
    };
  });
}

export function evaluateSelectedProductionWedgeQuality(params: {
  goals: GoalBundle[];
  evidenceRecords: EvidenceRecord[];
  manifest?: WedgeQualityGateManifest;
}): WedgeQualityGateEvaluation {
  const manifest = params.manifest ?? defaultSelectedProductionWedgeQualityManifest;
  const summaries = deriveSelectedProductionWedgeSummaries(params);
  const selectedBundles = params.goals.filter((bundle) => isSelectedProductionWedge(bundle, manifest));
  const results = manifest.wedges.flatMap((wedge) => {
    const summary = summaries.find((candidate) => candidate.wedgeKey === wedge.key);

    if (!summary) {
      return [];
    }

    return wedge.thresholds.map((threshold) => {
      const actual = metricActual(summary, threshold.metric);
      const sampleCount = metricSampleCount(summary, threshold.metric);
      const enoughSamples = sampleCount >= threshold.minimumSamples;
      const passed = enoughSamples ? compare(actual, threshold.operator, threshold.threshold) : false;
      const reason = enoughSamples
        ? passed
          ? null
          : `Observed ${threshold.metric} of ${actual.toFixed(2)} did not satisfy ${threshold.operator} ${threshold.threshold.toFixed(2)}.`
        : `Only ${sampleCount} sample(s) were available for ${threshold.metric}; ${threshold.minimumSamples} are required before this wedge can be treated as production-ready.`;

      return {
        wedgeKey: wedge.key,
        wedgeLabel: wedge.label,
        key: threshold.key,
        title: threshold.title,
        metric: threshold.metric,
        severity: threshold.severity,
        rolloutGate: threshold.rolloutGate,
        passed,
        actual,
        threshold: threshold.threshold,
        operator: threshold.operator,
        sampleCount,
        minimumSamples: threshold.minimumSamples,
        description: threshold.description,
        correctionAction: threshold.correctionAction,
        reason
      };
    });
  });

  return {
    passed: results.every((result) => !result.rolloutGate || result.passed),
    evaluatedWedges: manifest.wedges.length,
    evaluatedBundles: selectedBundles.length,
    summaries,
    results
  };
}
