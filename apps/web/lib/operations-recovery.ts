import { z } from "zod";
import {
  appendJobExecutionJournalEntry,
  JobRecoveryStateSchema,
  JobRecordSchema,
  type ActorContext,
  type JobRecord,
  type ProviderCredential
} from "@agentic/contracts";
import type { AgenticRepository } from "@agentic/repository";
import { ApiRouteError } from "./api-response";
import { resolveWorkspaceRoleForUser } from "./workspace-role-permissions";

const RecoveryJobIdSchema = z.string().trim().min(1).max(200);
const RecoveryCredentialIdSchema = z.string().trim().min(1).max(240);
const RecoveryReasonSchema = z.string().trim().max(500).optional();

export const OperationsRecoveryRequestSchema = z.discriminatedUnion("action", [
  z
    .object({
      action: z.literal("retry_dead_letter_job"),
      jobId: RecoveryJobIdSchema
    })
    .strict(),
  z
    .object({
      action: z.literal("cancel_job"),
      jobId: RecoveryJobIdSchema,
      confirm: z.literal(true),
      reason: RecoveryReasonSchema
    })
    .strict(),
  z
    .object({
      action: z.literal("release_expired_lease"),
      jobId: RecoveryJobIdSchema,
      reason: RecoveryReasonSchema
    })
    .strict(),
  z
    .object({
      action: z.literal("revalidate_connector_credential"),
      credentialId: RecoveryCredentialIdSchema,
      reason: RecoveryReasonSchema
    })
    .strict(),
  z
    .object({
      action: z.literal("mark_connector_reconnect_required"),
      credentialId: RecoveryCredentialIdSchema,
      confirm: z.literal(true),
      reason: RecoveryReasonSchema
    })
    .strict()
]);

export type OperationsRecoveryRequest = z.infer<typeof OperationsRecoveryRequestSchema>;

export type RedactedProviderCredential = Pick<
  ProviderCredential,
  | "id"
  | "workspaceId"
  | "provider"
  | "accountEmail"
  | "displayName"
  | "status"
  | "lastValidatedAt"
  | "lastRefreshFailureAt"
  | "reconnectRequiredAt"
  | "revokedAt"
  | "expiresAt"
  | "updatedAt"
>;

export type OperationsRecoveryResponse =
  | {
      action: "cancel_job" | "release_expired_lease";
      job: JobRecord;
      dashboardStatusUrl: string;
    }
  | {
      action: "revalidate_connector_credential" | "mark_connector_reconnect_required";
      credential: RedactedProviderCredential;
    };

type RecoveryContext = {
  repository: AgenticRepository;
  userId: string;
  actorContext: ActorContext;
  request: Exclude<OperationsRecoveryRequest, { action: "retry_dead_letter_job" }>;
  now?: string;
};

function nowIso(now?: string): string {
  return now ?? new Date().toISOString();
}

function jobPayloadWorkspaceId(job: JobRecord): string | null {
  return "workspaceId" in job.payload ? job.payload.workspaceId ?? null : null;
}

async function resolveJobWorkspaceId(repository: AgenticRepository, job: JobRecord, userId: string): Promise<string | null> {
  const directWorkspaceId = jobPayloadWorkspaceId(job);
  if (directWorkspaceId) {
    return directWorkspaceId;
  }

  if ("goalId" in job.payload && typeof job.payload.goalId === "string") {
    const bundle = await repository.getGoalBundleForUser(job.payload.goalId, userId);
    return bundle?.goal.workspaceId ?? null;
  }

  return null;
}

async function assertWorkspaceOwner(params: {
  repository: AgenticRepository;
  workspaceId: string | null;
  userId: string;
}) {
  if (!params.workspaceId) {
    return;
  }

  const members = await params.repository.listWorkspaceMembers(params.workspaceId, params.userId);
  const role = resolveWorkspaceRoleForUser(members, params.workspaceId, params.userId);

  if (role !== "owner") {
    throw new ApiRouteError(403, "Only workspace owners can perform operations recovery actions.");
  }
}

export async function assertJobRecoveryAllowed(params: {
  repository: AgenticRepository;
  userId: string;
  jobId: string;
}): Promise<JobRecord> {
  const job = await params.repository.getJob(params.jobId, params.userId);

  if (!job) {
    throw new ApiRouteError(404, `Job ${params.jobId} was not found.`);
  }

  await assertWorkspaceOwner({
    repository: params.repository,
    workspaceId: await resolveJobWorkspaceId(params.repository, job, params.userId),
    userId: params.userId
  });

  return job;
}

function buildStatusUrl(job: JobRecord): string {
  return job.kind === "approval_follow_up" ? `/api/approvals/jobs/${job.id}` : `/api/jobs/${job.id}`;
}

async function cancelJob(params: RecoveryContext & { request: Extract<OperationsRecoveryRequest, { action: "cancel_job" }> }) {
  const job = await assertJobRecoveryAllowed({
    repository: params.repository,
    userId: params.userId,
    jobId: params.request.jobId
  });

  if (job.status !== "queued" && job.status !== "retrying") {
    throw new ApiRouteError(409, `Job ${job.id} is ${job.status} and cannot be cancelled from the queue.`);
  }

  const at = nowIso(params.now);
  const reason = params.request.reason?.trim() || "Cancelled by operator from the operations recovery lane.";
  const cancelled = JobRecordSchema.parse({
    ...job,
    status: "dead_letter",
    idempotencyKey: `${job.id}:cancelled:${Date.parse(at) || Date.now()}`,
    claimedBy: null,
    claimedAt: null,
    leaseExpiresAt: null,
    deadLetteredAt: at,
    lastError: reason,
    updatedAt: at,
    journal: appendJobExecutionJournalEntry({
      journal: job.journal,
      at,
      status: "dead_letter",
      attemptCount: job.attemptCount,
      summary: `Operator cancelled queued job ${job.id}.`,
      error: reason,
      metadata: {
        recoveryAction: "cancel_job",
        actorUserId: params.actorContext.subjectUserId
      },
      recovery: JobRecoveryStateSchema.parse({
        strategy: "manual_review",
        note: "The job was cancelled by an operator before another worker attempt.",
        operatorActionLabel: null,
        statusUrl: buildStatusUrl(job),
        replayedFromJobId: job.journal.replayedFromJobId,
        compensationHints: []
      })
    })
  });
  const saved = await params.repository.enqueueJob(cancelled);

  return {
    action: "cancel_job" as const,
    job: saved,
    dashboardStatusUrl: buildStatusUrl(saved)
  };
}

async function releaseExpiredLease(
  params: RecoveryContext & { request: Extract<OperationsRecoveryRequest, { action: "release_expired_lease" }> }
) {
  const job = await assertJobRecoveryAllowed({
    repository: params.repository,
    userId: params.userId,
    jobId: params.request.jobId
  });
  const at = nowIso(params.now);
  const leaseExpiresAt = job.leaseExpiresAt ? Date.parse(job.leaseExpiresAt) : Number.NaN;

  if (job.status !== "running" || !job.claimedBy || !Number.isFinite(leaseExpiresAt) || leaseExpiresAt > Date.parse(at)) {
    throw new ApiRouteError(409, `Job ${job.id} does not have an expired worker lease to release.`);
  }

  const released = await params.repository.retryJob({
    jobId: job.id,
    runnerId: job.claimedBy,
    availableAt: at,
    error: params.request.reason?.trim() || "Operator released an expired worker lease."
  });

  return {
    action: "release_expired_lease" as const,
    job: released,
    dashboardStatusUrl: buildStatusUrl(released)
  };
}

function appendCredentialRecoveryAudit(params: {
  credential: ProviderCredential;
  action: OperationsRecoveryRequest["action"];
  actorUserId: string;
  at: string;
  reason?: string;
}): Record<string, unknown> {
  const current = Array.isArray(params.credential.metadata.recoveryAudit)
    ? params.credential.metadata.recoveryAudit
    : [];
  const nextEntry = {
    action: params.action,
    actorUserId: params.actorUserId,
    at: params.at,
    reason: params.reason?.trim().slice(0, 500) ?? null
  };

  return {
    ...params.credential.metadata,
    recoveryAudit: [...current, nextEntry].slice(-10)
  };
}

function redactCredential(credential: ProviderCredential): RedactedProviderCredential {
  return {
    id: credential.id,
    workspaceId: credential.workspaceId,
    provider: credential.provider,
    accountEmail: credential.accountEmail,
    displayName: credential.displayName,
    status: credential.status,
    lastValidatedAt: credential.lastValidatedAt,
    lastRefreshFailureAt: credential.lastRefreshFailureAt,
    reconnectRequiredAt: credential.reconnectRequiredAt,
    revokedAt: credential.revokedAt,
    expiresAt: credential.expiresAt,
    updatedAt: credential.updatedAt
  };
}

async function getRecoverableCredential(params: {
  repository: AgenticRepository;
  credentialId: string;
  userId: string;
}): Promise<ProviderCredential> {
  const credential = await params.repository.getProviderCredential(params.credentialId, params.userId);

  if (!credential) {
    throw new ApiRouteError(404, `Connector credential ${params.credentialId} was not found.`);
  }

  await assertWorkspaceOwner({
    repository: params.repository,
    workspaceId: credential.workspaceId,
    userId: params.userId
  });

  return credential;
}

async function revalidateCredential(
  params: RecoveryContext & {
    request: Extract<OperationsRecoveryRequest, { action: "revalidate_connector_credential" }>;
  }
) {
  const credential = await getRecoverableCredential({
    repository: params.repository,
    credentialId: params.request.credentialId,
    userId: params.userId
  });

  if (credential.status === "revoked") {
    throw new ApiRouteError(409, `Connector credential ${credential.id} is revoked and requires reconnect.`);
  }

  const at = nowIso(params.now);
  const saved = await params.repository.saveProviderCredential({
    ...credential,
    status: "connected",
    lastValidatedAt: at,
    lastRefreshFailureAt: null,
    reconnectRequiredAt: null,
    metadata: appendCredentialRecoveryAudit({
      credential,
      action: params.request.action,
      actorUserId: params.actorContext.subjectUserId,
      at,
      reason: params.request.reason
    }),
    actorContext: params.actorContext,
    updatedAt: at
  });

  return {
    action: "revalidate_connector_credential" as const,
    credential: redactCredential(saved)
  };
}

async function markReconnectRequired(
  params: RecoveryContext & {
    request: Extract<OperationsRecoveryRequest, { action: "mark_connector_reconnect_required" }>;
  }
) {
  const credential = await getRecoverableCredential({
    repository: params.repository,
    credentialId: params.request.credentialId,
    userId: params.userId
  });
  const at = nowIso(params.now);
  const saved = await params.repository.saveProviderCredential({
    ...credential,
    status: "reconnect_required",
    reconnectRequiredAt: at,
    metadata: appendCredentialRecoveryAudit({
      credential,
      action: params.request.action,
      actorUserId: params.actorContext.subjectUserId,
      at,
      reason: params.request.reason
    }),
    actorContext: params.actorContext,
    updatedAt: at
  });

  return {
    action: "mark_connector_reconnect_required" as const,
    credential: redactCredential(saved)
  };
}

export async function executeOperationsRecoveryAction(params: RecoveryContext): Promise<OperationsRecoveryResponse> {
  switch (params.request.action) {
    case "cancel_job":
      return cancelJob(params as RecoveryContext & { request: Extract<OperationsRecoveryRequest, { action: "cancel_job" }> });
    case "release_expired_lease":
      return releaseExpiredLease(
        params as RecoveryContext & { request: Extract<OperationsRecoveryRequest, { action: "release_expired_lease" }> }
      );
    case "revalidate_connector_credential":
      return revalidateCredential(
        params as RecoveryContext & { request: Extract<OperationsRecoveryRequest, { action: "revalidate_connector_credential" }> }
      );
    case "mark_connector_reconnect_required":
      return markReconnectRequired(
        params as RecoveryContext & { request: Extract<OperationsRecoveryRequest, { action: "mark_connector_reconnect_required" }> }
      );
  }
}
