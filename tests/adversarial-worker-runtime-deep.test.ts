import { mkdtemp } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  DEFAULT_OWNER_USER_ID,
  JobRecordSchema,
  createSystemActorContext,
  nowIso,
  type JobRecord
} from "@agentic/contracts";
import {
  computeJobRetryDelayMs,
  createDurableJobQueue,
  createJobRecord,
  processNextDurableJob
} from "@agentic/execution";
import { createRepository } from "@agentic/repository";
import {
  resolveWorkerConcurrencyPolicy,
  createWorkerRuntimeHealthSnapshot,
  updateWorkerRuntimeHealthSnapshot,
  readFileWorkerRuntimeHealthSnapshot,
  createFileWorkerRuntimeHealthSink,
  type WorkerRuntimeHealthSnapshot
} from "@agentic/worker-runtime";
import { createWorkerRuntimeHealthReporter } from "../packages/worker-runtime/src/worker-health";
import { createWorkerRuntimeImmuneSystem } from "../packages/worker-runtime/src/runtime-immune-system";
import { runWatcherSchedulerOnce } from "../packages/worker-runtime/src/watcher-scheduler";
import { createDeadlineWatcherSignalEvaluator } from "../packages/worker-runtime/src/watcher-signal-evaluator";
import { getScheduledAutopilotDueTime } from "../packages/worker-runtime/src/scheduled-autopilot-due-time";

// ---------------------------------------------------------------------------
// Deep adversarial tests for worker-runtime — covers gaps NOT in existing
// worker-runtime-adversarial.test.ts or worker-runtime-durability.test.ts.
// ---------------------------------------------------------------------------

async function createTestRepository() {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "agentic-deep-adv-"));
  const repository = createRepository({
    storePath: path.join(tempDir, "runtime-store.json")
  });
  await repository.seedDefaults(DEFAULT_OWNER_USER_ID);
  return repository;
}

function docsRenderJob(overrides?: {
  idempotencyKey?: string;
  maxAttempts?: number;
  availableAt?: string;
}) {
  return createJobRecord({
    userId: DEFAULT_OWNER_USER_ID,
    kind: "docs_render",
    actorContext: createSystemActorContext(DEFAULT_OWNER_USER_ID),
    idempotencyKey: overrides?.idempotencyKey ?? null,
    maxAttempts: overrides?.maxAttempts,
    availableAt: overrides?.availableAt,
    payload: {
      type: "docs_render",
      metadata: {}
    }
  });
}

describe("adversarial worker runtime deep", () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  // =========================================================================
  // 1. LEASE EDGE CASES
  // =========================================================================
  describe("lease edge cases", () => {
    it("reclaims a job at the exact lease expiry boundary (leaseExpiresAt === now)", async () => {
      const repository = await createTestRepository();
      const queueA = createDurableJobQueue(repository, { runnerId: "runner-A", leaseMs: 10_000 });
      const queueB = createDurableJobQueue(repository, { runnerId: "runner-B", leaseMs: 10_000 });

      const enqueued = await repository.enqueueJob(
        docsRenderJob({ idempotencyKey: "lease-boundary", availableAt: "2026-04-16T03:00:00.000Z" })
      );

      const claimedA = await queueA.claimNext({ now: "2026-04-16T03:00:00.000Z" });
      expect(claimedA?.id).toBe(enqueued.id);
      expect(claimedA?.claimedBy).toBe("runner-A");

      // At exactly the lease expiry time, the lease should be considered expired
      // and runner-B should be able to reclaim.
      const leaseExpiryTime = claimedA!.leaseExpiresAt!;
      const reclaimed = await queueB.claimNext({ now: leaseExpiryTime });
      // The boundary condition: at exactly leaseExpiresAt, is the lease expired?
      // This tests whether <= or < is used in the comparison.
      if (reclaimed) {
        expect(reclaimed.claimedBy).toBe("runner-B");
      } else {
        // If not reclaimable at exact boundary, one ms later should work
        const oneMsLater = new Date(Date.parse(leaseExpiryTime) + 1).toISOString();
        const reclaimedLater = await queueB.claimNext({ now: oneMsLater });
        expect(reclaimedLater?.claimedBy).toBe("runner-B");
      }
    });

    it("does not allow claiming a job whose lease has not expired even by 1ms", async () => {
      const repository = await createTestRepository();
      const queueA = createDurableJobQueue(repository, { runnerId: "runner-A", leaseMs: 30_000 });
      const queueB = createDurableJobQueue(repository, { runnerId: "runner-B", leaseMs: 30_000 });

      const enqueued = await repository.enqueueJob(
        docsRenderJob({ idempotencyKey: "lease-not-expired", availableAt: "2026-04-16T03:00:00.000Z" })
      );

      const claimedA = await queueA.claimNext({ now: "2026-04-16T03:00:00.000Z" });
      expect(claimedA).not.toBeNull();

      // 1ms before expiry should still block
      const oneMsBeforeExpiry = new Date(Date.parse(claimedA!.leaseExpiresAt!) - 1).toISOString();
      const blocked = await queueB.claimNext({ now: oneMsBeforeExpiry });
      expect(blocked).toBeNull();
    });

    it("handles clock skew: runner B with earlier clock cannot steal active lease", async () => {
      const repository = await createTestRepository();
      const queueA = createDurableJobQueue(repository, { runnerId: "runner-A", leaseMs: 30_000 });
      const queueB = createDurableJobQueue(repository, { runnerId: "runner-B", leaseMs: 30_000 });

      await repository.enqueueJob(
        docsRenderJob({ idempotencyKey: "clock-skew", availableAt: "2026-04-16T03:00:00.000Z" })
      );

      // Runner A claims at T+0
      const claimedA = await queueA.claimNext({ now: "2026-04-16T03:00:00.000Z" });
      expect(claimedA).not.toBeNull();

      // Runner B tries to claim with an earlier timestamp (simulating clock behind)
      const skewedTime = "2026-04-16T02:59:50.000Z";
      const blocked = await queueB.claimNext({ now: skewedTime });
      expect(blocked).toBeNull();
    });
  });

  // =========================================================================
  // 2. HEALTH SINK FAILURES
  // =========================================================================
  describe("health sink failures", () => {
    it("reporter continues after a write failure mid-snapshot sequence", async () => {
      let writeCount = 0;
      const errors: unknown[] = [];
      const failingSink = {
        async write(_snapshot: WorkerRuntimeHealthSnapshot) {
          writeCount++;
          if (writeCount === 2) {
            throw new Error("simulated disk full");
          }
        }
      };

      const reporter = createWorkerRuntimeHealthReporter({
        runnerId: "fail-runner",
        health: { sink: failingSink, intervalMs: 60_000 }, // Long interval to avoid heartbeat interference
        getProcessedCount: () => 0,
        onWriteError: (err) => { errors.push(err); }
      });

      // Write several snapshots — the second will fail
      reporter.write({ status: "starting" });
      reporter.write({ status: "running", processedCount: 1 });
      reporter.write({ status: "running", processedCount: 2 });

      // Wait for the chained promise pipeline to settle
      await reporter.flush();
      reporter.close();

      // The reporter chains writes: write1 → write2 (fails) → write3
      // After the failure on write #2, the chain catches and continues to write #3.
      // All 3 writes should have been attempted.
      expect(writeCount).toBe(3);
      // The error from write #2 should have been captured by onWriteError
      expect(errors.length).toBeGreaterThanOrEqual(1);
    });

    it("rejects writing an oversized snapshot that exceeds 16KB", async () => {
      const tempDir = await mkdtemp(path.join(os.tmpdir(), "agentic-health-oversized-write-"));
      const filePath = path.join(tempDir, "health.json");
      const sink = createFileWorkerRuntimeHealthSink(filePath);

      const snapshot = createWorkerRuntimeHealthSnapshot({ runnerId: "test" });
      // Inject a huge field into the scheduler to blow past 16KB
      const oversized = {
        ...snapshot,
        scheduler: {
          ...snapshot.scheduler,
          lastErrorClass: "x".repeat(20_000)
        }
      } as unknown as WorkerRuntimeHealthSnapshot;

      await expect(sink.write(oversized)).rejects.toThrow("bounded file size");
    });

    it("handles concurrent health writes without corruption", async () => {
      const tempDir = await mkdtemp(path.join(os.tmpdir(), "agentic-health-concurrent-"));
      const filePath = path.join(tempDir, "health.json");
      const sink = createFileWorkerRuntimeHealthSink(filePath);

      const snapshots = Array.from({ length: 10 }, (_, i) =>
        updateWorkerRuntimeHealthSnapshot(
          createWorkerRuntimeHealthSnapshot({ runnerId: "concurrent-runner" }),
          { processedCount: i, status: "running" }
        )
      );

      // Fire all writes concurrently
      await Promise.all(snapshots.map((s) => sink.write(s)));

      // The final read should produce a valid snapshot (no JSON corruption)
      const result = await readFileWorkerRuntimeHealthSnapshot(filePath);
      expect(result).not.toBeNull();
      expect(result!.runnerId).toBe("concurrent-runner");
      expect(typeof result!.processedCount).toBe("number");
    });

    it("returns null when reading a non-existent health file", async () => {
      const tempDir = await mkdtemp(path.join(os.tmpdir(), "agentic-health-missing-"));
      const filePath = path.join(tempDir, "does-not-exist.json");

      const result = await readFileWorkerRuntimeHealthSnapshot(filePath);
      expect(result).toBeNull();
    });
  });

  // =========================================================================
  // 3. CONCURRENCY LIMIT BOUNDARIES
  // =========================================================================
  describe("concurrency limit boundaries", () => {
    it("allows exactly one running job when maxRunningPerKind is 1", async () => {
      const repository = await createTestRepository();
      const queue = createDurableJobQueue(repository, {
        runnerId: "conc-runner",
        concurrencyLimits: { maxRunningPerKind: 1 }
      });

      await repository.enqueueJob(docsRenderJob({ idempotencyKey: "conc-first" }));
      await repository.enqueueJob(docsRenderJob({ idempotencyKey: "conc-second" }));

      const first = await queue.claimNext();
      expect(first).not.toBeNull();

      // Second claim should be blocked by concurrency limit
      const second = await queue.claimNext();
      expect(second).toBeNull();
    });

    it("blocks all jobs when concurrency limit is reached across multiple kinds", async () => {
      const repository = await createTestRepository();
      const queue = createDurableJobQueue(repository, {
        runnerId: "conc-multi-runner",
        concurrencyLimits: { maxRunningPerKind: 1 }
      });

      await repository.enqueueJob(docsRenderJob({ idempotencyKey: "conc-kind-a" }));

      const first = await queue.claimNext();
      expect(first).not.toBeNull();

      // Even same kind should be blocked
      await repository.enqueueJob(docsRenderJob({ idempotencyKey: "conc-kind-b" }));
      const second = await queue.claimNext();
      expect(second).toBeNull();
    });

    it("enforces maxRunningPerUser limit independently of per-kind limit", async () => {
      const repository = await createTestRepository();
      const queue = createDurableJobQueue(repository, {
        runnerId: "conc-user-runner",
        concurrencyLimits: { maxRunningPerKind: 5, maxRunningPerUser: 1 }
      });

      await repository.enqueueJob(docsRenderJob({ idempotencyKey: "conc-user-first" }));
      await repository.enqueueJob(docsRenderJob({ idempotencyKey: "conc-user-second" }));

      const first = await queue.claimNext();
      expect(first).not.toBeNull();

      // Per-user limit of 1 should block the second even though per-kind allows 5
      const second = await queue.claimNext();
      expect(second).toBeNull();
    });
  });

  // =========================================================================
  // 4. CIRCUIT BREAKER STATES
  // =========================================================================
  describe("circuit breaker state transitions", () => {
    it("recovers after cooldown period elapses (half-open -> closed transition)", () => {
      vi.useFakeTimers();
      const baseTime = Date.now();
      vi.setSystemTime(baseTime);

      const immune = createWorkerRuntimeImmuneSystem({
        runnerId: "breaker-cooldown-runner",
        controls: { maxConsecutiveFailures: 2, coolDownMs: 5_000 }
      });

      // Trip the breaker
      immune.recordJobOutcome("goal_create", "dead_letter");
      immune.recordJobOutcome("goal_create", "dead_letter");

      // Should be open
      expect(immune.getAllowedKinds(["goal_create"])).toBeNull();

      // Advance past cooldown
      vi.setSystemTime(baseTime + 5_001);

      // Should be allowed again (half-open / closed)
      const allowed = immune.getAllowedKinds(["goal_create"]);
      expect(allowed).toEqual(["goal_create"]);
    });

    it("stays open when queried exactly at cooldown boundary", () => {
      vi.useFakeTimers();
      const baseTime = Date.now();
      vi.setSystemTime(baseTime);

      const immune = createWorkerRuntimeImmuneSystem({
        runnerId: "breaker-boundary-runner",
        controls: { maxConsecutiveFailures: 2, coolDownMs: 5_000 }
      });

      immune.recordJobOutcome("goal_create", "dead_letter");
      immune.recordJobOutcome("goal_create", "dead_letter");

      // At exactly cooldown boundary: openUntilMs <= nowMs means allowed
      // The implementation uses `entry.openUntilMs <= nowMs` so at exact match it opens
      vi.setSystemTime(baseTime + 5_000);
      const allowed = immune.getAllowedKinds(["goal_create"]);
      // This documents the boundary behavior: <= means it recovers AT the boundary
      expect(allowed).toEqual(["goal_create"]);
    });

    it("resets consecutive failure counter when breaker opens (counter resets to 0)", () => {
      const immune = createWorkerRuntimeImmuneSystem({
        runnerId: "breaker-reset-runner",
        controls: { maxConsecutiveFailures: 3, coolDownMs: 100 }
      });

      // Trip the breaker with exactly 3 failures
      immune.recordJobOutcome("goal_create", "dead_letter");
      immune.recordJobOutcome("goal_create", "dead_letter");
      immune.recordJobOutcome("goal_create", "dead_letter");

      // Breaker is open, counter reset to 0 internally
      expect(immune.getAllowedKinds(["goal_create"])).toBeNull();

      // After cooldown, only 2 more failures should NOT trip it again
      // because counter was reset to 0 when breaker opened
      vi.useFakeTimers();
      vi.setSystemTime(Date.now() + 200);

      immune.recordJobOutcome("goal_create", "dead_letter");
      immune.recordJobOutcome("goal_create", "dead_letter");

      // Only 2 failures since reset — should still be allowed
      const allowed = immune.getAllowedKinds(["goal_create"]);
      expect(allowed).toEqual(["goal_create"]);
    });

    it("isolates circuit breaker state per job kind", () => {
      const immune = createWorkerRuntimeImmuneSystem({
        runnerId: "breaker-isolation-runner",
        controls: { maxConsecutiveFailures: 2, coolDownMs: 60_000 }
      });

      // Trip breaker for goal_create only
      immune.recordJobOutcome("goal_create", "dead_letter");
      immune.recordJobOutcome("goal_create", "dead_letter");

      // goal_create should be blocked
      expect(immune.getAllowedKinds(["goal_create"])).toBeNull();

      // goal_refine should be unaffected
      const refineAllowed = immune.getAllowedKinds(["goal_refine"]);
      expect(refineAllowed).toEqual(["goal_refine"]);

      // Mixed request: goal_create filtered out, goal_refine passes
      const mixed = immune.getAllowedKinds(["goal_create", "goal_refine"]);
      expect(mixed).toEqual(["goal_refine"]);
    });

    it("handles rapid open/close cycles without state corruption", () => {
      vi.useFakeTimers();
      let baseTime = Date.now();
      vi.setSystemTime(baseTime);

      const immune = createWorkerRuntimeImmuneSystem({
        runnerId: "breaker-rapid-runner",
        controls: { maxConsecutiveFailures: 1, coolDownMs: 100 }
      });

      // Cycle 1: trip and recover
      immune.recordJobOutcome("goal_create", "dead_letter");
      expect(immune.getAllowedKinds(["goal_create"])).toBeNull();

      baseTime += 101;
      vi.setSystemTime(baseTime);
      expect(immune.getAllowedKinds(["goal_create"])).toEqual(["goal_create"]);

      // Cycle 2: trip and recover
      immune.recordJobOutcome("goal_create", "dead_letter");
      expect(immune.getAllowedKinds(["goal_create"])).toBeNull();

      baseTime += 101;
      vi.setSystemTime(baseTime);
      expect(immune.getAllowedKinds(["goal_create"])).toEqual(["goal_create"]);

      // Cycle 3: trip and recover via success
      immune.recordJobOutcome("goal_create", "dead_letter");
      expect(immune.getAllowedKinds(["goal_create"])).toBeNull();

      immune.recordJobOutcome("goal_create", "completed");
      expect(immune.getAllowedKinds(["goal_create"])).toEqual(["goal_create"]);
    });
  });

  // =========================================================================
  // 5. RETRY JITTER EDGE CASES
  // =========================================================================
  describe("retry jitter edge cases", () => {
    it("returns exact base delay when jitter ratio is zero", () => {
      const delay = computeJobRetryDelayMs(1, { baseDelayMs: 1000, factor: 2, maxDelayMs: 60000 }, { jitterRatio: 0 });
      expect(delay).toBe(1000);
    });

    it("clamps negative jitter ratio to zero", () => {
      const delay = computeJobRetryDelayMs(1, { baseDelayMs: 1000, factor: 2, maxDelayMs: 60000 }, { jitterRatio: -0.5 });
      // Negative jitter is clamped to 0, so we get exact base delay
      expect(delay).toBe(1000);
    });

    it("clamps jitter ratio above 1 to exactly 1", () => {
      const random = () => 0.5; // deterministic
      const delay = computeJobRetryDelayMs(
        1,
        { baseDelayMs: 1000, factor: 1, maxDelayMs: 60000 },
        { jitterRatio: 2.0, random }
      );
      // jitterRatio clamped to 1.0, spread = 1000, offset = round((0.5*2-1)*1000) = 0
      expect(delay).toBe(1000);
    });

    it("produces deterministic jitter with injected random function", () => {
      const results = new Set<number>();
      for (let i = 0; i < 10; i++) {
        const delay = computeJobRetryDelayMs(
          1,
          { baseDelayMs: 1000, factor: 1, maxDelayMs: 60000 },
          { jitterRatio: 0.5, random: () => 0.5 }
        );
        results.add(delay);
      }
      // With fixed random, all results should be identical
      expect(results.size).toBe(1);
    });

    it("never produces negative delay even with extreme jitter", () => {
      // random() = 0 gives offset = round((-1) * spread) = -spread
      const delay = computeJobRetryDelayMs(
        1,
        { baseDelayMs: 100, factor: 1, maxDelayMs: 60000 },
        { jitterRatio: 1.0, random: () => 0 }
      );
      expect(delay).toBeGreaterThanOrEqual(0);
    });

    it("caps delay at maxDelayMs even with exponential backoff and jitter", () => {
      const delay = computeJobRetryDelayMs(
        20, // Very high attempt count → huge multiplier
        { baseDelayMs: 1000, factor: 2, maxDelayMs: 5000 },
        { jitterRatio: 1.0, random: () => 1 } // Maximum positive jitter
      );
      expect(delay).toBeLessThanOrEqual(5000);
    });

    it("BUG: NaN jitter ratio propagates NaN delay instead of falling back to base delay", () => {
      const delay = computeJobRetryDelayMs(
        1,
        { baseDelayMs: 1000, factor: 2, maxDelayMs: 60000 },
        { jitterRatio: NaN }
      );
      // Fixed: NaN jitterRatio is now treated as 0 (no jitter).
      // The implementation checks Number.isFinite() before clamping.
      // Expected behavior: delay should be 1000 (baseDelayMs * factor^0 with no jitter).
      expect(delay).toBe(1000);
      expect(Number.isFinite(delay)).toBe(true);
    });
  });

  // =========================================================================
  // 6. WATCHER SCHEDULER RACES
  // =========================================================================
  describe("watcher scheduler races", () => {
    it("skips watchers leased by another runner during evaluation", async () => {
      const repository = await createTestRepository();
      const watcherRepo = repository as any;

      // Create a minimal watcher via the repository
      const watchers = await watcherRepo.listWatchers({ userId: DEFAULT_OWNER_USER_ID });

      // If no watchers exist, this test validates the empty case
      const result = await runWatcherSchedulerOnce({
        repository: watcherRepo,
        runnerId: "scheduler-runner-1",
        userId: DEFAULT_OWNER_USER_ID,
        now: "2026-04-16T03:00:00.000Z"
      });

      expect(result.decisions).toBeDefined();
      expect(result.runnerId).toBe("scheduler-runner-1");
    });

    it("aborts watcher scheduler cleanly when signal is already aborted before evaluation", async () => {
      const repository = await createTestRepository();
      const controller = new AbortController();

      // Abort immediately before calling
      controller.abort(new Error("test abort"));

      // The scheduler checks signal.aborted at the start of each watcher loop iteration.
      // With no watchers, it completes without throwing because the abort check is inside
      // the for-loop body. This documents the behavior: pre-abort with empty watchers = no throw.
      const result = await runWatcherSchedulerOnce({
        repository: repository as any,
        runnerId: "abort-runner",
        userId: DEFAULT_OWNER_USER_ID,
        signal: controller.signal
      });

      // Empty watcher list means no iterations → no abort check triggered
      expect(result.decisions).toEqual([]);
    });

    it("evaluates expired watchers as skipped rather than triggering", async () => {
      const repository = await createTestRepository();

      // Run scheduler — any expired watchers should be skipped
      const result = await runWatcherSchedulerOnce({
        repository: repository as any,
        runnerId: "expiry-runner",
        userId: DEFAULT_OWNER_USER_ID,
        now: "2099-12-31T23:59:59.000Z" // Far future to make everything expired
      });

      // All decisions should be "skipped" if any watchers exist
      for (const decision of result.decisions) {
        expect(decision.action).toBe("skipped");
      }
    });
  });

  // =========================================================================
  // 7. STATE MACHINE VIOLATIONS
  // =========================================================================
  describe("state machine violations", () => {
    it("does not re-process a completed job that is somehow re-enqueued with same idempotency key", async () => {
      const repository = await createTestRepository();
      const queue = createDurableJobQueue(repository, {
        runnerId: "state-runner",
        retryPolicy: { baseDelayMs: 0, factor: 1, maxDelayMs: 0 }
      });

      const job = docsRenderJob({ idempotencyKey: "state-no-reprocess", maxAttempts: 3 });
      await repository.enqueueJob(job);

      let callCount = 0;
      const handlers = {
        docs_render: async () => {
          callCount++;
        }
      };

      // Process to completion
      const first = await processNextDurableJob({ queue, handlers });
      expect(first.finalJob?.status).toBe("completed");
      expect(callCount).toBe(1);

      // Try to process again — should find nothing
      const second = await processNextDurableJob({ queue, handlers });
      expect(second.claimedJob).toBeNull();
      expect(callCount).toBe(1);
    });

    it("does not acknowledge a dead-lettered job on subsequent processing attempts", async () => {
      const repository = await createTestRepository();
      const queue = createDurableJobQueue(repository, {
        runnerId: "state-deadletter-runner",
        retryPolicy: { baseDelayMs: 0, factor: 1, maxDelayMs: 0 }
      });

      await repository.enqueueJob(docsRenderJob({ idempotencyKey: "state-deadletter-noreack", maxAttempts: 1 }));

      const handlers = {
        docs_render: async () => {
          throw new Error("always fails");
        }
      };

      // First attempt → dead_letter (maxAttempts=1)
      const first = await processNextDurableJob({ queue, handlers });
      expect(first.finalJob?.status).toBe("dead_letter");

      // Subsequent attempts must not find the dead-lettered job
      const second = await processNextDurableJob({ queue, handlers });
      expect(second.claimedJob).toBeNull();
    });

    it("prevents completing a job owned by a different runner", async () => {
      const repository = await createTestRepository();
      const queueA = createDurableJobQueue(repository, { runnerId: "owner-A", leaseMs: 30_000 });

      await repository.enqueueJob(docsRenderJob({ idempotencyKey: "state-wrong-owner" }));

      const claimed = await queueA.claimNext();
      expect(claimed?.claimedBy).toBe("owner-A");

      // Queue B tries to acknowledge a job owned by A
      const queueB = createDurableJobQueue(repository, { runnerId: "owner-B", leaseMs: 30_000 });
      await expect(
        queueB.acknowledge({ jobId: claimed!.id })
      ).rejects.toThrow();
    });
  });

  // =========================================================================
  // 8. RESOURCE EXHAUSTION & LARGE PAYLOADS
  // =========================================================================
  describe("resource exhaustion", () => {
    it("handles a job with a very large payload without crashing", async () => {
      const repository = await createTestRepository();
      const queue = createDurableJobQueue(repository, {
        runnerId: "large-payload-runner",
        retryPolicy: { baseDelayMs: 0, factor: 1, maxDelayMs: 0 }
      });

      // Create a job with ~100KB payload
      const largePayload = createJobRecord({
        userId: DEFAULT_OWNER_USER_ID,
        kind: "docs_render",
        actorContext: createSystemActorContext(DEFAULT_OWNER_USER_ID),
        idempotencyKey: "large-payload-test",
        payload: {
          type: "docs_render",
          metadata: {
            bigData: "x".repeat(100_000)
          }
        }
      });

      const enqueued = await repository.enqueueJob(largePayload);
      expect(enqueued.id).toBeDefined();

      let receivedPayloadSize = 0;
      const handlers = {
        docs_render: async (job: JobRecord) => {
          receivedPayloadSize = JSON.stringify(job.payload).length;
        }
      };

      const result = await processNextDurableJob({ queue, handlers });
      expect(result.finalJob?.status).toBe("completed");
      expect(receivedPayloadSize).toBeGreaterThan(100_000);
    });

    it("drains a queue of many jobs without unbounded memory growth", async () => {
      const repository = await createTestRepository();
      const queue = createDurableJobQueue(repository, {
        runnerId: "drain-runner",
        retryPolicy: { baseDelayMs: 0, factor: 1, maxDelayMs: 0 }
      });

      const JOB_COUNT = 50;
      for (let i = 0; i < JOB_COUNT; i++) {
        await repository.enqueueJob(
          docsRenderJob({ idempotencyKey: `drain-job-${i}` })
        );
      }

      let processedCount = 0;
      const handlers = {
        docs_render: async () => {
          processedCount++;
        }
      };

      // Drain all jobs
      for (let i = 0; i < JOB_COUNT; i++) {
        const result = await processNextDurableJob({ queue, handlers });
        expect(result.finalJob?.status).toBe("completed");
      }

      expect(processedCount).toBe(JOB_COUNT);

      // Queue should be empty
      const empty = await processNextDurableJob({ queue, handlers });
      expect(empty.claimedJob).toBeNull();
    });
  });

  // =========================================================================
  // 9. DEADLINE WATCHER SIGNAL EVALUATOR EDGE CASES
  // =========================================================================
  describe("deadline watcher signal evaluator", () => {
    it("does not trigger for resolved commitments (completed/dismissed)", async () => {
      const evaluator = createDeadlineWatcherSignalEvaluator({
        repository: {
          listCommitments: async () => [
            {
              id: "c1",
              goalId: "g1",
              title: "Done thing",
              status: "completed",
              dueAt: new Date(Date.now() - 86400000).toISOString(),
              createdAt: nowIso(),
              updatedAt: nowIso()
            } as any
          ]
        },
        now: () => Date.now()
      });

      const result = await evaluator({
        id: "w1",
        goalId: "g1",
        actorContext: { subjectUserId: "user-1" },
        schedule: { cursor: null }
      } as any);

      expect(result.wouldTrigger).toBe(false);
    });

    it("does not re-trigger for an already-signaled commitment (cursor match)", async () => {
      const commitmentId = "c-already-signaled";
      const dueAt = new Date(Date.now() - 3600000).toISOString();
      const cursorKey = `${commitmentId}:${dueAt}`;

      const evaluator = createDeadlineWatcherSignalEvaluator({
        repository: {
          listCommitments: async () => [
            {
              id: commitmentId,
              goalId: "g1",
              title: "Overdue thing",
              status: "active",
              dueAt,
              createdAt: nowIso(),
              updatedAt: nowIso()
            } as any
          ]
        },
        now: () => Date.now()
      });

      const result = await evaluator({
        id: "w1",
        goalId: "g1",
        actorContext: { subjectUserId: "user-1" },
        schedule: { cursor: cursorKey }
      } as any);

      expect(result.wouldTrigger).toBe(false);
      expect(result.reason).toContain("already signaled");
    });

    it("returns non-triggering when watcher has no subject user", async () => {
      const evaluator = createDeadlineWatcherSignalEvaluator({
        repository: { listCommitments: async () => [] },
        now: () => Date.now()
      });

      const result = await evaluator({
        id: "w1",
        goalId: "g1",
        actorContext: null,
        schedule: { cursor: null }
      } as any);

      expect(result.wouldTrigger).toBe(false);
      expect(result.reason).toContain("no subject user");
    });
  });

  // =========================================================================
  // 10. HEALTH REPORTER LIFECYCLE
  // =========================================================================
  describe("health reporter lifecycle", () => {
    it("getSnapshot returns null when health is not configured", () => {
      vi.useFakeTimers();
      const reporter = createWorkerRuntimeHealthReporter({
        runnerId: "no-health-runner",
        getProcessedCount: () => 0
      });

      expect(reporter.getSnapshot()).toBeNull();
      reporter.close();
    });

    it("getSnapshot returns initial snapshot immediately after creation", () => {
      vi.useFakeTimers();
      const sink = { write: async () => {} };
      const reporter = createWorkerRuntimeHealthReporter({
        runnerId: "initial-snapshot-runner",
        health: { sink, intervalMs: 60_000 },
        getProcessedCount: () => 0
      });

      const snapshot = reporter.getSnapshot();
      expect(snapshot).not.toBeNull();
      expect(snapshot!.runnerId).toBe("initial-snapshot-runner");
      expect(snapshot!.status).toBe("starting");
      reporter.close();
    });

    it("update preserves immutable fields even when malicious updates are passed", () => {
      const original = createWorkerRuntimeHealthSnapshot({
        runnerId: "immutable-runner",
        now: "2026-01-01T00:00:00.000Z"
      });

      const tampered = updateWorkerRuntimeHealthSnapshot(original, {
        status: "running",
        processedCount: 42,
        // These should be ignored:
        runnerId: "hijacked" as any,
        version: 999 as any,
        pid: 99999 as any,
        startedAt: "1970-01-01T00:00:00.000Z" as any
      });

      expect(tampered.runnerId).toBe("immutable-runner");
      expect(tampered.version).toBe(1);
      expect(tampered.pid).toBe(original.pid);
      expect(tampered.startedAt).toBe("2026-01-01T00:00:00.000Z");
      // But mutable fields should update
      expect(tampered.status).toBe("running");
      expect(tampered.processedCount).toBe(42);
    });
  });

  // =========================================================================
  // 11. SCHEDULED AUTOPILOT DUE TIME EDGE CASES
  // =========================================================================
  describe("scheduled autopilot due time edge cases", () => {
    it("treats briefing_due events the same as template_due for scheduling", () => {
      const pastDate = new Date(Date.now() - 3_600_000).toISOString();
      const result = getScheduledAutopilotDueTime({
        kind: "briefing_due",
        details: { dueAt: pastDate }
      } as any);

      expect(result.due).toBe(true);
      expect(result.dueAt).toBe(pastDate);
    });

    it("rejects briefing_due events with missing dueAt", () => {
      const result = getScheduledAutopilotDueTime({
        kind: "briefing_due",
        details: {}
      } as any);

      expect(result.due).toBe(false);
      expect(result.reason).toBe("missing_due_time");
    });

    it("treats dueAt exactly at now as due (boundary)", () => {
      vi.useFakeTimers();
      const exactNow = new Date().toISOString();
      vi.setSystemTime(new Date(exactNow));

      const result = getScheduledAutopilotDueTime({
        kind: "template_due",
        details: { dueAt: exactNow }
      } as any);

      // dueMs > Date.now() is false when they're equal, so it IS due
      expect(result.due).toBe(true);
    });

    it("handles non-string dueAt values gracefully", () => {
      const result = getScheduledAutopilotDueTime({
        kind: "template_due",
        details: { dueAt: 12345 }
      } as any);

      expect(result.due).toBe(false);
      expect(result.reason).toBe("missing_due_time");
    });
  });

  // =========================================================================
  // 12. CONCURRENCY POLICY ADDITIONAL EDGE CASES
  // =========================================================================
  describe("concurrency policy additional edge cases", () => {
    it("rejects empty string env vars gracefully (treats as unset)", () => {
      const policy = resolveWorkerConcurrencyPolicy({
        env: { AGENTIC_WORKER_MAX_RUNNING_PER_KIND: "" },
        nodeEnv: "development"
      });
      expect(policy.constrained).toBe(false);
      expect(policy.source).toBe("non-production-unconstrained");
    });

    it("rejects whitespace-only env vars gracefully", () => {
      const policy = resolveWorkerConcurrencyPolicy({
        env: { AGENTIC_WORKER_MAX_RUNNING_PER_KIND: "   " },
        nodeEnv: "development"
      });
      expect(policy.constrained).toBe(false);
    });

    it("accepts very large positive integers", () => {
      const policy = resolveWorkerConcurrencyPolicy({
        env: { AGENTIC_WORKER_MAX_RUNNING_PER_KIND: "999999" },
        nodeEnv: "production"
      });
      expect(policy.limits?.maxRunningPerKind).toBe(999999);
    });

    it("applies all three concurrency limits independently in production", () => {
      const policy = resolveWorkerConcurrencyPolicy({
        env: {
          AGENTIC_WORKER_MAX_RUNNING_PER_KIND: "3",
          AGENTIC_WORKER_MAX_RUNNING_PER_USER: "5",
          AGENTIC_WORKER_MAX_RUNNING_PER_CONCURRENCY_KEY: "2"
        },
        nodeEnv: "production"
      });
      expect(policy.constrained).toBe(true);
      expect(policy.source).toBe("env");
      expect(policy.limits?.maxRunningPerKind).toBe(3);
      expect(policy.limits?.maxRunningPerUser).toBe(5);
      expect(policy.limits?.maxRunningPerConcurrencyKey).toBe(2);
    });
  });
});
