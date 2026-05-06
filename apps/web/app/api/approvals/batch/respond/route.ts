import { ApiRouteError, authenticatedJson } from "../../../../../lib/api-response";
import { createGovernedMutationRoute } from "../../../../../lib/governed-route";
import {
  ApprovalBatchRespondRequestSchema,
  respondToApprovalBatch
} from "../../../../../lib/approval-batches";
import { getSeededRepository } from "../../../../../lib/server";

export const POST = createGovernedMutationRoute(
  {
    route: "api.approvals.batch.respond",
    fallbackError: "Failed to respond to approval batch.",
    bodySchema: ApprovalBatchRespondRequestSchema,
    rateLimit: {
      namespace: "approval-batch-respond",
      error: "Too many approval batch response requests. Try again later."
    },
    idempotency: "optional"
  },
  async ({ principal, actorContext, body }) => {
    const repository = await getSeededRepository();

    try {
      const response = await respondToApprovalBatch({
        repository,
        userId: principal.userId,
        actorContext,
        request: body
      });
      const status = response.resultCounts.failed > 0 || response.resultCounts.skipped > 0 ? 207 : 202;

      return authenticatedJson(
        {
          ...response,
          dashboard: await repository.getDashboardData(principal.userId)
        },
        { status }
      );
    } catch (error) {
      throw new ApiRouteError(409, error instanceof Error ? error.message : "Approval batch could not be processed.");
    }
  }
);
