import {
  appendJobExecutionJournalEntry,
  AutopilotEventDetailsSchema,
  JobRecordSchema,
  WorkspaceSchema,
  deriveJobRecoveryState,
  nowIso,
  type AutopilotEvent,
  type AutopilotEventBudget,
  type AutopilotEventDetails,
  type GoalBundle,
  type GoalShareRecord,
  type JobExecutionJournal,
  type JobKind,
  type JobPriority,
  type JobRecord,
  type JobStatus,
  type Workspace
} from "@agentic/contracts";
import { JobMutationError, type JobConcurrencyLimits } from "./repository-types";

export type { JobConcurrencyLimits } from "./repository-types";

type GoalStoreView = {
  goals: GoalBundle["goal"][];
};

const DAY_IN_MS = 24 * 60 * 60 * 1000;

export function resolveRetentionWindow(retentionDays: number, now = nowIso()): {
  effectiveNow: string;
  effectiveNowMs: number;
  retentionCutoff: string;
  retentionCutoffMs: number;
} {
  if (!Number.isInteger(retentionDays) || retentionDays < 0) {
    throw new Error(`Retention days must be a non-negative integer. Received ${retentionDays}.`);
  }

  const effectiveNowMs = Date.parse(now);

  if (!Number.isFinite(effectiveNowMs)) {
    throw new Error(`Invalid retention clock value: ${now}.`);
  }

  const retentionCutoffMs = effectiveNowMs - retentionDays * DAY_IN_MS;

  return {
    effectiveNow: new Date(effectiveNowMs).toISOString(),
    effectiveNowMs,
    retentionCutoff: new Date(retentionCutoffMs).toISOString(),
    retentionCutoffMs
  };
}

function isGoalOwnedByWorkspace(goal: GoalBundle["goal"], workspace: Workspace): boolean {
  if (goal.workspaceId) {
    return goal.workspaceId === workspace.id;
  }

  return workspace.isPersonal && goal.userId === workspace.ownerUserId;
}

export function workspaceGoalIdsFromStore(store: GoalStoreView, workspace: Workspace): Set<string> {
  return new Set(store.goals.filter((goal) => isGoalOwnedByWorkspace(goal, workspace)).map((goal) => goal.id));
}

export function goalShareTerminalAt(share: Pick<GoalShareRecord, "expiresAt" | "revokedAt">): string {
  return share.revokedAt ?? share.expiresAt;
}

export function buildDeletedWorkspaceTombstone(workspace: Workspace, operationId: string, now = nowIso()): Workspace {
  const shortWorkspaceId = workspace.id.replace(/[^a-z0-9]/gi, "").slice(0, 24).toLowerCase() || "workspace";
  const shortOperationId = operationId.replace(/[^a-z0-9]/gi, "").slice(0, 8).toLowerCase() || "deleted";
  const slug = `deleted-${shortWorkspaceId}-${shortOperationId}`.slice(0, 120);

  return WorkspaceSchema.parse({
    ...workspace,
    slug,
    name: `Deleted workspace ${workspace.id.slice(0, 8)}`,
    description: `Deleted on ${now} by privacy operation ${operationId}.`,
    updatedAt: now
  });
}

export function isJobScopedToWorkspace(
  job: JobRecord,
  params: {
    workspaceId: string;
    goalIds: ReadonlySet<string>;
    watcherIds: ReadonlySet<string>;
    preservedPrivacyOperationId?: string;
  }
): boolean {
  switch (job.payload.type) {
    case "goal_create":
    case "goal_refine":
      return job.payload.workspaceId === params.workspaceId || params.goalIds.has(job.payload.goalId);
    case "briefing_create":
      return job.payload.workspaceId === params.workspaceId || params.goalIds.has(job.payload.goalId);
    case "template_run":
      return job.payload.workspaceId === params.workspaceId || params.goalIds.has(job.payload.goalId);
    case "autopilot_process":
      return params.watcherIds.has(job.payload.sourceId);
    case "github_issue_intake":
      return job.payload.workspaceId === params.workspaceId || params.goalIds.has(job.payload.goalId);
    case "privacy_operation":
      return (
        job.payload.workspaceId === params.workspaceId &&
        job.payload.operationId !== params.preservedPrivacyOperationId
      );
    default:
      return false;
  }
}

export function normalizeAutopilotEventDetails(
  details?: AutopilotEventDetails | Record<string, unknown>
): AutopilotEventDetails {
  return AutopilotEventDetailsSchema.parse(details ?? {});
}

export function withAutopilotSuppression(
  details: AutopilotEventDetails | Record<string, unknown> | undefined,
  suppression: {
    outcome: "allowed" | "duplicate" | "debounced" | "budget_exhausted";
    reason?: string | null;
    relatedEventId?: string | null;
    budgetKey?: string | null;
    observedCount?: number | null;
  }
): AutopilotEventDetails {
  const normalized = normalizeAutopilotEventDetails(details);
  return AutopilotEventDetailsSchema.parse({
    ...normalized,
    suppression
  });
}

function autopilotEventCountsAgainstBudget(event: AutopilotEvent): boolean {
  return event.status !== "debounced" && event.status !== "ignored";
}

export function autopilotEventMatchesBudget(params: {
  event: AutopilotEvent;
  userId: string;
  sourceId: string;
  budget: AutopilotEventBudget;
  cutoffMs: number;
}): boolean {
  if (params.event.userId !== params.userId || !autopilotEventCountsAgainstBudget(params.event)) {
    return false;
  }

  const createdMs = Date.parse(params.event.createdAt);
  if (!Number.isFinite(createdMs) || createdMs < params.cutoffMs) {
    return false;
  }

  if (params.budget.scope === "source" && params.event.sourceId !== params.sourceId) {
    return false;
  }

  const details = normalizeAutopilotEventDetails(params.event.details);
  return details.budget?.key === params.budget.key;
}

const jobPriorityRank: Record<JobPriority, number> = {
  critical: 0,
  high: 1,
  normal: 2,
  low: 3,
  maintenance: 4
};

export function sortJobsForClaim(items: JobRecord[]): JobRecord[] {
  return [...items].sort((left, right) => {
    const priorityOrder = jobPriorityRank[left.priority] - jobPriorityRank[right.priority];
    if (priorityOrder !== 0) {
      return priorityOrder;
    }

    const availableOrder = left.availableAt.localeCompare(right.availableAt);
    if (availableOrder !== 0) {
      return availableOrder;
    }

    return left.createdAt.localeCompare(right.createdAt);
  });
}

export function isJobClaimableAt(job: JobRecord, now: number): boolean {
  if (job.status === "queued" || job.status === "retrying") {
    return Date.parse(job.availableAt) <= now;
  }

  if (job.status === "running" && job.leaseExpiresAt) {
    return Date.parse(job.leaseExpiresAt) <= now;
  }

  return false;
}

function normalizeConcurrencyLimit(value: number | undefined): number | null {
  if (!Number.isInteger(value) || value === undefined || value <= 0) {
    return null;
  }

  return value;
}

function isActiveRunningJob(job: JobRecord, now: number): boolean {
  if (job.status !== "running") {
    return false;
  }

  if (!job.leaseExpiresAt) {
    return true;
  }

  const leaseExpiresAt = Date.parse(job.leaseExpiresAt);
  return Number.isFinite(leaseExpiresAt) && leaseExpiresAt > now;
}

export function isJobBlockedByConcurrency(
  candidate: JobRecord,
  runningJobs: JobRecord[],
  limits: JobConcurrencyLimits | undefined,
  now: number
): boolean {
  const maxRunningPerKind = normalizeConcurrencyLimit(limits?.maxRunningPerKind);
  const maxRunningPerUser = normalizeConcurrencyLimit(limits?.maxRunningPerUser);
  const maxRunningPerConcurrencyKey = normalizeConcurrencyLimit(limits?.maxRunningPerConcurrencyKey);

  if (!maxRunningPerKind && !maxRunningPerUser && !maxRunningPerConcurrencyKey) {
    return false;
  }

  let runningForKind = 0;
  let runningForUser = 0;
  let runningForConcurrencyKey = 0;

  for (const runningJob of runningJobs) {
    if (!isActiveRunningJob(runningJob, now)) {
      continue;
    }

    if (maxRunningPerKind && runningJob.kind === candidate.kind) {
      runningForKind += 1;
    }

    if (maxRunningPerUser && runningJob.userId === candidate.userId) {
      runningForUser += 1;
    }

    if (
      maxRunningPerConcurrencyKey &&
      candidate.concurrencyKey &&
      runningJob.concurrencyKey === candidate.concurrencyKey
    ) {
      runningForConcurrencyKey += 1;
    }
  }

  return (
    (maxRunningPerKind !== null && runningForKind >= maxRunningPerKind) ||
    (maxRunningPerUser !== null && runningForUser >= maxRunningPerUser) ||
    (maxRunningPerConcurrencyKey !== null && runningForConcurrencyKey >= maxRunningPerConcurrencyKey)
  );
}

export function buildJobConcurrencySnapshot(jobs: JobRecord[], now: number): Partial<Record<JobKind, number>> {
  return jobs.reduce<Partial<Record<JobKind, number>>>((snapshot, job) => {
    if (!isActiveRunningJob(job, now)) {
      return snapshot;
    }

    snapshot[job.kind] = (snapshot[job.kind] ?? 0) + 1;
    return snapshot;
  }, {});
}

export function buildJobLifecycleJournal(params: {
  job: JobRecord;
  status: JobStatus;
  at: string;
  summary: string;
  error?: string | null;
  metadata?: Record<string, unknown>;
  retryCount?: number;
}): JobExecutionJournal {
  return appendJobExecutionJournalEntry({
    journal: params.job.journal,
    at: params.at,
    status: params.status,
    attemptCount: params.job.attemptCount,
    summary: params.summary,
    error: params.error ?? null,
    metadata: params.metadata ?? {},
    retryCount: params.retryCount,
    recovery: deriveJobRecoveryState({
      jobId: params.job.id,
      status: params.status,
      payload: params.job.payload,
      replayedFromJobId: params.job.journal.replayedFromJobId
    })
  });
}

export function claimJobRecord(job: JobRecord, runnerId: string, leaseMs: number, claimedAt: string): JobRecord {
  return JobRecordSchema.parse({
    ...job,
    status: "running",
    attemptCount: job.attemptCount + 1,
    claimedBy: runnerId,
    claimedAt,
    lastAttemptAt: claimedAt,
    leaseExpiresAt: new Date(Date.parse(claimedAt) + leaseMs).toISOString(),
    completedAt: null,
    deadLetteredAt: null,
    journal: buildJobLifecycleJournal({
      job: {
        ...job,
        attemptCount: job.attemptCount + 1
      },
      status: "running",
      at: claimedAt,
      summary: `Attempt ${job.attemptCount + 1} claimed by ${runnerId}.`,
      metadata: {
        runnerId,
        leaseMs
      }
    }),
    updatedAt: claimedAt
  });
}

export function assertRunningJobOwner(job: JobRecord, runnerId: string, at = nowIso()): void {
  if (job.status !== "running") {
    throw new JobMutationError("not_running", `Job ${job.id} is not currently running.`);
  }

  if (job.claimedBy !== runnerId) {
    throw new JobMutationError("not_owner", `Job ${job.id} is claimed by another worker.`);
  }

  if (!job.leaseExpiresAt) {
    return;
  }

  const mutationAt = Date.parse(at);
  const leaseExpiresAt = Date.parse(job.leaseExpiresAt);

  if (!Number.isFinite(mutationAt)) {
    throw new Error(`Invalid job mutation clock value: ${at}.`);
  }

  if (!Number.isFinite(leaseExpiresAt) || leaseExpiresAt <= mutationAt) {
    throw new JobMutationError("lease_expired", `Job ${job.id} lease expired before this worker mutation.`);
  }
}
