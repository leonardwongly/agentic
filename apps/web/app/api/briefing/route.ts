import crypto from "node:crypto";
import { z } from "zod";
import { BriefingTypeSchema } from "@agentic/contracts";
import { enqueueBriefingCreateJob } from "@agentic/worker-runtime";
import { checkAbuseRateLimit } from "../../../lib/abuse-rate-limit";
import { requireApiSession } from "../../../lib/auth";
import {
  ApiRouteError,
  authenticatedJson,
  authenticatedRateLimitError,
  handleApiError,
  withApiTelemetry
} from "../../../lib/api-response";
import { createActorContextFromPrincipal } from "../../../lib/actor-context";
import { parseIdempotencyKey } from "../../../lib/request-idempotency";
import { getSeededRepository } from "../../../lib/server";

const BriefingRequestSchema = z
  .object({
    type: BriefingTypeSchema.optional().default("startup")
  })
  .strict();

async function parseBriefingRequest(request: Request): Promise<z.infer<typeof BriefingRequestSchema>> {
  const rawBody = await request.text();

  if (!rawBody.trim()) {
    return { type: "startup" };
  }

  const contentType = request.headers.get("content-type")?.toLowerCase() ?? "";

  if (!contentType.startsWith("application/json")) {
    throw new ApiRouteError(415, "Content-Type must be application/json.");
  }

  let parsedBody: unknown;

  try {
    parsedBody = JSON.parse(rawBody);
  } catch {
    throw new ApiRouteError(400, "Request body must be valid JSON.");
  }

  return BriefingRequestSchema.parse(parsedBody);
}

async function resolveActiveWorkspaceContext(userId: string) {
  const repository = await getSeededRepository();
  const dashboard = await repository.getDashboardData(userId);
  const workspaceId = dashboard.activeWorkspace?.id ?? null;

  return {
    repository,
    workspaceId,
    workspaceGovernance: workspaceId
      ? dashboard.workspaceGovernance ?? await repository.getWorkspaceGovernance(workspaceId, userId)
      : null
  };
}

export async function POST(request: Request) {
  return withApiTelemetry(request, "api.briefing.create", async () => {
    try {
      const principal = await requireApiSession(request);
      const rateLimit = await checkAbuseRateLimit({
        namespace: "briefing-create",
        request,
        principal
      });

      if (!rateLimit.allowed) {
        return authenticatedRateLimitError("Too many briefing requests. Try again later.", rateLimit.retryAfterSeconds);
      }

      const actorContext = createActorContextFromPrincipal(principal);
      const { repository, workspaceId } = await resolveActiveWorkspaceContext(principal.userId);
      const body = await parseBriefingRequest(request);
      const job = await enqueueBriefingCreateJob({
        repository,
        userId: principal.userId,
        goalId: crypto.randomUUID(),
        workflowId: crypto.randomUUID(),
        briefingType: body.type,
        workspaceId,
        actorContext,
        idempotencyKey: parseIdempotencyKey(request)
      });

      return authenticatedJson(
        {
          job: {
            id: job.id,
            kind: job.kind,
            status: job.status,
            goalId: job.payload.goalId,
            briefingType: job.payload.briefingType,
            attemptCount: job.attemptCount,
            maxAttempts: job.maxAttempts,
            createdAt: job.createdAt,
            updatedAt: job.updatedAt
          },
          statusUrl: `/api/briefing/jobs/${job.id}`
        },
        { status: 202 }
      );
    } catch (error) {
      return handleApiError(error, "Failed to generate briefing.");
    }
  });
}
