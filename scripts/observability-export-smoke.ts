import { mkdtemp, readdir, readFile } from "node:fs/promises";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import {
  flushTelemetryPipeline,
  getTelemetryPipelineState,
  logError,
  logInfo,
  recordCounter,
  recordHistogram,
  resetTelemetrySnapshot,
  withSpan,
  withTelemetryContext
} from "@agentic/observability";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) {
    throw new Error(message);
  }
}

const originalExportUrl = process.env.AGENTIC_TELEMETRY_EXPORT_URL;
const originalExportToken = process.env.AGENTIC_TELEMETRY_EXPORT_TOKEN;
const originalRetentionDir = process.env.AGENTIC_TELEMETRY_RETENTION_DIR;
const originalRetentionMaxFiles = process.env.AGENTIC_TELEMETRY_RETENTION_MAX_FILES;
const originalExportBatchSize = process.env.AGENTIC_TELEMETRY_EXPORT_BATCH_SIZE;
const originalExportInterval = process.env.AGENTIC_TELEMETRY_EXPORT_INTERVAL_MS;
const originalExportTimeout = process.env.AGENTIC_TELEMETRY_EXPORT_TIMEOUT_MS;
const originalTelemetryConsole = process.env.AGENTIC_TELEMETRY_CONSOLE;

function restoreOptionalEnv(name: string, value: string | undefined) {
  if (value === undefined) {
    delete process.env[name];
    return;
  }

  process.env[name] = value;
}

async function main() {
  const retentionDir =
    process.env.AGENTIC_TELEMETRY_RETENTION_DIR ??
    path.join(await mkdtemp(path.join(os.tmpdir(), "agentic-telemetry-export-")), "retained");
  const requests: Array<{ authorization: string | null; body: string }> = [];
  const server = http.createServer((request, response) => {
    const chunks: Buffer[] = [];

    request.on("data", (chunk) => {
      chunks.push(Buffer.from(chunk));
    });
    request.on("end", () => {
      requests.push({
        authorization: request.headers.authorization ?? null,
        body: Buffer.concat(chunks).toString("utf8")
      });
      response.writeHead(202, { "content-type": "application/json" });
      response.end(JSON.stringify({ ok: true }));
    });
  });

  try {
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", () => resolve()));
    const address = server.address();
    assert(address && typeof address === "object", "Failed to resolve observability smoke server address.");

    process.env.AGENTIC_TELEMETRY_EXPORT_URL = `http://127.0.0.1:${address.port}/telemetry`;
    process.env.AGENTIC_TELEMETRY_EXPORT_TOKEN = "observability-smoke-token";
    process.env.AGENTIC_TELEMETRY_RETENTION_DIR = retentionDir;
    process.env.AGENTIC_TELEMETRY_RETENTION_MAX_FILES = "4";
    process.env.AGENTIC_TELEMETRY_EXPORT_BATCH_SIZE = "3";
    process.env.AGENTIC_TELEMETRY_EXPORT_INTERVAL_MS = "10";
    process.env.AGENTIC_TELEMETRY_EXPORT_TIMEOUT_MS = "1000";
    process.env.AGENTIC_TELEMETRY_CONSOLE = "off";
    resetTelemetrySnapshot();

    await withTelemetryContext(
      {
        requestId: "observability-export-smoke",
        route: "observability.export.smoke",
        method: "POST",
        path: "/internal/observability/export-smoke"
      },
      async () => {
        logInfo("telemetry.export.smoke.started", {
          actor: "smoke"
        });
        recordCounter("integration.call.total", 1, {
          provider: "smoke",
          operation: "export",
          outcome: "ok"
        });
        recordCounter("http.request.total", 1, {
          route: "observability.export.smoke",
          method: "POST",
          path: "/internal/observability/export-smoke",
          statusCode: 200
        });
        recordHistogram("http.request.duration_ms", 180, {
          route: "observability.export.smoke",
          method: "POST",
          path: "/internal/observability/export-smoke"
        });
        recordHistogram("http.request.duration_ms", 240, {
          route: "observability.export.smoke",
          method: "POST",
          path: "/internal/observability/export-smoke"
        });
        await withSpan("telemetry.export.smoke.span", { mode: "smoke" }, async () => {
          logError("telemetry.export.smoke.redaction", "token=super-secret-value");
        });
      }
    );

    await flushTelemetryPipeline();
    await new Promise((resolve) => setTimeout(resolve, 25));
    const files = (await readdir(retentionDir)).filter((entry) => entry.endsWith(".json")).sort();
    assert(files.length >= 1, "Expected at least one retained telemetry batch.");
    assert(requests.length >= 1, "Expected at least one telemetry backend request.");
    assert(
      requests.some((entry) => entry.authorization === "Bearer observability-smoke-token"),
      "Missing telemetry backend bearer token."
    );

    const retainedBatches = await Promise.all(
      files.map(async (fileName) => {
        const retainedBatchRaw = await readFile(path.join(retentionDir, fileName), "utf8");
        return {
          raw: retainedBatchRaw,
          batch: JSON.parse(retainedBatchRaw) as { items: Array<{ kind: string; entry?: { name?: string } }> }
        };
      })
    );
    const retainedItemCount = retainedBatches.reduce((count, entry) => count + entry.batch.items.length, 0);

    assert(retainedItemCount >= 5, "Retained telemetry batches are missing exported items.");
    assert(
      retainedBatches.some((entry) => entry.batch.items.some((item) => item.kind === "metric" && item.entry?.name === "http.request.total")),
      "Retained telemetry batches are missing request count metrics."
    );
    assert(retainedBatches.every((entry) => !entry.raw.includes("super-secret-value")), "Retained telemetry batch leaked a secret.");
    assert(!requests[0]!.body.includes("super-secret-value"), "Telemetry backend payload leaked a secret.");

    console.log(
      JSON.stringify(
        {
          ok: true,
          retentionDir,
          retainedFiles: files.length,
          backendRequests: requests.length,
          pipeline: getTelemetryPipelineState()
        },
        null,
        2
      )
    );
  } finally {
    await new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
  }
}

try {
  await main();
} finally {
  restoreOptionalEnv("AGENTIC_TELEMETRY_EXPORT_URL", originalExportUrl);
  restoreOptionalEnv("AGENTIC_TELEMETRY_EXPORT_TOKEN", originalExportToken);
  restoreOptionalEnv("AGENTIC_TELEMETRY_RETENTION_DIR", originalRetentionDir);
  restoreOptionalEnv("AGENTIC_TELEMETRY_RETENTION_MAX_FILES", originalRetentionMaxFiles);
  restoreOptionalEnv("AGENTIC_TELEMETRY_EXPORT_BATCH_SIZE", originalExportBatchSize);
  restoreOptionalEnv("AGENTIC_TELEMETRY_EXPORT_INTERVAL_MS", originalExportInterval);
  restoreOptionalEnv("AGENTIC_TELEMETRY_EXPORT_TIMEOUT_MS", originalExportTimeout);
  restoreOptionalEnv("AGENTIC_TELEMETRY_CONSOLE", originalTelemetryConsole);
  resetTelemetrySnapshot();
}
