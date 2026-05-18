import { google } from "googleapis";
import crypto from "node:crypto";
import { z } from "zod";
import { logError, recordCounter, withSpan, withTelemetryContext } from "@agentic/observability";
import { createGoogleOAuthClient } from "./google-oauth";
import {
  createConnectorTimeoutSignal,
  getConnectorHttpStatusCode,
  normalizeConnectorThrownError
} from "./connector-errors";

const GMAIL_MUTATION_TIMEOUT_MS = 10_000;
const GMAIL_IDEMPOTENCY_HEADER = "X-Agentic-Idempotency-Key";

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
  createDraft: (params: {
    to: string;
    subject: string;
    body: string;
    threadId?: string;
    idempotencyKey?: string;
    signal?: AbortSignal;
  }) => Promise<DraftResult>;
  sendDraft: (draftId: string, options?: { idempotencyKey?: string; signal?: AbortSignal }) => Promise<{ messageId: string }>;
};

type GmailRequestOptions = {
  signal?: AbortSignal;
};

function buildGmailMutationSignal(signal?: AbortSignal) {
  return createConnectorTimeoutSignal({
    timeoutMs: GMAIL_MUTATION_TIMEOUT_MS,
    signal
  });
}

function sanitizeMailHeader(value: string): string {
  return value.trim().replace(/[\r\n]+/gu, " ");
}

function buildIdempotencyMessageId(idempotencyKey: string): string {
  const digest = crypto.createHash("sha256").update(idempotencyKey).digest("hex").slice(0, 32);
  return `<agentic-${digest}@idempotency.agentic.local>`;
}

function getHeader(headers: Array<{ name?: string | null; value?: string | null }> | undefined, name: string): string | null {
  return headers?.find((header) => header.name?.toLowerCase() === name.toLowerCase())?.value ?? null;
}

async function findDraftByIdempotencyKey(
  gmail: NonNullable<ReturnType<typeof getGmailClient>>,
  idempotencyKey: string,
  requestOptions: GmailRequestOptions
): Promise<string | null> {
  const drafts = await gmail.users.drafts.list({
    userId: "me",
    maxResults: 50
  }, requestOptions);

  for (const draft of drafts.data.drafts ?? []) {
    if (!draft.id) {
      continue;
    }

    const detail = await gmail.users.drafts.get({
      userId: "me",
      id: draft.id,
      format: "full"
    }, requestOptions);
    const headers = detail.data.message?.payload?.headers as Array<{ name?: string; value?: string }> | undefined;

    if (getHeader(headers, GMAIL_IDEMPOTENCY_HEADER) === idempotencyKey) {
      return draft.id;
    }
  }

  return null;
}

async function findSentMessageByIdempotencyKey(
  gmail: NonNullable<ReturnType<typeof getGmailClient>>,
  idempotencyKey: string,
  requestOptions: GmailRequestOptions
): Promise<string | null> {
  const messageId = buildIdempotencyMessageId(idempotencyKey).replace(/[<>]/gu, "");
  const response = await gmail.users.messages.list({
    userId: "me",
    maxResults: 1,
    q: `rfc822msgid:${messageId}`
  }, requestOptions);

  return response.data.messages?.[0]?.id ?? null;
}

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
              const normalizedError = normalizeConnectorThrownError({
                provider: "gmail",
                operation,
                error
              });
              logError("integration.gmail.call_failed", normalizedError, {
                operation
              });
              throw normalizedError;
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
    async createDraft(paramsDraft: { to: string; subject: string; body: string; threadId?: string; idempotencyKey?: string; signal?: AbortSignal }) {
      return instrumentGmailCall(
        "drafts.create",
        {
          hasThreadId: Boolean(paramsDraft.threadId),
          subjectLength: paramsDraft.subject.length,
          bodyLength: paramsDraft.body.length,
          hasIdempotencyKey: Boolean(paramsDraft.idempotencyKey)
        },
        async () => {
          const gmail = getClient();
          const requestOptions = {
            signal: buildGmailMutationSignal(paramsDraft.signal)
          };
          const existingDraftId = paramsDraft.idempotencyKey
            ? await findDraftByIdempotencyKey(gmail, paramsDraft.idempotencyKey, requestOptions)
            : null;

          if (existingDraftId) {
            return DraftResultSchema.parse({
              id: existingDraftId,
              threadId: paramsDraft.threadId ?? null,
              to: paramsDraft.to,
              subject: paramsDraft.subject,
              body: paramsDraft.body
            });
          }

          const idempotencyHeaders = paramsDraft.idempotencyKey
            ? [
                `Message-ID: ${buildIdempotencyMessageId(paramsDraft.idempotencyKey)}`,
                `${GMAIL_IDEMPOTENCY_HEADER}: ${sanitizeMailHeader(paramsDraft.idempotencyKey)}`
              ]
            : [];
          const rawMessage = [
            ...idempotencyHeaders,
            `To: ${sanitizeMailHeader(paramsDraft.to)}`,
            `Subject: ${sanitizeMailHeader(paramsDraft.subject)}`,
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
          }, requestOptions);

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
    async sendDraft(draftId: string, options?: { idempotencyKey?: string; signal?: AbortSignal }) {
      return instrumentGmailCall(
        "drafts.send",
        { hasIdempotencyKey: Boolean(options?.idempotencyKey) },
        async () => {
          const gmail = getClient();
          const requestOptions = {
            signal: buildGmailMutationSignal(options?.signal)
          };

          try {
            const response = await gmail.users.drafts.send({
              userId: "me",
              requestBody: { id: draftId }
            }, requestOptions);

            return { messageId: response.data.id! };
          } catch (error) {
            if (options?.idempotencyKey && getConnectorHttpStatusCode(error) === 404) {
              const existingMessageId = await findSentMessageByIdempotencyKey(
                gmail,
                options.idempotencyKey,
                requestOptions
              );

              if (existingMessageId) {
                return { messageId: existingMessageId };
              }
            }

            throw error;
          }
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

export async function createDraft(params: { to: string; subject: string; body: string; threadId?: string; idempotencyKey?: string; signal?: AbortSignal }): Promise<DraftResult> {
  const refreshToken = process.env.GOOGLE_REFRESH_TOKEN?.trim();

  if (!refreshToken) {
    throw new Error("Gmail not configured.");
  }

  return createGmailAdapter({ refreshToken }).createDraft(params);
}

export async function sendDraft(draftId: string, options?: { idempotencyKey?: string; signal?: AbortSignal }): Promise<{ messageId: string }> {
  const refreshToken = process.env.GOOGLE_REFRESH_TOKEN?.trim();

  if (!refreshToken) {
    throw new Error("Gmail not configured.");
  }

  return createGmailAdapter({ refreshToken }).sendDraft(draftId, options);
}
