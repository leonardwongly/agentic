import { mkdtemp } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  DEFAULT_OWNER_USER_ID,
  createHumanActorContext,
  createSystemActorContext,
  type GoalBundle,
  type JobRecord
} from "@agentic/contracts";
import { createJobRecord } from "@agentic/execution";
import { buildDefaultIntegrationAccounts } from "@agentic/integrations";
import { createMemoryRecord } from "@agentic/memory";
import {
  defaultExecutionGradeWedgeScorecardManifest,
  evaluateExecutionGradeVerticalWorkflow,
  evaluateExecutionGradeWedgeScorecards,
  type ExecutionGradeWedgeFixtureEvidence
} from "@agentic/observability";
import { processUserRequest, respondToApproval } from "@agentic/orchestrator";
import { createRepository } from "@agentic/repository";
import { enqueueApprovalFollowUpJob } from "@agentic/worker-runtime";

function buildContext() {
  return {
    userId: DEFAULT_OWNER_USER_ID,
    memories: [
      createMemoryRecord({
        userId: DEFAULT_OWNER_USER_ID,
        category: "style",
        memoryType: "confirmed",
        content: "Use concise approval summaries.",
        confidence: 0.95,
        source: "test"
      })
    ],
    integrations: buildDefaultIntegrationAccounts(DEFAULT_OWNER_USER_ID)
  };
}

async function createRepositoryFixture() {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "agentic-execution-grade-wedge-"));
  const repository = createRepository({
    storePath: path.join(tempDir, "store.json")
  });
  await repository.seedDefaults(DEFAULT_OWNER_USER_ID);
  return repository;
}

async function createApprovedCommunicationsWedge() {
  const bundle = await processUserRequest({
    ...buildContext(),
    request:
      'Triage my inbox and send a client follow-up. To: client@example.com Subject: Follow-up Body: "Approved response body." Mode: send Thread-ID: thread-123'
  });
  const approval = bundle.approvals.find((candidate) => candidate.actionIntent?.type === "send_message");

  if (!approval) {
    throw new Error("Expected the communications wedge fixture to create a typed send_message approval.");
  }

  const approvedBundle = respondToApproval({
    bundle,
    approvalId: approval.id,
    decision: "approved",
    actor: createHumanActorContext(DEFAULT_OWNER_USER_ID),
    scope: "once",
    rationale: "Approved for this explicit client follow-up."
  });
  const approvedApproval = approvedBundle.approvals.find((candidate) => candidate.id === approval.id);

  if (!approvedApproval) {
    throw new Error("Expected approved communications approval to remain in the bundle.");
  }

  const repository = await createRepositoryFixture();
  await repository.saveGoalBundle(approvedBundle);
  const job = await enqueueApprovalFollowUpJob({
    repository,
    userId: DEFAULT_OWNER_USER_ID,
    approvalId: approvedApproval.id,
    goalId: approvedBundle.goal.id,
    taskId: approvedApproval.taskId,
    decision: "approved",
    workspaceId: approvedBundle.goal.workspaceId,
    actorContext: createSystemActorContext(DEFAULT_OWNER_USER_ID),
    actionIntent: approvedApproval.actionIntent
  });

  return {
    bundle,
    approvedBundle,
    approvedApproval,
    job
  };
}

function buildPrematureApprovalFollowUpJob(bundle: GoalBundle): JobRecord {
  const approval = bundle.approvals[0];

  if (!approval) {
    throw new Error("Expected fixture bundle to contain an approval.");
  }

  return createJobRecord({
    userId: DEFAULT_OWNER_USER_ID,
    kind: "approval_follow_up",
    payload: {
      type: "approval_follow_up",
      approvalId: approval.id,
      goalId: bundle.goal.id,
      taskId: approval.taskId,
      decision: "approved",
      workspaceId: bundle.goal.workspaceId,
      metadata: {
        replayedFromJobId: null,
        actionId: "approval-action:premature"
      }
    },
    actorContext: createSystemActorContext(DEFAULT_OWNER_USER_ID),
    idempotencyKey: `approval-follow-up:${approval.id}:approval-action:premature:approved`
  });
}

function buildCommunicationsScorecardEvidence(
  overrides: Partial<ExecutionGradeWedgeFixtureEvidence> = {}
): ExecutionGradeWedgeFixtureEvidence[] {
  const base: ExecutionGradeWedgeFixtureEvidence[] = [
    {
      wedgeKey: "communications_execution",
      scenario: "happy_path",
      completed: true,
      accepted: true,
      recommendationEditDistance: 0.12,
      approvalLatencyMs: 8 * 60 * 1000,
      sideEffectSafe: true,
      connectorFailureRecovered: null,
      evidenceComplete: true,
      replayEvidence: ["approval:happy", "ledger:happy"]
    },
    {
      wedgeKey: "communications_execution",
      scenario: "missing_context",
      completed: true,
      accepted: true,
      recommendationEditDistance: 0.2,
      approvalLatencyMs: 14 * 60 * 1000,
      sideEffectSafe: true,
      connectorFailureRecovered: null,
      evidenceComplete: true,
      replayEvidence: ["approval:missing-context"]
    },
    {
      wedgeKey: "communications_execution",
      scenario: "connector_outage",
      completed: true,
      accepted: true,
      recommendationEditDistance: 0.18,
      approvalLatencyMs: 12 * 60 * 1000,
      sideEffectSafe: true,
      connectorFailureRecovered: true,
      evidenceComplete: true,
      replayEvidence: ["connector:recovered", "retry:stable"]
    },
    {
      wedgeKey: "communications_execution",
      scenario: "duplicate_retry",
      completed: true,
      accepted: true,
      recommendationEditDistance: 0.16,
      approvalLatencyMs: 10 * 60 * 1000,
      sideEffectSafe: true,
      connectorFailureRecovered: null,
      evidenceComplete: true,
      replayEvidence: ["idempotency:duplicate-suppressed"]
    },
    {
      wedgeKey: "communications_execution",
      scenario: "approval_rejection",
      completed: true,
      accepted: false,
      recommendationEditDistance: 0.28,
      approvalLatencyMs: 20 * 60 * 1000,
      sideEffectSafe: true,
      connectorFailureRecovered: null,
      evidenceComplete: true,
      replayEvidence: ["approval:rejected", "side-effect:none"]
    },
    {
      wedgeKey: "communications_execution",
      scenario: "rollback",
      completed: true,
      accepted: true,
      recommendationEditDistance: 0.19,
      approvalLatencyMs: 11 * 60 * 1000,
      sideEffectSafe: true,
      connectorFailureRecovered: null,
      evidenceComplete: true,
      replayEvidence: ["rollback:documented"]
    }
  ];

  return base.map((fixture) => ({
    ...fixture,
    ...overrides,
    scenario: fixture.scenario
  }));
}

describe("execution-grade vertical wedge evaluation", () => {
  it("defines explicit communications and scheduling scorecards", () => {
    expect(defaultExecutionGradeWedgeScorecardManifest.scorecards.map((scorecard) => scorecard.wedgeKey)).toEqual([
      "communications_execution",
      "scheduling_execution"
    ]);

    for (const scorecard of defaultExecutionGradeWedgeScorecardManifest.scorecards) {
      expect(scorecard.scenarios).toEqual([
        "happy_path",
        "missing_context",
        "connector_outage",
        "duplicate_retry",
        "approval_rejection",
        "rollback"
      ]);
      expect(scorecard.metrics.map((metric) => metric.metric)).toEqual([
        "completion_criteria",
        "acceptance_rate",
        "recommendation_edit_distance",
        "approval_latency",
        "side_effect_safety",
        "connector_failure_recovery",
        "evidence_completeness",
        "replay_evidence"
      ]);
    }
  });

  it("uses fixture evidence to select communications as the primary implementation wedge", () => {
    const evaluation = evaluateExecutionGradeWedgeScorecards({
      evidence: buildCommunicationsScorecardEvidence()
    });
    const communicationsResults = evaluation.results.filter((result) => result.wedgeKey === "communications_execution");
    const schedulingResults = evaluation.results.filter((result) => result.wedgeKey === "scheduling_execution");

    expect(evaluation.passed).toBe(false);
    expect(evaluation.autonomyPromotionAllowed).toBe(false);
    expect(evaluation.selectedPrimaryWedge).toBe("communications_execution");
    expect(evaluation.readiness).toMatchObject({
      dashboardStatus: "blocked",
      autonomyPromotionBlockedReason: "completion_criteria has 0 sample(s); 3 required for execution-grade evidence."
    });
    expect(evaluation.readiness.capabilityReadinessEvidence).toContain(
      "communications_execution: scenarios=6; replayEvidence=9; evidenceComplete=1.00"
    );
    expect(communicationsResults.every((result) => result.passed)).toBe(true);
    expect(schedulingResults.every((result) => result.passed)).toBe(false);
    expect(
      evaluation.summaries.find((summary) => summary.wedgeKey === "communications_execution")
    ).toMatchObject({
      scenarioCount: 6,
      acceptanceRate: 5 / 6,
      connectorFailureRecoveryRate: 1,
      evidenceCompletenessRate: 1
    });
  });

  it("blocks rollout and autonomy when scorecard evidence is incomplete or unsafe", () => {
    const evidence = buildCommunicationsScorecardEvidence({
      completed: false,
      accepted: false,
      recommendationEditDistance: 0.72,
      approvalLatencyMs: 90 * 60 * 1000,
      sideEffectSafe: false,
      connectorFailureRecovered: false,
      evidenceComplete: false,
      replayEvidence: []
    });
    const evaluation = evaluateExecutionGradeWedgeScorecards({ evidence });

    expect(evaluation.selectedPrimaryWedge).toBeNull();
    expect(evaluation.results.filter((result) => result.rolloutGate).every((result) => result.passed)).toBe(false);
    expect(evaluation.results.find((result) => result.key === "communications_execution.side_effect_safety")).toMatchObject({
      passed: false,
      actual: 0,
      reason: "side_effect_safety observed 0.00 but requires >= 1.00."
    });
    expect(evaluation.results.find((result) => result.key === "communications_execution.replay_evidence")).toMatchObject({
      passed: false,
      actual: 0
    });
  });

  it("passes when a selected wedge has governed specialist output, blast-radius previews, and an idempotent follow-up job", async () => {
    const { approvedBundle, job } = await createApprovedCommunicationsWedge();

    const evaluation = evaluateExecutionGradeVerticalWorkflow({
      bundle: approvedBundle,
      jobs: [job]
    });

    expect(evaluation).toMatchObject({
      passed: true,
      wedgeKey: "communications_execution"
    });
    expect(evaluation.gates.every((gate) => gate.passed)).toBe(true);
    expect(evaluation.gates.find((gate) => gate.key === "worker_job_idempotency")?.evidence).toMatchObject({
      respondedApprovalCount: 1,
      respondedApprovalsWithIdempotentJobs: 1
    });
  });

  it("fails closed when approval previews omit blast-radius evidence", async () => {
    const { approvedBundle, approvedApproval, job } = await createApprovedCommunicationsWedge();
    const bundleMissingBlastRadius = {
      ...approvedBundle,
      approvals: approvedBundle.approvals.map((approval) =>
        approval.id === approvedApproval.id
          ? {
              ...approval,
              preview: {
                ...approval.preview,
                impact: {
                  ...approval.preview.impact,
                  affectedSystems: []
                }
              }
            }
          : approval
      )
    };

    const evaluation = evaluateExecutionGradeVerticalWorkflow({
      bundle: bundleMissingBlastRadius,
      jobs: [job]
    });

    expect(evaluation.passed).toBe(false);
    expect(evaluation.gates.find((gate) => gate.key === "approval_preview_blast_radius")).toMatchObject({
      passed: false
    });
  });

  it("flags worker jobs queued before an operator approval decision", async () => {
    const { bundle } = await createApprovedCommunicationsWedge();
    const prematureJob = buildPrematureApprovalFollowUpJob(bundle);

    const evaluation = evaluateExecutionGradeVerticalWorkflow({
      bundle,
      jobs: [prematureJob]
    });

    expect(evaluation.passed).toBe(false);
    expect(evaluation.gates.find((gate) => gate.key === "no_side_effect_before_approval")).toMatchObject({
      passed: false,
      evidence: {
        pendingApprovalsWithFollowUpJobs: [bundle.approvals[0]?.id]
      }
    });
  });

  it("rejects approval follow-up evidence without stable idempotency and action ids", async () => {
    const { approvedBundle, approvedApproval } = await createApprovedCommunicationsWedge();
    const jobWithoutIdempotency = createJobRecord({
      userId: DEFAULT_OWNER_USER_ID,
      kind: "approval_follow_up",
      payload: {
        type: "approval_follow_up",
        approvalId: approvedApproval.id,
        goalId: approvedBundle.goal.id,
        taskId: approvedApproval.taskId,
        decision: "approved",
        workspaceId: approvedBundle.goal.workspaceId,
        metadata: {
          replayedFromJobId: null,
          actionId: null
        }
      },
      actorContext: createSystemActorContext(DEFAULT_OWNER_USER_ID),
      idempotencyKey: null
    });

    const evaluation = evaluateExecutionGradeVerticalWorkflow({
      bundle: approvedBundle,
      jobs: [jobWithoutIdempotency]
    });

    expect(evaluation.passed).toBe(false);
    expect(evaluation.gates.find((gate) => gate.key === "worker_job_idempotency")).toMatchObject({
      passed: false,
      evidence: {
        respondedApprovalCount: 1,
        respondedApprovalsWithIdempotentJobs: 0
      }
    });
  });
});
