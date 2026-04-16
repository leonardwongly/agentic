import {
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
  type JobRecord,
  type JobStatus,
  type JobPayload,
  type RiskClass,
  type Task,
  type TaskState,
  type Watcher,
  type WorkflowState
} from "@agentic/contracts";

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
}): JobRecord {
  const timestamp = nowIso();

  return JobRecordSchema.parse({
    id: crypto.randomUUID(),
    userId: params.userId,
    kind: params.kind,
    status: "queued",
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

export function computeJobRetryDelayMs(attemptCount: number, policy?: Partial<JobRetryPolicy>): number {
  const normalized = {
    ...defaultRetryPolicy,
    ...policy
  };
  const attemptIndex = Math.max(0, attemptCount - 1);
  const multiplier = normalized.factor ** attemptIndex;
  return Math.min(normalized.maxDelayMs, Math.round(normalized.baseDelayMs * multiplier));
}

export function createDurableJobQueue(
  store: JobQueueStore,
  options: {
    runnerId: string;
    leaseMs?: number;
    retryPolicy?: Partial<JobRetryPolicy>;
  }
): DurableJobQueue {
  const leaseMs = options.leaseMs ?? 30_000;
  const retryPolicy = {
    ...defaultRetryPolicy,
    ...(options.retryPolicy ?? {})
  };

  return {
    enqueue(job) {
      return store.enqueueJob(job);
    },
    claimNext(params) {
      return store.claimNextJob({
        userId: params?.userId,
        kinds: params?.kinds,
        runnerId: options.runnerId,
        leaseMs,
        now: params?.now
      });
    },
    acknowledge(params) {
      return store.completeJob({
        jobId: params.jobId,
        runnerId: options.runnerId,
        completedAt: params.now ?? nowIso()
      });
    },
    async fail(params) {
      const timestamp = params.now ?? nowIso();
      const error = normalizeJobError(params.error);

      if (params.job.attemptCount >= params.job.maxAttempts) {
        return store.deadLetterJob({
          jobId: params.job.id,
          runnerId: options.runnerId,
          deadLetteredAt: timestamp,
          error
        });
      }

      const nextAvailableAt = new Date(
        Date.parse(timestamp) + computeJobRetryDelayMs(params.job.attemptCount, retryPolicy)
      ).toISOString();

      return store.retryJob({
        jobId: params.job.id,
        runnerId: options.runnerId,
        availableAt: nextAvailableAt,
        error
      });
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
    await handler(job);
    return {
      claimedJob: job,
      finalJob: await params.queue.acknowledge({ jobId: job.id })
    };
  } catch (error) {
    return {
      claimedJob: job,
      finalJob: await params.queue.fail({ job, error: coerceJobFailure(error) })
    };
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
