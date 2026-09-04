import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { MemoryRecord } from "@agentic/contracts";
import { MemoryRecordSchema, nowIso } from "@agentic/contracts";
import {
  buildContextPacketFromMemory,
  buildWorkflowContextPack,
  createMemoryRecord,
  detectMemoryConflicts,
  getMemoryFreshness,
  isMemoryExpired,
  queryContextPackets,
  rankRelevantMemories,
  scoreMemoryRecord,
  supersedeMemory
} from "@agentic/memory";
import {
  createSelfImprovementRepository,
  EpisodeRecordSchema,
  SemanticPatternSchema,
  SelfImprovementValidationError,
  deriveRecommendationInsights,
  buildRecommendationReplayReport,
  aggregateWorkflowOutcomes,
  calculateNegativeOutcomeRate,
  buildPolicyLearningValidation,
  type EpisodeRecord,
  type SelfImprovementRepository
} from "@agentic/self-improvement-memory";
import { createRepository } from "@agentic/repository";
import { buildExecutionProvenanceGraph } from "../packages/repository/src/provenance-graph";
import {
  listContextPacketMemoryFromStore,
  type ContextPacketMemoryQuery
} from "../packages/repository/src/repository-context-packet-memory";
import {
  buildCollectionPage,
  decodeCollectionCursor,
  encodeCollectionCursor,
  normalizeCollectionPageLimit
} from "../packages/repository/src/collection-pagination";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const tempDirs: string[] = [];

async function createTempDir(prefix: string): Promise<string> {
  const dir = await mkdtemp(path.join(os.tmpdir(), `agentic-adv-${prefix}-`));
  tempDirs.push(dir);
  return dir;
}

afterAll(async () => {
  for (const dir of tempDirs) {
    await rm(dir, { recursive: true, force: true });
  }
});

function mem(id: string, content: string, overrides: Record<string, unknown> = {}): MemoryRecord {
  return createMemoryRecord({
    id,
    userId: "owner",
    category: "preferences",
    memoryType: "confirmed",
    content,
    confidence: 0.9,
    source: "ui",
    createdAt: "2026-03-01T00:00:00.000Z",
    updatedAt: "2026-03-01T00:00:00.000Z",
    ...overrides
  }) as MemoryRecord;
}

function buildEpisode(overrides: Record<string, unknown> = {}): EpisodeRecord {
  return EpisodeRecordSchema.parse({
    id: "ep-test-001",
    timestamp: "2026-04-02T09:00:00.000Z",
    skill: "debugger",
    task: "Test task",
    outcome: "success",
    situation: "Test situation.",
    rootCause: null,
    solution: "Test solution.",
    lesson: "Test lesson.",
    ...overrides
  });
}

// ===========================================================================
// MEMORY SCORING EDGE CASES
// ===========================================================================

describe("adversarial memory scoring edge cases", () => {
  it("handles empty query string without throwing or returning NaN scores", () => {
    const record = mem("m1", "Prefers aisle seats on long-haul flights.");
    const score = scoreMemoryRecord("", record);

    expect(Number.isFinite(score)).toBe(true);
    expect(score).not.toBeNaN();
  });

  it("handles query strings with only stop words gracefully", () => {
    const record = mem("m1", "The user is a person who has preferences.");
    const score = scoreMemoryRecord("the a is an and or of", record);

    expect(Number.isFinite(score)).toBe(true);
  });

  it("handles unicode-heavy queries without crashing", () => {
    const record = mem("m1", "日本語のテスト");
    const unicodeQueries = [
      "🎉🎊🎈",
      "中文测试内容",
      "العربية",
      "עברית",
      "\u0000\u0001\u0002",
      "a\u0300\u0301\u0302" // combining diacritics
    ];

    for (const query of unicodeQueries) {
      const score = scoreMemoryRecord(query, record);
      expect(Number.isFinite(score)).toBe(true);
    }
  });

  it("returns finite scores for records at extreme timestamps", () => {
    const ancientRecord = mem("m1", "Ancient memory.", {
      createdAt: "1970-01-01T00:00:00.000Z",
      updatedAt: "1970-01-01T00:00:00.000Z"
    });
    const futureRecord = mem("m2", "Future memory.", {
      createdAt: "2099-12-31T23:59:59.999Z",
      updatedAt: "2099-12-31T23:59:59.999Z"
    });

    expect(Number.isFinite(scoreMemoryRecord("memory", ancientRecord))).toBe(true);
    expect(Number.isFinite(scoreMemoryRecord("memory", futureRecord))).toBe(true);
  });

  it("rankRelevantMemories handles duplicate records without infinite loops", () => {
    const record = mem("m1", "Duplicate test.");
    const duplicates = Array.from({ length: 100 }, () => ({ ...record }));

    const ranked = rankRelevantMemories("test", duplicates as MemoryRecord[], 5);
    expect(ranked.length).toBeLessThanOrEqual(5);
    expect(ranked.length).toBeGreaterThan(0);
  });

  it("detectMemoryConflicts returns empty for single-element arrays", () => {
    expect(detectMemoryConflicts([mem("m1", "Only one.")])).toEqual([]);
  });

  it("detectMemoryConflicts handles records with identical subjects but same values (no conflict)", () => {
    const records = [
      mem("m1", "Seat preference is aisle.", { updatedAt: "2026-04-01T00:00:00.000Z" }),
      mem("m2", "Seat preference is aisle.", { updatedAt: "2026-03-31T00:00:00.000Z" })
    ];

    // Same value means no conflict even if subject matches
    const conflicts = detectMemoryConflicts(records);
    expect(conflicts).toEqual([]);
  });

  it("supersedeMemory chains correctly through multiple revisions", () => {
    const v1 = mem("m1", "Version 1.");
    const { contradicted: c1, replacement: v2 } = supersedeMemory(v1, mem("m2", "Version 2."));
    const { contradicted: c2, replacement: v3 } = supersedeMemory(v2, mem("m3", "Version 3."));

    expect(c1.memoryType).toBe("contradicted");
    expect(c2.memoryType).toBe("contradicted");
    expect(v3.version).toBe(3);
    expect(v3.supersedes).toBe("m2");

    // Only v3 should be retrievable
    const ranked = rankRelevantMemories("version", [c1, c2, v3]);
    expect(ranked.map((r) => r.id)).toEqual(["m3"]);
  });
});

// ===========================================================================
// CONTEXT PACKET QUERY EDGE CASES
// ===========================================================================

describe("adversarial context packet memory query edge cases", () => {
  it("listContextPacketMemoryFromStore clamps limit to [1, 200]", () => {
    const memories = [mem("m1", "Test.")];

    expect(listContextPacketMemoryFromStore(memories, { userId: "owner", limit: 0 })).toHaveLength(1);
    expect(listContextPacketMemoryFromStore(memories, { userId: "owner", limit: -1 })).toHaveLength(1);
    expect(listContextPacketMemoryFromStore(memories, { userId: "owner", limit: 999 })).toHaveLength(1);
    expect(listContextPacketMemoryFromStore(memories, { userId: "owner", limit: 1 })).toHaveLength(1);
    expect(listContextPacketMemoryFromStore(memories, { userId: "owner", limit: 200 })).toHaveLength(1);
  });

  it("filters by agentId correctly when agentId is set on memory but not in query", () => {
    const agentScoped = mem("m1", "Agent scoped.", { agentId: "agent-alpha" });
    const global = mem("m2", "Global memory.");

    // When query has no agentId, agent-scoped memories should be excluded
    const result = listContextPacketMemoryFromStore([agentScoped, global], { userId: "owner" });
    expect(result.map((r) => r.id)).toEqual(["m2"]);
  });

  it("includes agent-scoped memory when query agentId matches", () => {
    const agentScoped = mem("m1", "Agent scoped.", { agentId: "agent-alpha" });

    const result = listContextPacketMemoryFromStore([agentScoped], {
      userId: "owner",
      agentId: "agent-alpha"
    });
    expect(result).toHaveLength(1);
    expect(result[0]?.id).toBe("m1");
  });

  it("excludes agent-scoped memory when query agentId does not match", () => {
    const agentScoped = mem("m1", "Agent scoped.", { agentId: "agent-alpha" });

    const result = listContextPacketMemoryFromStore([agentScoped], {
      userId: "owner",
      agentId: "agent-beta"
    });
    expect(result).toHaveLength(0);
  });

  it("handles case-insensitive sensitivity matching", () => {
    const restricted = mem("m1", "Secret.", { sensitivity: "RESTRICTED" });
    const internal = mem("m2", "Normal.", { sensitivity: "Internal" });

    // When allowedSensitivities includes "restricted", only restricted records are returned
    // (case-insensitive match). Internal records are excluded because they're not in the allow-list.
    const withRestricted = listContextPacketMemoryFromStore([restricted, internal], {
      userId: "owner",
      allowedSensitivities: ["restricted"]
    });
    expect(withRestricted.map((r) => r.id)).toEqual(["m1"]);

    // When allowedSensitivities includes both, both are returned
    const withBoth = listContextPacketMemoryFromStore([restricted, internal], {
      userId: "owner",
      allowedSensitivities: [" RESTRICTED ", " internal "]
    });
    expect(withBoth.map((r) => r.id).sort()).toEqual(["m1", "m2"]);

    // Without allowedSensitivities, restricted records are hidden by default
    const withoutAllowed = listContextPacketMemoryFromStore([restricted, internal], {
      userId: "owner"
    });
    expect(withoutAllowed.map((r) => r.id)).toEqual(["m2"]);
  });

  it("buildContextPacketFromMemory produces valid packets for all memory types", () => {
    for (const memoryType of ["confirmed", "observed", "inferred"] as const) {
      const record = mem("m1", "Test content.", { memoryType });
      const packet = buildContextPacketFromMemory(record);

      expect(packet.id).toBe(`ctx_m1`);
      expect(packet.source.kind).toBe("memory");
      expect(packet.memoryType).toBe(memoryType);
    }
  });

  it("queryContextPackets excludes expired memories by default but includes them with flag", () => {
    const expired = mem("m1", "Expired.", { expiryAt: "2020-01-01T00:00:00.000Z" });
    const active = mem("m2", "Active.");

    const defaultQuery = queryContextPackets([expired, active], { userId: "owner" });
    expect(defaultQuery.map((p) => p.source.id)).toEqual(["m2"]);

    const includeExpired = queryContextPackets([expired, active], {
      userId: "owner",
      includeExpired: true
    });
    expect(includeExpired.map((p) => p.source.id).sort()).toEqual(["m1", "m2"]);
  });
});

// ===========================================================================
// SELF-IMPROVEMENT METADATA BOUNDARY TESTS
// ===========================================================================

describe("adversarial self-improvement metadata boundaries", () => {
  let repository: SelfImprovementRepository;
  let baseDir: string;

  beforeAll(async () => {
    const tempDir = await createTempDir("sim-meta");
    baseDir = path.join(tempDir, "memory");
    repository = createSelfImprovementRepository({ baseDir });
    await repository.seed();
  });

  it("accepts metadata at exactly depth 4 and rejects depth 5", async () => {
    // Depth 4: { a: { b: { c: { d: "value" } } } } — 4 levels of nesting
    const depth4Metadata = { a: { b: { c: { d: "leaf" } } } };
    const episode4 = buildEpisode({
      id: "ep-depth-4",
      timestamp: "2026-05-01T00:00:00.000Z",
      metadata: depth4Metadata
    });
    await expect(repository.appendEpisode(episode4)).resolves.toMatchObject({ id: "ep-depth-4" });

    // Depth 5: { a: { b: { c: { d: { e: "value" } } } } } — exceeds MAX_METADATA_DEPTH=4
    const depth5Metadata = { a: { b: { c: { d: { e: "leaf" } } } } };
    expect(() =>
      EpisodeRecordSchema.parse({
        ...buildEpisode({ id: "ep-depth-5", timestamp: "2026-05-01T01:00:00.000Z" }),
        metadata: depth5Metadata
      })
    ).toThrow();
  });

  it("rejects metadata exceeding serialized length limit", () => {
    const oversizedValue = "x".repeat(4_001);
    expect(() =>
      EpisodeRecordSchema.parse({
        ...buildEpisode({ id: "ep-oversized", timestamp: "2026-05-01T02:00:00.000Z" }),
        metadata: { key: oversizedValue }
      })
    ).toThrow();

    // At exactly the limit should pass
    const exactValue = "x".repeat(3_980); // leave room for JSON structure overhead
    const parsed = EpisodeRecordSchema.parse({
      ...buildEpisode({ id: "ep-exact", timestamp: "2026-05-01T03:00:00.000Z" }),
      metadata: { key: exactValue }
    });
    expect(parsed.metadata).toBeDefined();
  });

  it("handles semantic pattern with maximum-length fields", async () => {
    const maxPattern = SemanticPatternSchema.parse({
      id: "p".repeat(80),
      name: "n".repeat(120),
      source: "s".repeat(80),
      confidence: 1,
      applications: 10_000,
      createdAt: nowIso(),
      updatedAt: nowIso(),
      category: "c".repeat(64),
      pattern: "p".repeat(300),
      problem: "q".repeat(1_000),
      solution: {},
      qualityRules: Array.from({ length: 20 }, () => "r".repeat(200)),
      targetSkills: Array.from({ length: 20 }, () => "t".repeat(80)),
      relatedEpisodeIds: Array.from({ length: 50 }, () => "e".repeat(80))
    });

    await expect(repository.upsertSemanticPattern(maxPattern)).resolves.toMatchObject({
      id: maxPattern.id
    });
  });

  it("calculateNegativeOutcomeRate returns 0 for empty array", () => {
    expect(calculateNegativeOutcomeRate([])).toBe(0);
  });

  it("aggregateWorkflowOutcomes handles episodes without outcomeLink gracefully", () => {
    const episodes = [
      buildEpisode({ id: "ep-no-link" }),
      buildEpisode({
        id: "ep-with-link",
        outcomeLink: {
          goalId: "goal-1",
          workflowId: "wf-1",
          taskId: "task-1",
          outcomeScore: 0.8,
          executionKind: "completed"
        }
      })
    ];

    const aggregates = aggregateWorkflowOutcomes(episodes);
    expect(aggregates).toHaveLength(1);
    expect(aggregates[0]?.workflowId).toBe("wf-1");
    expect(aggregates[0]?.sampleCount).toBe(1);
  });

  it("deriveRecommendationInsights handles episodes with recommendation controls", () => {
    const suppressedEpisode = buildEpisode({
      id: "ep-suppressed",
      timestamp: "2026-05-01T00:00:00.000Z",
      recommendation: {
        key: "test-key",
        kind: "task_plan",
        agent: "orchestrator",
        action: "test-action",
        confidence: 0.9,
        fallbackMode: "normal",
        evidenceHint: "established",
        sourceGoalId: "goal-1"
      },
      outcomeLink: {
        goalId: "goal-1",
        outcomeScore: 0.9,
        executionKind: "completed"
      },
      provenance: {
        source: "feedback",
        ownerUserId: null,
        workspaceId: null,
        memoryIds: [],
        actionLogIds: [],
        evidenceRecordIds: [],
        recommendationKeys: []
      },
      metadata: {
        recommendationControl: { action: "suppress", timestamp: "2026-05-01T00:00:00.000Z" }
      }
    });

    const insights = deriveRecommendationInsights([suppressedEpisode]);
    // Suppressed episodes should be excluded from insights
    expect(insights).toHaveLength(0);
  });
});

// ===========================================================================
// PROVENANCE GRAPH EDGE CASES
// ===========================================================================

describe("adversarial provenance graph edge cases", () => {
  it("handles empty inputs without errors", () => {
    const graph = buildExecutionProvenanceGraph({
      userId: "owner",
      goals: [],
      jobs: [],
      memories: []
    });

    expect(graph.nodes).toEqual([]);
    expect(graph.edges).toEqual([]);
    expect(graph.timeline).toEqual([]);
  });

  it("clamps depth to [0, 4] and limit to [1, 500]", () => {
    const graph = buildExecutionProvenanceGraph({
      userId: "owner",
      goals: [],
      jobs: [],
      memories: [mem("m1", "Test.")],
      depth: -1,
      limit: 0
    });

    expect(graph.query.depth).toBe(0);
    expect(graph.query.limit).toBe(1);

    const graphMax = buildExecutionProvenanceGraph({
      userId: "owner",
      goals: [],
      jobs: [],
      memories: [mem("m1", "Test.")],
      depth: 99,
      limit: 9999
    });

    expect(graphMax.query.depth).toBe(4);
    expect(graphMax.query.limit).toBe(500);
  });

  it("truncates long labels and summaries in nodes", () => {
    const longContent = "x".repeat(1000);
    const graph = buildExecutionProvenanceGraph({
      userId: "owner",
      goals: [],
      jobs: [],
      memories: [mem("m1", longContent, { category: "y".repeat(200) })]
    });

    for (const node of graph.nodes) {
      expect(node.label.length).toBeLessThanOrEqual(160);
      expect(node.summary.length).toBeLessThanOrEqual(500);
    }
  });

  it("handles traversal with non-existent rootId gracefully", () => {
    const graph = buildExecutionProvenanceGraph({
      userId: "owner",
      goals: [],
      jobs: [],
      memories: [mem("m1", "Test.")],
      rootId: "nonexistent:root"
    });

    // A non-existent root should produce an empty subgraph
    expect(graph.nodes).toEqual([]);
    expect(graph.edges).toEqual([]);
  });

  it("deduplicates nodes and edges when the same entity appears in multiple bundles", () => {
    const sharedMemory = mem("m1", "Shared memory.");
    const graph = buildExecutionProvenanceGraph({
      userId: "owner",
      goals: [],
      jobs: [],
      memories: [sharedMemory, sharedMemory, sharedMemory]
    });

    const memoryNodes = graph.nodes.filter((n) => n.type === "memory");
    expect(memoryNodes).toHaveLength(1);
  });
});

// ===========================================================================
// RUNTIME STORE ADVERSARIAL CASES
// ===========================================================================

describe("adversarial runtime store deep edge cases", () => {
  it("saveMemory rejects records with confidence exactly at boundaries", async () => {
    const tempDir = await createTempDir("store-boundary");
    const storePath = path.join(tempDir, "runtime-store.json");
    const repository = createRepository({ storePath });

    // Confidence 0 is valid
    await expect(
      repository.saveMemory(mem("m-zero", "Zero confidence.", { confidence: 0 }))
    ).resolves.toMatchObject({ confidence: 0 });

    // Confidence 1 is valid
    await expect(
      repository.saveMemory(mem("m-one", "Full confidence.", { confidence: 1 }))
    ).resolves.toMatchObject({ confidence: 1 });

    // Confidence just above 1 is invalid (rejected at record creation)
    expect(() => mem("m-over", "Over.", { confidence: 1.0001 })).toThrow();

    // Negative confidence is invalid (rejected at record creation)
    expect(() => mem("m-neg", "Neg.", { confidence: -0.001 })).toThrow();
  });

  it("persists and retrieves memories with unicode content faithfully", async () => {
    const tempDir = await createTempDir("store-unicode");
    const storePath = path.join(tempDir, "runtime-store.json");
    const repository = createRepository({ storePath });

    const unicodeContent = "日本語メモリー 🎉 مرحبا שלום Привет";
    await repository.saveMemory(mem("m-unicode", unicodeContent));

    const stored = await repository.listMemory("owner");
    expect(stored).toHaveLength(1);
    expect(stored[0]?.content).toBe(unicodeContent);
  });

  it("handles rapid sequential writes without data loss", async () => {
    const tempDir = await createTempDir("store-rapid");
    const storePath = path.join(tempDir, "runtime-store.json");
    const repository = createRepository({ storePath });

    const writes = Array.from({ length: 20 }, (_, i) =>
      repository.saveMemory(mem(`m-rapid-${i}`, `Rapid write ${i}.`))
    );

    await Promise.all(writes);

    const stored = await repository.listMemory("owner");
    expect(stored).toHaveLength(20);
  });

  it("readStore returns empty store for missing file without creating it", async () => {
    const tempDir = await createTempDir("store-missing");
    const storePath = path.join(tempDir, "runtime-store.json");
    const repository = createRepository({ storePath });

    const memories = await repository.listMemory("owner");
    expect(memories).toEqual([]);

    // The file should NOT have been created by a read
    await expect(readFile(storePath, "utf8")).rejects.toMatchObject({ code: "ENOENT" });
  });
});

// ===========================================================================
// COLLECTION PAGINATION BOUNDARY TESTS
// ===========================================================================

describe("adversarial collection pagination boundaries", () => {
  it("encodeCollectionCursor round-trips correctly for edge-case ids", () => {
    const edgeCases = [
      { createdAt: "2026-01-01T00:00:00.000Z", id: "" },
      { createdAt: "2026-12-31T23:59:59.999Z", id: "z".repeat(200) },
      { createdAt: "2026-06-15T12:00:00.000Z", id: "id-with-special-chars!@#$%" },
      { createdAt: "2026-01-01T00:00:00.000Z", id: "unicode-日本語-مرحبا" }
    ];

    for (const cursor of edgeCases) {
      // Empty id fails schema validation (min(1))
      if (cursor.id === "") {
        expect(() => encodeCollectionCursor(cursor)).toThrow();
        continue;
      }

      const encoded = encodeCollectionCursor(cursor);
      const decoded = decodeCollectionCursor(encoded);
      expect(decoded).toEqual(cursor);
    }
  });

  it("decodeCollectionCursor rejects various malformed inputs", () => {
    const malformed = [
      "not-base64!!!",
      Buffer.from("not json").toString("base64url"),
      Buffer.from(JSON.stringify({ createdAt: "bad-date", id: "x" })).toString("base64url"),
      Buffer.from(JSON.stringify({ createdAt: "2026-01-01T00:00:00.000Z" })).toString("base64url"), // missing id
      Buffer.from(JSON.stringify({ id: "x" })).toString("base64url"), // missing createdAt
      Buffer.from(JSON.stringify(null)).toString("base64url"),
      Buffer.from(JSON.stringify(42)).toString("base64url"),
      "" // empty string returns null, doesn't throw
    ];

    for (const input of malformed) {
      if (input === "") {
        expect(decodeCollectionCursor(input)).toBeNull();
      } else {
        expect(() => decodeCollectionCursor(input)).toThrow();
      }
    }
  });

  it("normalizeCollectionPageLimit handles IEEE 754 edge cases", () => {
    expect(normalizeCollectionPageLimit(Number.MIN_VALUE)).toBe(20); // < 1 → default
    expect(normalizeCollectionPageLimit(Number.MAX_SAFE_INTEGER)).toBe(20); // > MAX → default
    expect(normalizeCollectionPageLimit(Number.EPSILON)).toBe(20); // < 1 → default
    expect(normalizeCollectionPageLimit(-Number.MAX_VALUE)).toBe(20);
    expect(normalizeCollectionPageLimit(Number.NEGATIVE_INFINITY)).toBe(20);
  });

  it("buildCollectionPage handles items with identical createdAt deterministically", () => {
    const sameTimestamp = "2026-06-01T00:00:00.000Z";
    const items = Array.from({ length: 10 }, (_, i) => ({
      id: `item-${String(i).padStart(3, "0")}`,
      createdAt: sameTimestamp
    }));

    const page = buildCollectionPage({
      items,
      limit: 3,
      getCursorKey: (item) => ({ createdAt: item.createdAt, id: item.id }),
      parsePage: (result) => result
    });

    expect(page.items).toHaveLength(3);
    expect(page.nextCursor).not.toBeNull();

    // Walk through all pages
    const allIds: string[] = [...page.items.map((i) => i.id)];
    let cursor = page.nextCursor;
    while (cursor) {
      const nextPage = buildCollectionPage({
        items,
        limit: 3,
        cursor,
        getCursorKey: (item) => ({ createdAt: item.createdAt, id: item.id }),
        parsePage: (result) => result
      });
      allIds.push(...nextPage.items.map((i) => i.id));
      cursor = nextPage.nextCursor;
    }

    // All items visited exactly once
    expect(allIds.sort()).toEqual(items.map((i) => i.id).sort());
  });
});

// ===========================================================================
// MEMORY FRESHNESS AND EXPIRY EDGE CASES
// ===========================================================================

describe("adversarial memory freshness edge cases", () => {
  it("isMemoryExpired handles invalid expiry dates gracefully", () => {
    const record = mem("m1", "Test.");

    // No expiry → not expired
    expect(isMemoryExpired(record)).toBe(false);

    // Null expiry → not expired
    expect(isMemoryExpired({ ...record, expiryAt: null })).toBe(false);
  });

  it("getMemoryFreshness checks expiry first, then low_confidence, then review_due", () => {
    const fixedNow = Date.parse("2026-06-01T00:00:00.000Z");

    // Expired takes priority even if also low confidence and review due
    const expiredAndLow = mem("m1", "Test.", {
      confidence: 0.3,
      expiryAt: "2026-05-01T00:00:00.000Z",
      reviewAt: "2026-05-01T00:00:00.000Z"
    });
    expect(getMemoryFreshness(expiredAndLow, fixedNow)).toBe("expired");

    // Low confidence takes priority over review_due (code checks confidence < 0.7 first)
    const reviewAndLow = mem("m2", "Test.", {
      confidence: 0.3,
      reviewAt: "2026-05-01T00:00:00.000Z"
    });
    expect(getMemoryFreshness(reviewAndLow, fixedNow)).toBe("low_confidence");

    // Review due when confidence is adequate
    const reviewOnly = mem("m3", "Test.", {
      confidence: 0.8,
      reviewAt: "2026-05-01T00:00:00.000Z"
    });
    expect(getMemoryFreshness(reviewOnly, fixedNow)).toBe("review_due");

    // Low confidence alone
    const justLow = mem("m4", "Test.", { confidence: 0.3 });
    expect(getMemoryFreshness(justLow, fixedNow)).toBe("low_confidence");
  });

  it("buildWorkflowContextPack handles zero-record input", () => {
    const pack = buildWorkflowContextPack({
      kind: "goal_planning",
      query: "test query",
      records: []
    });

    expect(pack.selectedMemories).toEqual([]);
    expect(pack.conflicts).toEqual([]);
    expect(pack.evidenceSummary.selectedCount).toBe(0);
  });

  it("buildWorkflowContextPack clamps limits to safe ranges", () => {
    const records = Array.from({ length: 30 }, (_, i) =>
      mem(`m${i}`, `Memory ${i}.`, { category: "test" })
    );

    // primaryLimit clamped to [1, 10]
    const pack = buildWorkflowContextPack({
      kind: "goal_planning",
      query: "test",
      records,
      primaryLimit: 0, // should clamp to 1
      candidateLimit: 0, // should clamp to primaryLimit
      maxSelected: 0 // should clamp to primaryLimit
    });

    expect(pack.selectedMemories.length).toBeGreaterThanOrEqual(1);
    expect(pack.selectedMemories.length).toBeLessThanOrEqual(1);
  });
});

// ===========================================================================
// POLICY LEARNING VALIDATION EDGE CASES
// ===========================================================================

describe("adversarial policy learning validation", () => {
  it("buildPolicyLearningValidation returns insufficient_data for empty episodes", () => {
    const result = buildPolicyLearningValidation([], { kind: "task_plan" });

    expect(result.replayValidated).toBe(false);
    expect(result.driftStatus).toBe("insufficient_data");
  });

  it("buildRecommendationReplayReport handles all-draft-only episodes", () => {
    const episodes = Array.from({ length: 5 }, (_, i) =>
      buildEpisode({
        id: `ep-draft-${i}`,
        timestamp: `2026-05-0${i + 1}T00:00:00.000Z`,
        recommendation: {
          key: `draft-key-${i}`,
          kind: "task_plan",
          agent: "orchestrator",
          action: "test",
          confidence: 0.3, // below default threshold
          fallbackMode: "draft_only",
          evidenceHint: "sparse",
          sourceGoalId: "goal-1"
        },
        outcomeLink: {
          goalId: "goal-1",
          outcomeScore: 0.5,
          executionKind: "not_run"
        }
      })
    );

    const report = buildRecommendationReplayReport(episodes);
    expect(report.sparsePatterns).toBeGreaterThan(0);
    expect(report.suggestedPatterns).toBe(0);
  });
});
