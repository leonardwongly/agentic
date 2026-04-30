import type { JobRecord, JobStatus } from "@agentic/contracts";

export type JobEventSnapshot = {
  job: {
    id: string;
    kind: JobRecord["kind"];
    status: JobStatus;
    attemptCount: number;
    maxAttempts: number;
    createdAt: string;
    updatedAt: string;
  };
  event: {
    schemaVersion: 1;
    observedAt: string;
    terminal: boolean;
  };
};

export function buildJobEventSnapshot(job: JobRecord, observedAt = new Date().toISOString()): JobEventSnapshot {
  return {
    job: {
      id: job.id,
      kind: job.kind,
      status: job.status,
      attemptCount: job.attemptCount,
      maxAttempts: job.maxAttempts,
      createdAt: job.createdAt,
      updatedAt: job.updatedAt
    },
    event: {
      schemaVersion: 1,
      observedAt,
      terminal: job.status === "completed" || job.status === "dead_letter"
    }
  };
}

export function encodeServerSentEvent(params: {
  id: number;
  event: string;
  data: unknown;
}): string {
  return [`id: ${params.id}`, `event: ${params.event}`, `data: ${JSON.stringify(params.data)}`, ""].join("\n") + "\n";
}

export function parseLastEventId(value: string | null): number {
  if (!value) {
    return 0;
  }

  const parsed = Number.parseInt(value, 10);
  return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : 0;
}

export function parseBoundedInteger(params: {
  value: string | null;
  fallback: number;
  min: number;
  max: number;
}): number {
  if (!params.value) {
    return params.fallback;
  }

  const parsed = Number.parseInt(params.value, 10);
  if (!Number.isSafeInteger(parsed)) {
    return params.fallback;
  }

  return Math.min(params.max, Math.max(params.min, parsed));
}
