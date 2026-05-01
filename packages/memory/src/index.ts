import {
  ContextPacketSchema,
  ContextPacketTransformationSchema,
  MemoryRecordSchema,
  nowIso,
  type ActorContext,
  type AgentName,
  type ContextPacket,
  type ContextPacketTransformation,
  type MemoryRecord,
  type MemoryType
} from "@agentic/contracts";

export type MemoryFreshness = "fresh" | "review_due" | "expired" | "low_confidence";
export type WorkflowContextKind = "goal_planning" | "goal_refinement" | "briefing";

export type MemoryConflict = {
  category: string;
  subject: string;
  memoryIds: string[];
  primaryMemoryId: string;
  conflictingMemoryIds: string[];
  reason: string;
};

export type WorkflowContextPack = {
  kind: WorkflowContextKind;
  query: string;
  selectedMemories: MemoryRecord[];
  selectedMemoryIds: string[];
  staleMemoryIds: string[];
  conflictingMemoryIds: string[];
  reviewRequiredMemoryIds: string[];
  conflicts: MemoryConflict[];
  evidenceSummary: {
    selectedCount: number;
    confirmedCount: number;
    observedCount: number;
    inferredCount: number;
    freshCount: number;
    reviewDueCount: number;
    lowConfidenceCount: number;
    expiredCount: number;
    reviewRequiredCount: number;
    conflictCount: number;
  };
};

export type WorkflowContextPackSummary = Omit<WorkflowContextPack, "selectedMemories">;

export type ContextPacketQuery = {
  userId?: string;
  agent?: AgentName;
  includeExpired?: boolean;
  allowedSensitivities?: string[];
  now?: number;
  limit?: number;
};

const STOP_WORDS = new Set([
  "a",
  "an",
  "and",
  "are",
  "as",
  "at",
  "be",
  "for",
  "from",
  "has",
  "have",
  "in",
  "is",
  "it",
  "of",
  "on",
  "or",
  "the",
  "to",
  "user",
  "with"
]);

function tokenize(input: string): string[] {
  return input
    .toLowerCase()
    .split(/[^a-z0-9]+/g)
    .filter(Boolean);
}

function normalizeComparableText(input: string): string {
  return input.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

function parseOptionalDate(value: string | null): number | null {
  if (!value) {
    return null;
  }

  const parsed = Date.parse(value);

  return Number.isFinite(parsed) ? parsed : null;
}

function evidenceTypeWeight(memoryType: MemoryType): number {
  switch (memoryType) {
    case "confirmed":
      return 4;
    case "observed":
      return 3;
    case "inferred":
    default:
      return 1;
  }
}

function freshnessWeight(freshness: MemoryFreshness): number {
  switch (freshness) {
    case "fresh":
      return 3;
    case "review_due":
      return 2;
    case "low_confidence":
      return 1;
    case "expired":
    default:
      return 0;
  }
}

function compareEvidenceStrength(left: MemoryRecord, right: MemoryRecord, now: number): number {
  const leftFreshness = getMemoryFreshness(left, now);
  const rightFreshness = getMemoryFreshness(right, now);
  const leftScore =
    evidenceTypeWeight(left.memoryType) * 10 +
    freshnessWeight(leftFreshness) * 4 +
    left.confidence * 10 +
    (parseOptionalDate(left.updatedAt) ?? 0) / 1_000_000_000_000;
  const rightScore =
    evidenceTypeWeight(right.memoryType) * 10 +
    freshnessWeight(rightFreshness) * 4 +
    right.confidence * 10 +
    (parseOptionalDate(right.updatedAt) ?? 0) / 1_000_000_000_000;

  return rightScore - leftScore;
}

function meaningfulTokens(input: string): string[] {
  return tokenize(input).filter((token) => !STOP_WORDS.has(token));
}

function normalizeSubject(subject: string, category: string): string {
  const normalized = normalizeComparableText(subject);
  return normalized || normalizeComparableText(category);
}

function normalizeValue(value: string): string {
  return normalizeComparableText(value);
}

function extractStructuredClaim(record: MemoryRecord): { subject: string; value: string } | null {
  const firstSentence = record.content.split(/[.!?]\s/u, 1)[0]?.trim() ?? "";

  if (!firstSentence) {
    return null;
  }

  const normalizedSentence = firstSentence.replace(/\s+/g, " ").trim();
  const patterns = [
    /^(?<subject>[A-Za-z0-9 /_-]{2,80}?)\s+(?:is|are|was|were)\s+(?<value>.+)$/u,
    /^(?<subject>[A-Za-z0-9 /_-]{2,80}?)\s+(?:usually happens on|usually runs on|happens on|runs on|occurs on)\s+(?<value>.+)$/u,
    /^(?<subject>[A-Za-z0-9 /_-]{2,80}?)\s+(?:prefers|prefer|likes|like|needs|need|requires|require|keeps|keep)\s+(?<value>.+)$/u
  ];

  for (const pattern of patterns) {
    const match = pattern.exec(normalizedSentence);
    const subject = match?.groups?.subject?.trim();
    const value = match?.groups?.value?.trim();

    if (!subject || !value) {
      continue;
    }

    const normalizedSubject = normalizeSubject(subject, record.category);
    const normalizedValue = normalizeValue(value);

    if (!normalizedSubject || !normalizedValue || normalizedSubject === normalizedValue) {
      continue;
    }

    return {
      subject: normalizedSubject,
      value: normalizedValue
    };
  }

  return null;
}

export function createMemoryRecord(params: {
  id?: string;
  userId: string;
  category: string;
  memoryType: MemoryType;
  content: string;
  confidence: number;
  source: string;
  sensitivity?: string;
  permissions?: AgentName[];
  actorContext?: ActorContext | null;
  contextPacketConsent?: MemoryRecord["contextPacketConsent"];
  agentId?: string | null;
  agentScope?: "global" | "agent-only" | "agent-preferred";
  reviewAt?: string | null;
  expiryAt?: string | null;
  createdAt?: string;
  updatedAt?: string;
}): MemoryRecord {
  const createdAt = params.createdAt ?? nowIso();
  const updatedAt = params.updatedAt ?? createdAt;

  return MemoryRecordSchema.parse({
    id: params.id ?? crypto.randomUUID(),
    userId: params.userId,
    category: params.category,
    memoryType: params.memoryType,
    content: params.content,
    confidence: params.confidence,
    source: params.source,
    sensitivity: params.sensitivity ?? "internal",
    permissions: params.permissions ?? ["orchestrator", "workflow", "knowledge"],
    actorContext: params.actorContext ?? null,
    contextPacketConsent: params.contextPacketConsent ?? null,
    agentId: params.agentId ?? null,
    agentScope: params.agentScope ?? "global",
    reviewAt: params.reviewAt ?? null,
    expiryAt: params.expiryAt ?? null,
    createdAt,
    updatedAt
  });
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

function summarizeContextContent(content: string): string {
  return content.replace(/\s+/g, " ").trim().slice(0, 500);
}

function inferStaleAt(record: MemoryRecord): string | null {
  return record.expiryAt ?? record.reviewAt ?? null;
}

function defaultContextPacketConsent(record: MemoryRecord) {
  if (record.contextPacketConsent) {
    return record.contextPacketConsent;
  }

  if (record.actorContext?.initiator.kind === "human") {
    return {
      basis: "explicit" as const,
      grantedBy: record.actorContext.initiator.userId,
      grantedAt: record.createdAt
    };
  }

  if (record.source === "ui") {
    return {
      basis: "explicit" as const,
      grantedBy: record.userId,
      grantedAt: record.createdAt
    };
  }

  return {
    basis: "derived" as const,
    grantedBy: record.actorContext?.initiator.userId ?? null,
    grantedAt: record.createdAt
  };
}

export function buildContextPacketFromMemory(
  record: MemoryRecord,
  options?: {
    now?: number;
    transformations?: ContextPacketTransformation[];
    usage?: ContextPacket["usage"];
    consent?: ContextPacket["consent"];
  }
): ContextPacket {
  const freshness = getMemoryFreshness(record, options?.now ?? Date.now());
  const packetId = `ctx_${record.id}`;
  const derivedTransformation = ContextPacketTransformationSchema.parse({
    id: `memory:${record.id}:packet`,
    kind: "derived_from_memory",
    at: record.updatedAt,
    inputIds: [record.id],
    outputId: packetId,
    summary: "Context packet derived from memory record provenance."
  });
  const transformations = [derivedTransformation, ...(options?.transformations ?? [])];

  return ContextPacketSchema.parse({
    id: packetId,
    userId: record.userId,
    source: {
      kind: "memory",
      id: record.id,
      summary: `${record.memoryType} memory from ${record.source}`
    },
    category: record.category,
    contentSummary: summarizeContextContent(record.content),
    memoryType: record.memoryType,
    sensitivity: record.sensitivity,
    permissions: record.permissions,
    retention: {
      reviewAt: record.reviewAt,
      expiryAt: record.expiryAt
    },
    consent: options?.consent ?? defaultContextPacketConsent(record),
    freshness: {
      status: freshness,
      observedAt: record.updatedAt,
      staleAt: inferStaleAt(record)
    },
    lineage: {
      parentPacketIds: [],
      sourceMemoryIds: [record.id],
      transformationIds: transformations.map((transformation) => transformation.id)
    },
    transformations,
    usage: options?.usage ?? [],
    actorContext: record.actorContext,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt
  });
}

function normalizeSensitivity(value: string): string {
  return value.trim().toLowerCase();
}

function canExposeSensitivity(record: MemoryRecord, allowedSensitivities: Set<string> | null): boolean {
  if (!allowedSensitivities) {
    return normalizeSensitivity(record.sensitivity) !== "restricted";
  }

  return allowedSensitivities.has(normalizeSensitivity(record.sensitivity));
}

export function queryContextPackets(records: MemoryRecord[], query: ContextPacketQuery = {}): ContextPacket[] {
  const now = query.now ?? Date.now();
  const allowedSensitivities = query.allowedSensitivities
    ? new Set(query.allowedSensitivities.map((sensitivity) => normalizeSensitivity(sensitivity)))
    : null;
  const limit = Math.max(0, Math.min(Math.trunc(query.limit ?? 50), 200));

  return records
    .filter((record) => {
      if (query.userId && record.userId !== query.userId) {
        return false;
      }

      if (!query.includeExpired && isMemoryExpired(record, now)) {
        return false;
      }

      if (query.agent && !canAgentAccessMemory(record, query.agent)) {
        return false;
      }

      return canExposeSensitivity(record, allowedSensitivities);
    })
    .map((record) => buildContextPacketFromMemory(record, { now }))
    .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))
    .slice(0, limit);
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

export function detectMemoryConflicts(
  records: MemoryRecord[],
  options?: {
    agent?: AgentName;
    now?: number;
  }
): MemoryConflict[] {
  const resolvedNow = options?.now ?? Date.now();
  const accessibleRecords = records.filter((record) => {
    if (isMemoryExpired(record, resolvedNow)) {
      return false;
    }

    if (options?.agent && !canAgentAccessMemory(record, options.agent)) {
      return false;
    }

    return true;
  });
  const groupedClaims = new Map<
    string,
    {
      category: string;
      subject: string;
      records: MemoryRecord[];
      values: Set<string>;
    }
  >();

  for (const record of accessibleRecords) {
    const claim = extractStructuredClaim(record);

    if (!claim) {
      continue;
    }

    const subjectTokens = meaningfulTokens(claim.subject);
    const valueTokens = meaningfulTokens(claim.value);

    if (subjectTokens.length === 0 || valueTokens.length === 0) {
      continue;
    }

    const groupKey = `${normalizeComparableText(record.category)}::${claim.subject}`;
    const existing = groupedClaims.get(groupKey);

    if (existing) {
      existing.records.push(record);
      existing.values.add(claim.value);
    } else {
      groupedClaims.set(groupKey, {
        category: record.category,
        subject: claim.subject,
        records: [record],
        values: new Set([claim.value])
      });
    }
  }

  return [...groupedClaims.values()]
    .filter((group) => group.records.length > 1 && group.values.size > 1)
    .map((group) => {
      const sortedRecords = [...group.records].sort((left, right) => compareEvidenceStrength(left, right, resolvedNow));
      const primaryMemory = sortedRecords[0]!;
      const conflictingMemoryIds = sortedRecords.slice(1).map((record) => record.id);

      return {
        category: group.category,
        subject: group.subject,
        memoryIds: sortedRecords.map((record) => record.id),
        primaryMemoryId: primaryMemory.id,
        conflictingMemoryIds,
        reason: `Conflicting ${group.category} context for "${group.subject}" needs review.`
      };
    });
}

export function buildWorkflowContextPack(params: {
  kind: WorkflowContextKind;
  query: string;
  records: MemoryRecord[];
  agent?: AgentName;
  now?: number;
  primaryLimit?: number;
  candidateLimit?: number;
  maxSelected?: number;
}): WorkflowContextPack {
  const resolvedNow = params.now ?? Date.now();
  const primaryLimit = Math.max(1, Math.min(Math.trunc(params.primaryLimit ?? 5), 10));
  const candidateLimit = Math.max(primaryLimit, Math.min(Math.trunc(params.candidateLimit ?? 12), 24));
  const maxSelected = Math.max(primaryLimit, Math.min(Math.trunc(params.maxSelected ?? 8), 16));
  const candidates = rankRelevantMemories(params.query, params.records, candidateLimit, {
    agent: params.agent,
    now: resolvedNow
  });
  const conflicts = detectMemoryConflicts(candidates, {
    agent: params.agent,
    now: resolvedNow
  });
  const selectedIds = new Set(candidates.slice(0, primaryLimit).map((record) => record.id));

  for (const conflict of conflicts) {
    const isRelevantConflict = conflict.memoryIds.some((memoryId) => selectedIds.has(memoryId));

    if (!isRelevantConflict) {
      continue;
    }

    for (const memoryId of conflict.memoryIds) {
      if (selectedIds.size >= maxSelected) {
        break;
      }
      selectedIds.add(memoryId);
    }
  }

  const selectedMemories = candidates.filter((record) => selectedIds.has(record.id));
  const staleMemoryIds = selectedMemories
    .filter((record) => getMemoryFreshness(record, resolvedNow) !== "fresh")
    .map((record) => record.id);
  const conflictingMemoryIds = [...new Set(conflicts.flatMap((conflict) => conflict.memoryIds))];
  const reviewRequiredMemoryIds = [...new Set([...staleMemoryIds, ...conflictingMemoryIds])];
  const evidenceSummary = selectedMemories.reduce<WorkflowContextPack["evidenceSummary"]>(
    (summary, record) => {
      summary.selectedCount += 1;
      switch (record.memoryType) {
        case "confirmed":
          summary.confirmedCount += 1;
          break;
        case "observed":
          summary.observedCount += 1;
          break;
        case "inferred":
          summary.inferredCount += 1;
          break;
      }

      switch (getMemoryFreshness(record, resolvedNow)) {
        case "fresh":
          summary.freshCount += 1;
          break;
        case "review_due":
          summary.reviewDueCount += 1;
          break;
        case "low_confidence":
          summary.lowConfidenceCount += 1;
          break;
        case "expired":
          summary.expiredCount += 1;
          break;
      }

      return summary;
    },
    {
      selectedCount: 0,
      confirmedCount: 0,
      observedCount: 0,
      inferredCount: 0,
      freshCount: 0,
      reviewDueCount: 0,
      lowConfidenceCount: 0,
      expiredCount: 0,
      reviewRequiredCount: reviewRequiredMemoryIds.length,
      conflictCount: conflicts.length
    }
  );

  return {
    kind: params.kind,
    query: params.query,
    selectedMemories,
    selectedMemoryIds: selectedMemories.map((record) => record.id),
    staleMemoryIds,
    conflictingMemoryIds,
    reviewRequiredMemoryIds,
    conflicts,
    evidenceSummary
  };
}

export function summarizeWorkflowContextPack(pack: WorkflowContextPack): WorkflowContextPackSummary {
  return {
    kind: pack.kind,
    query: pack.query,
    selectedMemoryIds: pack.selectedMemoryIds,
    staleMemoryIds: pack.staleMemoryIds,
    conflictingMemoryIds: pack.conflictingMemoryIds,
    reviewRequiredMemoryIds: pack.reviewRequiredMemoryIds,
    conflicts: pack.conflicts,
    evidenceSummary: pack.evidenceSummary
  };
}
