import { nowIso, type JobRecord, type PrivacyOperationJobPayload, type PublicShareViewJobPayload } from "@agentic/contracts";
import type { AgenticRepository } from "@agentic/repository";
import { createPublicShareViewedLog } from "./public-share-log";

function isPrivacyOperationJob(
  job: JobRecord | null
): job is JobRecord & { payload: PrivacyOperationJobPayload } {
  return job?.kind === "privacy_operation" && job.payload.type === "privacy_operation";
}

function isPublicShareViewJob(
  job: JobRecord | null
): job is JobRecord & { payload: PublicShareViewJobPayload } {
  return job?.kind === "public_share_view" && job.payload.type === "public_share_view";
}

function sanitizePrivacyOperationError(kind: PrivacyOperationJobPayload["kind"]): string {
  switch (kind) {
    case "workspace_export":
      return "Workspace export failed.";
    case "workspace_delete":
      return "Workspace deletion failed.";
    case "retention_enforcement":
      return "Retention enforcement failed.";
    default:
      return "Privacy operation failed.";
  }
}

function shouldAdvanceLastViewedAt(current: string | null, candidate: string): boolean {
  if (!current) {
    return true;
  }

  const currentTimestamp = Date.parse(current);
  const candidateTimestamp = Date.parse(candidate);

  if (!Number.isFinite(currentTimestamp) || !Number.isFinite(candidateTimestamp)) {
    return true;
  }

  return candidateTimestamp >= currentTimestamp;
}

export async function executePrivacyOperationJob(params: {
  repository: AgenticRepository;
  job: JobRecord;
  signal?: AbortSignal;
}) {
  const { job, repository } = params;

  if (!isPrivacyOperationJob(job)) {
    throw new Error(`Expected a privacy_operation payload for job ${job.id}.`);
  }

  const operation = await repository.getPrivacyOperation(job.payload.operationId, job.userId);

  if (!operation) {
    throw new Error(`Privacy operation ${job.payload.operationId} was not found.`);
  }

  if (operation.kind !== job.payload.kind || operation.workspaceId !== job.payload.workspaceId) {
    throw new Error(`Privacy operation ${operation.id} no longer matches the queued job payload.`);
  }

  const startedAt = nowIso();
  params.signal?.throwIfAborted();
  const runningOperation = await repository.savePrivacyOperation({
    ...operation,
    status: "running",
    startedAt,
    completedAt: null,
    error: null,
    updatedAt: startedAt
  });

  try {
    let result: Record<string, unknown>;

    switch (job.payload.kind) {
      case "workspace_export": {
        params.signal?.throwIfAborted();
        const audit = await repository.exportWorkspaceAudit(job.payload.workspaceId, job.userId);
        result = {
          workspaceId: audit.workspaceId,
          fileName: audit.fileName,
          contentType: audit.contentType,
          generatedAt: audit.generatedAt,
          contentLength: Buffer.byteLength(audit.content, "utf8")
        };
        break;
      }
      case "retention_enforcement": {
        const retentionDays = operation.details.retentionDays;

        if (typeof retentionDays !== "number" || !Number.isInteger(retentionDays) || retentionDays < 0) {
          throw new Error(`Privacy operation ${operation.id} is missing a valid retention policy.`);
        }

        params.signal?.throwIfAborted();
        result = await repository.enforceWorkspaceRetention({
          workspaceId: job.payload.workspaceId,
          userId: job.userId,
          retentionDays,
          now: startedAt
        });
        break;
      }
      case "workspace_delete":
        params.signal?.throwIfAborted();
        result = await repository.deleteWorkspaceData({
          workspaceId: job.payload.workspaceId,
          userId: job.userId,
          operationId: operation.id,
          now: startedAt
        });
        break;
    }

    const completedAt = nowIso();
    params.signal?.throwIfAborted();
    await repository.savePrivacyOperation({
      ...runningOperation,
      status: "completed",
      result,
      completedAt,
      error: null,
      updatedAt: completedAt
    });
  } catch (error) {
    const completedAt = nowIso();

    await repository.savePrivacyOperation({
      ...runningOperation,
      status: "failed",
      completedAt,
      error: sanitizePrivacyOperationError(job.payload.kind),
      updatedAt: completedAt
    });

    throw error;
  }
}

export async function executePublicShareViewJob(params: {
  repository: AgenticRepository;
  job: JobRecord;
  signal?: AbortSignal;
}) {
  const { job, repository } = params;

  if (!isPublicShareViewJob(job)) {
    throw new Error(`Expected a public_share_view payload for job ${job.id}.`);
  }

  const share = await repository.getGoalShare(job.payload.shareId, job.userId);

  if (!share || share.goalId !== job.payload.goalId || share.status !== "active" || Date.parse(share.expiresAt) <= Date.now()) {
    return;
  }

  const bundle = await repository.getGoalBundle(job.payload.goalId);

  if (!bundle) {
    return;
  }

  const viewedLog = createPublicShareViewedLog(
    bundle,
    job.payload.shareId,
    job.payload.tokenFingerprint,
    Date.parse(job.payload.viewedAt)
  );
  const shouldUpdateShare = shouldAdvanceLastViewedAt(share.lastViewedAt, job.payload.viewedAt);

  if (!viewedLog && !shouldUpdateShare) {
    return;
  }

  const writes: Array<Promise<unknown>> = [];

  if (shouldUpdateShare) {
    params.signal?.throwIfAborted();
    writes.push(
      repository.saveGoalShare({
        ...share,
        lastViewedAt: job.payload.viewedAt,
        updatedAt: nowIso()
      })
    );
  }

  if (viewedLog) {
    params.signal?.throwIfAborted();
    writes.push(
      repository.saveGoalBundle({
        ...bundle,
        actionLogs: [...bundle.actionLogs, viewedLog]
      })
    );
  }

  await Promise.all(writes);
}
