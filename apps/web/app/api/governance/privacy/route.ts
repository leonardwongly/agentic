import crypto from "node:crypto";
import { z } from "zod";
import { PrivacyOperationKindSchema, PrivacyOperationSchema } from "@agentic/contracts";
import { buildPrivacyControlSummary } from "@agentic/policy";
import { resolveWorkspaceGovernanceDefaultsFromEnv } from "@agentic/repository";
import { enqueuePrivacyOperationJob } from "@agentic/worker-runtime";
import { checkAbuseRateLimit } from "../../../../lib/abuse-rate-limit";
import { requireApiSession } from "../../../../lib/auth";
import { createActorContextFromPrincipal } from "../../../../lib/actor-context";
import {
  ApiRouteError,
  authenticatedJson,
  authenticatedRateLimitError,
  handleApiError,
  parseJsonBody
} from "../../../../lib/api-response";
import { requireJsonContentType } from "../../../../lib/api-errors";
import { getSeededPrivacyRouteRepository } from "../../../../lib/server";

const TriggerPrivacyOperationSchema = z
  .object({
    kind: PrivacyOperationKindSchema,
    confirmation: z
      .object({
        phrase: z.string().min(1).max(80)
      })
      .strict()
      .optional()
  })
  .strict();

const WORKSPACE_DELETE_CONFIRMATION_PHRASE = "delete workspace";

async function resolveWorkspaceContext(userId: string) {
  const repository = await getSeededPrivacyRouteRepository();
  const dashboard = await repository.getDashboardData(userId);
  const activeWorkspace = dashboard.activeWorkspace;

  if (!activeWorkspace) {
    throw new ApiRouteError(404, "No active workspace is selected.");
  }

  if (activeWorkspace.ownerUserId !== userId) {
    throw new ApiRouteError(403, "Only the workspace owner can manage privacy operations.");
  }

  return { repository, dashboard, activeWorkspace };
}

function requireWorkspaceDeleteConfirmation(body: z.infer<typeof TriggerPrivacyOperationSchema>) {
  if (body.kind !== "workspace_delete") {
    return null;
  }

  const normalizedPhrase = body.confirmation?.phrase.trim().toLowerCase() ?? "";

  if (normalizedPhrase !== WORKSPACE_DELETE_CONFIRMATION_PHRASE) {
    throw new ApiRouteError(400, `Workspace deletion requires typing "${WORKSPACE_DELETE_CONFIRMATION_PHRASE}" before it can be queued.`);
  }

  return {
    method: "typed_phrase",
    challenge: WORKSPACE_DELETE_CONFIRMATION_PHRASE
  };
}

function sanitizeQueueFailure(kind: z.infer<typeof PrivacyOperationKindSchema>): string {
  switch (kind) {
    case "retention_enforcement":
      return "Retention enforcement could not be queued.";
    case "workspace_export":
      return "Workspace export could not be queued.";
    case "workspace_delete":
      return "Workspace deletion could not be queued.";
    default:
      return "Privacy operation could not be queued.";
  }
}

export async function GET(request: Request) {
  try {
    const principal = await requireApiSession(request);
    const { repository, activeWorkspace } = await resolveWorkspaceContext(principal.userId);

    return authenticatedJson({
      operations: await repository.listPrivacyOperations({
        userId: principal.userId,
        workspaceId: activeWorkspace.id
      }),
      controls: buildPrivacyControlSummary(),
      dashboard: await repository.getDashboardData(principal.userId)
    });
  } catch (error) {
    return handleApiError(error, "Failed to load workspace privacy operations.");
  }
}

export async function POST(request: Request) {
  try {
    requireJsonContentType(request);
    const principal = await requireApiSession(request);
    const rateLimit = await checkAbuseRateLimit({
      namespace: "privacy-operation",
      request,
      principal
    });

    if (!rateLimit.allowed) {
      return authenticatedRateLimitError("Too many privacy operation requests. Try again later.", rateLimit.retryAfterSeconds);
    }

    const actorContext = createActorContextFromPrincipal(principal);
    const body = await parseJsonBody(request, TriggerPrivacyOperationSchema);
    const { repository, dashboard, activeWorkspace } = await resolveWorkspaceContext(principal.userId);
    const confirmation = requireWorkspaceDeleteConfirmation(body);
    const existing = (
      await repository.listPrivacyOperations({
        userId: principal.userId,
        workspaceId: activeWorkspace.id,
        kinds: [body.kind],
        statuses: ["queued", "running"]
      })
    )[0] ?? null;

    if (existing) {
      return authenticatedJson({
        operation: existing,
        reused: true,
        dashboard
      });
    }

    const now = new Date().toISOString();
    const details =
      body.kind === "retention_enforcement"
        ? {
            retentionDays:
              dashboard.workspaceGovernance?.retentionDays ?? resolveWorkspaceGovernanceDefaultsFromEnv().retentionDays
          }
        : confirmation
          ? {
              confirmation: {
                ...confirmation,
                confirmedAt: now
              }
            }
          : {};
    const operation = PrivacyOperationSchema.parse({
      id: crypto.randomUUID(),
      workspaceId: activeWorkspace.id,
      userId: principal.userId,
      kind: body.kind,
      status: "queued",
      requestedBy: principal.userId,
      actorContext,
      jobId: null,
      details,
      result: {},
      startedAt: null,
      completedAt: null,
      error: null,
      createdAt: now,
      updatedAt: now
    });

    await repository.savePrivacyOperation(operation);

    try {
      const job = await enqueuePrivacyOperationJob({
        repository,
        operation: {
          id: operation.id,
          workspaceId: operation.workspaceId,
          userId: operation.userId,
          kind: operation.kind,
          actorContext: operation.actorContext
        }
      });

      const queuedOperation = await repository.savePrivacyOperation({
        ...operation,
        jobId: job.id,
        updatedAt: new Date().toISOString()
      });

      return authenticatedJson(
        {
          operation: queuedOperation,
          reused: false,
          dashboard: await repository.getDashboardData(principal.userId)
        },
        { status: 202 }
      );
    } catch (error) {
      await repository.savePrivacyOperation({
        ...operation,
        status: "failed",
        completedAt: new Date().toISOString(),
        error: sanitizeQueueFailure(operation.kind),
        updatedAt: new Date().toISOString()
      });

      throw error;
    }
  } catch (error) {
    return handleApiError(error, "Failed to queue workspace privacy operation.");
  }
}
