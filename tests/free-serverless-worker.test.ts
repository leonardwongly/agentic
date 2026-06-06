import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, it, expect } from "vitest";
import { DEFAULT_OWNER_USER_ID, WorkerRuntimeHealthSnapshotSchema } from "@agentic/contracts";
import { createRepository } from "@agentic/repository";
import { createSelfImprovementRepository } from "@agentic/self-improvement-memory";
import {
  createRepositoryWorkerRuntimeHealthSink,
  createWorkerRuntimeHealthSnapshot,
  runWorkerRuntime,
  updateWorkerRuntimeHealthSnapshot
} from "@agentic/worker-runtime";

function snapshot(runnerId: string, overrides?: { updatedAt?: string; status?: "running" | "stopped" | "error" }) {
  const base = createWorkerRuntimeHealthSnapshot({ runnerId, status: overrides?.status ?? "running" });
  return overrides?.updatedAt
    ? updateWorkerRuntimeHealthSnapshot(base, { now: overrides.updatedAt, status: overrides?.status ?? "running" })
    : base;
}

async function createFileRepository() {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "agentic-free-serverless-"));
  const repository = createRepository({ storePath: path.join(tempDir, "runtime-store.json") });
  await repository.seedDefaults(DEFAULT_OWNER_USER_ID);
  return { repository, tempDir };
}

describe("WorkerRuntimeHealthSnapshotSchema", () => {
  it("accepts a well-formed snapshot and rejects malformed shapes", () => {
    const valid = createWorkerRuntimeHealthSnapshot({ runnerId: "runner-1", status: "running" });
    expect(WorkerRuntimeHealthSnapshotSchema.safeParse(valid).success).toBe(true);

    expect(WorkerRuntimeHealthSnapshotSchema.safeParse({ ...valid, version: 2 }).success).toBe(false);
    const { scheduler, ...withoutScheduler } = valid;
    void scheduler;
    expect(WorkerRuntimeHealthSnapshotSchema.safeParse(withoutScheduler).success).toBe(false);
  });
});

describe("worker runtime health repository store", () => {
  it("round-trips a heartbeat through the file-backed repository", async () => {
    const { repository, tempDir } = await createFileRepository();

    try {
      expect(await repository.getLatestWorkerRuntimeHealth()).toBeNull();

      const record = snapshot("runner-A");
      await repository.recordWorkerRuntimeHealth(record);

      const latest = await repository.getLatestWorkerRuntimeHealth();
      expect(latest?.runnerId).toBe("runner-A");
      expect(latest?.status).toBe("running");
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  });

  it("upserts by runnerId and returns the most recently updated heartbeat", async () => {
    const { repository, tempDir } = await createFileRepository();

    try {
      await repository.recordWorkerRuntimeHealth(snapshot("runner-A", { updatedAt: "2026-01-01T00:00:00.000Z" }));
      await repository.recordWorkerRuntimeHealth(snapshot("runner-A", { updatedAt: "2026-01-01T00:05:00.000Z" }));
      await repository.recordWorkerRuntimeHealth(snapshot("runner-B", { updatedAt: "2026-01-01T00:10:00.000Z" }));

      const latest = await repository.getLatestWorkerRuntimeHealth();
      expect(latest?.runnerId).toBe("runner-B");
      expect(latest?.updatedAt).toBe("2026-01-01T00:10:00.000Z");
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  });

  it("createRepositoryWorkerRuntimeHealthSink writes through the repository", async () => {
    const { repository, tempDir } = await createFileRepository();

    try {
      const sink = createRepositoryWorkerRuntimeHealthSink(repository);
      await sink.write(snapshot("runner-sink", { status: "stopped" }));

      const latest = await repository.getLatestWorkerRuntimeHealth();
      expect(latest?.runnerId).toBe("runner-sink");
      expect(latest?.status).toBe("stopped");
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  });
});

describe("run-once worker drain", () => {
  it("drains an empty queue immediately and records the DB heartbeat", async () => {
    const tempDir = await mkdtemp(path.join(os.tmpdir(), "agentic-free-serverless-drain-"));
    const repository = createRepository({ storePath: path.join(tempDir, "runtime-store.json") });
    const selfImprovementRepository = createSelfImprovementRepository({
      baseDir: path.join(tempDir, "self-improvement")
    });
    await Promise.all([repository.seedDefaults(DEFAULT_OWNER_USER_ID), selfImprovementRepository.seed()]);

    try {
      const result = await runWorkerRuntime({
        repository,
        selfImprovementRepository,
        runnerId: "drain-test",
        pollIntervalMs: 50,
        maxJobs: 5,
        stopWhenIdle: true,
        health: {
          sink: createRepositoryWorkerRuntimeHealthSink(repository),
          intervalMs: 250,
          schedulerEnabled: false
        }
      });

      expect(result.stopReason).toBe("drained");
      expect(result.processedCount).toBe(0);

      const heartbeat = await repository.getLatestWorkerRuntimeHealth();
      expect(heartbeat?.runnerId).toBe("drain-test");
      expect(heartbeat?.status).toBe("stopped");
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  });
});
