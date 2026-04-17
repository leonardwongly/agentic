import { mkdtemp } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { SYSTEM_USER_ID, createSystemActorContext } from "@agentic/contracts";
import { createJobRecord } from "@agentic/execution";
import { getTelemetrySnapshot, resetTelemetrySnapshot } from "@agentic/observability";
import { createRepository } from "@agentic/repository";
import { createSelfImprovementRepository } from "@agentic/self-improvement-memory";
import { runWorkerRuntime } from "@agentic/worker-runtime";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) {
    throw new Error(message);
  }
}

const originalTelemetryConsole = process.env.AGENTIC_TELEMETRY_CONSOLE;

async function main() {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "agentic-observability-failure-"));
  const repository = createRepository({
    storePath: path.join(tempDir, "runtime-store.json")
  });
  const selfImprovementRepository = createSelfImprovementRepository({
    baseDir: path.join(tempDir, "self-improvement")
  });

  process.env.AGENTIC_TELEMETRY_CONSOLE = "off";
  resetTelemetrySnapshot();
  await Promise.all([
    repository.seedDefaults(SYSTEM_USER_ID),
    selfImprovementRepository.seed()
  ]);

  const job = createJobRecord({
    userId: SYSTEM_USER_ID,
    kind: "goal_create",
    actorContext: createSystemActorContext(SYSTEM_USER_ID),
    maxAttempts: 1,
    payload: {
      type: "goal_create",
      goalId: "observability-failure-goal",
      workflowId: "observability-failure-workflow",
      request: "Trigger a deterministic worker failure.",
      workspaceId: null,
      agentId: null,
      metadata: {}
    }
  });
  const originalSaveGoalBundle = repository.saveGoalBundle.bind(repository);

  repository.saveGoalBundle = async (...args) => {
    if (args[0]?.goal.id === "observability-failure-goal") {
      throw new Error("Synthetic persistence failure token=super-secret-value");
    }

    return originalSaveGoalBundle(...args);
  };

  await repository.enqueueJob(job);

  const result = await runWorkerRuntime({
    repository,
    selfImprovementRepository,
    runnerId: "observability-failure-worker",
    maxJobs: 1,
    pollIntervalMs: 50
  });
  const storedJob = await repository.getJob(job.id, SYSTEM_USER_ID);
  const snapshot = getTelemetrySnapshot();
  const serialized = JSON.stringify(snapshot);

  assert(result.processedCount === 1, `Expected one processed job, received ${result.processedCount}.`);
  assert(storedJob?.status === "dead_letter", `Expected job ${job.id} to dead-letter, received ${storedJob?.status}.`);
  assert(
    snapshot.logs.some((entry) => entry.message === "worker.job.failed" && entry.context.jobId === job.id),
    "Missing worker.job.failed log."
  );
  assert(
    snapshot.metrics.some(
      (entry) =>
        entry.name === "durable_job.dead_letter.total" &&
        entry.attributes.jobKind === "goal_create" &&
        entry.context.runnerId === "observability-failure-worker"
    ),
    "Missing durable_job.dead_letter.total metric."
  );
  assert(!serialized.includes("super-secret-value"), "Failure telemetry leaked an unredacted secret.");

  console.log(JSON.stringify({
    ok: true,
    jobId: job.id,
    status: storedJob?.status,
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
