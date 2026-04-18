import { enqueueDocsRenderJob } from "@agentic/worker-runtime";
import { createActorContextFromPrincipal } from "../../../../lib/actor-context";
import { requireApiSession } from "../../../../lib/auth";
import { authenticatedJson, handleApiError, withApiTelemetry } from "../../../../lib/api-response";
import { parseIdempotencyKey } from "../../../../lib/request-idempotency";
import { getSeededRepository } from "../../../../lib/server";

export async function POST(request: Request) {
  return withApiTelemetry(request, "api.docs.render", async () => {
    try {
      const principal = await requireApiSession(request);
      const repository = await getSeededRepository();
      const actorContext = createActorContextFromPrincipal(principal);
      const job = await enqueueDocsRenderJob({
        repository,
        userId: principal.userId,
        actorContext,
        idempotencyKey: parseIdempotencyKey(request)
      });

      return authenticatedJson(
        {
          job: {
            id: job.id,
            kind: job.kind,
            status: job.status,
            attemptCount: job.attemptCount,
            maxAttempts: job.maxAttempts,
            createdAt: job.createdAt,
            updatedAt: job.updatedAt
          },
          statusUrl: `/api/docs/jobs/${job.id}`
        },
        { status: 202 }
      );
    } catch (error) {
      return handleApiError(error, "Failed to render the document.");
    }
  });
}
