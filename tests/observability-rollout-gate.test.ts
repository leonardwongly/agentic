import { readFile } from "node:fs/promises";
import type { TelemetryExportBatch } from "@agentic/observability";
import {
  evaluateRolloutGateManifest,
  summarizeTelemetryRetention,
  type RolloutGateManifest
} from "../packages/observability/src/rollout-gates";

function createBatch(metrics: TelemetryExportBatch["items"]): TelemetryExportBatch {
  return {
    schemaVersion: 1,
    source: {
      service: "agentic-test",
      environment: "test",
      nodeEnv: "test"
    },
    batchId: crypto.randomUUID(),
    createdAt: new Date("2026-04-17T00:00:00.000Z").toISOString(),
    droppedCount: 0,
    items: metrics
  };
}

describe("observability rollout gate evaluator", () => {
  const manifest: RolloutGateManifest = {
    version: 1,
    name: "test rollout gate",
    alerts: [
      {
        key: "http-5xx",
        title: "HTTP 5xx errors",
        metric: "http.request.total",
        aggregation: "sum",
        operator: "<=",
        threshold: 0,
        filters: {
          outcome: "error",
          statusCode: [500, 502, 503]
        },
        severity: "critical",
        rolloutGate: true
      },
      {
        key: "http-p95",
        title: "HTTP latency p95",
        metric: "http.request.duration_ms",
        aggregation: "p95",
        operator: "<=",
        threshold: 1500,
        minimumSamples: 3,
        severity: "critical",
        rolloutGate: true
      },
      {
        key: "provider-errors",
        title: "Provider error advisory",
        metric: "integration.call.total",
        aggregation: "sum",
        operator: "<=",
        threshold: 0,
        filters: {
          outcome: "error",
          provider: "slack"
        },
        severity: "warning",
        rolloutGate: false
      }
    ]
  };

  it("passes when gate metrics stay inside thresholds", () => {
    const evaluation = evaluateRolloutGateManifest(manifest, [
      createBatch([
        {
          kind: "metric",
          entry: {
            timestamp: "2026-04-17T00:00:00.000Z",
            kind: "counter",
            name: "http.request.total",
            value: 1,
            attributes: {
              outcome: "ok",
              statusCode: 200
            },
            context: {
              route: "api.ready"
            }
          }
        },
        {
          kind: "metric",
          entry: {
            timestamp: "2026-04-17T00:00:01.000Z",
            kind: "histogram",
            name: "http.request.duration_ms",
            value: 140,
            attributes: {},
            context: {
              route: "api.ready"
            }
          }
        },
        {
          kind: "metric",
          entry: {
            timestamp: "2026-04-17T00:00:02.000Z",
            kind: "histogram",
            name: "http.request.duration_ms",
            value: 240,
            attributes: {},
            context: {
              route: "api.ready"
            }
          }
        },
        {
          kind: "metric",
          entry: {
            timestamp: "2026-04-17T00:00:03.000Z",
            kind: "histogram",
            name: "http.request.duration_ms",
            value: 400,
            attributes: {},
            context: {
              route: "api.ready"
            }
          }
        }
      ])
    ]);

    expect(evaluation.passed).toBe(true);
    expect(evaluation.metricsEvaluated).toBe(4);
    expect(evaluation.results).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          key: "http-5xx",
          passed: true,
          actual: 0
        }),
        expect.objectContaining({
          key: "http-p95",
          passed: true,
          actual: 400,
          sampleCount: 3
        })
      ])
    );
  });

  it("fails the rollout gate when critical error or latency thresholds are exceeded", () => {
    const evaluation = evaluateRolloutGateManifest(manifest, [
      createBatch([
        {
          kind: "metric",
          entry: {
            timestamp: "2026-04-17T00:00:00.000Z",
            kind: "counter",
            name: "http.request.total",
            value: 1,
            attributes: {
              outcome: "error",
              statusCode: 500
            },
            context: {
              route: "api.ready"
            }
          }
        },
        {
          kind: "metric",
          entry: {
            timestamp: "2026-04-17T00:00:01.000Z",
            kind: "histogram",
            name: "http.request.duration_ms",
            value: 900,
            attributes: {},
            context: {
              route: "api.ready"
            }
          }
        },
        {
          kind: "metric",
          entry: {
            timestamp: "2026-04-17T00:00:02.000Z",
            kind: "histogram",
            name: "http.request.duration_ms",
            value: 1600,
            attributes: {},
            context: {
              route: "api.ready"
            }
          }
        },
        {
          kind: "metric",
          entry: {
            timestamp: "2026-04-17T00:00:03.000Z",
            kind: "histogram",
            name: "http.request.duration_ms",
            value: 2400,
            attributes: {},
            context: {
              route: "api.ready"
            }
          }
        }
      ])
    ]);

    expect(evaluation.passed).toBe(false);
    expect(evaluation.results).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          key: "http-5xx",
          passed: false,
          actual: 1
        }),
        expect.objectContaining({
          key: "http-p95",
          passed: false,
          actual: 2400
        })
      ])
    );
  });

  it("treats missing minimum samples as a failed gate and keeps advisory alerts non-blocking", () => {
    const evaluation = evaluateRolloutGateManifest(manifest, [
      createBatch([
        {
          kind: "metric",
          entry: {
            timestamp: "2026-04-17T00:00:00.000Z",
            kind: "histogram",
            name: "http.request.duration_ms",
            value: 100,
            attributes: {},
            context: {
              route: "api.ready"
            }
          }
        },
        {
          kind: "metric",
          entry: {
            timestamp: "2026-04-17T00:00:01.000Z",
            kind: "counter",
            name: "integration.call.total",
            value: 2,
            attributes: {
              outcome: "error",
              provider: "slack"
            },
            context: {
              provider: "slack"
            }
          }
        }
      ])
    ]);

    expect(evaluation.passed).toBe(false);
    expect(evaluation.results).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          key: "http-p95",
          passed: false,
          sampleCount: 1
        }),
        expect.objectContaining({
          key: "provider-errors",
          passed: false,
          rolloutGate: false,
          actual: 2
        })
      ])
    );
  });

  it("summarizes retained telemetry batches for rollout evidence", () => {
    const batch = createBatch([
      {
        kind: "metric",
        entry: {
          timestamp: "2026-04-17T00:00:00.000Z",
          kind: "counter",
          name: "http.request.total",
          value: 1,
          attributes: {
            outcome: "ok"
          },
          context: {
            route: "api.ready"
          }
        }
      },
      {
        kind: "log",
        entry: {
          timestamp: "2026-04-17T00:00:01.000Z",
          level: "info",
          message: "api.request.completed",
          attributes: {},
          context: {
            route: "api.ready"
          }
        }
      }
    ]);
    const summary = summarizeTelemetryRetention("/tmp/agentic-telemetry", [
      {
        ...batch,
        droppedCount: 2
      }
    ]);

    expect(summary).toEqual({
      directory: "/tmp/agentic-telemetry",
      batchCount: 1,
      itemCount: 2,
      metricCount: 1,
      droppedCount: 2,
      oldestBatchAt: "2026-04-17T00:00:00.000Z",
      newestBatchAt: "2026-04-17T00:00:00.000Z",
      services: ["agentic-test"],
      environments: ["test"]
    });
  });

  it("defines cockpit rollout thresholds as critical gates in the checked-in manifest", async () => {
    const checkedInManifest = JSON.parse(
      await readFile(new URL("../config/observability/alerts.json", import.meta.url), "utf8")
    ) as RolloutGateManifest;
    const cockpitKeys = checkedInManifest.alerts
      .filter((alert) => alert.key.startsWith("cockpit-"))
      .map((alert) => alert.key)
      .sort();

    expect(cockpitKeys).toEqual([
      "cockpit-approval-latency",
      "cockpit-dead-letter-recovery",
      "cockpit-event-reconnects",
      "cockpit-first-meaningful-render",
      "cockpit-summary-latency",
      "cockpit-table-latency"
    ]);

    const evaluation = evaluateRolloutGateManifest(checkedInManifest, [
      createBatch([
        {
          kind: "metric",
          entry: {
            timestamp: "2026-04-17T00:00:00.000Z",
            kind: "histogram",
            name: "product.dashboard.first_meaningful_render_ms",
            value: 3200,
            attributes: {
              variant: "redesigned"
            },
            context: {}
          }
        }
      ])
    ]);

    expect(evaluation.results).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          key: "cockpit-first-meaningful-render",
          passed: false,
          actual: 3200,
          rolloutGate: true
        })
      ])
    );
    expect(evaluation.passed).toBe(false);
  });
});
