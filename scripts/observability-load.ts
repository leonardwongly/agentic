import { mkdtemp } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { SYSTEM_USER_ID, createSystemActorContext } from "@agentic/contracts";
import { getTelemetrySnapshot, resetTelemetrySnapshot } from "@agentic/observability";
import { createRepository } from "@agentic/repository";
import { createSelfImprovementRepository } from "@agentic/self-improvement-memory";
import { enqueueGoalCreateJob, runWorkerRuntime } from "@agentic/worker-runtime";

function percentile(values: number[], ratio: number): number {
  if (values.length === 0) {
    return 0;
  }

  const sorted = [...values].sort((left, right) => left - right);
  const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil(sorted.length * ratio) - 1));
  return sorted[index] ?? 0;
}

function average(values: number[]): number {
  if (values.length === 0) {
    return 0;
  }

  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) {
    throw new Error(message);
  }
}

const originalTelemetryConsole = process.env.AGENTIC_TELEMETRY_CONSOLE;

async function main() {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "agentic-observability-load-"));
  const repository = createRepository({
    storePath: path.join(tempDir, "runtime-store.json")
  });
  const selfImprovementRepository = createSelfImprovementRepository({
    baseDir: path.join(tempDir, "self-improvement")
  });
  const rounds = 3;
  const jobsPerRound = 4;
  const enqueueDurations: number[] = [];
  const roundDurations: number[] = [];

  process.env.AGENTIC_TELEMETRY_CONSOLE = "off";
  resetTelemetrySnapshot();
  await Promise.all([
    repository.seedDefaults(SYSTEM_USER_ID),
    selfImprovementRepository.seed()
  ]);

  for (let round = 0; round < rounds; round += 1) {
    for (let index = 0; index < jobsPerRound; index += 1) {
      const started = performance.now();
      await enqueueGoalCreateJob({
        repository,
        userId: SYSTEM_USER_ID,
        request: `Load test job ${round + 1}-${index + 1}: build a safe weekly execution plan.`,
        workspaceId: null,
        agentId: null,
        actorContext: createSystemActorContext(SYSTEM_USER_ID),
        idempotencyKey: `observability-load-${round}-${index}`
      });
      enqueueDurations.push(performance.now() - started);
    }

    const roundStarted = performance.now();
    const result = await runWorkerRuntime({
      repository,
      selfImprovementRepository,
      runnerId: `observability-load-worker-${round + 1}`,
      maxJobs: jobsPerRound,
      pollIntervalMs: 50
    });
    roundDurations.push(performance.now() - roundStarted);
    assert(result.processedCount === jobsPerRound, `Expected ${jobsPerRound} processed jobs in round ${round + 1}.`);
  }

  const snapshot = getTelemetrySnapshot();
  const processedMetrics = snapshot.metrics.filter((entry) => entry.name === "worker.loop.processed.total");
  const completedMetrics = snapshot.metrics.filter((entry) => entry.name === "durable_job.completed.total");

  assert(processedMetrics.length === rounds * jobsPerRound, "Missing worker.loop.processed.total metrics during load run.");
  assert(completedMetrics.length === rounds * jobsPerRound, "Missing durable_job.completed.total metrics during load run.");

  console.log(JSON.stringify({
    ok: true,
    rounds,
    jobsPerRound,
    enqueueMs: {
      avg: Number(average(enqueueDurations).toFixed(2)),
      p95: Number(percentile(enqueueDurations, 0.95).toFixed(2)),
      max: Number(Math.max(...enqueueDurations).toFixed(2))
    },
    workerRoundMs: {
      avg: Number(average(roundDurations).toFixed(2)),
      p95: Number(percentile(roundDurations, 0.95).toFixed(2)),
      max: Number(Math.max(...roundDurations).toFixed(2))
    },
    telemetry: {
      logs: snapshot.logs.length,
      metrics: snapshot.metrics.length,
      spans: snapshot.spans.length
    }
  }, null, 2));
}

try {
  await main();
} finally {
  process.env.AGENTIC_TELEMETRY_CONSOLE = originalTelemetryConsole;
  Reflect.set(globalThis, "__agenticRepository", undefined);
  Reflect.set(globalThis, "__agenticSelfImprovementRepository", undefined);
}
