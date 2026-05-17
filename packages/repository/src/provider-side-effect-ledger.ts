import crypto from "node:crypto";
import type { PoolClient } from "pg";
import { clone, nowIso, ProviderSideEffectRecordSchema, type ProviderSideEffectRecord } from "@agentic/contracts";
import type { ReserveProviderSideEffectParams, UpdateProviderSideEffectParams } from "./repository-types";

export type ProviderSideEffectStore = {
  providerSideEffects: ProviderSideEffectRecord[];
};

export function providerSideEffectStoreKey(
  record: Pick<ProviderSideEffectRecord, "userId" | "idempotencyKey">
): string {
  return `${record.userId}:${record.idempotencyKey}`;
}

export function buildProviderSideEffectId(userId: string, idempotencyKey: string): string {
  return `provider-side-effect:${crypto
    .createHash("sha256")
    .update(`${userId}:${idempotencyKey}`)
    .digest("hex")
    .slice(0, 32)}`;
}

function upsertProviderSideEffectRecord(
  records: ProviderSideEffectRecord[],
  nextRecord: ProviderSideEffectRecord
): ProviderSideEffectRecord[] {
  const nextKey = providerSideEffectStoreKey(nextRecord);
  return [...records.filter((record) => providerSideEffectStoreKey(record) !== nextKey), nextRecord];
}

function buildReservedProviderSideEffectRecord(
  params: ReserveProviderSideEffectParams,
  idempotencyKey: string,
  sideEffectTarget: string,
  now: string
): ProviderSideEffectRecord {
  return ProviderSideEffectRecordSchema.parse({
    id: buildProviderSideEffectId(params.userId, idempotencyKey),
    userId: params.userId,
    workspaceId: params.workspaceId ?? null,
    goalId: params.goalId,
    taskId: params.taskId,
    adapter: params.adapter,
    operation: params.operation,
    idempotencyKey,
    sideEffectTarget,
    status: "reserved",
    providerRef: null,
    detail: null,
    error: null,
    attemptCount: 1,
    metadata: params.metadata ?? {},
    reservedAt: now,
    lastAttemptAt: now,
    completedAt: null,
    createdAt: now,
    updatedAt: now
  });
}

function reserveExistingProviderSideEffectRecord(
  existing: ProviderSideEffectRecord,
  params: ReserveProviderSideEffectParams,
  now: string
): ProviderSideEffectRecord {
  return existing.status === "completed"
    ? existing
    : ProviderSideEffectRecordSchema.parse({
        ...existing,
        attemptCount: Math.min(existing.attemptCount + 1, 25),
        lastAttemptAt: now,
        metadata: {
          ...existing.metadata,
          ...(params.metadata ?? {})
        },
        updatedAt: now
      });
}

function updateExistingProviderSideEffectRecord(
  existing: ProviderSideEffectRecord,
  params: UpdateProviderSideEffectParams,
  now: string
): ProviderSideEffectRecord {
  return ProviderSideEffectRecordSchema.parse({
    ...existing,
    status: params.status,
    providerRef: params.providerRef === undefined ? existing.providerRef : params.providerRef?.trim() || null,
    detail: params.detail === undefined ? existing.detail : params.detail?.trim() || null,
    error: params.error === undefined ? existing.error : params.error?.trim() || null,
    metadata: {
      ...existing.metadata,
      ...(params.metadata ?? {})
    },
    completedAt: params.status === "completed" ? now : existing.completedAt,
    updatedAt: now
  });
}

export function reserveProviderSideEffectInStore(
  store: ProviderSideEffectStore,
  params: ReserveProviderSideEffectParams
): ProviderSideEffectRecord {
  const now = params.now ?? nowIso();
  const idempotencyKey = params.idempotencyKey.trim();
  const sideEffectTarget = params.sideEffectTarget.trim();
  const existing = store.providerSideEffects.find(
    (candidate) => candidate.userId === params.userId && candidate.idempotencyKey === idempotencyKey
  );
  const record = existing
    ? reserveExistingProviderSideEffectRecord(existing, params, now)
    : buildReservedProviderSideEffectRecord(params, idempotencyKey, sideEffectTarget, now);

  store.providerSideEffects = upsertProviderSideEffectRecord(store.providerSideEffects, record);
  return ProviderSideEffectRecordSchema.parse(clone(record));
}

export function updateProviderSideEffectInStore(
  store: ProviderSideEffectStore,
  params: UpdateProviderSideEffectParams
): ProviderSideEffectRecord {
  const now = params.now ?? nowIso();
  const existing = store.providerSideEffects.find((candidate) => candidate.id === params.id);

  if (!existing) {
    throw new Error(`Provider side-effect record ${params.id} was not found.`);
  }

  const record = updateExistingProviderSideEffectRecord(existing, params, now);
  store.providerSideEffects = upsertProviderSideEffectRecord(store.providerSideEffects, record);
  return ProviderSideEffectRecordSchema.parse(clone(record));
}

export async function saveProviderSideEffectWithClient(
  client: PoolClient,
  record: ProviderSideEffectRecord
): Promise<void> {
  const validated = ProviderSideEffectRecordSchema.parse(record);
  await client.query(
    `
      insert into provider_side_effects (
        id, user_id, workspace_id, goal_id, task_id, adapter, operation, idempotency_key, side_effect_target,
        status, provider_ref, detail, error, attempt_count, metadata, reserved_at, last_attempt_at, completed_at,
        created_at, updated_at
      )
      values (
        $1, $2, $3, $4, $5, $6, $7, $8, $9,
        $10, $11, $12, $13, $14, $15::jsonb, $16, $17, $18, $19, $20
      )
      on conflict (user_id, idempotency_key) do update
      set workspace_id = excluded.workspace_id,
          goal_id = excluded.goal_id,
          task_id = excluded.task_id,
          adapter = excluded.adapter,
          operation = excluded.operation,
          side_effect_target = excluded.side_effect_target,
          status = excluded.status,
          provider_ref = excluded.provider_ref,
          detail = excluded.detail,
          error = excluded.error,
          attempt_count = excluded.attempt_count,
          metadata = excluded.metadata,
          last_attempt_at = excluded.last_attempt_at,
          completed_at = excluded.completed_at,
          updated_at = excluded.updated_at
    `,
    [
      validated.id,
      validated.userId,
      validated.workspaceId,
      validated.goalId,
      validated.taskId,
      validated.adapter,
      validated.operation,
      validated.idempotencyKey,
      validated.sideEffectTarget,
      validated.status,
      validated.providerRef,
      validated.detail,
      validated.error,
      validated.attemptCount,
      JSON.stringify(validated.metadata),
      validated.reservedAt,
      validated.lastAttemptAt,
      validated.completedAt,
      validated.createdAt,
      validated.updatedAt
    ]
  );
}

export function mapProviderSideEffectRow(row: Record<string, unknown>): ProviderSideEffectRecord {
  return ProviderSideEffectRecordSchema.parse({
    id: row.id,
    userId: row.user_id,
    workspaceId: typeof row.workspace_id === "string" ? row.workspace_id : null,
    goalId: row.goal_id,
    taskId: row.task_id,
    adapter: row.adapter,
    operation: row.operation,
    idempotencyKey: row.idempotency_key,
    sideEffectTarget: row.side_effect_target,
    status: row.status,
    providerRef: typeof row.provider_ref === "string" ? row.provider_ref : null,
    detail: typeof row.detail === "string" ? row.detail : null,
    error: typeof row.error === "string" ? row.error : null,
    attemptCount: Number(row.attempt_count),
    metadata: (row.metadata as Record<string, unknown> | null) ?? {},
    reservedAt: new Date(row.reserved_at as string | Date).toISOString(),
    lastAttemptAt: new Date(row.last_attempt_at as string | Date).toISOString(),
    completedAt: row.completed_at ? new Date(row.completed_at as string | Date).toISOString() : null,
    createdAt: new Date(row.created_at as string | Date).toISOString(),
    updatedAt: new Date(row.updated_at as string | Date).toISOString()
  });
}

export async function reserveProviderSideEffectWithClient(
  client: PoolClient,
  params: ReserveProviderSideEffectParams
): Promise<ProviderSideEffectRecord> {
  const now = params.now ?? nowIso();
  const idempotencyKey = params.idempotencyKey.trim();
  const sideEffectTarget = params.sideEffectTarget.trim();
  const existingResult = await client.query(
    "select * from provider_side_effects where user_id = $1 and idempotency_key = $2 limit 1 for update",
    [params.userId, idempotencyKey]
  );
  const existing = existingResult.rows[0] ? mapProviderSideEffectRow(existingResult.rows[0]) : null;
  const record = existing
    ? reserveExistingProviderSideEffectRecord(existing, params, now)
    : buildReservedProviderSideEffectRecord(params, idempotencyKey, sideEffectTarget, now);

  await saveProviderSideEffectWithClient(client, record);
  return ProviderSideEffectRecordSchema.parse(clone(record));
}

export async function updateProviderSideEffectWithClient(
  client: PoolClient,
  params: UpdateProviderSideEffectParams
): Promise<ProviderSideEffectRecord> {
  const now = params.now ?? nowIso();
  const existingResult = await client.query("select * from provider_side_effects where id = $1 limit 1 for update", [
    params.id
  ]);
  const existing = existingResult.rows[0] ? mapProviderSideEffectRow(existingResult.rows[0]) : null;

  if (!existing) {
    throw new Error(`Provider side-effect record ${params.id} was not found.`);
  }

  const record = updateExistingProviderSideEffectRecord(existing, params, now);
  await saveProviderSideEffectWithClient(client, record);
  return ProviderSideEffectRecordSchema.parse(clone(record));
}
