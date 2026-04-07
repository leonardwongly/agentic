import { google } from "googleapis";
import { z } from "zod";

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

function getOAuth2Client() {
  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
  const refreshToken = process.env.GOOGLE_REFRESH_TOKEN;

  if (!clientId || !clientSecret || !refreshToken) {
    return null;
  }

  const oauth2 = new google.auth.OAuth2(clientId, clientSecret);
  oauth2.setCredentials({ refresh_token: refreshToken });
  return oauth2;
}

function getCalendarClient() {
  const auth = getOAuth2Client();
  if (!auth) return null;
  return google.calendar({ version: "v3", auth });
}

function formatDateTime(dt: any): string {
  if (!dt) return "";
  return dt.dateTime ?? dt.date ?? "";
}

export function isCalendarReady(): boolean {
  return getOAuth2Client() !== null;
}

export async function listUpcomingEvents(params?: { maxResults?: number; timeMin?: string; timeMax?: string; calendarId?: string }): Promise<CalendarEvent[]> {
  const calendar = getCalendarClient();
  if (!calendar) throw new Error("Google Calendar not configured. Set GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, and GOOGLE_REFRESH_TOKEN.");

  const now = new Date();
  const oneWeekLater = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);

  const response = await calendar.events.list({
    calendarId: params?.calendarId ?? "primary",
    timeMin: params?.timeMin ?? now.toISOString(),
    timeMax: params?.timeMax ?? oneWeekLater.toISOString(),
    maxResults: params?.maxResults ?? 20,
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

export async function searchEvents(query: string, params?: { timeMin?: string; timeMax?: string; maxResults?: number }): Promise<CalendarEvent[]> {
  const calendar = getCalendarClient();
  if (!calendar) throw new Error("Google Calendar not configured.");

  const now = new Date();
  const threeMonthsLater = new Date(now.getTime() + 90 * 24 * 60 * 60 * 1000);

  const response = await calendar.events.list({
    calendarId: "primary",
    q: query,
    timeMin: params?.timeMin ?? now.toISOString(),
    timeMax: params?.timeMax ?? threeMonthsLater.toISOString(),
    maxResults: params?.maxResults ?? 20,
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

export async function createEvent(params: {
  summary: string;
  description?: string;
  start: string;
  end: string;
  location?: string;
  attendees?: string[];
  calendarId?: string;
}): Promise<CreatedEvent> {
  const calendar = getCalendarClient();
  if (!calendar) throw new Error("Google Calendar not configured.");

  const isAllDay = params.start.length === 10;

  const response = await calendar.events.insert({
    calendarId: params.calendarId ?? "primary",
    requestBody: {
      summary: params.summary,
      description: params.description,
      location: params.location,
      start: isAllDay ? { date: params.start } : { dateTime: params.start },
      end: isAllDay ? { date: params.end } : { dateTime: params.end },
      attendees: params.attendees?.map((email) => ({ email }))
    }
  });

  return CreatedEventSchema.parse({
    id: response.data.id!,
    summary: response.data.summary ?? params.summary,
    start: formatDateTime(response.data.start),
    end: formatDateTime(response.data.end),
    htmlLink: response.data.htmlLink ?? ""
  });
}

export async function updateEvent(params: {
  eventId: string;
  summary?: string;
  description?: string;
  start?: string;
  end?: string;
  location?: string;
  calendarId?: string;
}): Promise<CreatedEvent> {
  const calendar = getCalendarClient();
  if (!calendar) throw new Error("Google Calendar not configured.");

  const existing = await calendar.events.get({
    calendarId: params.calendarId ?? "primary",
    eventId: params.eventId
  });

  const isAllDay = params.start ? params.start.length === 10 : !existing.data.start?.dateTime;

  const response = await calendar.events.patch({
    calendarId: params.calendarId ?? "primary",
    eventId: params.eventId,
    requestBody: {
      summary: params.summary ?? existing.data.summary ?? undefined,
      description: params.description ?? existing.data.description ?? undefined,
      location: params.location ?? existing.data.location ?? undefined,
      start: params.start ? (isAllDay ? { date: params.start } : { dateTime: params.start }) : undefined,
      end: params.end ? (isAllDay ? { date: params.end } : { dateTime: params.end }) : undefined
    }
  });

  return CreatedEventSchema.parse({
    id: response.data.id!,
    summary: response.data.summary ?? "",
    start: formatDateTime(response.data.start),
    end: formatDateTime(response.data.end),
    htmlLink: response.data.htmlLink ?? ""
  });
}
