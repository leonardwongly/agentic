import type { ApprovalRequest, GoalBundle, JobRecord } from "@agentic/contracts";
import type { RolloutAlertOperator } from "./rollout-gates";
import { selectedProductionWedgeKeys, type SelectedProductionWedgeKey } from "./wedge-quality-gates";

export type ExecutionGradeVerticalGateKey =
  | "selected_wedge_contract"
  | "specialist_runner_contract"
  | "approval_preview_blast_radius"
  | "worker_job_idempotency"
  | "no_side_effect_before_approval";

export type ExecutionGradeVerticalGate = {
  key: ExecutionGradeVerticalGateKey;
  passed: boolean;
  summary: string;
  evidence: Record<string, unknown>;
};

export type ExecutionGradeVerticalWorkflowEvaluation = {
  passed: boolean;
  wedgeKey: SelectedProductionWedgeKey | null;
  gates: ExecutionGradeVerticalGate[];
};

export type ExecutionGradeWedgeScenario =
  | "happy_path"
  | "missing_context"
  | "connector_outage"
  | "duplicate_retry"
  | "approval_rejection"
  | "rollback";

export type ExecutionGradeWedgeScorecardMetricKey =
  | "completion_criteria"
  | "acceptance_rate"
  | "recommendation_edit_distance"
  | "approval_latency"
  | "side_effect_safety"
  | "connector_failure_recovery"
  | "evidence_completeness"
  | "replay_evidence";

export type ExecutionGradeWedgeScorecardMetric = {
  key: string;
  title: string;
  metric: ExecutionGradeWedgeScorecardMetricKey;
  operator: RolloutAlertOperator;
  threshold: number;
  minimumSamples: number;
  rolloutGate: boolean;
  autonomyGate: boolean;
  description: string;
  correctionAction: string;
};

export type ExecutionGradeWedgeScorecardDefinition = {
  wedgeKey: SelectedProductionWedgeKey;
  wedgeLabel: string;
  primaryCandidate: boolean;
  scenarios: readonly ExecutionGradeWedgeScenario[];
  metrics: readonly ExecutionGradeWedgeScorecardMetric[];
};

export type ExecutionGradeWedgeScorecardManifest = {
  version: 1;
  name: string;
  scorecards: readonly ExecutionGradeWedgeScorecardDefinition[];
};

export type ExecutionGradeWedgeFixtureEvidence = {
  wedgeKey: SelectedProductionWedgeKey;
  scenario: ExecutionGradeWedgeScenario;
  completed: boolean;
  accepted: boolean;
  recommendationEditDistance: number | null;
  approvalLatencyMs: number | null;
  sideEffectSafe: boolean;
  connectorFailureRecovered: boolean | null;
  evidenceComplete: boolean;
  replayEvidence: readonly string[];
};

export type ExecutionGradeWedgeScorecardSummary = {
  wedgeKey: SelectedProductionWedgeKey;
  wedgeLabel: string;
  scenarioCount: number;
  coveredScenarios: readonly ExecutionGradeWedgeScenario[];
  completionCriteriaRate: number;
  acceptanceRate: number;
  averageRecommendationEditDistance: number;
  averageApprovalLatencyMs: number;
  sideEffectSafetyRate: number;
  connectorFailureRecoveryRate: number;
  evidenceCompletenessRate: number;
  replayEvidenceCount: number;
};

export type ExecutionGradeWedgeScorecardResult = {
  wedgeKey: SelectedProductionWedgeKey;
  wedgeLabel: string;
  key: string;
  title: string;
  metric: ExecutionGradeWedgeScorecardMetricKey;
  passed: boolean;
  actual: number;
  threshold: number;
  operator: RolloutAlertOperator;
  sampleCount: number;
  minimumSamples: number;
  rolloutGate: boolean;
  autonomyGate: boolean;
  reason: string | null;
  description: string;
  correctionAction: string;
};

export type ExecutionGradeWedgeScorecardEvaluation = {
  passed: boolean;
  autonomyPromotionAllowed: boolean;
  selectedPrimaryWedge: SelectedProductionWedgeKey | null;
  readiness: {
    dashboardStatus: "ready" | "blocked";
    capabilityReadinessEvidence: readonly string[];
    autonomyPromotionBlockedReason: string | null;
  };
  summaries: readonly ExecutionGradeWedgeScorecardSummary[];
  results: readonly ExecutionGradeWedgeScorecardResult[];
};

function buildScorecardMetrics(
  wedgeKey: SelectedProductionWedgeKey,
  wedgeLabel: string
): ExecutionGradeWedgeScorecardMetric[] {
  return [
    {
      key: `${wedgeKey}.completion_criteria`,
      title: `${wedgeLabel} completion criteria`,
      metric: "completion_criteria",
      operator: ">=",
      threshold: 0.8,
      minimumSamples: 3,
      rolloutGate: true,
      autonomyGate: true,
      description: "Fixture runs must meet the wedge-specific done definition instead of only exercising control-plane scaffolding.",
      correctionAction: "Tighten the wedge plan, fixtures, or specialist output until happy-path and degraded scenarios finish with concrete evidence."
    },
    {
      key: `${wedgeKey}.acceptance_rate`,
      title: `${wedgeLabel} approval acceptance`,
      metric: "acceptance_rate",
      operator: ">=",
      threshold: 0.75,
      minimumSamples: 2,
      rolloutGate: true,
      autonomyGate: true,
      description: "Operators should accept most generated previews once the wedge has enough context.",
      correctionAction: "Review rejected previews, classify edit reasons, and improve draft quality before expanding the wedge."
    },
    {
      key: `${wedgeKey}.recommendation_edit_distance`,
      title: `${wedgeLabel} edit distance`,
      metric: "recommendation_edit_distance",
      operator: "<=",
      threshold: 0.35,
      minimumSamples: 2,
      rolloutGate: false,
      autonomyGate: true,
      description: "Recommended outputs should need limited operator rewriting before approval.",
      correctionAction: "Compare operator edits to generated output and adjust prompts, context retrieval, or task decomposition."
    },
    {
      key: `${wedgeKey}.approval_latency`,
      title: `${wedgeLabel} approval latency`,
      metric: "approval_latency",
      operator: "<=",
      threshold: 30 * 60 * 1000,
      minimumSamples: 2,
      rolloutGate: false,
      autonomyGate: false,
      description: "Approval decisions should be fast enough to indicate that previews are actionable.",
      correctionAction: "Reduce ambiguity in previews and move missing context into the fixture before treating latency as a product issue."
    },
    {
      key: `${wedgeKey}.side_effect_safety`,
      title: `${wedgeLabel} side-effect safety`,
      metric: "side_effect_safety",
      operator: ">=",
      threshold: 1,
      minimumSamples: 3,
      rolloutGate: true,
      autonomyGate: true,
      description: "External sends and calendar mutations must remain behind approval, idempotency, and side-effect ledger safeguards.",
      correctionAction: "Treat any unsafe side-effect fixture as a release blocker until approval and replay boundaries are repaired."
    },
    {
      key: `${wedgeKey}.connector_failure_recovery`,
      title: `${wedgeLabel} connector recovery`,
      metric: "connector_failure_recovery",
      operator: ">=",
      threshold: 1,
      minimumSamples: 1,
      rolloutGate: true,
      autonomyGate: true,
      description: "Connector outage fixtures must recover or fail closed with retry and operator evidence.",
      correctionAction: "Repair connector readiness, retry, or recovery evidence before promoting the wedge."
    },
    {
      key: `${wedgeKey}.evidence_completeness`,
      title: `${wedgeLabel} evidence completeness`,
      metric: "evidence_completeness",
      operator: ">=",
      threshold: 1,
      minimumSamples: 3,
      rolloutGate: true,
      autonomyGate: true,
      description: "Each fixture must leave enough evidence for release, dashboard, and capability-readiness decisions.",
      correctionAction: "Attach missing approval, replay, side-effect, or rollback evidence before counting the fixture."
    },
    {
      key: `${wedgeKey}.replay_evidence`,
      title: `${wedgeLabel} replay evidence`,
      metric: "replay_evidence",
      operator: ">=",
      threshold: 1,
      minimumSamples: 3,
      rolloutGate: false,
      autonomyGate: true,
      description: "Autonomy promotion requires replay evidence for fixture-backed wedge behavior.",
      correctionAction: "Attach replay evidence to every scored fixture before using the scorecard for autonomy decisions."
    }
  ];
}

export const defaultExecutionGradeWedgeScorecardManifest: ExecutionGradeWedgeScorecardManifest = {
  version: 1,
  name: "execution-grade communications and scheduling wedge scorecards",
  scorecards: [
    {
      wedgeKey: "communications_execution",
      wedgeLabel: "Communications execution",
      primaryCandidate: true,
      scenarios: ["happy_path", "missing_context", "connector_outage", "duplicate_retry", "approval_rejection", "rollback"],
      metrics: buildScorecardMetrics("communications_execution", "Communications execution")
    },
    {
      wedgeKey: "scheduling_execution",
      wedgeLabel: "Scheduling execution",
      primaryCandidate: false,
      scenarios: ["happy_path", "missing_context", "connector_outage", "duplicate_retry", "approval_rejection", "rollback"],
      metrics: buildScorecardMetrics("scheduling_execution", "Scheduling execution")
    }
  ]
};

function isSelectedProductionWedgeKey(value: string): value is SelectedProductionWedgeKey {
  return selectedProductionWedgeKeys.includes(value as SelectedProductionWedgeKey);
}

function approvalFollowUpJobsFor(approval: ApprovalRequest, jobs: JobRecord[]) {
  return jobs.filter(
    (job) => job.payload.type === "approval_follow_up" && job.payload.approvalId === approval.id
  );
}

function approvalHasBlastRadiusEvidence(approval: ApprovalRequest): boolean {
  return (
    approval.preview.summary.trim().length > 0 &&
    approval.preview.target.trim().length > 0 &&
    approval.preview.changes.length > 0 &&
    approval.preview.impact.permissions.length > 0 &&
    approval.preview.impact.affectedSystems.length > 0
  );
}

function approvalJobHasIdempotencyEvidence(job: JobRecord): boolean {
  if (job.payload.type !== "approval_follow_up") {
    return false;
  }

  return Boolean(job.idempotencyKey?.trim() && job.payload.metadata.actionId?.trim());
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

function average(values: number[]): number {
  if (values.length === 0) {
    return 0;
  }

  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function metricValue(
  summary: ExecutionGradeWedgeScorecardSummary,
  metric: ExecutionGradeWedgeScorecardMetricKey
): number {
  switch (metric) {
    case "completion_criteria":
      return summary.completionCriteriaRate;
    case "acceptance_rate":
      return summary.acceptanceRate;
    case "recommendation_edit_distance":
      return summary.averageRecommendationEditDistance;
    case "approval_latency":
      return summary.averageApprovalLatencyMs;
    case "side_effect_safety":
      return summary.sideEffectSafetyRate;
    case "connector_failure_recovery":
      return summary.connectorFailureRecoveryRate;
    case "evidence_completeness":
      return summary.evidenceCompletenessRate;
    case "replay_evidence":
      return rate(summary.replayEvidenceCount, summary.scenarioCount);
  }
}

function metricSampleCount(
  evidence: readonly ExecutionGradeWedgeFixtureEvidence[],
  metric: ExecutionGradeWedgeScorecardMetricKey
): number {
  switch (metric) {
    case "completion_criteria":
    case "acceptance_rate":
    case "side_effect_safety":
    case "evidence_completeness":
      return evidence.length;
    case "recommendation_edit_distance":
      return evidence.filter((fixture) => fixture.recommendationEditDistance !== null).length;
    case "approval_latency":
      return evidence.filter((fixture) => fixture.approvalLatencyMs !== null).length;
    case "connector_failure_recovery":
      return evidence.filter((fixture) => fixture.scenario === "connector_outage").length;
    case "replay_evidence":
      return evidence.filter((fixture) => fixture.replayEvidence.length > 0).length;
  }
}

function buildScorecardSummary(
  scorecard: ExecutionGradeWedgeScorecardDefinition,
  evidence: readonly ExecutionGradeWedgeFixtureEvidence[]
): ExecutionGradeWedgeScorecardSummary {
  const connectorOutageEvidence = evidence.filter((fixture) => fixture.scenario === "connector_outage");
  const editDistances = evidence.flatMap((fixture) =>
    fixture.recommendationEditDistance === null ? [] : [fixture.recommendationEditDistance]
  );
  const approvalLatencies = evidence.flatMap((fixture) =>
    fixture.approvalLatencyMs === null ? [] : [fixture.approvalLatencyMs]
  );

  return {
    wedgeKey: scorecard.wedgeKey,
    wedgeLabel: scorecard.wedgeLabel,
    scenarioCount: evidence.length,
    coveredScenarios: Array.from(new Set(evidence.map((fixture) => fixture.scenario))).sort(),
    completionCriteriaRate: rate(evidence.filter((fixture) => fixture.completed).length, evidence.length),
    acceptanceRate: rate(evidence.filter((fixture) => fixture.accepted).length, evidence.length),
    averageRecommendationEditDistance: average(editDistances),
    averageApprovalLatencyMs: average(approvalLatencies),
    sideEffectSafetyRate: rate(evidence.filter((fixture) => fixture.sideEffectSafe).length, evidence.length),
    connectorFailureRecoveryRate: rate(
      connectorOutageEvidence.filter((fixture) => fixture.connectorFailureRecovered === true).length,
      connectorOutageEvidence.length
    ),
    evidenceCompletenessRate: rate(evidence.filter((fixture) => fixture.evidenceComplete).length, evidence.length),
    replayEvidenceCount: evidence.reduce((count, fixture) => count + fixture.replayEvidence.length, 0)
  };
}

function selectPrimaryWedge(
  manifest: ExecutionGradeWedgeScorecardManifest,
  summaries: readonly ExecutionGradeWedgeScorecardSummary[],
  results: readonly ExecutionGradeWedgeScorecardResult[]
): SelectedProductionWedgeKey | null {
  const passingWedges = manifest.scorecards.filter((scorecard) =>
    results
      .filter((result) => result.wedgeKey === scorecard.wedgeKey && result.rolloutGate)
      .every((result) => result.passed)
  );

  if (passingWedges.length === 0) {
    return null;
  }

  const primary = passingWedges.find((scorecard) => scorecard.primaryCandidate) ?? passingWedges[0];
  const summary = summaries.find((candidate) => candidate.wedgeKey === primary?.wedgeKey);

  return summary && summary.scenarioCount > 0 ? summary.wedgeKey : null;
}

export function evaluateExecutionGradeWedgeScorecards(params: {
  evidence: readonly ExecutionGradeWedgeFixtureEvidence[];
  manifest?: ExecutionGradeWedgeScorecardManifest;
}): ExecutionGradeWedgeScorecardEvaluation {
  const manifest = params.manifest ?? defaultExecutionGradeWedgeScorecardManifest;
  const summaries = manifest.scorecards.map((scorecard) =>
    buildScorecardSummary(
      scorecard,
      params.evidence.filter((fixture) => fixture.wedgeKey === scorecard.wedgeKey)
    )
  );
  const results = manifest.scorecards.flatMap((scorecard) => {
    const scorecardEvidence = params.evidence.filter((fixture) => fixture.wedgeKey === scorecard.wedgeKey);
    const summary = summaries.find((candidate) => candidate.wedgeKey === scorecard.wedgeKey);

    if (!summary) {
      return [];
    }

    return scorecard.metrics.map((metric): ExecutionGradeWedgeScorecardResult => {
      const actual = metricValue(summary, metric.metric);
      const sampleCount = metricSampleCount(scorecardEvidence, metric.metric);
      const enoughSamples = sampleCount >= metric.minimumSamples;
      const passed = enoughSamples ? compare(actual, metric.operator, metric.threshold) : false;
      const reason = enoughSamples
        ? passed
          ? null
          : `${metric.metric} observed ${actual.toFixed(2)} but requires ${metric.operator} ${metric.threshold.toFixed(2)}.`
        : `${metric.metric} has ${sampleCount} sample(s); ${metric.minimumSamples} required for execution-grade evidence.`;

      return {
        wedgeKey: scorecard.wedgeKey,
        wedgeLabel: scorecard.wedgeLabel,
        key: metric.key,
        title: metric.title,
        metric: metric.metric,
        passed,
        actual,
        threshold: metric.threshold,
        operator: metric.operator,
        sampleCount,
        minimumSamples: metric.minimumSamples,
        rolloutGate: metric.rolloutGate,
        autonomyGate: metric.autonomyGate,
        reason,
        description: metric.description,
        correctionAction: metric.correctionAction
      };
    });
  });
  const rolloutResults = results.filter((result) => result.rolloutGate);
  const autonomyResults = results.filter((result) => result.autonomyGate);
  const failedAutonomyResults = autonomyResults.filter((result) => !result.passed);
  const passed = rolloutResults.length > 0 && rolloutResults.every((result) => result.passed);
  const autonomyPromotionAllowed = autonomyResults.length > 0 && failedAutonomyResults.length === 0;

  return {
    passed,
    autonomyPromotionAllowed,
    selectedPrimaryWedge: selectPrimaryWedge(manifest, summaries, results),
    readiness: {
      dashboardStatus: passed ? "ready" : "blocked",
      capabilityReadinessEvidence: summaries.map(
        (summary) =>
          `${summary.wedgeKey}: scenarios=${summary.scenarioCount}; replayEvidence=${summary.replayEvidenceCount}; evidenceComplete=${summary.evidenceCompletenessRate.toFixed(2)}`
      ),
      autonomyPromotionBlockedReason: autonomyPromotionAllowed
        ? null
        : failedAutonomyResults[0]?.reason ?? "Scorecard and replay evidence are required before autonomy promotion."
    },
    summaries,
    results
  };
}

export function evaluateExecutionGradeVerticalWorkflow(params: {
  bundle: GoalBundle;
  jobs?: JobRecord[];
}): ExecutionGradeVerticalWorkflowEvaluation {
  const jobs = params.jobs ?? [];
  const wedgeKey = isSelectedProductionWedgeKey(params.bundle.goal.wedge.key)
    ? params.bundle.goal.wedge.key
    : null;
  const governedSpecialistArtifacts = params.bundle.artifacts.filter(
    (artifact) =>
      artifact.metadata.executionMode === "governed_specialist" &&
      artifact.metadata.implementationTier === "production"
  );
  const selectedWedgeContractPassed =
    Boolean(wedgeKey) &&
    params.bundle.goal.wedge.selection === "selected_production" &&
    params.bundle.goal.completionContract.successCriteria.length > 0 &&
    params.bundle.goal.completionContract.evidenceSignals.length > 0;
  const approvalPreviewBlastRadiusPassed =
    params.bundle.approvals.length > 0 && params.bundle.approvals.every(approvalHasBlastRadiusEvidence);
  const respondedApprovals = params.bundle.approvals.filter((approval) => approval.decision !== "pending");
  const pendingApprovalsWithFollowUpJobs = params.bundle.approvals.filter(
    (approval) => approval.decision === "pending" && approvalFollowUpJobsFor(approval, jobs).length > 0
  );
  const respondedApprovalsWithIdempotentJobs = respondedApprovals.filter((approval) =>
    approvalFollowUpJobsFor(approval, jobs).some(approvalJobHasIdempotencyEvidence)
  );
  const workerJobIdempotencyPassed =
    respondedApprovals.length > 0 && respondedApprovalsWithIdempotentJobs.length === respondedApprovals.length;

  const gates: ExecutionGradeVerticalGate[] = [
    {
      key: "selected_wedge_contract",
      passed: selectedWedgeContractPassed,
      summary: selectedWedgeContractPassed
        ? "The goal is one of the selected production wedges and carries a measurable completion contract."
        : "The goal is not yet backed by a selected production wedge contract with success criteria and evidence signals.",
      evidence: {
        wedgeKey: params.bundle.goal.wedge.key,
        selection: params.bundle.goal.wedge.selection,
        successCriteria: params.bundle.goal.completionContract.successCriteria.length,
        evidenceSignals: params.bundle.goal.completionContract.evidenceSignals.length
      }
    },
    {
      key: "specialist_runner_contract",
      passed: governedSpecialistArtifacts.length > 0,
      summary: governedSpecialistArtifacts.length > 0
        ? "At least one artifact was produced by a production governed-specialist runner."
        : "The workflow has not produced governed-specialist production output.",
      evidence: {
        governedSpecialistArtifactCount: governedSpecialistArtifacts.length
      }
    },
    {
      key: "approval_preview_blast_radius",
      passed: approvalPreviewBlastRadiusPassed,
      summary: approvalPreviewBlastRadiusPassed
        ? "Every approval preview includes operator-visible blast-radius evidence."
        : "One or more approvals are missing summary, target, changes, permissions, or affected-system evidence.",
      evidence: {
        approvalCount: params.bundle.approvals.length,
        approvalsWithBlastRadiusEvidence: params.bundle.approvals.filter(approvalHasBlastRadiusEvidence).length
      }
    },
    {
      key: "worker_job_idempotency",
      passed: workerJobIdempotencyPassed,
      summary: workerJobIdempotencyPassed
        ? "Every responded approval has a matching idempotent worker follow-up job."
        : "Responded approvals must be connected to durable follow-up jobs with stable idempotency and action ids.",
      evidence: {
        respondedApprovalCount: respondedApprovals.length,
        respondedApprovalsWithIdempotentJobs: respondedApprovalsWithIdempotentJobs.length
      }
    },
    {
      key: "no_side_effect_before_approval",
      passed: pendingApprovalsWithFollowUpJobs.length === 0,
      summary: pendingApprovalsWithFollowUpJobs.length === 0
        ? "No approval follow-up jobs were queued before an operator decision."
        : "Pending approvals must not have side-effect worker follow-up jobs.",
      evidence: {
        pendingApprovalsWithFollowUpJobs: pendingApprovalsWithFollowUpJobs.map((approval) => approval.id)
      }
    }
  ];

  return {
    passed: gates.every((gate) => gate.passed),
    wedgeKey,
    gates
  };
}
