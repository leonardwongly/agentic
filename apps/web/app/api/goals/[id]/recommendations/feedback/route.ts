import { z } from "zod";
import { createActionLog, recordCounter, recordHistogram } from "@agentic/observability";
import {
  evaluateLearningPrivacyPreflight,
  redactLearningCaptureJson,
  redactLearningCaptureText,
  type LearningPrivacyMetadata
} from "@agentic/policy";
import { resolveDashboardCockpitRollout } from "@agentic/repository";
import {
  assertEpisodeLearningPrivacyPreflight,
  type EpisodeRecord,
  EpisodeRecordSchema,
  SelfImprovementConflictError
} from "@agentic/self-improvement-memory";
import { createActorContextFromPrincipal } from "../../../../../../lib/actor-context";
import { requireApiSession } from "../../../../../../lib/auth";
import { ApiRouteError, authenticatedJson, handleApiError, parseJsonBody } from "../../../../../../lib/api-response";
import { getSeededRepository, getSeededSelfImprovementRepository } from "../../../../../../lib/server";

const GoalIdSchema = z.string().trim().min(1).max(200);
const RecommendationDecisionSchema = z.enum(["accepted", "edited", "rejected", "ignored", "suppressed", "expired"]);
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
      .strict(),
    provenance: z
      .object({
        episodeIds: z.array(z.string().trim().min(1).max(160)).max(20).default([]),
        goalIds: z.array(z.string().trim().min(1).max(160)).max(20).default([]),
        taskIds: z.array(z.string().trim().min(1).max(160)).max(20).default([]),
        memoryIds: z.array(z.string().trim().min(1).max(160)).max(20).default([]),
        actionLogIds: z.array(z.string().trim().min(1).max(160)).max(20).default([]),
        evidenceRecordIds: z.array(z.string().trim().min(1).max(160)).max(20).default([]),
        graphRootIds: z.array(z.string().trim().min(1).max(220)).max(40).default([])
      })
      .strict()
      .default({
        episodeIds: [],
        goalIds: [],
        taskIds: [],
        memoryIds: [],
        actionLogIds: [],
        evidenceRecordIds: [],
        graphRootIds: []
      })
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
    case "suppressed":
      return "suppressed";
    case "expired":
      return "expired";
  }
}

function outcomeFromDecision(decision: z.infer<typeof RecommendationDecisionSchema>) {
  switch (decision) {
    case "accepted":
      return "success";
    case "ignored":
      return "partial";
    case "edited":
    case "rejected":
    case "suppressed":
    case "expired":
      return "failure";
  }
}

function outcomeScoreFromDecision(decision: z.infer<typeof RecommendationDecisionSchema>) {
  switch (decision) {
    case "accepted":
      return 1;
    case "ignored":
      return 0;
    case "edited":
      return -0.4;
    case "rejected":
    case "suppressed":
    case "expired":
      return -1;
  }
}

function feedbackRatingFromDecision(decision: z.infer<typeof RecommendationDecisionSchema>) {
  switch (decision) {
    case "accepted":
      return 10;
    case "ignored":
      return 5;
    case "edited":
      return 4;
    case "rejected":
    case "suppressed":
    case "expired":
      return 2;
  }
}

function recommendationControlFromDecision(decision: z.infer<typeof RecommendationDecisionSchema>, recommendationKey: string, appliedAt: string, notes: string | undefined) {
  if (decision !== "suppressed" && decision !== "expired") {
    return null;
  }

  return {
    action: decision === "suppressed" ? "suppress" : "expire",
    recommendationKey,
    appliedAt,
    reasonProvided: Boolean(notes)
  };
}

function lessonFromDecision(decision: z.infer<typeof RecommendationDecisionSchema>) {
  switch (decision) {
    case "accepted":
      return "This recommendation remains eligible for reuse when replay gates continue to pass.";
    case "suppressed":
      return "This recommendation is suppressed from future reuse until the learning evidence is reviewed.";
    case "expired":
      return "Prior evidence for this recommendation should not influence reuse until fresh outcomes are captured.";
    default:
      return "This recommendation requires tighter review until operator feedback and replay evidence improve.";
  }
}

function rootCauseFromDecision(decision: z.infer<typeof RecommendationDecisionSchema>) {
  switch (decision) {
    case "accepted":
    case "ignored":
      return null;
    case "edited":
      return "Operator corrected the learned recommendation.";
    case "rejected":
      return "Operator rejected the learned recommendation.";
    case "suppressed":
      return "Operator suppressed the learned recommendation.";
    case "expired":
      return "Operator expired the learned recommendation evidence.";
  }
}

function redactionField(original: string | null | undefined, redacted: string | null | undefined, field: string) {
  return original && redacted && original !== redacted ? [field] : [];
}

function applyLearningPrivacyToFeedbackEpisode(
  episode: EpisodeRecord,
  metadata: LearningPrivacyMetadata,
  reviewAt: string
): EpisodeRecord {
  const redactedRationale = episode.recommendation?.rationale
    ? redactLearningCaptureText(episode.recommendation.rationale)
    : null;
  const redactedNotes = episode.outcomeLink?.notes ? redactLearningCaptureText(episode.outcomeLink.notes) : null;
  const redactedComments = episode.userFeedback?.comments ? redactLearningCaptureText(episode.userFeedback.comments) : undefined;
  const redactionFields = [
    ...redactionField(episode.recommendation?.rationale, redactedRationale, "recommendation.rationale"),
    ...redactionField(episode.outcomeLink?.notes, redactedNotes, "outcomeLink.notes"),
    ...redactionField(episode.userFeedback?.comments, redactedComments, "userFeedback.comments")
  ];

  return EpisodeRecordSchema.parse({
    ...episode,
    task: redactLearningCaptureText(episode.task),
    situation: redactLearningCaptureText(episode.situation),
    rootCause: episode.rootCause ? redactLearningCaptureText(episode.rootCause) : null,
    solution: redactLearningCaptureText(episode.solution),
    lesson: redactLearningCaptureText(episode.lesson),
    recommendation: episode.recommendation
      ? {
          ...episode.recommendation,
          rationale: redactedRationale
        }
      : null,
    outcomeLink: episode.outcomeLink
      ? {
          ...episode.outcomeLink,
          notes: redactedNotes
        }
      : null,
    userFeedback: episode.userFeedback
      ? {
          ...episode.userFeedback,
          comments: redactedComments
        }
      : null,
    privacy: {
      ...episode.privacy,
      retention: {
        policy: `learning-feedback-${metadata.retentionDays}d`,
        reviewAt,
        expiresAt: metadata.expiresAt
      },
      redaction: {
        applied: redactionFields.length > 0,
        fields: redactionFields,
        rules: redactionFields.length > 0 ? ["learning-capture-boundary"] : [],
        reason: redactionFields.length > 0 ? "Boundary redaction applied before learning capture." : null
      }
    },
    metadata: {
      ...(redactLearningCaptureJson(episode.metadata) as Record<string, unknown>),
      userId: metadata.userId,
      workspaceId: metadata.workspaceId,
      learningPrivacy: metadata
    }
  });
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

    const governance = bundle.goal.workspaceId
      ? await repository.getWorkspaceGovernance(bundle.goal.workspaceId, principal.userId)
      : null;
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
        feedback: {
          notesProvided: Boolean(notes),
          notesLength: notes?.length ?? 0
        },
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
    recordCounter("product.dashboard.cockpit_feedback.total", 1, {
      surface: "recommendations",
      sentiment: decision === "accepted" || decision === "edited" ? "helpful" : "unhelpful",
      reason: decision,
      variant: resolveDashboardCockpitRollout().variant
    });

    await repository.saveGoalBundle({
      ...bundle,
      actionLogs: [...bundle.actionLogs, actionLog]
    });

    const preflight = evaluateLearningPrivacyPreflight({
      bundle,
      userId: principal.userId,
      actorContext,
      governance,
      source: "recommendation_feedback",
      now: actionLog.createdAt
    });

    if (!preflight.allowed) {
      return authenticatedJson({
        goalId: bundle.goal.id,
        message: `Recorded ${decisionSummary} recommendation feedback for "${bundle.goal.title}".`,
        dashboard: await repository.getDashboardData(principal.userId)
      });
    }

    const selfImprovementRepository = await getSeededSelfImprovementRepository();
    const recommendationControl = recommendationControlFromDecision(
      decision,
      recommendation.key,
      actionLog.createdAt,
      notes
    );
    const feedbackEpisodeBase = EpisodeRecordSchema.parse({
      id: `feedback-${actionLog.id}`,
      timestamp: actionLog.createdAt,
      skill: recommendation.workflow.agent,
      task: `Operator feedback for ${recommendation.workflow.action}`,
      outcome: outcomeFromDecision(decision),
      situation: `Recommendation ${recommendation.key} was presented for goal "${bundle.goal.title}".`,
      rootCause: rootCauseFromDecision(decision),
      solution: `Recorded operator feedback as a bounded learning episode for future replay gates.`,
      lesson: lessonFromDecision(decision),
      recommendation: {
        key: recommendation.key,
        kind: recommendation.workflow.kind,
        agent: recommendation.workflow.agent,
        action: recommendation.workflow.action,
        confidence: recommendation.evidence.averageConfidence,
        rationale: recommendation.reuse.rationale,
        riskClass: recommendation.workflow.riskClass,
        capabilities: [...recommendation.workflow.capabilities],
        sourceGoalId: bundle.goal.id,
        sourceTaskId: recommendation.provenance.taskIds[0] ?? null,
        fallbackMode: recommendation.reuse.replayMode === "suggest" ? "normal" : recommendation.reuse.replayMode === "draft_only" ? "draft_only" : "review_required",
        evidenceHint: recommendation.evidence.count >= 3 ? "established" : recommendation.evidence.count > 0 ? "sparse" : "none"
      },
      outcomeLink: {
        goalId: bundle.goal.id,
        workflowId: bundle.workflow.id,
        taskId: recommendation.provenance.taskIds[0] ?? null,
        goalStatus: bundle.goal.status,
        taskState: null,
        approvalDecision: null,
        executionKind: "not_run",
        outcomeScore: outcomeScoreFromDecision(decision),
        userCorrection: decision === "edited" || decision === "rejected" || decision === "suppressed" || decision === "expired",
        notes: notes ?? null
      },
      relatedPatternId: null,
      userFeedback: {
        rating: feedbackRatingFromDecision(decision),
        comments: notes
      },
      provenance: {
        ownerUserId: principal.userId,
        workspaceId: bundle.goal.workspaceId,
        source: "feedback",
        memoryIds: [...recommendation.provenance.memoryIds],
        actionLogIds: [actionLog.id, ...recommendation.provenance.actionLogIds].slice(0, 50),
        evidenceRecordIds: [...recommendation.provenance.evidenceRecordIds],
        recommendationKeys: [recommendation.key]
      },
      privacy: {
        sensitivity: recommendation.workflow.riskClass ?? "internal",
        retention: {
          policy: "learning-feedback-365d",
          reviewAt: new Date(Date.parse(actionLog.createdAt) + 90 * 24 * 60 * 60 * 1000).toISOString(),
          expiresAt: new Date(Date.parse(actionLog.createdAt) + 365 * 24 * 60 * 60 * 1000).toISOString()
        },
        redaction: {
          applied: false,
          fields: [],
          rules: [],
          reason: null
        }
      },
      metadata: {
        decision,
        source: "recommendation_feedback_route",
        feedbackActionLogId: actionLog.id,
        ...(recommendationControl ? { recommendationControl } : {})
      }
    });
    const feedbackEpisode = applyLearningPrivacyToFeedbackEpisode(
      feedbackEpisodeBase,
      preflight.metadata,
      preflight.memoryRetention.reviewAt
    );
    assertEpisodeLearningPrivacyPreflight(feedbackEpisode, {
      userId: principal.userId,
      workspaceId: bundle.goal.workspaceId ?? null
    });

    try {
      await selfImprovementRepository.appendEpisode(feedbackEpisode);
    } catch (error) {
      if (!(error instanceof SelfImprovementConflictError)) {
        throw error;
      }
    }

    return authenticatedJson({
      goalId: bundle.goal.id,
      message: `Recorded ${decisionSummary} recommendation feedback for "${bundle.goal.title}".`,
      dashboard: await repository.getDashboardData(principal.userId)
    });
  } catch (error) {
    return handleApiError(error, "Failed to record recommendation feedback.");
  }
}
