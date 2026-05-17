import { readFile } from "node:fs/promises";
import path from "node:path";
import { runDeploymentAsyncCanary } from "./lib/deployment-async-canary";
import { runDeploymentSmoke } from "./lib/deployment-smoke";
import {
  evaluateRolloutGateManifest,
  readTelemetryExportBatches,
  summarizeTelemetryRetention,
  type RolloutGateManifest
} from "../packages/observability/src/rollout-gates";

function requireEnv(name: string): string {
  const value = process.env[name]?.trim();

  if (!value) {
    throw new Error(`${name} must be configured.`);
  }

  return value;
}

function readPositiveIntEnv(name: string): number | undefined {
  const value = process.env[name]?.trim();

  if (!value) {
    return undefined;
  }

  const parsed = Number.parseInt(value, 10);

  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error(`${name} must be a positive integer when configured.`);
  }

  return parsed;
}

async function readRolloutGateEvidence() {
  const retentionDir = process.env.AGENTIC_TELEMETRY_RETENTION_DIR?.trim();

  if (!retentionDir) {
    return null;
  }

  const manifestPath =
    process.env.AGENTIC_TELEMETRY_ROLLOUT_MANIFEST?.trim() ||
    path.join(process.cwd(), "config", "observability", "alerts.json");
  const manifest = JSON.parse(await readFile(manifestPath, "utf8")) as RolloutGateManifest;
  const batches = await readTelemetryExportBatches(retentionDir);
  const evaluation = evaluateRolloutGateManifest(manifest, batches);

  return {
    manifestPath,
    retention: summarizeTelemetryRetention(retentionDir, batches),
    evaluation
  };
}

async function main() {
  const baseUrl = requireEnv("AGENTIC_SMOKE_BASE_URL");
  const accessKey = requireEnv("AGENTIC_SMOKE_ACCESS_KEY");
  const smoke = await runDeploymentSmoke({
    baseUrl,
    accessKey,
    requestId: process.env.AGENTIC_DEPLOYMENT_CONFIDENCE_REQUEST_ID?.trim(),
    traceId: process.env.AGENTIC_DEPLOYMENT_CONFIDENCE_TRACE_ID?.trim()
  });
  const canary = await runDeploymentAsyncCanary({
    baseUrl,
    accessKey,
    timeoutMs: readPositiveIntEnv("AGENTIC_DEPLOYMENT_ASYNC_CANARY_TIMEOUT_MS"),
    pollIntervalMs: readPositiveIntEnv("AGENTIC_DEPLOYMENT_ASYNC_CANARY_POLL_INTERVAL_MS"),
    requestId: smoke.requestId,
    traceId: smoke.traceId
  });
  const rolloutGate = await readRolloutGateEvidence();

  if (rolloutGate && !rolloutGate.evaluation.passed) {
    process.exitCode = 1;
  }

  console.log(
    JSON.stringify(
      {
        ok: !rolloutGate || rolloutGate.evaluation.passed,
        smoke,
        canary,
        rolloutGate
      },
      null,
      2
    )
  );
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : "Deployment confidence validation failed.");
  process.exitCode = 1;
});
