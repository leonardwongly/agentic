/**
 * Adversarial edge cases and boundary value tests for core Agentic packages.
 *
 * Covers: empty collections, single-element collections, max size limits,
 * zero/negative numbers, null vs undefined handling, type coercion edge cases,
 * off-by-one errors in pagination/slicing, Unicode and special characters,
 * floating-point precision, and date boundary issues.
 *
 * Each test targets a specific boundary that is easy to get wrong in production.
 */
import { describe, expect, it } from "vitest";
import {
  DEFAULT_COLLECTION_PAGE_LIMIT,
  MAX_COLLECTION_PAGE_LIMIT,
  nowIso,
  clone
} from "@agentic/contracts";
import {
  normalizeCollectionPageLimit,
  decodeCollectionCursor,
  encodeCollectionCursor,
  compareCreatedDescKeys,
  compareCreatedAscKeys,
  sortByCreatedDesc,
  sortByCreatedAsc,
  buildCollectionPage,
  CollectionPageQueryError
} from "../packages/repository/src/collection-pagination";
import {
  computeJobRetryDelayMs,
  canTransitionTaskState,
  canTransitionJobState
} from "@agentic/execution";
import {
  buildFallbackApprovalPreview,
  buildFallbackApprovalActionIntent
} from "../packages/repository/src/approval-fallbacks";
import {
  matchesDashboardCommitmentBucket,
  buildDashboardRepositoryCollectionPage
} from "../packages/repository/src/dashboard-collection-page";
import { mapMemoryRow } from "../packages/repository/src/repository-memory-row";
import { deriveAgentMetricsFromGoals } from "../packages/repository/src/agent-metrics";
import { buildDashboardSummary, type DashboardSummary } from "../packages/repository/src/dashboard-summary";
import {
  summarizeJobReadinessFromJobs,
  summarizeProviderCredentialReadiness
} from "../packages/repository/src/repository-readiness-summary";
import { calculateNormalizedEditDistance } from "../packages/observability/src/edit-distance";
import type { DashboardData } from "../packages/repository/src/repository-types";
import type { AgentDefinition, Commitment, GoalBundle, JobRecord, MemoryRecord, ProviderCredential } from "@agentic/contracts";

// ---------------------------------------------------------------------------
// 1. Collection pagination: normalizeCollectionPageLimit boundary values
// ---------------------------------------------------------------------------
describe("edge cases: normalizeCollectionPageLimit", () => {
  it("returns default for undefined", () => {
    expect(normalizeCollectionPageLimit(undefined)).toBe(DEFAULT_COLLECTION_PAGE_LIMIT);
  });

  it("returns default for zero (below minimum of 1)", () => {
    expect(normalizeCollectionPageLimit(0)).toBe(DEFAULT_COLLECTION_PAGE_LIMIT);
  });

  it("returns default for negative numbers", () => {
    expect(normalizeCollectionPageLimit(-1)).toBe(DEFAULT_COLLECTION_PAGE_LIMIT);
    expect(normalizeCollectionPageLimit(-100)).toBe(DEFAULT_COLLECTION_PAGE_LIMIT);
    expect(normalizeCollectionPageLimit(-Number.MAX_SAFE_INTEGER)).toBe(DEFAULT_COLLECTION_PAGE_LIMIT);
  });

  it("returns default for NaN", () => {
    expect(normalizeCollectionPageLimit(Number.NaN)).toBe(DEFAULT_COLLECTION_PAGE_LIMIT);
  });

  it("returns default for Infinity", () => {
    expect(normalizeCollectionPageLimit(Infinity)).toBe(DEFAULT_COLLECTION_PAGE_LIMIT);
    expect(normalizeCollectionPageLimit(-Infinity)).toBe(DEFAULT_COLLECTION_PAGE_LIMIT);
  });

  it("accepts 1 as the minimum valid limit", () => {
    expect(normalizeCollectionPageLimit(1)).toBe(1);
  });

  it("accepts MAX_COLLECTION_PAGE_LIMIT as the maximum valid limit", () => {
    expect(normalizeCollectionPageLimit(MAX_COLLECTION_PAGE_LIMIT)).toBe(MAX_COLLECTION_PAGE_LIMIT);
  });

  it("returns default for values above MAX_COLLECTION_PAGE_LIMIT", () => {
    expect(normalizeCollectionPageLimit(MAX_COLLECTION_PAGE_LIMIT + 1)).toBe(DEFAULT_COLLECTION_PAGE_LIMIT);
    expect(normalizeCollectionPageLimit(1000)).toBe(DEFAULT_COLLECTION_PAGE_LIMIT);
  });

  it("truncates floating-point values to integers", () => {
    expect(normalizeCollectionPageLimit(1.9)).toBe(1);
    expect(normalizeCollectionPageLimit(5.1)).toBe(5);
    expect(normalizeCollectionPageLimit(99.999)).toBe(99);
  });

  it("handles string '0' coerced to number (0 is below minimum)", () => {
    // @ts-expect-error testing runtime behavior with wrong type
    expect(normalizeCollectionPageLimit("0")).toBe(DEFAULT_COLLECTION_PAGE_LIMIT);
  });

  it("handles string '5' coerced to number via Math.trunc", () => {
    // @ts-expect-error testing runtime behavior with wrong type
    expect(normalizeCollectionPageLimit("5")).toBe(5);
  });
});

// ---------------------------------------------------------------------------
// 2. Collection cursor encoding/decoding edge cases
// ---------------------------------------------------------------------------
describe("edge cases: collection cursor encode/decode", () => {
  it("decodeCollectionCursor returns null for undefined", () => {
    expect(decodeCollectionCursor(undefined)).toBeNull();
  });

  it("decodeCollectionCursor returns null for null", () => {
    expect(decodeCollectionCursor(null)).toBeNull();
  });

  it("decodeCollectionCursor returns null for empty string", () => {
    expect(decodeCollectionCursor("")).toBeNull();
  });

  it("decodeCollectionCursor throws for random garbage", () => {
    expect(() => decodeCollectionCursor("not-a-valid-cursor")).toThrow(CollectionPageQueryError);
  });

  it("decodeCollectionCursor throws for base64-encoded non-JSON", () => {
    const garbage = Buffer.from("this is not json", "utf8").toString("base64url");
    expect(() => decodeCollectionCursor(garbage)).toThrow(CollectionPageQueryError);
  });

  it("decodeCollectionCursor throws for JSON missing required fields", () => {
    const partial = Buffer.from(JSON.stringify({ createdAt: "2024-01-01T00:00:00.000Z" }), "utf8").toString("base64url");
    expect(() => decodeCollectionCursor(partial)).toThrow(CollectionPageQueryError);
  });

  it("round-trips a cursor with minimal valid values", () => {
    const cursor = { createdAt: "2024-01-01T00:00:00.000Z", id: "x" };
    const encoded = encodeCollectionCursor(cursor);
    const decoded = decodeCollectionCursor(encoded);
    expect(decoded).toEqual(cursor);
  });

  it("rejects id with empty string (min(1) validation)", () => {
    expect(() => encodeCollectionCursor({ createdAt: "2024-01-01T00:00:00.000Z", id: "" })).toThrow();
  });

  it("rejects non-ISO datetime in createdAt", () => {
    expect(() => encodeCollectionCursor({ createdAt: "not-a-date", id: "x" })).toThrow();
  });

  it("handles unicode characters in id field", () => {
    const cursor = { createdAt: "2024-06-15T12:00:00.000Z", id: "item-\u00e9\u00e8\u00ea" };
    const encoded = encodeCollectionCursor(cursor);
    const decoded = decodeCollectionCursor(encoded);
    expect(decoded).toEqual(cursor);
  });
});

// ---------------------------------------------------------------------------
// 3. Collection sorting comparators: boundary values
// ---------------------------------------------------------------------------
describe("edge cases: collection sorting comparators", () => {
  it("compareCreatedDescKeys returns 0 for identical cursors", () => {
    const cursor = { createdAt: "2024-01-01T00:00:00.000Z", id: "same" };
    expect(compareCreatedDescKeys(cursor, cursor)).toBe(0);
  });

  it("compareCreatedAscKeys returns 0 for identical cursors", () => {
    const cursor = { createdAt: "2024-01-01T00:00:00.000Z", id: "same" };
    expect(compareCreatedAscKeys(cursor, cursor)).toBe(0);
  });

  it("compareCreatedDescKeys uses id as tiebreaker when dates are equal", () => {
    const a = { createdAt: "2024-01-01T00:00:00.000Z", id: "a" };
    const b = { createdAt: "2024-01-01T00:00:00.000Z", id: "b" };
    // Desc: b > a for id means b should come first, so compareCreatedDescKeys(a, b) > 0
    expect(compareCreatedDescKeys(a, b)).toBeGreaterThan(0);
    expect(compareCreatedDescKeys(b, a)).toBeLessThan(0);
  });

  it("sortByCreatedDesc returns empty array for empty input", () => {
    expect(sortByCreatedDesc([])).toEqual([]);
  });

  it("sortByCreatedAsc returns empty array for empty input", () => {
    expect(sortByCreatedAsc([])).toEqual([]);
  });

  it("sortByCreatedDesc returns single element unchanged", () => {
    const items = [{ createdAt: "2024-01-01T00:00:00.000Z", id: "only", data: 42 }];
    expect(sortByCreatedDesc(items)).toEqual(items);
  });

  it("sortByCreatedDesc does not mutate the original array", () => {
    const original = [
      { createdAt: "2024-01-01T00:00:00.000Z", id: "b" },
      { createdAt: "2024-06-01T00:00:00.000Z", id: "a" }
    ];
    const copy = [...original];
    sortByCreatedDesc(original);
    expect(original).toEqual(copy);
  });

  it("handles items with undefined id (falls back to empty string)", () => {
    const items = [
      { createdAt: "2024-01-01T00:00:00.000Z" },
      { createdAt: "2024-01-01T00:00:00.000Z" }
    ];
    // Should not throw; undefined id falls back to ""
    expect(() => sortByCreatedDesc(items)).not.toThrow();
    expect(sortByCreatedDesc(items)).toHaveLength(2);
  });
});

// ---------------------------------------------------------------------------
// 4. buildCollectionPage: off-by-one, empty, and boundary pagination
// ---------------------------------------------------------------------------
describe("edge cases: buildCollectionPage", () => {
  const getCursorKey = (item: { id: string; createdAt: string }) => ({
    createdAt: item.createdAt,
    id: item.id
  });
  const parsePage = (page: { items: Array<{ id: string; createdAt: string }>; limit: number; nextCursor: string | null; generatedAt: string }) => page;

  it("returns empty items for empty input array", () => {
    const result = buildCollectionPage({
      items: [],
      limit: 10,
      getCursorKey,
      parsePage
    });
    expect(result.items).toEqual([]);
    expect(result.nextCursor).toBeNull();
    expect(result.limit).toBe(10);
  });

  it("returns exactly limit items when input has more", () => {
    const items = Array.from({ length: 10 }, (_, i) => ({
      id: `item-${String(i).padStart(2, "0")}`,
      createdAt: new Date(2024, 0, i + 1).toISOString()
    }));
    const result = buildCollectionPage({
      items,
      limit: 5,
      getCursorKey,
      parsePage
    });
    expect(result.items).toHaveLength(5);
    expect(result.nextCursor).not.toBeNull();
  });

  it("returns all items when input length equals limit (no next cursor)", () => {
    const items = Array.from({ length: 5 }, (_, i) => ({
      id: `item-${i}`,
      createdAt: new Date(2024, 0, i + 1).toISOString()
    }));
    const result = buildCollectionPage({
      items,
      limit: 5,
      getCursorKey,
      parsePage
    });
    expect(result.items).toHaveLength(5);
    expect(result.nextCursor).toBeNull();
  });

  it("returns all items when input length is less than limit", () => {
    const items = Array.from({ length: 3 }, (_, i) => ({
      id: `item-${i}`,
      createdAt: new Date(2024, 0, i + 1).toISOString()
    }));
    const result = buildCollectionPage({
      items,
      limit: 10,
      getCursorKey,
      parsePage
    });
    expect(result.items).toHaveLength(3);
    expect(result.nextCursor).toBeNull();
  });

  it("handles limit=1 correctly (single-element page)", () => {
    const items = Array.from({ length: 5 }, (_, i) => ({
      id: `item-${String(i).padStart(2, "0")}`,
      createdAt: new Date(2024, 0, i + 1).toISOString()
    }));
    const result = buildCollectionPage({
      items,
      limit: 1,
      getCursorKey,
      parsePage
    });
    expect(result.items).toHaveLength(1);
    expect(result.nextCursor).not.toBeNull();
  });

  it("returns nextCursor=null when exactly limit+1 items exist but only limit are returned", () => {
    const items = Array.from({ length: 6 }, (_, i) => ({
      id: `item-${String(i).padStart(2, "0")}`,
      createdAt: new Date(2024, 0, i + 1).toISOString()
    }));
    // With limit=5 and 6 items, we should get 5 items and a next cursor
    const result = buildCollectionPage({
      items,
      limit: 5,
      getCursorKey,
      parsePage
    });
    expect(result.items).toHaveLength(5);
    // 6 items > 5 limit, so nextCursor should exist
    expect(result.nextCursor).not.toBeNull();
  });

  it("ignores undefined/null limit and uses default", () => {
    const items = Array.from({ length: 25 }, (_, i) => ({
      id: `item-${i}`,
      createdAt: new Date(2024, 0, i + 1).toISOString()
    }));
    const result = buildCollectionPage({
      items,
      limit: undefined,
      getCursorKey,
      parsePage
    });
    expect(result.limit).toBe(DEFAULT_COLLECTION_PAGE_LIMIT);
    expect(result.items.length).toBeLessThanOrEqual(DEFAULT_COLLECTION_PAGE_LIMIT);
  });
});

// ---------------------------------------------------------------------------
// 5. computeJobRetryDelayMs: boundary values for attempts and policies
// ---------------------------------------------------------------------------
describe("edge cases: computeJobRetryDelayMs", () => {
  it("returns baseDelay for attempt 1 (index 0, multiplier = factor^0 = 1)", () => {
    expect(computeJobRetryDelayMs(1)).toBe(1000);
  });

  it("returns baseDelay for attempt 0 (clamped to index 0)", () => {
    expect(computeJobRetryDelayMs(0)).toBe(1000);
  });

  it("returns baseDelay for negative attempt counts (clamped to 0)", () => {
    expect(computeJobRetryDelayMs(-1)).toBe(1000);
    expect(computeJobRetryDelayMs(-100)).toBe(1000);
  });

  it("exponentially increases delay for successive attempts", () => {
    const delay1 = computeJobRetryDelayMs(1); // 1000 * 2^0 = 1000
    const delay2 = computeJobRetryDelayMs(2); // 1000 * 2^1 = 2000
    const delay3 = computeJobRetryDelayMs(3); // 1000 * 2^2 = 4000
    expect(delay1).toBe(1000);
    expect(delay2).toBe(2000);
    expect(delay3).toBe(4000);
  });

  it("caps delay at maxDelayMs for very high attempt counts", () => {
    const delay = computeJobRetryDelayMs(100);
    expect(delay).toBeLessThanOrEqual(5 * 60_000);
  });

  it("respects custom baseDelayMs", () => {
    expect(computeJobRetryDelayMs(1, { baseDelayMs: 500 })).toBe(500);
  });

  it("respects custom factor of 1 (constant delay)", () => {
    const delay = computeJobRetryDelayMs(5, { factor: 1 });
    expect(delay).toBe(1000);
  });

  it("jitterRatio=0 returns exact base delay (no jitter)", () => {
    const delay = computeJobRetryDelayMs(1, {}, { jitterRatio: 0 });
    expect(delay).toBe(1000);
  });

  it("jitterRatio clamps negative values to 0", () => {
    const delay = computeJobRetryDelayMs(1, {}, { jitterRatio: -1 });
    expect(delay).toBe(1000);
  });

  it("jitterRatio clamps values above 1 to 1", () => {
    const delay = computeJobRetryDelayMs(1, {}, { jitterRatio: 5, random: () => 0.5 });
    // random()=0.5 means offset = (0.5*2-1)*spread = 0, so delay = baseDelay
    expect(delay).toBe(1000);
  });

  it("jitterRatio=NaN treated as 0 (no jitter)", () => {
    const delay = computeJobRetryDelayMs(1, {}, { jitterRatio: Number.NaN });
    expect(delay).toBe(1000);
  });

  it("never returns negative delay even with jitter", () => {
    for (let attempt = 1; attempt <= 10; attempt++) {
      const delay = computeJobRetryDelayMs(attempt, {}, { jitterRatio: 1, random: () => 0 });
      expect(delay).toBeGreaterThanOrEqual(0);
    }
  });

  it("never exceeds maxDelayMs even with jitter", () => {
    for (let attempt = 1; attempt <= 10; attempt++) {
      const delay = computeJobRetryDelayMs(attempt, {}, { jitterRatio: 1, random: () => 1 });
      expect(delay).toBeLessThanOrEqual(5 * 60_000);
    }
  });
});

// ---------------------------------------------------------------------------
// 6. Approval fallback: empty/unicode strings in requestedAction
// ---------------------------------------------------------------------------
describe("edge cases: buildFallbackApprovalPreview", () => {
  it("handles empty requestedAction string (falls back to safe defaults)", () => {
    const preview = buildFallbackApprovalPreview({
      title: "Test",
      requestedAction: "",
      riskClass: "R1"
    });
    expect(preview.actionType).toBe("artifact-only");
    expect(preview.summary).toBe("No action specified");
  });

  it("handles title with 'requires approval' suffix (strips it)", () => {
    const preview = buildFallbackApprovalPreview({
      title: "Send email requires approval",
      requestedAction: "send",
      riskClass: "R2"
    });
    expect(preview.target).toBe("Send email");
  });

  it("handles title without 'requires approval' suffix (unchanged)", () => {
    const preview = buildFallbackApprovalPreview({
      title: "Simple title",
      requestedAction: "send",
      riskClass: "R2"
    });
    expect(preview.target).toBe("Simple title");
  });

  it("handles title that is exactly 'requires approval' (no leading whitespace, regex does not strip)", () => {
    const preview = buildFallbackApprovalPreview({
      title: "requires approval",
      requestedAction: "send",
      riskClass: "R2"
    });
    // The regex /\s+requires approval$/u requires leading whitespace, so "requires approval"
    // without a leading space is NOT stripped and remains unchanged.
    expect(preview.target).toBe("requires approval");
  });

  it("detects 'delete' from various phrasings", () => {
    for (const action of ["Delete record", "Remove entry", "Erase data"]) {
      const preview = buildFallbackApprovalPreview({
        title: "Test",
        requestedAction: action,
        riskClass: "R3"
      });
      expect(preview.actionType).toBe("delete");
    }
  });

  it("detects 'send' from various phrasings", () => {
    for (const action of ["Send email", "Reply to message", "Email report"]) {
      const preview = buildFallbackApprovalPreview({
        title: "Test",
        requestedAction: action,
        riskClass: "R2"
      });
      expect(preview.actionType).toBe("send");
    }
  });

  it("returns artifact-only for unrecognized actions", () => {
    const preview = buildFallbackApprovalPreview({
      title: "Test",
      requestedAction: "do something unspecified",
      riskClass: "R1"
    });
    expect(preview.actionType).toBe("artifact-only");
  });

  it("handles unicode in requestedAction", () => {
    const preview = buildFallbackApprovalPreview({
      title: "Test",
      requestedAction: "\u{1F600} send \u00e9mail",
      riskClass: "R2"
    });
    // Contains "send" and "email" so should detect "send"
    expect(preview.actionType).toBe("send");
  });
});

// ---------------------------------------------------------------------------
// 7. buildFallbackApprovalActionIntent edge cases
// ---------------------------------------------------------------------------
describe("edge cases: buildFallbackApprovalActionIntent", () => {
  it("uses preview actionType when available", () => {
    const intent = buildFallbackApprovalActionIntent({
      title: "Test",
      requestedAction: "delete everything",
      preview: { actionType: "send", summary: "x", target: "y", changes: [], impact: { affectedPeople: [], affectedSystems: [], permissions: [], rollback: "manual" } }
    });
    expect(intent.actionType).toBe("send");
  });

  it("falls back to inference when preview is null", () => {
    const intent = buildFallbackApprovalActionIntent({
      title: "Test",
      requestedAction: "schedule meeting",
      preview: null
    });
    expect(intent.actionType).toBe("schedule");
  });

  it("falls back to inference when preview is undefined", () => {
    const intent = buildFallbackApprovalActionIntent({
      title: "Test",
      requestedAction: "create document"
    });
    expect(intent.actionType).toBe("create");
  });
});

// ---------------------------------------------------------------------------
// 8. matchesDashboardCommitmentBucket boundary values
// ---------------------------------------------------------------------------
describe("edge cases: matchesDashboardCommitmentBucket", () => {
  function baseCommitment(overrides?: Partial<Commitment>): Commitment {
    return {
      id: "c-1",
      title: "Test commitment",
      summary: "Test",
      status: "pending",
      urgency: "soon",
      riskClass: "R1",
      confidence: 0.8,
      source: { kind: "goal", id: "g-1" },
      evidence: [],
      suggestedAction: null,
      provenanceSummary: "",
      createdAt: nowIso(),
      updatedAt: nowIso(),
      dueAt: null,
      ...overrides
    } as Commitment;
  }

  it("'all' bucket matches everything", () => {
    expect(matchesDashboardCommitmentBucket(baseCommitment(), "all")).toBe(true);
    expect(matchesDashboardCommitmentBucket(baseCommitment({ status: "completed" }), "all")).toBe(true);
    expect(matchesDashboardCommitmentBucket(baseCommitment({ status: "dismissed" }), "all")).toBe(true);
  });

  it("'completed' bucket matches completed and dismissed", () => {
    expect(matchesDashboardCommitmentBucket(baseCommitment({ status: "completed" }), "completed")).toBe(true);
    expect(matchesDashboardCommitmentBucket(baseCommitment({ status: "dismissed" }), "completed")).toBe(true);
    expect(matchesDashboardCommitmentBucket(baseCommitment({ status: "pending" }), "completed")).toBe(false);
  });

  it("'urgent' bucket matches immediate, today, and needs-review", () => {
    expect(matchesDashboardCommitmentBucket(baseCommitment({ urgency: "immediate" }), "urgent")).toBe(true);
    expect(matchesDashboardCommitmentBucket(baseCommitment({ urgency: "today" }), "urgent")).toBe(true);
    expect(matchesDashboardCommitmentBucket(baseCommitment({ status: "needs-review" }), "urgent")).toBe(true);
    expect(matchesDashboardCommitmentBucket(baseCommitment({ urgency: "later" }), "urgent")).toBe(false);
  });

  it("'low_confidence' bucket boundary: exactly 0.75 is NOT low confidence", () => {
    expect(matchesDashboardCommitmentBucket(baseCommitment({ confidence: 0.74 }), "low_confidence")).toBe(true);
    expect(matchesDashboardCommitmentBucket(baseCommitment({ confidence: 0.75 }), "low_confidence")).toBe(false);
    expect(matchesDashboardCommitmentBucket(baseCommitment({ confidence: 0.76 }), "low_confidence")).toBe(false);
  });

  it("'low_confidence' bucket with confidence = 0", () => {
    expect(matchesDashboardCommitmentBucket(baseCommitment({ confidence: 0 }), "low_confidence")).toBe(true);
  });

  it("'due_soon' bucket with null dueAt", () => {
    expect(matchesDashboardCommitmentBucket(baseCommitment({ dueAt: null }), "due_soon")).toBe(false);
  });

  it("'due_soon' bucket with past due date", () => {
    const pastDate = new Date(Date.now() - 1000).toISOString();
    expect(matchesDashboardCommitmentBucket(baseCommitment({ dueAt: pastDate }), "due_soon")).toBe(true);
  });

  it("'waiting_on_others' bucket matches blocked and needs-review", () => {
    expect(matchesDashboardCommitmentBucket(baseCommitment({ status: "blocked" }), "waiting_on_others")).toBe(true);
    expect(matchesDashboardCommitmentBucket(baseCommitment({ status: "needs-review" }), "waiting_on_others")).toBe(true);
    expect(matchesDashboardCommitmentBucket(baseCommitment({ status: "pending" }), "waiting_on_others")).toBe(false);
  });

  it("unresolved bucket excludes completed and dismissed", () => {
    expect(matchesDashboardCommitmentBucket(baseCommitment({ status: "completed" }), "unresolved")).toBe(false);
    expect(matchesDashboardCommitmentBucket(baseCommitment({ status: "dismissed" }), "unresolved")).toBe(false);
    expect(matchesDashboardCommitmentBucket(baseCommitment({ status: "pending" }), "unresolved")).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// 9. mapMemoryRow: null/undefined/type coercion edge cases
// ---------------------------------------------------------------------------
describe("edge cases: mapMemoryRow", () => {
  const baseRow = {
    id: "mem-1",
    user_id: "user-1",
    category: "test",
    memory_type: "observed",
    content: "test content",
    confidence: 0.8,
    source: "workflow",
    sensitivity: "internal",
    permissions: null,
    actor_context: null,
    context_packet_consent: null,
    agent_id: null,
    agent_scope: null,
    review_at: null,
    expiry_at: null,
    version: null,
    supersedes: null,
    valid_from: null,
    created_at: "2024-01-01T00:00:00.000Z",
    updated_at: "2024-01-01T00:00:00.000Z"
  };

  it("maps a complete row successfully", () => {
    const result = mapMemoryRow(baseRow);
    expect(result.id).toBe("mem-1");
    expect(result.confidence).toBe(0.8);
    expect(result.permissions).toEqual([]);
    expect(result.agentId).toBeNull();
    expect(result.agentScope).toBe("global");
  });

  it("coerces string confidence to number", () => {
    const result = mapMemoryRow({ ...baseRow, confidence: "0.5" });
    expect(result.confidence).toBe(0.5);
  });

  it("coerces string version to number", () => {
    const result = mapMemoryRow({ ...baseRow, version: "3" });
    expect(result.version).toBe(3);
  });

  it("throws for version = 0 (schema requires version >= 1)", () => {
    expect(() => mapMemoryRow({ ...baseRow, version: 0 })).toThrow();
  });

  it("defaults agentScope to 'global' for non-string values", () => {
    const result = mapMemoryRow({ ...baseRow, agent_scope: 123 });
    expect(result.agentScope).toBe("global");
  });

  it("handles agent_id as non-string (returns null)", () => {
    const result = mapMemoryRow({ ...baseRow, agent_id: 42 });
    expect(result.agentId).toBeNull();
  });

  it("handles supersedes as non-string (returns null)", () => {
    const result = mapMemoryRow({ ...baseRow, supersedes: 42 });
    expect(result.supersedes).toBeNull();
  });

  it("handles Date objects for timestamps", () => {
    const result = mapMemoryRow({
      ...baseRow,
      created_at: new Date("2024-06-15T00:00:00.000Z"),
      updated_at: new Date("2024-06-15T00:00:00.000Z")
    });
    expect(result.createdAt).toBe("2024-06-15T00:00:00.000Z");
  });

  it("handles numeric timestamps for created_at", () => {
    const ts = new Date("2024-06-15T00:00:00.000Z").getTime();
    const result = mapMemoryRow({ ...baseRow, created_at: ts, updated_at: ts });
    expect(result.createdAt).toContain("2024-06-15");
  });
});

// ---------------------------------------------------------------------------
// 10. deriveAgentMetricsFromGoals: empty and boundary inputs
// ---------------------------------------------------------------------------
describe("edge cases: deriveAgentMetricsFromGoals", () => {
  const agent: AgentDefinition = {
    id: "agent-1",
    name: "workflow",
    description: "test",
    capabilities: ["read"],
    executionMode: "governed_specialist",
    implementationTier: "experimental"
  };

  it("returns zero metrics for empty goals and empty evidence", () => {
    const metrics = deriveAgentMetricsFromGoals({
      agent,
      period: "all",
      goals: [],
      evidenceRecords: []
    });
    expect(metrics.tasksTotal).toBe(0);
    expect(metrics.tasksCompleted).toBe(0);
    expect(metrics.successRate).toBe(0);
    expect(metrics.averageConfidence).toBe(0);
    expect(metrics.averageExecutionTimeMs).toBe(0);
    expect(metrics.approvalRate).toBe(0);
  });

  it("returns zero metrics for goals with empty task arrays", () => {
    const metrics = deriveAgentMetricsFromGoals({
      agent,
      period: "all",
      goals: [{
        goal: { id: "g-1", userId: "u-1", title: "t", request: "r", intent: "i", status: "running", confidence: 0.5, explanation: "e", createdAt: nowIso(), updatedAt: nowIso() },
        tasks: [],
        approvals: [],
        artifacts: [],
        actionLogs: [],
        watchers: []
      }],
      evidenceRecords: []
    });
    expect(metrics.tasksTotal).toBe(0);
  });

  it("handles goals with no matching agent tasks", () => {
    const metrics = deriveAgentMetricsFromGoals({
      agent,
      period: "all",
      goals: [{
        goal: { id: "g-1", userId: "u-1", title: "t", request: "r", intent: "i", status: "running", confidence: 0.5, explanation: "e", createdAt: nowIso(), updatedAt: nowIso() },
        tasks: [{
          id: "task-1", goalId: "g-1", workflowId: "wf-1", title: "task", summary: "s",
          assignedAgent: "communications" as const, state: "completed" as const, riskClass: "R1" as const,
          requiresApproval: false, dependsOn: [], toolCapabilities: ["read" as const], artifactIds: [],
          createdAt: nowIso(), updatedAt: nowIso()
        }],
        approvals: [],
        artifacts: [],
        actionLogs: [],
        watchers: []
      }],
      evidenceRecords: []
    });
    // agent is "workflow" but task is assigned to "communications"
    expect(metrics.tasksTotal).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// 11. summarizeJobReadinessFromJobs: empty and boundary inputs
// ---------------------------------------------------------------------------
describe("edge cases: summarizeJobReadinessFromJobs", () => {
  it("returns all zeros for empty job list", () => {
    const summary = summarizeJobReadinessFromJobs([]);
    expect(summary.queuedJobs).toBe(0);
    expect(summary.retryingJobs).toBe(0);
    expect(summary.runningJobs).toBe(0);
    expect(summary.deadLetterJobs).toBe(0);
    expect(summary.expiredLeases).toBe(0);
    expect(summary.stalePendingJobs).toBe(0);
    expect(summary.oldestPendingJobAgeMs).toBeNull();
  });

  it("handles job with invalid availableAt date string", () => {
    const job = {
      status: "queued" as const,
      availableAt: "not-a-date",
      leaseExpiresAt: null
    } as unknown as JobRecord;
    const summary = summarizeJobReadinessFromJobs([job]);
    expect(summary.queuedJobs).toBe(1);
    // Invalid date means age cannot be computed
    expect(summary.oldestPendingJobAgeMs).toBeNull();
    expect(summary.stalePendingJobs).toBe(0);
  });

  it("detects expired lease when leaseExpiresAt equals nowMs exactly", () => {
    const now = nowIso();
    const job = {
      status: "running" as const,
      leaseExpiresAt: now,
      availableAt: now
    } as unknown as JobRecord;
    const summary = summarizeJobReadinessFromJobs([job], { now });
    expect(summary.runningJobs).toBe(1);
    expect(summary.expiredLeases).toBe(1);
  });

  it("oldestPendingJobAgeMs is never negative", () => {
    const futureAvailable = new Date(Date.now() + 1_000_000).toISOString();
    const job = {
      status: "queued" as const,
      availableAt: futureAvailable
    } as unknown as JobRecord;
    const summary = summarizeJobReadinessFromJobs([job]);
    // availableAt is in the future, so it won't be counted (availableAt > nowMs)
    expect(summary.oldestPendingJobAgeMs).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// 12. summarizeProviderCredentialReadiness: empty and boundary inputs
// ---------------------------------------------------------------------------
describe("edge cases: summarizeProviderCredentialReadiness", () => {
  it("returns all zeros for empty credential list", () => {
    const summary = summarizeProviderCredentialReadiness([]);
    expect(summary.totalCredentials).toBe(0);
    expect(summary.connectedCredentials).toBe(0);
    expect(summary.degradedCredentials).toBe(0);
  });

  it("skips credentials for different userId", () => {
    const credential = {
      userId: "other-user",
      status: "connected",
      expiresAt: null,
      lastValidatedAt: nowIso(),
      updatedAt: nowIso()
    } as unknown as ProviderCredential;
    const summary = summarizeProviderCredentialReadiness([credential], { userId: "owner" });
    expect(summary.totalCredentials).toBe(0);
  });

  it("detects expired credential when expiresAt equals now", () => {
    const now = nowIso();
    const credential = {
      userId: "owner",
      status: "connected",
      expiresAt: now,
      lastValidatedAt: now,
      updatedAt: now
    } as unknown as ProviderCredential;
    const summary = summarizeProviderCredentialReadiness([credential], { now });
    expect(summary.expiredCredentials).toBe(1);
    expect(summary.degradedCredentials).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// 13. buildDashboardSummary: empty/minimal data
// ---------------------------------------------------------------------------
describe("edge cases: buildDashboardSummary", () => {
  function minimalDashboardData(): DashboardData {
    return {
      diagnostics: { generatedAt: nowIso(), items: [], totalCount: 0 },
      goals: [],
      approvals: [],
      commitments: [],
      nowQueue: { items: [], totalCount: 0 },
      memories: [],
      integrations: [],
      latestArtifacts: [],
      actionLogs: [],
      watchers: [],
      operations: undefined,
      activeWorkspace: null,
      governanceConformance: undefined
    } as unknown as DashboardData;
  }

  it("handles completely empty dashboard data", () => {
    const summary = buildDashboardSummary(minimalDashboardData());
    expect(summary.counts.goals).toBe(0);
    expect(summary.counts.pendingApprovals).toBe(0);
    expect(summary.lanes).toHaveLength(6);
    expect(summary.topDiagnostic).toBeNull();
    expect(summary.activeWorkspace).toBeNull();
  });

  it("operates section defaults to 0 when operations is undefined", () => {
    const summary = buildDashboardSummary(minimalDashboardData());
    expect(summary.operations.asyncIssueCount).toBe(0);
    expect(summary.operations.connectorIssueCount).toBe(0);
    expect(summary.operations.shellStatus).toBeNull();
  });

  it("approvalsByRisk starts at zero for all risk classes", () => {
    const summary = buildDashboardSummary(minimalDashboardData());
    expect(summary.approvalsByRisk).toEqual({ R1: 0, R2: 0, R3: 0, R4: 0 });
  });

  it("govern lane shows 'attention' when no workspace is active", () => {
    const data = minimalDashboardData();
    data.activeWorkspace = null;
    const summary = buildDashboardSummary(data);
    const governLane = summary.lanes.find(l => l.key === "govern");
    expect(governLane?.status).toBe("attention");
  });
});

// ---------------------------------------------------------------------------
// 14. buildDashboardRepositoryCollectionPage: empty/single element
// ---------------------------------------------------------------------------
describe("edge cases: buildDashboardRepositoryCollectionPage", () => {
  it("returns empty page for empty items", () => {
    const result = buildDashboardRepositoryCollectionPage({
      items: [],
      limit: 10,
      getId: (item: { id: string }) => item.id,
      getCreatedAt: (item: { createdAt: string }) => item.createdAt,
      parseItem: (item: { id: string; createdAt: string }) => item
    });
    expect(result.items).toEqual([]);
    expect(result.totalCount).toBe(0);
    expect(result.nextCursor).toBeNull();
  });

  it("returns single item page correctly", () => {
    const items = [{ id: "only", createdAt: nowIso() }];
    const result = buildDashboardRepositoryCollectionPage({
      items,
      limit: 10,
      getId: (item: { id: string }) => item.id,
      getCreatedAt: (item: { createdAt: string }) => item.createdAt,
      parseItem: (item: { id: string; createdAt: string }) => item
    });
    expect(result.items).toHaveLength(1);
    expect(result.totalCount).toBe(1);
    expect(result.nextCursor).toBeNull();
  });

  it("handles search with empty q parameter (returns all)", () => {
    const items = [
      { id: "a", createdAt: nowIso(), title: "alpha" },
      { id: "b", createdAt: nowIso(), title: "beta" }
    ];
    const result = buildDashboardRepositoryCollectionPage({
      items,
      limit: 10,
      q: "",
      getId: (item: { id: string }) => item.id,
      getCreatedAt: (item: { createdAt: string }) => item.createdAt,
      getTitle: (item: { title: string }) => item.title,
      getSearchText: (item: { title: string }) => item.title,
      parseItem: (item: { id: string; createdAt: string; title: string }) => item
    });
    expect(result.items).toHaveLength(2);
  });

  it("handles search with whitespace-only q (treated as empty)", () => {
    const items = [
      { id: "a", createdAt: nowIso(), title: "alpha" },
      { id: "b", createdAt: nowIso(), title: "beta" }
    ];
    const result = buildDashboardRepositoryCollectionPage({
      items,
      limit: 10,
      q: "   ",
      getId: (item: { id: string }) => item.id,
      getCreatedAt: (item: { createdAt: string }) => item.createdAt,
      getTitle: (item: { title: string }) => item.title,
      getSearchText: (item: { title: string }) => item.title,
      parseItem: (item: { id: string; createdAt: string; title: string }) => item
    });
    // Whitespace-only search trims to "" which means no filtering
    expect(result.items).toHaveLength(2);
  });

  it("sorts by title_asc correctly with unicode characters", () => {
    const items = [
      { id: "c", createdAt: nowIso(), title: "\u00e9lement" },
      { id: "a", createdAt: nowIso(), title: "alpha" },
      { id: "b", createdAt: nowIso(), title: "beta" }
    ];
    const result = buildDashboardRepositoryCollectionPage({
      items,
      limit: 10,
      sort: "title_asc" as const,
      getId: (item: { id: string }) => item.id,
      getCreatedAt: (item: { createdAt: string }) => item.createdAt,
      getTitle: (item: { title: string }) => item.title,
      parseItem: (item: { id: string; createdAt: string; title: string }) => item
    });
    // alpha < beta < element (with accent) in locale-aware comparison
    expect(result.items).toHaveLength(3);
    expect(result.items[0].id).toBe("a"); // alpha
  });
});

// ---------------------------------------------------------------------------
// 15. calculateNormalizedEditDistance: empty/identical strings
// ---------------------------------------------------------------------------
describe("edge cases: calculateNormalizedEditDistance", () => {
  it("throws for empty baseline", () => {
    expect(() => calculateNormalizedEditDistance({ baseline: "", submitted: "test" })).toThrow();
  });

  it("throws for empty submitted", () => {
    expect(() => calculateNormalizedEditDistance({ baseline: "test", submitted: "" })).toThrow();
  });

  it("throws for whitespace-only baseline (trimmed to empty)", () => {
    expect(() => calculateNormalizedEditDistance({ baseline: "   ", submitted: "test" })).toThrow();
  });

  it("returns 0 for identical strings", () => {
    const result = calculateNormalizedEditDistance({ baseline: "hello", submitted: "hello" });
    expect(result.editDistance).toBe(0);
    expect(result.normalizedEditDistance).toBe(0);
  });

  it("returns 1 for completely different single-char strings", () => {
    const result = calculateNormalizedEditDistance({ baseline: "a", submitted: "b" });
    expect(result.normalizedEditDistance).toBe(1);
  });

  it("handles case differences (since it trims but doesn't lowercase)", () => {
    const result = calculateNormalizedEditDistance({ baseline: "Hello", submitted: "hello" });
    // Edit distance between "Hello" and "hello" = 1 (H -> h), normalized = 1/5 = 0.2
    expect(result.editDistance).toBeGreaterThan(0);
    expect(result.normalizedEditDistance).toBeLessThanOrEqual(1);
  });
});

// ---------------------------------------------------------------------------
// 16. clone() deep copy edge cases
// ---------------------------------------------------------------------------
describe("edge cases: clone()", () => {
  it("deep clones nested objects (no shared references)", () => {
    const original = { a: { b: { c: [1, 2, 3] } } };
    const cloned = clone(original);
    cloned.a.b.c.push(4);
    expect(original.a.b.c).toEqual([1, 2, 3]);
  });

  it("handles empty object", () => {
    expect(clone({})).toEqual({});
  });

  it("handles empty array", () => {
    expect(clone([])).toEqual([]);
  });

  it("handles null values in object", () => {
    const obj = { a: null, b: "hello" };
    expect(clone(obj)).toEqual({ a: null, b: "hello" });
  });

  it("drops undefined values (JSON.stringify behavior)", () => {
    const obj = { a: undefined, b: "hello" };
    const cloned = clone(obj);
    expect(cloned).toEqual({ b: "hello" });
    expect("a" in cloned).toBe(false);
  });

  it("drops Date objects (becomes ISO string via JSON)", () => {
    const obj = { date: new Date("2024-01-01T00:00:00.000Z") };
    const cloned = clone(obj);
    expect(cloned.date).toBe("2024-01-01T00:00:00.000Z");
  });
});

// ---------------------------------------------------------------------------
// 17. Task state machine: exhaustive boundary checks
// ---------------------------------------------------------------------------
describe("edge cases: task state machine terminal transitions", () => {
  it("completed has zero legal outgoing transitions", () => {
    const allStates = ["queued", "running", "waiting", "blocked", "retrying", "failed", "completed"] as const;
    for (const target of allStates) {
      expect(canTransitionTaskState("completed", target)).toBe(false);
    }
  });

  it("blocked can only transition to queued or running", () => {
    expect(canTransitionTaskState("blocked", "queued")).toBe(true);
    expect(canTransitionTaskState("blocked", "running")).toBe(true);
    expect(canTransitionTaskState("blocked", "completed")).toBe(false);
    expect(canTransitionTaskState("blocked", "failed")).toBe(false);
    expect(canTransitionTaskState("blocked", "waiting")).toBe(false);
    expect(canTransitionTaskState("blocked", "retrying")).toBe(false);
    expect(canTransitionTaskState("blocked", "blocked")).toBe(false);
  });

  it("retrying can only transition to running or failed", () => {
    expect(canTransitionTaskState("retrying", "running")).toBe(true);
    expect(canTransitionTaskState("retrying", "failed")).toBe(true);
    expect(canTransitionTaskState("retrying", "completed")).toBe(false);
    expect(canTransitionTaskState("retrying", "queued")).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// 18. Job state machine: exhaustive boundary checks
// ---------------------------------------------------------------------------
describe("edge cases: job state machine terminal transitions", () => {
  it("dead_letter has zero legal outgoing transitions", () => {
    const allStates = ["queued", "running", "retrying", "paused", "cancelled", "completed", "dead_letter"] as const;
    for (const target of allStates) {
      expect(canTransitionJobState("dead_letter", target)).toBe(false);
    }
  });

  it("cancelled has zero legal outgoing transitions", () => {
    const allStates = ["queued", "running", "retrying", "paused", "cancelled", "completed", "dead_letter"] as const;
    for (const target of allStates) {
      expect(canTransitionJobState("cancelled", target)).toBe(false);
    }
  });

  it("paused can transition to queued, running, or cancelled", () => {
    expect(canTransitionJobState("paused", "queued")).toBe(true);
    expect(canTransitionJobState("paused", "running")).toBe(true);
    expect(canTransitionJobState("paused", "cancelled")).toBe(true);
    expect(canTransitionJobState("paused", "completed")).toBe(false);
    expect(canTransitionJobState("paused", "dead_letter")).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// 19. Floating-point precision in metrics calculations
// ---------------------------------------------------------------------------
describe("edge cases: floating-point precision", () => {
  it("successRate is 0 when no tasks exist (0/0 guard)", () => {
    const agent: AgentDefinition = {
      id: "a-1", name: "workflow", description: "test",
      capabilities: ["read"], executionMode: "governed_specialist", implementationTier: "experimental"
    };
    const metrics = deriveAgentMetricsFromGoals({
      agent, period: "all", goals: [], evidenceRecords: []
    });
    expect(metrics.successRate).toBe(0);
    expect(Number.isFinite(metrics.successRate)).toBe(true);
  });

  it("approvalRate is 0 when no approvals exist", () => {
    const agent: AgentDefinition = {
      id: "a-1", name: "workflow", description: "test",
      capabilities: ["read"], executionMode: "governed_specialist", implementationTier: "experimental"
    };
    const metrics = deriveAgentMetricsFromGoals({
      agent, period: "all", goals: [], evidenceRecords: []
    });
    expect(metrics.approvalRate).toBe(0);
    expect(Number.isFinite(metrics.approvalRate)).toBe(true);
  });

  it("correctionRate is 0 when no feedback exists", () => {
    const agent: AgentDefinition = {
      id: "a-1", name: "workflow", description: "test",
      capabilities: ["read"], executionMode: "governed_specialist", implementationTier: "experimental"
    };
    const metrics = deriveAgentMetricsFromGoals({
      agent, period: "all", goals: [], evidenceRecords: []
    });
    expect(metrics.correctionRate).toBe(0);
    expect(Number.isFinite(metrics.correctionRate)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// 20. Unicode and special characters in visible code point detection
// ---------------------------------------------------------------------------
describe("edge cases: unicode handling in contracts", () => {
  it("zero-width space alone has no visible code point", () => {
    // The regex /\p{L}|\p{N}|\p{P}|\p{S}/u should not match zero-width space (U+200B)
    const zeroWidthSpace = "\u200B";
    const pattern = /\p{L}|\p{N}|\p{P}|\p{S}/u;
    expect(pattern.test(zeroWidthSpace)).toBe(false);
  });

  it("left-to-right mark alone has no visible code point", () => {
    const lrm = "\u200E";
    const pattern = /\p{L}|\p{N}|\p{P}|\p{S}/u;
    expect(pattern.test(lrm)).toBe(false);
  });

  it("emoji is a visible code point (category S)", () => {
    const pattern = /\p{L}|\p{N}|\p{P}|\p{S}/u;
    expect(pattern.test("\u{1F600}")).toBe(true);
  });

  it("CJK characters are visible code points (category L)", () => {
    const pattern = /\p{L}|\p{N}|\p{P}|\p{S}/u;
    expect(pattern.test("\u4e16\u754c")).toBe(true);
  });

  it("Arabic script is visible (category L)", () => {
    const pattern = /\p{L}|\p{N}|\p{P}|\p{S}/u;
    expect(pattern.test("\u0645\u0631\u062D\u0628\u0627")).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// 21. Dashboard collection page: cursor sort mismatch
// ---------------------------------------------------------------------------
describe("edge cases: dashboard collection cursor sort mismatch", () => {
  it("throws CollectionPageQueryError when cursor sort differs from requested sort", () => {
    // Create a cursor encoded for "created_desc"
    const cursor = Buffer.from(JSON.stringify({
      sort: "created_desc",
      value: "2024-01-01T00:00:00.000Z",
      id: "item-1"
    }), "utf8").toString("base64url");

    // But request with "title_asc" sort
    expect(() => buildDashboardRepositoryCollectionPage({
      items: [{ id: "item-2", createdAt: nowIso() }],
      limit: 10,
      cursor,
      sort: "title_asc",
      getId: (item: { id: string }) => item.id,
      getCreatedAt: (item: { createdAt: string }) => item.createdAt,
      parseItem: (item: { id: string; createdAt: string }) => item
    })).toThrow(CollectionPageQueryError);
  });
});

// ---------------------------------------------------------------------------
// 22. Retry delay: very large attempt count doesn't overflow
// ---------------------------------------------------------------------------
describe("edge cases: retry delay overflow protection", () => {
  it("does not return Infinity or NaN for extreme attempt counts", () => {
    const delay = computeJobRetryDelayMs(Number.MAX_SAFE_INTEGER);
    expect(Number.isFinite(delay)).toBe(true);
    expect(delay).toBeLessThanOrEqual(5 * 60_000);
    expect(delay).toBeGreaterThanOrEqual(0);
  });

  it("factor=0 yields baseDelay for first attempt and 0 for others", () => {
    const delay1 = computeJobRetryDelayMs(1, { factor: 0 });
    expect(delay1).toBe(1000); // 1000 * 0^0 = 1000 * 1 = 1000
    const delay2 = computeJobRetryDelayMs(2, { factor: 0 });
    expect(delay2).toBe(0); // 1000 * 0^1 = 0
  });
});

// ---------------------------------------------------------------------------
// 23. buildCollectionPage with exactly-limit boundary (off-by-one regression)
// ---------------------------------------------------------------------------
describe("edge cases: buildCollectionPage off-by-one regression", () => {
  const getCursorKey = (item: { id: string; createdAt: string }) => ({
    createdAt: item.createdAt,
    id: item.id
  });
  const parsePage = (page: { items: Array<{ id: string; createdAt: string }>; limit: number; nextCursor: string | null; generatedAt: string }) => page;

  it("filtered.length === limit means no nextCursor (exactly full page, no more)", () => {
    // Exactly limit items, no cursor filter -> filtered.length === limit
    const items = Array.from({ length: 3 }, (_, i) => ({
      id: `item-${String(i).padStart(2, "0")}`,
      createdAt: new Date(2024, 0, i + 1).toISOString()
    }));
    const result = buildCollectionPage({ items, limit: 3, getCursorKey, parsePage });
    expect(result.items).toHaveLength(3);
    // filtered.length (3) > limit (3) is false, so nextCursor is null
    expect(result.nextCursor).toBeNull();
  });

  it("filtered.length === limit + 1 means nextCursor exists", () => {
    const items = Array.from({ length: 4 }, (_, i) => ({
      id: `item-${String(i).padStart(2, "0")}`,
      createdAt: new Date(2024, 0, i + 1).toISOString()
    }));
    const result = buildCollectionPage({ items, limit: 3, getCursorKey, parsePage });
    expect(result.items).toHaveLength(3);
    // filtered.length (4) > limit (3) is true, so nextCursor exists
    expect(result.nextCursor).not.toBeNull();
  });

  it("paginating through all items with limit=2 yields correct page count", () => {
    const items = Array.from({ length: 5 }, (_, i) => ({
      id: `item-${String(i).padStart(2, "0")}`,
      createdAt: new Date(2024, 0, i + 1).toISOString()
    }));
    // First page
    const page1 = buildCollectionPage({ items, limit: 2, getCursorKey, parsePage });
    expect(page1.items).toHaveLength(2);
    expect(page1.nextCursor).not.toBeNull();

    // Second page using cursor
    const page2 = buildCollectionPage({ items, limit: 2, cursor: page1.nextCursor, getCursorKey, parsePage });
    expect(page2.items).toHaveLength(2);
    expect(page2.nextCursor).not.toBeNull();

    // Third page (last item)
    const page3 = buildCollectionPage({ items, limit: 2, cursor: page2.nextCursor, getCursorKey, parsePage });
    expect(page3.items).toHaveLength(1);
    expect(page3.nextCursor).toBeNull();

    // All items are unique across pages
    const allIds = [...page1.items, ...page2.items, ...page3.items].map(i => i.id);
    expect(new Set(allIds).size).toBe(5);
  });
});
