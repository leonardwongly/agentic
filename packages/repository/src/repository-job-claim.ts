import { clone, JobKindSchema, JobRecordSchema, type JobKind, type JobRecord } from "@agentic/contracts";
import type { PoolClient } from "pg";
import {
  buildExhaustedJobDeadLetter,
  claimJobRecord,
  isJobAttemptBudgetExhausted,
  isJobBlockedByConcurrency,
  isJobClaimableAt,
  sortJobsForClaim
} from "./repository-runtime-helpers";
import { JobMutationError, type JobConcurrencyLimits } from "./repository-types";

export type ClaimNextJobParams = {
  userId?: string;
  kinds?: JobKind[];
  queue?: string;
  runnerId: string;
  leaseMs: number;
  now?: string;
  concurrencyLimits?: JobConcurrencyLimits;
};

type JobStore = {
  jobs: JobRecord[];
};

export type ClaimNextJobOutcome = {
  /** The job handed to this runner, or null when nothing claimable was left. */
  claimed: JobRecord | null;
  /** Jobs that were non-claimable at their attempt cap and are now dead-lettered. */
  deadLettered: JobRecord[];
};

function describeClaimFailure(job: JobRecord, error: unknown): JobMutationError {
  const reason = error instanceof Error ? error.message : "record is not schema-valid";

  return new JobMutationError(
    "not_running",
    `Job ${job.id} could not be claimed (poison record): ${reason}`.slice(0, 500)
  );
}

function describeRowClaimFailure(error: unknown): JobMutationError {
  const reason = error instanceof Error ? error.message : "row is not schema-valid";

  return new JobMutationError(
    "not_running",
    `Claimed job row could not be materialised (poison record): ${reason}`.slice(0, 500)
  );
}

const CLAIM_ORDER_BY = `order by case priority when 'critical' then 0 when 'high' then 1 when 'normal' then 2 when 'low' then 3 when 'maintenance' then 4 else 2 end asc, available_at asc, created_at asc`;
const CLAIMABLE_STATUS_PREDICATE = `((status in ('queued', 'retrying') and available_at <= $1) or (status = 'running' and lease_expires_at is not null and lease_expires_at <= $1))`;
const MAX_EXHAUSTED_SWEEP_PER_TICK = 10;

function normalizeSqlConcurrencyLimit(value: number | undefined): number | null {
  if (!Number.isInteger(value) || value === undefined || value <= 0) {
    return null;
  }

  return value;
}

function isJobInClaimScope(job: JobRecord, params: ClaimNextJobParams, kinds: JobKind[]): boolean {
  if (params.userId && job.userId !== params.userId) {
    return false;
  }

  if (kinds.length > 0 && !kinds.includes(job.kind)) {
    return false;
  }

  if (params.queue && job.queue !== params.queue) {
    return false;
  }

  return true;
}

export function claimNextJobFromStore(store: JobStore, params: ClaimNextJobParams): JobRecord | null {
  return claimNextJobFromStoreWithOutcome(store, params).claimed;
}

/**
 * Claim the next job in the file-backed store, recovering from poison records instead of
 * throwing them at the worker:
 *
 * 1. A job whose attempt budget is already spent is non-claimable and is dead-lettered on
 *    claim, so a worker that keeps dying mid-lease fails over instead of black-holing the
 *    queue (the successor record would otherwise breach the attemptCount/journal cap of 25).
 * 2. A candidate whose claim cannot be materialised at all is skipped so the rest of the
 *    queue keeps draining; the residual schema violation is only surfaced - as a typed
 *    JobMutationError - on a tick that had nothing else to hand out.
 */
export function claimNextJobFromStoreWithOutcome(store: JobStore, params: ClaimNextJobParams): ClaimNextJobOutcome {
  const claimedAt = params.now ?? new Date().toISOString();
  const claimedAtMs = Date.parse(claimedAt);
  const kinds = params.kinds?.map((kind) => JobKindSchema.parse(kind)) ?? [];
  const runningJobs = store.jobs.filter((job) => job.status === "running" && isJobInClaimScope(job, params, kinds));
  const candidates = sortJobsForClaim(
    store.jobs.filter(
      (job) =>
        isJobInClaimScope(job, params, kinds) &&
        isJobClaimableAt(job, claimedAtMs) &&
        !isJobBlockedByConcurrency(job, runningJobs, params.concurrencyLimits, claimedAtMs)
    )
  );
  const deadLettered: JobRecord[] = [];
  let claimFailure: JobMutationError | null = null;
  let claimed: JobRecord | null = null;

  for (const candidate of candidates) {
    if (isJobAttemptBudgetExhausted(candidate)) {
      deadLettered.push(buildExhaustedJobDeadLetter(candidate, { at: claimedAt, runnerId: params.runnerId }));
      continue;
    }

    try {
      claimed = JobRecordSchema.parse(clone(claimJobRecord(candidate, params.runnerId, params.leaseMs, claimedAt)));
      break;
    } catch (error) {
      claimFailure ??= describeClaimFailure(candidate, error);
    }
  }

  if (deadLettered.length > 0) {
    const replacements = new Map(deadLettered.map((job) => [job.id, job]));
    store.jobs = store.jobs.map((job) => replacements.get(job.id) ?? job);
  }

  if (!claimed && !deadLettered.length && claimFailure) {
    throw claimFailure;
  }

  return { claimed, deadLettered };
}

export async function claimNextJobWithClient(
  client: PoolClient,
  params: ClaimNextJobParams,
  mapJobRow: (row: Record<string, unknown>) => JobRecord,
  saveJobWithClient: (client: PoolClient, job: JobRecord) => Promise<void>
): Promise<JobRecord | null> {
  const claimedAt = params.now ?? new Date().toISOString();
  const kinds = params.kinds?.map((kind) => JobKindSchema.parse(kind)) ?? [];

  // Same recovery contract as the file-backed claim: dead-letter jobs that already spent
  // their attempt budget before looking for a claim, so a poison record can never make the
  // worker tick throw (and therefore never blocks the jobs queued behind it).
  await deadLetterExhaustedJobsWithClient(client, params, kinds, claimedAt, mapJobRow, saveJobWithClient);

  const values: unknown[] = [claimedAt];
  const maxRunningPerKind = normalizeSqlConcurrencyLimit(params.concurrencyLimits?.maxRunningPerKind);
  const maxRunningPerUser = normalizeSqlConcurrencyLimit(params.concurrencyLimits?.maxRunningPerUser);
  const maxRunningPerConcurrencyKey = normalizeSqlConcurrencyLimit(params.concurrencyLimits?.maxRunningPerConcurrencyKey);
  const predicates = [CLAIMABLE_STATUS_PREDICATE, `attempt_count < max_attempts`];
  let kindsParameter: number | null = null;
  let queueParameter: number | null = null;

  if (params.userId) {
    values.push(params.userId);
    predicates.push(`user_id = $${values.length}`);
  }

  if (kinds.length > 0) {
    values.push(kinds);
    kindsParameter = values.length;
    predicates.push(`kind = any($${values.length}::text[])`);
  }

  if (params.queue) {
    values.push(params.queue);
    queueParameter = values.length;
    predicates.push(`queue_name = $${values.length}`);
  }

  if (maxRunningPerKind !== null || maxRunningPerUser !== null || maxRunningPerConcurrencyKey !== null) {
    await client.query("select pg_advisory_xact_lock(hashtext('agentic:jobs:concurrency'))");
  }

  if (maxRunningPerKind !== null) {
    values.push(maxRunningPerKind);
    predicates.push(`
      (
        select count(*) from jobs running_kind
        where running_kind.status = 'running'
          and running_kind.kind = jobs.kind
          ${params.userId ? `and running_kind.user_id = jobs.user_id` : ""}
          ${queueParameter !== null ? `and running_kind.queue_name = $${queueParameter}` : ""}
          and (running_kind.lease_expires_at is null or running_kind.lease_expires_at > $1)
      ) < $${values.length}
    `);
  }

  if (maxRunningPerUser !== null) {
    values.push(maxRunningPerUser);
    predicates.push(`
      (
        select count(*) from jobs running_user
        where running_user.status = 'running'
          and running_user.user_id = jobs.user_id
          ${kindsParameter !== null ? `and running_user.kind = any($${kindsParameter}::text[])` : ""}
          ${queueParameter !== null ? `and running_user.queue_name = $${queueParameter}` : ""}
          and (running_user.lease_expires_at is null or running_user.lease_expires_at > $1)
      ) < $${values.length}
    `);
  }

  if (maxRunningPerConcurrencyKey !== null) {
    values.push(maxRunningPerConcurrencyKey);
    predicates.push(`
      (
        jobs.concurrency_key is null
        or (
          select count(*) from jobs running_key
          where running_key.status = 'running'
            and running_key.concurrency_key = jobs.concurrency_key
            ${params.userId ? `and running_key.user_id = jobs.user_id` : ""}
            ${kindsParameter !== null ? `and running_key.kind = any($${kindsParameter}::text[])` : ""}
            ${queueParameter !== null ? `and running_key.queue_name = $${queueParameter}` : ""}
            and (running_key.lease_expires_at is null or running_key.lease_expires_at > $1)
        ) < $${values.length}
      )
    `);
  }

  const result = await client.query(
    `
      select * from jobs
      where ${predicates.join(" and ")}
      ${CLAIM_ORDER_BY}
      limit 1
      for update skip locked
    `,
    values
  );
  let claimable: JobRecord | null = null;

  if (result.rows[0]) {
    try {
      claimable = mapJobRow(result.rows[0]);
    } catch (error) {
      throw describeRowClaimFailure(error);
    }
  }

  if (!claimable) {
    return null;
  }

  let claimed: JobRecord;

  try {
    claimed = JobRecordSchema.parse(clone(claimJobRecord(claimable, params.runnerId, params.leaseMs, claimedAt)));
  } catch (error) {
    throw describeClaimFailure(claimable, error);
  }

  await saveJobWithClient(client, claimed);
  return claimed;
}

async function deadLetterExhaustedJobsWithClient(
  client: PoolClient,
  params: ClaimNextJobParams,
  kinds: JobKind[],
  claimedAt: string,
  mapJobRow: (row: Record<string, unknown>) => JobRecord,
  saveJobWithClient: (client: PoolClient, job: JobRecord) => Promise<void>
): Promise<number> {
  const values: unknown[] = [claimedAt];
  const predicates = [CLAIMABLE_STATUS_PREDICATE, `attempt_count >= max_attempts`];

  if (params.userId) {
    values.push(params.userId);
    predicates.push(`user_id = $${values.length}`);
  }

  if (kinds.length > 0) {
    values.push(kinds);
    predicates.push(`kind = any($${values.length}::text[])`);
  }

  if (params.queue) {
    values.push(params.queue);
    predicates.push(`queue_name = $${values.length}`);
  }

  let swept = 0;

  for (let guard = 0; guard < MAX_EXHAUSTED_SWEEP_PER_TICK; guard += 1) {
    const result = await client.query(
      `
        select * from jobs
        where ${predicates.join(" and ")}
        ${CLAIM_ORDER_BY}
        limit 1
        for update skip locked
      `,
      values
    );

    if (!result.rows[0]) {
      break;
    }

    let exhausted: JobRecord;

    try {
      exhausted = mapJobRow(result.rows[0]);
    } catch (error) {
      throw describeRowClaimFailure(error);
    }

    if (!isJobAttemptBudgetExhausted(exhausted)) {
      // The row no longer qualifies (another runner just took it over); stop sweeping.
      break;
    }

    await saveJobWithClient(
      client,
      buildExhaustedJobDeadLetter(exhausted, { at: claimedAt, runnerId: params.runnerId })
    );
    swept += 1;
  }

  return swept;
}
