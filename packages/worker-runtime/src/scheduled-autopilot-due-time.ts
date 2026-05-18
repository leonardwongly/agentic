import type { AutopilotEvent } from "@agentic/contracts";

export function getScheduledAutopilotDueTime(event: AutopilotEvent): {
  due: boolean;
  dueAt: string | null;
  reason?: string;
} {
  if (event.kind !== "template_due" && event.kind !== "briefing_due") {
    return {
      due: true,
      dueAt: null
    };
  }

  const dueAt = typeof event.details.dueAt === "string" ? event.details.dueAt : null;
  const dueMs = dueAt ? Date.parse(dueAt) : Number.NaN;

  if (!dueAt || !Number.isFinite(dueMs)) {
    return {
      due: false,
      dueAt,
      reason: "missing_due_time"
    };
  }

  if (dueMs > Date.now()) {
    return {
      due: false,
      dueAt,
      reason: "future_due_time"
    };
  }

  return {
    due: true,
    dueAt
  };
}
