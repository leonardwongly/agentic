import crypto from "node:crypto";
import { AGENTIC_ACCESS_KEY_HEADER } from "../../apps/web/lib/auth";

const DEFAULT_TIMEOUT_MS = 120_000;
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
};

export type DeploymentAsyncCanaryOptions = {
  baseUrl: string;
  accessKey: string;
  timeoutMs?: number;
  pollIntervalMs?: number;
  requestText?: string;
  idempotencyKey?: string;
  fetchImpl?: typeof fetch;
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

async function readJson<T>(response: Response): Promise<T> {
  const payload = await response.json();
  return payload as T;
}

export async function runDeploymentAsyncCanary(options: DeploymentAsyncCanaryOptions): Promise<DeploymentAsyncCanarySummary> {
  const fetchImpl = options.fetchImpl ?? fetch;
  const wait = options.wait ?? ((ms: number) => new Promise((resolve) => setTimeout(resolve, ms)));
  const baseUrl = normalizeBaseUrl(options.baseUrl);
  const accessKey = options.accessKey.trim();
  const timeoutMs = parsePositiveInt(options.timeoutMs, DEFAULT_TIMEOUT_MS, "timeoutMs");
  const pollIntervalMs = parsePositiveInt(options.pollIntervalMs, DEFAULT_POLL_INTERVAL_MS, "pollIntervalMs");
  const maxAttempts = Math.max(1, Math.ceil(timeoutMs / pollIntervalMs));
  const requestText = options.requestText?.trim() || "Deployment canary: prove queued goal work reaches durable completion.";
  const idempotencyKey = options.idempotencyKey?.trim() || `deploy-canary:${crypto.randomUUID()}`;

  assert(accessKey, "AGENTIC_SMOKE_ACCESS_KEY must be configured.");
  assert(requestText.length <= 2_000, "Deployment async canary request must be 2,000 characters or fewer.");
  assert(idempotencyKey.length <= 200, "Deployment async canary idempotency key must be 200 characters or fewer.");

  const createResponse = await fetchImpl(`${baseUrl}/api/goals`, {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
      [AGENTIC_ACCESS_KEY_HEADER]: accessKey,
      "x-idempotency-key": idempotencyKey
    },
    body: JSON.stringify({
      request: requestText
    })
  });

  const createPayload = await readJson<GoalCreatePayload>(createResponse);
  assert(createResponse.status === 202, `Expected goal enqueue to return 202, received ${createResponse.status}.`);
  assert(createPayload.job?.id, "Goal enqueue response did not include a job id.");
  assert(createPayload.statusUrl, "Goal enqueue response did not include a status URL.");

  const statusUrl = resolveStatusUrl(baseUrl, createPayload.statusUrl);

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const jobResponse = await fetchImpl(statusUrl, {
      headers: {
        Accept: "application/json",
        [AGENTIC_ACCESS_KEY_HEADER]: accessKey
      }
    });
    const jobPayload = await readJson<GoalJobPayload>(jobResponse);
    const jobStatus = jobPayload.job?.status;

    if (jobResponse.status === 200 && jobStatus === "completed") {
      assert(jobPayload.result !== null && jobPayload.result !== undefined, "Completed goal canary did not include a result payload.");

      return {
        jobId: createPayload.job.id,
        attempts: attempt,
        statusUrl
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
