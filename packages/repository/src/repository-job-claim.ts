import { clone, JobKindSchema, JobRecordSchema, type JobKind, type JobRecord } from "@agentic/contracts";
import type { PoolClient } from "pg";
import { claimJobRecord, isJobBlockedByConcurrency, isJobClaimableAt, sortJobsForClaim } from "./repository-runtime-helpers";
import type { JobConcurrencyLimits } from "./repository-types";

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
  const claimedAt = params.now ?? new Date().toISOString();
  const claimedAtMs = Date.parse(claimedAt);
  const kinds = params.kinds?.map((kind) => JobKindSchema.parse(kind)) ?? [];
  const runningJobs = store.jobs.filter((job) => job.status === "running" && isJobInClaimScope(job, params, kinds));
  const claimable = sortJobsForClaim(
    store.jobs.filter((job) => {
      if (params.userId && job.userId !== params.userId) {
        return false;
      }

      if (kinds.length > 0 && !kinds.includes(job.kind)) {
        return false;
      }

      if (params.queue && job.queue !== params.queue) {
        return false;
      }

      return isJobClaimableAt(job, claimedAtMs) && !isJobBlockedByConcurrency(job, runningJobs, params.concurrencyLimits, claimedAtMs);
    })
  )[0];

  return claimable ? JobRecordSchema.parse(clone(claimJobRecord(claimable, params.runnerId, params.leaseMs, claimedAt))) : null;
}

export async function claimNextJobWithClient(
  client: PoolClient,
  params: ClaimNextJobParams,
  mapJobRow: (row: Record<string, unknown>) => JobRecord,
  saveJobWithClient: (client: PoolClient, job: JobRecord) => Promise<void>
): Promise<JobRecord | null> {
  const claimedAt = params.now ?? new Date().toISOString();
  const kinds = params.kinds?.map((kind) => JobKindSchema.parse(kind)) ?? [];
  const values: unknown[] = [claimedAt];
  const maxRunningPerKind = normalizeSqlConcurrencyLimit(params.concurrencyLimits?.maxRunningPerKind);
  const maxRunningPerUser = normalizeSqlConcurrencyLimit(params.concurrencyLimits?.maxRunningPerUser);
  const maxRunningPerConcurrencyKey = normalizeSqlConcurrencyLimit(params.concurrencyLimits?.maxRunningPerConcurrencyKey);
  const predicates = [
    `((status in ('queued', 'retrying') and available_at <= $1) or (status = 'running' and lease_expires_at is not null and lease_expires_at <= $1))`
  ];
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
      order by case priority when 'critical' then 0 when 'high' then 1 when 'normal' then 2 when 'low' then 3 when 'maintenance' then 4 else 2 end asc,
        available_at asc, created_at asc
      limit 1
      for update skip locked
    `,
    values
  );
  const claimable = result.rows[0] ? mapJobRow(result.rows[0]) : null;

  if (!claimable) {
    return null;
  }

  const claimed = JobRecordSchema.parse(clone(claimJobRecord(claimable, params.runnerId, params.leaseMs, claimedAt)));
  await saveJobWithClient(client, claimed);
  return claimed;
}
