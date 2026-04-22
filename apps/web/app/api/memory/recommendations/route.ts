import { z } from "zod";
import {
  buildRecommendationPerformanceReport,
  buildRecommendationReplayReport,
  deriveWorkflowRecommendations,
  filterRecommendationEvidenceEpisodes,
  RecommendationTraceSchema
} from "@agentic/self-improvement-memory";
import { recordHistogram } from "@agentic/observability";
import { requireApiSession } from "../../../../lib/auth";
import { authenticatedJson, handleApiError } from "../../../../lib/api-response";
import { getSeededSelfImprovementRepository } from "../../../../lib/server";

const WorkflowRecommendationsQuerySchema = z
  .object({
    kind: RecommendationTraceSchema.shape.kind.optional(),
    agent: z.string().trim().min(1).max(80).optional(),
    action: z.string().trim().min(1).max(120).optional(),
    riskClass: z.string().trim().min(1).max(16).optional(),
    capabilities: z.array(z.string().trim().min(1).max(40)).max(10).default([]),
    replayMode: z.enum(["draft_only", "review_required", "approval_required", "suggest"]).optional(),
    minimumEvidence: z.coerce.number().int().min(1).max(100).optional(),
    lowConfidenceThreshold: z.coerce.number().min(0).max(1).optional(),
    automationThreshold: z.coerce.number().min(0).max(1).optional(),
    minimumScore: z.coerce.number().min(0).max(1).optional(),
    bucketDays: z.coerce.number().int().min(1).max(30).optional(),
    bucketCount: z.coerce.number().int().min(2).max(12).optional(),
    limit: z.coerce.number().int().min(1).max(50).default(10),
    includeDraftOnly: z
      .enum(["true", "false"])
      .transform((value) => value === "true")
      .optional()
      .default(false)
  })
  .strict();

export async function GET(request: Request) {
  try {
    await requireApiSession(request);
    const url = new URL(request.url);
    const query = WorkflowRecommendationsQuerySchema.parse({
      kind: url.searchParams.get("kind") ?? undefined,
      agent: url.searchParams.get("agent") ?? undefined,
      action: url.searchParams.get("action") ?? undefined,
      riskClass: url.searchParams.get("riskClass") ?? undefined,
      capabilities: url.searchParams.getAll("capability"),
      replayMode: url.searchParams.get("replayMode") ?? undefined,
      minimumEvidence: url.searchParams.get("minimumEvidence") ?? undefined,
      lowConfidenceThreshold: url.searchParams.get("lowConfidenceThreshold") ?? undefined,
      automationThreshold: url.searchParams.get("automationThreshold") ?? undefined,
      minimumScore: url.searchParams.get("minimumScore") ?? undefined,
      bucketDays: url.searchParams.get("bucketDays") ?? undefined,
      bucketCount: url.searchParams.get("bucketCount") ?? undefined,
      limit: url.searchParams.get("limit") ?? undefined,
      includeDraftOnly: url.searchParams.get("includeDraftOnly") ?? undefined
    });
    const repository = await getSeededSelfImprovementRepository();
    const episodes = await repository.listEpisodes();
    const evidenceFilters = {
      kind: query.kind,
      agent: query.agent,
      action: query.action,
      riskClass: query.riskClass,
      capabilities: [...query.capabilities]
    };
    const recommendationFilters = {
      ...evidenceFilters,
      replayMode: query.replayMode,
      minimumEvidence: query.minimumEvidence,
      lowConfidenceThreshold: query.lowConfidenceThreshold,
      automationThreshold: query.automationThreshold,
      minimumScore: query.minimumScore,
      limit: query.limit,
      includeDraftOnly: query.includeDraftOnly
    };
    const matchedEpisodes = filterRecommendationEvidenceEpisodes(episodes, evidenceFilters);
    const recommendations = deriveWorkflowRecommendations(matchedEpisodes, recommendationFilters);
    const report = buildRecommendationReplayReport(matchedEpisodes, {
      minimumEvidence: query.minimumEvidence,
      lowConfidenceThreshold: query.lowConfidenceThreshold,
      automationThreshold: query.automationThreshold
    });
    const analytics = buildRecommendationPerformanceReport(matchedEpisodes, {
      minimumEvidence: query.minimumEvidence,
      lowConfidenceThreshold: query.lowConfidenceThreshold,
      automationThreshold: query.automationThreshold,
      bucketDays: query.bucketDays,
      bucketCount: query.bucketCount
    });

    if (analytics.current.consideredEpisodes > 0) {
      const metricAttributes = {
        kind: query.kind ?? "all",
        agent: query.agent ?? "all",
        riskClass: query.riskClass ?? "all"
      };
      recordHistogram(
        "product.learning.recommendation.safe_precision",
        analytics.current.safeSuggestionPrecision,
        metricAttributes
      );
      recordHistogram(
        "product.learning.recommendation.negative_outcome_rate",
        analytics.current.negativeOutcomeRate,
        metricAttributes
      );
      recordHistogram(
        "product.learning.recommendation.failure_cost_rate",
        analytics.current.failureCostRate,
        metricAttributes
      );
    }

    return authenticatedJson({
      recommendations,
      summary: {
        totalEpisodes: episodes.length,
        matchedEpisodes: matchedEpisodes.length,
        consideredEpisodes: report.consideredEpisodes,
        suggestedPatterns: report.suggestedPatterns,
        guardedPatterns: report.guardedPatterns,
        sparsePatterns: report.sparsePatterns,
        safeSuggestionPrecision: report.safeSuggestionPrecision,
        currentNegativeOutcomeRate: analytics.current.negativeOutcomeRate,
        currentFailureCostRate: analytics.current.failureCostRate,
        driftStatus: analytics.drift.status,
        returnedCount: recommendations.length
      },
      analytics,
      filters: {
        ...query,
        capabilities: [...query.capabilities]
      }
    });
  } catch (error) {
    return handleApiError(error, "Failed to load workflow recommendations.");
  }
}
