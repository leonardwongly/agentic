import crypto from "node:crypto";

const SLACK_APPROVAL_TOKEN_VERSION = 1 as const;

type SlackApprovalTokenPayload = {
  version: typeof SLACK_APPROVAL_TOKEN_VERSION;
  approvalId: string;
  goalId: string;
  workspaceId: string | null;
  expiresAt: string;
  nonce: string;
};

function getSlackApprovalSecret(): string | null {
  return process.env.SLACK_APPROVAL_TOKEN_SECRET?.trim() || process.env.SLACK_SIGNING_SECRET?.trim() || null;
}

function signPayload(secret: string, encodedPayload: string): string {
  return crypto.createHmac("sha256", secret).update(`agentic-slack-approval-v1.${encodedPayload}`).digest("base64url");
}

function constantTimeEqual(left: string, right: string): boolean {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);

  if (leftBuffer.length !== rightBuffer.length) {
    return false;
  }

  return crypto.timingSafeEqual(leftBuffer, rightBuffer);
}

function parseTokenPayload(encodedPayload: string): SlackApprovalTokenPayload | null {
  try {
    const parsed = JSON.parse(Buffer.from(encodedPayload, "base64url").toString("utf8")) as Partial<SlackApprovalTokenPayload>;

    if (
      parsed.version !== SLACK_APPROVAL_TOKEN_VERSION ||
      typeof parsed.approvalId !== "string" ||
      typeof parsed.goalId !== "string" ||
      (parsed.workspaceId !== null && typeof parsed.workspaceId !== "string") ||
      typeof parsed.expiresAt !== "string" ||
      typeof parsed.nonce !== "string"
    ) {
      return null;
    }

    if (!Number.isFinite(Date.parse(parsed.expiresAt))) {
      return null;
    }

    return {
      version: SLACK_APPROVAL_TOKEN_VERSION,
      approvalId: parsed.approvalId,
      goalId: parsed.goalId,
      workspaceId: parsed.workspaceId,
      expiresAt: parsed.expiresAt,
      nonce: parsed.nonce
    };
  } catch {
    return null;
  }
}

function parseSlackUserMap(): Map<string, string> {
  const raw = process.env.SLACK_USER_MAP?.trim();
  const mappings = new Map<string, string>();

  if (!raw) {
    return mappings;
  }

  for (const entry of raw.split(/[,\n;]/)) {
    const [slackUserId, userId] = entry.split(":").map((value) => value?.trim() ?? "");

    if (!slackUserId || !userId) {
      continue;
    }

    mappings.set(slackUserId, userId);
  }

  return mappings;
}

export function buildSlackApprovalToken(params: {
  approvalId: string;
  goalId: string;
  workspaceId: string | null;
  expiresAt: string;
}): string {
  const secret = getSlackApprovalSecret();
  if (!secret) {
    throw new Error("Slack approval token secret is not configured.");
  }

  const payload: SlackApprovalTokenPayload = {
    version: SLACK_APPROVAL_TOKEN_VERSION,
    approvalId: params.approvalId,
    goalId: params.goalId,
    workspaceId: params.workspaceId,
    expiresAt: params.expiresAt,
    nonce: crypto.randomUUID()
  };
  const encodedPayload = Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
  return `${encodedPayload}.${signPayload(secret, encodedPayload)}`;
}

export function verifySlackApprovalToken(token: string): SlackApprovalTokenPayload | null {
  const secret = getSlackApprovalSecret();
  if (!secret) {
    return null;
  }

  const [encodedPayload, signature, ...rest] = token.split(".");
  if (!encodedPayload || !signature || rest.length > 0) {
    return null;
  }

  const expectedSignature = signPayload(secret, encodedPayload);
  if (!constantTimeEqual(signature, expectedSignature)) {
    return null;
  }

  const payload = parseTokenPayload(encodedPayload);
  if (!payload) {
    return null;
  }

  if (Date.parse(payload.expiresAt) <= Date.now()) {
    return null;
  }

  return payload;
}

export function resolveSlackActorUserId(slackUserId: string): string | null {
  return parseSlackUserMap().get(slackUserId.trim()) ?? null;
}

