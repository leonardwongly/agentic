import type { GoalBundle } from "@agentic/contracts";
import { createActionLog } from "@agentic/observability";

const SHARE_VIEW_DEDUP_WINDOW_MS = 1000 * 60 * 15;

export function createPublicShareViewedLog(
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
