import crypto from "node:crypto";
import { z } from "zod";
import { createActionLog } from "@agentic/observability";
import type { ActorContext, GoalBundle } from "@agentic/contracts";
import { getServerSigningSecret } from "./auth";
import { buildPublicUrl } from "./public-origin";
import {
  GOAL_SHARE_DEFAULT_EXPIRY_DAYS,
  getGoalShareExpiryFromDays
} from "./share-disclosure";

const GOAL_SHARE_TOKEN_VERSION = 1;
export const SHARE_VIEW_DEDUP_WINDOW_MS = 1000 * 60 * 15;
const MAX_GOAL_SHARE_TOKEN_LENGTH = 4096;

const GoalShareTokenPayloadSchema = z
  .object({
    shareId: z.string().trim().min(1).max(200),
    goalId: z.string().trim().min(1).max(200),
    exp: z.number().int().positive(),
    v: z.literal(GOAL_SHARE_TOKEN_VERSION)
  })
  .strict();

export type GoalShareTokenPayload = z.infer<typeof GoalShareTokenPayloadSchema>;

export type GoalShareTokenInspection =
  | {
      valid: true;
      expired: boolean;
      payload: GoalShareTokenPayload;
    }
  | {
      valid: false;
      reason: "malformed" | "signature" | "payload";
    };

export type SharedGoalView = {
  title: string;
  explanation: string;
  intent: string;
  status: string;
  createdAt: string;
  updatedAt: string;
  taskCount: number;
  artifactCount: number;
  watcherCount: number;
  tasks: Array<{
    title: string;
    summary: string;
    state: string;
    riskClass: string;
  }>;
  artifacts: Array<{
    title: string;
    artifactType: string;
    preview: string;
    createdAt: string;
  }>;
};

function signGoalSharePayload(encodedPayload: string): string {
  return crypto.createHmac("sha256", getServerSigningSecret("share")).update(encodedPayload).digest("base64url");
}

function constantTimeEqual(left: string, right: string): boolean {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);

  if (leftBuffer.length !== rightBuffer.length) {
    return false;
  }

  return crypto.timingSafeEqual(leftBuffer, rightBuffer);
}

export function getGoalShareExpiry(now = Date.now(), expiryDays = GOAL_SHARE_DEFAULT_EXPIRY_DAYS): string {
  return getGoalShareExpiryFromDays(expiryDays, now);
}

export function createGoalShareToken(shareId: string, goalId: string, expiresAt = getGoalShareExpiry()): string {
  const payload = GoalShareTokenPayloadSchema.parse({
    shareId,
    goalId,
    exp: Date.parse(expiresAt),
    v: GOAL_SHARE_TOKEN_VERSION
  });
  const encodedPayload = Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
  const signature = signGoalSharePayload(encodedPayload);

  return `${encodedPayload}.${signature}`;
}

export function inspectGoalShareToken(token: string, now = Date.now()): GoalShareTokenInspection {
  if (token.length === 0 || token.length > MAX_GOAL_SHARE_TOKEN_LENGTH) {
    return {
      valid: false,
      reason: "malformed"
    };
  }

  const [encodedPayload, signature, ...rest] = token.trim().split(".");

  if (!encodedPayload || !signature || rest.length > 0) {
    return {
      valid: false,
      reason: "malformed"
    };
  }

  let expectedSignature: string;

  try {
    expectedSignature = signGoalSharePayload(encodedPayload);
  } catch {
    return {
      valid: false,
      reason: "signature"
    };
  }

  if (!constantTimeEqual(signature, expectedSignature)) {
    return {
      valid: false,
      reason: "signature"
    };
  }

  try {
    const payload = GoalShareTokenPayloadSchema.parse(
      JSON.parse(Buffer.from(encodedPayload, "base64url").toString("utf8")) as unknown
    );

    return {
      valid: true,
      expired: payload.exp < now,
      payload
    };
  } catch {
    return {
      valid: false,
      reason: "payload"
    };
  }
}

export function verifyGoalShareToken(token: string, now = Date.now()): GoalShareTokenPayload | null {
  const inspection = inspectGoalShareToken(token, now);

  return inspection.valid && !inspection.expired ? inspection.payload : null;
}

export function buildGoalShareUrl(requestUrl: string, token: string): string {
  return buildPublicUrl(requestUrl, `/share/${encodeURIComponent(token)}`).toString();
}

export function fingerprintGoalShareToken(token: string): string {
  return crypto.createHash("sha256").update(token).digest("hex").slice(0, 12);
}

export function createGoalShareCreatedLog(
  bundle: GoalBundle,
  shareId: string,
  token: string,
  expiresAt: string,
  actorContext: ActorContext | null = null,
  details: Record<string, unknown> = {}
) {
  return createActionLog({
    goalId: bundle.goal.id,
    taskId: null,
    workflowId: bundle.workflow.id,
    actor: "dashboard",
    kind: "share.link_created",
    message: `Created a public share link for "${bundle.goal.title}".`,
    details: {
      shareId,
      expiresAt,
      tokenFingerprint: fingerprintGoalShareToken(token),
      actorContext,
      ...details
    }
  });
}

export function createGoalShareViewedLogFromFingerprint(
  bundle: GoalBundle,
  shareId: string,
  tokenFingerprint: string,
  now = Date.now()
) {
  const dedupeThreshold = now - SHARE_VIEW_DEDUP_WINDOW_MS;
  const alreadyTracked = bundle.actionLogs.some((log) => {
    if (log.kind !== "share.page_viewed") {
      return false;
    }

    const createdAt = Date.parse(log.createdAt);
    const loggedFingerprint = typeof log.details.tokenFingerprint === "string" ? log.details.tokenFingerprint : null;

    return loggedFingerprint === tokenFingerprint && Number.isFinite(createdAt) && createdAt >= dedupeThreshold;
  });

  if (alreadyTracked) {
    return null;
  }

  return createActionLog({
    goalId: bundle.goal.id,
    taskId: null,
    workflowId: bundle.workflow.id,
    actor: "public-share",
    kind: "share.page_viewed",
    message: `Opened the public share page for "${bundle.goal.title}".`,
    details: {
      shareId,
      tokenFingerprint
    }
  });
}

export function createGoalShareViewedLog(bundle: GoalBundle, shareId: string, token: string, now = Date.now()) {
  return createGoalShareViewedLogFromFingerprint(bundle, shareId, fingerprintGoalShareToken(token), now);
}

export function createGoalShareRevokedLog(
  bundle: GoalBundle,
  shareId: string,
  actorContext: ActorContext | null = null
) {
  return createActionLog({
    goalId: bundle.goal.id,
    taskId: null,
    workflowId: bundle.workflow.id,
    actor: "dashboard",
    kind: "share.link_revoked",
    message: `Revoked a public share link for "${bundle.goal.title}".`,
    details: {
      shareId,
      actorContext
    }
  });
}

function hasRecentShareAuditLog(params: {
  bundle: GoalBundle;
  kind: string;
  shareId: string;
  tokenFingerprint: string;
  reason?: string;
  now: number;
}): boolean {
  const dedupeThreshold = params.now - SHARE_VIEW_DEDUP_WINDOW_MS;

  return params.bundle.actionLogs.some((log) => {
    if (log.kind !== params.kind) {
      return false;
    }

    const createdAt = Date.parse(log.createdAt);
    const shareId = typeof log.details.shareId === "string" ? log.details.shareId : null;
    const tokenFingerprint = typeof log.details.tokenFingerprint === "string" ? log.details.tokenFingerprint : null;
    const reason = typeof log.details.reason === "string" ? log.details.reason : null;

    return (
      shareId === params.shareId &&
      tokenFingerprint === params.tokenFingerprint &&
      (!params.reason || reason === params.reason) &&
      Number.isFinite(createdAt) &&
      createdAt >= dedupeThreshold
    );
  });
}

export function createGoalShareExpiredLog(
  bundle: GoalBundle,
  shareId: string,
  tokenFingerprint: string,
  now = Date.now()
) {
  const alreadyLogged = bundle.actionLogs.some((log) => {
    const loggedShareId = typeof log.details.shareId === "string" ? log.details.shareId : null;
    return log.kind === "share.link_expired" && loggedShareId === shareId;
  });

  if (alreadyLogged) {
    return null;
  }

  return createActionLog({
    goalId: bundle.goal.id,
    taskId: null,
    workflowId: bundle.workflow.id,
    actor: "public-share",
    kind: "share.link_expired",
    message: `Public share link expired for "${bundle.goal.title}".`,
    details: {
      shareId,
      tokenFingerprint,
      auditedAt: new Date(now).toISOString()
    }
  });
}

export function createGoalShareFailedAccessLog(
  bundle: GoalBundle,
  shareId: string,
  tokenFingerprint: string,
  reason: "expired" | "revoked" | "not_found",
  now = Date.now()
) {
  if (
    hasRecentShareAuditLog({
      bundle,
      kind: "share.access_failed",
      shareId,
      tokenFingerprint,
      reason,
      now
    })
  ) {
    return null;
  }

  return createActionLog({
    goalId: bundle.goal.id,
    taskId: null,
    workflowId: bundle.workflow.id,
    actor: "public-share",
    kind: "share.access_failed",
    message: `Blocked public share access for "${bundle.goal.title}".`,
    details: {
      shareId,
      tokenFingerprint,
      reason
    }
  });
}

export function buildSharedGoalView(bundle: GoalBundle): SharedGoalView {
  return {
    title: bundle.goal.title,
    explanation: bundle.goal.explanation,
    intent: bundle.goal.intent,
    status: bundle.goal.status,
    createdAt: bundle.goal.createdAt,
    updatedAt: bundle.goal.updatedAt,
    taskCount: bundle.tasks.length,
    artifactCount: bundle.artifacts.length,
    watcherCount: bundle.watchers.length,
    tasks: bundle.tasks.map((task) => ({
      title: task.title,
      summary: task.summary,
      state: task.state,
      riskClass: task.riskClass
    })),
    artifacts: bundle.artifacts.map((artifact) => ({
      title: artifact.title,
      artifactType: artifact.artifactType,
      preview: "Artifact content is hidden on public share links.",
      createdAt: artifact.createdAt
    }))
  };
}
