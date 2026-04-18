import crypto from "node:crypto";
import { z } from "zod";
import {
  AutopilotEventKindSchema,
  AutopilotEventSchema,
  AutopilotModeSchema,
  BriefingTypeSchema,
  nowIso,
  type AutopilotEvent,
  type ActorContext,
  type AutopilotMode,
  type BriefingType
} from "@agentic/contracts";
import { enqueueAutopilotProcessJob } from "@agentic/worker-runtime";
import {
  ApiRouteError,
  authenticatedRateLimitError,
  authenticatedJson,
  handleApiError,
  parseJsonBody,
  withApiTelemetry
} from "../../../../lib/api-response";
import { requireJsonContentType } from "../../../../lib/api-errors";
import { requireApiSession } from "../../../../lib/auth";
import { createActorContextFromPrincipal } from "../../../../lib/actor-context";
import { checkAbuseRateLimit } from "../../../../lib/abuse-rate-limit";
import { getSeededRepository } from "../../../../lib/server";
import type { AgenticRepository } from "@agentic/repository";

const TriggerAutopilotEventSchema = z
  .object({
    kind: AutopilotEventKindSchema,
    sourceId: z.string().trim().min(1).max(200),
    summary: z.string().trim().min(1).max(200).optional(),
    details: z.record(z.string().min(1).max(100), z.unknown()).optional(),
    idempotencyKey: z.string().trim().min(1).max(200).optional(),
    dryRun: z.boolean().optional().default(false),
    mode: AutopilotModeSchema.optional()
  })
  .strict();

function buildPendingEvent(params: {
  userId: string;
  kind: z.infer<typeof AutopilotEventKindSchema>;
  sourceId: string;
  mode: AutopilotMode;
  summary: string;
  details?: Record<string, unknown>;
  idempotencyKey?: string | null;
  actorContext: ActorContext;
}): AutopilotEvent {
  return AutopilotEventSchema.parse({
    id: crypto.randomUUID(),
    userId: params.userId,
    kind: params.kind,
    sourceId: params.sourceId,
    idempotencyKey: params.idempotencyKey ?? null,
    mode: params.mode,
    summary: params.summary,
    status: "pending",
    details: params.details ?? {},
    actorContext: params.actorContext,
    createdAt: nowIso(),
    processedAt: null,
    resultGoalId: null,
    error: null
  });
}

function measureProcessingLatencyMs(createdAt: string, processedAt: string): number {
  const createdMs = Date.parse(createdAt);
  const processedMs = Date.parse(processedAt);

  if (!Number.isFinite(createdMs) || !Number.isFinite(processedMs)) {
    return 0;
  }

  return Math.max(0, processedMs - createdMs);
}

function summarizeEnqueueFailure(createdAt: string, processedAt: string): Record<string, unknown> {
  return {
    failureStage: "enqueue",
    requiresReview: true,
    recoveryAction: "requeue_event",
    jobStatus: "enqueue_failed",
    processingLatencyMs: measureProcessingLatencyMs(createdAt, processedAt)
  };
}

async function resolveWatcherSource(sourceId: string, userId: string) {
  const repository = await getSeededRepository();
  const watchers = await repository.listWatchers({ userId });
  const watcher = watchers.find((candidate) => candidate.id === sourceId);

  if (!watcher) {
    throw new ApiRouteError(404, `Watcher ${sourceId} was not found.`);
  }

  if (watcher.status !== "active") {
    throw new ApiRouteError(409, `Watcher ${sourceId} is not active.`);
  }

  const goal = await repository.getGoalBundleForUser(watcher.goalId, userId);

  if (!goal) {
    throw new ApiRouteError(404, `Watcher goal ${watcher.goalId} was not found.`);
  }

  return { repository, watcher, goal };
}

async function resolveTemplateSource(sourceId: string, userId: string) {
  const repository = await getSeededRepository();
  const templates = await repository.listTemplates(userId);
  const template = templates.find((candidate) => candidate.id === sourceId);

  if (!template) {
    throw new ApiRouteError(404, `Template ${sourceId} was not found.`);
  }

  if (!template.schedule.enabled) {
    throw new ApiRouteError(409, `Template ${sourceId} does not have scheduling enabled.`);
  }

  return { repository, template };
}

async function resolveBriefingSource(sourceId: string, userId: string) {
  const repository = await getSeededRepository();
  const type = BriefingTypeSchema.parse(sourceId) as BriefingType;
  const preferences = await repository.getBriefingPreferences(userId);
  const schedule = preferences.schedules.find((candidate) => candidate.type === type);

  if (!schedule?.enabled) {
    throw new ApiRouteError(409, `Briefing ${type} is not enabled.`);
  }

  return { repository, type, preferences };
}

async function findAutopilotProcessJob(
  repository: AgenticRepository,
  userId: string,
  autopilotEventId: string
) {
  const jobs = await repository.listJobs({
    userId,
    kinds: ["autopilot_process"]
  });

  return (
    jobs.find(
      (job) => job.payload.type === "autopilot_process" && job.payload.autopilotEventId === autopilotEventId
    ) ?? null
  );
}

function shouldEnsureAutopilotJob(event: AutopilotEvent): boolean {
  if (event.status === "pending") {
    return true;
  }

  if (event.status !== "failed") {
    return false;
  }

  return typeof event.details.jobId !== "string";
}

async function ensureAutopilotProcessJob(repository: AgenticRepository, event: AutopilotEvent) {
  const existing = await findAutopilotProcessJob(repository, event.userId, event.id);

  if (existing) {
    return {
      job: existing,
      created: false
    };
  }

  return {
    job: await enqueueAutopilotProcessJob({
      repository,
      autopilotEvent: event
    }),
    created: true
  };
}

export async function POST(request: Request) {
  return withApiTelemetry(request, "api.autopilot.events.create", async () => {
    try {
      requireJsonContentType(request);
      const principal = await requireApiSession(request);
      const rateLimit = await checkAbuseRateLimit({
        request,
        principal,
        namespace: "autopilot-event"
      });

      if (!rateLimit.allowed) {
        return authenticatedRateLimitError("Too many autopilot event requests. Try again later.", rateLimit.retryAfterSeconds);
      }

      const actorContext = createActorContextFromPrincipal(principal);
      const repository = await getSeededRepository();
      const settings = await repository.getAutopilotSettings(principal.userId);
      const body = await parseJsonBody(request, TriggerAutopilotEventSchema);
      const effectiveMode = body.mode ?? settings.mode;
      let summary = body.summary?.trim() ?? "";

      if (effectiveMode === "auto_run" && repository.backend !== "postgres") {
        return authenticatedJson(
          {
            error: "Autopilot auto-run requires Postgres-backed persistence.",
            backend: repository.backend
          },
          { status: 409 }
        );
      }

      if (body.kind === "watcher_triggered") {
        const { watcher } = await resolveWatcherSource(body.sourceId, principal.userId);
        summary ||= `Watcher triggered: ${watcher.targetEntity}`;

        if (body.dryRun) {
          const event = AutopilotEventSchema.parse({
            ...buildPendingEvent({
              userId: principal.userId,
              kind: body.kind,
              sourceId: body.sourceId,
              mode: effectiveMode,
              summary,
              details: {
                ...(body.details ?? {}),
                watcherId: watcher.id,
                dryRun: true
              },
              idempotencyKey: body.idempotencyKey,
              actorContext
            }),
            status: "simulated"
          });

          return authenticatedJson({
            event,
            simulated: true,
            dashboard: await repository.getDashboardData(principal.userId)
          });
        }
      }

      if (body.kind === "template_due") {
        const { template } = await resolveTemplateSource(body.sourceId, principal.userId);
        summary ||= `Template due: ${template.name}`;

        if (body.dryRun) {
          const event = AutopilotEventSchema.parse({
            ...buildPendingEvent({
              userId: principal.userId,
              kind: body.kind,
              sourceId: body.sourceId,
              mode: effectiveMode,
              summary,
              details: {
                ...(body.details ?? {}),
                templateId: template.id,
                dryRun: true
              },
              idempotencyKey: body.idempotencyKey,
              actorContext
            }),
            status: "simulated"
          });

          return authenticatedJson({
            event,
            simulated: true,
            dashboard: await repository.getDashboardData(principal.userId)
          });
        }
      }

      if (body.kind === "briefing_due") {
        const { type } = await resolveBriefingSource(body.sourceId, principal.userId);
        summary ||= `Briefing due: ${type}`;

        if (body.dryRun) {
          const event = AutopilotEventSchema.parse({
            ...buildPendingEvent({
              userId: principal.userId,
              kind: body.kind,
              sourceId: body.sourceId,
              mode: effectiveMode,
              summary,
              details: {
                ...(body.details ?? {}),
                briefingType: type,
                dryRun: true
              },
              idempotencyKey: body.idempotencyKey,
              actorContext
            }),
            status: "simulated"
          });

          return authenticatedJson({
            event,
            simulated: true,
            dashboard: await repository.getDashboardData(principal.userId)
          });
        }
      }

      const claim = await repository.claimAutopilotEvent({
        userId: principal.userId,
        kind: body.kind,
        sourceId: body.sourceId,
        idempotencyKey: body.idempotencyKey ?? null,
        mode: effectiveMode,
        summary,
        details: body.details,
        actorContext,
        debounceMinutes: settings.debounceMinutes
      });

      if (claim.outcome === "duplicate" || claim.outcome === "debounced") {
        if (claim.outcome === "duplicate" && shouldEnsureAutopilotJob(claim.event)) {
          try {
            const { job } = await ensureAutopilotProcessJob(repository, claim.event);

            return authenticatedJson(
              {
                event: claim.event,
                job,
                duplicate: true,
                queued: true,
                debounced: false,
                dashboard: await repository.getDashboardData(principal.userId)
              },
              { status: 202 }
            );
          } catch {
            const processedAt = nowIso();
            const failedEvent = await repository.saveAutopilotEvent({
              ...claim.event,
              status: "failed",
              processedAt,
              details: {
                ...claim.event.details,
                ...summarizeEnqueueFailure(claim.event.createdAt, processedAt)
              },
              error: "Autopilot execution failed."
            });

            return authenticatedJson(
              {
                event: failedEvent,
                duplicate: true,
                queued: false,
                error: failedEvent.error,
                dashboard: await repository.getDashboardData(principal.userId)
              },
              { status: 500 }
            );
          }
        }

        return authenticatedJson({
          event: claim.event,
          duplicate: claim.outcome === "duplicate",
          debounced: claim.outcome === "debounced",
          dashboard: await repository.getDashboardData(principal.userId)
        });
      }

      if (effectiveMode === "notify_only") {
        const processedAt = nowIso();
        const event = await repository.saveAutopilotEvent(
          AutopilotEventSchema.parse({
            ...claim.event,
            status: "notified",
            processedAt,
            details: {
              ...claim.event.details,
              requiresReview: true,
              recoveryAction: "await_operator_review",
              processingLatencyMs: measureProcessingLatencyMs(claim.event.createdAt, processedAt)
            }
          })
        );

        return authenticatedJson({
          event,
          dashboard: await repository.getDashboardData(principal.userId)
        });
      }

      try {
        const { job } = await ensureAutopilotProcessJob(repository, claim.event);

        return authenticatedJson(
          {
            event: claim.event,
            job,
            queued: true,
            dashboard: await repository.getDashboardData(principal.userId)
          },
          { status: 202 }
        );
      } catch {
        const processedAt = nowIso();
        const failedEvent = await repository.saveAutopilotEvent(
          AutopilotEventSchema.parse({
            ...claim.event,
            status: "failed",
            processedAt,
            details: {
              ...claim.event.details,
              ...summarizeEnqueueFailure(claim.event.createdAt, processedAt)
            },
            error: "Autopilot execution failed."
          })
        );

        return authenticatedJson(
          {
            event: failedEvent,
            error: failedEvent.error,
            dashboard: await repository.getDashboardData(principal.userId)
          },
          { status: 500 }
        );
      }
    } catch (error) {
      return handleApiError(error, "Failed to trigger autopilot event.");
    }
  });
}
