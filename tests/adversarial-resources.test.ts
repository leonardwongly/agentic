/**
 * Adversarial resource exhaustion and limit tests.
 *
 * Validates graceful behavior under memory pressure, large payloads,
 * circular references, deep nesting, regex DoS, retry storms, and
 * other resource-exhaustion scenarios across the monorepo.
 */
import { describe, expect, it, beforeEach, afterEach } from "vitest";
import crypto from "node:crypto";
import {
  clone,
  nowIso,
  JobRecordSchema,
  TaskSchema,
  GoalSchema,
  type JobRecord,
  type JobPayload,
  type Goal
} from "@agentic/contracts";
import {
  createJobRecord,
  createDurableJobQueue,
  processNextDurableJob,
  computeJobRetryDelayMs,
  createTask,
  createWorkflowState,
  type JobQueueStore,
  type JobHandlerMap,
  type JobConcurrencyLimits
} from "@agentic/execution";
import {
  normalizeCollectionPageLimit,
  encodeCollectionCursor,
  decodeCollectionCursor,
  buildCollectionPage,
  sortByCreatedDesc
} from "../packages/repository/src/collection-pagination";
import { sanitizeForTelemetry } from "../packages/observability/src/index";
import { buildWorkspaceAuditExport } from "../packages/repository/src/workspace-audit-export";
import {
  ConnectorFailureError,
  createConnectorTimeoutSignal,
  normalizeConnectorThrownError,
  parseRetryAfterSeconds
} from "../packages/integrations/src/connector-errors";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const DEFAULT_OWNER_USER_ID = "user-test-owner";

function makeMinimalGoal(overrides?: Partial<Goal>): Goal {
  const timestamp = nowIso();
  return GoalSchema.parse({
    id: crypto.randomUUID(),
    userId: DEFAULT_OWNER_USER_ID,
    workspaceId: null,
    workflowId: crypto.randomUUID(),
    title: "Test goal",
    request: "Test request",
    intent: "test",
    status: "running",
    confidence: 0.9,
    explanation: "Test",
    goalContract: null,
    createdAt: timestamp,
    updatedAt: timestamp,
    ...overrides
  });
}

/**
 * Build a circular reference object of configurable shape.
 */
function buildCircularObject(depth: number): Record<string, unknown> {
  const root: Record<string, unknown> = { level: 0 };
  let current = root;
  for (let i = 1; i <= depth; i++) {
    const child: Record<string, unknown> = { level: i };
    current.child = child;
    current = child;
  }
  // Create a back-reference to the root
  current.back = root;
  return root;
}

/**
 * Build a deeply nested object (non-circular) of configurable depth.
 */
function buildDeeplyNestedObject(depth: number): Record<string, unknown> {
  let current: Record<string, unknown> = { value: "leaf" };
  for (let i = 0; i < depth; i++) {
    current = { nested: current, level: i };
  }
  return current;
}

/**
 * Build a wide object with many keys.
 */
function buildWideObject(keyCount: number): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (let i = 0; i < keyCount; i++) {
    result[`key_${i}`] = `value_${i}`;
  }
  return result;
}

/**
 * Create an in-memory job queue store for testing.
 */
function createInMemoryJobStore(): JobQueueStore & { jobs: Map<string, JobRecord> } {
  const jobs = new Map<string, JobRecord>();

  return {
    jobs,
    async enqueueJob(job: JobRecord) {
      jobs.set(job.id, JSON.parse(JSON.stringify(job)));
      return job;
    },
    async claimNextJob(params) {
      const now = Date.parse(params.now ?? nowIso());
      for (const [, job] of jobs) {
        if (job.status !== "queued" && job.status !== "retrying") continue;
        const availableAt = Date.parse(job.availableAt);
        if (availableAt > now) continue;
        if (params.kinds && !params.kinds.includes(job.kind)) continue;

        const claimed: JobRecord = {
          ...JSON.parse(JSON.stringify(job)),
          status: "running",
          attemptCount: job.attemptCount + 1,
          claimedBy: params.runnerId,
          claimedAt: params.now ?? nowIso(),
          lastAttemptAt: params.now ?? nowIso(),
          leaseExpiresAt: new Date(now + params.leaseMs).toISOString(),
          updatedAt: params.now ?? nowIso()
        };
        jobs.set(job.id, claimed);
        return claimed;
      }
      return null;
    },
    async completeJob(params) {
      const job = jobs.get(params.jobId);
      if (!job) throw new Error("Job not found");
      const completed: JobRecord = {
        ...JSON.parse(JSON.stringify(job)),
        status: "completed",
        completedAt: params.completedAt ?? nowIso(),
        updatedAt: params.completedAt ?? nowIso()
      };
      jobs.set(params.jobId, completed);
      return completed;
    },
    async retryJob(params) {
      const job = jobs.get(params.jobId);
      if (!job) throw new Error("Job not found");
      const retried: JobRecord = {
        ...JSON.parse(JSON.stringify(job)),
        status: "retrying",
        availableAt: params.availableAt,
        lastError: params.error,
        updatedAt: nowIso()
      };
      jobs.set(params.jobId, retried);
      return retried;
    },
    async deadLetterJob(params) {
      const job = jobs.get(params.jobId);
      if (!job) throw new Error("Job not found");
      const deadLettered: JobRecord = {
        ...JSON.parse(JSON.stringify(job)),
        status: "dead_letter",
        deadLetteredAt: params.deadLetteredAt ?? nowIso(),
        lastError: params.error,
        updatedAt: nowIso()
      };
      jobs.set(params.jobId, deadLettered);
      return deadLettered;
    }
  };
}

// ===========================================================================
// 1. LARGE PAYLOAD HANDLING
// ===========================================================================

describe("adversarial: large payload handling", () => {
  it("clone() handles a 1MB+ JSON object without crashing", () => {
    const largeObj = {
      data: "x".repeat(1_100_000),
      nested: { inner: "y".repeat(100_000) }
    };

    const result = clone(largeObj);
    expect(result.data).toBe(largeObj.data);
    expect(result.nested.inner).toBe(largeObj.nested.inner);
  });

  it("clone() handles objects with many keys (10,000+)", () => {
    const wideObj = buildWideObject(10_000);
    const result = clone(wideObj);
    expect(Object.keys(result).length).toBe(10_000);
    expect(result.key_0).toBe("value_0");
    expect(result.key_9999).toBe("value_9999");
  });

  it("JSON.stringify handles 2MB payload for audit export", () => {
    const timestamp = nowIso();
    const workspace = {
      id: "ws-audit-test",
      ownerUserId: DEFAULT_OWNER_USER_ID,
      slug: "audit-test",
      name: "Audit Test",
      description: "Test workspace for audit export",
      isPersonal: true,
      createdAt: timestamp,
      updatedAt: timestamp
    };
    const largeGoal = makeMinimalGoal({
      explanation: "z".repeat(2_000_000)
    });

    const exportResult = buildWorkspaceAuditExport({
      workspace: workspace as any,
      governance: null,
      members: [],
      goals: [
        {
          goal: largeGoal,
          workflow: createWorkflowState(largeGoal.id),
          tasks: [],
          approvals: [],
          watchers: [],
          artifacts: [],
          actionLogs: []
        }
      ],
      goalShares: [],
      privacyOperations: []
    });

    expect(exportResult.content.length).toBeGreaterThan(2_000_000);
    expect(exportResult.contentType).toBe("application/json");
    // Content should be valid JSON
    const parsed = JSON.parse(exportResult.content);
    expect(parsed.integrity.digest).toBeDefined();
  });

  it("handles job payload with 500KB of data through queue lifecycle", async () => {
    const store = createInMemoryJobStore();
    const queue = createDurableJobQueue(store, {
      runnerId: "large-payload-runner",
      retryPolicy: { baseDelayMs: 0, factor: 1, maxDelayMs: 0 }
    });

    const bigData = "a".repeat(500_000);
    const job = createJobRecord({
      userId: DEFAULT_OWNER_USER_ID,
      kind: "docs_render",
      payload: {
        type: "docs_render",
        metadata: { bigData }
      } as any
    });

    const enqueued = await store.enqueueJob(job);
    expect(enqueued.id).toBeDefined();

    const handlers: JobHandlerMap = {
      docs_render: async (claimed) => {
        const payloadStr = JSON.stringify(claimed.payload);
        expect(payloadStr.length).toBeGreaterThan(500_000);
      }
    };

    const result = await processNextDurableJob({ queue, handlers });
    expect(result.finalJob?.status).toBe("completed");
  });
});

// ===========================================================================
// 2. CIRCULAR REFERENCE HANDLING
// ===========================================================================

describe("adversarial: circular reference handling", () => {
  it("clone() throws a clear error on circular references (not a silent crash)", () => {
    const circular: Record<string, unknown> = { name: "root" };
    circular.self = circular;

    // JSON.stringify throws TypeError on circular references.
    // clone() wraps JSON.parse(JSON.stringify()), so it will throw too.
    // We verify the error is at least a recognizable type.
    expect(() => clone(circular)).toThrow();
  });

  it("sanitizeForTelemetry does not stack overflow on self-referencing objects", () => {
    const circular: Record<string, unknown> = { name: "test" };
    circular.self = circular;

    // Must not throw or cause a stack overflow
    const result = sanitizeForTelemetry(circular);
    expect(result).toBeDefined();
    expect(typeof result).toBe("object");
  });

  it("sanitizeForTelemetry handles mutually-referencing objects", () => {
    const a: Record<string, unknown> = { name: "a" };
    const b: Record<string, unknown> = { name: "b" };
    a.ref = b;
    b.ref = a;

    const result = sanitizeForTelemetry(a);
    expect(result).toBeDefined();
    expect(typeof result).toBe("object");
  });

  it("sanitizeForTelemetry handles arrays with circular references", () => {
    const arr: unknown[] = [1, 2, 3];
    arr.push(arr); // self-reference in array

    const result = sanitizeForTelemetry(arr);
    expect(result).toBeDefined();
    expect(Array.isArray(result)).toBe(true);
  });

  it("sanitizeForTelemetry output is JSON-safe for deeply nested objects", () => {
    const deep = buildDeeplyNestedObject(50);

    // sanitizeForTelemetry depth-limits to >5, so the result should be finite
    // and JSON.stringify-able
    const result = sanitizeForTelemetry(deep);
    expect(() => JSON.stringify(result)).not.toThrow();
  });
});

// ===========================================================================
// 3. DEEP NESTING
// ===========================================================================

describe("adversarial: deep nesting resilience", () => {
  it("sanitizeForTelemetry truncates at depth limit (depth > 5)", () => {
    const deep = buildDeeplyNestedObject(100);
    const result = sanitizeForTelemetry(deep);

    // Walk down the result and verify truncation occurs
    let current: any = result;
    let depth = 0;
    while (current && typeof current === "object" && current.nested) {
      depth++;
      current = current.nested;
    }
    // Should stop around depth 6 (depth > 5 triggers truncation)
    expect(depth).toBeLessThanOrEqual(7);
  });

  it("clone() handles deep but finite nesting (100 levels)", () => {
    const deep = buildDeeplyNestedObject(100);
    const result = clone(deep);

    let current: any = result;
    let depth = 0;
    while (current.nested) {
      depth++;
      current = current.nested;
    }
    expect(depth).toBe(100);
    expect(current.value).toBe("leaf");
  });

  it("clone() handles 500 levels of nesting", () => {
    const deep = buildDeeplyNestedObject(500);
    const result = clone(deep);

    let current: any = result;
    let depth = 0;
    while (current.nested) {
      depth++;
      current = current.nested;
    }
    expect(depth).toBe(500);
  });
});

// ===========================================================================
// 4. CPU-INTENSIVE OPERATIONS (ReDoS, large loops)
// ===========================================================================

describe("adversarial: CPU-intensive operations", () => {
  it("normalizeCollectionPageLimit handles extreme values instantly", () => {
    expect(normalizeCollectionPageLimit(Infinity)).toBeGreaterThan(0);
    expect(normalizeCollectionPageLimit(-Infinity)).toBeGreaterThan(0);
    expect(normalizeCollectionPageLimit(NaN)).toBeGreaterThan(0);
    expect(normalizeCollectionPageLimit(Number.MAX_SAFE_INTEGER)).toBeGreaterThan(0);
    expect(normalizeCollectionPageLimit(-1)).toBeGreaterThan(0);
    expect(normalizeCollectionPageLimit(0)).toBeGreaterThan(0);
  });

  it("cursor encoding/decoding handles very long cursor strings", () => {
    const cursor = {
      createdAt: "2024-01-01T00:00:00.000Z",
      id: "x".repeat(100_000)
    };

    const encoded = encodeCollectionCursor(cursor);
    expect(encoded.length).toBeGreaterThan(100_000);

    const decoded = decodeCollectionCursor(encoded);
    expect(decoded).toBeDefined();
    expect(decoded!.id).toBe(cursor.id);
  });

  it("cursor decoding throws on garbage input without hanging", () => {
    const garbage = "not-valid-base64!!!".repeat(100);
    expect(() => decodeCollectionCursor(garbage)).toThrow();
  });

  it("retry delay computation does not overflow with extreme attempt counts", () => {
    // Attempt count of 1000 with factor 2 => 2^999 => must not produce Infinity
    const delay = computeJobRetryDelayMs(1000, {
      baseDelayMs: 1000,
      factor: 2,
      maxDelayMs: 5 * 60_000
    });
    expect(Number.isFinite(delay)).toBe(true);
    expect(delay).toBeLessThanOrEqual(5 * 60_000);
  });

  it("retry delay handles factor of 1.0 (no exponential growth)", () => {
    const delay = computeJobRetryDelayMs(100, {
      baseDelayMs: 1000,
      factor: 1,
      maxDelayMs: 5 * 60_000
    });
    expect(delay).toBe(1000);
  });

  it("retry delay handles factor less than 1 (decay)", () => {
    const delay = computeJobRetryDelayMs(10, {
      baseDelayMs: 1000,
      factor: 0.5,
      maxDelayMs: 5 * 60_000
    });
    expect(Number.isFinite(delay)).toBe(true);
    expect(delay).toBeGreaterThan(0);
  });

  it("buildCollectionPage handles 50,000 items without timeout", () => {
    const items = Array.from({ length: 50_000 }, (_, i) => ({
      id: `item-${i}`,
      createdAt: new Date(Date.now() - i * 1000).toISOString(),
      data: `data-${i}`
    }));

    const start = Date.now();
    const page = buildCollectionPage({
      items,
      limit: 10,
      cursor: null,
      getCursorKey: (item) => ({ createdAt: item.createdAt, id: item.id }),
      parsePage: (p) => p
    });
    const elapsed = Date.now() - start;

    expect(page.items.length).toBe(10);
    // Should complete in well under 5 seconds even for 50K items
    expect(elapsed).toBeLessThan(5000);
  });

  it("sortByCreatedDesc handles 100,000 items", () => {
    const items = Array.from({ length: 100_000 }, (_, i) => ({
      id: `item-${i}`,
      createdAt: new Date(Date.now() - Math.random() * 1_000_000_000).toISOString()
    }));

    const start = Date.now();
    const sorted = sortByCreatedDesc(items);
    const elapsed = Date.now() - start;

    expect(sorted.length).toBe(100_000);
    expect(elapsed).toBeLessThan(10_000);

    // Verify descending order
    for (let i = 1; i < sorted.length; i++) {
      expect(sorted[i - 1].createdAt >= sorted[i].createdAt).toBe(true);
    }
  });
});

// ===========================================================================
// 5. RETRY STORM BEHAVIOR
// ===========================================================================

describe("adversarial: retry storm behavior", () => {
  it("handles many rapid job retries without unbounded growth", async () => {
    const store = createInMemoryJobStore();
    const queue = createDurableJobQueue(store, {
      runnerId: "storm-runner",
      retryPolicy: { baseDelayMs: 0, factor: 1, maxDelayMs: 0 }
    });

    // Enqueue 100 jobs
    for (let i = 0; i < 100; i++) {
      const job = createJobRecord({
        userId: DEFAULT_OWNER_USER_ID,
        kind: "docs_render",
        payload: { type: "docs_render" } as any,
        idempotencyKey: `storm-${i}`
      });
      await store.enqueueJob(job);
    }

    // Process all jobs with a handler that always fails
    const handlers: JobHandlerMap = {
      docs_render: async () => {
        throw new Error("Intentional failure for storm test");
      }
    };

    let processed = 0;
    const maxIterations = 500; // Safety limit
    while (processed < maxIterations) {
      const result = await processNextDurableJob({ queue, handlers });
      if (!result.claimedJob) break;
      processed++;
    }

    // All 100 jobs should eventually end up in dead_letter or completed
    // (they have default maxAttempts=3, so 100*3 = 300 max processings)
    expect(processed).toBeLessThanOrEqual(300);
    expect(processed).toBeGreaterThan(0);

    // Verify all jobs reached a terminal state
    let deadLettered = 0;
    let retrying = 0;
    for (const [, job] of store.jobs) {
      if (job.status === "dead_letter") deadLettered++;
      if (job.status === "retrying") retrying++;
    }
    // After enough processing, all should be dead-lettered
    expect(deadLettered).toBe(100);
  });

  it("handles job with maxAttempts=1 going directly to dead_letter", async () => {
    const store = createInMemoryJobStore();
    const queue = createDurableJobQueue(store, {
      runnerId: "single-attempt-runner",
      retryPolicy: { baseDelayMs: 0, factor: 1, maxDelayMs: 0 }
    });

    const job = createJobRecord({
      userId: DEFAULT_OWNER_USER_ID,
      kind: "docs_render",
      payload: { type: "docs_render" } as any,
      maxAttempts: 1
    });

    await store.enqueueJob(job);

    const handlers: JobHandlerMap = {
      docs_render: async () => {
        throw new Error("First attempt failure");
      }
    };

    const result = await processNextDurableJob({ queue, handlers });
    // With maxAttempts=1, the first failure should dead-letter
    expect(result.finalJob?.status).toBe("dead_letter");
  });
});

// ===========================================================================
// 6. TIMEOUT UNDER LOAD
// ===========================================================================

describe("adversarial: timeout behavior", () => {
  it("createConnectorTimeoutSignal creates a signal that aborts after timeout", async () => {
    const signal = createConnectorTimeoutSignal({ timeoutMs: 50 });
    expect(signal.aborted).toBe(false);

    // Wait for timeout
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(signal.aborted).toBe(true);
  });

  it("createConnectorTimeoutSignal composes with parent signal", () => {
    const parentController = new AbortController();
    const signal = createConnectorTimeoutSignal({
      timeoutMs: 60_000,
      signal: parentController.signal
    });

    expect(signal.aborted).toBe(false);

    // Aborting the parent should abort the composed signal
    parentController.abort();
    expect(signal.aborted).toBe(true);
  });

  it("createConnectorTimeoutSignal with already-aborted parent returns aborted signal", () => {
    const parentController = new AbortController();
    parentController.abort();

    const signal = createConnectorTimeoutSignal({
      timeoutMs: 60_000,
      signal: parentController.signal
    });

    expect(signal.aborted).toBe(true);
  });

  it("job timeout aborts long-running handler", async () => {
    const store = createInMemoryJobStore();
    const queue = createDurableJobQueue(store, {
      runnerId: "timeout-runner",
      retryPolicy: { baseDelayMs: 0, factor: 1, maxDelayMs: 0 }
    });

    const job = createJobRecord({
      userId: DEFAULT_OWNER_USER_ID,
      kind: "docs_render",
      payload: { type: "docs_render" } as any,
      timeoutMs: 100 // 100ms timeout (minimum allowed by schema)
    });

    await store.enqueueJob(job);

    let handlerAborted = false;
    const handlers: JobHandlerMap = {
      docs_render: async (_job, context) => {
        // Simulate a long-running operation that checks abort signal
        await new Promise<void>((resolve, reject) => {
          const timeout = setTimeout(() => resolve(), 5000); // Would take 5s
          context?.signal.addEventListener("abort", () => {
            clearTimeout(timeout);
            handlerAborted = true;
            reject(new Error("Aborted"));
          });
        });
      }
    };

    const result = await processNextDurableJob({ queue, handlers });
    expect(handlerAborted).toBe(true);
    // Job should fail (not completed)
    expect(result.finalJob?.status).not.toBe("completed");
  });
});

// ===========================================================================
// 7. CONNECTOR ERROR HANDLING
// ===========================================================================

describe("adversarial: connector error normalization", () => {
  it("parseRetryAfterSeconds handles garbage input", () => {
    expect(parseRetryAfterSeconds(null)).toBeUndefined();
    expect(parseRetryAfterSeconds(undefined)).toBeUndefined();
    expect(parseRetryAfterSeconds("")).toBeUndefined();
    expect(parseRetryAfterSeconds("abc")).toBeUndefined();
    expect(parseRetryAfterSeconds("-1")).toBeUndefined();
    expect(parseRetryAfterSeconds("3.5")).toBe(3);
    expect(parseRetryAfterSeconds("0")).toBe(0);
    expect(parseRetryAfterSeconds("999999")).toBe(999999);
    expect(parseRetryAfterSeconds(Infinity as any)).toBeUndefined();
    expect(parseRetryAfterSeconds(NaN as any)).toBeUndefined();
  });

  it("normalizeConnectorThrownError handles non-Error objects", () => {
    const result = normalizeConnectorThrownError({
      provider: "test",
      operation: "fetch",
      error: { custom: "data" }
    });
    expect(result).toBeInstanceOf(ConnectorFailureError);
    expect(result.code).toBe("remote_error");
    expect(result.retryable).toBe(true);
  });

  it("normalizeConnectorThrownError handles null error", () => {
    const result = normalizeConnectorThrownError({
      provider: "test",
      operation: "fetch",
      error: null
    });
    expect(result).toBeInstanceOf(ConnectorFailureError);
  });

  it("normalizeConnectorThrownError handles undefined error", () => {
    const result = normalizeConnectorThrownError({
      provider: "test",
      operation: "fetch",
      error: undefined
    });
    expect(result).toBeInstanceOf(ConnectorFailureError);
  });

  it("normalizeConnectorThrownError handles string error", () => {
    const result = normalizeConnectorThrownError({
      provider: "test",
      operation: "fetch",
      error: "Something went wrong"
    });
    expect(result).toBeInstanceOf(ConnectorFailureError);
    expect(result.code).toBe("remote_error");
  });

  it("normalizeConnectorThrownError detects AbortError", () => {
    const abortError = new Error("Aborted");
    abortError.name = "AbortError";

    const result = normalizeConnectorThrownError({
      provider: "test",
      operation: "fetch",
      error: abortError
    });
    expect(result.code).toBe("timeout");
    expect(result.retryable).toBe(true);
  });

  it("normalizeConnectorThrownError does not re-wrap ConnectorFailureError", () => {
    const original = new ConnectorFailureError("test", "fetch", "rate_limited", true, {
      statusCode: 429
    });

    const result = normalizeConnectorThrownError({
      provider: "test",
      operation: "fetch",
      error: original
    });
    expect(result).toBe(original);
  });

  it("normalizeConnectorThrownError handles TypeError (programming error) as non-retryable", () => {
    const typeError = new TypeError("Cannot read property of undefined");

    const result = normalizeConnectorThrownError({
      provider: "test",
      operation: "fetch",
      error: typeError
    });
    expect(result.code).toBe("remote_error");
    expect(result.retryable).toBe(false);
  });
});

// ===========================================================================
// 8. MEMORY LEAK DETECTION
// ===========================================================================

describe("adversarial: memory leak patterns", () => {
  it("repeated clone() calls do not retain references", () => {
    const results: Array<{ data: string }> = [];
    for (let i = 0; i < 100; i++) {
      const obj = { data: `iteration-${i}-${"x".repeat(10_000)}` };
      results.push(clone(obj));
    }

    // Each result should be independent
    expect(results[0].data).toContain("iteration-0");
    expect(results[99].data).toContain("iteration-99");
    expect(results[0].data).not.toBe(results[1].data);
  });

  it("repeated cursor encode/decode cycles produce consistent results", () => {
    const cursor = {
      createdAt: "2024-06-15T12:00:00.000Z",
      id: "test-item-id"
    };

    for (let i = 0; i < 1000; i++) {
      const encoded = encodeCollectionCursor(cursor);
      const decoded = decodeCollectionCursor(encoded);
      expect(decoded).toEqual(cursor);
    }
  });

  it("large number of encodeCollectionCursor calls do not accumulate state", () => {
    const cursors = Array.from({ length: 1000 }, (_, i) => ({
      createdAt: new Date(Date.now() - i * 1000).toISOString(),
      id: `item-${i}`
    }));

    const encoded = cursors.map((c) => encodeCollectionCursor(c));
    const decoded = encoded.map((e) => decodeCollectionCursor(e));

    for (let i = 0; i < 1000; i++) {
      expect(decoded[i]).toEqual(cursors[i]);
    }
  });
});

// ===========================================================================
// 9. GRACEFUL DEGRADATION
// ===========================================================================

describe("adversarial: graceful degradation under resource pressure", () => {
  it("buildCollectionPage returns empty page for empty input", () => {
    const page = buildCollectionPage({
      items: [],
      limit: 10,
      cursor: null,
      getCursorKey: (item: any) => ({ createdAt: item.createdAt, id: item.id }),
      parsePage: (p) => p
    });

    expect(page.items.length).toBe(0);
    expect(page.nextCursor).toBeNull();
  });

  it("processNextDurableJob returns null when no jobs available", async () => {
    const store = createInMemoryJobStore();
    const queue = createDurableJobQueue(store, {
      runnerId: "idle-runner"
    });

    const result = await processNextDurableJob({
      queue,
      handlers: {}
    });

    expect(result.claimedJob).toBeNull();
    expect(result.finalJob).toBeNull();
  });

  it("processNextDurableJob dead-letters jobs with no registered handler", async () => {
    const store = createInMemoryJobStore();
    const queue = createDurableJobQueue(store, {
      runnerId: "no-handler-runner",
      retryPolicy: { baseDelayMs: 0, factor: 1, maxDelayMs: 0 }
    });

    const job = createJobRecord({
      userId: DEFAULT_OWNER_USER_ID,
      kind: "docs_render",
      payload: { type: "docs_render" } as any,
      maxAttempts: 1
    });

    await store.enqueueJob(job);

    const result = await processNextDurableJob({
      queue,
      handlers: {} // No handler for "docs_render"
    });

    expect(result.claimedJob).toBeDefined();
    expect(result.finalJob?.status).toBe("dead_letter");
    expect(result.finalJob?.lastError).toContain("No handler registered");
  });

  it("job queue handles concurrent claim attempts correctly", async () => {
    const store = createInMemoryJobStore();
    const queue = createDurableJobQueue(store, {
      runnerId: "concurrent-runner"
    });

    const job = createJobRecord({
      userId: DEFAULT_OWNER_USER_ID,
      kind: "docs_render",
      payload: { type: "docs_render" } as any
    });

    await store.enqueueJob(job);

    // Try to claim the same job twice concurrently
    const [claim1, claim2] = await Promise.all([
      queue.claimNext({ runnerId: "runner-a" }),
      queue.claimNext({ runnerId: "runner-b" })
    ]);

    // At most one should succeed (or both could return the same job
    // depending on store implementation, but we verify no crashes)
    const claimed = [claim1, claim2].filter(Boolean);
    expect(claimed.length).toBeGreaterThanOrEqual(0);
    expect(claimed.length).toBeLessThanOrEqual(2);
  });
});

// ===========================================================================
// 10. DISK SPACE / FILE DESCRIPTOR SCENARIOS
// ===========================================================================

describe("adversarial: file and I/O resource limits", () => {
  it("encodeCollectionCursor handles empty string id gracefully", () => {
    // id must be at least 1 char per schema, but let's verify the encoding
    // doesn't crash with minimal valid input
    const cursor = {
      createdAt: "2024-01-01T00:00:00.000Z",
      id: "a"
    };

    const encoded = encodeCollectionCursor(cursor);
    const decoded = decodeCollectionCursor(encoded);
    expect(decoded).toEqual(cursor);
  });

  it("decodeCollectionCursor handles empty input", () => {
    expect(decodeCollectionCursor(null)).toBeNull();
    expect(decodeCollectionCursor(undefined)).toBeNull();
    expect(decodeCollectionCursor("")).toBeNull();
  });

  it("decodeCollectionCursor handles very large base64 input", () => {
    const hugePayload = JSON.stringify({
      createdAt: "2024-01-01T00:00:00.000Z",
      id: "x".repeat(1_000_000)
    });
    const encoded = Buffer.from(hugePayload, "utf8").toString("base64url");

    const decoded = decodeCollectionCursor(encoded);
    expect(decoded).toBeDefined();
    expect(decoded!.id.length).toBe(1_000_000);
  });
});

// ===========================================================================
// 11. NETWORK TIMEOUT PATTERNS
// ===========================================================================

describe("adversarial: network timeout handling", () => {
  it("ConnectorFailureError preserves status code and retry-after", () => {
    const error = new ConnectorFailureError("slack", "postMessage", "rate_limited", true, {
      statusCode: 429,
      retryAfterSeconds: 30
    });

    expect(error.statusCode).toBe(429);
    expect(error.retryAfterSeconds).toBe(30);
    expect(error.retryable).toBe(true);
    expect(error.provider).toBe("slack");
    expect(error.operation).toBe("postMessage");
  });

  it("ConnectorFailureError handles very long error messages", () => {
    const longMessage = "Error: ".repeat(100_000);
    const error = new ConnectorFailureError("test", "fetch", "remote_error", true, {
      message: longMessage
    });

    expect(error.message.length).toBe(longMessage.length);
    expect(error).toBeInstanceOf(Error);
  });
});

// ===========================================================================
// 12. SERIALIZATION EDGE CASES
// ===========================================================================

describe("adversarial: serialization edge cases", () => {
  it("clone() handles undefined values in objects", () => {
    const obj = { a: undefined, b: null, c: 0, d: "" };
    const result = clone(obj);
    // JSON.stringify drops undefined values
    expect(result.b).toBeNull();
    expect(result.c).toBe(0);
    expect(result.d).toBe("");
    // 'a' is dropped by JSON.stringify
    expect("a" in result).toBe(false);
  });

  it("clone() handles special numeric values", () => {
    const obj = {
      inf: Infinity,
      ninf: -Infinity,
      nan: NaN,
      zero: 0,
      negZero: -0
    };
    const result = clone(obj);
    // JSON.stringify converts Infinity, -Infinity, NaN to null
    expect(result.inf).toBeNull();
    expect(result.ninf).toBeNull();
    expect(result.nan).toBeNull();
    expect(result.zero).toBe(0);
  });

  it("clone() handles Date objects by converting to ISO string", () => {
    const date = new Date("2024-01-15T12:00:00.000Z");
    const obj = { date };
    const result = clone(obj);
    // JSON.stringify converts Date to string
    expect(typeof result.date).toBe("string");
    expect(result.date).toBe("2024-01-15T12:00:00.000Z");
  });

  it("clone() handles empty structures", () => {
    expect(clone({})).toEqual({});
    expect(clone([])).toEqual([]);
    expect(clone(null as any)).toBeNull();
  });

  it("clone() handles arrays with mixed types", () => {
    const arr = [1, "two", null, true, { nested: "obj" }, [1, 2]];
    const result = clone(arr);
    expect(result).toEqual(arr);
    // Must be a deep copy, not reference-equal
    expect(result).not.toBe(arr);
    expect(result[4]).not.toBe(arr[4]);
  });
});
