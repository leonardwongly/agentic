import { mkdtemp } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { SYSTEM_USER_ID, createSystemActorContext } from "@agentic/contracts";
import { sendNotification } from "@agentic/integrations";
import { getTelemetrySnapshot, resetTelemetrySnapshot } from "@agentic/observability";
import { createRepository } from "@agentic/repository";
import { createSelfImprovementRepository } from "@agentic/self-improvement-memory";
import { runWorkerRuntime } from "@agentic/worker-runtime";
import { POST as goalsCreateRoute } from "../apps/web/app/api/goals/route";
import { AGENTIC_ACCESS_KEY_HEADER } from "../apps/web/lib/auth";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) {
    throw new Error(message);
  }
}

const originalFetch = global.fetch;
const originalAccessKey = process.env.AGENTIC_ACCESS_KEY;
const originalRuntimeStorePath = process.env.AGENTIC_RUNTIME_STORE_PATH;
const originalSlackBotToken = process.env.SLACK_BOT_TOKEN;
const originalSlackSigningSecret = process.env.SLACK_SIGNING_SECRET;
const originalTelemetryConsole = process.env.AGENTIC_TELEMETRY_CONSOLE;

async function main() {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "agentic-observability-smoke-"));
  const storePath = path.join(tempDir, "runtime-store.json");

  process.env.AGENTIC_ACCESS_KEY = "test-access-key";
  process.env.AGENTIC_RUNTIME_STORE_PATH = storePath;
  process.env.SLACK_BOT_TOKEN = "xoxb-smoke-token";
  process.env.SLACK_SIGNING_SECRET = "smoke-signing-secret";
  process.env.AGENTIC_TELEMETRY_CONSOLE = "off";
  Reflect.set(globalThis, "__agenticRepository", undefined);
  Reflect.set(globalThis, "__agenticSelfImprovementRepository", undefined);
  resetTelemetrySnapshot();

  const enqueueResponse = await goalsCreateRoute(
    new Request("http://localhost/api/goals", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        [AGENTIC_ACCESS_KEY_HEADER]: "test-access-key",
        "x-request-id": "smoke-request-1"
      },
      body: JSON.stringify({
        request: "Prepare a weekly execution plan with observability validation."
      })
    })
  );
  const enqueuePayload = (await enqueueResponse.json()) as { job: { id: string } };
  assert(enqueueResponse.status === 202, `Expected 202 from goal creation route, received ${enqueueResponse.status}.`);
  assert(enqueueResponse.headers.get("x-request-id") === "smoke-request-1", "Missing x-request-id correlation header.");
  assert(enqueueResponse.headers.get("x-trace-id"), "Missing x-trace-id correlation header.");

  const repository = createRepository({ storePath });
  const selfImprovementRepository = createSelfImprovementRepository({
    baseDir: path.join(tempDir, "self-improvement")
  });

  await Promise.all([
    repository.seedDefaults(SYSTEM_USER_ID),
    selfImprovementRepository.seed()
  ]);

  const workerResult = await runWorkerRuntime({
    repository,
    selfImprovementRepository,
    runnerId: "observability-smoke-worker",
    maxJobs: 1,
    pollIntervalMs: 50
  });
  assert(workerResult.processedCount === 1, `Expected worker to process 1 job, received ${workerResult.processedCount}.`);

  global.fetch = (async () => {
    throw new Error("Slack smoke failure token=super-secret-value");
  }) as typeof fetch;

  await sendNotification({
    channel: "C-smoke",
    text: "Trigger deterministic provider failure telemetry."
  }).catch(() => undefined);

  const snapshot = getTelemetrySnapshot();
  const serialized = JSON.stringify(snapshot);

  assert(
    snapshot.logs.some((entry) => entry.message === "api.request.started" && entry.context.requestId === "smoke-request-1"),
    "Missing api.request.started log."
  );
  assert(
    snapshot.logs.some((entry) => entry.message === "worker.job.completed" && entry.context.runnerId === "observability-smoke-worker"),
    "Missing worker.job.completed log."
  );
  assert(
    snapshot.spans.some((entry) => entry.name === "durable_job.process" && entry.context.runnerId === "observability-smoke-worker"),
    "Missing durable_job.process span."
  );
  assert(
    snapshot.metrics.some((entry) => entry.name === "http.request.total" && entry.attributes.statusCode === 202),
    "Missing http.request.total metric."
  );
  assert(
    snapshot.metrics.some(
      (entry) =>
        entry.name === "integration.call.total" &&
        entry.attributes.provider === "slack" &&
        entry.attributes.outcome === "error"
    ),
    "Missing integration.call.total error metric for Slack."
  );
  assert(!serialized.includes("super-secret-value"), "Telemetry snapshot leaked an unredacted secret.");

  console.log(JSON.stringify({
    ok: true,
    storePath,
    processedJobId: enqueuePayload.job.id,
    counts: {
      logs: snapshot.logs.length,
      metrics: snapshot.metrics.length,
      spans: snapshot.spans.length
    }
  }, null, 2));
}

try {
  await main();
} finally {
  process.env.AGENTIC_ACCESS_KEY = originalAccessKey;
  process.env.AGENTIC_RUNTIME_STORE_PATH = originalRuntimeStorePath;
  process.env.SLACK_BOT_TOKEN = originalSlackBotToken;
  process.env.SLACK_SIGNING_SECRET = originalSlackSigningSecret;
  process.env.AGENTIC_TELEMETRY_CONSOLE = originalTelemetryConsole;
  global.fetch = originalFetch;
  Reflect.set(globalThis, "__agenticRepository", undefined);
  Reflect.set(globalThis, "__agenticSelfImprovementRepository", undefined);
}
