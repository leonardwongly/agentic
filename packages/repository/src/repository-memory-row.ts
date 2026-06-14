import { ActorContextSchema, MemoryRecordSchema, type MemoryRecord } from "@agentic/contracts";

type MemoryRow = Record<string, unknown>;

function isoFromDbTimestamp(value: unknown): string {
  return new Date(value as string | number | Date).toISOString();
}

function nullableIsoFromDbTimestamp(value: unknown): string | null {
  return value ? isoFromDbTimestamp(value) : null;
}

export function mapMemoryRow(row: MemoryRow): MemoryRecord {
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
    reviewAt: nullableIsoFromDbTimestamp(row.review_at),
    expiryAt: nullableIsoFromDbTimestamp(row.expiry_at),
    version: row.version == null ? undefined : Number(row.version),
    supersedes: typeof row.supersedes === "string" ? row.supersedes : null,
    validFrom: nullableIsoFromDbTimestamp(row.valid_from),
    createdAt: isoFromDbTimestamp(row.created_at),
    updatedAt: isoFromDbTimestamp(row.updated_at)
  });
}
