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
import { createDurableJobQueue, createJobRecord, processNextDurableJob } from "@agentic/execution";
import { createRepository } from "@agentic/repository";

// ---------------------------------------------------------------------------
// AOS-25 / #1013: worker durability + recovery evidence.
//
// These tests strengthen the in-repo evidence that the durable job runtime
// recovers cleanly from the failure modes that gate watcher + autopilot-control
// graduation: transient failure -> retry -> recovery, retry-budget exhaustion ->
// dead-letter, lease expiry -> reclaim by a healthy worker, dead-letter -> replay
// recovery, and in-attempt operator cancellation / lease takeover aborting work
// without corrupting the queue (the AOS-25 AbortController follow-up).
// ---------------------------------------------------------------------------

async function createDurabilityRepository() {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "agentic-worker-durability-"));
  const repository = createRepository({
    storePath: path.join(tempDir, "runtime-store.json")
  });
  await repository.seedDefaults(DEFAULT_OWNER_USER_ID);
  return repository;
}

function docsRenderJob(overrides?: { idempotencyKey?: string; maxAttempts?: number; availableAt?: string }) {
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

function claimedRunningJob(runnerId: string): JobRecord {
  return JobRecordSchema.parse({
    ...docsRenderJob({ idempotencyKey: "durability-cancel" }),
    status: "running",
    attemptCount: 1,
    claimedBy: runnerId,
    claimedAt: nowIso(),
    lastAttemptAt: nowIso(),
    leaseExpiresAt: new Date(Date.now() + 30_000).toISOString()
  });
}

describe("worker durability and recovery evidence (#1013)", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("recovers a transiently failing job through retry and a clean second attempt", async () => {
    const repository = await createDurabilityRepository();
    const queue = createDurableJobQueue(repository, {
      runnerId: "durability-retry-runner",
      retryPolicy: { baseDelayMs: 0, factor: 1, maxDelayMs: 0 }
    });
    await repository.enqueueJob(docsRenderJob({ idempotencyKey: "durability-retry", maxAttempts: 3 }));

    let attempts = 0;
    const handlers = {
      docs_render: async () => {
        attempts += 1;
        if (attempts === 1) {
          throw new Error("injected transient failure");
        }
      }
    };

    const first = await processNextDurableJob({ queue, handlers });
    expect(first.finalJob?.status).toBe("retrying");
    expect(first.finalJob?.lastError).toContain("injected transient failure");

    const second = await processNextDurableJob({ queue, handlers });
    expect(second.finalJob?.status).toBe("completed");
    expect(second.finalJob?.completedAt).not.toBeNull();
    expect(attempts).toBe(2);
  });

  it("dead-letters a job that exhausts its retry budget", async () => {
    const repository = await createDurabilityRepository();
    const queue = createDurableJobQueue(repository, {
      runnerId: "durability-deadletter-runner",
      retryPolicy: { baseDelayMs: 0, factor: 1, maxDelayMs: 0 }
    });
    await repository.enqueueJob(docsRenderJob({ idempotencyKey: "durability-deadletter", maxAttempts: 2 }));

    const handlers = {
      docs_render: async () => {
        throw new Error("permanent failure");
      }
    };

    const first = await processNextDurableJob({ queue, handlers });
    expect(first.finalJob?.status).toBe("retrying");

    const second = await processNextDurableJob({ queue, handlers });
    expect(second.finalJob?.status).toBe("dead_letter");
    expect(second.finalJob?.deadLetteredAt).not.toBeNull();
    expect(second.finalJob?.lastError).toContain("permanent failure");

    // The dead-lettered job is terminal and must not be re-claimed.
    const drained = await processNextDurableJob({ queue, handlers });
    expect(drained.claimedJob).toBeNull();
  });

  it("reclaims an expired-lease job with a healthy worker after the original worker stalls", async () => {
    const repository = await createDurabilityRepository();
    const queueA = createDurableJobQueue(repository, { runnerId: "runner-A", leaseMs: 30_000 });
    const queueB = createDurableJobQueue(repository, { runnerId: "runner-B", leaseMs: 30_000 });
    const enqueued = await repository.enqueueJob(
      docsRenderJob({ idempotencyKey: "durability-lease", availableAt: "2026-04-16T03:00:00.000Z" })
    );

    const claimedA = await queueA.claimNext({ now: "2026-04-16T03:00:00.000Z" });
    expect(claimedA?.id).toBe(enqueued.id);
    expect(claimedA?.claimedBy).toBe("runner-A");

    // Runner A stalls. While its lease is still active, runner B cannot steal the job.
    const blocked = await queueB.claimNext({ now: "2026-04-16T03:00:10.000Z" });
    expect(blocked).toBeNull();

    // Once the lease expires, a healthy worker reclaims and completes it.
    const reclaimed = await queueB.claimNext({ now: "2026-04-16T03:00:31.000Z" });
    expect(reclaimed?.id).toBe(enqueued.id);
    expect(reclaimed?.claimedBy).toBe("runner-B");

    const completed = await queueB.acknowledge({ jobId: reclaimed!.id, now: "2026-04-16T03:00:32.000Z" });
    expect(completed.status).toBe("completed");
    expect(completed.claimedBy).toBe("runner-B");
  });

  it("recovers a dead-lettered job through a replay enqueue that records its provenance", async () => {
    const repository = await createDurabilityRepository();
    const queue = createDurableJobQueue(repository, {
      runnerId: "durability-replay-runner",
      retryPolicy: { baseDelayMs: 0, factor: 1, maxDelayMs: 0 }
    });
    await repository.enqueueJob(docsRenderJob({ idempotencyKey: "durability-replay-source", maxAttempts: 1 }));

    const failingHandlers = {
      docs_render: async () => {
        throw new Error("replay source failure");
      }
    };
    const deadResult = await processNextDurableJob({ queue, handlers: failingHandlers });
    expect(deadResult.finalJob?.status).toBe("dead_letter");
    const deadJobId = deadResult.finalJob!.id;

    // Replay: enqueue a fresh job that references the dead-lettered one.
    const replay = await repository.enqueueJob(
      createJobRecord({
        userId: DEFAULT_OWNER_USER_ID,
        kind: "docs_render",
        actorContext: createSystemActorContext(DEFAULT_OWNER_USER_ID),
        idempotencyKey: "durability-replay-recovery",
        payload: {
          type: "docs_render",
          metadata: { replayedFromJobId: deadJobId }
        }
      })
    );
    expect(JSON.stringify(replay.journal)).toContain(deadJobId);

    const replayResult = await processNextDurableJob({
      queue,
      handlers: {
        docs_render: async () => {}
      }
    });
    expect(replayResult.finalJob?.id).toBe(replay.id);
    expect(replayResult.finalJob?.status).toBe("completed");
  });

  it("aborts the in-flight signal and abandons a job cancelled mid-attempt without acknowledging or failing it", async () => {
    const runnerId = "durability-cancel-runner";
    const claimed = claimedRunningJob(runnerId);
    let snapshot: JobRecord = claimed;

    const completeJob = vi.fn<() => Promise<JobRecord>>(async () => {
      throw new Error("a cancelled job must not be acknowledged");
    });
    const retryJob = vi.fn<() => Promise<JobRecord>>(async () => {
      throw new Error("a cancelled job must not be retried");
    });
    const deadLetterJob = vi.fn<() => Promise<JobRecord>>(async () => {
      throw new Error("a cancelled job must not be dead-lettered");
    });
    const queue = createDurableJobQueue(
      {
        enqueueJob: async (job) => job,
        claimNextJob: async () => claimed,
        completeJob,
        retryJob,
        deadLetterJob
      },
      { runnerId }
    );

    let sawAbort = false;
    let resolveStarted!: () => void;
    const started = new Promise<void>((resolve) => {
      resolveStarted = resolve;
    });
    let releaseHandler!: () => void;
    const release = new Promise<void>((resolve) => {
      releaseHandler = resolve;
    });

    const processing = processNextDurableJob({
      queue,
      cancellation: {
        readLatest: async () => snapshot,
        pollIntervalMs: 5
      },
      handlers: {
        docs_render: async (_job, context) => {
          context?.signal.addEventListener(
            "abort",
            () => {
              sawAbort = true;
              releaseHandler();
            },
            { once: true }
          );
          resolveStarted();
          await release;
        }
      }
    });

    await started;
    // Operator cancels the running job out from under the worker.
    snapshot = JobRecordSchema.parse({
      ...claimed,
      status: "cancelled",
      claimedBy: null,
      claimedAt: null,
      leaseExpiresAt: null
    });

    const result = await processing;

    expect(sawAbort).toBe(true);
    expect(result.claimedJob?.id).toBe(claimed.id);
    expect(result.finalJob?.status).toBe("cancelled");
    expect(completeJob).not.toHaveBeenCalled();
    expect(retryJob).not.toHaveBeenCalled();
    expect(deadLetterJob).not.toHaveBeenCalled();
  });

  it("abandons a cancelled job cleanly even when the handler ignores the abort signal", async () => {
    const runnerId = "durability-cancel-stubborn-runner";
    const claimed = claimedRunningJob(runnerId);
    let snapshot: JobRecord = claimed;

    const completeJob = vi.fn<() => Promise<JobRecord>>(async () => {
      throw new Error("a cancelled job must not be acknowledged");
    });
    const queue = createDurableJobQueue(
      {
        enqueueJob: async (job) => job,
        claimNextJob: async () => claimed,
        completeJob,
        retryJob: async () => claimed,
        deadLetterJob: async () => claimed
      },
      { runnerId }
    );

    let resolveStarted!: () => void;
    const started = new Promise<void>((resolve) => {
      resolveStarted = resolve;
    });
    let releaseHandler!: () => void;
    const release = new Promise<void>((resolve) => {
      releaseHandler = resolve;
    });

    const processing = processNextDurableJob({
      queue,
      cancellation: {
        readLatest: async () => snapshot,
        pollIntervalMs: 5
      },
      handlers: {
        docs_render: async () => {
          // Intentionally ignore the abort signal.
          resolveStarted();
          await release;
        }
      }
    });

    await started;
    snapshot = JobRecordSchema.parse({
      ...claimed,
      status: "cancelled",
      claimedBy: null,
      claimedAt: null,
      leaseExpiresAt: null
    });
    // Let the handler finish "successfully" shortly after the cancel is observed.
    setTimeout(() => releaseHandler(), 15);

    const result = await processing;
    expect(result.finalJob?.status).toBe("cancelled");
    expect(completeJob).not.toHaveBeenCalled();
  });

  it("aborts and abandons an in-flight job whose lease was taken over by another worker", async () => {
    const runnerId = "durability-takeover-runner";
    const claimed = claimedRunningJob(runnerId);
    let snapshot: JobRecord = claimed;

    const completeJob = vi.fn<() => Promise<JobRecord>>(async () => {
      throw new Error("a job owned by another worker must not be acknowledged");
    });
    const queue = createDurableJobQueue(
      {
        enqueueJob: async (job) => job,
        claimNextJob: async () => claimed,
        completeJob,
        retryJob: async () => claimed,
        deadLetterJob: async () => claimed
      },
      { runnerId }
    );

    let sawAbort = false;
    let resolveStarted!: () => void;
    const started = new Promise<void>((resolve) => {
      resolveStarted = resolve;
    });
    let releaseHandler!: () => void;
    const release = new Promise<void>((resolve) => {
      releaseHandler = resolve;
    });

    const processing = processNextDurableJob({
      queue,
      cancellation: {
        readLatest: async () => snapshot,
        pollIntervalMs: 5
      },
      handlers: {
        docs_render: async (_job, context) => {
          context?.signal.addEventListener(
            "abort",
            () => {
              sawAbort = true;
              releaseHandler();
            },
            { once: true }
          );
          resolveStarted();
          await release;
        }
      }
    });

    await started;
    // Another worker reclaims the expired lease: same job, different owner.
    snapshot = JobRecordSchema.parse({
      ...claimed,
      claimedBy: "rival-runner",
      leaseExpiresAt: new Date(Date.now() + 30_000).toISOString()
    });

    const result = await processing;
    expect(sawAbort).toBe(true);
    expect(result.finalJob?.claimedBy).toBe("rival-runner");
    expect(completeJob).not.toHaveBeenCalled();
  });

  it("aborts a running job cancelled by operator control end to end and leaves it cancelled", async () => {
    const repository = await createDurabilityRepository();
    const runnerId = "durability-integration-cancel-runner";
    const goalId = "goal-durability-cancel";
    const queue = createDurableJobQueue(repository, { runnerId, leaseMs: 30_000 });

    await repository.enqueueJob(
      createJobRecord({
        userId: DEFAULT_OWNER_USER_ID,
        kind: "goal_create",
        actorContext: createSystemActorContext(DEFAULT_OWNER_USER_ID),
        idempotencyKey: "durability-integration-cancel",
        payload: {
          type: "goal_create",
          goalId,
          workflowId: "workflow-durability-cancel",
          request: "Exercise in-attempt cancellation.",
          workspaceId: null,
          agentId: null,
          metadata: {}
        }
      })
    );

    let sawAbort = false;
    let resolveStarted!: () => void;
    const started = new Promise<void>((resolve) => {
      resolveStarted = resolve;
    });
    let releaseHandler!: () => void;
    const release = new Promise<void>((resolve) => {
      releaseHandler = resolve;
    });

    const processing = processNextDurableJob({
      queue,
      cancellation: {
        readLatest: (job) => repository.getJob(job.id, job.userId),
        pollIntervalMs: 10
      },
      handlers: {
        goal_create: async (_job, context) => {
          context?.signal.addEventListener(
            "abort",
            () => {
              sawAbort = true;
              releaseHandler();
            },
            { once: true }
          );
          resolveStarted();
          await release;
        }
      }
    });

    await started;
    const cancelled = await repository.cancelJobsForGoal({ goalId, reason: "operator cancelled mid-flight" });
    expect(cancelled).toHaveLength(1);

    const result = await processing;
    expect(sawAbort).toBe(true);
    expect(result.finalJob?.status).toBe("cancelled");

    const persisted = await repository.getJob(result.claimedJob!.id, DEFAULT_OWNER_USER_ID);
    expect(persisted?.status).toBe("cancelled");
    expect(persisted?.completedAt).toBeNull();
  });
});
