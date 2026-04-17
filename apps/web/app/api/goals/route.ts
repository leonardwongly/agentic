import { z } from "zod";
import { enqueueGoalCreateJob } from "@agentic/worker-runtime";
import { requireApiSession } from "../../../lib/auth";
import { createActorContextFromPrincipal } from "../../../lib/actor-context";
import {
  ApiRouteError,
  authenticatedJson,
  handleApiError,
  parseJsonBody,
  withApiTelemetry
} from "../../../lib/api-response";
import { requireJsonContentType } from "../../../lib/api-errors";
import { getSeededRepository } from "../../../lib/server";

const GOAL_IDEMPOTENCY_KEY_HEADER = "x-idempotency-key";

const GoalRequestSchema = z
  .object({
    request: z.string().trim().min(1).max(2_000),
    agentId: z.string().optional()
  })
  .strict();

async function resolveActiveWorkspaceContext(userId: string) {
  const repository = await getSeededRepository();
  const dashboard = await repository.getDashboardData(userId);

  return {
    repository,
    workspaceId: dashboard.activeWorkspace?.id ?? null
  };
}

function parseGoalIdempotencyKey(request: Request): string | null {
  const candidate = request.headers.get(GOAL_IDEMPOTENCY_KEY_HEADER)?.trim() ?? "";

  if (!candidate) {
    return null;
  }

  if (!/^[A-Za-z0-9:_-]{1,200}$/u.test(candidate)) {
    throw new ApiRouteError(400, `${GOAL_IDEMPOTENCY_KEY_HEADER} must be 1-200 URL-safe characters.`);
  }

  return candidate;
}

export async function GET(request: Request) {
  return withApiTelemetry(request, "api.goals.list", async () => {
    try {
      const principal = await requireApiSession(request);
      const repository = await getSeededRepository();

      return authenticatedJson({
        dashboard: await repository.getDashboardData(principal.userId)
      });
    } catch (error) {
      return handleApiError(error, "Failed to load goals dashboard.");
    }
  });
}

export async function POST(request: Request) {
  return withApiTelemetry(request, "api.goals.create", async () => {
    try {
      requireJsonContentType(request);
      const principal = await requireApiSession(request);
      const actorContext = createActorContextFromPrincipal(principal);
      const body = await parseJsonBody(request, GoalRequestSchema);
      const { repository, workspaceId } = await resolveActiveWorkspaceContext(principal.userId);
      const job = await enqueueGoalCreateJob({
        repository,
        userId: principal.userId,
        request: body.request,
        workspaceId,
        agentId: body.agentId ?? null,
        actorContext,
        idempotencyKey: parseGoalIdempotencyKey(request)
      });
      return authenticatedJson(
        {
          job: {
            id: job.id,
            kind: job.kind,
            status: job.status,
            goalId: job.payload.goalId,
            attemptCount: job.attemptCount,
            maxAttempts: job.maxAttempts,
            createdAt: job.createdAt,
            updatedAt: job.updatedAt
          },
          statusUrl: `/api/goals/jobs/${job.id}`
        },
        { status: 202 }
      );
    } catch (error) {
      return handleApiError(error, "Failed to create goal.");
    }
  });
}
