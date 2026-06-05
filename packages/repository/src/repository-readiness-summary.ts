import type { Pool } from "pg";
import { DEFAULT_OWNER_USER_ID, nowIso, type JobRecord, type ProviderCredential } from "@agentic/contracts";
import type { JobReadinessSummary, ProviderCredentialReadinessSummary } from "./repository-types";

type JobReadinessSummaryParams = {
  now?: string;
  maxPendingJobAgeMs?: number;
};

type ProviderCredentialReadinessSummaryParams = {
  userId?: string;
  now?: string;
  validationStaleMs?: number;
};

const DEFAULT_MAX_PENDING_JOB_AGE_MS = 15 * 60 * 1000;
const DEFAULT_PROVIDER_VALIDATION_STALE_MS = 7 * 24 * 60 * 60 * 1000;

function parseNow(params?: { now?: string }): number {
  return Date.parse(params?.now ?? nowIso());
}

export function summarizeJobReadinessFromJobs(
  jobs: readonly JobRecord[],
  params?: JobReadinessSummaryParams
): JobReadinessSummary {
  const nowMs = parseNow(params);
  const maxPendingJobAgeMs = params?.maxPendingJobAgeMs ?? DEFAULT_MAX_PENDING_JOB_AGE_MS;
  const summary: JobReadinessSummary = {
    queuedJobs: 0,
    retryingJobs: 0,
    runningJobs: 0,
    deadLetterJobs: 0,
    expiredLeases: 0,
    stalePendingJobs: 0,
    oldestPendingJobAgeMs: null
  };

  for (const job of jobs) {
    if (job.status === "queued") {
      summary.queuedJobs += 1;
    } else if (job.status === "retrying") {
      summary.retryingJobs += 1;
    } else if (job.status === "running") {
      summary.runningJobs += 1;

      const leaseExpiresAt = job.leaseExpiresAt ? Date.parse(job.leaseExpiresAt) : Number.NaN;
      if (Number.isFinite(leaseExpiresAt) && leaseExpiresAt <= nowMs) {
        summary.expiredLeases += 1;
      }
    } else if (job.status === "dead_letter") {
      summary.deadLetterJobs += 1;
    }

    if (job.status === "queued" || job.status === "retrying") {
      const availableAt = Date.parse(job.availableAt);

      if (Number.isFinite(availableAt) && availableAt <= nowMs) {
        const ageMs = Math.max(0, nowMs - availableAt);
        summary.oldestPendingJobAgeMs =
          summary.oldestPendingJobAgeMs === null ? ageMs : Math.max(summary.oldestPendingJobAgeMs, ageMs);

        if (ageMs > maxPendingJobAgeMs) {
          summary.stalePendingJobs += 1;
        }
      }
    }
  }

  return summary;
}

export function summarizeProviderCredentialReadiness(
  credentials: readonly ProviderCredential[],
  params?: ProviderCredentialReadinessSummaryParams
): ProviderCredentialReadinessSummary {
  const userId = params?.userId ?? DEFAULT_OWNER_USER_ID;
  const nowMs = parseNow(params);
  const validationStaleMs = params?.validationStaleMs ?? DEFAULT_PROVIDER_VALIDATION_STALE_MS;
  const summary: ProviderCredentialReadinessSummary = {
    totalCredentials: 0,
    connectedCredentials: 0,
    degradedCredentials: 0,
    reconnectRequiredCredentials: 0,
    refreshFailedCredentials: 0,
    revokedCredentials: 0,
    expiredCredentials: 0,
    validationStaleCredentials: 0
  };

  for (const credential of credentials) {
    if (credential.userId !== userId) {
      continue;
    }

    summary.totalCredentials += 1;

    if (credential.status === "connected") {
      summary.connectedCredentials += 1;
    } else if (credential.status === "reconnect_required") {
      summary.reconnectRequiredCredentials += 1;
    } else if (credential.status === "refresh_failed") {
      summary.refreshFailedCredentials += 1;
    } else if (credential.status === "revoked") {
      summary.revokedCredentials += 1;
    }

    const expiresAtMs = credential.expiresAt ? Date.parse(credential.expiresAt) : null;
    const expired = expiresAtMs !== null && Number.isFinite(expiresAtMs) && expiresAtMs <= nowMs;
    const validationReferenceMs = Date.parse(credential.lastValidatedAt ?? credential.updatedAt);
    const validationStale =
      credential.status === "connected" &&
      Number.isFinite(validationReferenceMs) &&
      nowMs - validationReferenceMs >= validationStaleMs;

    if (expired) {
      summary.expiredCredentials += 1;
    }

    if (validationStale) {
      summary.validationStaleCredentials += 1;
    }

    if (
      credential.status === "reconnect_required" ||
      credential.status === "refresh_failed" ||
      credential.status === "revoked" ||
      expired ||
      validationStale
    ) {
      summary.degradedCredentials += 1;
    }
  }

  return summary;
}

export async function queryJobReadinessSummary(
  pool: Pool,
  params?: JobReadinessSummaryParams
): Promise<JobReadinessSummary> {
  const now = params?.now ?? nowIso();
  const maxPendingJobAgeMs = params?.maxPendingJobAgeMs ?? DEFAULT_MAX_PENDING_JOB_AGE_MS;
  const staleBefore = new Date(Date.parse(now) - maxPendingJobAgeMs).toISOString();
  const result = await pool.query(
    `
      select
        count(*) filter (where status = 'queued')::int as queued_jobs,
        count(*) filter (where status = 'retrying')::int as retrying_jobs,
        count(*) filter (where status = 'running')::int as running_jobs,
        count(*) filter (where status = 'dead_letter')::int as dead_letter_jobs,
        count(*) filter (
          where status = 'running'
            and lease_expires_at is not null
            and lease_expires_at <= $1::timestamptz
        )::int as expired_leases,
        count(*) filter (
          where status in ('queued', 'retrying')
            and available_at < $2::timestamptz
        )::int as stale_pending_jobs,
        extract(epoch from (
          $1::timestamptz - min(available_at) filter (
            where status in ('queued', 'retrying')
              and available_at <= $1::timestamptz
          )
        )) * 1000 as oldest_pending_job_age_ms
      from jobs
      where status in ('queued', 'running', 'retrying', 'dead_letter')
    `,
    [now, staleBefore]
  );
  const row = result.rows[0] ?? {};
  const oldestPendingJobAgeMs = row.oldest_pending_job_age_ms;

  return {
    queuedJobs: Number(row.queued_jobs ?? 0),
    retryingJobs: Number(row.retrying_jobs ?? 0),
    runningJobs: Number(row.running_jobs ?? 0),
    deadLetterJobs: Number(row.dead_letter_jobs ?? 0),
    expiredLeases: Number(row.expired_leases ?? 0),
    stalePendingJobs: Number(row.stale_pending_jobs ?? 0),
    oldestPendingJobAgeMs:
      oldestPendingJobAgeMs === null || oldestPendingJobAgeMs === undefined
        ? null
        : Math.max(0, Math.floor(Number(oldestPendingJobAgeMs)))
  };
}

export async function queryProviderCredentialReadinessSummary(
  pool: Pool,
  params?: ProviderCredentialReadinessSummaryParams
): Promise<ProviderCredentialReadinessSummary> {
  const userId = params?.userId ?? DEFAULT_OWNER_USER_ID;
  const now = params?.now ?? nowIso();
  const validationStaleMs = params?.validationStaleMs ?? DEFAULT_PROVIDER_VALIDATION_STALE_MS;
  const staleBefore = new Date(Date.parse(now) - validationStaleMs).toISOString();
  const result = await pool.query(
    `
      select
        count(*)::int as total_credentials,
        count(*) filter (where status = 'connected')::int as connected_credentials,
        count(*) filter (where status = 'reconnect_required')::int as reconnect_required_credentials,
        count(*) filter (where status = 'refresh_failed')::int as refresh_failed_credentials,
        count(*) filter (where status = 'revoked')::int as revoked_credentials,
        count(*) filter (where expires_at is not null and expires_at <= $2::timestamptz)::int as expired_credentials,
        count(*) filter (
          where status = 'connected'
            and coalesce(last_validated_at, updated_at) <= $3::timestamptz
        )::int as validation_stale_credentials,
        count(*) filter (
          where status in ('reconnect_required', 'refresh_failed', 'revoked')
            or (expires_at is not null and expires_at <= $2::timestamptz)
            or (
              status = 'connected'
              and coalesce(last_validated_at, updated_at) <= $3::timestamptz
            )
        )::int as degraded_credentials
      from provider_credentials
      where user_id = $1
    `,
    [userId, now, staleBefore]
  );
  const row = result.rows[0] ?? {};

  return {
    totalCredentials: Number(row.total_credentials ?? 0),
    connectedCredentials: Number(row.connected_credentials ?? 0),
    degradedCredentials: Number(row.degraded_credentials ?? 0),
    reconnectRequiredCredentials: Number(row.reconnect_required_credentials ?? 0),
    refreshFailedCredentials: Number(row.refresh_failed_credentials ?? 0),
    revokedCredentials: Number(row.revoked_credentials ?? 0),
    expiredCredentials: Number(row.expired_credentials ?? 0),
    validationStaleCredentials: Number(row.validation_stale_credentials ?? 0)
  };
}
