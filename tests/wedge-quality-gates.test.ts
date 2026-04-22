import { SYSTEM_USER_ID, type ApprovalRequest, type EvidenceRecord, type GoalBundle } from "@agentic/contracts";
import { buildDefaultIntegrationAccounts } from "@agentic/integrations";
import { createMemoryRecord } from "@agentic/memory";
import { createActionLog } from "@agentic/observability";
import { processUserRequest } from "@agentic/orchestrator";
import {
  defaultSelectedProductionWedgeQualityManifest,
  deriveSelectedProductionWedgeSummaries,
  evaluateSelectedProductionWedgeQuality
} from "../packages/observability/src/wedge-quality-gates";

function buildContext() {
  return {
    userId: SYSTEM_USER_ID,
    memories: [
      createMemoryRecord({
        userId: SYSTEM_USER_ID,
        category: "style",
        memoryType: "confirmed",
        content: "Use concise approval summaries.",
        confidence: 0.95,
        source: "test"
      })
    ],
    integrations: buildDefaultIntegrationAccounts(SYSTEM_USER_ID)
  };
}

async function createBundle(request: string): Promise<GoalBundle> {
  return processUserRequest({
    ...buildContext(),
    request
  });
}

function finalizeBundle(bundle: GoalBundle, goalId: string, status: GoalBundle["goal"]["status"], specialistCoverage = true): GoalBundle {
  return {
    ...bundle,
    goal: {
      ...bundle.goal,
      id: goalId,
      status
    },
    workflow: {
      ...bundle.workflow,
      goalId
    },
    tasks: bundle.tasks.map((task) => ({
      ...task,
      state: status === "completed" ? "completed" : task.state
    })),
    artifacts: bundle.artifacts.map((artifact) => ({
      ...artifact,
      goalId,
      metadata:
        specialistCoverage || artifact.metadata.agent === "workflow"
          ? artifact.metadata
          : {
              ...artifact.metadata,
              executionMode: "deterministic_scaffold"
            }
    })),
    approvals: bundle.approvals.map((approval) => ({
      ...approval,
      goalId
    })),
    actionLogs: bundle.actionLogs.map((log) => ({
      ...log,
      goalId
    })),
    watchers: bundle.watchers.map((watcher) => ({
      ...watcher,
      goalId
    }))
  };
}

function attachRecommendationEdit(bundle: GoalBundle, normalizedEditDistance: number): GoalBundle {
  return {
    ...bundle,
    actionLogs: [
      ...bundle.actionLogs,
      createActionLog({
        goalId: bundle.goal.id,
        workflowId: bundle.workflow.id,
        actor: "operator",
        kind: "goal.refined",
        message: "Applied recommendation-guided refinement.",
        details: {
          sourceRecommendation: {
            key: "execution_path:communications:send_message:R3:send",
            source: "outcome_trace"
          },
          recommendationEditDistance: {
            baselineLength: 20,
            submittedLength: 20,
            editDistance: Math.round(normalizedEditDistance * 20),
            normalizedEditDistance
          }
        },
        prevLog: bundle.actionLogs.at(-1) ?? null
      })
    ]
  };
}

function attachContextPackSummary(bundle: GoalBundle, params: { reviewRequiredCount: number; conflictCount: number }): GoalBundle {
  return {
    ...bundle,
    actionLogs: [
      ...bundle.actionLogs,
      createActionLog({
        goalId: bundle.goal.id,
        workflowId: bundle.workflow.id,
        actor: "orchestrator",
        kind: "context.resolved",
        message: "Measured workflow context quality for the selected wedge.",
        details: {
          contextPack: {
            kind: "goal_planning",
            query: bundle.goal.request,
            selectedMemoryIds: [],
            staleMemoryIds: [],
            conflictingMemoryIds: params.conflictCount > 0 ? ["memory-conflict-1"] : [],
            reviewRequiredMemoryIds:
              params.reviewRequiredCount > 0
                ? Array.from({ length: params.reviewRequiredCount }, (_value, index) => `memory-review-${index + 1}`)
                : [],
            conflicts:
              params.conflictCount > 0
                ? [
                    {
                      category: "preference",
                      subject: "approval-style",
                      memoryIds: ["memory-conflict-1", "memory-conflict-2"],
                      primaryMemoryId: "memory-conflict-1",
                      conflictingMemoryIds: ["memory-conflict-2"],
                      reason: "Conflicting operator preferences were preserved for review."
                    }
                  ]
                : [],
            evidenceSummary: {
              selectedCount: 0,
              confirmedCount: 0,
              observedCount: 0,
              inferredCount: 0,
              freshCount: 0,
              reviewDueCount: 0,
              lowConfidenceCount: 0,
              expiredCount: 0,
              reviewRequiredCount: params.reviewRequiredCount,
              conflictCount: params.conflictCount
            }
          }
        },
        prevLog: bundle.actionLogs.at(-1) ?? null
      })
    ]
  };
}

function attachMalformedContextPackSummary(bundle: GoalBundle): GoalBundle {
  return {
    ...bundle,
    actionLogs: [
      ...bundle.actionLogs,
      createActionLog({
        goalId: bundle.goal.id,
        workflowId: bundle.workflow.id,
        actor: "orchestrator",
        kind: "context.resolved",
        message: "Encountered malformed context-pack telemetry.",
        details: {
          contextPack: {
            evidenceSummary: {
              reviewRequiredCount: "invalid",
              conflictCount: -1
            }
          }
        },
        prevLog: bundle.actionLogs.at(-1) ?? null
      })
    ]
  };
}

function buildEvidenceRecord(params: {
  bundle: GoalBundle;
  approval: ApprovalRequest;
  id: string;
  decision: EvidenceRecord["decision"];
  resultingTaskState: EvidenceRecord["resultingTaskState"];
}): EvidenceRecord {
  const createdAt = new Date("2026-04-20T00:00:00.000Z").toISOString();
  const updatedAt = new Date("2026-04-20T00:05:00.000Z").toISOString();

  return {
    id: params.id,
    userId: SYSTEM_USER_ID,
    goalId: params.bundle.goal.id,
    taskId: params.approval.taskId,
    approvalId: params.approval.id,
    sourceKind: "approval_response",
    sourceId: params.approval.id,
    sourceSummary: `${params.bundle.goal.wedge.label} evidence`,
    riskClass: params.approval.riskClass,
    requestedAction: params.approval.requestedAction,
    requestRationale: params.approval.rationale,
    requiresApproval: true,
    decision: params.decision,
    decisionScope: params.decision === "approved" ? "similar_24h" : "once",
    decisionRationale: params.decision === "approved" ? "Safe after review." : "Needs manual revision.",
    respondedAt: updatedAt,
    resultingTaskState: params.resultingTaskState,
    resultingGoalStatus: params.bundle.goal.status,
    actionLogIds: [],
    artifactIds: [],
    memoryIds: [],
    createdAt,
    updatedAt
  };
}

describe("selected production wedge quality gates", () => {
  it("passes when both selected wedges meet completion, coverage, and correction thresholds", async () => {
    const communicationsBase = await createBundle("Triage my inbox and prepare replies for important clients.");
    const schedulingBase = await createBundle("Plan my week around focus time, deadlines, and meetings.");
    const supportingBase = await createBundle("Help me prepare for my upcoming travel itinerary.");

    const communicationsBundles = [
      finalizeBundle(communicationsBase, "communications-goal-1", "completed"),
      finalizeBundle(communicationsBase, "communications-goal-2", "completed"),
      finalizeBundle(communicationsBase, "communications-goal-3", "completed")
    ];
    const schedulingBundles = [
      finalizeBundle(schedulingBase, "scheduling-goal-1", "completed"),
      finalizeBundle(schedulingBase, "scheduling-goal-2", "completed"),
      finalizeBundle(schedulingBase, "scheduling-goal-3", "completed")
    ];
    const ignoredSupportingBundle = finalizeBundle(supportingBase, "travel-goal-1", "waiting", false);
    const evidenceRecords = [...communicationsBundles, ...schedulingBundles].map((bundle, index) =>
      buildEvidenceRecord({
        bundle,
        approval: bundle.approvals[0]!,
        id: `evidence-approved-${index + 1}`,
        decision: "approved",
        resultingTaskState: "completed"
      })
    );

    const evaluation = evaluateSelectedProductionWedgeQuality({
      goals: [...communicationsBundles, ...schedulingBundles, ignoredSupportingBundle],
      evidenceRecords
    });

    expect(evaluation.passed).toBe(true);
    expect(evaluation.evaluatedWedges).toBe(2);
    expect(evaluation.evaluatedBundles).toBe(6);
    expect(evaluation.results.every((result) => result.passed)).toBe(true);
    expect(evaluation.summaries).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          wedgeKey: "communications_execution",
          workflowCount: 3,
          workflowCompletionRate: 1,
          governedSpecialistCoverageRate: 1,
          approvalToSuccessRate: 1,
          correctionRate: 0,
          postApprovalFailureRate: 0
        }),
        expect.objectContaining({
          wedgeKey: "scheduling_execution",
          workflowCount: 3,
          workflowCompletionRate: 1,
          governedSpecialistCoverageRate: 1,
          approvalToSuccessRate: 1,
          correctionRate: 0,
          postApprovalFailureRate: 0
        })
      ])
    );
  });

  it("fails closed when a selected wedge does not have enough production samples", async () => {
    const communicationsBase = await createBundle("Triage my inbox and prepare replies for important clients.");
    const schedulingBase = await createBundle("Plan my week around focus time, deadlines, and meetings.");
    const sparseCommunicationsBundle = finalizeBundle(communicationsBase, "communications-goal-1", "completed");
    const sparseSchedulingBundle = finalizeBundle(schedulingBase, "scheduling-goal-1", "completed");

    const evaluation = evaluateSelectedProductionWedgeQuality({
      goals: [sparseCommunicationsBundle, sparseSchedulingBundle],
      evidenceRecords: []
    });

    expect(evaluation.passed).toBe(false);
    expect(evaluation.results).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          key: "communications_execution.workflow_completion_rate",
          passed: false,
          sampleCount: 1,
          minimumSamples: 3
        }),
        expect.objectContaining({
          key: "scheduling_execution.approval_to_success_rate",
          passed: false,
          sampleCount: 0,
          minimumSamples: 2
        })
      ])
    );
    expect(evaluation.results.every((result) => result.reason?.includes("required") ?? false)).toBe(true);
  });

  it("surfaces correction actions when specialist coverage and approval quality regress", async () => {
    const communicationsBase = await createBundle("Triage my inbox and prepare replies for important clients.");
    const schedulingBase = await createBundle("Plan my week around focus time, deadlines, and meetings.");
    const communicationsBundles = [
      finalizeBundle(communicationsBase, "communications-goal-1", "completed", true),
      finalizeBundle(communicationsBase, "communications-goal-2", "completed", true),
      finalizeBundle(communicationsBase, "communications-goal-3", "completed", false)
    ];
    const schedulingBundles = [
      finalizeBundle(schedulingBase, "scheduling-goal-1", "completed", true),
      finalizeBundle(schedulingBase, "scheduling-goal-2", "completed", true),
      finalizeBundle(schedulingBase, "scheduling-goal-3", "completed", true)
    ];
    const evidenceRecords = [
      buildEvidenceRecord({
        bundle: communicationsBundles[0]!,
        approval: communicationsBundles[0]!.approvals[0]!,
        id: "communications-approved-1",
        decision: "approved",
        resultingTaskState: "completed"
      }),
      buildEvidenceRecord({
        bundle: communicationsBundles[1]!,
        approval: communicationsBundles[1]!.approvals[0]!,
        id: "communications-approved-2",
        decision: "approved",
        resultingTaskState: "blocked"
      }),
      buildEvidenceRecord({
        bundle: communicationsBundles[2]!,
        approval: communicationsBundles[2]!.approvals[0]!,
        id: "communications-rejected-1",
        decision: "rejected",
        resultingTaskState: "blocked"
      }),
      buildEvidenceRecord({
        bundle: schedulingBundles[0]!,
        approval: schedulingBundles[0]!.approvals[0]!,
        id: "scheduling-approved-1",
        decision: "approved",
        resultingTaskState: "completed"
      }),
      buildEvidenceRecord({
        bundle: schedulingBundles[1]!,
        approval: schedulingBundles[1]!.approvals[0]!,
        id: "scheduling-approved-2",
        decision: "approved",
        resultingTaskState: "completed"
      }),
      buildEvidenceRecord({
        bundle: schedulingBundles[2]!,
        approval: schedulingBundles[2]!.approvals[0]!,
        id: "scheduling-approved-3",
        decision: "approved",
        resultingTaskState: "completed"
      })
    ];

    const evaluation = evaluateSelectedProductionWedgeQuality({
      goals: [...communicationsBundles, ...schedulingBundles],
      evidenceRecords
    });
    const coverageFailure = evaluation.results.find(
      (result) => result.key === "communications_execution.governed_specialist_coverage_rate"
    );
    const successFailure = evaluation.results.find(
      (result) => result.key === "communications_execution.approval_to_success_rate"
    );
    const correctionFailure = evaluation.results.find((result) => result.key === "communications_execution.correction_rate");

    expect(evaluation.passed).toBe(false);
    expect(coverageFailure).toMatchObject({
      passed: false,
      actual: 2 / 3
    });
    expect(coverageFailure?.correctionAction).toContain("restore governed-specialist execution");
    expect(successFailure).toMatchObject({
      passed: false,
      actual: 0.5
    });
    expect(correctionFailure).toMatchObject({
      passed: false,
      actual: 1 / 3
    });
    expect(correctionFailure?.correctionAction).toContain("Sample rejected approvals");
  });

  it("derives summaries from the default selected-wedge manifest", async () => {
    const communicationsBundle = finalizeBundle(
      await createBundle("Triage my inbox and prepare replies for important clients."),
      "communications-goal-1",
      "completed"
    );
    const schedulingBundle = finalizeBundle(
      await createBundle("Plan my week around focus time, deadlines, and meetings."),
      "scheduling-goal-1",
      "waiting"
    );
    const evidenceRecords = [
      buildEvidenceRecord({
        bundle: communicationsBundle,
        approval: communicationsBundle.approvals[0]!,
        id: "communications-approved",
        decision: "approved",
        resultingTaskState: "completed"
      }),
      buildEvidenceRecord({
        bundle: schedulingBundle,
        approval: schedulingBundle.approvals[0]!,
        id: "scheduling-rejected",
        decision: "rejected",
        resultingTaskState: "blocked"
      })
    ];

    const summaries = deriveSelectedProductionWedgeSummaries({
      goals: [communicationsBundle, schedulingBundle],
      evidenceRecords,
      manifest: defaultSelectedProductionWedgeQualityManifest
    });

    expect(summaries).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          wedgeKey: "communications_execution",
          workflowCount: 1,
          completedWorkflowCount: 1,
          approvedDecisionCount: 1,
          feedbackCount: 1,
          recommendationEditCount: 0,
          averageRecommendationEditDistance: 0
        }),
        expect.objectContaining({
          wedgeKey: "scheduling_execution",
          workflowCount: 1,
          completedWorkflowCount: 0,
          approvedDecisionCount: 0,
          feedbackCount: 1,
          userCorrectionCount: 1,
          recommendationEditCount: 0,
          averageRecommendationEditDistance: 0
        })
      ])
    );
  });

  it("tracks recommendation edit distance for selected wedges without turning it into a rollout gate", async () => {
    const communicationsBundle = attachRecommendationEdit(
      finalizeBundle(
        await createBundle("Triage my inbox and prepare replies for important clients."),
        "communications-goal-edit-distance-1",
        "completed"
      ),
      0.2
    );
    const secondCommunicationsBundle = attachRecommendationEdit(
      finalizeBundle(
        await createBundle("Triage my inbox and prepare replies for important clients."),
        "communications-goal-edit-distance-2",
        "completed"
      ),
      0.5
    );

    const summaries = deriveSelectedProductionWedgeSummaries({
      goals: [communicationsBundle, secondCommunicationsBundle],
      evidenceRecords: [],
      manifest: defaultSelectedProductionWedgeQualityManifest
    });

    expect(summaries).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          wedgeKey: "communications_execution",
          workflowCount: 2,
          recommendationEditCount: 2,
          averageRecommendationEditDistance: 0.35
        }),
        expect.objectContaining({
          wedgeKey: "scheduling_execution",
          workflowCount: 0,
          recommendationEditCount: 0,
          averageRecommendationEditDistance: 0
        })
      ])
    );
  });

  it("measures context quality against workflow completion outcomes for selected wedges", async () => {
    const clearContextBundle = attachContextPackSummary(
      finalizeBundle(
        await createBundle("Triage my inbox and prepare replies for important clients."),
        "communications-context-clear",
        "completed"
      ),
      {
        reviewRequiredCount: 0,
        conflictCount: 0
      }
    );
    const conflictingReviewBundle = attachContextPackSummary(
      finalizeBundle(
        await createBundle("Triage my inbox and prepare replies for important clients."),
        "communications-context-conflict",
        "waiting"
      ),
      {
        reviewRequiredCount: 2,
        conflictCount: 1
      }
    );
    const reviewOnlyBundle = attachContextPackSummary(
      finalizeBundle(
        await createBundle("Triage my inbox and prepare replies for important clients."),
        "communications-context-review",
        "completed"
      ),
      {
        reviewRequiredCount: 1,
        conflictCount: 0
      }
    );

    const summaries = deriveSelectedProductionWedgeSummaries({
      goals: [clearContextBundle, conflictingReviewBundle, reviewOnlyBundle],
      evidenceRecords: [],
      manifest: defaultSelectedProductionWedgeQualityManifest
    });

    expect(summaries).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          wedgeKey: "communications_execution",
          workflowCount: 3,
          contextPackWorkflowCount: 3,
          clearContextWorkflowCount: 1,
          reviewRequiredWorkflowCount: 2,
          reviewRequiredWorkflowRate: 2 / 3,
          conflictingWorkflowCount: 1,
          conflictingWorkflowRate: 1 / 3,
          averageContextReviewRequiredCount: 1,
          averageContextConflictCount: 1 / 3,
          clearContextCompletionRate: 1,
          reviewRequiredCompletionRate: 0.5,
          conflictingContextCompletionRate: 0
        }),
        expect.objectContaining({
          wedgeKey: "scheduling_execution",
          contextPackWorkflowCount: 0,
          reviewRequiredWorkflowCount: 0,
          conflictingWorkflowCount: 0,
          averageContextReviewRequiredCount: 0,
          averageContextConflictCount: 0,
          clearContextCompletionRate: 0,
          reviewRequiredCompletionRate: 0,
          conflictingContextCompletionRate: 0
        })
      ])
    );
  }, 15_000);

  it("ignores malformed newer context-pack logs and falls back to the latest valid snapshot", async () => {
    const validContextBundle = attachContextPackSummary(
      finalizeBundle(
        await createBundle("Plan my week around focus time, deadlines, and meetings."),
        "scheduling-context-valid",
        "completed"
      ),
      {
        reviewRequiredCount: 2,
        conflictCount: 1
      }
    );
    const bundleWithMalformedNewerLog = attachMalformedContextPackSummary(validContextBundle);

    const summaries = deriveSelectedProductionWedgeSummaries({
      goals: [bundleWithMalformedNewerLog],
      evidenceRecords: [],
      manifest: defaultSelectedProductionWedgeQualityManifest
    });

    expect(summaries).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          wedgeKey: "scheduling_execution",
          workflowCount: 1,
          contextPackWorkflowCount: 1,
          reviewRequiredWorkflowCount: 1,
          conflictingWorkflowCount: 1,
          averageContextReviewRequiredCount: 2,
          averageContextConflictCount: 1,
          reviewRequiredCompletionRate: 1,
          conflictingContextCompletionRate: 1
        })
      ])
    );
  }, 15_000);
});
