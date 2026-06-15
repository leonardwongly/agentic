import {
  aggregateWorkflowOutcomes,
  calculateNegativeOutcomeRate,
  EpisodeRecordSchema,
  type OutcomeLink,
  type WorkflowOutcomeAggregate
} from "@agentic/self-improvement-memory";
import {
  computeWorkflowTrust,
  DEFAULT_WORKFLOW_PROMOTION_THRESHOLDS,
  recommendWorkflowPromotion
} from "@agentic/policy";

// ---------------------------------------------------------------------------
// Test fixtures
// ---------------------------------------------------------------------------

let episodeSequence = 0;

type EpisodeOptions = {
  workflowId: string;
  timestamp?: string;
  kind?: "task_plan" | "execution_path" | "approval_path";
  fallbackMode?: "normal" | "review_required" | "draft_only";
  approvalDecision?: "approved" | "rejected" | null;
  executionKind?: "not_run" | "completed" | "failed";
  userCorrection?: boolean;
  outcome?: "success" | "partial" | "failure";
  riskClass?: string | null;
};

function buildEpisode(options: EpisodeOptions) {
  episodeSequence += 1;
  const outcome = options.outcome ?? "success";
  const outcomeScore = outcome === "success" ? 1 : outcome === "partial" ? 0.2 : -1;

  return EpisodeRecordSchema.parse({
    id: `ep-${options.workflowId}-${episodeSequence}`,
    timestamp: options.timestamp ?? "2026-05-01T00:00:00.000Z",
    skill: "communications",
    task: "Aggregate a governed workflow outcome",
    outcome,
    situation: "A governed workflow produced an outcome.",
    rootCause: null,
    solution: "Recorded the outcome link for aggregation.",
    lesson: "Roll outcome signals up per workflow.",
    relatedPatternId: null,
    userFeedback: null,
    provenance: {
      ownerUserId: "user-1",
      workspaceId: "workspace-1",
      source: "execution",
      memoryIds: [],
      actionLogIds: [],
      evidenceRecordIds: [],
      recommendationKeys: []
    },
    privacy: {
      sensitivity: "internal",
      retention: { policy: "learning-outcome-365d", reviewAt: null, expiresAt: null },
      redaction: { applied: false, fields: [], rules: [], reason: null }
    },
    metadata: {},
    recommendation: {
      key: `${options.kind ?? "task_plan"}:communications:send_message:${options.riskClass ?? "R2"}:send`,
      kind: options.kind ?? "task_plan",
      agent: "communications",
      action: "send_message",
      confidence: 0.9,
      rationale: null,
      riskClass: options.riskClass === undefined ? "R2" : options.riskClass,
      capabilities: ["create"],
      sourceGoalId: "goal-1",
      sourceTaskId: "task-1",
      fallbackMode: options.fallbackMode ?? "normal",
      evidenceHint: "established"
    },
    outcomeLink: {
      goalId: "goal-1",
      workflowId: options.workflowId,
      taskId: "task-1",
      goalStatus: "completed",
      taskState: "completed",
      approvalDecision: options.approvalDecision === undefined ? "approved" : options.approvalDecision,
      executionKind: options.executionKind ?? "completed",
      outcomeScore,
      userCorrection: options.userCorrection ?? false,
      notes: null
    }
  });
}

/** A coherent, promotion-eligible aggregate that downstream tests perturb. */
function buildAggregate(overrides: Partial<WorkflowOutcomeAggregate> = {}): WorkflowOutcomeAggregate {
  return {
    workflowId: "workflow-a",
    sampleCount: 6,
    riskClass: "R2",
    firstObservedAt: "2026-05-01T00:00:00.000Z",
    lastObservedAt: "2026-05-06T00:00:00.000Z",
    draft: { total: 6, positive: 6, negative: 0, rate: 1 },
    approval: { total: 6, positive: 6, negative: 0, rate: 1 },
    execution: { total: 6, positive: 6, negative: 0, rate: 1 },
    correction: { total: 6, positive: 6, negative: 0, rate: 1 },
    recentNegativeOutcomeRate: 0,
    recentWindowSize: 5,
    ...overrides
  };
}

// ---------------------------------------------------------------------------
// Capture / aggregation
// ---------------------------------------------------------------------------

describe("aggregateWorkflowOutcomes", () => {
  it("rolls captured outcome links up per workflow across the four stages", () => {
    const episodes = [
      buildEpisode({ workflowId: "workflow-a", timestamp: "2026-05-01T00:00:00.000Z" }),
      buildEpisode({ workflowId: "workflow-a", timestamp: "2026-05-02T00:00:00.000Z" }),
      buildEpisode({ workflowId: "workflow-a", timestamp: "2026-05-03T00:00:00.000Z" }),
      // A drafted plan held back at the draft-only gate (not accepted, never ran).
      buildEpisode({
        workflowId: "workflow-a",
        timestamp: "2026-05-04T00:00:00.000Z",
        fallbackMode: "draft_only",
        approvalDecision: null,
        executionKind: "not_run",
        outcome: "partial"
      }),
      // An approved plan that failed in execution and needed a correction.
      buildEpisode({
        workflowId: "workflow-a",
        timestamp: "2026-05-05T00:00:00.000Z",
        approvalDecision: "approved",
        executionKind: "failed",
        userCorrection: true,
        outcome: "failure"
      }),
      buildEpisode({ workflowId: "workflow-b", timestamp: "2026-05-01T00:00:00.000Z" })
    ];

    const aggregates = aggregateWorkflowOutcomes(episodes);

    // Sorted by sample count desc, so the busier workflow comes first.
    expect(aggregates.map((entry) => entry.workflowId)).toEqual(["workflow-a", "workflow-b"]);

    const workflowA = aggregates[0];
    expect(workflowA.sampleCount).toBe(5);
    expect(workflowA.riskClass).toBe("R2");
    expect(workflowA.firstObservedAt).toBe("2026-05-01T00:00:00.000Z");
    expect(workflowA.lastObservedAt).toBe("2026-05-05T00:00:00.000Z");

    // Draft: 5 drafted plans, 4 accepted (1 held at draft-only).
    expect(workflowA.draft).toEqual({ total: 5, positive: 4, negative: 1, rate: 0.8 });
    // Approval: 4 approved decisions (the draft-only plan carried no decision).
    expect(workflowA.approval).toEqual({ total: 4, positive: 4, negative: 0, rate: 1 });
    // Execution: 3 completed, 1 failed (the draft-only plan never ran).
    expect(workflowA.execution).toEqual({ total: 4, positive: 3, negative: 1, rate: 0.75 });
    // Correction: 1 rework across all 5 outcomes.
    expect(workflowA.correction).toEqual({ total: 5, positive: 4, negative: 1, rate: 0.8 });
    // One negative episode out of the recent 5 -> 0.2.
    expect(workflowA.recentNegativeOutcomeRate).toBeCloseTo(0.2, 5);
    expect(workflowA.recentWindowSize).toBe(5);

    expect(aggregates[1].sampleCount).toBe(1);
  });

  it("captures the worst-case risk class observed across a workflow", () => {
    const aggregates = aggregateWorkflowOutcomes([
      buildEpisode({ workflowId: "workflow-risk", riskClass: "R1" }),
      buildEpisode({ workflowId: "workflow-risk", riskClass: "R3" }),
      buildEpisode({ workflowId: "workflow-risk", riskClass: "R2" })
    ]);

    expect(aggregates).toHaveLength(1);
    expect(aggregates[0].riskClass).toBe("R3");
  });

  it("limits the recent-negative window and reuses calculateNegativeOutcomeRate", () => {
    const olderNegatives = [
      buildEpisode({ workflowId: "wf", timestamp: "2026-05-01T00:00:00.000Z", executionKind: "failed", outcome: "failure" }),
      buildEpisode({ workflowId: "wf", timestamp: "2026-05-02T00:00:00.000Z", executionKind: "failed", outcome: "failure" }),
      buildEpisode({ workflowId: "wf", timestamp: "2026-05-03T00:00:00.000Z", executionKind: "failed", outcome: "failure" })
    ];
    const recentCleans = [
      buildEpisode({ workflowId: "wf", timestamp: "2026-05-04T00:00:00.000Z" }),
      buildEpisode({ workflowId: "wf", timestamp: "2026-05-05T00:00:00.000Z" }),
      buildEpisode({ workflowId: "wf", timestamp: "2026-05-06T00:00:00.000Z" }),
      buildEpisode({ workflowId: "wf", timestamp: "2026-05-07T00:00:00.000Z" }),
      buildEpisode({ workflowId: "wf", timestamp: "2026-05-08T00:00:00.000Z" })
    ];
    const episodes = [...olderNegatives, ...recentCleans];

    // Default window of 5 only sees the clean recent episodes.
    const defaultWindow = aggregateWorkflowOutcomes(episodes);
    expect(defaultWindow[0].sampleCount).toBe(8);
    expect(defaultWindow[0].recentNegativeOutcomeRate).toBe(0);

    // A wider window includes the older failures.
    const wideWindow = aggregateWorkflowOutcomes(episodes, { recentWindow: 8 });
    expect(wideWindow[0].recentNegativeOutcomeRate).toBeCloseTo(3 / 8, 5);

    // The exported helper is the same primitive the aggregation reuses.
    const linked = episodes as Array<ReturnType<typeof buildEpisode> & { outcomeLink: OutcomeLink }>;
    expect(calculateNegativeOutcomeRate(linked)).toBeCloseTo(3 / 8, 5);
  });

  it("ignores episodes without a workflow id", () => {
    const orphan = buildEpisode({ workflowId: "workflow-x" });
    const detached = EpisodeRecordSchema.parse({
      ...orphan,
      id: "ep-detached",
      outcomeLink: { ...orphan.outcomeLink, workflowId: null }
    });

    expect(aggregateWorkflowOutcomes([detached])).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Trust math
// ---------------------------------------------------------------------------

describe("computeWorkflowTrust", () => {
  it("scores a fully successful, well-sampled workflow as maximally trusted", () => {
    const trust = computeWorkflowTrust(buildAggregate());

    expect(trust.workflowId).toBe("workflow-a");
    expect(trust.trustScore).toBe(1);
    expect(trust.stageCoverage).toBe(3);
    expect(trust.components).toEqual({
      draftAcceptRate: 1,
      approvalApproveRate: 1,
      executionSuccessRate: 1,
      reworkRate: 0
    });
  });

  it("renormalizes stage weights so a missing stage does not penalize trust", () => {
    // Only draft and execution stages have evidence (no approval gate).
    const trust = computeWorkflowTrust(
      buildAggregate({
        approval: { total: 0, positive: 0, negative: 0, rate: 0 }
      })
    );

    expect(trust.stageCoverage).toBe(2);
    expect(trust.trustScore).toBe(1);
  });

  it("blends stage rates by weight when stages disagree", () => {
    const trust = computeWorkflowTrust(
      buildAggregate({
        draft: { total: 6, positive: 6, negative: 0, rate: 1 },
        approval: { total: 6, positive: 3, negative: 3, rate: 0.5 },
        execution: { total: 6, positive: 3, negative: 3, rate: 0.5 }
      })
    );

    // base = 0.2*1 + 0.35*0.5 + 0.45*0.5 = 0.6 (weights sum to 1).
    expect(trust.trustScore).toBeCloseTo(0.6, 5);
  });

  it("applies a correction/rework penalty", () => {
    const trust = computeWorkflowTrust(
      buildAggregate({
        correction: { total: 6, positive: 4, negative: 2, rate: 4 / 6 }
      })
    );

    // base 1 - reworkRate(0.3333)*0.5 = 0.8333.
    expect(trust.components.reworkRate).toBeCloseTo(1 / 3, 5);
    expect(trust.trustScore).toBeCloseTo(0.83333, 4);
  });

  it("shrinks trust toward zero until enough samples accumulate", () => {
    const trust = computeWorkflowTrust(buildAggregate({ sampleCount: 2 }));

    // volume weight = 2/5 = 0.4 applied to a perfect quality of 1.
    expect(trust.trustScore).toBeCloseTo(0.4, 5);
  });

  it("reports zero trust when no staged outcomes exist", () => {
    const trust = computeWorkflowTrust(
      buildAggregate({
        sampleCount: 0,
        draft: { total: 0, positive: 0, negative: 0, rate: 0 },
        approval: { total: 0, positive: 0, negative: 0, rate: 0 },
        execution: { total: 0, positive: 0, negative: 0, rate: 0 },
        correction: { total: 0, positive: 0, negative: 0, rate: 0 }
      })
    );

    expect(trust.trustScore).toBe(0);
    expect(trust.stageCoverage).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Promotion guardrails (the crux)
// ---------------------------------------------------------------------------

describe("recommendWorkflowPromotion", () => {
  it("recommends promotion when trust is high, sampled, low-risk, and sustained", () => {
    const decision = recommendWorkflowPromotion({ aggregate: buildAggregate() });

    expect(decision.recommendation).toBe("promote");
    expect(decision.guardrailsTripped).toEqual([]);
    expect(decision.trust.trustScore).toBe(1);
    expect(decision.thresholds).toEqual(DEFAULT_WORKFLOW_PROMOTION_THRESHOLDS);
    expect(decision.reasons.join(" ")).toMatch(/eligible to suggest automation/i);
  });

  it("guardrail (a): withholds promotion when the sample size is too small", () => {
    // 4 coherent samples: trips minimum sample size only (trust 0.8, execution 4, coverage 3).
    const decision = recommendWorkflowPromotion({
      aggregate: buildAggregate({
        sampleCount: 4,
        draft: { total: 4, positive: 4, negative: 0, rate: 1 },
        approval: { total: 4, positive: 4, negative: 0, rate: 1 },
        execution: { total: 4, positive: 4, negative: 0, rate: 1 },
        correction: { total: 4, positive: 4, negative: 0, rate: 1 }
      })
    });

    expect(decision.guardrailsTripped).toEqual(["minimum_sample_size"]);
    expect(decision.recommendation).toBe("not_ready");
  });

  it("guardrail (b): vetoes promotion when recent negatives are present", () => {
    const decision = recommendWorkflowPromotion({
      aggregate: buildAggregate({ recentNegativeOutcomeRate: 0.5 })
    });

    expect(decision.guardrailsTripped).toEqual(["recent_negative_outcomes"]);
    expect(decision.recommendation).toBe("hold");
  });

  it("guardrail (b): allows promotion right at the recent-negative ceiling", () => {
    const decision = recommendWorkflowPromotion({
      aggregate: buildAggregate({ recentNegativeOutcomeRate: 0.2 })
    });

    expect(decision.guardrailsTripped).toEqual([]);
    expect(decision.recommendation).toBe("promote");
  });

  it("guardrail (c): never suggests promotion for a high-risk class", () => {
    const decision = recommendWorkflowPromotion({ aggregate: buildAggregate({ riskClass: "R4" }) });

    expect(decision.guardrailsTripped).toEqual(["risk_class_ceiling"]);
    expect(decision.recommendation).toBe("not_ready");
  });

  it("guardrail (c): treats an unknown risk class as ineligible", () => {
    const decision = recommendWorkflowPromotion({ aggregate: buildAggregate({ riskClass: null }) });

    expect(decision.guardrailsTripped).toEqual(["risk_class_ceiling"]);
    expect(decision.recommendation).toBe("not_ready");
  });

  it("guardrail (d): holds when execution evidence is not sustained", () => {
    const decision = recommendWorkflowPromotion({
      aggregate: buildAggregate({ execution: { total: 2, positive: 2, negative: 0, rate: 1 } })
    });

    expect(decision.guardrailsTripped).toEqual(["sustained_trust"]);
    expect(decision.recommendation).toBe("hold");
  });

  it("guardrail (d): holds when evidence is concentrated in a single stage", () => {
    const decision = recommendWorkflowPromotion({
      aggregate: buildAggregate({
        draft: { total: 0, positive: 0, negative: 0, rate: 0 },
        approval: { total: 0, positive: 0, negative: 0, rate: 0 },
        execution: { total: 6, positive: 6, negative: 0, rate: 1 }
      })
    });

    expect(decision.trust.stageCoverage).toBe(1);
    expect(decision.guardrailsTripped).toEqual(["sustained_trust"]);
    expect(decision.recommendation).toBe("hold");
  });

  it("holds when the composite trust score is below the promotion threshold", () => {
    const decision = recommendWorkflowPromotion({
      aggregate: buildAggregate({
        draft: { total: 6, positive: 6, negative: 0, rate: 1 },
        approval: { total: 6, positive: 2, negative: 4, rate: 0.4 },
        execution: { total: 6, positive: 3, negative: 3, rate: 0.5 }
      })
    });

    // base = 0.2 + 0.14 + 0.225 = 0.565 < 0.75.
    expect(decision.guardrailsTripped).toEqual(["trust_threshold"]);
    expect(decision.recommendation).toBe("hold");
  });

  it("reports every tripped guardrail and prefers not_ready over hold", () => {
    const decision = recommendWorkflowPromotion({
      aggregate: buildAggregate({ sampleCount: 2, riskClass: "R4", recentNegativeOutcomeRate: 0.9 })
    });

    expect(decision.recommendation).toBe("not_ready");
    expect(decision.guardrailsTripped).toEqual(
      expect.arrayContaining(["risk_class_ceiling", "minimum_sample_size", "recent_negative_outcomes"])
    );
  });

  it("respects caller-provided threshold overrides", () => {
    // Loosen the risk ceiling to R4 so an R3 workflow becomes promotable.
    const decision = recommendWorkflowPromotion({
      aggregate: buildAggregate({ riskClass: "R3" }),
      options: { maxAutoPromoteRiskClass: "R4" }
    });

    expect(decision.guardrailsTripped).toEqual([]);
    expect(decision.recommendation).toBe("promote");
  });
});

// ---------------------------------------------------------------------------
// End-to-end flywheel: episodes -> aggregate -> trust -> promotion
// ---------------------------------------------------------------------------

describe("outcome-to-trust flywheel (end to end)", () => {
  it("promotes a healthy manual workflow once enough governed outcomes accumulate", () => {
    const episodes = Array.from({ length: 6 }, (_, index) =>
      buildEpisode({
        workflowId: "workflow-healthy",
        timestamp: `2026-05-${String(index + 1).padStart(2, "0")}T00:00:00.000Z`
      })
    );

    const [aggregate] = aggregateWorkflowOutcomes(episodes);
    const trust = computeWorkflowTrust(aggregate);
    const decision = recommendWorkflowPromotion({ aggregate, trust });

    expect(aggregate.sampleCount).toBe(6);
    expect(trust.trustScore).toBe(1);
    expect(decision.recommendation).toBe("promote");
  });

  it("holds a workflow whose recent outcomes turned negative", () => {
    const episodes = [
      buildEpisode({ workflowId: "workflow-regressed", timestamp: "2026-05-01T00:00:00.000Z" }),
      buildEpisode({ workflowId: "workflow-regressed", timestamp: "2026-05-02T00:00:00.000Z" }),
      buildEpisode({ workflowId: "workflow-regressed", timestamp: "2026-05-03T00:00:00.000Z" }),
      buildEpisode({ workflowId: "workflow-regressed", timestamp: "2026-05-04T00:00:00.000Z" }),
      // Two of the most recent five outcomes regressed.
      buildEpisode({
        workflowId: "workflow-regressed",
        timestamp: "2026-05-05T00:00:00.000Z",
        executionKind: "failed",
        userCorrection: true,
        outcome: "failure"
      }),
      buildEpisode({
        workflowId: "workflow-regressed",
        timestamp: "2026-05-06T00:00:00.000Z",
        executionKind: "failed",
        userCorrection: true,
        outcome: "failure"
      })
    ];

    const [aggregate] = aggregateWorkflowOutcomes(episodes);
    const decision = recommendWorkflowPromotion({ aggregate });

    expect(aggregate.recentNegativeOutcomeRate).toBeCloseTo(0.4, 5);
    expect(decision.recommendation).toBe("hold");
    expect(decision.guardrailsTripped).toContain("recent_negative_outcomes");
  });
});
