import { enqueueDocsRenderJob } from "@agentic/worker-runtime";
import { checkAbuseRateLimit } from "../../../../lib/abuse-rate-limit";
import { createActorContextFromPrincipal } from "../../../../lib/actor-context";
import { requireApiPrincipal } from "../../../../lib/auth";
import { authenticatedJson, authenticatedRateLimitError, handleApiError, withApiTelemetry } from "../../../../lib/api-response";
import { parseOrDeriveIdempotencyKey } from "../../../../lib/request-idempotency";
import { getSeededRepository } from "../../../../lib/server";

export async function POST(request: Request) {
  return withApiTelemetry(request, "api.docs.render", async () => {
    try {
      const principal = await requireApiPrincipal(request, {
        allowMachineToken: true,
        routeGroup: "automation",
        scope: "jobs:create"
      });
      const rateLimit = await checkAbuseRateLimit({
        namespace: "docs-render",
        request,
        principal
      });

      if (!rateLimit.allowed) {
        return authenticatedRateLimitError("Too many document render requests. Try again later.", rateLimit.retryAfterSeconds);
      }

      const repository = await getSeededRepository();
      const actorContext = createActorContextFromPrincipal(principal);
      const job = await enqueueDocsRenderJob({
        repository,
        userId: principal.userId,
        actorContext,
        idempotencyKey: parseOrDeriveIdempotencyKey(request, {
          namespace: "docs-render",
          userId: principal.userId,
          payload: {
            format: "docx"
          }
        })
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
