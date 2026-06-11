import crypto from "node:crypto";
import { DEFAULT_OWNER_USER_ID, createSystemActorContext, type JobRecord } from "@agentic/contracts";
import { createRepository, type AgenticRepository } from "@agentic/repository";
import { enqueueDeploymentCanaryJob } from "@agentic/worker-runtime";
import { AGENTIC_ACCESS_KEY_HEADER } from "../../apps/web/lib/auth";

const DEFAULT_HTTP_TIMEOUT_MS = 120_000;
const DEFAULT_DATABASE_TIMEOUT_MS = 420_000;
const DEFAULT_POLL_INTERVAL_MS = 2_000;

type GoalCreatePayload = {
  job?: {
    id?: string;
    status?: string;
  };
  statusUrl?: string;
};

type GoalJobPayload = {
  job?: {
    id?: string;
    status?: string;
  };
  result?: unknown;
  error?: string | null;
};

export type DeploymentAsyncCanarySummary = {
  jobId: string;
  attempts: number;
  statusUrl: string;
  requestId: string;
  traceId: string;
  idempotencyKey: string;
  enqueueDurationMs: number;
  pollDurationMs: number;
};

export type DeploymentAsyncCanaryOptions = {
  baseUrl: string;
  accessKey: string;
  databaseUrl?: string | null;
  userId?: string;
  timeoutMs?: number;
  pollIntervalMs?: number;
  requestText?: string;
  idempotencyKey?: string;
  requestId?: string;
  traceId?: string;
  fetchImpl?: typeof fetch;
  repository?: Pick<AgenticRepository, "enqueueJob" | "getJob">;
  wait?: (ms: number) => Promise<void>;
};

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) {
    throw new Error(message);
  }
}

function normalizeBaseUrl(baseUrl: string): string {
  const trimmed = baseUrl.trim().replace(/\/+$/, "");

  if (!trimmed) {
    throw new Error("AGENTIC_SMOKE_BASE_URL must be configured.");
  }

  return trimmed;
}

function parsePositiveInt(value: number | undefined, fallback: number, label: string): number {
  if (value === undefined) {
    return fallback;
  }

  if (!Number.isFinite(value) || value <= 0) {
    throw new Error(`${label} must be a positive number.`);
  }

  return Math.floor(value);
}

function resolveStatusUrl(baseUrl: string, statusUrl: string): string {
  return new URL(statusUrl, `${baseUrl}/`).toString();
}

function resolveDatabaseUrl(candidate?: string | null): string | null {
  return candidate?.trim() || null;
}

async function readJson<T>(response: Response): Promise<T> {
  try {
    const payload = await response.json();
    return payload as T;
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown JSON parsing failure.";
    throw new Error(`Deployment async canary received an invalid JSON response: ${message}`);
  }
}

async function runDatabaseBackedCanary(params: {
  baseUrl: string;
  databaseUrl: string | null;
  repository?: Pick<AgenticRepository, "enqueueJob" | "getJob">;
  userId: string;
  requestId: string;
  traceId: string;
  idempotencyKey: string;
  timeoutMs: number;
  pollIntervalMs: number;
  wait: (ms: number) => Promise<void>;
}): Promise<DeploymentAsyncCanarySummary> {
  const repository = params.repository ?? createRepository({ databaseUrl: params.databaseUrl ?? undefined });
  const maxAttempts = Math.max(1, Math.ceil(params.timeoutMs / params.pollIntervalMs));
  const enqueueStartedAt = Date.now();
  const job = await enqueueDeploymentCanaryJob({
    repository,
    userId: params.userId,
    actorContext: createSystemActorContext(params.userId, params.requestId),
    requestId: params.requestId,
    traceId: params.traceId,
    idempotencyKey: params.idempotencyKey
  });
  const enqueueDurationMs = Math.max(0, Date.now() - enqueueStartedAt);
  const statusUrl = resolveStatusUrl(params.baseUrl, `/api/jobs/${encodeURIComponent(job.id)}`);
  const pollStartedAt = Date.now();

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const currentJob = await repository.getJob(job.id, params.userId);
    assert(currentJob, `Deployment async canary job ${job.id} was not found after enqueue.`);

    if (currentJob.status === "completed") {
      return {
        jobId: job.id,
        attempts: attempt,
        statusUrl,
        requestId: params.requestId,
        traceId: params.traceId,
        idempotencyKey: params.idempotencyKey,
        enqueueDurationMs,
        pollDurationMs: Math.max(0, Date.now() - pollStartedAt)
      };
    }

    if (currentJob.status === "dead_letter") {
      throw new Error(currentJob.lastError?.trim() || `Deployment async canary dead-lettered job ${job.id}.`);
    }

    assertCanaryJobPending(currentJob);

    if (attempt < maxAttempts) {
      await params.wait(params.pollIntervalMs);
    }
  }

  throw new Error(`Deployment async canary timed out after ${maxAttempts} poll attempt(s).`);
}

function assertCanaryJobPending(job: JobRecord): void {
  if (job.status !== "queued" && job.status !== "running" && job.status !== "retrying") {
    throw new Error(`Deployment async canary observed an unexpected job status: ${job.status}.`);
  }
}

export async function runDeploymentAsyncCanary(options: DeploymentAsyncCanaryOptions): Promise<DeploymentAsyncCanarySummary> {
  const fetchImpl = options.fetchImpl ?? fetch;
  const wait = options.wait ?? ((ms: number) => new Promise((resolve) => setTimeout(resolve, ms)));
  const baseUrl = normalizeBaseUrl(options.baseUrl);
  const accessKey = options.accessKey.trim();
  const databaseUrl = resolveDatabaseUrl(options.databaseUrl);
  const useDatabaseBackedCanary = Boolean(databaseUrl || options.repository);
  const timeoutMs = parsePositiveInt(
    options.timeoutMs,
    useDatabaseBackedCanary ? DEFAULT_DATABASE_TIMEOUT_MS : DEFAULT_HTTP_TIMEOUT_MS,
    "timeoutMs"
  );
  const pollIntervalMs = parsePositiveInt(options.pollIntervalMs, DEFAULT_POLL_INTERVAL_MS, "pollIntervalMs");
  const maxAttempts = Math.max(1, Math.ceil(timeoutMs / pollIntervalMs));
  const requestText = options.requestText?.trim() || "Deployment canary: prove queued goal work reaches durable completion.";
  const idempotencyKey = options.idempotencyKey?.trim() || `deploy-canary:${crypto.randomUUID()}`;
  const requestId = options.requestId?.trim() || `deploy-canary-${crypto.randomUUID()}`;
  const traceId = options.traceId?.trim() || requestId;
  const userId = options.userId?.trim() || DEFAULT_OWNER_USER_ID;

  assert(accessKey, "AGENTIC_SMOKE_ACCESS_KEY must be configured.");
  assert(requestText.length <= 2_000, "Deployment async canary request must be 2,000 characters or fewer.");
  assert(idempotencyKey.length <= 200, "Deployment async canary idempotency key must be 200 characters or fewer.");
  assert(userId.length <= 120, "Deployment async canary user id must be 120 characters or fewer.");

  if (useDatabaseBackedCanary) {
    return runDatabaseBackedCanary({
      baseUrl,
      databaseUrl,
      repository: options.repository,
      userId,
      requestId,
      traceId,
      idempotencyKey,
      timeoutMs,
      pollIntervalMs,
      wait
    });
  }

  const enqueueStartedAt = Date.now();
  const createResponse = await fetchImpl(`${baseUrl}/api/goals`, {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
      [AGENTIC_ACCESS_KEY_HEADER]: accessKey,
      "x-idempotency-key": idempotencyKey,
      "x-request-id": requestId,
      "x-trace-id": traceId
    },
    body: JSON.stringify({
      request: requestText
    })
  });
  const enqueueDurationMs = Math.max(0, Date.now() - enqueueStartedAt);

  const createPayload = await readJson<GoalCreatePayload>(createResponse);
  assert(createResponse.status === 202, `Expected goal enqueue to return 202, received ${createResponse.status}.`);
  assert(createPayload.job?.id, "Goal enqueue response did not include a job id.");
  assert(createPayload.statusUrl, "Goal enqueue response did not include a status URL.");

  const statusUrl = resolveStatusUrl(baseUrl, createPayload.statusUrl);
  const pollStartedAt = Date.now();

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const jobResponse = await fetchImpl(statusUrl, {
      headers: {
        Accept: "application/json",
        [AGENTIC_ACCESS_KEY_HEADER]: accessKey,
        "x-request-id": requestId,
        "x-trace-id": traceId
      }
    });
    const jobPayload = await readJson<GoalJobPayload>(jobResponse);
    const jobStatus = jobPayload.job?.status;

    if (jobResponse.status === 200 && jobStatus === "completed") {
      assert(jobPayload.result !== null && jobPayload.result !== undefined, "Completed goal canary did not include a result payload.");

      return {
        jobId: createPayload.job.id,
        attempts: attempt,
        statusUrl,
        requestId,
        traceId,
        idempotencyKey,
        enqueueDurationMs,
        pollDurationMs: Math.max(0, Date.now() - pollStartedAt)
      };
    }

    if (jobStatus === "dead_letter") {
      throw new Error(jobPayload.error?.trim() || `Deployment async canary dead-lettered job ${createPayload.job.id}.`);
    }

    if (jobResponse.status !== 202 || (jobStatus !== "queued" && jobStatus !== "running" && jobStatus !== "retrying")) {
      throw new Error(
        `Deployment async canary observed an unexpected job response: status=${jobResponse.status}, jobStatus=${jobStatus ?? "unknown"}.`
      );
    }

    if (attempt < maxAttempts) {
      await wait(pollIntervalMs);
    }
  }

  throw new Error(`Deployment async canary timed out after ${maxAttempts} poll attempt(s).`);
}
