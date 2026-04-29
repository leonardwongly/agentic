import {
  buildApprovalNotificationDeliveryTarget,
  createJobExecutionJournal,
  JobRecordSchema,
  JobStatusSchema,
  TaskSchema,
  TaskStateSchema,
  WorkflowStateSchema,
  nowIso,
  type AgentName,
  type ActorContext,
  type ApprovalRequest,
  type Capability,
  type Goal,
  type JobKind,
  type JobPayload,
  type JobPriority,
  type JobRecord,
  type JobStatus,
  type RiskClass,
  type Task,
  type TaskState,
  type Watcher,
  type WorkflowState
} from "@agentic/contracts";
import {
  recordCounter,
  withSpan,
  withTelemetryContext
} from "@agentic/observability";

const legalTaskTransitions: Record<TaskState, readonly TaskState[]> = {
  queued: ["running", "waiting", "blocked", "failed", "completed"],
  running: ["waiting", "blocked", "failed", "completed"],
  waiting: ["queued", "running", "blocked", "completed"],
  blocked: ["queued", "running"],
  retrying: ["running", "failed"],
  failed: ["retrying", "blocked"],
  completed: []
};

const legalJobTransitions: Record<JobStatus, readonly JobStatus[]> = {
  queued: ["running"],
  running: ["retrying", "completed", "dead_letter"],
  retrying: ["running"],
  completed: [],
  dead_letter: []
};

export type ClaimNextJobParams = {
  userId?: string;
  kinds?: JobKind[];
  now?: string;
  concurrencyLimits?: JobConcurrencyLimits;
};

export type AcknowledgeJobParams = {
  jobId: string;
  now?: string;
};

export type FailJobParams = {
  job: JobRecord;
  error: string | Error;
  now?: string;
};

export type JobQueueStore = {
  enqueueJob(job: JobRecord): Promise<JobRecord>;
  claimNextJob(params: {
    userId?: string;
    kinds?: JobKind[];
    runnerId: string;
    leaseMs: number;
    now?: string;
    concurrencyLimits?: JobConcurrencyLimits;
  }): Promise<JobRecord | null>;
  completeJob(params: {
    jobId: string;
    runnerId: string;
    completedAt?: string;
  }): Promise<JobRecord>;
  retryJob(params: {
    jobId: string;
    runnerId: string;
    availableAt: string;
    error: string;
  }): Promise<JobRecord>;
  deadLetterJob(params: {
    jobId: string;
    runnerId: string;
    deadLetteredAt?: string;
    error: string;
  }): Promise<JobRecord>;
};

export type DurableJobQueue = {
  enqueue(job: JobRecord): Promise<JobRecord>;
  claimNext(params?: ClaimNextJobParams): Promise<JobRecord | null>;
  acknowledge(params: AcknowledgeJobParams): Promise<JobRecord>;
  fail(params: FailJobParams): Promise<JobRecord>;
};

export type JobRetryPolicy = {
  baseDelayMs: number;
  factor: number;
  maxDelayMs: number;
};

export type JobConcurrencyLimits = {
  maxRunningPerKind?: number;
  maxRunningPerUser?: number;
  maxRunningPerConcurrencyKey?: number;
};

export type JobHandler = (job: JobRecord) => Promise<void>;

export type JobHandlerMap = Partial<Record<JobKind, JobHandler>>;

export type ProcessNextDurableJobResult = {
  claimedJob: JobRecord | null;
  finalJob: JobRecord | null;
};

const defaultRetryPolicy: JobRetryPolicy = {
  baseDelayMs: 1_000,
  factor: 2,
  maxDelayMs: 5 * 60_000
};

function deriveJobSideEffectTarget(payload: JobPayload): string | null {
  if (payload.type === "approval_follow_up") {
    return `goal:${payload.goalId}:task:${payload.taskId}`;
  }

  if (payload.type === "approval_notification") {
    return buildApprovalNotificationDeliveryTarget(payload);
  }

  if (payload.type === "autopilot_process") {
    return `autopilot-event:${payload.autopilotEventId}`;
  }

  if ("goalId" in payload && typeof payload.goalId === "string" && payload.goalId.trim()) {
    return `goal:${payload.goalId}`;
  }

  if (payload.type === "privacy_operation") {
    return `privacy:${payload.operationId}`;
  }

  if (payload.type === "public_share_view") {
    return `share:${payload.shareId}`;
  }

  return null;
}

function deriveReplayedFromJobId(payload: JobPayload): string | null {
  const candidate =
    payload.metadata && typeof payload.metadata.replayedFromJobId === "string"
      ? payload.metadata.replayedFromJobId.trim()
      : "";
  return candidate || null;
}

function deriveJobConcurrencyKey(userId: string, kind: JobKind, payload: JobPayload): string {
  const sideEffectTarget = deriveJobSideEffectTarget(payload);
  return sideEffectTarget ? `${userId}:${sideEffectTarget}` : `${userId}:${kind}`;
}

export function createWorkflowState(
  goalId: string,
  currentStep = "intake",
  workspaceId: string | null = null,
  workflowId?: string
): WorkflowState {
  const timestamp = nowIso();

  return WorkflowStateSchema.parse({
    id: workflowId ?? crypto.randomUUID(),
    goalId,
    workspaceId,
    status: "running",
    currentStep,
    checkpoint: null,
    createdAt: timestamp,
    updatedAt: timestamp
  });
}

export function createTask(params: {
  goalId: string;
  workflowId: string;
  title: string;
  summary: string;
  assignedAgent: AgentName;
  riskClass: RiskClass;
  requiresApproval: boolean;
  toolCapabilities: Capability[];
  dependsOn?: string[];
  state?: TaskState;
  responsibility?: Task["responsibility"];
}): Task {
  const timestamp = nowIso();

  return TaskSchema.parse({
    id: crypto.randomUUID(),
    goalId: params.goalId,
    workflowId: params.workflowId,
    title: params.title,
    summary: params.summary,
    assignedAgent: params.assignedAgent,
    state: params.state ?? (params.requiresApproval ? "waiting" : "completed"),
    riskClass: params.riskClass,
    requiresApproval: params.requiresApproval,
    dependsOn: params.dependsOn ?? [],
    toolCapabilities: params.toolCapabilities,
    artifactIds: [],
    responsibility: params.responsibility,
    createdAt: timestamp,
    updatedAt: timestamp
  });
}

export function canTransitionTaskState(from: TaskState, to: TaskState): boolean {
  return legalTaskTransitions[from].includes(to);
}

export function createJobRecord(params: {
  userId: string;
  kind: JobKind;
  payload: JobPayload;
  actorContext?: ActorContext | null;
  idempotencyKey?: string | null;
  maxAttempts?: number;
  availableAt?: string;
  priority?: JobPriority;
  queue?: string;
  concurrencyKey?: string | null;
  timeoutMs?: number | null;
}): JobRecord {
  const timestamp = nowIso();
  const replayedFromJobId = deriveReplayedFromJobId(params.payload);

  return JobRecordSchema.parse({
    id: crypto.randomUUID(),
    userId: params.userId,
    kind: params.kind,
    status: "queued",
    priority: params.priority ?? "normal",
    queue: params.queue?.trim() || "default",
    concurrencyKey: params.concurrencyKey?.trim() || deriveJobConcurrencyKey(params.userId, params.kind, params.payload),
    timeoutMs: params.timeoutMs ?? null,
    idempotencyKey: params.idempotencyKey?.trim() || null,
    payload: params.payload,
    actorContext: params.actorContext ?? null,
    maxAttempts: params.maxAttempts ?? 3,
    attemptCount: 0,
    claimedBy: null,
    lastAttemptAt: null,
    claimedAt: null,
    leaseExpiresAt: null,
    availableAt: params.availableAt ?? timestamp,
    completedAt: null,
    deadLetteredAt: null,
    lastError: null,
    journal: createJobExecutionJournal({
      at: timestamp,
      status: "queued",
      attemptCount: 0,
      maxAttempts: params.maxAttempts ?? 3,
      idempotencyKey: params.idempotencyKey?.trim() || null,
      sideEffectTarget: deriveJobSideEffectTarget(params.payload),
      replayedFromJobId,
      summary: replayedFromJobId
        ? `Replay queued from job ${replayedFromJobId}.`
        : "Job queued for worker execution.",
      recovery: null,
      retryCount: 0
    }),
    createdAt: timestamp,
    updatedAt: timestamp
  });
}

export function canTransitionJobState(from: JobStatus, to: JobStatus): boolean {
  return legalJobTransitions[from].includes(to);
}

export function isJobClaimable(job: JobRecord, now = Date.now()): boolean {
  const availableAt = Date.parse(job.availableAt);

  if (!Number.isFinite(availableAt)) {
    return false;
  }

  if ((job.status === "queued" || job.status === "retrying") && availableAt <= now) {
    return true;
  }

  if (job.status === "running" && job.leaseExpiresAt) {
    const leaseExpiresAt = Date.parse(job.leaseExpiresAt);
    return Number.isFinite(leaseExpiresAt) && leaseExpiresAt <= now;
  }

  return false;
}

export function computeJobRetryDelayMs(
  attemptCount: number,
  policy?: Partial<JobRetryPolicy>,
  options?: {
    jitterRatio?: number;
    random?: () => number;
  }
): number {
  const normalized = {
    ...defaultRetryPolicy,
    ...policy
  };
  const attemptIndex = Math.max(0, attemptCount - 1);
  const multiplier = normalized.factor ** attemptIndex;
  const baseDelay = Math.min(normalized.maxDelayMs, Math.round(normalized.baseDelayMs * multiplier));
  const jitterRatio = Math.max(0, Math.min(1, options?.jitterRatio ?? 0));

  if (jitterRatio === 0) {
    return baseDelay;
  }

  const random = options?.random ?? Math.random;
  const spread = Math.round(baseDelay * jitterRatio);
  const offset = Math.round((random() * 2 - 1) * spread);
  return Math.max(0, Math.min(normalized.maxDelayMs, baseDelay + offset));
}

export function createDurableJobQueue(
  store: JobQueueStore,
  options: {
    runnerId: string;
    leaseMs?: number;
    retryPolicy?: Partial<JobRetryPolicy>;
    concurrencyLimits?: JobConcurrencyLimits;
    retryJitterRatio?: number;
    requireIdempotencyForRetry?: boolean;
  }
): DurableJobQueue {
  const leaseMs = options.leaseMs ?? 30_000;
  const retryPolicy = {
    ...defaultRetryPolicy,
    ...(options.retryPolicy ?? {})
  };

  return {
    async enqueue(job) {
      return withSpan(
        "durable_job.enqueue",
        {
          jobId: job.id,
          jobKind: job.kind
        },
        async () => {
          const created = await store.enqueueJob(job);
          recordCounter("durable_job.enqueue.total", 1, {
            jobKind: created.kind
          });
          return created;
        }
      );
    },
    async claimNext(params) {
      return withSpan(
        "durable_job.claim",
        {
          runnerId: options.runnerId,
          requestedJobKinds: params?.kinds?.join(",") ?? null
        },
        async () => {
          const claimed = await store.claimNextJob({
            userId: params?.userId,
            kinds: params?.kinds,
            runnerId: options.runnerId,
            leaseMs,
            now: params?.now,
            concurrencyLimits: params?.concurrencyLimits ?? options.concurrencyLimits
          });

          recordCounter("durable_job.claim.total", 1, {
            runnerId: options.runnerId,
            claimResult: claimed ? "hit" : "miss",
            jobKind: claimed?.kind ?? null
          });

          return claimed;
        }
      );
    },
    async acknowledge(params) {
      return withSpan(
        "durable_job.acknowledge",
        {
          jobId: params.jobId,
          runnerId: options.runnerId
        },
        async () => {
          const acknowledged = await store.completeJob({
            jobId: params.jobId,
            runnerId: options.runnerId,
            completedAt: params.now ?? nowIso()
          });

          recordCounter("durable_job.completed.total", 1, {
            runnerId: options.runnerId,
            jobKind: acknowledged.kind
          });

          return acknowledged;
        }
      );
    },
    async fail(params) {
      const timestamp = params.now ?? nowIso();
      const error = normalizeJobError(params.error);

      if (
        params.job.attemptCount >= params.job.maxAttempts ||
        (options.requireIdempotencyForRetry === true && !params.job.idempotencyKey)
      ) {
        return withSpan(
          "durable_job.dead_letter",
          {
            jobId: params.job.id,
            jobKind: params.job.kind,
            runnerId: options.runnerId
          },
          async () => {
            const deadLettered = await store.deadLetterJob({
              jobId: params.job.id,
              runnerId: options.runnerId,
              deadLetteredAt: timestamp,
              error
            });

            recordCounter("durable_job.dead_letter.total", 1, {
              runnerId: options.runnerId,
              jobKind: deadLettered.kind
            });

            return deadLettered;
          }
        );
      }

      const retryDelayMs = computeJobRetryDelayMs(params.job.attemptCount, retryPolicy, {
        jitterRatio: params.job.idempotencyKey ? options.retryJitterRatio : 0
      });
      const nextAvailableAt = new Date(Date.parse(timestamp) + retryDelayMs).toISOString();

      return withSpan(
        "durable_job.retry",
        {
          jobId: params.job.id,
          jobKind: params.job.kind,
          runnerId: options.runnerId
        },
        async () => {
          const retried = await store.retryJob({
            jobId: params.job.id,
            runnerId: options.runnerId,
            availableAt: nextAvailableAt,
            error
          });

          recordCounter("durable_job.retry.total", 1, {
            runnerId: options.runnerId,
            jobKind: retried.kind
          });

          return retried;
        }
      );
    }
  };
}

export async function processNextDurableJob(params: {
  queue: DurableJobQueue;
  handlers: JobHandlerMap;
  claim?: ClaimNextJobParams;
}): Promise<ProcessNextDurableJobResult> {
  const job = await params.queue.claimNext(params.claim);

  if (!job) {
    return {
      claimedJob: null,
      finalJob: null
    };
  }

  const handler = params.handlers[job.kind];

  if (!handler) {
    return {
      claimedJob: job,
      finalJob: await params.queue.fail({
        job,
        error: new Error(`No handler registered for durable job kind "${job.kind}".`)
      })
    };
  }

  try {
    await withTelemetryContext(
      {
        jobId: job.id,
        jobKind: job.kind
      },
      () =>
        withSpan(
          "durable_job.process",
          {
            jobId: job.id,
            jobKind: job.kind
          },
          async () => runJobHandlerWithOptionalTimeout(job, handler)
        )
    );
    return {
      claimedJob: job,
      finalJob: await params.queue.acknowledge({ jobId: job.id })
    };
  } catch (error) {
    recordCounter("durable_job.failed.total", 1, {
      jobKind: job.kind
    });
    return {
      claimedJob: job,
      finalJob: await params.queue.fail({ job, error: coerceJobFailure(error) })
    };
  }
}

async function runJobHandlerWithOptionalTimeout(job: JobRecord, handler: JobHandler): Promise<void> {
  if (!job.timeoutMs) {
    await handler(job);
    return;
  }

  let timeout: NodeJS.Timeout | null = null;

  try {
    await Promise.race([
      handler(job),
      new Promise<never>((_, reject) => {
        timeout = setTimeout(() => {
          reject(new Error(`Durable job ${job.id} timed out after ${job.timeoutMs}ms.`));
        }, job.timeoutMs ?? 0);
      })
    ]);
  } finally {
    if (timeout) {
      clearTimeout(timeout);
    }
  }
}

export function transitionTaskState(task: Task, state: TaskState): Task {
  const nextState = TaskStateSchema.parse(state);

  if (!canTransitionTaskState(task.state, nextState)) {
    throw new Error(`Illegal task transition from "${task.state}" to "${nextState}" for task ${task.id}.`);
  }

  return TaskSchema.parse({
    ...task,
    state: nextState,
    updatedAt: nowIso()
  });
}

export function recomputeWorkflowStatuses(
  tasks: Task[],
  approvals: ApprovalRequest[],
  watchers: Watcher[]
): { goalStatus: Goal["status"]; workflowStatus: WorkflowState["status"] } {
  const hasPendingApprovals = approvals.some((approval) => approval.decision === "pending");
  const hasBlockedTask = tasks.some((task) => task.state === "blocked");
  const hasOpenWatchers = watchers.some((watcher) => watcher.status === "active");
  const allTasksCompleted = tasks.every((task) => task.state === "completed");

  if (hasPendingApprovals) {
    return {
      goalStatus: "waiting",
      workflowStatus: "waiting"
    };
  }

  if (hasBlockedTask) {
    return {
      goalStatus: "running",
      workflowStatus: "running"
    };
  }

  if (allTasksCompleted && !hasOpenWatchers) {
    return {
      goalStatus: "completed",
      workflowStatus: "completed"
    };
  }

  return {
    goalStatus: "running",
    workflowStatus: "running"
  };
}

function normalizeJobError(error: string | Error): string {
  const message = typeof error === "string" ? error : error.message;
  const normalized = message.trim();
  return (normalized.length > 0 ? normalized : "Job execution failed.").slice(0, 1000);
}

function coerceJobFailure(error: unknown): string | Error {
  if (typeof error === "string" || error instanceof Error) {
    return error;
  }

  return new Error("Job execution failed.");
}
