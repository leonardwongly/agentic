import { z } from "zod";
import { logInfo, recordCounter } from "@agentic/observability";
import { authenticatedJson } from "../../../../../lib/api-response";
import { createGovernedMutationRoute } from "../../../../../lib/governed-route";

const RecommendationFeedbackSchema = z
  .object({
    recommendationId: z.string().trim().min(1).max(200),
    decision: z.enum(["accepted", "rejected"]),
    notes: z.string().trim().max(1000).optional()
  })
  .strict();

export const POST = createGovernedMutationRoute(
  {
    route: "api.dashboard.recommendations.feedback",
    fallbackError: "Failed to record dashboard recommendation feedback.",
    bodySchema: RecommendationFeedbackSchema,
    rateLimit: {
      namespace: "dashboard-recommendation-feedback",
      error: "Too many recommendation feedback requests. Try again later."
    }
  },
  async ({ principal, body }) => {
    recordCounter("product.dashboard.recommendation.feedback.total", 1, {
      decision: body.decision
    });
    logInfo("product.dashboard.recommendation.feedback", {
      userId: principal.userId,
      recommendationId: body.recommendationId,
      decision: body.decision,
      hasNotes: Boolean(body.notes)
    });

    return authenticatedJson({
      message: `Recorded ${body.decision} dashboard recommendation feedback.`,
      feedback: {
        recommendationId: body.recommendationId,
        decision: body.decision
      }
    });
  }
);
