import { mkdtemp } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import {
  DEFAULT_OWNER_USER_ID,
  JobRecordSchema,
  createSystemActorContext,
  type JobRecord
} from "@agentic/contracts";
import {
  computeJobRetryDelayMs,
  createDurableJobQueue,
  createJobRecord,
  processNextDurableJob,
  type JobQueueStore
} from "@agentic/execution";
import { JobMutationError, createRepository } from "@agentic/repository";
import {
  claimNextJobFromStoreWithOutcome,
  claimNextJobWithClient
} from "../packages/repository/src/repository-job-claim";

// ---------------------------------------------------------------------------
// Adversarial sweep #1: durable job state machine + queue settlement races.
//
// Where execution.test.ts and worker-runtime-durability.test.ts exercise the
// happy paths (legal transitions, transient failure -> retry -> recovery,
// in-attempt cancellation), this file attacks the same contract from the
// hostile side: concurrent claims, zombie-worker late settlements, replayed
// settle calls on terminal records, poison throws, numeric boundaries of the
// retry math, and lease-takeover loops that out-run the attempt cap.
//
// Everything is driven by injected ISO timestamps ("now") and in-process
// fakes; no network, no Postgres, no wall-clock dependence.
// ---------------------------------------------------------------------------

const T0 = "2026-04-16T03:00:00.000Z";

function at(offsetMs: number): string {
  return new Date(Date.parse(T0) + offsetMs).toISOString();
}

async function createJobRepository() {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "agentic-adversarial-execution-"));
  const repository = createRepository({
    storePath: path.join(tempDir, "runtime-store.json")
  });
  await repository.seedDefaults(DEFAULT_OWNER_USER_ID);
  return repository;
}

function docsJob(
  idempotencyKey: string,
  overrides?: { maxAttempts?: number; availableAt?: string; id?: string }
): JobRecord {
  return createJobRecord({
    userId: DEFAULT_OWNER_USER_ID,
    kind: "docs_render",
    actorContext: createSystemActorContext(DEFAULT_OWNER_USER_ID),
    idempotencyKey,
    maxAttempts: overrides?.maxAttempts,
    availableAt: overrides?.availableAt,
    payload: {
      type: "docs_render",
      metadata: {}
    }
  });
}

function noHandlerStore(jobs: JobRecord[]): JobQueueStore & { jobs: JobRecord[] } {
  const ledger = [...jobs];

  return {
    jobs: ledger,
    async enqueueJob(job) {
      return job;
    },
    async claimNextJob() {
      return ledger[0] ?? null;
    },
    async completeJob({ jobId, runnerId, completedAt }) {
      return JobRecordSchema.parse({
        ...ledger.find((job) => job.id === jobId)!,
        status: "completed",
        claimedBy: runnerId,
        completedAt: completedAt ?? T0,
        leaseExpiresAt: null
      });
    },
    async retryJob({ jobId, availableAt, error }) {
      return JobRecordSchema.parse({
        ...ledger.find((job) => job.id === jobId)!,
        status: "retrying",
        claimedBy: null,
        claimedAt: null,
        leaseExpiresAt: null,
        availableAt,
        lastError: error
      });
    },
    async deadLetterJob({ jobId, deadLetteredAt, error }) {
      return JobRecordSchema.parse({
        ...ledger.find((job) => job.id === jobId)!,
        status: "dead_letter",
        leaseExpiresAt: null,
        deadLetteredAt: deadLetteredAt ?? T0,
        lastError: error
      });
    }
  };
}

function claimedRunningJob(runnerId: string, overrides?: { attemptCount?: number; maxAttempts?: number }): JobRecord {
  return JobRecordSchema.parse({
    ...docsJob("adversarial-claimed", { maxAttempts: overrides?.maxAttempts ?? 3 }),
    status: "running",
    attemptCount: overrides?.attemptCount ?? 1,
    claimedBy: runnerId,
    claimedAt: T0,
    lastAttemptAt: T0,
    leaseExpiresAt: at(30_000)
  });
}

describe("adversarial durable job state machine", () => {
  it("never hands the same queued job to two competing claimants under concurrent claims", async () => {
    // Two repository instances over one store model two worker processes; the
    // per-instance mutation mutex does not protect them from each other, so this
    // is the real double-claim race.
    const tempDir = await mkdtemp(path.join(os.tmpdir(), "agentic-adversarial-claim-"));
    const storePath = path.join(tempDir, "runtime-store.json");
    const repositoryA = createRepository({ storePath });
    const repositoryB = createRepository({ storePath });
    await repositoryA.seedDefaults(DEFAULT_OWNER_USER_ID);

    const enqueued = await Promise.all(
      ["race-1", "race-2", "race-3"].map((key) => repositoryA.enqueueJob(docsJob(key, { availableAt: T0 })))
    );
    const queueA = createDurableJobQueue(repositoryA, { runnerId: "racer-A", leaseMs: 30_000 });
    const queueB = createDurableJobQueue(repositoryB, { runnerId: "racer-B", leaseMs: 30_000 });

    const claims = await Promise.all([
      queueA.claimNext({ now: T0 }),
      queueB.claimNext({ now: T0 }),
      queueA.claimNext({ now: T0 }),
      queueB.claimNext({ now: T0 }),
      queueA.claimNext({ now: T0 }),
      queueB.claimNext({ now: T0 })
    ]);

    const winners = claims.filter((claim): claim is JobRecord => claim !== null);
    expect(winners).toHaveLength(enqueued.length);
    expect(new Set(winners.map((job) => job.id)).size).toBe(enqueued.length);
    expect(claims.filter((claim) => claim === null)).toHaveLength(3);
    // Each job must show exactly one attempt, proving no job was claimed twice.
    expect(winners.map((job) => job.attemptCount)).toEqual([1, 1, 1]);
  });

  it("rejects a zombie worker's late acknowledgement at the exact lease-expiry boundary", async () => {
    const repository = await createJobRepository();
    const queueA = createDurableJobQueue(repository, { runnerId: "zombie-A", leaseMs: 1_000 });
    const queueB = createDurableJobQueue(repository, { runnerId: "takeover-B", leaseMs: 1_000 });
    const enqueued = await repository.enqueueJob(docsJob("zombie-ack", { availableAt: T0 }));

    const claimedA = await queueA.claimNext({ now: T0 });
    expect(claimedA?.claimedBy).toBe("zombie-A");

    // One millisecond before expiry the lease still protects the job.
    expect(await queueB.claimNext({ now: at(999) })).toBeNull();
    // At the exact expiry instant the boundary is inclusive: another worker takes over.
    const claimedB = await queueB.claimNext({ now: at(1_000) });
    expect(claimedB?.id).toBe(enqueued.id);
    expect(claimedB?.claimedBy).toBe("takeover-B");
    expect(claimedB?.attemptCount).toBe(2);

    // The stalled original worker finally returns and tries to acknowledge.
    await expect(queueA.acknowledge({ jobId: enqueued.id, now: at(1_500) })).rejects.toThrowError(JobMutationError);
    const stillRunning = await repository.getJob(enqueued.id, DEFAULT_OWNER_USER_ID);
    expect(stillRunning?.status).toBe("running");
    expect(stillRunning?.claimedBy).toBe("takeover-B");
    expect(stillRunning?.completedAt).toBeNull();

    const completed = await queueB.acknowledge({ jobId: enqueued.id, now: at(2_000) });
    expect(completed.status).toBe("completed");
  });

  it("commits exactly one completion when the same worker acknowledges twice concurrently", async () => {
    const repository = await createJobRepository();
    const queue = createDurableJobQueue(repository, { runnerId: "double-ack", leaseMs: 30_000 });
    const enqueued = await repository.enqueueJob(docsJob("double-ack", { availableAt: T0 }));
    expect(await queue.claimNext({ now: T0 })).not.toBeNull();

    const settled = await Promise.allSettled([
      queue.acknowledge({ jobId: enqueued.id, now: at(1_000) }),
      queue.acknowledge({ jobId: enqueued.id, now: at(1_000) })
    ]);

    const fulfilled = settled.filter((entry) => entry.status === "fulfilled");
    const rejected = settled.filter((entry) => entry.status === "rejected");
    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    expect((rejected[0] as PromiseRejectedResult).reason).toBeInstanceOf(JobMutationError);

    const persisted = await repository.getJob(enqueued.id, DEFAULT_OWNER_USER_ID);
    expect(persisted?.status).toBe("completed");
    expect(persisted?.journal.entries.filter((entry) => entry.state === "completed")).toHaveLength(1);
  });

  it("refuses every replayed settlement against a terminal job and leaves it untouched", async () => {
    const repository = await createJobRepository();
    const queue = createDurableJobQueue(repository, { runnerId: "replayer", leaseMs: 30_000 });
    const enqueued = await repository.enqueueJob(docsJob("terminal-replay", { availableAt: T0 }));
    await queue.claimNext({ now: T0 });
    const completed = await queue.acknowledge({ jobId: enqueued.id, now: at(1_000) });

    // A late/replayed worker callback must not be able to move completed -> anything.
    await expect(queue.acknowledge({ jobId: enqueued.id, now: at(2_000) })).rejects.toThrowError(/not currently running/);
    await expect(queue.fail({ job: completed, error: "replayed failure", now: at(3_000) })).rejects.toThrowError(
      /not currently running/
    );

    const persisted = await repository.getJob(enqueued.id, DEFAULT_OWNER_USER_ID);
    expect(persisted?.status).toBe("completed");
    expect(persisted?.completedAt).toBe(at(1_000));
    expect(persisted?.lastError).toBeNull();
    expect(persisted?.journal).toEqual(completed.journal);
  });

  it("dead-letters a job that spent its attempt budget instead of wedging the queue", async () => {
    // Regression: claimJobRecord() bumped attemptCount unconditionally with no
    // "attemptCount < maxAttempts" guard, while JobRecordSchema (attemptCount) and the
    // execution journal (attempt) both cap the counter at 25 - so the 26th lease takeover
    // threw a raw ZodError out of claimNextJob. The poison record sorted first, was never
    // dead-lettered, and permanently blocked every other job in scope.
    const repository = await createJobRepository();
    const queue = createDurableJobQueue(repository, { runnerId: "repeater", leaseMs: 1_000 });
    const poison = await repository.enqueueJob(docsJob("attempt-cap-poison", { availableAt: T0, maxAttempts: 25 }));
    const healthy = await repository.enqueueJob(docsJob("behind-the-poison", { availableAt: at(500) }));

    for (let attempt = 1; attempt <= 25; attempt += 1) {
      const claimed = await queue.claimNext({ now: at((attempt - 1) * 1_000) });
      expect(claimed?.id).toBe(poison.id);
      expect(claimed?.attemptCount).toBe(attempt);
    }

    // The 26th takeover refuses the exhausted job, dead-letters it on the spot and hands out
    // the healthy job that used to be stuck behind it - all inside the same tick.
    const recovered = await queue.claimNext({ now: at(25_000) });
    expect(recovered?.id).toBe(healthy.id);
    expect(recovered?.attemptCount).toBe(1);

    const persistedPoison = await repository.getJob(poison.id, DEFAULT_OWNER_USER_ID);
    expect(persistedPoison?.status).toBe("dead_letter");
    expect(persistedPoison?.attemptCount).toBe(25);
    expect(persistedPoison?.leaseExpiresAt).toBeNull();
    expect(persistedPoison?.deadLetteredAt).toBe(at(25_000));
    expect(persistedPoison?.lastError).toMatch(/attempt budget/i);
    expect(persistedPoison?.journal.entries.at(-1)?.state).toBe("dead_letter");

    // No wedge: the queue keeps answering instead of throwing on every cycle.
    expect(Date.parse(healthy.availableAt)).toBeLessThan(Date.parse(at(26_000)));
    expect(await queue.claimNext({ now: at(25_500) })).toBeNull();
  });

  it("skips a poison candidate that cannot be materialised instead of throwing on every tick", async () => {
    // Regression: a corrupt field made claimJobRecord() throw its raw ZodError straight out
    // of claimNextJob, so a poison record that sorted first broke every *other* job in scope.
    // The claim loop now skips it, and only surfaces the violation as a typed JobMutationError
    // on a tick that has nothing else to hand out.
    const poison = {
      ...docsJob("store-poison", { availableAt: T0 }),
      lastError: "x".repeat(2_000)
    } as unknown as JobRecord;
    const healthy = docsJob("store-healthy", { availableAt: at(100) });

    const outcome = claimNextJobFromStoreWithOutcome(
      { jobs: [poison, healthy] },
      { runnerId: "poison-reader", leaseMs: 1_000, now: at(1_000) }
    );

    expect(outcome.claimed?.id).toBe(healthy.id);
    expect(outcome.claimed?.attemptCount).toBe(1);
    expect(outcome.deadLettered).toHaveLength(0);

    expect(() =>
      claimNextJobFromStoreWithOutcome(
        { jobs: [poison] },
        { runnerId: "poison-reader", leaseMs: 1_000, now: at(1_000) }
      )
    ).toThrowError(JobMutationError);
  });

  it("applies the same attempt-budget guard and typed poison translation in the SQL claim path", async () => {
    // Regression: the Postgres claim had no `attempt_count < max_attempts` predicate at all,
    // so a lease takeover of an exhausted row reached the same ZodError wedge as the store path.
    const exhausted = JobRecordSchema.parse({
      ...docsJob("sql-poison", { availableAt: T0, maxAttempts: 2 }),
      status: "running",
      attemptCount: 2,
      claimedBy: "runner-that-died",
      claimedAt: T0,
      leaseExpiresAt: at(500)
    });
    const healthy = docsJob("sql-healthy", { availableAt: at(600) });
    const sql: string[] = [];
    const saved: JobRecord[] = [];
    let sweepServed = false;

    const mapRow = (row: Record<string, unknown>): JobRecord => {
      if (!row.job) {
        throw new Error("jobs row is missing its record payload");
      }
      return row.job as JobRecord;
    };
    const save = async (_client: unknown, job: JobRecord) => {
      saved.push(job);
    };
    const client = {
      query: async (text: string) => {
        sql.push(text);
        if (text.includes("attempt_count >= max_attempts")) {
          const rows = sweepServed ? [] : [{ job: exhausted }];
          sweepServed = true;
          return { rows };
        }
        if (text.includes("attempt_count < max_attempts")) {
          return { rows: [{ job: healthy }] };
        }
        return { rows: [] };
      }
    } as unknown as Parameters<typeof claimNextJobWithClient>[0];

    const claimed = await claimNextJobWithClient(
      client,
      { runnerId: "sql-worker", leaseMs: 1_000, now: at(1_000) },
      mapRow,
      save
    );

    expect(claimed?.id).toBe(healthy.id);
    expect(claimed?.attemptCount).toBe(1);
    expect(sql.join(" ")).toContain("attempt_count >= max_attempts");
    expect(sql.join(" ")).toContain("attempt_count < max_attempts");
    expect(saved.map((job) => [job.id, job.status])).toEqual([
      [exhausted.id, "dead_letter"],
      [healthy.id, "running"]
    ]);

    // A row that cannot be mapped at all is still a typed error, never a raw schema throw.
    const brokenClient = {
      query: async (text: string) => ({
        rows: text.includes("attempt_count < max_attempts") ? [{ corrupt: true }] : []
      })
    } as unknown as Parameters<typeof claimNextJobWithClient>[0];

    await expect(
      claimNextJobWithClient(brokenClient, { runnerId: "sql-worker", leaseMs: 1_000, now: at(1_000) }, mapRow, save)
    ).rejects.toBeInstanceOf(JobMutationError);
  });

  it("skips an unmaterialisable exhausted row in the SQL sweep instead of wedging the worker tick", async () => {
    // Regression: deadLetterExhaustedJobsWithClient re-threw on a mapJobRow failure, so a single
    // exhausted row that no longer parses rolled back the whole claim transaction and re-appeared
    // at the top of the next tick - permanently halting the Postgres queue. The sweep must skip
    // the poison row and keep draining, surfacing the residual error only on an idle tick.
    const healthy = docsJob("sql-sweep-healthy", { availableAt: at(600) });
    const mapRow = (row: Record<string, unknown>): JobRecord => {
      if (!row.job) {
        throw new Error("jobs row is missing its record payload");
      }
      return row.job as JobRecord;
    };

    const saved: JobRecord[] = [];
    const save = async (_client: unknown, job: JobRecord) => {
      saved.push(job);
    };

    let sweepCalls = 0;
    const client = {
      query: async (text: string) => {
        if (text.includes("attempt_count >= max_attempts")) {
          sweepCalls += 1;
          // First sweep select hits the poison row; once it is excluded the sweep is empty.
          return { rows: sweepCalls === 1 ? [{ id: "poison-exhausted", corrupt: true }] : [] };
        }
        if (text.includes("attempt_count < max_attempts")) {
          return { rows: [{ job: healthy }] };
        }
        return { rows: [] };
      }
    } as unknown as Parameters<typeof claimNextJobWithClient>[0];

    const claimed = await claimNextJobWithClient(
      client,
      { runnerId: "sql-worker", leaseMs: 1_000, now: at(1_000) },
      mapRow,
      save
    );

    // The queue kept draining: the healthy job was claimed and the poison row was NOT dead-lettered.
    expect(claimed?.id).toBe(healthy.id);
    expect(sweepCalls).toBeGreaterThanOrEqual(2);
    expect(saved.map((job) => job.id)).toEqual([healthy.id]);

    // When the sweep's poison row is the only thing in the queue and nothing can be claimed, the
    // deferred violation is still surfaced - as a typed error, not a raw schema throw.
    let idleSweepCalls = 0;
    const idleClient = {
      query: async (text: string) => {
        if (text.includes("attempt_count >= max_attempts")) {
          idleSweepCalls += 1;
          return { rows: idleSweepCalls === 1 ? [{ id: "poison-exhausted", corrupt: true }] : [] };
        }
        return { rows: [] };
      }
    } as unknown as Parameters<typeof claimNextJobWithClient>[0];

    await expect(
      claimNextJobWithClient(idleClient, { runnerId: "sql-worker", leaseMs: 1_000, now: at(1_000) }, mapRow, save)
    ).rejects.toBeInstanceOf(JobMutationError);
    // Only the healthy claim from the first half was ever persisted.
    expect(saved.map((job) => job.id)).toEqual([healthy.id]);
  });

  it("settles the job when the ownership re-read fails transiently", async () => {
    // Regression: settleIfOwnershipLost() awaited readLatest outside any try/catch, so a
    // single transient store read failure right after a *successful* handler rejected
    // processNextDurableJob without acknowledge/fail, leaving the job "running" until its
    // lease expired. An unreadable record is not evidence of lost ownership - the
    // cancellation poller already treats read failures that way.
    const runnerId = "settle-read-failure";
    const claimed = claimedRunningJob(runnerId);
    const completeJob = vi.fn<() => Promise<JobRecord>>(async () => claimed);
    const retryJob = vi.fn<() => Promise<JobRecord>>(async () => claimed);
    const queue = createDurableJobQueue(
      {
        enqueueJob: async (job) => job,
        claimNextJob: async () => claimed,
        completeJob,
        retryJob,
        deadLetterJob: async () => claimed
      },
      { runnerId }
    );

    let reads = 0;
    const result = processNextDurableJob({
      queue,
      cancellation: {
        readLatest: async () => {
          reads += 1;
          throw new Error("transient store read failure");
        },
        pollIntervalMs: 5
      },
      handlers: {
        docs_render: async () => {}
      }
    });

    const outcome = await result;

    expect(outcome.claimedJob?.id).toBe(claimed.id);
    expect(reads).toBeGreaterThan(0);
    expect(completeJob).toHaveBeenCalledTimes(1);
    expect(retryJob).not.toHaveBeenCalled();
  });

  it("preserves the real handler error when the ownership re-read also fails", async () => {
    // Regression: the read failure used to replace the handler rejection, so the tick threw
    // "store unavailable", never reached queue.fail, and the attempt lost its real cause.
    const runnerId = "masked-handler-error";
    const claimed = claimedRunningJob(runnerId, { maxAttempts: 3 });
    const retryErrors: string[] = [];
    const retryJob = vi.fn<JobQueueStore["retryJob"]>(async (params) => {
      retryErrors.push(params.error);
      return claimed;
    });
    const queue = createDurableJobQueue(
      {
        enqueueJob: async (job) => job,
        claimNextJob: async () => claimed,
        completeJob: async () => claimed,
        retryJob,
        deadLetterJob: async () => claimed
      },
      { runnerId }
    );

    const outcome = await processNextDurableJob({
      queue,
      cancellation: {
        readLatest: async () => {
          throw new Error("store unavailable");
        },
        pollIntervalMs: 5
      },
      handlers: {
        docs_render: async () => {
          throw new Error("provider rejected the send");
        }
      }
    });

    expect(outcome.claimedJob?.id).toBe(claimed.id);
    expect(retryErrors).toHaveLength(1);
    expect(retryErrors[0]).toContain("provider rejected the send");
  });

  it("normalizes poison throws (undefined, string, non-Error object, blank, oversized) into bounded errors", async () => {
    const cases: Array<{ label: string; thrown: unknown; expected: string }> = [
      { label: "undefined", thrown: undefined, expected: "Job execution failed." },
      { label: "string", thrown: "raw string rejection", expected: "raw string rejection" },
      { label: "plain-object", thrown: { message: "not an Error instance" }, expected: "Job execution failed." },
      { label: "blank-message", thrown: new Error("   "), expected: "Job execution failed." },
      { label: "empty-object", thrown: {}, expected: "Job execution failed." },
      { label: "oversized", thrown: new Error(`x${"y".repeat(5_000)}`), expected: `x${"y".repeat(999)}` }
    ];

    for (const testCase of cases) {
      const claimed = claimedRunningJob("poison-runner", { maxAttempts: 3 });
      const queue = createDurableJobQueue(noHandlerStore([claimed]), {
        runnerId: "poison-runner",
        retryPolicy: { baseDelayMs: 0, factor: 1, maxDelayMs: 0 }
      });

      const result = await processNextDurableJob({
        queue,
        handlers: {
          docs_render: async () => {
            throw testCase.thrown;
          }
        }
      });

      expect(result.finalJob?.status, testCase.label).toBe("retrying");
      expect(result.finalJob?.lastError, testCase.label).toBe(testCase.expected);
      expect((result.finalJob?.lastError ?? "").length, testCase.label).toBeLessThanOrEqual(1_000);
    }
  });

  it("keeps retry backoff finite and clamped at numeric boundaries", () => {
    // attemptCount 0 (never attempted) and 1 (first attempt) must not differ.
    expect(computeJobRetryDelayMs(0, { baseDelayMs: 1_000 })).toBe(1_000);
    expect(computeJobRetryDelayMs(1, { baseDelayMs: 1_000 })).toBe(1_000);
    // Deep retry budgets must clamp, not overflow to Infinity/NaN.
    expect(computeJobRetryDelayMs(25, { baseDelayMs: 1_000, factor: 2, maxDelayMs: 60_000 })).toBe(60_000);
    expect(Number.isFinite(computeJobRetryDelayMs(25, { baseDelayMs: 1_000, factor: 2, maxDelayMs: 60_000 }))).toBe(true);
    // A misconfigured factor of 0 collapses the schedule to immediate retries.
    expect(computeJobRetryDelayMs(1, { baseDelayMs: 1_000, factor: 0 })).toBe(1_000);
    expect(computeJobRetryDelayMs(5, { baseDelayMs: 1_000, factor: 0 })).toBe(0);
    // Jitter is clamped to [0, 1] and the result stays inside [0, maxDelayMs].
    const jitterOptions = { baseDelayMs: 1_000, factor: 1, maxDelayMs: 1_000 };
    expect(computeJobRetryDelayMs(1, jitterOptions, { jitterRatio: 1, random: () => 0 })).toBe(0);
    expect(computeJobRetryDelayMs(1, jitterOptions, { jitterRatio: 1, random: () => 1 })).toBe(1_000);
    // Out-of-range jitter ratios clamp to [0, 1] instead of escaping the budget.
    expect(computeJobRetryDelayMs(1, jitterOptions, { jitterRatio: 5, random: () => 1 })).toBe(1_000);
    expect(computeJobRetryDelayMs(1, jitterOptions, { jitterRatio: -3, random: () => 0 })).toBe(1_000);
  });

  it("silently keeps the first payload when an idempotency key is reused after completion", async () => {
    // Dedupe is scoped to (userId, key) with no terminal-state or payload check:
    // a second, different request that lands on a reused key is dropped without an
    // error, while the same key under a different user stays independent.
    const repository = await createJobRepository();
    const queue = createDurableJobQueue(repository, { runnerId: "idempotency-reuser", leaseMs: 30_000 });
    const first = await repository.enqueueJob(docsJob("reuse-key", { availableAt: T0 }));
    await queue.claimNext({ now: T0 });
    await queue.acknowledge({ jobId: first.id, now: at(1_000) });

    const second = await repository.enqueueJob(docsJob("reuse-key"));
    expect(second.id).toBe(first.id);
    expect(second.status).toBe("completed");

    const jobs = await repository.listJobs({ limit: 50 });
    expect(jobs.filter((job) => job.id === first.id)).toHaveLength(1);

    const otherUser = createJobRecord({
      userId: "user-other",
      kind: "docs_render",
      idempotencyKey: "reuse-key",
      payload: { type: "docs_render", metadata: {} }
    });
    const crossUser = await repository.enqueueJob(otherUser);
    expect(crossUser.id).not.toBe(first.id);
  });

  it("serializes a shared concurrency key at the limit of 1 and ignores non-positive limits", async () => {
    const repository = await createJobRepository();
    const keys = Array.from({ length: 6 }, (_value, index) => `concurrency-${index}`);
    await Promise.all(keys.map((key) => repository.enqueueJob(docsJob(key, { availableAt: T0 }))));

    const queue = createDurableJobQueue(repository, {
      runnerId: "serialized",
      leaseMs: 30_000,
      concurrencyLimits: { maxRunningPerConcurrencyKey: 1 }
    });

    // All six jobs share one concurrency key (userId + kind), so only one may run.
    let running = 0;
    let completed = 0;

    for (let guard = 0; guard < 30; guard += 1) {
      const claimed = await queue.claimNext({ now: T0 });

      if (!claimed) {
        break;
      }

      running += 1;
      expect(running).toBe(1);
      await queue.acknowledge({ jobId: claimed.id, now: at(1_000) });
      running -= 1;
      completed += 1;
    }

    expect(completed).toBe(keys.length);

    // Boundary: 0 / negative / fractional limits are normalized to "no limit",
    // which means a typo'd limit silently removes the protection.
    const looseQueue = createDurableJobQueue(repository, {
      runnerId: "loose",
      leaseMs: 30_000,
      concurrencyLimits: { maxRunningPerConcurrencyKey: 0 }
    });
    await Promise.all(keys.map((key) => repository.enqueueJob(docsJob(`${key}-second-pass`, { availableAt: T0 }))));
    const unlimitedFirstClaim = await looseQueue.claimNext({ now: T0 });
    expect(unlimitedFirstClaim).not.toBeNull();
    // The claimed job is running but the zero limit must not block a second one.
    const secondClaim = await looseQueue.claimNext({ now: T0 });
    expect(secondClaim).not.toBeNull();
  });

  it("settles jobs whose kind the worker has no handler for instead of stranding them", async () => {
    // Version-skew poison: a job kind produced by a newer build lands in a queue that an
    // older worker drains. An empty handler registry must still settle every claim (retry
    // budget spent, then dead letter) rather than leaving the record "running" forever.
    const unknownKind = {
      ...claimedRunningJob("unknown-kind-runner", { maxAttempts: 3 }),
      kind: "not_a_real_kind" as unknown as JobRecord["kind"]
    };

    function recordingStore(job: JobRecord) {
      const calls = { completed: 0, retried: [] as string[], deadLettered: [] as string[] };
      const store: JobQueueStore = {
        enqueueJob: async (candidate) => candidate,
        claimNextJob: async () => job,
        completeJob: async () => {
          calls.completed += 1;
          return job;
        },
        retryJob: async ({ error }) => {
          calls.retried.push(error);
          return { ...job, status: "retrying" as const, lastError: error };
        },
        deadLetterJob: async ({ error }) => {
          calls.deadLettered.push(error);
          return { ...job, status: "dead_letter" as const, lastError: error };
        }
      };

      return { store, calls };
    }

    const retryable = recordingStore(unknownKind);
    const queue = createDurableJobQueue(retryable.store, { runnerId: "unknown-kind-runner" });

    const first = await processNextDurableJob({ queue, handlers: {} });

    expect(first.claimedJob?.kind).toBe("not_a_real_kind");
    expect(retryable.calls.completed).toBe(0);
    expect(retryable.calls.retried).toHaveLength(1);
    expect(first.finalJob?.lastError).toMatch(/No handler registered for durable job kind "not_a_real_kind"\./);

    // Zero-retry boundary: on the last attempt the same unknown kind dead-letters
    // immediately instead of being retried back into the queue that just rejected it.
    const exhausted = recordingStore({ ...unknownKind, attemptCount: 3 });
    const exhaustedQueue = createDurableJobQueue(exhausted.store, { runnerId: "unknown-kind-runner" });

    const second = await processNextDurableJob({
      queue: exhaustedQueue,
      handlers: { docs_render: async () => undefined }
    });

    expect(exhausted.calls.retried).toHaveLength(0);
    expect(exhausted.calls.deadLettered).toHaveLength(1);
    expect(second.finalJob?.status).toBe("dead_letter");
  });

  it("keys public share views by shareId, not the shared goalId, so the enqueue-time concurrency key cannot diverge from contracts", () => {
    // Regression: deriveJobSideEffectTarget() here kept the generic `"goalId" in payload`
    // branch ABOVE the public_share_view branch. Because PublicShareViewJobPayload carries
    // BOTH shareId and goalId, every view of one goal collapsed onto `goal:<id>`, serialising
    // unrelated share links behind a single concurrency key and making `share:<id>` dead code.
    // @agentic/contracts already resolved type-specific targets first; this locks the two
    // independent copies to the same ordering.
    const sharePayload = (shareId: string): JobRecord["payload"] => ({
      type: "public_share_view",
      shareId,
      goalId: "goal-shared",
      tokenFingerprint: "a1b2c3d4e5f6",
      viewedAt: T0,
      metadata: {}
    });

    const alpha = createJobRecord({ userId: "user-1", kind: "public_share_view", payload: sharePayload("share-alpha") });
    const beta = createJobRecord({ userId: "user-1", kind: "public_share_view", payload: sharePayload("share-beta") });

    expect(alpha.concurrencyKey).toBe("user-1:share:share-alpha");
    expect(beta.concurrencyKey).toBe("user-1:share:share-beta");
    expect(alpha.concurrencyKey).not.toBe(beta.concurrencyKey);
    expect(alpha.journal.sideEffectTarget).toBe("share:share-alpha");
  });

  it("clamps an over-long replayedFromJobId at enqueue time like contracts instead of throwing", () => {
    // Regression: execution's deriveReplayedFromJobId returned the unclamped value while
    // @agentic/contracts truncated to 200, so createJobRecord threw ZodError(too_big) on an
    // over-long legacy reference that JobRecordSchema.parse accepted - the enqueue path and the
    // read path disagreed. Both now clamp to the journal cap (max 200).
    const longRef = "job-replayed-from-".padEnd(250, "x");
    const record = createJobRecord({
      userId: "user-1",
      kind: "docs_render",
      payload: { type: "docs_render", metadata: { replayedFromJobId: longRef } }
    });

    expect(record.journal.replayedFromJobId).toHaveLength(200);
    expect(record.journal.replayedFromJobId).toBe(longRef.slice(0, 200));
  });
});
