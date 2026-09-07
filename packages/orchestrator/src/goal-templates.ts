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

/**
 * Get the current date/time parts in a specific timezone.
 * Returns year, month (1-12), day, hour, minute, and weekday (0=Sun).
 */
function getDatePartsInTimezone(date: Date, timezone: string): {
  year: number; month: number; day: number;
  hour: number; minute: number; weekday: number;
} {
  try {
    const formatter = new Intl.DateTimeFormat("en-US", {
      timeZone: timezone,
      year: "numeric", month: "numeric", day: "numeric",
      hour: "numeric", minute: "numeric", hour12: false,
      weekday: "short"
    });
    const parts = formatter.formatToParts(date);
    const get = (type: string) => parseInt(parts.find((p) => p.type === type)?.value ?? "0", 10);
    const weekdayMap: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
    const weekdayStr = parts.find((p) => p.type === "weekday")?.value ?? "Sun";
    return {
      year: get("year"), month: get("month"), day: get("day"),
      hour: get("hour") % 24, minute: get("minute"),
      weekday: weekdayMap[weekdayStr] ?? 0
    };
  } catch {
    // Fallback to UTC if timezone is invalid
    return {
      year: date.getUTCFullYear(), month: date.getUTCMonth() + 1, day: date.getUTCDate(),
      hour: date.getUTCHours(), minute: date.getUTCMinutes(),
      weekday: date.getUTCDay()
    };
  }
}

/**
 * Create a Date from wall-clock time in a specific timezone.
 */
function fromDateInTimezone(year: number, month: number, day: number, hour: number, minute: number, timezone: string): Date {
  // Binary search approach: create a UTC date and adjust for timezone offset
  // Start with an approximate UTC time
  let candidate = new Date(Date.UTC(year, month - 1, day, hour, minute, 0, 0));

  // Iteratively adjust: check what wall-clock time this UTC instant maps to in the target tz
  for (let i = 0; i < 3; i++) {
    const parts = getDatePartsInTimezone(candidate, timezone);
    const diffMinutes = ((hour - parts.hour) * 60) + (minute - parts.minute);
    const diffDays = day - parts.day;
    // Handle day wraparound
    let totalDiffMs = (diffDays * 24 * 60 + diffMinutes) * 60 * 1000;
    if (Math.abs(totalDiffMs) > 12 * 60 * 60 * 1000) {
      // Likely a day boundary issue, adjust sign
      totalDiffMs = totalDiffMs > 0 ? totalDiffMs - 24 * 60 * 60 * 1000 : totalDiffMs + 24 * 60 * 60 * 1000;
    }
    candidate = new Date(candidate.getTime() + totalDiffMs);
  }

  return candidate;
}

function nextDailyRun(now: Date, hour: number, minute: number, timezone: string): string {
  const parts = getDatePartsInTimezone(now, timezone);

  // Build candidate for today at the target time in the specified timezone
  let candidate = fromDateInTimezone(parts.year, parts.month, parts.day, hour, minute, timezone);

  // If today's target time has already passed, move to tomorrow
  if (candidate.getTime() <= now.getTime()) {
    const tomorrow = new Date(candidate.getTime() + 24 * 60 * 60 * 1000);
    candidate = tomorrow;
  }

  return candidate.toISOString();
}

function nextWeeklyRun(now: Date, targetDay: number, hour: number, minute: number, timezone: string): string {
  const parts = getDatePartsInTimezone(now, timezone);

  let candidate = fromDateInTimezone(parts.year, parts.month, parts.day, hour, minute, timezone);

  const currentDay = parts.weekday;
  let daysUntilTarget = targetDay - currentDay;

  if (daysUntilTarget < 0) {
    daysUntilTarget += 7;
  }

  // If it's the same day but the time has passed, advance by a full week
  if (daysUntilTarget === 0 && candidate.getTime() <= now.getTime()) {
    daysUntilTarget = 7;
  }

  candidate = new Date(candidate.getTime() + daysUntilTarget * 24 * 60 * 60 * 1000);
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
