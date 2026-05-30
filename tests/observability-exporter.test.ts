import { mkdtemp, readdir, readFile } from "node:fs/promises";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import {
  flushTelemetryPipeline,
  getTelemetryExportConfig,
  getTelemetryPipelineState,
  logError,
  logInfo,
  recordCounter,
  resetTelemetrySnapshot,
  withTelemetryContext
} from "@agentic/observability";

function restoreOptionalEnv(name: string, value: string | undefined) {
  if (value === undefined) {
    delete process.env[name];
    return;
  }

  process.env[name] = value;
}

describe("observability exporter", () => {
  const originalFetch = global.fetch;
  const originalExportUrl = process.env.AGENTIC_TELEMETRY_EXPORT_URL;
  const originalExportToken = process.env.AGENTIC_TELEMETRY_EXPORT_TOKEN;
  const originalAllowedHosts = process.env.AGENTIC_TELEMETRY_ALLOWED_HOSTS;
  const originalRawIdentifiers = process.env.AGENTIC_TELEMETRY_EXPORT_RAW_IDENTIFIERS;
  const originalRetentionDir = process.env.AGENTIC_TELEMETRY_RETENTION_DIR;
  const originalRetentionMaxFiles = process.env.AGENTIC_TELEMETRY_RETENTION_MAX_FILES;
  const originalBatchSize = process.env.AGENTIC_TELEMETRY_EXPORT_BATCH_SIZE;
  const originalInterval = process.env.AGENTIC_TELEMETRY_EXPORT_INTERVAL_MS;
  const originalTimeout = process.env.AGENTIC_TELEMETRY_EXPORT_TIMEOUT_MS;
  const originalConsole = process.env.AGENTIC_TELEMETRY_CONSOLE;
  const originalNodeEnv = process.env.NODE_ENV;

  afterEach(() => {
    global.fetch = originalFetch;
    restoreOptionalEnv("AGENTIC_TELEMETRY_EXPORT_URL", originalExportUrl);
    restoreOptionalEnv("AGENTIC_TELEMETRY_EXPORT_TOKEN", originalExportToken);
    restoreOptionalEnv("AGENTIC_TELEMETRY_ALLOWED_HOSTS", originalAllowedHosts);
    restoreOptionalEnv("AGENTIC_TELEMETRY_EXPORT_RAW_IDENTIFIERS", originalRawIdentifiers);
    restoreOptionalEnv("AGENTIC_TELEMETRY_RETENTION_DIR", originalRetentionDir);
    restoreOptionalEnv("AGENTIC_TELEMETRY_RETENTION_MAX_FILES", originalRetentionMaxFiles);
    restoreOptionalEnv("AGENTIC_TELEMETRY_EXPORT_BATCH_SIZE", originalBatchSize);
    restoreOptionalEnv("AGENTIC_TELEMETRY_EXPORT_INTERVAL_MS", originalInterval);
    restoreOptionalEnv("AGENTIC_TELEMETRY_EXPORT_TIMEOUT_MS", originalTimeout);
    restoreOptionalEnv("AGENTIC_TELEMETRY_CONSOLE", originalConsole);
    restoreOptionalEnv("NODE_ENV", originalNodeEnv);
    resetTelemetrySnapshot();
  });

  it("retains batches on disk and posts sanitized payloads to the configured backend", async () => {
    const retentionDir = await mkdtemp(path.join(os.tmpdir(), "agentic-export-retain-"));
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

    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", () => resolve()));
    const address = server.address();

    expect(address).not.toBeNull();
    expect(typeof address).toBe("object");

    process.env.AGENTIC_TELEMETRY_EXPORT_URL = `http://127.0.0.1:${(address as { port: number }).port}/telemetry`;
    process.env.AGENTIC_TELEMETRY_EXPORT_TOKEN = "exporter-test-token";
    process.env.AGENTIC_TELEMETRY_RETENTION_DIR = retentionDir;
    process.env.AGENTIC_TELEMETRY_EXPORT_BATCH_SIZE = "2";
    process.env.AGENTIC_TELEMETRY_EXPORT_TIMEOUT_MS = "1000";
    process.env.AGENTIC_TELEMETRY_CONSOLE = "off";
    resetTelemetrySnapshot();

    await withTelemetryContext({
      requestId: "req-exporter-test",
      userId: "user-exporter-test",
      workspaceId: "workspace-exporter-test"
    }, async () => {
      logInfo("telemetry.exporter.started");
      logError("telemetry.exporter.redaction", "token=super-secret-value");
      recordCounter("integration.call.total", 1, {
        provider: "exporter",
        outcome: "ok"
      });
    });

    await flushTelemetryPipeline();
    const files = (await readdir(retentionDir)).filter((entry) => entry.endsWith(".json"));
    const retainedBody = await readFile(path.join(retentionDir, files[0]!), "utf8");
    const state = getTelemetryPipelineState();

    expect(files.length).toBeGreaterThan(0);
    expect(requests.length).toBeGreaterThan(0);
    expect(requests.some((request) => request.authorization === "Bearer exporter-test-token")).toBe(true);
    expect(requests.every((request) => !request.body.includes("super-secret-value"))).toBe(true);
    expect(requests.every((request) => !request.body.includes("user-exporter-test"))).toBe(true);
    expect(requests.every((request) => !request.body.includes("workspace-exporter-test"))).toBe(true);
    expect(requests.some((request) => request.body.includes("sha256:"))).toBe(true);
    expect(retainedBody).not.toContain("super-secret-value");
    expect(retainedBody).not.toContain("user-exporter-test");
    expect(state.pendingItems).toBe(0);
    expect(state.lastFlushAt).toBeTruthy();
    expect(state.lastFlushError).toBeNull();

    await new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
  });

  it("keeps pending batches in memory when backend export fails and no retention path is configured", async () => {
    global.fetch = async () => {
      throw new Error("synthetic exporter outage");
    };
    process.env.AGENTIC_TELEMETRY_EXPORT_URL = "http://telemetry.invalid/unreachable";
    process.env.AGENTIC_TELEMETRY_EXPORT_BATCH_SIZE = "1";
    process.env.AGENTIC_TELEMETRY_EXPORT_TIMEOUT_MS = "25";
    process.env.AGENTIC_TELEMETRY_EXPORT_INTERVAL_MS = "25";
    process.env.AGENTIC_TELEMETRY_CONSOLE = "off";
    resetTelemetrySnapshot();

    logInfo("telemetry.exporter.failure");
    await flushTelemetryPipeline();

    const state = getTelemetryPipelineState();

    expect(state.pendingItems).toBeGreaterThan(0);
    expect(state.lastFlushError).toContain("backend export failed");
  });

  it("requires production telemetry exports to use approved HTTPS hosts", () => {
    process.env.NODE_ENV = "production";
    process.env.AGENTIC_TELEMETRY_EXPORT_URL = "https://attacker.example/telemetry";
    delete process.env.AGENTIC_TELEMETRY_ALLOWED_HOSTS;
    resetTelemetrySnapshot();

    expect(() => getTelemetryExportConfig()).toThrow(
      "AGENTIC_TELEMETRY_EXPORT_URL host must be listed in AGENTIC_TELEMETRY_ALLOWED_HOSTS in production."
    );

    process.env.AGENTIC_TELEMETRY_ALLOWED_HOSTS = "telemetry.example.com";
    process.env.AGENTIC_TELEMETRY_EXPORT_URL = "https://telemetry.example.com/telemetry";
    resetTelemetrySnapshot();

    expect(getTelemetryExportConfig()).toMatchObject({
      enabled: true,
      backendUrl: "https://telemetry.example.com/telemetry"
    });
  });

  it("prunes old retained batches beyond the configured retention window", async () => {
    const retentionDir = await mkdtemp(path.join(os.tmpdir(), "agentic-export-prune-"));

    process.env.AGENTIC_TELEMETRY_RETENTION_DIR = retentionDir;
    process.env.AGENTIC_TELEMETRY_RETENTION_MAX_FILES = "2";
    process.env.AGENTIC_TELEMETRY_EXPORT_BATCH_SIZE = "1";
    process.env.AGENTIC_TELEMETRY_CONSOLE = "off";
    resetTelemetrySnapshot();

    for (let index = 0; index < 3; index += 1) {
      logInfo(`telemetry.exporter.prune.${index}`);
      await flushTelemetryPipeline();
    }

    const files = (await readdir(retentionDir)).filter((entry) => entry.endsWith(".json")).sort();

    expect(files).toHaveLength(2);
  });
});
