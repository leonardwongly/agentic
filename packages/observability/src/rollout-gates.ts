import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import type { TelemetryExportBatch, TelemetryMetric, TelemetryPrimitive } from "./index";

export type RolloutAlertOperator = "<=" | "<" | ">=" | ">" | "==" | "!=";
export type RolloutAlertAggregation = "sum" | "count" | "p95" | "max";

export type RolloutAlertDefinition = {
  key: string;
  title: string;
  metric: string;
  aggregation: RolloutAlertAggregation;
  operator: RolloutAlertOperator;
  threshold: number;
  filters?: Record<string, TelemetryPrimitive | TelemetryPrimitive[]>;
  minimumSamples?: number;
  severity: "warning" | "critical";
  rolloutGate: boolean;
  description?: string;
};

export type RolloutGateManifest = {
  version: 1;
  name: string;
  alerts: RolloutAlertDefinition[];
};

export type RolloutAlertResult = {
  key: string;
  title: string;
  severity: "warning" | "critical";
  rolloutGate: boolean;
  passed: boolean;
  actual: number;
  threshold: number;
  operator: RolloutAlertOperator;
  sampleCount: number;
  description?: string;
};

export type RolloutGateEvaluation = {
  passed: boolean;
  results: RolloutAlertResult[];
  metricsEvaluated: number;
  batchesEvaluated: number;
};

function matchesFilter(
  value: TelemetryPrimitive | undefined,
  expected: TelemetryPrimitive | TelemetryPrimitive[]
): boolean {
  if (Array.isArray(expected)) {
    return expected.some((candidate) => candidate === (value ?? null));
  }

  return expected === (value ?? null);
}

function metricMatches(metric: TelemetryMetric, alert: RolloutAlertDefinition): boolean {
  if (metric.name !== alert.metric) {
    return false;
  }

  if (!alert.filters) {
    return true;
  }

  return Object.entries(alert.filters).every(([key, expected]) => {
    const attributeValue = metric.attributes[key];
    const contextValue = metric.context[key as keyof typeof metric.context] ?? null;
    const candidate = attributeValue ?? contextValue;
    return matchesFilter(candidate, expected);
  });
}

function percentile(values: number[], ratio: number): number {
  if (values.length === 0) {
    return 0;
  }

  const sorted = [...values].sort((left, right) => left - right);
  const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil(sorted.length * ratio) - 1));
  return sorted[index] ?? 0;
}

function aggregateMetrics(metrics: TelemetryMetric[], aggregation: RolloutAlertAggregation): number {
  if (aggregation === "count") {
    return metrics.length;
  }

  if (aggregation === "sum") {
    return metrics.reduce((sum, metric) => sum + metric.value, 0);
  }

  if (aggregation === "max") {
    return metrics.reduce((max, metric) => Math.max(max, metric.value), 0);
  }

  return percentile(
    metrics.map((metric) => metric.value),
    0.95
  );
}

function compare(actual: number, operator: RolloutAlertOperator, threshold: number): boolean {
  switch (operator) {
    case "<":
      return actual < threshold;
    case "<=":
      return actual <= threshold;
    case ">":
      return actual > threshold;
    case ">=":
      return actual >= threshold;
    case "==":
      return actual === threshold;
    case "!=":
      return actual !== threshold;
  }
}

export async function readTelemetryExportBatches(retentionDir: string): Promise<TelemetryExportBatch[]> {
  const entries = (await readdir(retentionDir, { withFileTypes: true }))
    .filter((entry) => entry.isFile() && entry.name.endsWith(".json"))
    .map((entry) => entry.name)
    .sort();

  return Promise.all(
    entries.map(async (entryName) => {
      const raw = await readFile(path.join(retentionDir, entryName), "utf8");
      return JSON.parse(raw) as TelemetryExportBatch;
    })
  );
}

export function evaluateRolloutGateManifest(
  manifest: RolloutGateManifest,
  batches: TelemetryExportBatch[]
): RolloutGateEvaluation {
  const metrics = batches.flatMap((batch) =>
    batch.items
      .filter((item): item is Extract<TelemetryExportBatch["items"][number], { kind: "metric" }> => item.kind === "metric")
      .map((item) => item.entry)
  );
  const results = manifest.alerts.map((alert) => {
    const matchingMetrics = metrics.filter((metric) => metricMatches(metric, alert));
    const actual = aggregateMetrics(matchingMetrics, alert.aggregation);
    const sampleCount = matchingMetrics.length;
    const enoughSamples = sampleCount >= (alert.minimumSamples ?? 0);
    const passed = enoughSamples ? compare(actual, alert.operator, alert.threshold) : false;

    return {
      key: alert.key,
      title: alert.title,
      severity: alert.severity,
      rolloutGate: alert.rolloutGate,
      passed,
      actual,
      threshold: alert.threshold,
      operator: alert.operator,
      sampleCount,
      description: alert.description
    };
  });

  return {
    passed: results.every((result) => !result.rolloutGate || result.passed),
    results,
    metricsEvaluated: metrics.length,
    batchesEvaluated: batches.length
  };
}
