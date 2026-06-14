import { ActorContextSchema, clone, MemoryRecordSchema, type AgentName, type MemoryRecord } from "@agentic/contracts";
import type { Pool } from "pg";

export type ContextPacketMemoryQuery = {
  userId: string;
  agent?: AgentName;
  agentId?: string;
  includeExpired?: boolean;
  allowedSensitivities?: string[];
  limit?: number;
  now?: number;
};

function normalizeContextPacketLimit(value: number | undefined): number {
  return Math.max(1, Math.min(Math.trunc(value ?? 50), 200));
}

function normalizeSensitivityForQuery(value: string): string {
  return value.trim().toLowerCase();
}

function memoryMatchesContextPacketQuery(memory: MemoryRecord, params: ContextPacketMemoryQuery): boolean {
  if (memory.userId !== params.userId) {
    return false;
  }

  if (!params.includeExpired && memory.expiryAt) {
    const expiryAt = Date.parse(memory.expiryAt);
    if (Number.isFinite(expiryAt) && expiryAt <= (params.now ?? Date.now())) {
      return false;
    }
  }

  if (params.agent && !memory.permissions.includes(params.agent)) {
    return false;
  }

  if (memory.agentId && memory.agentId !== params.agentId) {
    return false;
  }

  const sensitivity = normalizeSensitivityForQuery(memory.sensitivity);
  if (!params.allowedSensitivities) {
    return sensitivity !== "restricted";
  }

  return new Set(params.allowedSensitivities.map(normalizeSensitivityForQuery)).has(sensitivity);
}

function mapMemoryRow(row: Record<string, unknown>): MemoryRecord {
  return MemoryRecordSchema.parse({
    id: row.id,
    userId: row.user_id,
    category: row.category,
    memoryType: row.memory_type,
    content: row.content,
    confidence: Number(row.confidence),
    source: row.source,
    sensitivity: row.sensitivity,
    permissions: row.permissions ?? [],
    actorContext: row.actor_context ? ActorContextSchema.parse(row.actor_context) : null,
    contextPacketConsent: row.context_packet_consent ?? null,
    agentId: typeof row.agent_id === "string" ? row.agent_id : null,
    agentScope: typeof row.agent_scope === "string" ? row.agent_scope : "global",
    reviewAt: row.review_at ? new Date(row.review_at as string | number | Date).toISOString() : null,
    expiryAt: row.expiry_at ? new Date(row.expiry_at as string | number | Date).toISOString() : null,
    version: row.version == null ? undefined : Number(row.version),
    supersedes: typeof row.supersedes === "string" ? row.supersedes : null,
    validFrom: row.valid_from ? new Date(row.valid_from as string | number | Date).toISOString() : null,
    createdAt: new Date(row.created_at as string | number | Date).toISOString(),
    updatedAt: new Date(row.updated_at as string | number | Date).toISOString()
  });
}

export function listContextPacketMemoryFromStore(memories: MemoryRecord[], params: ContextPacketMemoryQuery): MemoryRecord[] {
  const limit = normalizeContextPacketLimit(params.limit);
  return memories
    .filter((memory) => memoryMatchesContextPacketQuery(memory, params))
    .map((memory) => MemoryRecordSchema.parse(clone(memory)))
    .sort((left, right) => {
      const updatedOrder = right.updatedAt.localeCompare(left.updatedAt);
      return updatedOrder !== 0 ? updatedOrder : right.createdAt.localeCompare(left.createdAt);
    })
    .slice(0, limit);
}

export async function listContextPacketMemoryWithPool(pool: Pool, params: ContextPacketMemoryQuery): Promise<MemoryRecord[]> {
  const limit = normalizeContextPacketLimit(params.limit);
  const values: unknown[] = [params.userId];
  const predicates = ["user_id = $1"];

  if (!params.includeExpired) {
    values.push(new Date(params.now ?? Date.now()).toISOString());
    predicates.push(`(expiry_at is null or expiry_at > $${values.length})`);
  }

  if (params.agent) {
    values.push(params.agent);
    predicates.push(`permissions @> jsonb_build_array($${values.length}::text)`);
  }

  if (params.agentId) {
    values.push(params.agentId);
    predicates.push(`(agent_id is null or agent_id = $${values.length})`);
  } else {
    predicates.push("agent_id is null");
  }

  if (params.allowedSensitivities) {
    values.push(params.allowedSensitivities.map(normalizeSensitivityForQuery));
    predicates.push(`lower(sensitivity) = any($${values.length}::text[])`);
  } else {
    predicates.push("lower(sensitivity) <> 'restricted'");
  }

  values.push(limit);
  const result = await pool.query(
    `
      select * from memory_records
      where ${predicates.join(" and ")}
      order by updated_at desc, created_at desc, id desc
      limit $${values.length}
    `,
    values
  );

  return result.rows.map((row) => mapMemoryRow(row));
}
