import crypto from "node:crypto";
import { Pool } from "pg";

const TELEGRAM_ACTION_PREFIX = "ta:";
const TELEGRAM_ACTION_ID_BYTES = 12;
const TELEGRAM_ACTION_STORE_MAX_ENTRIES = 1024;
const TELEGRAM_ACTION_STORE_CLEANUP_INTERVAL_MS = 60_000;
const TELEGRAM_ACTION_STORE_RETENTION_MS = 24 * 60 * 60 * 1000;

const TELEGRAM_APPROVAL_ACTIONS_BOOTSTRAP_SQL = `
create table if not exists telegram_approval_actions (
  action_id text primary key,
  approval_id text not null,
  goal_id text not null,
  workspace_id text,
  decision text not null,
  expires_at timestamptz not null,
  consumed_at timestamptz,
  created_at timestamptz not null
);

create index if not exists telegram_approval_actions_approval_id_idx
  on telegram_approval_actions (approval_id);

create index if not exists telegram_approval_actions_expires_at_idx
  on telegram_approval_actions (expires_at);
`;

export type TelegramApprovalDecision = "approved" | "rejected";

export type TelegramApprovalActionRecord = {
  actionId: string;
  approvalId: string;
  goalId: string;
  workspaceId: string | null;
  decision: TelegramApprovalDecision;
  expiresAt: string;
  consumedAt: string | null;
  createdAt: string;
};

type StoredTelegramApprovalActionRecord = TelegramApprovalActionRecord;

declare global {
  // eslint-disable-next-line no-var
  var __agenticTelegramApprovalStore: Map<string, StoredTelegramApprovalActionRecord> | undefined;
  // eslint-disable-next-line no-var
  var __agenticTelegramApprovalStoreLastCleanupAt: number | undefined;
  // eslint-disable-next-line no-var
  var __agenticTelegramApprovalStorePool: Pool | undefined;
  // eslint-disable-next-line no-var
  var __agenticTelegramApprovalStoreBootstrap: Promise<void> | undefined;
}

export class TelegramApprovalStoreError extends Error {
  constructor(message: string, cause?: unknown) {
    super(message, { cause });
    this.name = "TelegramApprovalStoreError";
  }
}

function getDatabaseUrl(): string | null {
  return process.env.DATABASE_URL?.trim() || null;
}

function shouldUseSharedTelegramApprovalStore(): boolean {
  return Boolean(getDatabaseUrl());
}

function toIsoString(timestampMs: number): string {
  return new Date(timestampMs).toISOString();
}

function parseTimestamp(value: unknown): number | null {
  if (value === null || value === undefined) {
    return null;
  }

  if (value instanceof Date) {
    return value.getTime();
  }

  const parsed = Date.parse(String(value));
  return Number.isFinite(parsed) ? parsed : null;
}

function normalizeTelegramId(value: string | number): string {
  return String(value).trim();
}

function parseTelegramUserMap(): Map<string, string> {
  const raw = process.env.TELEGRAM_USER_MAP?.trim();
  const mappings = new Map<string, string>();

  if (!raw) {
    return mappings;
  }

  for (const entry of raw.split(/[,\n;]/)) {
    const [telegramActor, userId] = entry.split(":").map((value) => value?.trim() ?? "");

    if (!telegramActor || !userId) {
      continue;
    }

    mappings.set(telegramActor, userId);
  }

  return mappings;
}

export function resolveTelegramActorUserId(params: { telegramUserId: string | number; chatId?: string | number | null }): string | null {
  const mappings = parseTelegramUserMap();
  const telegramUserId = normalizeTelegramId(params.telegramUserId);
  const chatId = params.chatId === undefined || params.chatId === null ? null : normalizeTelegramId(params.chatId);

  if (chatId) {
    const scoped = mappings.get(`${chatId}/${telegramUserId}`);
    if (scoped) {
      return scoped;
    }
  }

  return mappings.get(telegramUserId) ?? null;
}

export function buildTelegramCallbackData(actionId: string): string {
  return `${TELEGRAM_ACTION_PREFIX}${actionId}`;
}

export function parseTelegramCallbackData(callbackData: string): string | null {
  const value = callbackData.trim();

  if (!value.startsWith(TELEGRAM_ACTION_PREFIX)) {
    return null;
  }

  const actionId = value.slice(TELEGRAM_ACTION_PREFIX.length);

  if (!actionId || actionId.length > 61) {
    return null;
  }

  return actionId;
}

function createTelegramActionId(): string {
  return crypto.randomBytes(TELEGRAM_ACTION_ID_BYTES).toString("base64url");
}

function createActionRecord(params: {
  approvalId: string;
  goalId: string;
  workspaceId: string | null;
  decision: TelegramApprovalDecision;
  expiresAt: string;
  now: string;
}): TelegramApprovalActionRecord {
  return {
    actionId: createTelegramActionId(),
    approvalId: params.approvalId,
    goalId: params.goalId,
    workspaceId: params.workspaceId,
    decision: params.decision,
    expiresAt: params.expiresAt,
    consumedAt: null,
    createdAt: params.now
  };
}

function getInMemoryStore(): Map<string, StoredTelegramApprovalActionRecord> {
  globalThis.__agenticTelegramApprovalStore ??= new Map();
  return globalThis.__agenticTelegramApprovalStore;
}

function cleanupInMemoryStore(now = Date.now()): void {
  const lastCleanupAt = globalThis.__agenticTelegramApprovalStoreLastCleanupAt ?? 0;

  if (now - lastCleanupAt < TELEGRAM_ACTION_STORE_CLEANUP_INTERVAL_MS) {
    return;
  }

  globalThis.__agenticTelegramApprovalStoreLastCleanupAt = now;
  const cutoff = now - TELEGRAM_ACTION_STORE_RETENTION_MS;
  const store = getInMemoryStore();

  for (const [key, record] of store.entries()) {
    const expiresAt = Date.parse(record.expiresAt);
    const consumedAt = record.consumedAt ? Date.parse(record.consumedAt) : null;

    if ((Number.isFinite(expiresAt) && expiresAt <= now) || (consumedAt !== null && consumedAt <= cutoff)) {
      store.delete(key);
    }
  }

  if (store.size <= TELEGRAM_ACTION_STORE_MAX_ENTRIES) {
    return;
  }

  const sortedEntries = [...store.entries()].sort((left, right) => left[1].createdAt.localeCompare(right[1].createdAt));
  const deleteCount = sortedEntries.length - TELEGRAM_ACTION_STORE_MAX_ENTRIES;

  for (const [key] of sortedEntries.slice(0, deleteCount)) {
    store.delete(key);
  }
}

function getPool(): Pool {
  const databaseUrl = getDatabaseUrl();

  if (!databaseUrl) {
    throw new TelegramApprovalStoreError("Telegram approval actions require DATABASE_URL when shared storage is enabled.");
  }

  globalThis.__agenticTelegramApprovalStorePool ??= new Pool({
    connectionString: databaseUrl,
    application_name: "agentic-telegram-approvals",
    connectionTimeoutMillis: 2_000,
    idleTimeoutMillis: 30_000,
    max: 10,
    query_timeout: 5_000,
    statement_timeout: 5_000
  });

  return globalThis.__agenticTelegramApprovalStorePool;
}

async function ensureTables(): Promise<void> {
  globalThis.__agenticTelegramApprovalStoreBootstrap ??= getPool()
    .query(TELEGRAM_APPROVAL_ACTIONS_BOOTSTRAP_SQL)
    .then(() => undefined)
    .catch((error) => {
      globalThis.__agenticTelegramApprovalStoreBootstrap = undefined;
      throw new TelegramApprovalStoreError("Failed to initialize Telegram approval action tables.", error);
    });

  return globalThis.__agenticTelegramApprovalStoreBootstrap;
}

async function cleanupSharedStore(now = Date.now()): Promise<void> {
  const lastCleanupAt = globalThis.__agenticTelegramApprovalStoreLastCleanupAt ?? 0;

  if (now - lastCleanupAt < TELEGRAM_ACTION_STORE_CLEANUP_INTERVAL_MS) {
    return;
  }

  globalThis.__agenticTelegramApprovalStoreLastCleanupAt = now;
  const retentionCutoff = toIsoString(now - TELEGRAM_ACTION_STORE_RETENTION_MS);
  const nowIso = toIsoString(now);

  try {
    await getPool().query(
      `
        delete from telegram_approval_actions
        where expires_at <= $1
           or (consumed_at is not null and consumed_at <= $2)
      `,
      [nowIso, retentionCutoff]
    );
  } catch (error) {
    throw new TelegramApprovalStoreError("Failed to clean up Telegram approval actions.", error);
  }
}

export async function createTelegramApprovalActions(params: {
  approvalId: string;
  goalId: string;
  workspaceId: string | null;
  expiresAt: string;
}): Promise<{ approveActionId: string; rejectActionId: string }> {
  const now = new Date().toISOString();
  const approve = createActionRecord({
    ...params,
    decision: "approved",
    now
  });
  const reject = createActionRecord({
    ...params,
    decision: "rejected",
    now
  });

  if (!shouldUseSharedTelegramApprovalStore()) {
    cleanupInMemoryStore();
    const store = getInMemoryStore();
    store.set(approve.actionId, approve);
    store.set(reject.actionId, reject);

    return {
      approveActionId: buildTelegramCallbackData(approve.actionId),
      rejectActionId: buildTelegramCallbackData(reject.actionId)
    };
  }

  try {
    await ensureTables();
    await cleanupSharedStore();
    await getPool().query(
      `
        insert into telegram_approval_actions (
          action_id,
          approval_id,
          goal_id,
          workspace_id,
          decision,
          expires_at,
          consumed_at,
          created_at
        )
        values
          ($1, $2, $3, $4, $5, $6, null, $7),
          ($8, $2, $3, $4, $9, $6, null, $7)
      `,
      [
        approve.actionId,
        approve.approvalId,
        approve.goalId,
        approve.workspaceId,
        approve.decision,
        approve.expiresAt,
        approve.createdAt,
        reject.actionId,
        reject.decision
      ]
    );
  } catch (error) {
    throw new TelegramApprovalStoreError("Failed to create Telegram approval actions.", error);
  }

  return {
    approveActionId: buildTelegramCallbackData(approve.actionId),
    rejectActionId: buildTelegramCallbackData(reject.actionId)
  };
}

export async function getTelegramApprovalAction(callbackData: string): Promise<TelegramApprovalActionRecord | null> {
  const actionId = parseTelegramCallbackData(callbackData);

  if (!actionId) {
    return null;
  }

  const now = Date.now();

  if (!shouldUseSharedTelegramApprovalStore()) {
    cleanupInMemoryStore(now);
    const record = getInMemoryStore().get(actionId);

    if (!record || record.consumedAt !== null || Date.parse(record.expiresAt) <= now) {
      return null;
    }

    return record;
  }

  try {
    await ensureTables();
    await cleanupSharedStore(now);
    const result = await getPool().query<{
      action_id: string;
      approval_id: string;
      goal_id: string;
      workspace_id: string | null;
      decision: string;
      expires_at: string | Date;
      consumed_at: string | Date | null;
      created_at: string | Date;
    }>(
      `
        select action_id, approval_id, goal_id, workspace_id, decision, expires_at, consumed_at, created_at
        from telegram_approval_actions
        where action_id = $1
      `,
      [actionId]
    );

    const row = result.rows[0];

    if (!row) {
      return null;
    }

    if (row.consumed_at !== null) {
      return null;
    }

    const expiresAt = parseTimestamp(row.expires_at);

    if (expiresAt === null || expiresAt <= now) {
      return null;
    }

    return {
      actionId: row.action_id,
      approvalId: row.approval_id,
      goalId: row.goal_id,
      workspaceId: row.workspace_id,
      decision: row.decision === "approved" ? "approved" : "rejected",
      expiresAt: new Date(expiresAt).toISOString(),
      consumedAt: row.consumed_at ? new Date(parseTimestamp(row.consumed_at) ?? now).toISOString() : null,
      createdAt: new Date(parseTimestamp(row.created_at) ?? now).toISOString()
    };
  } catch (error) {
    throw new TelegramApprovalStoreError("Failed to read Telegram approval action.", error);
  }
}

export async function consumeTelegramApprovalActions(approvalId: string): Promise<void> {
  const consumedAt = new Date().toISOString();

  if (!shouldUseSharedTelegramApprovalStore()) {
    const store = getInMemoryStore();

    for (const record of store.values()) {
      if (record.approvalId === approvalId && record.consumedAt === null) {
        record.consumedAt = consumedAt;
      }
    }

    return;
  }

  try {
    await ensureTables();
    await getPool().query(
      `
        update telegram_approval_actions
        set consumed_at = coalesce(consumed_at, $2)
        where approval_id = $1
      `,
      [approvalId, consumedAt]
    );
  } catch (error) {
    throw new TelegramApprovalStoreError("Failed to consume Telegram approval actions.", error);
  }
}

export function resetTelegramApprovalActionStoreForTests(): void {
  globalThis.__agenticTelegramApprovalStore = new Map();
  globalThis.__agenticTelegramApprovalStoreLastCleanupAt = 0;
}
