import { google } from "googleapis";
import { z } from "zod";
import { logError, recordCounter, withSpan, withTelemetryContext } from "@agentic/observability";
import { createGoogleOAuthClient } from "./google-oauth";
import {
  createInvalidConnectorRequestError,
  createConnectorTimeoutSignal,
  normalizeConnectorThrownError
} from "./connector-errors";

const GOOGLE_CALENDAR_MUTATION_TIMEOUT_MS = 10_000;
const GOOGLE_CALENDAR_IDEMPOTENCY_PROPERTY = "agenticIdempotencyKey";

const CalendarEventSchema = z.object({
  id: z.string(),
  summary: z.string(),
  description: z.string(),
  start: z.string(),
  end: z.string(),
  location: z.string(),
  status: z.string(),
  organizer: z.string(),
  attendees: z.array(z.string()),
  isAllDay: z.boolean()
});

export type CalendarEvent = z.infer<typeof CalendarEventSchema>;

const CreatedEventSchema = z.object({
  id: z.string(),
  summary: z.string(),
  start: z.string(),
  end: z.string(),
  htmlLink: z.string()
});

export type CreatedEvent = z.infer<typeof CreatedEventSchema>;

function getOAuth2Client(refreshToken = process.env.GOOGLE_REFRESH_TOKEN) {
  const normalizedRefreshToken = refreshToken?.trim();

  if (!normalizedRefreshToken) {
    return null;
  }

  return createGoogleOAuthClient({ refreshToken: normalizedRefreshToken });
}

function getCalendarClient(refreshToken = process.env.GOOGLE_REFRESH_TOKEN) {
  const auth = getOAuth2Client(refreshToken);
  if (!auth) return null;
  return google.calendar({ version: "v3", auth });
}

function formatDateTime(dt: any): string {
  if (!dt) return "";
  return dt.dateTime ?? dt.date ?? "";
}

function buildCalendarMutationSignal(signal?: AbortSignal) {
  return createConnectorTimeoutSignal({
    timeoutMs: GOOGLE_CALENDAR_MUTATION_TIMEOUT_MS,
    signal
  });
}

function requireCalendarIdempotencyKey(operation: string, idempotencyKey: string | undefined): string {
  const normalized = idempotencyKey?.trim();

  if (!normalized) {
    throw createInvalidConnectorRequestError({
      provider: "google_calendar",
      operation,
      message: `Google Calendar ${operation} requires an idempotency key before provider mutation.`
    });
  }

  return normalized;
}

function parseCreatedCalendarEvent(
  event: { id?: string | null; summary?: string | null; start?: unknown; end?: unknown; htmlLink?: string | null },
  fallback: { summary: string; start: string; end: string }
): CreatedEvent {
  return CreatedEventSchema.parse({
    id: event.id!,
    summary: event.summary ?? fallback.summary,
    start: formatDateTime(event.start) || fallback.start,
    end: formatDateTime(event.end) || fallback.end,
    htmlLink: event.htmlLink ?? ""
  });
}

export function isCalendarReady(): boolean {
  return getOAuth2Client() !== null;
}

export type GoogleCalendarAdapter = {
  listUpcomingEvents: (params?: { maxResults?: number; timeMin?: string; timeMax?: string; calendarId?: string }) => Promise<CalendarEvent[]>;
  searchEvents: (query: string, params?: { timeMin?: string; timeMax?: string; maxResults?: number }) => Promise<CalendarEvent[]>;
  createEvent: (params: {
    summary: string;
    description?: string;
    start: string;
    end: string;
    location?: string;
    attendees?: string[];
    calendarId?: string;
    idempotencyKey?: string;
    signal?: AbortSignal;
  }) => Promise<CreatedEvent>;
  updateEvent: (params: {
    eventId: string;
    summary?: string;
    description?: string;
    start?: string;
    end?: string;
    location?: string;
    calendarId?: string;
    signal?: AbortSignal;
  }) => Promise<CreatedEvent>;
};

export function createCalendarAdapter(params: { refreshToken: string }): GoogleCalendarAdapter {
  const getClient = () => {
    const calendar = getCalendarClient(params.refreshToken);

    if (!calendar) {
      throw new Error("Google Calendar not configured.");
    }

    return calendar;
  };

  const instrumentCalendarCall = <T>(
    operation: string,
    attributes: Record<string, unknown>,
    handler: () => Promise<T>
  ) =>
    withTelemetryContext(
      {
        provider: "google_calendar"
      },
      async () =>
        withSpan(
          "integration.google_calendar.call",
          {
            provider: "google_calendar",
            operation,
            ...attributes
          },
          async () => {
            try {
              const result = await handler();
              recordCounter("integration.call.total", 1, {
                provider: "google_calendar",
                operation,
                outcome: "success"
              });
              return result;
            } catch (error) {
              recordCounter("integration.call.total", 1, {
                provider: "google_calendar",
                operation,
                outcome: "error"
              });
              const normalizedError = normalizeConnectorThrownError({
                provider: "google_calendar",
                operation,
                error
              });
              logError("integration.google_calendar.call_failed", normalizedError, {
                operation
              });
              throw normalizedError;
            }
          }
        )
    );

  return {
    async listUpcomingEvents(paramsList) {
      return instrumentCalendarCall(
        "events.list_upcoming",
        {
          maxResults: paramsList?.maxResults ?? 20,
          hasTimeMin: Boolean(paramsList?.timeMin),
          hasTimeMax: Boolean(paramsList?.timeMax)
        },
        async () => {
          const calendar = getClient();
          const now = new Date();
          const oneWeekLater = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);

          const response = await calendar.events.list({
            calendarId: paramsList?.calendarId ?? "primary",
            timeMin: paramsList?.timeMin ?? now.toISOString(),
            timeMax: paramsList?.timeMax ?? oneWeekLater.toISOString(),
            maxResults: paramsList?.maxResults ?? 20,
            singleEvents: true,
            orderBy: "startTime"
          });

          return (response.data.items ?? []).map((event) =>
            CalendarEventSchema.parse({
              id: event.id ?? "",
              summary: event.summary ?? "(No title)",
              description: event.description ?? "",
              start: formatDateTime(event.start),
              end: formatDateTime(event.end),
              location: event.location ?? "",
              status: event.status ?? "confirmed",
              organizer: event.organizer?.email ?? "",
              attendees: (event.attendees ?? []).map((a) => a.email ?? "").filter(Boolean),
              isAllDay: !event.start?.dateTime
            })
          );
        }
      );
    },
    async searchEvents(query: string, paramsSearch) {
      return instrumentCalendarCall(
        "events.search",
        {
          hasQuery: Boolean(query),
          maxResults: paramsSearch?.maxResults ?? 20,
          hasTimeMin: Boolean(paramsSearch?.timeMin),
          hasTimeMax: Boolean(paramsSearch?.timeMax)
        },
        async () => {
          const calendar = getClient();
          const now = new Date();
          const threeMonthsLater = new Date(now.getTime() + 90 * 24 * 60 * 60 * 1000);

          const response = await calendar.events.list({
            calendarId: "primary",
            q: query,
            timeMin: paramsSearch?.timeMin ?? now.toISOString(),
            timeMax: paramsSearch?.timeMax ?? threeMonthsLater.toISOString(),
            maxResults: paramsSearch?.maxResults ?? 20,
            singleEvents: true,
            orderBy: "startTime"
          });

          return (response.data.items ?? []).map((event) =>
            CalendarEventSchema.parse({
              id: event.id ?? "",
              summary: event.summary ?? "(No title)",
              description: event.description ?? "",
              start: formatDateTime(event.start),
              end: formatDateTime(event.end),
              location: event.location ?? "",
              status: event.status ?? "confirmed",
              organizer: event.organizer?.email ?? "",
              attendees: (event.attendees ?? []).map((a) => a.email ?? "").filter(Boolean),
              isAllDay: !event.start?.dateTime
            })
          );
        }
      );
    },
    async createEvent(paramsCreate: { summary: string; start: string; end: string; description?: string; location?: string; attendees?: string[]; calendarId?: string; idempotencyKey?: string; signal?: AbortSignal }) {
      return instrumentCalendarCall(
        "events.create",
        {
          attendeeCount: paramsCreate.attendees?.length ?? 0,
          isAllDay: paramsCreate.start.length === 10,
          hasLocation: Boolean(paramsCreate.location),
          hasIdempotencyKey: Boolean(paramsCreate.idempotencyKey)
        },
        async () => {
          const calendar = getClient();
          const idempotencyKey = requireCalendarIdempotencyKey("events.create", paramsCreate.idempotencyKey);
          const isAllDay = paramsCreate.start.length === 10;
          const requestOptions = {
            signal: buildCalendarMutationSignal(paramsCreate.signal)
          };

          const existing = await calendar.events.list({
            calendarId: paramsCreate.calendarId ?? "primary",
            maxResults: 1,
            privateExtendedProperty: [
              `${GOOGLE_CALENDAR_IDEMPOTENCY_PROPERTY}=${idempotencyKey}`
            ],
            singleEvents: false
          }, requestOptions);
          const existingEvent = existing.data.items?.[0];

          if (existingEvent?.id) {
            return parseCreatedCalendarEvent(existingEvent, {
              summary: paramsCreate.summary,
              start: paramsCreate.start,
              end: paramsCreate.end
            });
          }

          const response = await calendar.events.insert({
            calendarId: paramsCreate.calendarId ?? "primary",
            requestBody: {
              summary: paramsCreate.summary,
              description: paramsCreate.description,
              location: paramsCreate.location,
              start: isAllDay ? { date: paramsCreate.start } : { dateTime: paramsCreate.start },
              end: isAllDay ? { date: paramsCreate.end } : { dateTime: paramsCreate.end },
              attendees: paramsCreate.attendees?.map((email) => ({ email })),
              extendedProperties: {
                private: {
                  [GOOGLE_CALENDAR_IDEMPOTENCY_PROPERTY]: idempotencyKey
                }
              }
            }
          }, requestOptions);

          return parseCreatedCalendarEvent(response.data, {
            summary: paramsCreate.summary,
            start: paramsCreate.start,
            end: paramsCreate.end
          });
        }
      );
    },
    async updateEvent(paramsUpdate) {
      return instrumentCalendarCall(
        "events.update",
        {
          hasSummary: typeof paramsUpdate.summary === "string",
          hasDescription: typeof paramsUpdate.description === "string",
          hasLocation: typeof paramsUpdate.location === "string",
          hasStart: typeof paramsUpdate.start === "string",
          hasEnd: typeof paramsUpdate.end === "string"
        },
        async () => {
          const calendar = getClient();
          const requestOptions = {
            signal: buildCalendarMutationSignal(paramsUpdate.signal)
          };
          const existing = await calendar.events.get({
            calendarId: paramsUpdate.calendarId ?? "primary",
            eventId: paramsUpdate.eventId
          }, requestOptions);

          const isAllDay = paramsUpdate.start ? paramsUpdate.start.length === 10 : !existing.data.start?.dateTime;

          const response = await calendar.events.patch({
            calendarId: paramsUpdate.calendarId ?? "primary",
            eventId: paramsUpdate.eventId,
            requestBody: {
              summary: paramsUpdate.summary ?? existing.data.summary ?? undefined,
              description: paramsUpdate.description ?? existing.data.description ?? undefined,
              location: paramsUpdate.location ?? existing.data.location ?? undefined,
              start: paramsUpdate.start ? (isAllDay ? { date: paramsUpdate.start } : { dateTime: paramsUpdate.start }) : undefined,
              end: paramsUpdate.end ? (isAllDay ? { date: paramsUpdate.end } : { dateTime: paramsUpdate.end }) : undefined
            }
          }, requestOptions);

          return CreatedEventSchema.parse({
            id: response.data.id!,
            summary: response.data.summary ?? "",
            start: formatDateTime(response.data.start),
            end: formatDateTime(response.data.end),
            htmlLink: response.data.htmlLink ?? ""
          });
        }
      );
    }
  };
}

export async function listUpcomingEvents(params?: { maxResults?: number; timeMin?: string; timeMax?: string; calendarId?: string }): Promise<CalendarEvent[]> {
  const refreshToken = process.env.GOOGLE_REFRESH_TOKEN?.trim();

  if (!refreshToken) {
    throw new Error("Google Calendar not configured. Set GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, and GOOGLE_REFRESH_TOKEN.");
  }

  return createCalendarAdapter({ refreshToken }).listUpcomingEvents(params);
}

export async function searchEvents(query: string, params?: { timeMin?: string; timeMax?: string; maxResults?: number }): Promise<CalendarEvent[]> {
  const refreshToken = process.env.GOOGLE_REFRESH_TOKEN?.trim();

  if (!refreshToken) {
    throw new Error("Google Calendar not configured.");
  }

  return createCalendarAdapter({ refreshToken }).searchEvents(query, params);
}

export async function createEvent(params: {
  summary: string;
  description?: string;
  start: string;
  end: string;
  location?: string;
  attendees?: string[];
  calendarId?: string;
  idempotencyKey?: string;
  signal?: AbortSignal;
}): Promise<CreatedEvent> {
  const refreshToken = process.env.GOOGLE_REFRESH_TOKEN?.trim();

  if (!refreshToken) {
    throw new Error("Google Calendar not configured.");
  }

  return createCalendarAdapter({ refreshToken }).createEvent(params);
}

export async function updateEvent(params: {
  eventId: string;
  summary?: string;
  description?: string;
  start?: string;
  end?: string;
  location?: string;
  calendarId?: string;
  signal?: AbortSignal;
}): Promise<CreatedEvent> {
  const refreshToken = process.env.GOOGLE_REFRESH_TOKEN?.trim();

  if (!refreshToken) {
    throw new Error("Google Calendar not configured.");
  }

  return createCalendarAdapter({ refreshToken }).updateEvent(params);
}
