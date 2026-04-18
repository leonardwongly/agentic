import { beforeEach, afterEach, vi } from "vitest";
import {
  ConnectorFailureError,
  sendNotification,
  sendTelegramNotification
} from "@agentic/integrations";

describe("connector failure semantics", () => {
  const originalFetch = global.fetch;
  const originalSlackBotToken = process.env.SLACK_BOT_TOKEN;
  const originalSlackSigningSecret = process.env.SLACK_SIGNING_SECRET;
  const originalTelegramBotToken = process.env.TELEGRAM_BOT_TOKEN;
  const originalTelegramWebhookSecret = process.env.TELEGRAM_WEBHOOK_SECRET;

  beforeEach(() => {
    process.env.SLACK_BOT_TOKEN = "xoxb-test-token";
    process.env.SLACK_SIGNING_SECRET = "slack-signing-secret";
    process.env.TELEGRAM_BOT_TOKEN = "telegram-test-token";
    process.env.TELEGRAM_WEBHOOK_SECRET = "telegram-secret";
  });

  afterEach(() => {
    global.fetch = originalFetch;
    process.env.SLACK_BOT_TOKEN = originalSlackBotToken;
    process.env.SLACK_SIGNING_SECRET = originalSlackSigningSecret;
    process.env.TELEGRAM_BOT_TOKEN = originalTelegramBotToken;
    process.env.TELEGRAM_WEBHOOK_SECRET = originalTelegramWebhookSecret;
    vi.restoreAllMocks();
  });

  it("normalizes Slack rate limits into retryable connector failures", async () => {
    global.fetch = vi.fn(async () =>
      new Response(JSON.stringify({ ok: false, error: "ratelimited" }), {
        status: 200,
        headers: {
          "content-type": "application/json",
          "retry-after": "17"
        }
      })
    ) as typeof fetch;

    let failure: unknown;
    try {
      await sendNotification({
        channel: "C123",
        text: "Investigate the latest alert."
      });
    } catch (error) {
      failure = error;
    }

    expect(failure).toBeInstanceOf(ConnectorFailureError);
    expect(failure).toMatchObject({
      provider: "slack",
      code: "rate_limited",
      retryable: true,
      retryAfterSeconds: 17
    });
  });

  it("normalizes Slack timeouts into retryable connector failures", async () => {
    global.fetch = vi.fn(async () => {
      const error = new Error("timed out");
      Object.assign(error, {
        name: "TimeoutError"
      });
      throw error;
    }) as typeof fetch;

    await expect(
      sendNotification({
        channel: "C123",
        text: "Investigate the latest alert."
      })
    ).rejects.toMatchObject({
      provider: "slack",
      code: "timeout",
      retryable: true
    });
  });

  it("normalizes Telegram rate limits into retryable connector failures", async () => {
    global.fetch = vi.fn(async () =>
      new Response(
        JSON.stringify({
          ok: false,
          error_code: 429,
          description: "Too Many Requests: retry after 3",
          parameters: {
            retry_after: 3
          }
        }),
        {
          status: 200,
          headers: {
            "content-type": "application/json"
          }
        }
      )
    ) as typeof fetch;

    await expect(
      sendTelegramNotification({
        chatId: "123",
        text: "Investigate the latest alert."
      })
    ).rejects.toMatchObject({
      provider: "telegram",
      code: "rate_limited",
      retryable: true,
      retryAfterSeconds: 3
    });
  });
});
