import type { AgenticRepository } from "@agentic/repository";
import {
  createGoalShareExpiredLog,
  createGoalShareFailedAccessLog
} from "./share";

type ShareAuditRepository = Pick<AgenticRepository, "appendGoalActionLogs" | "getGoalBundle">;

export async function auditBlockedShareAccess(params: {
  repository: ShareAuditRepository;
  goalId: string;
  shareId: string;
  tokenFingerprint: string;
  reason: "expired" | "revoked" | "not_found";
}) {
  try {
    const bundle = await params.repository.getGoalBundle(params.goalId);

    if (!bundle) {
      return;
    }

    const now = Date.now();
    const logs = [
      ...(params.reason === "expired"
        ? [createGoalShareExpiredLog(bundle, params.shareId, params.tokenFingerprint, now)]
        : []),
      createGoalShareFailedAccessLog(bundle, params.shareId, params.tokenFingerprint, params.reason, now)
    ].filter((log) => log !== null);

    if (logs.length > 0) {
      await params.repository.appendGoalActionLogs(bundle.goal.id, logs);
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown audit failure.";

    console.warn(`[agentic] Failed to audit blocked public share access: ${message}`);
  }
}
