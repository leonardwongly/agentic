import { google } from "googleapis";
import { z } from "zod";

const EmailMessageSchema = z.object({
  id: z.string(),
  threadId: z.string(),
  from: z.string(),
  to: z.string(),
  subject: z.string(),
  snippet: z.string(),
  body: z.string(),
  date: z.string(),
  isUnread: z.boolean(),
  labels: z.array(z.string())
});

export type EmailMessage = z.infer<typeof EmailMessageSchema>;

const DraftResultSchema = z.object({
  id: z.string(),
  threadId: z.string().nullable(),
  to: z.string(),
  subject: z.string(),
  body: z.string()
});

export type DraftResult = z.infer<typeof DraftResultSchema>;

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

function getGmailClient() {
  const auth = getOAuth2Client();
  if (!auth) return null;
  return google.gmail({ version: "v1", auth });
}

function decodeBase64Url(data: string): string {
  return Buffer.from(data.replace(/-/g, "+").replace(/_/g, "/"), "base64").toString("utf8");
}

function extractHeader(headers: Array<{ name: string; value: string }>, name: string): string {
  return headers.find((h) => h.name.toLowerCase() === name.toLowerCase())?.value ?? "";
}

function extractBody(payload: any): string {
  if (payload.body?.data) {
    return decodeBase64Url(payload.body.data);
  }
  if (payload.parts) {
    const textPart = payload.parts.find((p: any) => p.mimeType === "text/plain");
    if (textPart?.body?.data) {
      return decodeBase64Url(textPart.body.data);
    }
    const htmlPart = payload.parts.find((p: any) => p.mimeType === "text/html");
    if (htmlPart?.body?.data) {
      return decodeBase64Url(htmlPart.body.data);
    }
  }
  return "";
}

export function isGmailReady(): boolean {
  return getOAuth2Client() !== null;
}

export async function listRecentEmails(maxResults = 10, query?: string): Promise<EmailMessage[]> {
  const gmail = getGmailClient();
  if (!gmail) throw new Error("Gmail not configured. Set GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, and GOOGLE_REFRESH_TOKEN.");

  const listResponse = await gmail.users.messages.list({
    userId: "me",
    maxResults,
    q: query ?? "in:inbox"
  });

  const messageIds = listResponse.data.messages ?? [];
  const messages: EmailMessage[] = [];

  for (const msg of messageIds.slice(0, maxResults)) {
    const detail = await gmail.users.messages.get({
      userId: "me",
      id: msg.id!,
      format: "full"
    });

    const headers = (detail.data.payload?.headers ?? []) as Array<{ name: string; value: string }>;
    const body = extractBody(detail.data.payload);

    messages.push(EmailMessageSchema.parse({
      id: detail.data.id!,
      threadId: detail.data.threadId!,
      from: extractHeader(headers, "From"),
      to: extractHeader(headers, "To"),
      subject: extractHeader(headers, "Subject"),
      snippet: detail.data.snippet ?? "",
      body: body.slice(0, 2000),
      date: extractHeader(headers, "Date"),
      isUnread: (detail.data.labelIds ?? []).includes("UNREAD"),
      labels: detail.data.labelIds ?? []
    }));
  }

  return messages;
}

export async function searchEmails(query: string, maxResults = 10): Promise<EmailMessage[]> {
  return listRecentEmails(maxResults, query);
}

export async function createDraft(params: { to: string; subject: string; body: string; threadId?: string }): Promise<DraftResult> {
  const gmail = getGmailClient();
  if (!gmail) throw new Error("Gmail not configured.");

  const rawMessage = [
    `To: ${params.to}`,
    `Subject: ${params.subject}`,
    "Content-Type: text/plain; charset=utf-8",
    "",
    params.body
  ].join("\r\n");

  const encodedMessage = Buffer.from(rawMessage).toString("base64url");

  const response = await gmail.users.drafts.create({
    userId: "me",
    requestBody: {
      message: {
        raw: encodedMessage,
        threadId: params.threadId ?? undefined
      }
    }
  });

  return DraftResultSchema.parse({
    id: response.data.id!,
    threadId: params.threadId ?? null,
    to: params.to,
    subject: params.subject,
    body: params.body
  });
}

export async function sendDraft(draftId: string): Promise<{ messageId: string }> {
  const gmail = getGmailClient();
  if (!gmail) throw new Error("Gmail not configured.");

  const response = await gmail.users.drafts.send({
    userId: "me",
    requestBody: { id: draftId }
  });

  return { messageId: response.data.id! };
}
