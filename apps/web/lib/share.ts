import crypto from "node:crypto";
import { z } from "zod";
import { createActionLog } from "@agentic/observability";
import type { ActorContext, GoalBundle } from "@agentic/contracts";
import { getServerSigningSecret } from "./auth";

const GOAL_SHARE_TOKEN_VERSION = 1;
const GOAL_SHARE_TTL_MS = 1000 * 60 * 60 * 24 * 7;
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

export function getGoalShareExpiry(now = Date.now()): string {
  return new Date(now + GOAL_SHARE_TTL_MS).toISOString();
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

export function verifyGoalShareToken(token: string, now = Date.now()): GoalShareTokenPayload | null {
  if (token.length === 0 || token.length > MAX_GOAL_SHARE_TOKEN_LENGTH) {
    return null;
  }

  const [encodedPayload, signature, ...rest] = token.trim().split(".");

  if (!encodedPayload || !signature || rest.length > 0) {
    return null;
  }

  let expectedSignature: string;

  try {
    expectedSignature = signGoalSharePayload(encodedPayload);
  } catch {
    return null;
  }

  if (!constantTimeEqual(signature, expectedSignature)) {
    return null;
  }

  try {
    const payload = GoalShareTokenPayloadSchema.parse(
      JSON.parse(Buffer.from(encodedPayload, "base64url").toString("utf8")) as unknown
    );

    return payload.exp >= now ? payload : null;
  } catch {
    return null;
  }
}

export function buildGoalShareUrl(requestUrl: string, token: string): string {
  return new URL(`/share/${encodeURIComponent(token)}`, requestUrl).toString();
}

export function fingerprintGoalShareToken(token: string): string {
  return crypto.createHash("sha256").update(token).digest("hex").slice(0, 12);
}

export function createGoalShareCreatedLog(
  bundle: GoalBundle,
  shareId: string,
  token: string,
  expiresAt: string,
  actorContext: ActorContext | null = null
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
      actorContext
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
