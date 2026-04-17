import { google } from "googleapis";
import { z } from "zod";
import { logError, recordCounter, withSpan, withTelemetryContext } from "@agentic/observability";
import { createGoogleOAuthClient } from "./google-oauth";

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

function getOAuth2Client(refreshToken = process.env.GOOGLE_REFRESH_TOKEN) {
  const normalizedRefreshToken = refreshToken?.trim();

  if (!normalizedRefreshToken) {
    return null;
  }

  return createGoogleOAuthClient({ refreshToken: normalizedRefreshToken });
}

function getGmailClient(refreshToken = process.env.GOOGLE_REFRESH_TOKEN) {
  const auth = getOAuth2Client(refreshToken);
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

export type GmailAdapter = {
  listRecentEmails: (maxResults?: number, query?: string) => Promise<EmailMessage[]>;
  searchEmails: (query: string, maxResults?: number) => Promise<EmailMessage[]>;
  createDraft: (params: { to: string; subject: string; body: string; threadId?: string }) => Promise<DraftResult>;
  sendDraft: (draftId: string) => Promise<{ messageId: string }>;
};

export function createGmailAdapter(params: { refreshToken: string }): GmailAdapter {
  const getClient = () => {
    const gmail = getGmailClient(params.refreshToken);

    if (!gmail) {
      throw new Error("Gmail not configured.");
    }

    return gmail;
  };

  const instrumentGmailCall = <T>(
    operation: string,
    attributes: Record<string, unknown>,
    handler: () => Promise<T>
  ) =>
    withTelemetryContext(
      {
        provider: "gmail"
      },
      async () =>
        withSpan(
          "integration.gmail.call",
          {
            provider: "gmail",
            operation,
            ...attributes
          },
          async () => {
            try {
              const result = await handler();
              recordCounter("integration.call.total", 1, {
                provider: "gmail",
                operation,
                outcome: "success"
              });
              return result;
            } catch (error) {
              recordCounter("integration.call.total", 1, {
                provider: "gmail",
                operation,
                outcome: "error"
              });
              logError("integration.gmail.call_failed", error, {
                operation
              });
              throw error;
            }
          }
        )
    );

  const listMessages = async (maxResults = 10, query?: string) => {
    return instrumentGmailCall(
      "messages.list",
      {
        maxResults,
        hasQuery: Boolean(query)
      },
      async () => {
        const gmail = getClient();

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
    );
  };

  return {
    listRecentEmails: listMessages,
    async searchEmails(query: string, maxResults = 10) {
      return listMessages(maxResults, query);
    },
    async createDraft(paramsDraft: { to: string; subject: string; body: string; threadId?: string }) {
      return instrumentGmailCall(
        "drafts.create",
        {
          hasThreadId: Boolean(paramsDraft.threadId),
          subjectLength: paramsDraft.subject.length,
          bodyLength: paramsDraft.body.length
        },
        async () => {
          const gmail = getClient();
          const rawMessage = [
            `To: ${paramsDraft.to}`,
            `Subject: ${paramsDraft.subject}`,
            "Content-Type: text/plain; charset=utf-8",
            "",
            paramsDraft.body
          ].join("\r\n");

          const encodedMessage = Buffer.from(rawMessage).toString("base64url");

          const response = await gmail.users.drafts.create({
            userId: "me",
            requestBody: {
              message: {
                raw: encodedMessage,
                threadId: paramsDraft.threadId ?? undefined
              }
            }
          });

          return DraftResultSchema.parse({
            id: response.data.id!,
            threadId: paramsDraft.threadId ?? null,
            to: paramsDraft.to,
            subject: paramsDraft.subject,
            body: paramsDraft.body
          });
        }
      );
    },
    async sendDraft(draftId: string) {
      return instrumentGmailCall(
        "drafts.send",
        {},
        async () => {
          const gmail = getClient();
          const response = await gmail.users.drafts.send({
            userId: "me",
            requestBody: { id: draftId }
          });

          return { messageId: response.data.id! };
        }
      );
    }
  };
}

export async function listRecentEmails(maxResults = 10, query?: string): Promise<EmailMessage[]> {
  const refreshToken = process.env.GOOGLE_REFRESH_TOKEN?.trim();

  if (!refreshToken) {
    throw new Error("Gmail not configured. Set GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, and GOOGLE_REFRESH_TOKEN.");
  }

  return createGmailAdapter({ refreshToken }).listRecentEmails(maxResults, query);
}

export async function searchEmails(query: string, maxResults = 10): Promise<EmailMessage[]> {
  const refreshToken = process.env.GOOGLE_REFRESH_TOKEN?.trim();

  if (!refreshToken) {
    throw new Error("Gmail not configured.");
  }

  return createGmailAdapter({ refreshToken }).searchEmails(query, maxResults);
}

export async function createDraft(params: { to: string; subject: string; body: string; threadId?: string }): Promise<DraftResult> {
  const refreshToken = process.env.GOOGLE_REFRESH_TOKEN?.trim();

  if (!refreshToken) {
    throw new Error("Gmail not configured.");
  }

  return createGmailAdapter({ refreshToken }).createDraft(params);
}

export async function sendDraft(draftId: string): Promise<{ messageId: string }> {
  const refreshToken = process.env.GOOGLE_REFRESH_TOKEN?.trim();

  if (!refreshToken) {
    throw new Error("Gmail not configured.");
  }

  return createGmailAdapter({ refreshToken }).sendDraft(draftId);
}
