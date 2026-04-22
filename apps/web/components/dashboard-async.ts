import type { BriefingType, GoalTemplate } from "@agentic/contracts";
import type { DashboardData } from "@agentic/repository";

type QueuedJobStatus = "queued" | "running" | "retrying" | "completed" | "dead_letter";

export type NLIntentQueuedJob = {
  id: string;
  kind: "goal_create" | "briefing_create";
  status: QueuedJobStatus;
  goalId: string;
  briefingType?: BriefingType;
  attemptCount: number;
  maxAttempts: number;
  createdAt: string;
  updatedAt: string;
};

export type NLIntentApiResponse = {
  message: string;
  data?: unknown;
  dashboard?: DashboardData;
  job?: NLIntentQueuedJob;
  statusUrl?: string;
};

export type GoalQueuedApiResponse = {
  job: {
    id: string;
    kind: "goal_create" | "goal_refine";
    status: QueuedJobStatus;
    goalId: string;
    attemptCount: number;
    maxAttempts: number;
    createdAt: string;
    updatedAt: string;
  };
  statusUrl: string;
};

export type GoalQueuedJob = GoalQueuedApiResponse["job"];

export type GoalJobStatusApiResponse = {
  job: GoalQueuedJob;
  result: {
    goalId: string;
    goalStatus: "planned" | "running" | "waiting" | "completed";
    taskCount: number;
    completedTaskCount: number;
    pendingApprovalCount: number;
    artifactCount: number;
    watcherCount: number;
    requiresReview: boolean;
  } | null;
  error: string | null;
};

export type BriefingCreateApiResponse = {
  job: {
    id: string;
    kind: "briefing_create";
    status: QueuedJobStatus;
    goalId: string;
    briefingType: BriefingType;
    attemptCount: number;
    maxAttempts: number;
    createdAt: string;
    updatedAt: string;
  };
  statusUrl: string;
};

export type BriefingJobStatusApiResponse = {
  job: BriefingCreateApiResponse["job"];
  result: GoalJobStatusApiResponse["result"];
  error: string | null;
};

export type TemplateRunApiResponse = {
  job: {
    id: string;
    kind: "template_run";
    status: QueuedJobStatus;
    templateId: string;
    goalId: string;
    attemptCount: number;
    maxAttempts: number;
    createdAt: string;
    updatedAt: string;
  };
  statusUrl: string;
};

export type TemplateRunJobStatusApiResponse = {
  job: TemplateRunApiResponse["job"];
  result: GoalJobStatusApiResponse["result"];
  error: string | null;
};

export type DocsRenderApiResponse = {
  job: {
    id: string;
    kind: "docs_render";
    status: QueuedJobStatus;
    attemptCount: number;
    maxAttempts: number;
    createdAt: string;
    updatedAt: string;
  };
  statusUrl: string;
};

export type DocsRenderJobStatusApiResponse = {
  job: DocsRenderApiResponse["job"];
  result: {
    message: string;
  } | null;
  error: string | null;
};

type DashboardAsyncOptions = {
  fetchImpl?: typeof fetch;
};

type PollJobStatusOptions = DashboardAsyncOptions & {
  pollIntervalMs?: number;
  timeoutMs?: number;
};

const GOAL_JOB_POLL_INTERVAL_MS = 500;
const GOAL_JOB_POLL_TIMEOUT_MS = 60_000;

export async function readJson<T>(response: Response): Promise<T> {
  const payload = (await response.json()) as T & { error?: string };

  if (!response.ok) {
    const message = typeof payload === "object" && payload && "error" in payload ? String(payload.error) : "Request failed.";
    throw new Error(message);
  }

  return payload;
}

export function buildClientIdempotencyKey(): string {
  return typeof globalThis.crypto?.randomUUID === "function"
    ? globalThis.crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

export async function loadDashboardSnapshot(
  options: DashboardAsyncOptions = {}
): Promise<{ dashboard: DashboardData }> {
  return readJson<{ dashboard: DashboardData }>(
    await (options.fetchImpl ?? fetch)("/api/goals", {
      cache: "no-store"
    })
  );
}

export async function loadTemplatesSnapshot(
  options: DashboardAsyncOptions = {}
): Promise<{ templates: GoalTemplate[] }> {
  return readJson<{ templates: GoalTemplate[] }>(
    await (options.fetchImpl ?? fetch)("/api/templates", {
      cache: "no-store"
    })
  );
}

export async function pollJobStatusUntilSettled<T extends { job: { status: QueuedJobStatus } }>(
  statusUrl: string,
  options: PollJobStatusOptions = {}
): Promise<T | null> {
  const startedAt = Date.now();
  const fetchImpl = options.fetchImpl ?? fetch;
  const pollIntervalMs = options.pollIntervalMs ?? GOAL_JOB_POLL_INTERVAL_MS;
  const timeoutMs = options.timeoutMs ?? GOAL_JOB_POLL_TIMEOUT_MS;

  while (Date.now() - startedAt < timeoutMs) {
    const payload = await readJson<T>(
      await fetchImpl(statusUrl, {
        cache: "no-store"
      })
    );

    if (payload.job.status === "completed" || payload.job.status === "dead_letter") {
      return payload;
    }

    await waitForDelay(pollIntervalMs);
  }

  return null;
}

async function waitForDelay(ms: number): Promise<void> {
  await new Promise((resolve) => globalThis.setTimeout(resolve, ms));
}
