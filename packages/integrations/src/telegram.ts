import crypto from "node:crypto";
import { logError, recordCounter, withSpan, withTelemetryContext } from "@agentic/observability";
import {
  ConnectorFailureError,
  createHttpConnectorError,
  createNotConfiguredConnectorError,
  normalizeConnectorThrownError,
  parseRetryAfterSeconds
} from "./connector-errors";

const TELEGRAM_API_TIMEOUT_MS = 5_000;

type TelegramApiResponse<T> =
  | { ok: true; result: T }
  | { ok: false; error_code?: number; description?: string; parameters?: { retry_after?: number } };

function getTelegramBotToken(): string | undefined {
  return process.env.TELEGRAM_BOT_TOKEN?.trim() || undefined;
}

function getTelegramWebhookSecret(): string | undefined {
  return process.env.TELEGRAM_WEBHOOK_SECRET?.trim() || undefined;
}

export function isTelegramReady(): boolean {
  return Boolean(getTelegramBotToken()) && Boolean(getTelegramWebhookSecret());
}

async function telegramPost<T>(method: string, body: Record<string, unknown>): Promise<T> {
  const token = getTelegramBotToken();

  if (!token) {
    throw createNotConfiguredConnectorError({
      provider: "telegram",
      operation: method,
      envVar: "TELEGRAM_BOT_TOKEN"
    });
  }

  return withTelemetryContext(
    {
      provider: "telegram"
    },
    async () =>
      withSpan(
        "integration.telegram.call",
        {
          provider: "telegram",
          operation: method,
          hasMessageId: typeof body.message_id === "number",
          hasCallbackQueryId: typeof body.callback_query_id === "string",
          textLength: typeof body.text === "string" ? body.text.length : 0
        },
        async () => {
          try {
            const response = await fetch(`https://api.telegram.org/bot${token}/${method}`, {
              method: "POST",
              headers: {
                "Content-Type": "application/json; charset=utf-8"
              },
              body: JSON.stringify(body),
              signal: AbortSignal.timeout(TELEGRAM_API_TIMEOUT_MS)
            });

            if (!response.ok) {
              throw createHttpConnectorError({
                provider: "telegram",
                operation: method,
                statusCode: response.status,
                retryAfterSeconds: parseRetryAfterSeconds(response.headers.get("retry-after"))
              });
            }

            const data = (await response.json()) as TelegramApiResponse<T>;

            if (!data.ok) {
              throw new ConnectorFailureError(
                "telegram",
                method,
                data.error_code === 429
                  ? "rate_limited"
                  : data.error_code === 401 || data.error_code === 403
                    ? "unauthorized"
                    : "remote_error",
                data.error_code === 429 || (typeof data.error_code === "number" && data.error_code >= 500),
                {
                  statusCode: data.error_code,
                  retryAfterSeconds: data.parameters?.retry_after,
                  message: data.description
                    ? `Telegram API ${method} failed: ${data.description}`
                    : `Telegram API ${method} failed.`
                }
              );
            }

            recordCounter("integration.call.total", 1, {
              provider: "telegram",
              operation: method,
              outcome: "success"
            });
            return data.result;
          } catch (error) {
            recordCounter("integration.call.total", 1, {
              provider: "telegram",
              operation: method,
              outcome: "error"
            });
            const normalizedError = normalizeConnectorThrownError({
              provider: "telegram",
              operation: method,
              error
            });
            logError("integration.telegram.call_failed", normalizedError, {
              operation: method
            });
            throw normalizedError;
          }
        }
      )
  );
}

function buildApprovalText(approval: {
  title: string;
  rationale: string;
  riskClass: string;
  requestedAction: string;
}): string {
  return [
    "Approval Required",
    "",
    `Title: ${approval.title}`,
    `Risk: ${approval.riskClass}`,
    `Action: ${approval.requestedAction}`,
    "",
    `Rationale: ${approval.rationale}`
  ].join("\n");
}

export async function sendTelegramApprovalMessage(params: {
  chatId: string;
  approval: {
    title: string;
    rationale: string;
    riskClass: string;
    requestedAction: string;
    approveActionId: string;
    rejectActionId: string;
  };
}): Promise<{ ok: boolean; messageId: number }> {
  const result = await telegramPost<{ message_id: number }>("sendMessage", {
    chat_id: params.chatId,
    text: buildApprovalText(params.approval),
    reply_markup: {
      inline_keyboard: [
        [
          {
            text: "Approve",
            callback_data: params.approval.approveActionId
          },
          {
            text: "Reject",
            callback_data: params.approval.rejectActionId
          }
        ]
      ]
    }
  });

  return {
    ok: true,
    messageId: result.message_id
  };
}

export async function sendTelegramNotification(params: {
  chatId: string;
  text: string;
}): Promise<{ ok: boolean; messageId: number }> {
  const result = await telegramPost<{ message_id: number }>("sendMessage", {
    chat_id: params.chatId,
    text: params.text
  });

  return {
    ok: true,
    messageId: result.message_id
  };
}

export async function updateTelegramMessage(params: {
  chatId: string;
  messageId: number;
  text: string;
}): Promise<{ ok: boolean }> {
  await telegramPost("editMessageText", {
    chat_id: params.chatId,
    message_id: params.messageId,
    text: params.text
  });

  return { ok: true };
}

export async function answerTelegramCallbackQuery(params: {
  callbackQueryId: string;
  text: string;
  showAlert?: boolean;
}): Promise<{ ok: boolean }> {
  await telegramPost("answerCallbackQuery", {
    callback_query_id: params.callbackQueryId,
    text: params.text,
    show_alert: params.showAlert ?? false
  });

  return { ok: true };
}

export function verifyTelegramWebhookSecret(candidate: string): boolean {
  const expected = getTelegramWebhookSecret();

  if (!expected || !candidate) {
    return false;
  }

  const expectedBuffer = Buffer.from(expected);
  const candidateBuffer = Buffer.from(candidate);

  if (expectedBuffer.length !== candidateBuffer.length) {
    return false;
  }

  return crypto.timingSafeEqual(expectedBuffer, candidateBuffer);
}
