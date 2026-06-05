import { POST as replayJobRoute } from "../../jobs/[id]/replay/route";
import { authenticatedJson } from "../../../../lib/api-response";
import { createGovernedMutationRoute } from "../../../../lib/governed-route";
import {
  OperationsRecoveryRequestSchema,
  assertJobRecoveryAllowed,
  executeOperationsRecoveryAction
} from "../../../../lib/operations-recovery";
import { getSeededRepository } from "../../../../lib/server";

export const POST = createGovernedMutationRoute(
  {
    route: "api.operations.recovery",
    fallbackError: "Failed to run operations recovery action.",
    bodySchema: OperationsRecoveryRequestSchema,
    rateLimit: {
      namespace: "operations-recovery",
      error: "Too many operations recovery requests. Try again later."
    },
    idempotency: "optional",
    allowBootstrapAccessKey: false
  },
  async ({ request, principal, actorContext, body }) => {
    const repository = await getSeededRepository();

    if (body.action === "retry_dead_letter_job") {
      await assertJobRecoveryAllowed({
        repository,
        userId: principal.userId,
        jobId: body.jobId
      });

      return replayJobRoute(
        new Request(request.url, {
          method: "POST",
          headers: request.headers
        }),
        {
          params: Promise.resolve({
            id: body.jobId
          })
        }
      );
    }

    const recovery = await executeOperationsRecoveryAction({
      repository,
      userId: principal.userId,
      actorContext,
      request: body
    });

    return authenticatedJson({
      recovery,
      dashboard: await repository.getDashboardData(principal.userId)
    });
  }
);
