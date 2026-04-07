import {
  GoalTemplateSchema,
  nowIso,
  type GoalTemplate
} from "@agentic/contracts";

export function createGoalTemplate(params: {
  userId: string;
  name: string;
  description?: string;
  request: string;
  parameters?: Record<string, string>;
  schedule?: { enabled: boolean; cron: string; timezone: string };
}): GoalTemplate {
  const now = nowIso();
  const nextRunAt = params.schedule?.enabled && params.schedule.cron
    ? computeNextRun(params.schedule.cron, params.schedule.timezone)
    : null;

  return GoalTemplateSchema.parse({
    id: crypto.randomUUID(),
    userId: params.userId,
    name: params.name,
    description: params.description ?? "",
    request: params.request,
    parameters: params.parameters ?? {},
    schedule: {
      enabled: params.schedule?.enabled ?? false,
      cron: params.schedule?.cron ?? "",
      timezone: params.schedule?.timezone ?? "UTC",
      lastRunAt: null,
      nextRunAt
    },
    createdAt: now,
    updatedAt: now
  });
}

export function interpolateTemplate(
  template: GoalTemplate,
  overrides?: Record<string, string>
): string {
  const merged: Record<string, string> = {
    ...template.parameters,
    ...overrides
  };

  // Built-in parameters
  if (!merged["date"]) {
    merged["date"] = new Date().toISOString().slice(0, 10);
  }

  let result = template.request;

  for (const [key, value] of Object.entries(merged)) {
    result = result.replaceAll(`[${key}]`, value);
  }

  return result;
}

/**
 * Simple cron parser for common patterns.
 * Supports:
 *   - "M H * * *"     => daily at H:M
 *   - "M H * * D"     => weekly on day D at H:M
 * where D is 0-6 (0 = Sunday) or 1-7 with 7 = Sunday.
 *
 * Returns ISO datetime string of the next run, or null if the pattern is not recognized.
 */
export function computeNextRun(cron: string, timezone: string): string | null {
  const parts = cron.trim().split(/\s+/);

  if (parts.length !== 5) {
    return null;
  }

  const [minuteStr, hourStr, dayOfMonth, month, dayOfWeek] = parts;
  const minute = Number(minuteStr);
  const hour = Number(hourStr);

  if (Number.isNaN(minute) || Number.isNaN(hour)) {
    return null;
  }

  if (minute < 0 || minute > 59 || hour < 0 || hour > 23) {
    return null;
  }

  const now = new Date();

  // Daily schedule: "M H * * *"
  if (dayOfMonth === "*" && month === "*" && dayOfWeek === "*") {
    return nextDailyRun(now, hour, minute, timezone);
  }

  // Weekly schedule: "M H * * D"
  if (dayOfMonth === "*" && month === "*" && dayOfWeek !== "*") {
    const targetDay = Number(dayOfWeek);

    if (Number.isNaN(targetDay) || targetDay < 0 || targetDay > 7) {
      return null;
    }

    // Normalize day 7 (Sunday in some systems) to 0
    const normalizedDay = targetDay === 7 ? 0 : targetDay;
    return nextWeeklyRun(now, normalizedDay, hour, minute, timezone);
  }

  return null;
}

function nextDailyRun(now: Date, hour: number, minute: number, _timezone: string): string {
  const candidate = new Date(now);
  candidate.setHours(hour, minute, 0, 0);

  // If today's target time has already passed, move to tomorrow
  if (candidate.getTime() <= now.getTime()) {
    candidate.setDate(candidate.getDate() + 1);
  }

  return candidate.toISOString();
}

function nextWeeklyRun(now: Date, targetDay: number, hour: number, minute: number, _timezone: string): string {
  const candidate = new Date(now);
  candidate.setHours(hour, minute, 0, 0);

  const currentDay = candidate.getDay();
  let daysUntilTarget = targetDay - currentDay;

  if (daysUntilTarget < 0) {
    daysUntilTarget += 7;
  }

  // If it's the same day but the time has passed, advance by a full week
  if (daysUntilTarget === 0 && candidate.getTime() <= now.getTime()) {
    daysUntilTarget = 7;
  }

  candidate.setDate(candidate.getDate() + daysUntilTarget);
  return candidate.toISOString();
}

export function shouldTemplateRun(template: GoalTemplate): boolean {
  if (!template.schedule.enabled) {
    return false;
  }

  if (!template.schedule.cron) {
    return false;
  }

  if (!template.schedule.nextRunAt) {
    return false;
  }

  const now = new Date();
  const nextRun = new Date(template.schedule.nextRunAt);

  return now.getTime() >= nextRun.getTime();
}
