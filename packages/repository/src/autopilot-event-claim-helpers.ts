import crypto from "node:crypto";
import {
  AutopilotEventSchema,
  nowIso,
  type ActorContext,
  type AutopilotEvent,
  type AutopilotEventKind,
  type AutopilotMode,
  type AutopilotSettings
} from "@agentic/contracts";
import { sortByCreatedDesc } from "./collection-pagination";

export type AutopilotSuppressionReason = "pending_backlog" | "event_budget_exceeded" | "failure_circuit_open";

export function buildPendingAutopilotEvent(params: {
  userId: string;
  kind: AutopilotEventKind;
  sourceId: string;
  idempotencyKey?: string | null;
  mode: AutopilotMode;
  summary: string;
  details?: Record<string, unknown>;
  actorContext?: ActorContext | null;
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
    actorContext: params.actorContext ?? null,
    createdAt: nowIso(),
    processedAt: null,
    resultGoalId: null,
    error: null
  });
}

export function countsTowardAutopilotBudget(status: AutopilotEvent["status"]): boolean {
  return status === "pending" || status === "notified" || status === "executed" || status === "failed";
}

export function countConsecutiveAutopilotFailures(events: AutopilotEvent[]): number {
  let failures = 0;

  for (const event of sortByCreatedDesc(events)) {
    if (!countsTowardAutopilotBudget(event.status)) {
      continue;
    }

    if (event.status !== "failed") {
      break;
    }

    failures += 1;
  }

  return failures;
}

export function buildSuppressedAutopilotEvent(params: {
  userId: string;
  kind: AutopilotEventKind;
  sourceId: string;
  idempotencyKey?: string | null;
  mode: AutopilotMode;
  summary: string;
  details?: Record<string, unknown>;
  actorContext?: ActorContext | null;
  suppression: {
    reason: AutopilotSuppressionReason;
    budgetWindowMinutes: number;
    recentBudgetedEventCount: number;
    maxEventsPerWindow: number;
    pendingEventCount: number;
    maxPendingEvents: number;
    consecutiveFailureCount: number;
    maxConsecutiveFailures: number;
  };
}): AutopilotEvent {
  return AutopilotEventSchema.parse({
    ...buildPendingAutopilotEvent({
      userId: params.userId,
      kind: params.kind,
      sourceId: params.sourceId,
      idempotencyKey: params.idempotencyKey,
      mode: params.mode,
      summary: params.summary,
      actorContext: params.actorContext,
      details: {
        ...(params.details ?? {}),
        suppression: params.suppression
      }
    }),
    status: "ignored",
    processedAt: nowIso()
  });
}

export function evaluateAutopilotClaimControls(params: {
  recentEvents: AutopilotEvent[];
  reliabilityControls: AutopilotSettings["reliabilityControls"];
}):
  | {
      outcome: "allow";
      recentBudgetedEventCount: number;
      pendingEventCount: number;
      consecutiveFailureCount: number;
    }
  | {
      outcome: "suppress";
      reason: AutopilotSuppressionReason;
      recentBudgetedEventCount: number;
      pendingEventCount: number;
      consecutiveFailureCount: number;
    } {
  const recentBudgetedEventCount = params.recentEvents.filter((event) => countsTowardAutopilotBudget(event.status)).length;
  const pendingEventCount = params.recentEvents.filter((event) => event.status === "pending").length;
  const consecutiveFailureCount = countConsecutiveAutopilotFailures(params.recentEvents);

  if (consecutiveFailureCount >= params.reliabilityControls.maxConsecutiveFailures) {
    return {
      outcome: "suppress",
      reason: "failure_circuit_open",
      recentBudgetedEventCount,
      pendingEventCount,
      consecutiveFailureCount
    };
  }

  if (pendingEventCount >= params.reliabilityControls.maxPendingEvents) {
    return {
      outcome: "suppress",
      reason: "pending_backlog",
      recentBudgetedEventCount,
      pendingEventCount,
      consecutiveFailureCount
    };
  }

  if (recentBudgetedEventCount >= params.reliabilityControls.maxEventsPerWindow) {
    return {
      outcome: "suppress",
      reason: "event_budget_exceeded",
      recentBudgetedEventCount,
      pendingEventCount,
      consecutiveFailureCount
    };
  }

  return {
    outcome: "allow",
    recentBudgetedEventCount,
    pendingEventCount,
    consecutiveFailureCount
  };
}
