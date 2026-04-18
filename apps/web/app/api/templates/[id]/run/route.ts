import crypto from "node:crypto";
import { z } from "zod";
import { enqueueTemplateRunJob } from "@agentic/worker-runtime";
import { createActorContextFromPrincipal } from "../../../../../lib/actor-context";
import { requireApiSession } from "../../../../../lib/auth";
import { ApiRouteError, authenticatedJson, handleApiError, withApiTelemetry } from "../../../../../lib/api-response";
import { parseIdempotencyKey } from "../../../../../lib/request-idempotency";
import { getSeededRepository } from "../../../../../lib/server";

const TemplateIdSchema = z.string().trim().min(1).max(200);

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  return withApiTelemetry(request, "api.templates.run", async () => {
    try {
      const principal = await requireApiSession(request);
      const actorContext = createActorContextFromPrincipal(principal);
      const { id } = await context.params;
      const templateId = TemplateIdSchema.parse(id);
      const repository = await getSeededRepository();
      const dashboard = await repository.getDashboardData(principal.userId);
      const workspaceId = dashboard.activeWorkspace?.id ?? null;
      const templates = await repository.listTemplates(principal.userId);
      const template = templates.find((candidate) => candidate.id === templateId);

      if (!template) {
        throw new ApiRouteError(404, `Template ${templateId} was not found.`);
      }

      const job = await enqueueTemplateRunJob({
        repository,
        userId: principal.userId,
        templateId,
        goalId: crypto.randomUUID(),
        workflowId: crypto.randomUUID(),
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
            templateId: job.payload.templateId,
            goalId: job.payload.goalId,
            attemptCount: job.attemptCount,
            maxAttempts: job.maxAttempts,
            createdAt: job.createdAt,
            updatedAt: job.updatedAt
          },
          statusUrl: `/api/templates/jobs/${job.id}`
        },
        { status: 202 }
      );
    } catch (error) {
      return handleApiError(error, "Failed to run template.");
    }
  });
}
