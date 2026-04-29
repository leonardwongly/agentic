import crypto from "node:crypto";
import { z } from "zod";
import { enqueuePublicShareViewJob } from "@agentic/worker-runtime";
import { checkSessionRateLimit } from "../../../../lib/auth";
import {
  handleOperationalApiError,
  operationalJson,
  parseJsonBody,
  withApiTelemetry
} from "../../../../lib/api-response";
import { getRequestClientKey } from "../../../../lib/request-client-identity";
import {
  SHARE_VIEW_DEDUP_WINDOW_MS,
  fingerprintGoalShareToken,
  inspectGoalShareToken
} from "../../../../lib/share";
import { getSeededRepository } from "../../../../lib/server";

const TrackShareViewRequestSchema = z
  .object({
    token: z.string().trim().min(1).max(4096)
  })
  .strict();
const MAX_PUBLIC_SHARE_VIEW_CONTENT_LENGTH_BYTES = 8_192;

function acceptedNoOp(init?: ResponseInit): Response {
  return operationalJson(
    {
      accepted: true,
      tracked: false
    },
    {
      status: 202,
      ...init
    }
  );
}

function buildPublicShareViewJobIdempotencyKey(params: {
  shareId: string;
  requestClientKey: string;
  viewedAt: number;
}): string {
  const bucket = Math.floor(params.viewedAt / SHARE_VIEW_DEDUP_WINDOW_MS);

  // Align the queue dedupe window with share-view log dedupe so repeated refreshes
  // from the same client do not flood the worker or overwrite fresher state.
  return `public-share-view:${crypto
    .createHash("sha256")
    .update(
      JSON.stringify({
        shareId: params.shareId,
        requestClientKey: params.requestClientKey,
        bucket
      })
    )
    .digest("hex")
    .slice(0, 32)}`;
}

function buildPublicShareTokenRateLimitKey(tokenFingerprint: string): string {
  return `public-share-view:token:${tokenFingerprint}`;
}

function getPublicShareViewContentLength(request: Request): number | null {
  const raw = request.headers.get("content-length");
  if (!raw) {
    return null;
  }

  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed < 0) {
    return null;
  }

  return parsed;
}

export async function POST(request: Request) {
  return withApiTelemetry(request, "api.share.view.track", async () => {
    try {
      const contentLength = getPublicShareViewContentLength(request);
      if (contentLength !== null && contentLength > MAX_PUBLIC_SHARE_VIEW_CONTENT_LENGTH_BYTES) {
        return acceptedNoOp();
      }

      const { token } = await parseJsonBody(request, TrackShareViewRequestSchema);
      const requestClientKey = getRequestClientKey(request);
      const rateLimitKey = `public-share-view:${requestClientKey}`;
      const rateLimit = await checkSessionRateLimit(rateLimitKey);

      if (!rateLimit.allowed) {
        return acceptedNoOp({
          headers: {
            "Retry-After": String(Math.ceil(rateLimit.retryAfterMs / 1000))
          }
        });
      }

      const tokenInspection = inspectGoalShareToken(token);

      if (!tokenInspection.valid) {
        return acceptedNoOp();
      }

      const tokenFingerprint = fingerprintGoalShareToken(token);
      const tokenRateLimit = await checkSessionRateLimit(buildPublicShareTokenRateLimitKey(tokenFingerprint));

      if (!tokenRateLimit.allowed) {
        return acceptedNoOp({
          headers: {
            "Retry-After": String(Math.ceil(tokenRateLimit.retryAfterMs / 1000))
          }
        });
      }

      const repository = await getSeededRepository();
      const share = await repository.getGoalShareByTokenFingerprint(tokenFingerprint);

      if (!share || share.id !== tokenInspection.payload.shareId || share.goalId !== tokenInspection.payload.goalId) {
        return acceptedNoOp();
      }

      if (share.status !== "active") {
        return acceptedNoOp();
      }

      if (tokenInspection.expired || Date.parse(share.expiresAt) <= Date.now()) {
        return acceptedNoOp();
      }
      const viewedAt = new Date().toISOString();
      const job = await enqueuePublicShareViewJob({
        repository,
        userId: share.userId,
        shareId: share.id,
        goalId: share.goalId,
        tokenFingerprint,
        viewedAt,
        actorContext: null,
        idempotencyKey: buildPublicShareViewJobIdempotencyKey({
          shareId: share.id,
          requestClientKey,
          viewedAt: Date.parse(viewedAt)
        })
      });

      return operationalJson(
        {
          accepted: true,
          tracked: true,
          queued: true,
          jobId: job.id
        },
        {
          status: 202
        }
      );
    } catch (error) {
      return handleOperationalApiError(error, "Failed to track the public share view.");
    }
  });
}
