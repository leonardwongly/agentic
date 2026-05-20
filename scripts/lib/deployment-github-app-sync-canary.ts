import crypto from "node:crypto";
import { isIP } from "node:net";
import { AGENTIC_ACCESS_KEY_HEADER } from "../../apps/web/lib/auth";

const DEFAULT_TIMEOUT_MS = 180_000;
const DEFAULT_POLL_INTERVAL_MS = 2_000;
const TEMPORARY_BASE_URL_DOMAINS = [
  "trycloudflare.com",
  "ngrok.io",
  "ngrok.app",
  "ngrok-free.app",
  "loca.lt",
  "localhost.run",
  "devtunnels.ms",
  "serveo.net",
  "tunnelmole.net"
];

type GitHubAppSyncPayload = {
  ok?: boolean;
  synchronizedAt?: string;
  automationMode?: string;
  repositories?: Array<{
    fullName?: string;
    openIssuesSeen?: number;
    skippedPullRequests?: number;
  }>;
  jobs?: Array<{
    id?: string;
    kind?: string;
    status?: string;
    statusUrl?: string;
    repository?: string;
    issueNumber?: number;
    automationMode?: string;
    goalId?: string;
    createdAt?: string;
    updatedAt?: string;
  }>;
};

type JobPollPayload = {
  job?: {
    id?: string;
    kind?: string;
    status?: string;
    repository?: string;
    issueNumber?: number;
    automationMode?: string;
    goalId?: string;
  };
  result?: unknown;
  error?: string | null;
};

export type DeploymentGitHubAppSyncCanarySummary = {
  synchronizedAt: string | null;
  automationMode: string | null;
  repositories: Array<{
    fullName: string;
    openIssuesSeen: number;
    skippedPullRequests: number;
  }>;
  jobs: Array<{
    id: string;
    repository: string;
    issueNumber: number;
    automationMode: string;
    goalId: string | null;
    attempts: number;
    statusUrl: string;
  }>;
  requestId: string;
  traceId: string;
  syncDurationMs: number;
  pollDurationMs: number;
};

export type DeploymentGitHubAppSyncCanaryOptions = {
  baseUrl: string;
  accessKey: string;
  syncSecret: string;
  timeoutMs?: number;
  pollIntervalMs?: number;
  requestId?: string;
  traceId?: string;
  fetchImpl?: typeof fetch;
  wait?: (ms: number) => Promise<void>;
};

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) {
    throw new Error(message);
  }
}

function normalizeHostname(hostname: string): string {
  return hostname.trim().toLowerCase().replace(/^\[|\]$/g, "");
}

function domainMatches(hostname: string, domain: string): boolean {
  return hostname === domain || hostname.endsWith(`.${domain}`);
}

function isTemporaryBaseUrlHost(hostname: string): boolean {
  const normalized = normalizeHostname(hostname);
  return TEMPORARY_BASE_URL_DOMAINS.some((domain) => domainMatches(normalized, domain));
}

function parseIpv4(hostname: string): number[] | null {
  const normalized = normalizeHostname(hostname);

  if (isIP(normalized) !== 4) {
    return null;
  }

  const octets = normalized.split(".").map((segment) => Number.parseInt(segment, 10));
  return octets.length === 4 && octets.every((octet) => Number.isInteger(octet)) ? octets : null;
}

function isLocalOrPrivateHost(hostname: string): boolean {
  const normalized = normalizeHostname(hostname);
  const ipVersion = isIP(normalized);

  if (normalized === "localhost" || normalized === "::1") {
    return true;
  }

  const ipv4 = parseIpv4(normalized);

  if (ipv4) {
    const [first = 0, second = 0] = ipv4;

    return (
      first === 10 ||
      first === 127 ||
      (first === 169 && second === 254) ||
      (first === 172 && second >= 16 && second <= 31) ||
      (first === 192 && second === 168)
    );
  }

  return ipVersion === 6 && (normalized.startsWith("fc") || normalized.startsWith("fd") || normalized.startsWith("fe80:"));
}

function normalizeBaseUrl(baseUrl: string): string {
  const trimmed = baseUrl.trim();

  if (!trimmed) {
    throw new Error("AGENTIC_SMOKE_BASE_URL must be configured.");
  }

  let parsed: URL;

  try {
    parsed = new URL(trimmed);
  } catch {
    throw new Error("AGENTIC_SMOKE_BASE_URL must be a valid absolute URL.");
  }

  if (parsed.protocol !== "https:") {
    throw new Error("AGENTIC_SMOKE_BASE_URL must use HTTPS for live GitHub App sync proof.");
  }

  if (parsed.username || parsed.password) {
    throw new Error("AGENTIC_SMOKE_BASE_URL must not include embedded credentials.");
  }

  if ((parsed.pathname && parsed.pathname !== "/") || parsed.search || parsed.hash) {
    throw new Error("AGENTIC_SMOKE_BASE_URL must be an origin without path, query, or fragment.");
  }

  const hostname = normalizeHostname(parsed.hostname);

  if (isTemporaryBaseUrlHost(hostname)) {
    throw new Error("AGENTIC_SMOKE_BASE_URL must not use a temporary tunnel host for live GitHub App sync proof.");
  }

  if (isLocalOrPrivateHost(hostname)) {
    throw new Error("AGENTIC_SMOKE_BASE_URL must use a public stable DNS host for live GitHub App sync proof.");
  }

  return parsed.origin;
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

function resolveStatusUrl(baseUrl: string, jobId: string): string {
  return new URL(`/api/jobs/${encodeURIComponent(jobId)}`, `${baseUrl}/`).toString();
}

function resolveJobStatusUrl(baseUrl: string, jobId: string, statusUrl: string | undefined): string {
  const fallback = resolveStatusUrl(baseUrl, jobId);
  const raw = statusUrl?.trim();

  if (!raw) {
    return fallback;
  }

  const resolved = new URL(raw, `${baseUrl}/`);
  const expected = new URL(fallback);

  if (resolved.origin !== expected.origin || resolved.pathname !== expected.pathname || resolved.search || resolved.hash) {
    throw new Error(`GitHub App sync job ${jobId} returned an unsafe status URL.`);
  }

  return resolved.toString();
}

async function readJson<T>(response: Response): Promise<T> {
  try {
    const payload = await response.json();
    return payload as T;
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown JSON parsing failure.";
    throw new Error(`GitHub App sync canary received an invalid JSON response: ${message}`);
  }
}

function normalizeRepositories(payload: GitHubAppSyncPayload): DeploymentGitHubAppSyncCanarySummary["repositories"] {
  return (payload.repositories ?? []).map((repository) => ({
    fullName: repository.fullName ?? "unknown",
    openIssuesSeen: repository.openIssuesSeen ?? 0,
    skippedPullRequests: repository.skippedPullRequests ?? 0
  }));
}

function normalizeJobs(payload: GitHubAppSyncPayload): Array<{
  id: string;
  repository: string;
  issueNumber: number;
  automationMode: string;
  goalId: string | null;
  statusUrl: string | undefined;
}> {
  return (payload.jobs ?? []).map((job) => {
    assert(job.id, "GitHub App sync response included a job without an id.");
    assert(job.kind === "github_issue_intake", `GitHub App sync returned unexpected job kind ${job.kind ?? "unknown"}.`);
    assert(job.repository, `GitHub App sync job ${job.id} did not include a repository.`);
    assert(Number.isInteger(job.issueNumber), `GitHub App sync job ${job.id} did not include an issue number.`);

    return {
      id: job.id,
      repository: job.repository,
      issueNumber: job.issueNumber as number,
      automationMode: job.automationMode ?? "unknown",
      goalId: job.goalId ?? null,
      statusUrl: job.statusUrl
    };
  });
}

export async function runDeploymentGitHubAppSyncCanary(
  options: DeploymentGitHubAppSyncCanaryOptions
): Promise<DeploymentGitHubAppSyncCanarySummary> {
  const fetchImpl = options.fetchImpl ?? fetch;
  const wait = options.wait ?? ((ms: number) => new Promise((resolve) => setTimeout(resolve, ms)));
  const baseUrl = normalizeBaseUrl(options.baseUrl);
  const accessKey = options.accessKey.trim();
  const syncSecret = options.syncSecret.trim();
  const timeoutMs = parsePositiveInt(options.timeoutMs, DEFAULT_TIMEOUT_MS, "timeoutMs");
  const pollIntervalMs = parsePositiveInt(options.pollIntervalMs, DEFAULT_POLL_INTERVAL_MS, "pollIntervalMs");
  const maxAttempts = Math.max(1, Math.ceil(timeoutMs / pollIntervalMs));
  const requestId = options.requestId?.trim() || `github-app-sync-canary-${crypto.randomUUID()}`;
  const traceId = options.traceId?.trim() || requestId;

  assert(accessKey, "AGENTIC_SMOKE_ACCESS_KEY must be configured.");
  assert(syncSecret, "AGENTIC_GITHUB_APP_SYNC_SECRET must be configured.");

  const syncStartedAt = Date.now();
  const syncResponse = await fetchImpl(`${baseUrl}/api/github/issues/app/sync`, {
    method: "POST",
    headers: {
      Accept: "application/json",
      Authorization: `Bearer ${syncSecret}`,
      "x-request-id": requestId,
      "x-trace-id": traceId
    }
  });
  const syncDurationMs = Math.max(0, Date.now() - syncStartedAt);
  const syncPayload = await readJson<GitHubAppSyncPayload>(syncResponse);

  assert(syncResponse.status === 202, `Expected GitHub App sync to return 202, received ${syncResponse.status}.`);
  assert(syncPayload.ok === true, "GitHub App sync did not report ok=true.");

  const jobs = normalizeJobs(syncPayload);
  assert(jobs.length > 0, "GitHub App sync did not enqueue any github_issue_intake jobs to prove worker durability.");

  const completedJobs: DeploymentGitHubAppSyncCanarySummary["jobs"] = [];
  const pollStartedAt = Date.now();

  for (const job of jobs) {
    const statusUrl = resolveJobStatusUrl(baseUrl, job.id, job.statusUrl);

    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
      const jobResponse = await fetchImpl(statusUrl, {
        headers: {
          Accept: "application/json",
          [AGENTIC_ACCESS_KEY_HEADER]: accessKey,
          "x-request-id": requestId,
          "x-trace-id": traceId
        }
      });
      const jobPayload = await readJson<JobPollPayload>(jobResponse);
      const jobStatus = jobPayload.job?.status;

      if (jobResponse.status === 200 && jobStatus === "completed") {
        assert(jobPayload.result !== null && jobPayload.result !== undefined, `Completed GitHub issue intake job ${job.id} did not include a result payload.`);
        completedJobs.push({
          ...job,
          goalId: jobPayload.job?.goalId ?? job.goalId,
          attempts: attempt,
          statusUrl
        });
        break;
      }

      if (jobStatus === "dead_letter") {
        throw new Error(jobPayload.error?.trim() || `GitHub App sync canary dead-lettered job ${job.id}.`);
      }

      if (jobResponse.status !== 202 || (jobStatus !== "queued" && jobStatus !== "running" && jobStatus !== "retrying")) {
        throw new Error(
          `GitHub App sync canary observed an unexpected job response for ${job.id}: status=${jobResponse.status}, jobStatus=${jobStatus ?? "unknown"}.`
        );
      }

      if (attempt < maxAttempts) {
        await wait(pollIntervalMs);
      }
    }

    if (!completedJobs.some((completedJob) => completedJob.id === job.id)) {
      throw new Error(`GitHub App sync canary timed out waiting for job ${job.id} after ${maxAttempts} poll attempt(s).`);
    }
  }

  return {
    synchronizedAt: syncPayload.synchronizedAt ?? null,
    automationMode: syncPayload.automationMode ?? null,
    repositories: normalizeRepositories(syncPayload),
    jobs: completedJobs,
    requestId,
    traceId,
    syncDurationMs,
    pollDurationMs: Math.max(0, Date.now() - pollStartedAt)
  };
}
