import { z } from "zod";
import { checkSessionRateLimit } from "../../../../lib/auth";
import {
  handleOperationalApiError,
  operationalJson,
  parseJsonBody,
  withApiTelemetry
} from "../../../../lib/api-response";
import { getRequestClientKey } from "../../../../lib/request-client-identity";
import {
  createGoalShareViewedLog,
  fingerprintGoalShareToken,
  verifyGoalShareToken
} from "../../../../lib/share";
import { getSeededRepository } from "../../../../lib/server";

const TrackShareViewRequestSchema = z
  .object({
    token: z.string().trim().min(1).max(4096)
  })
  .strict();

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

export async function POST(request: Request) {
  return withApiTelemetry(request, "api.share.view.track", async () => {
    try {
      const { token } = await parseJsonBody(request, TrackShareViewRequestSchema);
      const rateLimitKey = `public-share-view:${getRequestClientKey(request)}`;
      const rateLimit = await checkSessionRateLimit(rateLimitKey);

      if (!rateLimit.allowed) {
        return acceptedNoOp({
          headers: {
            "Retry-After": String(Math.ceil(rateLimit.retryAfterMs / 1000))
          }
        });
      }

      const verifiedToken = verifyGoalShareToken(token);

      if (!verifiedToken) {
        return acceptedNoOp();
      }

      const repository = await getSeededRepository();
      const share = await repository.getGoalShareByTokenFingerprint(fingerprintGoalShareToken(token));

      if (
        !share ||
        share.id !== verifiedToken.shareId ||
        share.goalId !== verifiedToken.goalId ||
        share.status !== "active" ||
        Date.parse(share.expiresAt) <= Date.now()
      ) {
        return acceptedNoOp();
      }

      const bundle = await repository.getGoalBundle(verifiedToken.goalId);

      if (!bundle) {
        return acceptedNoOp();
      }

      const viewedAt = new Date().toISOString();
      const viewedLog = createGoalShareViewedLog(bundle, share.id, token, Date.parse(viewedAt));
      const writes: Array<Promise<unknown>> = [
        repository.saveGoalShare({
          ...share,
          lastViewedAt: viewedAt,
          updatedAt: viewedAt
        })
      ];

      if (viewedLog) {
        writes.push(
          repository.saveGoalBundle({
            ...bundle,
            actionLogs: [...bundle.actionLogs, viewedLog]
          })
        );
      }

      await Promise.all(writes);

      return operationalJson({
        accepted: true,
        tracked: true,
        deduplicated: viewedLog === null
      });
    } catch (error) {
      return handleOperationalApiError(error, "Failed to track the public share view.");
    }
  });
}
