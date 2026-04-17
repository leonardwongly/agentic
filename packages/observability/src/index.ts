import { AsyncLocalStorage } from "node:async_hooks";
import crypto from "node:crypto";
import { mkdir, readdir, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { ActionLogSchema, nowIso, type ActionLog, type AgentDefinition } from "@agentic/contracts";

export type TelemetryPrimitive = string | number | boolean | null;

export type TelemetryAttributes = Record<string, TelemetryPrimitive>;

export type TelemetryContext = {
  requestId?: string;
  traceId?: string;
  spanId?: string;
  parentSpanId?: string | null;
  route?: string;
  method?: string;
  path?: string;
  jobId?: string;
  jobKind?: string;
  runnerId?: string;
  provider?: string;
  userId?: string;
  workspaceId?: string | null;
};

export type StructuredLogLevel = "info" | "warn" | "error";

export type StructuredLogEntry = {
  timestamp: string;
  level: StructuredLogLevel;
  message: string;
  attributes: TelemetryAttributes;
  context: TelemetryContext;
};

export type TelemetryMetric = {
  timestamp: string;
  kind: "counter" | "histogram";
  name: string;
  value: number;
  attributes: TelemetryAttributes;
  context: TelemetryContext;
};

export type TelemetrySpanStatus = "ok" | "error";

export type TelemetrySpanEntry = {
  name: string;
  timestamp: string;
  endedAt: string;
  durationMs: number;
  status: TelemetrySpanStatus;
  error?: string;
  attributes: TelemetryAttributes;
  context: TelemetryContext;
};

export type TelemetrySnapshot = {
  logs: StructuredLogEntry[];
  metrics: TelemetryMetric[];
  spans: TelemetrySpanEntry[];
};

export type TelemetryExportItem =
  | {
      kind: "log";
      entry: StructuredLogEntry;
    }
  | {
      kind: "metric";
      entry: TelemetryMetric;
    }
  | {
      kind: "span";
      entry: TelemetrySpanEntry;
    };

export type TelemetryExportBatch = {
  schemaVersion: 1;
  source: {
    service: string;
    environment: string;
    nodeEnv: string;
  };
  batchId: string;
  createdAt: string;
  droppedCount: number;
  items: TelemetryExportItem[];
};

export type TelemetryExportConfig = {
  enabled: boolean;
  backendUrl: string | null;
  backendToken: string | null;
  timeoutMs: number;
  batchSize: number;
  flushIntervalMs: number;
  retentionDir: string | null;
  retentionMaxFiles: number;
  queueLimit: number;
  serviceName: string;
  environment: string;
};

export type TelemetryPipelineState = {
  pendingItems: number;
  droppedItems: number;
  lastFlushAt: string | null;
  lastFlushError: string | null;
  config: TelemetryExportConfig;
};

const telemetryContextStore = new AsyncLocalStorage<TelemetryContext>();
const telemetrySnapshot: TelemetrySnapshot = {
  logs: [],
  metrics: [],
  spans: []
};
const TELEMETRY_BUFFER_LIMIT = 1_000;
const REQUEST_ID_HEADER = "x-request-id";
const TRACE_ID_HEADER = "x-trace-id";
const TELEMETRY_CONSOLE_ENV = "AGENTIC_TELEMETRY_CONSOLE";
const TELEMETRY_EXPORT_URL_ENV = "AGENTIC_TELEMETRY_EXPORT_URL";
const TELEMETRY_EXPORT_TOKEN_ENV = "AGENTIC_TELEMETRY_EXPORT_TOKEN";
const TELEMETRY_EXPORT_TIMEOUT_ENV = "AGENTIC_TELEMETRY_EXPORT_TIMEOUT_MS";
const TELEMETRY_EXPORT_BATCH_SIZE_ENV = "AGENTIC_TELEMETRY_EXPORT_BATCH_SIZE";
const TELEMETRY_EXPORT_INTERVAL_ENV = "AGENTIC_TELEMETRY_EXPORT_INTERVAL_MS";
const TELEMETRY_RETENTION_DIR_ENV = "AGENTIC_TELEMETRY_RETENTION_DIR";
const TELEMETRY_RETENTION_MAX_FILES_ENV = "AGENTIC_TELEMETRY_RETENTION_MAX_FILES";
const TELEMETRY_QUEUE_LIMIT_ENV = "AGENTIC_TELEMETRY_EXPORT_QUEUE_LIMIT";
const TELEMETRY_SERVICE_NAME_ENV = "AGENTIC_TELEMETRY_SERVICE_NAME";
const SENSITIVE_KEY_PATTERN =
  /(authorization|cookie|password|secret|token|refresh|access[_-]?key|api[_-]?key|session|signature|raw|body)/iu;
const SENSITIVE_VALUE_PATTERN =
  /\b(?:bearer\s+[a-z0-9._-]+|(?:token|secret|password|cookie|session|signature|access[_-]?key|api[_-]?key)\s*[=:]\s*[^\s,;]+)/iu;
const TELEMETRY_EXPORT_DEFAULT_TIMEOUT_MS = 5_000;
const TELEMETRY_EXPORT_DEFAULT_BATCH_SIZE = 64;
const TELEMETRY_EXPORT_DEFAULT_INTERVAL_MS = 5_000;
const TELEMETRY_EXPORT_DEFAULT_RETENTION_MAX_FILES = 512;
const TELEMETRY_EXPORT_DEFAULT_QUEUE_LIMIT = 5_000;

const telemetryExportQueue: TelemetryExportItem[] = [];
let telemetryDroppedItems = 0;
let telemetryFlushTimer: NodeJS.Timeout | null = null;
let telemetryFlushPromise: Promise<void> | null = null;
let telemetryLastFlushAt: string | null = null;
let telemetryLastFlushError: string | null = null;
let telemetryExportConfigCacheKey: string | null = null;
let telemetryExportConfigCache: TelemetryExportConfig | null = null;
let telemetryExportSuppressionDepth = 0;

function createTelemetryId(): string {
  return crypto.randomBytes(8).toString("hex");
}

function copyContext(context: TelemetryContext | undefined): TelemetryContext {
  return context ? { ...context } : {};
}

function trimBuffer<T>(buffer: T[]) {
  if (buffer.length > TELEMETRY_BUFFER_LIMIT) {
    buffer.splice(0, buffer.length - TELEMETRY_BUFFER_LIMIT);
  }
}

function parsePositiveIntEnv(name: string, fallback: number): number {
  const raw = process.env[name]?.trim();
  const parsed = raw ? Number.parseInt(raw, 10) : Number.NaN;
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function readOptionalEnv(name: string): string | null {
  const value = process.env[name]?.trim();
  return value ? value : null;
}

export function getTelemetryExportConfig(): TelemetryExportConfig {
  const cacheKey = [
    process.env[TELEMETRY_EXPORT_URL_ENV] ?? "",
    process.env[TELEMETRY_EXPORT_TOKEN_ENV] ?? "",
    process.env[TELEMETRY_EXPORT_TIMEOUT_ENV] ?? "",
    process.env[TELEMETRY_EXPORT_BATCH_SIZE_ENV] ?? "",
    process.env[TELEMETRY_EXPORT_INTERVAL_ENV] ?? "",
    process.env[TELEMETRY_RETENTION_DIR_ENV] ?? "",
    process.env[TELEMETRY_RETENTION_MAX_FILES_ENV] ?? "",
    process.env[TELEMETRY_QUEUE_LIMIT_ENV] ?? "",
    process.env[TELEMETRY_SERVICE_NAME_ENV] ?? "",
    process.env.NODE_ENV ?? "",
    process.env.VERCEL_ENV ?? ""
  ].join("\u0000");

  if (telemetryExportConfigCache && telemetryExportConfigCacheKey === cacheKey) {
    return telemetryExportConfigCache;
  }

  const backendUrl = readOptionalEnv(TELEMETRY_EXPORT_URL_ENV);
  const retentionDir = readOptionalEnv(TELEMETRY_RETENTION_DIR_ENV);

  telemetryExportConfigCacheKey = cacheKey;
  telemetryExportConfigCache = {
    enabled: Boolean(backendUrl || retentionDir),
    backendUrl,
    backendToken: readOptionalEnv(TELEMETRY_EXPORT_TOKEN_ENV),
    timeoutMs: parsePositiveIntEnv(TELEMETRY_EXPORT_TIMEOUT_ENV, TELEMETRY_EXPORT_DEFAULT_TIMEOUT_MS),
    batchSize: parsePositiveIntEnv(TELEMETRY_EXPORT_BATCH_SIZE_ENV, TELEMETRY_EXPORT_DEFAULT_BATCH_SIZE),
    flushIntervalMs: parsePositiveIntEnv(TELEMETRY_EXPORT_INTERVAL_ENV, TELEMETRY_EXPORT_DEFAULT_INTERVAL_MS),
    retentionDir,
    retentionMaxFiles: parsePositiveIntEnv(
      TELEMETRY_RETENTION_MAX_FILES_ENV,
      TELEMETRY_EXPORT_DEFAULT_RETENTION_MAX_FILES
    ),
    queueLimit: parsePositiveIntEnv(TELEMETRY_QUEUE_LIMIT_ENV, TELEMETRY_EXPORT_DEFAULT_QUEUE_LIMIT),
    serviceName: readOptionalEnv(TELEMETRY_SERVICE_NAME_ENV) ?? "agentic",
    environment: process.env.VERCEL_ENV?.trim() || process.env.NODE_ENV?.trim() || "development"
  };
  return telemetryExportConfigCache;
}

function cloneLogEntry(entry: StructuredLogEntry): StructuredLogEntry {
  return {
    ...entry,
    attributes: { ...entry.attributes },
    context: { ...entry.context }
  };
}

function cloneMetricEntry(entry: TelemetryMetric): TelemetryMetric {
  return {
    ...entry,
    attributes: { ...entry.attributes },
    context: { ...entry.context }
  };
}

function cloneSpanEntry(entry: TelemetrySpanEntry): TelemetrySpanEntry {
  return {
    ...entry,
    attributes: { ...entry.attributes },
    context: { ...entry.context }
  };
}

function cloneTelemetryExportItem(item: TelemetryExportItem): TelemetryExportItem {
  if (item.kind === "log") {
    return {
      kind: "log",
      entry: cloneLogEntry(item.entry)
    };
  }

  if (item.kind === "metric") {
    return {
      kind: "metric",
      entry: cloneMetricEntry(item.entry)
    };
  }

  return {
    kind: "span",
    entry: cloneSpanEntry(item.entry)
  };
}

function withExportQueueSuppressed<T>(handler: () => T): T {
  telemetryExportSuppressionDepth += 1;

  try {
    return handler();
  } finally {
    telemetryExportSuppressionDepth = Math.max(0, telemetryExportSuppressionDepth - 1);
  }
}

function clearTelemetryFlushTimer() {
  if (telemetryFlushTimer) {
    clearTimeout(telemetryFlushTimer);
    telemetryFlushTimer = null;
  }
}

function scheduleTelemetryFlush(delayMs: number) {
  if (telemetryFlushTimer) {
    return;
  }

  telemetryFlushTimer = setTimeout(() => {
    telemetryFlushTimer = null;
    void flushTelemetryPipeline();
  }, Math.max(1, delayMs));
  telemetryFlushTimer.unref?.();
}

function reportTelemetryPipelineIssue(message: string, error?: unknown) {
  const rendered =
    error instanceof Error
      ? `${message}: ${error.name}: ${error.message}`
      : error
        ? `${message}: ${String(error)}`
        : message;

  telemetryLastFlushError = toTelemetryPrimitive(rendered) as string;

  if (process.env.NODE_ENV === "test" && process.env[TELEMETRY_CONSOLE_ENV]?.trim().toLowerCase() !== "on") {
    return;
  }

  console.error(`[agentic.telemetry] ${telemetryLastFlushError}`);
}

function enqueueTelemetryExport(item: TelemetryExportItem) {
  if (telemetryExportSuppressionDepth > 0) {
    return;
  }

  const config = getTelemetryExportConfig();

  if (!config.enabled) {
    return;
  }

  telemetryExportQueue.push(cloneTelemetryExportItem(item));

  if (telemetryExportQueue.length > config.queueLimit) {
    const overflow = telemetryExportQueue.length - config.queueLimit;
    telemetryExportQueue.splice(0, overflow);
    telemetryDroppedItems += overflow;
  }

  if (telemetryExportQueue.length >= config.batchSize) {
    void flushTelemetryPipeline();
    return;
  }

  scheduleTelemetryFlush(config.flushIntervalMs);
}

function createTelemetryExportBatch(config: TelemetryExportConfig, items: TelemetryExportItem[]): TelemetryExportBatch {
  const batchDroppedItems = telemetryDroppedItems;
  telemetryDroppedItems = 0;

  return {
    schemaVersion: 1,
    source: {
      service: config.serviceName,
      environment: config.environment,
      nodeEnv: process.env.NODE_ENV?.trim() || "development"
    },
    batchId: crypto.randomUUID(),
    createdAt: nowIso(),
    droppedCount: batchDroppedItems,
    items: items.map((item) => cloneTelemetryExportItem(item))
  };
}

async function writeTelemetryRetentionBatch(config: TelemetryExportConfig, batch: TelemetryExportBatch): Promise<boolean> {
  if (!config.retentionDir) {
    return false;
  }

  try {
    await mkdir(config.retentionDir, { recursive: true });
    const fileName = `${batch.createdAt.replaceAll(":", "-").replaceAll(".", "-")}-${batch.batchId}.json`;
    await writeFile(path.join(config.retentionDir, fileName), JSON.stringify(batch, null, 2), "utf8");

    const retentionEntries = (await readdir(config.retentionDir, { withFileTypes: true }))
      .filter((entry) => entry.isFile() && entry.name.endsWith(".json"))
      .map((entry) => entry.name)
      .sort();
    const overflow = retentionEntries.length - config.retentionMaxFiles;

    if (overflow > 0) {
      await Promise.all(
        retentionEntries
          .slice(0, overflow)
          .map((entryName) => unlink(path.join(config.retentionDir!, entryName)).catch(() => undefined))
      );
    }

    return true;
  } catch (error) {
    reportTelemetryPipelineIssue("retention write failed", error);
    return false;
  }
}

async function postTelemetryBatch(config: TelemetryExportConfig, batch: TelemetryExportBatch): Promise<boolean> {
  if (!config.backendUrl) {
    return false;
  }

  try {
    const response = await fetch(config.backendUrl, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...(config.backendToken ? { authorization: `Bearer ${config.backendToken}` } : {})
      },
      body: JSON.stringify(batch),
      signal: AbortSignal.timeout(config.timeoutMs)
    });

    if (!response.ok) {
      throw new Error(`Telemetry backend responded with ${response.status}.`);
    }

    return true;
  } catch (error) {
    reportTelemetryPipelineIssue("backend export failed", error);
    return false;
  }
}

function pushLog(entry: StructuredLogEntry) {
  telemetrySnapshot.logs.push(entry);
  trimBuffer(telemetrySnapshot.logs);
  enqueueTelemetryExport({
    kind: "log",
    entry
  });
}

function pushMetric(entry: TelemetryMetric) {
  telemetrySnapshot.metrics.push(entry);
  trimBuffer(telemetrySnapshot.metrics);
  enqueueTelemetryExport({
    kind: "metric",
    entry
  });
}

function pushSpan(entry: TelemetrySpanEntry) {
  telemetrySnapshot.spans.push(entry);
  trimBuffer(telemetrySnapshot.spans);
  enqueueTelemetryExport({
    kind: "span",
    entry
  });
}

function toTelemetryPrimitive(value: unknown, key?: string): TelemetryPrimitive {
  if (key && SENSITIVE_KEY_PATTERN.test(key)) {
    return "[REDACTED]";
  }

  if (value === null || value === undefined) {
    return null;
  }

  if (typeof value === "string") {
    if (SENSITIVE_VALUE_PATTERN.test(value)) {
      return "[REDACTED]";
    }

    return value.length > 200 ? `${value.slice(0, 197)}...` : value;
  }

  if (typeof value === "number" || typeof value === "boolean") {
    return value;
  }

  if (value instanceof Error) {
    return toTelemetryPrimitive(value.message);
  }

  return JSON.stringify(sanitizeForTelemetry(value));
}

export function sanitizeForTelemetry(value: unknown, depth = 0): unknown {
  if (depth > 5) {
    return "[TRUNCATED]";
  }

  if (value === null || value === undefined) {
    return null;
  }

  if (value instanceof Error) {
    return {
      name: value.name,
      message: sanitizeForTelemetry(value.message, depth + 1)
    };
  }

  if (typeof value === "string") {
    return SENSITIVE_VALUE_PATTERN.test(value) ? "[REDACTED]" : value;
  }

  if (Array.isArray(value)) {
    return value.map((item) => sanitizeForTelemetry(item, depth + 1));
  }

  if (typeof value === "object") {
    const result: Record<string, unknown> = {};

    for (const [key, entryValue] of Object.entries(value as Record<string, unknown>)) {
      if (SENSITIVE_KEY_PATTERN.test(key)) {
        result[key] = "[REDACTED]";
        continue;
      }

      result[key] = sanitizeForTelemetry(entryValue, depth + 1);
    }

    return result;
  }

  return value;
}

export function sanitizeAttributes(attributes?: Record<string, unknown>): TelemetryAttributes {
  if (!attributes) {
    return {};
  }

  const sanitized: TelemetryAttributes = {};

  for (const [key, value] of Object.entries(attributes)) {
    sanitized[key] = toTelemetryPrimitive(value, key);
  }

  return sanitized;
}

function toStructuredLogLine(entry: StructuredLogEntry): string {
  return JSON.stringify({
    timestamp: entry.timestamp,
    level: entry.level,
    message: entry.message,
    ...entry.context,
    ...entry.attributes
  });
}

function normalizeTelemetryContext(
  next: Partial<TelemetryContext>,
  parent?: TelemetryContext
): TelemetryContext {
  return {
    requestId: next.requestId ?? parent?.requestId,
    traceId: next.traceId ?? parent?.traceId ?? createTelemetryId(),
    spanId: next.spanId ?? parent?.spanId,
    parentSpanId: next.parentSpanId ?? parent?.parentSpanId ?? null,
    route: next.route ?? parent?.route,
    method: next.method ?? parent?.method,
    path: next.path ?? parent?.path,
    jobId: next.jobId ?? parent?.jobId,
    jobKind: next.jobKind ?? parent?.jobKind,
    runnerId: next.runnerId ?? parent?.runnerId,
    provider: next.provider ?? parent?.provider,
    userId: next.userId ?? parent?.userId,
    workspaceId: next.workspaceId ?? parent?.workspaceId
  };
}

export function getTelemetryContext(): TelemetryContext | undefined {
  return telemetryContextStore.getStore();
}

export async function withTelemetryContext<T>(
  context: Partial<TelemetryContext>,
  handler: () => Promise<T> | T
): Promise<T> {
  const nextContext = normalizeTelemetryContext(context, getTelemetryContext());
  return telemetryContextStore.run(nextContext, () => Promise.resolve(handler()));
}

export function getOrCreateRequestId(candidate?: string | null): string {
  const trimmed = candidate?.trim();

  if (trimmed) {
    return trimmed.slice(0, 200);
  }

  return createTelemetryId();
}

export function getCorrelationHeaders(): HeadersInit {
  const context = getTelemetryContext();
  return {
    ...(context?.requestId ? { [REQUEST_ID_HEADER]: context.requestId } : {}),
    ...(context?.traceId ? { [TRACE_ID_HEADER]: context.traceId } : {})
  };
}

export function appendCorrelationHeaders(headers?: HeadersInit): Headers {
  const next = new Headers(headers);

  for (const [key, value] of new Headers(getCorrelationHeaders()).entries()) {
    next.set(key, value);
  }

  return next;
}

export function recordCounter(name: string, value = 1, attributes?: Record<string, unknown>) {
  pushMetric({
    timestamp: nowIso(),
    kind: "counter",
    name,
    value,
    attributes: sanitizeAttributes(attributes),
    context: copyContext(getTelemetryContext())
  });
}

export function recordHistogram(name: string, value: number, attributes?: Record<string, unknown>) {
  pushMetric({
    timestamp: nowIso(),
    kind: "histogram",
    name,
    value,
    attributes: sanitizeAttributes(attributes),
    context: copyContext(getTelemetryContext())
  });
}

function writeStructuredLog(level: StructuredLogLevel, message: string, attributes?: Record<string, unknown>) {
  const entry: StructuredLogEntry = {
    timestamp: nowIso(),
    level,
    message,
    attributes: sanitizeAttributes(attributes),
    context: copyContext(getTelemetryContext())
  };

  pushLog(entry);

  const consoleMode = process.env[TELEMETRY_CONSOLE_ENV]?.trim().toLowerCase();

  if (consoleMode === "off" || (process.env.NODE_ENV === "test" && consoleMode !== "on")) {
    return;
  }

  const line = toStructuredLogLine(entry);

  if (level === "error") {
    console.error(line);
  } else if (level === "warn") {
    console.warn(line);
  } else {
    console.info(line);
  }
}

export function logInfo(message: string, attributes?: Record<string, unknown>) {
  writeStructuredLog("info", message, attributes);
}

export function logWarn(message: string, attributes?: Record<string, unknown>) {
  writeStructuredLog("warn", message, attributes);
}

export function logError(message: string, error?: unknown, attributes?: Record<string, unknown>) {
  writeStructuredLog("error", message, {
    ...attributes,
    errorName: error instanceof Error ? error.name : undefined,
    errorMessage: error instanceof Error ? error.message : typeof error === "string" ? error : undefined
  });
}

export async function withSpan<T>(
  name: string,
  attributes: Record<string, unknown> | undefined,
  handler: () => Promise<T> | T
): Promise<T> {
  const parent = getTelemetryContext();
  const startedAt = nowIso();
  const started = Date.now();
  const spanContext = normalizeTelemetryContext(
    {
      traceId: parent?.traceId ?? createTelemetryId(),
      requestId: parent?.requestId,
      spanId: createTelemetryId(),
      parentSpanId: parent?.spanId ?? null
    },
    parent
  );

  return telemetryContextStore.run(spanContext, async () => {
    try {
      const result = await handler();
      const endedAt = nowIso();
      const durationMs = Math.max(0, Date.now() - started);
      const sanitizedAttributes = sanitizeAttributes(attributes);

      pushSpan({
        name,
        timestamp: startedAt,
        endedAt,
        durationMs,
        status: "ok",
        attributes: sanitizedAttributes,
        context: copyContext(spanContext)
      });
      recordHistogram("telemetry.span.duration_ms", durationMs, {
        spanName: name,
        spanStatus: "ok",
        ...sanitizedAttributes
      });
      return result;
    } catch (error) {
      const endedAt = nowIso();
      const durationMs = Math.max(0, Date.now() - started);
      const sanitizedAttributes = sanitizeAttributes(attributes);
      const sanitizedError = toTelemetryPrimitive(
        error instanceof Error ? error.message : typeof error === "string" ? error : "Unknown error"
      );

      pushSpan({
        name,
        timestamp: startedAt,
        endedAt,
        durationMs,
        status: "error",
        error: typeof sanitizedError === "string" ? sanitizedError : JSON.stringify(sanitizedError),
        attributes: sanitizedAttributes,
        context: copyContext(spanContext)
      });
      recordHistogram("telemetry.span.duration_ms", durationMs, {
        spanName: name,
        spanStatus: "error",
        ...sanitizedAttributes
      });
      recordCounter("telemetry.span.errors_total", 1, {
        spanName: name,
        ...sanitizedAttributes
      });
      throw error;
    }
  });
}

export async function flushTelemetryPipeline(): Promise<void> {
  if (telemetryFlushPromise) {
    await telemetryFlushPromise;

    if (telemetryExportQueue.length > 0) {
      return flushTelemetryPipeline();
    }

    return;
  }

  const config = getTelemetryExportConfig();

  clearTelemetryFlushTimer();

  if (!config.enabled || telemetryExportQueue.length === 0) {
    return;
  }

  telemetryFlushPromise = (async () => {
    while (telemetryExportQueue.length > 0) {
      const activeConfig = getTelemetryExportConfig();

      if (!activeConfig.enabled) {
        telemetryExportQueue.length = 0;
        telemetryDroppedItems = 0;
        return;
      }

      const items = telemetryExportQueue.splice(0, activeConfig.batchSize);
      const batch = createTelemetryExportBatch(activeConfig, items);
      const retained = await writeTelemetryRetentionBatch(activeConfig, batch);
      const exported = activeConfig.backendUrl ? await postTelemetryBatch(activeConfig, batch) : false;

      if (!retained && !exported) {
        telemetryExportQueue.unshift(...batch.items.map((item) => cloneTelemetryExportItem(item)));
        scheduleTelemetryFlush(activeConfig.flushIntervalMs);
        return;
      }

      telemetryLastFlushAt = nowIso();
      telemetryLastFlushError =
        activeConfig.backendUrl && !exported
          ? "Telemetry backend export failed; retained batch on disk."
          : activeConfig.retentionDir && !retained
            ? "Telemetry retention write failed."
            : null;

      withExportQueueSuppressed(() => {
        if (retained) {
          recordCounter("telemetry.retention.write.total", 1, {
            outcome: "ok"
          });
        } else if (activeConfig.retentionDir) {
          recordCounter("telemetry.retention.write.total", 1, {
            outcome: "error"
          });
        }

        if (activeConfig.backendUrl) {
          recordCounter("telemetry.export.total", 1, {
            outcome: exported ? "ok" : "error"
          });
        }
      });
    }
  })().finally(() => {
    telemetryFlushPromise = null;

    if (telemetryExportQueue.length > 0 && getTelemetryExportConfig().enabled) {
      scheduleTelemetryFlush(getTelemetryExportConfig().flushIntervalMs);
    }
  });

  await telemetryFlushPromise;
}

export function resetTelemetrySnapshot() {
  telemetrySnapshot.logs.length = 0;
  telemetrySnapshot.metrics.length = 0;
  telemetrySnapshot.spans.length = 0;
  telemetryExportQueue.length = 0;
  telemetryDroppedItems = 0;
  telemetryLastFlushAt = null;
  telemetryLastFlushError = null;
  clearTelemetryFlushTimer();
}

export function getTelemetrySnapshot(): TelemetrySnapshot {
  return {
    logs: telemetrySnapshot.logs.map((entry) => cloneLogEntry(entry)),
    metrics: telemetrySnapshot.metrics.map((entry) => cloneMetricEntry(entry)),
    spans: telemetrySnapshot.spans.map((entry) => cloneSpanEntry(entry))
  };
}

export function getTelemetryPipelineState(): TelemetryPipelineState {
  return {
    pendingItems: telemetryExportQueue.length,
    droppedItems: telemetryDroppedItems,
    lastFlushAt: telemetryLastFlushAt,
    lastFlushError: telemetryLastFlushError,
    config: getTelemetryExportConfig()
  };
}

export function hashActionLog(log: ActionLog): string {
  const stable = JSON.stringify({
    id: log.id,
    goalId: log.goalId,
    taskId: log.taskId,
    workflowId: log.workflowId,
    actor: log.actor,
    kind: log.kind,
    message: log.message,
    details: log.details,
    createdAt: log.createdAt,
    prevHash: log.prevHash
  });
  return crypto.createHash("sha256").update(stable).digest("hex");
}

export function createActionLog(
  input: Omit<ActionLog, "id" | "createdAt" | "taskId" | "workflowId" | "prevHash"> & {
    taskId?: string | null;
    workflowId?: string | null;
    prevLog?: ActionLog | null;
  }
): ActionLog {
  const prevHash = input.prevLog ? hashActionLog(input.prevLog) : null;
  const { prevLog: _prevLog, ...rest } = input;
  return ActionLogSchema.parse({
    taskId: rest.taskId ?? null,
    workflowId: rest.workflowId ?? null,
    ...rest,
    id: crypto.randomUUID(),
    createdAt: nowIso(),
    prevHash
  });
}

// Activity event types for agent execution instrumentation
export type ActivityEventType =
  | "agent.started"
  | "agent.completed"
  | "agent.failed"
  | "agent.tool_called"
  | "agent.memory_accessed"
  | "agent.decision_made"
  | "workflow.started"
  | "workflow.step_completed"
  | "workflow.completed"
  | "workflow.failed"
  | "approval.requested"
  | "approval.responded"
  | "memory.created"
  | "memory.updated"
  | "memory.deleted"
  | "goal.created"
  | "goal.completed"
  | "goal.failed"
  | "task.started"
  | "task.completed"
  | "task.failed"
  | "integration.called"
  | "integration.error";

export type ActivityEvent = {
  id: string;
  type: ActivityEventType;
  timestamp: string;
  actor: string;
  agentId?: string;
  agentName?: string;
  goalId?: string;
  taskId?: string;
  workflowId?: string;
  message: string;
  details: Record<string, unknown>;
  duration?: number;
  success?: boolean;
  error?: string;
};

// Event emitter interface for activity events
export type ActivityEventHandler = (event: ActivityEvent) => void;

const eventHandlers: ActivityEventHandler[] = [];

export function onActivityEvent(handler: ActivityEventHandler): () => void {
  eventHandlers.push(handler);
  return () => {
    const index = eventHandlers.indexOf(handler);
    if (index >= 0) eventHandlers.splice(index, 1);
  };
}

export function emitActivityEvent(
  input: Omit<ActivityEvent, "id" | "timestamp">
): ActivityEvent {
  const event: ActivityEvent = {
    ...input,
    id: crypto.randomUUID(),
    timestamp: nowIso()
  };

  // Notify all handlers.
  for (const handler of eventHandlers) {
    try {
      handler(event);
    } catch (error) {
      logError("activity.event_handler_failed", error, {
        activityEventType: event.type
      });
    }
  }

  return event;
}

// Instrumentation helpers for agent execution
export function instrumentAgentStart(
  agentId: string,
  agentName: string,
  goalId?: string,
  taskId?: string
): ActivityEvent {
  return emitActivityEvent({
    type: "agent.started",
    actor: agentName,
    agentId,
    agentName,
    goalId,
    taskId,
    message: `Agent ${agentName} started execution`,
    details: { agentId, taskId, goalId }
  });
}

export function instrumentAgentComplete(
  agentId: string,
  agentName: string,
  durationMs: number,
  success: boolean,
  goalId?: string,
  taskId?: string,
  error?: string
): ActivityEvent {
  return emitActivityEvent({
    type: success ? "agent.completed" : "agent.failed",
    actor: agentName,
    agentId,
    agentName,
    goalId,
    taskId,
    message: success
      ? `Agent ${agentName} completed in ${durationMs}ms`
      : `Agent ${agentName} failed: ${error}`,
    details: { durationMs, success, error },
    duration: durationMs,
    success,
    error
  });
}

export function instrumentToolCall(
  agentId: string,
  agentName: string,
  toolName: string,
  args: Record<string, unknown>,
  result?: unknown
): ActivityEvent {
  return emitActivityEvent({
    type: "agent.tool_called",
    actor: agentName,
    agentId,
    agentName,
    message: `Agent ${agentName} called tool: ${toolName}`,
    details: { toolName, args, result }
  });
}

export function instrumentMemoryAccess(
  agentId: string,
  agentName: string,
  memoryIds: string[],
  operation: "read" | "write"
): ActivityEvent {
  return emitActivityEvent({
    type: "agent.memory_accessed",
    actor: agentName,
    agentId,
    agentName,
    message: `Agent ${agentName} ${operation} ${memoryIds.length} memories`,
    details: { memoryIds, operation }
  });
}

export function instrumentDecision(
  agentId: string,
  agentName: string,
  decision: string,
  confidence: number,
  reasoning?: string
): ActivityEvent {
  return emitActivityEvent({
    type: "agent.decision_made",
    actor: agentName,
    agentId,
    agentName,
    message: `Agent ${agentName} decided: ${decision}`,
    details: { decision, confidence, reasoning }
  });
}

// Workflow instrumentation
export function instrumentWorkflowStart(
  workflowId: string,
  workflowName: string,
  nodes: number
): ActivityEvent {
  return emitActivityEvent({
    type: "workflow.started",
    actor: "workflow",
    workflowId,
    message: `Workflow "${workflowName}" started with ${nodes} nodes`,
    details: { workflowName, nodes }
  });
}

export function instrumentWorkflowStep(
  workflowId: string,
  stepIndex: number,
  stepName: string,
  agentId?: string
): ActivityEvent {
  return emitActivityEvent({
    type: "workflow.step_completed",
    actor: "workflow",
    workflowId,
    agentId,
    message: `Workflow step ${stepIndex}: ${stepName} completed`,
    details: { stepIndex, stepName, agentId }
  });
}

export function instrumentWorkflowComplete(
  workflowId: string,
  workflowName: string,
  durationMs: number,
  success: boolean,
  error?: string
): ActivityEvent {
  return emitActivityEvent({
    type: success ? "workflow.completed" : "workflow.failed",
    actor: "workflow",
    workflowId,
    message: success
      ? `Workflow "${workflowName}" completed in ${durationMs}ms`
      : `Workflow "${workflowName}" failed: ${error}`,
    details: { workflowName, durationMs, success, error },
    duration: durationMs,
    success,
    error
  });
}

// Create an activity log entry from an event (for persistence)
export function activityEventToLog(event: ActivityEvent): ActionLog {
  return createActionLog({
    goalId: event.goalId ?? "system",
    taskId: event.taskId,
    workflowId: event.workflowId,
    actor: event.actor,
    kind: event.type,
    message: event.message,
    details: event.details
  });
}
