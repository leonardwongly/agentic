import { z } from "zod";
import { enqueueGoalCreateJob } from "@agentic/worker-runtime";
import type { AgenticRepository } from "@agentic/repository";
import { checkAbuseRateLimit } from "../../../lib/abuse-rate-limit";
import { requireApiSession } from "../../../lib/auth";
import { createActorContextFromPrincipal } from "../../../lib/actor-context";
import {
  ApiRouteError,
  authenticatedJson,
  handleApiError,
  authenticatedRateLimitError,
  parseJsonBody,
  withApiTelemetry
} from "../../../lib/api-response";
import { requireJsonContentType } from "../../../lib/api-errors";
import { parseIdempotencyKey } from "../../../lib/request-idempotency";
import { getSeededRepository } from "../../../lib/server";

const GoalRequestSchema = z
  .object({
    request: z.string().trim().min(1).max(2_000),
    agentId: z.string().trim().min(1).max(200).optional()
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

async function resolveExecutableGoalAgentId(params: {
  repository: AgenticRepository;
  userId: string;
  agentId: string | null;
}): Promise<string | null> {
  if (!params.agentId) {
    return null;
  }

  const agent = await params.repository.getAgent(params.agentId, params.userId);

  if (!agent) {
    throw new ApiRouteError(404, "Agent not found.");
  }

  if (agent.status !== "active") {
    throw new ApiRouteError(409, "Agent is not active and cannot execute goals.");
  }

  return agent.id;
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
      const rateLimit = await checkAbuseRateLimit({
        namespace: "goal-create",
        request,
        principal
      });

      if (!rateLimit.allowed) {
        return authenticatedRateLimitError("Too many goal creation requests. Try again later.", rateLimit.retryAfterSeconds);
      }

      const actorContext = createActorContextFromPrincipal(principal);
      const body = await parseJsonBody(request, GoalRequestSchema);
      const { repository, workspaceId } = await resolveActiveWorkspaceContext(principal.userId);
      const agentId = await resolveExecutableGoalAgentId({
        repository,
        userId: principal.userId,
        agentId: body.agentId ?? null
      });
      const job = await enqueueGoalCreateJob({
        repository,
        userId: principal.userId,
        request: body.request,
        workspaceId,
        agentId,
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
