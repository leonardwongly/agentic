import crypto from "node:crypto";

// ---------------------------------------------------------------------------
// Environment helpers
// ---------------------------------------------------------------------------

function getSlackBotToken(): string | undefined {
  return process.env.SLACK_BOT_TOKEN?.trim() || undefined;
}

function getSlackSigningSecret(): string | undefined {
  return process.env.SLACK_SIGNING_SECRET?.trim() || undefined;
}

export function isSlackReady(): boolean {
  return Boolean(getSlackBotToken()) && Boolean(getSlackSigningSecret());
}

// ---------------------------------------------------------------------------
// Slack API helpers
// ---------------------------------------------------------------------------

const SLACK_API_BASE = "https://slack.com/api";

async function slackPost<T = unknown>(
  method: string,
  body: Record<string, unknown>
): Promise<T> {
  const token = getSlackBotToken();
  if (!token) {
    throw new Error("Slack not configured. Set SLACK_BOT_TOKEN.");
  }

  const response = await fetch(`${SLACK_API_BASE}/${method}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json; charset=utf-8"
    },
    body: JSON.stringify(body)
  });

  if (!response.ok) {
    throw new Error(`Slack API ${method} returned HTTP ${response.status}`);
  }

  const data = (await response.json()) as T;
  return data;
}

// ---------------------------------------------------------------------------
// Block Kit builder for approval messages
// ---------------------------------------------------------------------------

function riskBadge(riskClass: string): string {
  const badges: Record<string, string> = {
    R1: ":large_green_circle: R1 (Low)",
    R2: ":large_yellow_circle: R2 (Medium)",
    R3: ":large_orange_circle: R3 (High)",
    R4: ":red_circle: R4 (Critical)"
  };
  return badges[riskClass] ?? `:white_circle: ${riskClass}`;
}

function buildApprovalBlocks(approval: {
  id: string;
  title: string;
  rationale: string;
  riskClass: string;
  requestedAction: string;
}): unknown[] {
  return [
    {
      type: "header",
      text: {
        type: "plain_text",
        text: `:bell: Approval Required`,
        emoji: true
      }
    },
    {
      type: "section",
      text: {
        type: "mrkdwn",
        text: `*${approval.title}*`
      }
    },
    {
      type: "section",
      fields: [
        {
          type: "mrkdwn",
          text: `*Risk Class:*\n${riskBadge(approval.riskClass)}`
        },
        {
          type: "mrkdwn",
          text: `*Action:*\n${approval.requestedAction}`
        }
      ]
    },
    {
      type: "section",
      text: {
        type: "mrkdwn",
        text: `*Rationale:*\n${approval.rationale}`
      }
    },
    {
      type: "divider"
    },
    {
      type: "actions",
      block_id: `approval_actions_${approval.id}`,
      elements: [
        {
          type: "button",
          text: {
            type: "plain_text",
            text: "Approve",
            emoji: true
          },
          style: "primary",
          action_id: "approval_approve",
          value: approval.id
        },
        {
          type: "button",
          text: {
            type: "plain_text",
            text: "Reject",
            emoji: true
          },
          style: "danger",
          action_id: "approval_reject",
          value: approval.id
        }
      ]
    }
  ];
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export async function sendApprovalMessage(params: {
  channel: string;
  approval: {
    id: string;
    title: string;
    rationale: string;
    riskClass: string;
    requestedAction: string;
  };
}): Promise<{ ok: boolean; ts: string }> {
  const blocks = buildApprovalBlocks(params.approval);
  const fallbackText = `Approval required: ${params.approval.title} [${params.approval.riskClass}]`;

  const result = await slackPost<{ ok: boolean; ts: string }>("chat.postMessage", {
    channel: params.channel,
    text: fallbackText,
    blocks
  });

  return { ok: result.ok, ts: result.ts };
}

export async function sendNotification(params: {
  channel: string;
  text: string;
  blocks?: unknown[];
}): Promise<{ ok: boolean; ts: string }> {
  const result = await slackPost<{ ok: boolean; ts: string }>("chat.postMessage", {
    channel: params.channel,
    text: params.text,
    ...(params.blocks ? { blocks: params.blocks } : {})
  });

  return { ok: result.ok, ts: result.ts };
}

export async function updateMessage(params: {
  channel: string;
  ts: string;
  text: string;
  blocks?: unknown[];
}): Promise<{ ok: boolean }> {
  const result = await slackPost<{ ok: boolean }>("chat.update", {
    channel: params.channel,
    ts: params.ts,
    text: params.text,
    ...(params.blocks ? { blocks: params.blocks } : {})
  });

  return { ok: result.ok };
}

// ---------------------------------------------------------------------------
// Signature verification
// ---------------------------------------------------------------------------

export function verifySlackSignature(params: {
  signature: string;
  timestamp: string;
  body: string;
}): boolean {
  const secret = getSlackSigningSecret();
  if (!secret) {
    return false;
  }

  const baseString = `v0:${params.timestamp}:${params.body}`;
  const expected =
    "v0=" +
    crypto.createHmac("sha256", secret).update(baseString).digest("hex");

  // Constant-time comparison
  const expectedBuf = Buffer.from(expected);
  const actualBuf = Buffer.from(params.signature);

  if (expectedBuf.length !== actualBuf.length) {
    return false;
  }

  return crypto.timingSafeEqual(expectedBuf, actualBuf);
}
