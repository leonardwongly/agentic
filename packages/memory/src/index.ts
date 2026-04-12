import { MemoryRecordSchema, nowIso, type AgentName, type MemoryRecord, type MemoryType } from "@agentic/contracts";

export type MemoryFreshness = "fresh" | "review_due" | "expired" | "low_confidence";

function tokenize(input: string): string[] {
  return input
    .toLowerCase()
    .split(/[^a-z0-9]+/g)
    .filter(Boolean);
}

export function createMemoryRecord(params: {
  userId: string;
  category: string;
  memoryType: MemoryType;
  content: string;
  confidence: number;
  source: string;
  sensitivity?: string;
  permissions?: AgentName[];
  reviewAt?: string | null;
  expiryAt?: string | null;
}): MemoryRecord {
  const timestamp = nowIso();

  return MemoryRecordSchema.parse({
    id: crypto.randomUUID(),
    userId: params.userId,
    category: params.category,
    memoryType: params.memoryType,
    content: params.content,
    confidence: params.confidence,
    source: params.source,
    sensitivity: params.sensitivity ?? "internal",
    permissions: params.permissions ?? ["orchestrator", "workflow", "knowledge"],
    reviewAt: params.reviewAt ?? null,
    expiryAt: params.expiryAt ?? null,
    createdAt: timestamp,
    updatedAt: timestamp
  });
}

function parseOptionalDate(value: string | null): number | null {
  if (!value) {
    return null;
  }

  const parsed = Date.parse(value);

  return Number.isFinite(parsed) ? parsed : null;
}

export function isMemoryExpired(record: MemoryRecord, now = Date.now()): boolean {
  const expiryAt = parseOptionalDate(record.expiryAt);

  return expiryAt !== null && expiryAt <= now;
}

export function getMemoryFreshness(record: MemoryRecord, now = Date.now()): MemoryFreshness {
  if (isMemoryExpired(record, now)) {
    return "expired";
  }

  if (record.confidence < 0.7) {
    return "low_confidence";
  }

  const reviewAt = parseOptionalDate(record.reviewAt);

  if (reviewAt !== null && reviewAt <= now) {
    return "review_due";
  }

  return "fresh";
}

export function canAgentAccessMemory(record: MemoryRecord, agent: AgentName): boolean {
  return record.permissions.includes(agent);
}

export function scoreMemoryRecord(query: string, record: MemoryRecord, now = Date.now()): number {
  const queryTokens = tokenize(query);
  const contentTokens = new Set(tokenize(record.content));
  const categoryTokens = new Set(tokenize(record.category));
  const overlap = queryTokens.filter((token) => contentTokens.has(token)).length;
  const categoryOverlap = queryTokens.filter((token) => categoryTokens.has(token)).length;
  const typeBonus = record.memoryType === "confirmed" ? 0.35 : record.memoryType === "observed" ? 0.2 : 0.1;
  const freshnessPenalty = (() => {
    switch (getMemoryFreshness(record, now)) {
      case "review_due":
        return -0.2;
      case "low_confidence":
        return -0.25;
      case "expired":
        return -1;
      case "fresh":
      default:
        return 0;
    }
  })();

  return overlap + categoryOverlap * 0.5 + typeBonus + record.confidence + freshnessPenalty;
}

export function rankRelevantMemories(
  query: string,
  records: MemoryRecord[],
  limit = 5,
  options?: {
    agent?: AgentName;
    now?: number;
  }
): MemoryRecord[] {
  const resolvedNow = options?.now ?? Date.now();
  const resolvedLimit = Math.max(0, Math.min(Math.trunc(limit), 50));
  const accessibleRecords = records.filter((record) => {
    if (isMemoryExpired(record, resolvedNow)) {
      return false;
    }

    if (options?.agent && !canAgentAccessMemory(record, options.agent)) {
      return false;
    }

    return true;
  });

  return accessibleRecords
    .map((record) => ({
      record,
      score: scoreMemoryRecord(query, record, resolvedNow)
    }))
    .sort((left, right) => right.score - left.score)
    .map(({ record }) => record)
    .slice(0, resolvedLimit);
}
