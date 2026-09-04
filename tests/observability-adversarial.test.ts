import { mkdtemp, readdir, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  flushTelemetryPipeline,
  getTelemetryPipelineState,
  getTelemetrySnapshot,
  logInfo,
  recordCounter,
  resetTelemetrySnapshot,
  sanitizeForTelemetry,
  sanitizeAttributes,
  withSpan,
  withTelemetryContext,
  emitActivityEvent,
  onActivityEvent,
  hashActionLog,
  createActionLog,
  type TelemetryExportBatch
} from "@agentic/observability";
import {
  evaluateRolloutGateManifest,
  type RolloutGateManifest
} from "../packages/observability/src/rollout-gates";
import { calculateNormalizedEditDistance } from "../packages/observability/src/edit-distance";

function restoreOptionalEnv(name: string, value: string | undefined) {
  if (value === undefined) {
    delete process.env[name];
    return;
  }
  process.env[name] = value;
}

describe("observability adversarial", () => {
  const originalFetch = global.fetch;
  const originalExportUrl = process.env.AGENTIC_TELEMETRY_EXPORT_URL;
  const originalRetentionDir = process.env.AGENTIC_TELEMETRY_RETENTION_DIR;
  const originalBatchSize = process.env.AGENTIC_TELEMETRY_EXPORT_BATCH_SIZE;
  const originalInterval = process.env.AGENTIC_TELEMETRY_EXPORT_INTERVAL_MS;
  const originalTimeout = process.env.AGENTIC_TELEMETRY_EXPORT_TIMEOUT_MS;
  const originalQueueLimit = process.env.AGENTIC_TELEMETRY_EXPORT_QUEUE_LIMIT;
  const originalConsole = process.env.AGENTIC_TELEMETRY_CONSOLE;

  beforeEach(() => {
    resetTelemetrySnapshot();
    process.env.AGENTIC_TELEMETRY_CONSOLE = "off";
  });

  afterEach(() => {
    global.fetch = originalFetch;
    restoreOptionalEnv("AGENTIC_TELEMETRY_EXPORT_URL", originalExportUrl);
    restoreOptionalEnv("AGENTIC_TELEMETRY_RETENTION_DIR", originalRetentionDir);
    restoreOptionalEnv("AGENTIC_TELEMETRY_EXPORT_BATCH_SIZE", originalBatchSize);
    restoreOptionalEnv("AGENTIC_TELEMETRY_EXPORT_INTERVAL_MS", originalInterval);
    restoreOptionalEnv("AGENTIC_TELEMETRY_EXPORT_TIMEOUT_MS", originalTimeout);
    restoreOptionalEnv("AGENTIC_TELEMETRY_EXPORT_QUEUE_LIMIT", originalQueueLimit);
    restoreOptionalEnv("AGENTIC_TELEMETRY_CONSOLE", originalConsole);
    resetTelemetrySnapshot();
  });

  describe("telemetry buffer overflow", () => {
    it("drops oldest items when the in-memory buffer exceeds the limit", () => {
      // The TELEMETRY_BUFFER_LIMIT is 1000. Generate more than that.
      for (let i = 0; i < 1_100; i++) {
        logInfo(`overflow-test-${i}`);
      }
      const snapshot = getTelemetrySnapshot();
      // Buffer should be trimmed to 1000
      expect(snapshot.logs.length).toBeLessThanOrEqual(1_000);
      // Oldest entries should have been dropped
      expect(snapshot.logs.find((l) => l.message === "overflow-test-0")).toBeUndefined();
      // Newest entries should still be present
      expect(snapshot.logs.find((l) => l.message === "overflow-test-1099")).toBeDefined();
    });

    it("drops oldest export queue items when queue limit is exceeded", async () => {
      process.env.AGENTIC_TELEMETRY_EXPORT_URL = "http://localhost:1/fake";
      process.env.AGENTIC_TELEMETRY_EXPORT_QUEUE_LIMIT = "10";
      process.env.AGENTIC_TELEMETRY_EXPORT_BATCH_SIZE = "100";
      process.env.AGENTIC_TELEMETRY_EXPORT_INTERVAL_MS = "60000";
      resetTelemetrySnapshot();

      for (let i = 0; i < 20; i++) {
        logInfo(`queue-overflow-${i}`);
      }

      const state = getTelemetryPipelineState();
      expect(state.pendingItems).toBeLessThanOrEqual(10);
      expect(state.droppedItems).toBeGreaterThan(0);
    });
  });

  describe("sensitive data redaction edge cases", () => {
    it("truncates objects beyond depth 5", () => {
      // depth 0: root, 1: a, 2: b, 3: c, 4: d, 5: e (object) → children at depth 6 get [TRUNCATED]
      const deep = { a: { b: { c: { d: { e: { f: "deep" } } } } } };
      const result = sanitizeForTelemetry(deep) as Record<string, unknown>;
      const eObj = ((((result as any).a as any).b as any).c as any).d as any;
      // e is at depth 5, its child f is at depth 6 → truncated
      expect(eObj.e.f).toBe("[TRUNCATED]");
    });

    it("redacts sensitive keys even at deep nesting levels", () => {
      const deep = { a: { b: { c: { d: { token: "secret" } } } } };
      const result = sanitizeForTelemetry(deep) as Record<string, unknown>;
      const level4 = (((result as any).a as any).b as any).c as any;
      // "token" key is redacted regardless of depth
      expect(level4.d.token).toBe("[REDACTED]");
    });

    it("handles circular references without crashing", () => {
      const circular: Record<string, unknown> = { name: "test" };
      circular.self = circular;
      // Should not throw
      const result = sanitizeForTelemetry(circular);
      expect(result).toBeDefined();
    });

    it("redacts bearer tokens in various formats", () => {
      const cases = [
        "Bearer eyJhbGciOiJIUzI1NiJ9.test",
        "token=my-secret-token",
        "password: hunter2",
        "api_key=sk_live_abc123"
      ];
      for (const input of cases) {
        const result = sanitizeForTelemetry(input);
        expect(result).toBe("[REDACTED]");
      }
    });

    it("sanitizeForTelemetry truncates long strings to 200 chars (fixed)", () => {
      // Previously sanitizeForTelemetry did NOT truncate long strings, only
      // toTelemetryPrimitive did. Fixed to truncate consistently.
      const longString = "x".repeat(300);
      const result = sanitizeForTelemetry(longString) as string;
      expect(result.length).toBe(200);
      expect(result.endsWith("...")).toBe(true);
    });

    it("toTelemetryPrimitive truncates long strings via attribute sanitization", () => {
      // When passed through sanitizeAttributes (which uses toTelemetryPrimitive),
      // long strings ARE truncated to 200 chars + "..."
      const result = sanitizeAttributes({ message: "x".repeat(300) });
      expect((result.message as string).length).toBe(200);
      expect((result.message as string).endsWith("...")).toBe(true);
    });

    it("sanitizes attributes with null, undefined, and non-primitive values", () => {
      const result = sanitizeAttributes({
        valid: "hello",
        nullVal: null,
        undefinedVal: undefined,
        numberVal: 42,
        boolVal: true,
        objectVal: { nested: true },
        arrayVal: [1, 2, 3],
        password: "should-be-redacted"
      });
      expect(result.valid).toBe("hello");
      expect(result.nullVal).toBeNull();
      expect(result.undefinedVal).toBeNull();
      expect(result.numberVal).toBe(42);
      expect(result.boolVal).toBe(true);
      expect(typeof result.objectVal).toBe("string"); // JSON stringified
      expect(typeof result.arrayVal).toBe("string"); // JSON stringified
      expect(result.password).toBe("[REDACTED]");
    });
  });

  describe("concurrent telemetry operations", () => {
    it("handles concurrent span nesting correctly", async () => {
      const results = await Promise.all(
        Array.from({ length: 10 }, (_, i) =>
          withSpan(`concurrent-span-${i}`, { index: i }, async () => {
            await new Promise((r) => setTimeout(r, 1));
            return i;
          })
        )
      );
      expect(results).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);
      const snapshot = getTelemetrySnapshot();
      const spans = snapshot.spans.filter((s) => s.name.startsWith("concurrent-span-"));
      expect(spans).toHaveLength(10);
      expect(spans.every((s) => s.status === "ok")).toBe(true);
    });

    it("records error spans without corrupting the context stack", async () => {
      try {
        await withSpan("failing-span", {}, async () => {
          throw new Error("intentional failure");
        });
      } catch {
        // expected
      }

      // Context should be clean after error
      const result = await withSpan("after-error-span", {}, async () => "ok");
      expect(result).toBe("ok");

      const snapshot = getTelemetrySnapshot();
      const failingSpan = snapshot.spans.find((s) => s.name === "failing-span");
      const afterSpan = snapshot.spans.find((s) => s.name === "after-error-span");
      expect(failingSpan?.status).toBe("error");
      expect(afterSpan?.status).toBe("ok");
    });
  });

  describe("activity event emitter resilience", () => {
    it("continues emitting when a handler throws", () => {
      const received: string[] = [];
      const unsub1 = onActivityEvent(() => {
        throw new Error("handler explosion");
      });
      const unsub2 = onActivityEvent((event) => {
        received.push(event.type);
      });

      const event = emitActivityEvent({
        type: "agent.started",
        actor: "test-agent",
        message: "test",
        details: {}
      });

      expect(event.id).toBeTruthy();
      expect(received).toContain("agent.started");

      unsub1();
      unsub2();
    });

    it("unsubscribing twice is safe", () => {
      const unsub = onActivityEvent(() => {});
      unsub();
      // Second unsubscribe should not throw
      expect(() => unsub()).not.toThrow();
    });
  });

  describe("rollout gate edge cases", () => {
    const minimalManifest: RolloutGateManifest = {
      version: 1,
      name: "adversarial",
      alerts: [
        {
          key: "zero-samples",
          title: "Zero samples test",
          metric: "nonexistent.metric",
          aggregation: "sum",
          operator: "<=",
          threshold: 0,
          minimumSamples: 1,
          severity: "critical",
          rolloutGate: true
        }
      ]
    };

    it("fails gates with zero matching metrics when minimumSamples > 0", () => {
      const evaluation = evaluateRolloutGateManifest(minimalManifest, []);
      expect(evaluation.passed).toBe(false);
      expect(evaluation.results[0]?.passed).toBe(false);
      expect(evaluation.results[0]?.sampleCount).toBe(0);
    });

    it("handles empty batches array gracefully", () => {
      const evaluation = evaluateRolloutGateManifest(minimalManifest, []);
      expect(evaluation.batchesEvaluated).toBe(0);
      expect(evaluation.metricsEvaluated).toBe(0);
    });

    it("handles batches with only non-metric items", () => {
      const batch: TelemetryExportBatch = {
        schemaVersion: 1,
        source: { service: "test", environment: "test", nodeEnv: "test" },
        batchId: "test",
        createdAt: new Date().toISOString(),
        droppedCount: 0,
        items: [
          {
            kind: "log",
            entry: {
              timestamp: new Date().toISOString(),
              level: "info",
              message: "test",
              attributes: {},
              context: {}
            }
          }
        ]
      };
      const evaluation = evaluateRolloutGateManifest(minimalManifest, [batch]);
      expect(evaluation.metricsEvaluated).toBe(0);
      expect(evaluation.passed).toBe(false);
    });

    it("p95 aggregation returns 0 for empty metric sets", () => {
      const manifest: RolloutGateManifest = {
        version: 1,
        name: "p95-empty",
        alerts: [
          {
            key: "p95-test",
            title: "P95 empty",
            metric: "missing",
            aggregation: "p95",
            operator: "<=",
            threshold: 100,
            severity: "warning",
            rolloutGate: false
          }
        ]
      };
      const evaluation = evaluateRolloutGateManifest(manifest, []);
      expect(evaluation.results[0]?.actual).toBe(0);
    });

    it("max aggregation returns 0 for empty metric sets", () => {
      const manifest: RolloutGateManifest = {
        version: 1,
        name: "max-empty",
        alerts: [
          {
            key: "max-test",
            title: "Max empty",
            metric: "missing",
            aggregation: "max",
            operator: "<=",
            threshold: 100,
            severity: "warning",
            rolloutGate: false
          }
        ]
      };
      const evaluation = evaluateRolloutGateManifest(manifest, []);
      expect(evaluation.results[0]?.actual).toBe(0);
    });
  });

  describe("edit distance adversarial", () => {
    it("throws on empty baseline", () => {
      expect(() =>
        calculateNormalizedEditDistance({ baseline: "", submitted: "hello" })
      ).toThrow("non-empty");
    });

    it("throws on whitespace-only inputs", () => {
      expect(() =>
        calculateNormalizedEditDistance({ baseline: "   ", submitted: "hello" })
      ).toThrow("non-empty");
    });

    it("handles unicode emoji correctly", () => {
      const result = calculateNormalizedEditDistance({
        baseline: "🎉🎊",
        submitted: "🎉🎊🎈"
      });
      expect(result.editDistance).toBe(1);
      expect(result.baselineLength).toBe(2);
      expect(result.submittedLength).toBe(3);
    });

    it("handles multi-byte CJK characters", () => {
      const result = calculateNormalizedEditDistance({
        baseline: "你好世界",
        submitted: "你好世间"
      });
      expect(result.editDistance).toBe(1);
      expect(result.normalizedEditDistance).toBe(0.25);
    });

    it("returns 0 distance for identical strings", () => {
      const result = calculateNormalizedEditDistance({
        baseline: "identical",
        submitted: "identical"
      });
      expect(result.editDistance).toBe(0);
      expect(result.normalizedEditDistance).toBe(0);
    });

    it("returns 1.0 normalized distance for completely different single-char strings", () => {
      const result = calculateNormalizedEditDistance({
        baseline: "a",
        submitted: "b"
      });
      expect(result.editDistance).toBe(1);
      expect(result.normalizedEditDistance).toBe(1);
    });
  });

  describe("export pipeline failure recovery", () => {
    it("re-enqueues items when both retention and backend fail", async () => {
      global.fetch = async () => {
        throw new Error("backend down");
      };
      process.env.AGENTIC_TELEMETRY_EXPORT_URL = "http://localhost:1/fail";
      process.env.AGENTIC_TELEMETRY_RETENTION_DIR = "/nonexistent/path/that/cannot/be/created";
      process.env.AGENTIC_TELEMETRY_EXPORT_BATCH_SIZE = "1";
      process.env.AGENTIC_TELEMETRY_EXPORT_TIMEOUT_MS = "50";
      resetTelemetrySnapshot();

      logInfo("recovery-test");
      await flushTelemetryPipeline();

      const state = getTelemetryPipelineState();
      // Items should be re-enqueued since both paths failed
      expect(state.pendingItems).toBeGreaterThan(0);
      expect(state.lastFlushError).toBeTruthy();
    });

    it("handles backend returning non-2xx status codes", async () => {
      global.fetch = async () => new Response("Internal Server Error", { status: 500 });
      process.env.AGENTIC_TELEMETRY_EXPORT_URL = "http://localhost:1/fail";
      process.env.AGENTIC_TELEMETRY_EXPORT_BATCH_SIZE = "1";
      process.env.AGENTIC_TELEMETRY_EXPORT_TIMEOUT_MS = "50";
      resetTelemetrySnapshot();

      logInfo("500-test");
      await flushTelemetryPipeline();

      const state = getTelemetryPipelineState();
      expect(state.lastFlushError).toContain("backend export failed");
    });
  });

  describe("hashActionLog determinism", () => {
    it("produces consistent hashes for the same input", () => {
      const log = createActionLog({
        goalId: "goal-1",
        actor: "user-1",
        kind: "task.completed",
        message: "done",
        details: { step: 1 }
      });
      const hash1 = hashActionLog(log);
      const hash2 = hashActionLog(log);
      expect(hash1).toBe(hash2);
    });

    it("produces different hashes for different logs", () => {
      const log1 = createActionLog({
        goalId: "goal-1",
        actor: "user-1",
        kind: "task.completed",
        message: "done",
        details: { step: 1 }
      });
      const log2 = createActionLog({
        goalId: "goal-2",
        actor: "user-1",
        kind: "task.completed",
        message: "done",
        details: { step: 1 }
      });
      expect(hashActionLog(log1)).not.toBe(hashActionLog(log2));
    });
  });
});
