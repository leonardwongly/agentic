import type { Pool, PoolClient } from "pg";
import { clone, WorkerRuntimeHealthSnapshotSchema, type WorkerRuntimeHealthSnapshot } from "@agentic/contracts";

export type WorkerRuntimeHealthStore = {
  workerRuntimeHealth: WorkerRuntimeHealthSnapshot[];
};

type WorkerRuntimeHealthQueryable = Pick<Pool, "query"> | PoolClient;

function sortByUpdatedAtDesc(
  records: readonly WorkerRuntimeHealthSnapshot[]
): WorkerRuntimeHealthSnapshot[] {
  return [...records].sort((left, right) => Date.parse(right.updatedAt) - Date.parse(left.updatedAt));
}

export function recordWorkerRuntimeHealthInStore(
  store: WorkerRuntimeHealthStore,
  snapshot: WorkerRuntimeHealthSnapshot
): WorkerRuntimeHealthSnapshot {
  const validated = WorkerRuntimeHealthSnapshotSchema.parse(snapshot);
  store.workerRuntimeHealth = [
    ...store.workerRuntimeHealth.filter((entry) => entry.runnerId !== validated.runnerId),
    validated
  ];
  return WorkerRuntimeHealthSnapshotSchema.parse(clone(validated));
}

export function getLatestWorkerRuntimeHealthFromStore(
  store: WorkerRuntimeHealthStore
): WorkerRuntimeHealthSnapshot | null {
  const [latest] = sortByUpdatedAtDesc(store.workerRuntimeHealth);
  return latest ? WorkerRuntimeHealthSnapshotSchema.parse(clone(latest)) : null;
}

export async function recordWorkerRuntimeHealthWithClient(
  client: PoolClient,
  snapshot: WorkerRuntimeHealthSnapshot
): Promise<void> {
  const validated = WorkerRuntimeHealthSnapshotSchema.parse(snapshot);
  await client.query(
    `
      insert into worker_runtime_health (runner_id, snapshot, updated_at)
      values ($1, $2::jsonb, $3)
      on conflict (runner_id) do update
      set snapshot = excluded.snapshot,
          updated_at = excluded.updated_at
    `,
    [validated.runnerId, JSON.stringify(validated), validated.updatedAt]
  );
}

export async function getLatestWorkerRuntimeHealthWithClient(
  queryable: WorkerRuntimeHealthQueryable
): Promise<WorkerRuntimeHealthSnapshot | null> {
  const result = await queryable.query<{ snapshot: unknown }>(
    "select snapshot from worker_runtime_health order by updated_at desc limit 1"
  );
  const row = result.rows[0];

  if (!row) {
    return null;
  }

  const parsed = WorkerRuntimeHealthSnapshotSchema.safeParse(row.snapshot);
  return parsed.success ? parsed.data : null;
}
