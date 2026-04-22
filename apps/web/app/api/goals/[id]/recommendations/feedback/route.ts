import { z } from "zod";
import { createActionLog, recordCounter, recordHistogram } from "@agentic/observability";
import { createActorContextFromPrincipal } from "../../../../../../lib/actor-context";
import { requireApiSession } from "../../../../../../lib/auth";
import { ApiRouteError, authenticatedJson, handleApiError, parseJsonBody } from "../../../../../../lib/api-response";
import { getSeededRepository } from "../../../../../../lib/server";

const GoalIdSchema = z.string().trim().min(1).max(200);
const RecommendationDecisionSchema = z.enum(["accepted", "edited", "rejected", "ignored"]);
const RecommendationBodySchema = z
  .object({
    key: z.string().trim().min(1).max(160),
    source: z.literal("outcome_trace"),
    workflow: z
      .object({
        kind: z.enum(["task_plan", "approval_path", "execution_path"]),
        agent: z.string().trim().min(1).max(80),
        action: z.string().trim().min(1).max(120),
        riskClass: z.string().trim().min(1).max(16).nullable(),
        capabilities: z.array(z.string().trim().min(1).max(40)).max(20)
      })
      .strict(),
    reuse: z
      .object({
        replayMode: z.enum(["draft_only", "review_required", "approval_required", "suggest"]),
        operatorAction: z.enum(["suggest_reuse", "require_approval", "require_review", "keep_draft_only"]),
        rationale: z.string().trim().max(500)
      })
      .strict(),
    evidence: z
      .object({
        count: z.number().int().min(0).max(10_000),
        approvalCount: z.number().int().min(0).max(10_000),
        successCount: z.number().int().min(0).max(10_000),
        partialCount: z.number().int().min(0).max(10_000),
        failureCount: z.number().int().min(0).max(10_000),
        rejectionCount: z.number().int().min(0).max(10_000),
        userCorrectionCount: z.number().int().min(0).max(10_000),
        averageConfidence: z.number().min(0).max(1),
        approvalRate: z.number().min(0).max(1),
        successRate: z.number().min(0).max(1),
        negativeRate: z.number().min(0).max(1),
        score: z.number().min(0).max(1),
        lastSeenAt: z.string().datetime()
      })
      .strict()
  })
  .strict();
const RecommendationFeedbackBodySchema = z
  .object({
    decision: RecommendationDecisionSchema,
    recommendation: RecommendationBodySchema,
    notes: z.string().trim().min(1).max(1_000).optional()
  })
  .strict();

type RouteContext = {
  params: Promise<{
    id: string;
  }>;
};

function describeDecision(decision: z.infer<typeof RecommendationDecisionSchema>) {
  switch (decision) {
    case "accepted":
      return "accepted";
    case "edited":
      return "edited before reuse";
    case "rejected":
      return "rejected";
    case "ignored":
      return "ignored";
  }
}

export async function POST(request: Request, context: RouteContext) {
  try {
    const principal = await requireApiSession(request);
    const actorContext = createActorContextFromPrincipal(principal);
    const { id } = await context.params;
    const goalId = GoalIdSchema.parse(id);
    const { decision, recommendation, notes } = await parseJsonBody(request, RecommendationFeedbackBodySchema);
    const repository = await getSeededRepository();
    const bundle = await repository.getGoalBundleForUser(goalId, principal.userId);

    if (!bundle) {
      throw new ApiRouteError(404, `Goal ${goalId} was not found.`);
    }

    const decisionSummary = describeDecision(decision);
    const metricAttributes = {
      decision,
      operatorOutcome: decision === "edited" ? "overridden" : decision,
      workflowKind: recommendation.workflow.kind,
      agent: recommendation.workflow.agent,
      action: recommendation.workflow.action,
      riskClass: recommendation.workflow.riskClass ?? "unknown",
      replayMode: recommendation.reuse.replayMode,
      operatorAction: recommendation.reuse.operatorAction
    };
    const actionLog = createActionLog({
      goalId: bundle.goal.id,
      workflowId: bundle.workflow.id,
      actor: actorContext.executor.label,
      kind: "goal.recommendation_feedback",
      message: `Operator ${decisionSummary} recommendation ${recommendation.workflow.agent} ${recommendation.workflow.action}.`,
      details: {
        actorContext,
        decision,
        notes: notes ?? null,
        source: "goal_card",
        recommendation
      },
      prevLog: bundle.actionLogs.at(-1) ?? null
    });

    recordCounter("product.learning.recommendation.feedback.total", 1, metricAttributes);
    recordHistogram(
      "product.learning.recommendation.feedback.evidence_count",
      recommendation.evidence.count,
      metricAttributes
    );
    recordHistogram("product.learning.recommendation.feedback.score", recommendation.evidence.score, metricAttributes);
    recordHistogram(
      "product.learning.recommendation.feedback.negative_rate",
      recommendation.evidence.negativeRate,
      metricAttributes
    );

    await repository.saveGoalBundle({
      ...bundle,
      actionLogs: [...bundle.actionLogs, actionLog]
    });

    return authenticatedJson({
      goalId: bundle.goal.id,
      message: `Recorded ${decisionSummary} recommendation feedback for "${bundle.goal.title}".`,
      dashboard: await repository.getDashboardData(principal.userId)
    });
  } catch (error) {
    return handleApiError(error, "Failed to record recommendation feedback.");
  }
}
