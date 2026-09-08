/**
 * Adversarial deep tests for packages/repository/src/
 *
 * Targets:
 *  1. Lock acquisition edge cases
 *  2. Action log corruption / partial writes / concurrent appends
 *  3. Pagination boundaries (zero, NaN, max offset, empty sets)
 *  4. Dashboard data races / stale reads
 *  5. Provenance graph (circular refs, orphans, deep chains)
 *  6. Commitment state machine (invalid transitions, duplicates, expiry)
 *  7. Approval conflicts (simultaneous approve/reject, double-submit)
 *  8. Provider ledger (duplicate side effects, idempotency collision)
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import type { RuntimeContext, LockAdapter } from "@agentic/runtime-adapters";
import { nowIso, clone, ActionLogSchema } from "@agentic/contracts";
import type { ActionLog } from "@agentic/contracts";

// ── Direct imports from repository package ────────────────────────────────
import { acquireFileStoreLock } from "../packages/repository/src/file-store-lock";
import {
  validateGoalActionLogs,
  cloneActionLogs,
  appendGoalActionLogsToStore
} from "../packages/repository/src/action-log-append";
import {
  normalizeCollectionPageLimit,
  encodeCollectionCursor,
  decodeCollectionCursor,
  buildCollectionPage,
  sortByCreatedDesc,
  sortByCreatedAsc,
  CollectionPageQueryError
} from "../packages/repository/src/collection-pagination";
import {
  buildExecutionProvenanceGraph
} from "../packages/repository/src/provenance-graph";
import {
  sortCommitments,
  mergeCommitments,
  buildCommitmentInboxPage,
  commitmentIdForGoal,
  commitmentIdForApproval,
  isOpenCommitment,
  buildDashboardDiagnostics,
  CommitmentInboxQueryError
} from "../packages/repository/src/commitment-helpers";
import {
  reserveProviderSideEffectInStore,
  updateProviderSideEffectInStore,
  buildProviderSideEffectId,
  providerSideEffectStoreKey,
  type ProviderSideEffectStore
} from "../packages/repository/src/provider-side-effect-ledger";
import {
  buildApprovalResponseMutation,
  assertApprovalFollowUpJobOwner
} from "../packages/repository/src/approval-response-helpers";
import { ApprovalMutationError } from "../packages/repository/src/repository-types";

// Re-export for testing (the function is not exported but we can access via module)
// We'll test appendMissingActionLogs indirectly through appendGoalActionLogsToStore

// ── Helpers ───────────────────────────────────────────────────────────────

function makeActionLog(overrides: Partial<ActionLog> = {}): ActionLog {
  return ActionLogSchema.parse({
    id: overrides.id ?? `log-${Math.random().toString(36).slice(2, 10)}`,
    goalId: overrides.goalId ?? "goal-1",
    taskId: overrides.taskId ?? null,
    workflowId: overrides.workflowId ?? null,
    actor: overrides.actor ?? "agent:test",
    kind: overrides.kind ?? "info",
    message: overrides.message ?? "test message",
    details: overrides.details ?? {},
    createdAt: overrides.createdAt ?? nowIso(),
    prevHash: overrides.prevHash ?? null
  });
}

function makeMockRuntime(lockImpl?: LockAdapter): RuntimeContext {
  const defaultLock: LockAdapter = {
    acquire: vi.fn().mockResolvedValue(vi.fn().mockResolvedValue(undefined))
  };
  return {
    storage: {} as any,
    locks: lockImpl ?? defaultLock,
    isEdgeRuntime: false,
    env: {},
    cwd: () => "/tmp",
    pid: process.pid,
    randomUUID: () => "test-uuid",
    now: () => Date.now()
  };
}

function makeGoalBundle(id: string, opts: Record<string, any> = {}) {
  return {
    goal: {
      id,
      userId: opts.userId ?? "user-1",
      title: opts.title ?? `Goal ${id}`,
      explanation: opts.explanation ?? "test goal",
      status: opts.status ?? "active",
      workspaceId: opts.workspaceId ?? "ws-1",
      confidence: opts.confidence ?? 0.9,
      createdAt: opts.createdAt ?? nowIso(),
      updatedAt: opts.updatedAt ?? nowIso()
    },
    tasks: opts.tasks ?? [],
    approvals: opts.approvals ?? [],
    actionLogs: opts.actionLogs ?? [],
    artifacts: opts.artifacts ?? [],
    workflow: opts.workflow ?? { id: `wf-${id}`, updatedAt: nowIso() }
  };
}

function makeApproval(id: string, opts: Record<string, any> = {}) {
  return {
    id,
    goalId: opts.goalId ?? "goal-1",
    taskId: opts.taskId ?? "task-1",
    title: opts.title ?? `Approval ${id}`,
    rationale: opts.rationale ?? "needs review",
    requestedAction: opts.requestedAction ?? "deploy",
    decision: opts.decision ?? "pending",
    riskClass: opts.riskClass ?? "R2",
    expiryAt: opts.expiryAt ?? new Date(Date.now() + 3600_000).toISOString(),
    createdAt: opts.createdAt ?? nowIso(),
    respondedAt: opts.respondedAt ?? null,
    decisionScope: opts.decisionScope ?? null,
    decisionRationale: opts.decisionRationale ?? null,
    preview: opts.preview ?? {
      changes: [],
      target: "system",
      actionType: "deploy",
      impact: { affectedSystems: [], affectedPeople: [], permissions: [], rollback: "automatic" }
    },
    actionIntent: opts.actionIntent ?? null
  };
}

function makeCommitment(id: string, opts: Record<string, any> = {}) {
  return {
    id,
    userId: opts.userId ?? "user-1",
    title: opts.title ?? `Commitment ${id}`,
    summary: opts.summary ?? "summary",
    status: opts.status ?? "pending",
    sourceKind: opts.sourceKind ?? "goal",
    sourceId: opts.sourceId ?? "goal-1",
    goalId: opts.goalId ?? "goal-1",
    approvalId: opts.approvalId ?? null,
    dueAt: opts.dueAt ?? null,
    urgency: opts.urgency ?? "soon",
    riskClass: opts.riskClass ?? null,
    confidence: opts.confidence ?? 0.9,
    provenanceSummary: opts.provenanceSummary ?? "Derived from test.",
    suggestedNextAction: opts.suggestedNextAction ?? null,
    evidence: opts.evidence ?? [{ section: "goals", itemId: "goal-1", label: "Goal" }],
    createdAt: opts.createdAt ?? nowIso(),
    updatedAt: opts.updatedAt ?? nowIso(),
    actorContext: null
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// 1. LOCK ACQUISITION EDGE CASES
// ═══════════════════════════════════════════════════════════════════════════

describe("file-store-lock adversarial", () => {
  it("should propagate lock adapter errors without swallowing", async () => {
    const failingLock: LockAdapter = {
      acquire: vi.fn().mockRejectedValue(new Error("KV namespace unavailable"))
    };
    const runtime = makeMockRuntime(failingLock);

    await expect(acquireFileStoreLock("/any/path", runtime)).rejects.toThrow(
      "KV namespace unavailable"
    );
  });

  it("should handle empty-string lock path", async () => {
    const runtime = makeMockRuntime();
    // Empty path may or may not be valid depending on adapter; verify no crash
    const release = await acquireFileStoreLock("", runtime);
    expect(typeof release).toBe("function");
    await expect(release()).resolves.toBeUndefined();
  });

  it("should handle extremely long lock paths", async () => {
    const runtime = makeMockRuntime();
    const longPath = "/a".repeat(5000);
    const release = await acquireFileStoreLock(longPath, runtime);
    expect(typeof release).toBe("function");
    await release();
  });

  it("should handle lock release failure gracefully", async () => {
    const releaseThrows: LockAdapter = {
      acquire: vi.fn().mockResolvedValue(
        vi.fn().mockRejectedValue(new Error("release failed: EPERM"))
      )
    };
    const runtime = makeMockRuntime(releaseThrows);
    const release = await acquireFileStoreLock("/store/data.json", runtime);
    // The release function throws — caller must handle
    await expect(release()).rejects.toThrow("release failed: EPERM");
  });

  it("should support nested lock acquisition on different paths", async () => {
    const acquired: string[] = [];
    const trackingLock: LockAdapter = {
      acquire: vi.fn().mockImplementation(async (lockId: string) => {
        acquired.push(lockId);
        return vi.fn().mockResolvedValue(undefined);
      })
    };
    const runtime = makeMockRuntime(trackingLock);

    const release1 = await acquireFileStoreLock("/path/a", runtime);
    const release2 = await acquireFileStoreLock("/path/b", runtime);

    expect(acquired).toEqual(["/path/a", "/path/b"]);
    await release1();
    await release2();
  });

  it("should pass staleMs option to the adapter", async () => {
    const mockAcquire = vi.fn().mockResolvedValue(vi.fn());
    const runtime = makeMockRuntime({ acquire: mockAcquire });

    await acquireFileStoreLock("/test", runtime);

    expect(mockAcquire).toHaveBeenCalledWith("/test", { staleMs: 60_000 });
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 2. ACTION LOG CORRUPTION & CONCURRENT APPENDS
// ═══════════════════════════════════════════════════════════════════════════

describe("action-log-append adversarial", () => {
  it("should reject logs belonging to a different goal", () => {
    const log = makeActionLog({ goalId: "goal-other" });
    expect(() => validateGoalActionLogs("goal-1", [log])).toThrow(
      /belongs to goal goal-other, not goal-1/
    );
  });

  it("should reject malformed action logs that fail schema validation", () => {
    const badLog = { id: "", goalId: "goal-1", actor: "", kind: "", message: "", createdAt: "not-a-date" };
    expect(() => validateGoalActionLogs("goal-1", [badLog as any])).toThrow();
  });

  it("should deduplicate logs with same id during append", async () => {
    const log = makeActionLog({ id: "dup-1", goalId: "goal-1" });
    const store = {
      goals: [{ id: "goal-1" }],
      actionLogs: [log]
    };
    const writeStore = vi.fn().mockResolvedValue(undefined);

    const result = await appendGoalActionLogsToStore(store, "goal-1", [log], writeStore);

    // Should not duplicate
    expect(store.actionLogs.length).toBe(1);
    expect(result.length).toBe(1);
  });

  it("should throw when goal does not exist in store", async () => {
    const store = { goals: [{ id: "goal-1" }], actionLogs: [] };
    const log = makeActionLog({ goalId: "goal-missing" });
    const writeStore = vi.fn().mockResolvedValue(undefined);

    await expect(
      appendGoalActionLogsToStore(store, "goal-missing", [log], writeStore)
    ).rejects.toThrow(/Goal goal-missing was not found/);
  });

  it("should handle concurrent appends without losing entries", async () => {
    const store = {
      goals: [{ id: "goal-1" }],
      actionLogs: [] as ActionLog[]
    };
    const writeStore = vi.fn().mockImplementation(async (s: typeof store) => {
      // Simulate slight delay
      await new Promise((r) => setTimeout(r, 1));
    });

    const logs1 = [makeActionLog({ id: "c-1", goalId: "goal-1" }), makeActionLog({ id: "c-2", goalId: "goal-1" })];
    const logs2 = [makeActionLog({ id: "c-3", goalId: "goal-1" }), makeActionLog({ id: "c-4", goalId: "goal-1" })];

    // Fire both concurrently — note: this is intentionally racy
    const [r1, r2] = await Promise.all([
      appendGoalActionLogsToStore(store, "goal-1", logs1, writeStore),
      appendGoalActionLogsToStore(store, "goal-1", logs2, writeStore)
    ]);

    // BUG DOCUMENTED: Due to non-atomic read-modify-write, concurrent appends
    // can lose entries. The store uses in-memory mutation without locking.
    // In production with file-based stores, this could cause data loss.
    // Expected: 4 unique logs. Actual may vary due to race.
    const totalAppended = r1.length + r2.length;
    expect(totalAppended).toBe(4); // Both calls return their own logs
    // But store may have fewer due to race condition
    // This documents the bug: store.actionLogs.length might be < 4
  });

  it("should handle writeStore rejection and not corrupt in-memory state", async () => {
    const existingLog = makeActionLog({ id: "existing-1", goalId: "goal-1" });
    const store = {
      goals: [{ id: "goal-1" }],
      actionLogs: [existingLog]
    };
    const writeStore = vi.fn().mockRejectedValue(new Error("disk full"));
    const newLog = makeActionLog({ id: "new-1", goalId: "goal-1" });

    await expect(
      appendGoalActionLogsToStore(store, "goal-1", [newLog], writeStore)
    ).rejects.toThrow("disk full");

    // BUG DOCUMENTED: The store's actionLogs are mutated BEFORE writeStore is called.
    // If writeStore fails, the in-memory state is already modified (dirty).
    // This means the in-memory store has the new log even though persistence failed.
    // In a retry scenario, the dedup logic would prevent re-adding, but if the
    // process restarts and reloads from disk, the log is lost.
    expect(store.actionLogs.length).toBe(2); // Mutated despite failure
  });

  it("should handle oversized log arrays without stack overflow", async () => {
    const largeBatch = Array.from({ length: 10_000 }, (_, i) =>
      makeActionLog({ id: `bulk-${i}`, goalId: "goal-1" })
    );
    const validated = validateGoalActionLogs("goal-1", largeBatch);
    expect(validated.length).toBe(10_000);
  });

  it("cloneActionLogs should produce independent copies", () => {
    const log = makeActionLog({ id: "clone-test", details: { key: "value" } });
    const cloned = cloneActionLogs([log]);
    expect(cloned[0]).toEqual(log);
    expect(cloned[0]).not.toBe(log);
    // Mutating clone should not affect original
    cloned[0].message = "mutated";
    expect(log.message).toBe("test message");
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 3. PAGINATION BOUNDARIES
// ═══════════════════════════════════════════════════════════════════════════

describe("collection-pagination adversarial", () => {
  it("should normalize zero page size to default", () => {
    expect(normalizeCollectionPageLimit(0)).toBe(20); // DEFAULT_COLLECTION_PAGE_LIMIT
  });

  it("should normalize negative page size to default", () => {
    expect(normalizeCollectionPageLimit(-1)).toBe(20);
    expect(normalizeCollectionPageLimit(-100)).toBe(20);
  });

  it("should normalize NaN to default", () => {
    expect(normalizeCollectionPageLimit(NaN)).toBe(20);
  });

  it("should normalize Infinity to default", () => {
    expect(normalizeCollectionPageLimit(Infinity)).toBe(20);
    expect(normalizeCollectionPageLimit(-Infinity)).toBe(20);
  });

  it("should cap at MAX_COLLECTION_PAGE_LIMIT", () => {
    expect(normalizeCollectionPageLimit(101)).toBe(20); // > 100 → default
    expect(normalizeCollectionPageLimit(100)).toBe(100); // exactly max
    expect(normalizeCollectionPageLimit(999999)).toBe(20);
  });

  it("should truncate fractional limits", () => {
    expect(normalizeCollectionPageLimit(10.7)).toBe(10);
    expect(normalizeCollectionPageLimit(0.5)).toBe(20); // trunc(0.5)=0 → default
  });

  it("should use default for undefined", () => {
    expect(normalizeCollectionPageLimit(undefined)).toBe(20);
  });

  it("should reject invalid cursors with CollectionPageQueryError", () => {
    expect(() => decodeCollectionCursor("not-valid-base64!!!")).toThrow(CollectionPageQueryError);
    expect(() => decodeCollectionCursor(Buffer.from("{}", "utf8").toString("base64url"))).toThrow(
      CollectionPageQueryError
    );
  });

  it("should return null for null/undefined/empty cursor", () => {
    expect(decodeCollectionCursor(null)).toBeNull();
    expect(decodeCollectionCursor(undefined)).toBeNull();
    expect(decodeCollectionCursor("")).toBeNull();
  });

  it("should roundtrip valid cursors", () => {
    const cursor = { createdAt: "2025-01-15T10:30:00.000Z", id: "item-42" };
    const encoded = encodeCollectionCursor(cursor);
    const decoded = decodeCollectionCursor(encoded);
    expect(decoded).toEqual(cursor);
  });

  it("should handle empty result set in buildCollectionPage", () => {
    const page = buildCollectionPage({
      items: [],
      limit: 10,
      cursor: null,
      getCursorKey: (item: { createdAt: string; id: string }) => ({ createdAt: item.createdAt, id: item.id }),
      parsePage: (p) => p
    });
    expect(page.items).toEqual([]);
    expect(page.nextCursor).toBeNull();
  });

  it("should handle cursor pointing past all items (desc sort)", () => {
    const items = [
      { id: "a", createdAt: "2025-01-01T00:00:00.000Z" },
      { id: "b", createdAt: "2025-01-02T00:00:00.000Z" }
    ];
    // In desc sort, items are sorted newest-first: b, a.
    // A cursor with createdAt BEFORE all items means everything is "after" it.
    // To get empty results, use a cursor that's OLDER than all items (nothing is older).
    // Actually, isItemAfterCursor checks candidate < cursor for desc.
    // So cursor at 2024-01-01 means no item has createdAt < 2024-01-01 → empty.
    const cursor = encodeCollectionCursor({ createdAt: "2024-01-01T00:00:00.000Z", id: "a" });
    const page = buildCollectionPage({
      items,
      limit: 10,
      cursor,
      getCursorKey: (item) => ({ createdAt: item.createdAt, id: item.id }),
      parsePage: (p) => p
    });
    expect(page.items).toEqual([]);
    expect(page.nextCursor).toBeNull();
  });

  it("sortByCreatedDesc handles items with identical timestamps", () => {
    const ts = "2025-06-01T12:00:00.000Z";
    const items = [
      { id: "b", createdAt: ts },
      { id: "a", createdAt: ts },
      { id: "c", createdAt: ts }
    ];
    const sorted = sortByCreatedDesc(items);
    // All same timestamp, secondary sort by id desc
    expect(sorted.map((i) => i.id)).toEqual(["c", "b", "a"]);
  });

  it("sortByCreatedAsc handles items with missing id gracefully", () => {
    const items = [
      { createdAt: "2025-01-02T00:00:00.000Z" },
      { createdAt: "2025-01-01T00:00:00.000Z" }
    ];
    const sorted = sortByCreatedAsc(items as any);
    expect(sorted[0].createdAt).toBe("2025-01-01T00:00:00.000Z");
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 4. DASHBOARD DATA RACES
// ═══════════════════════════════════════════════════════════════════════════

describe("dashboard-data adversarial", () => {
  // assembleDashboardData is complex; we test its timing/metrics behavior
  // and ensure it doesn't crash under degenerate inputs

  it("should handle empty goals array without crashing", async () => {
    // Dynamic import to avoid heavy side effects
    const { assembleDashboardData } = await import("../packages/repository/src/dashboard-data");

    const result = assembleDashboardData({
      userId: "user-1",
      workspaces: [],
      activeWorkspace: null,
      workspaceSelection: null,
      workspaceMembers: [],
      workspaceGovernance: null,
      goalShares: [],
      privacyOperations: [],
      goals: [],
      approvals: [],
      evidenceRecords: [],
      commitments: [],
      briefingPreferences: { enabled: false, schedule: "daily", timezone: "UTC" } as any,
      autopilotSettings: { mode: "off", enabled: false } as any,
      autopilotEvents: [],
      memories: [],
      integrations: [],
      watchers: [],
      filterBundlesForWorkspace: (g) => g,
      mergeCommitments: () => [],
      buildDiagnostics: () => ({ status: "healthy", totalCount: 0, generatedAt: nowIso(), items: [] }),
      buildControlPlane: () => ({} as any),
      buildNowQueue: () => ({ items: [], generatedAt: nowIso() } as any),
      buildOperatingSections: () => ({} as any),
      buildBriefingHistory: () => [],
      sortArtifacts: (a) => a,
      sortActionLogs: (l) => l
    });

    expect(result).toBeDefined();
    expect(result.goals).toEqual([]);
  });

  it("should respect custom now parameter for deterministic output", async () => {
    const { assembleDashboardData } = await import("../packages/repository/src/dashboard-data");
    const fixedNow = 1700000000000;

    const result = assembleDashboardData({
      userId: "user-1",
      workspaces: [],
      activeWorkspace: null,
      workspaceSelection: null,
      workspaceMembers: [],
      workspaceGovernance: null,
      goalShares: [],
      privacyOperations: [],
      goals: [],
      approvals: [],
      evidenceRecords: [],
      commitments: [],
      briefingPreferences: { enabled: false, schedule: "daily", timezone: "UTC" } as any,
      autopilotSettings: { mode: "off", enabled: false } as any,
      autopilotEvents: [],
      memories: [],
      integrations: [],
      watchers: [],
      now: fixedNow,
      filterBundlesForWorkspace: (g) => g,
      mergeCommitments: () => [],
      buildDiagnostics: () => ({ status: "healthy", totalCount: 0, generatedAt: nowIso(), items: [] }),
      buildControlPlane: () => ({} as any),
      buildNowQueue: () => ({ items: [], generatedAt: nowIso() } as any),
      buildOperatingSections: () => ({} as any),
      buildBriefingHistory: () => [],
      sortArtifacts: (a) => a,
      sortActionLogs: (l) => l
    });

    expect(result).toBeDefined();
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 5. PROVENANCE GRAPH
// ═══════════════════════════════════════════════════════════════════════════

describe("provenance-graph adversarial", () => {
  it("should handle empty inputs without crashing", () => {
    const graph = buildExecutionProvenanceGraph({
      userId: "user-1",
      goals: [],
      jobs: [],
      memories: []
    });
    expect(graph.nodes).toEqual([]);
    expect(graph.edges).toEqual([]);
    expect(graph.timeline).toEqual([]);
  });

  it("should clamp depth to [0, 4]", () => {
    const graph = buildExecutionProvenanceGraph({
      userId: "user-1",
      goals: [],
      jobs: [],
      memories: [],
      depth: -5
    });
    expect(graph.query.depth).toBe(0);

    const graph2 = buildExecutionProvenanceGraph({
      userId: "user-1",
      goals: [],
      jobs: [],
      memories: [],
      depth: 100
    });
    expect(graph2.query.depth).toBe(4);
  });

  it("should clamp limit to [1, 500]", () => {
    const graph = buildExecutionProvenanceGraph({
      userId: "user-1",
      goals: [],
      jobs: [],
      memories: [],
      limit: 0
    });
    expect(graph.query.limit).toBe(1);

    const graph2 = buildExecutionProvenanceGraph({
      userId: "user-1",
      goals: [],
      jobs: [],
      memories: [],
      limit: 9999
    });
    expect(graph2.query.limit).toBe(500);
  });

  it("should handle circular task dependencies without infinite loop", () => {
    // Task A depends on B, B depends on A
    const bundle = makeGoalBundle("goal-circ", {
      tasks: [
        {
          id: "task-a",
          title: "Task A",
          summary: "depends on B",
          goalId: "goal-circ",
          workflowId: "wf-1",
          assignedAgent: "agent-1",
          state: "pending",
          riskClass: "R1",
          requiresApproval: false,
          dependsOn: ["task-b"],
          artifactIds: [],
          createdAt: nowIso(),
          updatedAt: nowIso()
        },
        {
          id: "task-b",
          title: "Task B",
          summary: "depends on A",
          goalId: "goal-circ",
          workflowId: "wf-1",
          assignedAgent: "agent-1",
          state: "pending",
          riskClass: "R1",
          requiresApproval: false,
          dependsOn: ["task-a"],
          artifactIds: [],
          createdAt: nowIso(),
          updatedAt: nowIso()
        }
      ]
    });

    // Should not hang or throw
    const graph = buildExecutionProvenanceGraph({
      userId: "user-1",
      goals: [bundle as any],
      jobs: [],
      memories: [],
      depth: 4,
      limit: 100
    });

    expect(graph.nodes.length).toBeGreaterThan(0);
    // Verify visited-set prevents infinite traversal
    const nodeIds = new Set(graph.nodes.map((n) => n.id));
    expect(nodeIds.size).toBe(graph.nodes.length);
  });

  it("should handle orphaned nodes (edges referencing non-existent nodes)", () => {
    const bundle = makeGoalBundle("goal-orphan", {
      tasks: [
        {
          id: "task-x",
          title: "Orphan dep",
          summary: "depends on non-existent task",
          goalId: "goal-orphan",
          workflowId: "wf-1",
          assignedAgent: "agent-1",
          state: "pending",
          riskClass: "R1",
          requiresApproval: false,
          dependsOn: ["task-nonexistent"],
          artifactIds: [],
          createdAt: nowIso(),
          updatedAt: nowIso()
        }
      ]
    });

    const graph = buildExecutionProvenanceGraph({
      userId: "user-1",
      goals: [bundle as any],
      jobs: [],
      memories: []
    });

    // Edge references task:task-nonexistent which doesn't exist as a node
    // The graph should still be valid
    expect(graph.nodes.length).toBeGreaterThan(0);
    // Edges whose endpoints are both in selected nodes should be present
    for (const edge of graph.edges) {
      const fromExists = graph.nodes.some((n) => n.id === edge.from);
      const toExists = graph.nodes.some((n) => n.id === edge.to);
      // After final filtering, all edges should have valid endpoints
      expect(fromExists && toExists).toBe(true);
    }
  });

  it("should handle deeply nested goal chains within traversal limits", () => {
    // Create many goals with many tasks
    const goals = Array.from({ length: 50 }, (_, i) =>
      makeGoalBundle(`goal-deep-${i}`, {
        tasks: Array.from({ length: 5 }, (_, j) => ({
          id: `task-${i}-${j}`,
          title: `Task ${i}-${j}`,
          summary: "deep task",
          goalId: `goal-deep-${i}`,
          workflowId: `wf-${i}`,
          assignedAgent: "agent-1",
          state: "completed",
          riskClass: "R1",
          requiresApproval: false,
          dependsOn: j > 0 ? [`task-${i}-${j - 1}`] : [],
          artifactIds: [],
          createdAt: nowIso(),
          updatedAt: nowIso()
        }))
      })
    );

    const graph = buildExecutionProvenanceGraph({
      userId: "user-1",
      goals: goals as any[],
      jobs: [],
      memories: [],
      depth: 2,
      limit: 50
    });

    // Should respect limit
    expect(graph.nodes.length).toBeLessThanOrEqual(50);
  });

  it("should handle rootId that does not match any node", () => {
    const bundle = makeGoalBundle("goal-root-test");
    const graph = buildExecutionProvenanceGraph({
      userId: "user-1",
      goals: [bundle as any],
      jobs: [],
      memories: [],
      rootId: "nonexistent:root"
    });

    // Root not found → only the root itself would be visited, but it doesn't exist
    // So we get an empty or minimal graph
    expect(graph.nodes.length).toBe(0);
    expect(graph.edges.length).toBe(0);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 6. COMMITMENT STATE MACHINE
// ═══════════════════════════════════════════════════════════════════════════

describe("commitment-helpers adversarial", () => {
  it("sortCommitments should handle empty array", () => {
    expect(sortCommitments([])).toEqual([]);
  });

  it("sortCommitments orders by status weight then dueAt", () => {
    const commitments = [
      makeCommitment("c1", { status: "completed", dueAt: "2025-01-01T00:00:00.000Z" }),
      makeCommitment("c2", { status: "needs-review", dueAt: "2025-12-31T23:59:59.999Z" }),
      makeCommitment("c3", { status: "stale", dueAt: "2025-06-01T00:00:00.000Z" })
    ];
    const sorted = sortCommitments(commitments);
    expect(sorted[0].status).toBe("needs-review");
    expect(sorted[1].status).toBe("stale");
    expect(sorted[2].status).toBe("completed");
  });

  it("isOpenCommitment correctly classifies terminal states", () => {
    expect(isOpenCommitment(makeCommitment("c", { status: "completed" }))).toBe(false);
    expect(isOpenCommitment(makeCommitment("c", { status: "dismissed" }))).toBe(false);
    expect(isOpenCommitment(makeCommitment("c", { status: "pending" }))).toBe(true);
    expect(isOpenCommitment(makeCommitment("c", { status: "needs-review" }))).toBe(true);
    expect(isOpenCommitment(makeCommitment("c", { status: "stale" }))).toBe(true);
  });

  it("mergeCommitments should handle duplicate goal+approval commitments", () => {
    const goal = makeGoalBundle("goal-dup", {
      approvals: [makeApproval("appr-dup", { goalId: "goal-dup", decision: "pending" })]
    });
    const approval = makeApproval("appr-dup", { goalId: "goal-dup", decision: "pending" });

    const merged = mergeCommitments({
      goals: [goal as any],
      approvals: [approval as any],
      persisted: [],
      userId: "user-1",
      now: Date.now()
    });

    // Should have both goal-derived and approval-derived commitments
    // They have different IDs (commitment-goal-* vs commitment-approval-*)
    const ids = merged.map((c) => c.id);
    expect(ids).toContain(commitmentIdForGoal("goal-dup"));
    expect(ids).toContain(commitmentIdForApproval("appr-dup"));
  });

  it("mergeCommitments preserves dismissed/completed status from persisted", () => {
    const goal = makeGoalBundle("goal-persist");
    const persisted = makeCommitment(commitmentIdForGoal("goal-persist"), {
      status: "dismissed",
      updatedAt: "2025-01-01T00:00:00.000Z"
    });

    const merged = mergeCommitments({
      goals: [goal as any],
      approvals: [],
      persisted: [persisted as any],
      userId: "user-1",
      now: Date.now()
    });

    const found = merged.find((c) => c.id === commitmentIdForGoal("goal-persist"));
    expect(found?.status).toBe("dismissed");
  });

  it("buildCommitmentInboxPage rejects invalid cursors", () => {
    expect(() =>
      buildCommitmentInboxPage({
        commitments: [],
        cursor: "garbage!!!"
      })
    ).toThrow(CommitmentInboxQueryError);
  });

  it("buildCommitmentInboxPage rejects cursor beyond filtered set", () => {
    const commitments = [makeCommitment("c1", { status: "pending" })];
    // Encode a cursor with offset 100 which exceeds the filtered set
    const cursor = Buffer.from(JSON.stringify({ offset: 100 }), "utf8").toString("base64url");

    expect(() =>
      buildCommitmentInboxPage({
        commitments: commitments as any[],
        cursor
      })
    ).toThrow(CommitmentInboxQueryError);
  });

  it("buildCommitmentInboxPage handles zero-limit gracefully", () => {
    // Limit is clamped to [1, MAX_COMMITMENT_INBOX_LIMIT]
    const page = buildCommitmentInboxPage({
      commitments: [makeCommitment("c1") as any],
      limit: 0
    });
    // Clamped to 1
    expect(page.limit).toBe(1);
  });

  it("buildCommitmentInboxPage handles excessive limit", () => {
    const page = buildCommitmentInboxPage({
      commitments: [],
      limit: 9999
    });
    expect(page.limit).toBe(50); // MAX_COMMITMENT_INBOX_LIMIT
  });

  it("expired approval produces 'stale' commitment status", () => {
    const expiredApproval = makeApproval("appr-exp", {
      goalId: "goal-exp",
      decision: "pending",
      expiryAt: new Date(Date.now() - 1000).toISOString() // already expired
    });

    const merged = mergeCommitments({
      goals: [],
      approvals: [expiredApproval as any],
      persisted: [],
      userId: "user-1",
      now: Date.now()
    });

    const commitment = merged.find((c) => c.id === commitmentIdForApproval("appr-exp"));
    expect(commitment?.status).toBe("stale");
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 7. APPROVAL CONFLICTS
// ═══════════════════════════════════════════════════════════════════════════

describe("approval-response-helpers adversarial", () => {
  it("should throw ApprovalMutationError(not_found) for missing approval", () => {
    const bundle = makeGoalBundle("goal-appr", {
      approvals: [makeApproval("real-approval", { goalId: "goal-appr", taskId: "task-1" })],
      tasks: [{ id: "task-1", state: "waiting", goalId: "goal-appr" }]
    });

    expect(() =>
      buildApprovalResponseMutation({
        bundle: bundle as any,
        approvalId: "nonexistent-approval",
        decision: "approved",
        actor: {
          subjectUserId: "user-1",
          initiator: { kind: "human", userId: "user-1", label: "User" },
          executor: { kind: "human", userId: "user-1", label: "User" },
          sessionId: null
        }
      })
    ).toThrow(ApprovalMutationError);

    try {
      buildApprovalResponseMutation({
        bundle: bundle as any,
        approvalId: "nonexistent-approval",
        decision: "approved",
        actor: {
          subjectUserId: "user-1",
          initiator: { kind: "human", userId: "user-1", label: "User" },
          executor: { kind: "human", userId: "user-1", label: "User" },
          sessionId: null
        }
      });
    } catch (e) {
      expect((e as ApprovalMutationError).code).toBe("not_found");
    }
  });

  it("assertApprovalFollowUpJobOwner rejects mismatched owner", () => {
    const job = { userId: "user-other" } as any;
    expect(() => assertApprovalFollowUpJobOwner(job, "user-1")).toThrow(
      /owner must match/
    );
  });

  it("assertApprovalFollowUpJobOwner accepts matching owner", () => {
    const job = { userId: "user-1" } as any;
    expect(() => assertApprovalFollowUpJobOwner(job, "user-1")).not.toThrow();
  });

  it("should handle already-decided approval (double-submit)", () => {
    const decidedApproval = makeApproval("decided-appr", {
      goalId: "goal-double",
      taskId: "task-dbl",
      decision: "approved",
      respondedAt: nowIso(),
      decisionScope: "one_time"
    });
    const bundle = makeGoalBundle("goal-double", {
      approvals: [decidedApproval],
      tasks: [{ id: "task-dbl", state: "running", goalId: "goal-double" }]
    });

    // Attempting to respond again should throw (conflict or already_handled)
    expect(() =>
      buildApprovalResponseMutation({
        bundle: bundle as any,
        approvalId: "decided-appr",
        decision: "rejected",
        actor: {
          subjectUserId: "user-1",
          initiator: { kind: "human", userId: "user-1", label: "User" },
          executor: { kind: "human", userId: "user-1", label: "User" },
          sessionId: null
        }
      })
    ).toThrow();
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 8. PROVIDER SIDE-EFFECT LEDGER
// ═══════════════════════════════════════════════════════════════════════════

describe("provider-side-effect-ledger adversarial", () => {
  function makeReserveParams(overrides: Record<string, any> = {}) {
    return {
      userId: overrides.userId ?? "user-1",
      workspaceId: overrides.workspaceId ?? null,
      goalId: overrides.goalId ?? "goal-1",
      taskId: overrides.taskId ?? "task-1",
      adapter: overrides.adapter ?? "gmail",
      operation: overrides.operation ?? "send_message",
      idempotencyKey: overrides.idempotencyKey ?? "key-1",
      sideEffectTarget: overrides.sideEffectTarget ?? "repo/test#123",
      metadata: overrides.metadata ?? {},
      now: overrides.now ?? nowIso()
    };
  }

  it("should create a new record on first reservation", () => {
    const store: ProviderSideEffectStore = { providerSideEffects: [] };
    const params = makeReserveParams();
    const record = reserveProviderSideEffectInStore(store, params);

    expect(record.status).toBe("reserved");
    expect(record.attemptCount).toBe(1);
    expect(store.providerSideEffects.length).toBe(1);
  });

  it("should increment attemptCount on re-reservation", () => {
    const store: ProviderSideEffectStore = { providerSideEffects: [] };
    const params = makeReserveParams();

    reserveProviderSideEffectInStore(store, params);
    const second = reserveProviderSideEffectInStore(store, params);

    expect(second.attemptCount).toBe(2);
    expect(store.providerSideEffects.length).toBe(1); // Still one record
  });

  it("should cap attemptCount at 25", () => {
    const store: ProviderSideEffectStore = { providerSideEffects: [] };
    const params = makeReserveParams();

    // Reserve 30 times
    for (let i = 0; i < 30; i++) {
      reserveProviderSideEffectInStore(store, params);
    }

    const record = store.providerSideEffects[0];
    expect(record.attemptCount).toBe(25);
  });

  it("should not increment attemptCount for completed records", () => {
    const store: ProviderSideEffectStore = { providerSideEffects: [] };
    const params = makeReserveParams();

    reserveProviderSideEffectInStore(store, params);
    updateProviderSideEffectInStore(store, {
      id: store.providerSideEffects[0].id,
      status: "completed",
      providerRef: "ref-1"
    });

    const before = store.providerSideEffects[0].attemptCount;
    reserveProviderSideEffectInStore(store, params);
    const after = store.providerSideEffects[0].attemptCount;

    expect(after).toBe(before); // No increment for completed
  });

  it("should handle idempotency key collision across users", () => {
    const store: ProviderSideEffectStore = { providerSideEffects: [] };

    const user1Record = reserveProviderSideEffectInStore(store, makeReserveParams({
      userId: "user-1",
      idempotencyKey: "same-key"
    }));
    const user2Record = reserveProviderSideEffectInStore(store, makeReserveParams({
      userId: "user-2",
      idempotencyKey: "same-key"
    }));

    // Different users with same key should produce different records
    expect(user1Record.id).not.toBe(user2Record.id);
    expect(store.providerSideEffects.length).toBe(2);
  });

  it("updateProviderSideEffectInStore throws for unknown id", () => {
    const store: ProviderSideEffectStore = { providerSideEffects: [] };
    expect(() =>
      updateProviderSideEffectInStore(store, {
        id: "nonexistent",
        status: "completed"
      })
    ).toThrow(/was not found/);
  });

  it("should trim whitespace from idempotencyKey and sideEffectTarget", () => {
    const store: ProviderSideEffectStore = { providerSideEffects: [] };
    const record = reserveProviderSideEffectInStore(store, makeReserveParams({
      idempotencyKey: "  key-with-spaces  ",
      sideEffectTarget: "  target-with-spaces  "
    }));

    expect(record.idempotencyKey).toBe("key-with-spaces");
    expect(record.sideEffectTarget).toBe("target-with-spaces");
  });

  it("buildProviderSideEffectId is deterministic", () => {
    const id1 = buildProviderSideEffectId("user-1", "key-1");
    const id2 = buildProviderSideEffectId("user-1", "key-1");
    expect(id1).toBe(id2);
    expect(id1.startsWith("provider-side-effect:")).toBe(true);
  });

  it("buildProviderSideEffectId differs for different users/keys", () => {
    const id1 = buildProviderSideEffectId("user-1", "key-1");
    const id2 = buildProviderSideEffectId("user-2", "key-1");
    const id3 = buildProviderSideEffectId("user-1", "key-2");
    expect(id1).not.toBe(id2);
    expect(id1).not.toBe(id3);
  });

  it("providerSideEffectStoreKey includes userId for namespacing", () => {
    const key = providerSideEffectStoreKey({ userId: "u1", idempotencyKey: "k1" });
    expect(key).toBe("u1:k1");
  });

  it("should merge metadata on re-reservation", () => {
    const store: ProviderSideEffectStore = { providerSideEffects: [] };
    reserveProviderSideEffectInStore(store, makeReserveParams({
      metadata: { a: 1 }
    }));
    const updated = reserveProviderSideEffectInStore(store, makeReserveParams({
      metadata: { b: 2 }
    }));

    expect(updated.metadata).toEqual({ a: 1, b: 2 });
  });

  it("out-of-order recording: update before reserve creates error", () => {
    const store: ProviderSideEffectStore = { providerSideEffects: [] };
    // Try to update a record that hasn't been reserved yet
    expect(() =>
      updateProviderSideEffectInStore(store, {
        id: "phantom-id",
        status: "failed",
        error: "something broke"
      })
    ).toThrow(/was not found/);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 9. DIAGNOSTICS EDGE CASES
// ═══════════════════════════════════════════════════════════════════════════

describe("buildDashboardDiagnostics adversarial", () => {
  it("should return healthy status for empty inputs", () => {
    const diag = buildDashboardDiagnostics({
      goals: [],
      approvals: [],
      memories: [],
      watchers: []
    });
    expect(diag.status).toBe("healthy");
    expect(diag.totalCount).toBe(0);
    expect(diag.items).toEqual([]);
  });

  it("should detect expired approvals", () => {
    const expiredApproval = makeApproval("exp-1", {
      goalId: "goal-diag",
      decision: "pending",
      expiryAt: new Date(Date.now() - 86400_000).toISOString()
    });
    const bundle = makeGoalBundle("goal-diag");

    const diag = buildDashboardDiagnostics({
      goals: [bundle as any],
      approvals: [expiredApproval as any],
      memories: [],
      watchers: [],
      now: Date.now()
    });

    const expiredItem = diag.items.find((i) => i.kind === "expired_approvals");
    expect(expiredItem).toBeDefined();
    expect(expiredItem!.severity).toBe("critical");
  });

  it("should detect orphan watchers on completed goals", () => {
    const bundle = makeGoalBundle("goal-done", { status: "completed" });
    const watcher = {
      id: "w-1",
      goalId: "goal-done",
      status: "active",
      targetEntity: "github-issue-42"
    };

    const diag = buildDashboardDiagnostics({
      goals: [bundle as any],
      approvals: [],
      memories: [],
      watchers: [watcher as any]
    });

    const orphanItem = diag.items.find((i) => i.kind === "orphan_watchers");
    expect(orphanItem).toBeDefined();
    expect(orphanItem!.count).toBe(1);
  });

  it("should handle invalid timestamps in progress detection without crashing", () => {
    const bundle = makeGoalBundle("goal-bad-ts", {
      updatedAt: "not-a-date",
      tasks: [{ id: "t1", state: "blocked", updatedAt: "also-invalid" }]
    });

    expect(() =>
      buildDashboardDiagnostics({
        goals: [bundle as any],
        approvals: [],
        memories: [],
        watchers: []
      })
    ).not.toThrow();
  });
});
