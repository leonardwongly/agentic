import {
  WatcherSchema,
  clone,
  type Watcher
} from "@agentic/contracts";

export type WatcherLeaseClaimParams = {
  watcherId: string;
  userId?: string;
  runnerId: string;
  acquiredAt: string;
  expiresAt: string;
};

type Queryable = {
  query: (text: string, values?: unknown[]) => Promise<{ rows: Record<string, unknown>[] }>;
};

function parseOptionalTime(value: string | null | undefined): number | null {
  if (!value) {
    return null;
  }

  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function isWatcherLeaseHeldByAnotherRunner(watcher: Watcher, runnerId: string, evaluatedAt: string): boolean {
  const lease = watcher.schedule.lease;
  const leaseExpiresAt = parseOptionalTime(lease?.expiresAt);

  return Boolean(lease && lease.ownerId !== runnerId && leaseExpiresAt !== null && leaseExpiresAt > Date.parse(evaluatedAt));
}

function isWatcherDue(watcher: Watcher, evaluatedAt: string): boolean {
  const nextRunAt = parseOptionalTime(watcher.schedule.nextRunAt);

  return nextRunAt === null || nextRunAt <= Date.parse(evaluatedAt);
}

function isWatcherLeaseClaimEligible(watcher: Watcher, params: WatcherLeaseClaimParams): boolean {
  if (watcher.status !== "active" || !watcher.schedule.enabled) {
    return false;
  }

  const expiryAt = parseOptionalTime(watcher.expiryAt);

  if (expiryAt !== null && expiryAt <= Date.parse(params.acquiredAt)) {
    return false;
  }

  if (isWatcherLeaseHeldByAnotherRunner(watcher, params.runnerId, params.acquiredAt)) {
    return false;
  }

  return isWatcherDue(watcher, params.acquiredAt);
}

function buildLeasedWatcher(watcher: Watcher, params: WatcherLeaseClaimParams): Watcher {
  return WatcherSchema.parse({
    ...watcher,
    schedule: {
      ...watcher.schedule,
      lease: {
        ownerId: params.runnerId,
        acquiredAt: params.acquiredAt,
        expiresAt: params.expiresAt
      }
    },
    updatedAt: params.acquiredAt
  });
}

export function claimWatcherLeaseInRuntimeStore(params: {
  watchers: Watcher[];
  visibleGoalIds: Set<string>;
  lease: WatcherLeaseClaimParams;
  normalizeWatcher: (watcher: Watcher) => Watcher;
}): Watcher | null {
  const index = params.watchers.findIndex((candidate) => candidate.id === params.lease.watcherId);
  const watcher = index >= 0 ? params.watchers[index] : null;

  if (!watcher || !params.visibleGoalIds.has(watcher.goalId)) {
    return null;
  }

  const normalized = params.normalizeWatcher(watcher);

  if (!isWatcherLeaseClaimEligible(normalized, params.lease)) {
    return null;
  }

  const leased = buildLeasedWatcher(normalized, params.lease);
  params.watchers[index] = leased;
  return WatcherSchema.parse(clone(leased));
}

export async function claimWatcherLeaseWithPostgresClient(params: {
  client: Queryable;
  userId: string;
  lease: WatcherLeaseClaimParams;
  mapWatcherRow: (row: Record<string, unknown>) => Watcher;
}): Promise<Watcher | null> {
  const result = await params.client.query(
    `
      select w.*
      from watchers w
      join goals g on g.id = w.goal_id
      left join workspace_members wm on wm.workspace_id = g.workspace_id and wm.user_id = $2
      where w.id = $1
        and (
          (g.workspace_id is null and g.user_id = $2)
          or wm.user_id is not null
        )
      for update of w
      limit 1
    `,
    [params.lease.watcherId, params.userId]
  );

  if (result.rows.length === 0) {
    return null;
  }

  const watcher = params.mapWatcherRow(result.rows[0]);

  if (!isWatcherLeaseClaimEligible(watcher, params.lease)) {
    return null;
  }

  const leased = buildLeasedWatcher(watcher, params.lease);

  await params.client.query(
    `
      update watchers
      set schedule = $2::jsonb,
          updated_at = $3
      where id = $1
    `,
    [leased.id, JSON.stringify(leased.schedule), leased.updatedAt]
  );

  return WatcherSchema.parse(clone(leased));
}
