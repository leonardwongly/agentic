import crypto from "node:crypto";
import {
  AutopilotEventSchema,
  nowIso,
  type AutopilotEvent,
  type ActorContext,
  type AutopilotMode
} from "@agentic/contracts";
import { enqueueAutopilotProcessJob } from "@agentic/worker-runtime";
import {
  authenticatedRateLimitError,
  authenticatedJson,
  handleApiError,
  parseJsonBody,
  withApiTelemetry
} from "../../../../lib/api-response";
import { requireJsonContentType } from "../../../../lib/api-errors";
import { requireApiSession } from "../../../../lib/auth";
import { createActorContextFromPrincipal } from "../../../../lib/actor-context";
import {
  buildDryRunAutopilotEvent,
  normalizeAutopilotEventRequest,
  TriggerAutopilotEventSchema
} from "../../../../lib/autopilot-event-fabric";
import { checkAbuseRateLimit } from "../../../../lib/abuse-rate-limit";
import { getSeededRepository } from "../../../../lib/server";
import type { AgenticRepository } from "@agentic/repository";

function buildPendingEvent(params: {
  userId: string;
  kind: AutopilotEvent["kind"];
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
      const normalized = await normalizeAutopilotEventRequest({
        repository,
        userId: principal.userId,
        body
      });

      if (effectiveMode === "auto_run" && repository.backend !== "postgres") {
        return authenticatedJson(
          {
            error: "Autopilot auto-run requires Postgres-backed persistence.",
            backend: repository.backend
          },
          { status: 409 }
        );
      }

      if (body.dryRun) {
        const event = buildDryRunAutopilotEvent({
          dryRun: true,
          event: buildPendingEvent({
            userId: principal.userId,
            kind: body.kind,
            sourceId: body.sourceId,
            mode: effectiveMode,
            summary: normalized.summary,
            details: normalized.details,
            idempotencyKey: body.idempotencyKey,
            actorContext
          })
        });

        return authenticatedJson({
          event,
          simulated: true,
          dashboard: await repository.getDashboardData(principal.userId)
        });
      }

      const claim = await repository.claimAutopilotEvent({
        userId: principal.userId,
        kind: body.kind,
        sourceId: body.sourceId,
        idempotencyKey: body.idempotencyKey ?? null,
        mode: effectiveMode,
        summary: normalized.summary,
        details: normalized.details,
        actorContext,
        debounceMinutes: settings.debounceMinutes,
        reliabilityControls: settings.reliabilityControls
      });

      if (claim.outcome === "duplicate" || claim.outcome === "debounced" || claim.outcome === "suppressed") {
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
          suppressed: claim.outcome === "suppressed",
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
