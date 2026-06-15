import crypto from "node:crypto";
import {
  buildApprovalNotificationDeliveryTarget,
  createJobExecutionJournal,
  JobRecordSchema,
  JobStatusSchema,
  TaskSchema,
  TaskStateSchema,
  WorkflowStateSchema,
  WorkflowDagInstanceSchema,
  WorkflowDagNodeExecutionSchema,
  WorkflowDagSchema,
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
  type WorkflowDag,
  type WorkflowDagInstance,
  type WorkflowDagNode,
  type WorkflowDagNodeExecution,
  type WorkflowDagNodeStatus,
  type WorkflowDagStatus,
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

function buildWorkflowNodeExecutionId(instanceId: string, nodeId: string): string {
  const executionId = `${instanceId}:${nodeId}`;
  if (executionId.length <= 160) {
    return executionId;
  }

  const digest = crypto.createHash("sha256").update(executionId).digest("hex").slice(0, 16);
  return `${executionId.slice(0, 143)}:${digest}`;
}

const legalJobTransitions: Record<JobStatus, readonly JobStatus[]> = {
  queued: ["running", "cancelled"],
  running: ["retrying", "completed", "dead_letter", "paused", "cancelled"],
  retrying: ["running", "cancelled"],
  paused: ["queued", "running", "cancelled"],
  cancelled: [],
  completed: [],
  dead_letter: []
};

const legalWorkflowDagTransitions: Record<WorkflowDagStatus, readonly WorkflowDagStatus[]> = {
  queued: ["running", "paused", "cancelled"],
  running: ["paused", "completed", "failed", "cancelled"],
  paused: ["running", "cancelled"],
  completed: [],
  failed: ["running", "cancelled"],
  cancelled: []
};

const legalWorkflowDagNodeTransitions: Record<WorkflowDagNodeStatus, readonly WorkflowDagNodeStatus[]> = {
  queued: ["running", "skipped", "cancelled"],
  running: ["paused", "completed", "failed", "cancelled"],
  paused: ["running", "cancelled"],
  completed: [],
  failed: ["queued", "running", "cancelled"],
  skipped: [],
  cancelled: []
};

const workflowRiskRank: Record<RiskClass, number> = {
  R1: 1,
  R2: 2,
  R3: 3,
  R4: 4
};

export type ClaimNextJobParams = {
  userId?: string;
  kinds?: JobKind[];
  queue?: string;
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
    queue?: string;
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

export type JobHandlerContext = {
  signal: AbortSignal;
};

export type JobHandler = (job: JobRecord, context?: JobHandlerContext) => Promise<void>;

export type JobHandlerMap = Partial<Record<JobKind, JobHandler>>;

export type ProcessNextDurableJobResult = {
  claimedJob: JobRecord | null;
  finalJob: JobRecord | null;
};

// AOS-25: in-attempt cancellation propagation. A job claimed as "running" can be
// cancelled by operator control (status -> "cancelled") or have its lease taken
// over by another worker (claimedBy changes) while a handler is mid-flight. The
// cancellation watch lets the dispatcher re-read the durable record on an interval,
// abort the handler's AbortSignal promptly, and then abandon the attempt without
// calling completeJob/retryJob/deadLetterJob (which would throw not_running on a job
// the worker no longer owns). The watch is optional and entirely additive: when it
// is absent the dispatcher behaves exactly as before.
export type JobCancellationWatch = {
  /** Re-read the latest durable record for the in-flight job; null when it is gone. */
  readLatest: (job: JobRecord) => Promise<JobRecord | null>;
  /** How often to re-read the job while a handler runs. Defaults to 1000ms. */
  pollIntervalMs?: number;
};

const defaultRetryPolicy: JobRetryPolicy = {
  baseDelayMs: 1_000,
  factor: 2,
  maxDelayMs: 5 * 60_000
};
const DEFAULT_TIMEOUT_SETTLEMENT_GRACE_MS = 100;
const DEFAULT_CANCELLATION_POLL_INTERVAL_MS = 1_000;

class JobCancelledError extends Error {
  constructor(jobId: string) {
    super(`Durable job ${jobId} was cancelled while in flight.`);
    this.name = "JobCancelledError";
  }
}

/**
 * A claimed job is no longer ours to settle once it leaves "running" (an operator
 * cancel transitions it to "cancelled") or once another worker takes the lease
 * (claimedBy changes). In both cases the in-flight attempt must be abandoned without
 * calling completeJob/retryJob/deadLetterJob, which assert the running owner.
 */
function isJobOwnershipLost(claimed: JobRecord, current: JobRecord | null): boolean {
  return current === null || current.status !== "running" || current.claimedBy !== claimed.claimedBy;
}

function isPositiveInteger(value: number | undefined): boolean {
  return Number.isInteger(value) && value !== undefined && value > 0;
}

function hasPositiveConcurrencyLimit(limits: JobConcurrencyLimits | undefined): boolean {
  return Boolean(
    isPositiveInteger(limits?.maxRunningPerKind) ||
      isPositiveInteger(limits?.maxRunningPerUser) ||
      isPositiveInteger(limits?.maxRunningPerConcurrencyKey)
  );
}

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

  if (payload.type === "github_issue_intake") {
    return `github-issue:${payload.repository.fullName.toLowerCase()}#${payload.issue.number}`;
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
    concurrencyKey:
      params.concurrencyKey === null
        ? null
        : params.concurrencyKey?.trim() || deriveJobConcurrencyKey(params.userId, params.kind, params.payload),
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

export class WorkflowDagValidationError extends Error {
  constructor(
    public readonly issues: string[],
    message = `Workflow DAG validation failed: ${issues.join("; ")}`,
    options?: ErrorOptions
  ) {
    super(message, options);
    this.name = "WorkflowDagValidationError";
  }
}

function capabilityGrantSatisfiesWorkflowNode(node: WorkflowDagNode): boolean {
  switch (node.actionIntent.type) {
    case "send_message":
      return node.actionIntent.mode === "send"
        ? node.permissionGrant.capabilities.includes("send")
        : node.permissionGrant.capabilities.includes("draft") || node.permissionGrant.capabilities.includes("send");
    case "schedule_event":
      return node.permissionGrant.capabilities.includes("schedule");
    case "create_note":
      return node.permissionGrant.capabilities.includes("create");
    case "update_record":
      return node.permissionGrant.capabilities.includes("update");
    case "delete_record":
      return node.permissionGrant.capabilities.includes("delete");
    case "monitor_signal":
      return node.permissionGrant.capabilities.includes("monitor");
    case "manual_review":
    default:
      return true;
  }
}

function buildWorkflowDagAdjacency(dag: WorkflowDag): Map<string, Set<string>> {
  const adjacency = new Map<string, Set<string>>();

  for (const node of dag.nodes) {
    adjacency.set(node.id, new Set());
  }

  for (const node of dag.nodes) {
    for (const dependency of node.dependsOn) {
      adjacency.get(dependency)?.add(node.id);
    }
  }

  for (const edge of dag.edges) {
    adjacency.get(edge.from)?.add(edge.to);
  }

  return adjacency;
}

function findWorkflowDagCycle(dag: WorkflowDag): string[] | null {
  const adjacency = buildWorkflowDagAdjacency(dag);
  const visiting = new Set<string>();
  const visited = new Set<string>();
  const path: string[] = [];

  const visit = (nodeId: string): string[] | null => {
    if (visiting.has(nodeId)) {
      return [...path.slice(path.indexOf(nodeId)), nodeId];
    }

    if (visited.has(nodeId)) {
      return null;
    }

    visiting.add(nodeId);
    path.push(nodeId);

    for (const next of adjacency.get(nodeId) ?? []) {
      const cycle = visit(next);

      if (cycle) {
        return cycle;
      }
    }

    visiting.delete(nodeId);
    visited.add(nodeId);
    path.pop();
    return null;
  };

  for (const node of dag.nodes) {
    const cycle = visit(node.id);

    if (cycle) {
      return cycle;
    }
  }

  return null;
}

export function validateWorkflowDag(input: WorkflowDag): WorkflowDag {
  const dag = WorkflowDagSchema.parse(input);
  const issues: string[] = [];
  const cycle = findWorkflowDagCycle(dag);

  if (cycle) {
    issues.push(`cycle detected: ${cycle.join(" -> ")}`);
  }

  for (const node of dag.nodes) {
    if (!capabilityGrantSatisfiesWorkflowNode(node)) {
      issues.push(`node ${node.id} is missing required capabilities for ${node.actionIntent.type}`);
    }

    if (workflowRiskRank[node.actionIntent.riskClass] > workflowRiskRank[node.permissionGrant.maxRiskClass]) {
      issues.push(
        `node ${node.id} action risk ${node.actionIntent.riskClass} exceeds permission ceiling ${node.permissionGrant.maxRiskClass}`
      );
    }

    if (node.compensation.required && !node.compensation.actionIntent) {
      issues.push(`node ${node.id} requires compensation but has no compensation action intent`);
    }
  }

  if (issues.length > 0) {
    throw new WorkflowDagValidationError(issues);
  }

  return dag;
}

export function createWorkflowDagInstance(params: {
  dag: WorkflowDag;
  instanceId?: string;
  now?: string;
}): WorkflowDagInstance {
  const dag = validateWorkflowDag(params.dag);
  const timestamp = params.now ?? nowIso();
  const instanceId = params.instanceId ?? crypto.randomUUID();

  return WorkflowDagInstanceSchema.parse({
    id: instanceId,
    dagId: dag.id,
    workflowId: dag.workflowId,
    status: "queued",
    nodeExecutions: dag.nodes.map((node) =>
      WorkflowDagNodeExecutionSchema.parse({
        id: buildWorkflowNodeExecutionId(instanceId, node.id),
        instanceId,
        nodeId: node.id,
        status: "queued",
        attemptCount: 0,
        maxAttempts: node.retryPolicy.maxAttempts,
        runnerId: null,
        lastError: null,
        startedAt: null,
        completedAt: null,
        updatedAt: timestamp
      })
    ),
    auditLog: [`${timestamp} workflow DAG instance created from ${dag.id}`],
    createdAt: timestamp,
    updatedAt: timestamp
  });
}

export function transitionWorkflowDagInstance(params: {
  instance: WorkflowDagInstance;
  status: WorkflowDagStatus;
  reason?: string | null;
  now?: string;
}): WorkflowDagInstance {
  const current = WorkflowDagInstanceSchema.parse(params.instance);
  const nextStatus = params.status;

  if (!legalWorkflowDagTransitions[current.status].includes(nextStatus)) {
    throw new Error(`Illegal workflow DAG transition from "${current.status}" to "${nextStatus}" for instance ${current.id}.`);
  }

  const timestamp = params.now ?? nowIso();

  return WorkflowDagInstanceSchema.parse({
    ...current,
    status: nextStatus,
    pausedAt: nextStatus === "paused" ? timestamp : nextStatus === "running" ? null : current.pausedAt,
    cancelledAt: nextStatus === "cancelled" ? timestamp : current.cancelledAt,
    cancelReason: nextStatus === "cancelled" ? params.reason ?? "Workflow DAG cancelled." : current.cancelReason,
    auditLog: [
      ...current.auditLog,
      `${timestamp} transitioned from ${current.status} to ${nextStatus}${params.reason ? `: ${params.reason}` : ""}`
    ],
    updatedAt: timestamp
  });
}

export function transitionWorkflowDagNode(params: {
  execution: WorkflowDagNodeExecution;
  status: WorkflowDagNodeStatus;
  runnerId?: string | null;
  error?: string | null;
  now?: string;
}): WorkflowDagNodeExecution {
  const current = WorkflowDagNodeExecutionSchema.parse(params.execution);
  const nextStatus = params.status;

  if (!legalWorkflowDagNodeTransitions[current.status].includes(nextStatus)) {
    throw new Error(`Illegal workflow DAG node transition from "${current.status}" to "${nextStatus}" for node ${current.nodeId}.`);
  }

  const timestamp = params.now ?? nowIso();
  const startsNewAttempt = nextStatus === "running" && (current.status === "queued" || current.status === "failed");

  if (startsNewAttempt && current.attemptCount >= current.maxAttempts) {
    throw new Error(
      `Workflow DAG node ${current.nodeId} exhausted retry attempts (${current.attemptCount}/${current.maxAttempts}).`
    );
  }

  return WorkflowDagNodeExecutionSchema.parse({
    ...current,
    status: nextStatus,
    runnerId: params.runnerId ?? current.runnerId,
    attemptCount: startsNewAttempt ? current.attemptCount + 1 : current.attemptCount,
    lastError: params.error ?? (nextStatus === "running" || nextStatus === "completed" ? null : current.lastError),
    startedAt: nextStatus === "running" ? timestamp : current.startedAt,
    completedAt: nextStatus === "completed" || nextStatus === "skipped" || nextStatus === "cancelled" ? timestamp : current.completedAt,
    updatedAt: timestamp
  });
}

export function retryWorkflowDagNode(params: {
  instance: WorkflowDagInstance;
  nodeId: string;
  now?: string;
}): WorkflowDagInstance {
  const current = WorkflowDagInstanceSchema.parse(params.instance);
  const execution = current.nodeExecutions.find((candidate) => candidate.nodeId === params.nodeId);

  if (!execution) {
    throw new Error(`Workflow DAG node ${params.nodeId} was not found in instance ${current.id}.`);
  }

  if (execution.status !== "failed") {
    throw new Error(`Workflow DAG node ${params.nodeId} must be failed before it can be retried.`);
  }

  if (execution.attemptCount >= execution.maxAttempts) {
    throw new Error(
      `Workflow DAG node ${params.nodeId} exhausted retry attempts (${execution.attemptCount}/${execution.maxAttempts}).`
    );
  }

  const timestamp = params.now ?? nowIso();
  const retried = WorkflowDagNodeExecutionSchema.parse({
    ...execution,
    status: "queued",
    runnerId: null,
    lastError: null,
    updatedAt: timestamp
  });

  return WorkflowDagInstanceSchema.parse({
    ...current,
    status: current.status === "failed" ? "running" : current.status,
    nodeExecutions: current.nodeExecutions.map((candidate) => (candidate.nodeId === params.nodeId ? retried : candidate)),
    auditLog: [...current.auditLog, `${timestamp} queued retry for node ${params.nodeId}`],
    updatedAt: timestamp
  });
}

export function inspectWorkflowDagInstance(instance: WorkflowDagInstance) {
  const parsed = WorkflowDagInstanceSchema.parse(instance);
  const counts = parsed.nodeExecutions.reduce<Record<WorkflowDagNodeStatus, number>>(
    (memo, execution) => {
      memo[execution.status] += 1;
      return memo;
    },
    {
      queued: 0,
      running: 0,
      paused: 0,
      completed: 0,
      failed: 0,
      skipped: 0,
      cancelled: 0
    }
  );

  return {
    id: parsed.id,
    dagId: parsed.dagId,
    workflowId: parsed.workflowId,
    status: parsed.status,
    counts,
    nodeExecutions: parsed.nodeExecutions.map((execution) => ({
      nodeId: execution.nodeId,
      status: execution.status,
      attemptCount: execution.attemptCount,
      runnerId: execution.runnerId,
      lastError: execution.lastError
    }))
  };
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
      const effectiveConcurrencyLimits = params?.concurrencyLimits ?? options.concurrencyLimits;
      const concurrencyLimited = hasPositiveConcurrencyLimit(effectiveConcurrencyLimits);

      return withSpan(
        "durable_job.claim",
        {
          runnerId: options.runnerId,
          requestedJobKinds: params?.kinds?.join(",") ?? null,
          queue: params?.queue ?? null,
          concurrencyLimited
        },
        async () => {
          const claimed = await store.claimNextJob({
            userId: params?.userId,
            kinds: params?.kinds,
            queue: params?.queue,
            runnerId: options.runnerId,
            leaseMs,
            now: params?.now,
            concurrencyLimits: effectiveConcurrencyLimits
          });

          recordCounter("durable_job.claim.total", 1, {
            runnerId: options.runnerId,
            claimResult: claimed ? "hit" : "miss",
            jobKind: claimed?.kind ?? null,
            queue: params?.queue ?? claimed?.queue ?? null,
            concurrencyLimited
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
  cancellation?: JobCancellationWatch;
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

  // When a cancellation watch is configured, re-read the job after the attempt
  // settles. If the job was cancelled or its lease was taken over, abandon the
  // attempt cleanly instead of acknowledging/failing a job we no longer own.
  const settleIfOwnershipLost = async (): Promise<ProcessNextDurableJobResult | null> => {
    if (!params.cancellation) {
      return null;
    }

    const current = await params.cancellation.readLatest(job);
    if (!isJobOwnershipLost(job, current)) {
      return null;
    }

    recordCounter("durable_job.cancelled.total", 1, {
      jobKind: job.kind
    });
    return {
      claimedJob: job,
      finalJob: current
    };
  };

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
          async () => runJobHandlerWithOptionalTimeout(job, handler, params.cancellation)
        )
    );

    const cancelled = await settleIfOwnershipLost();
    if (cancelled) {
      return cancelled;
    }

    return {
      claimedJob: job,
      finalJob: await params.queue.acknowledge({ jobId: job.id })
    };
  } catch (error) {
    const cancelled = await settleIfOwnershipLost();
    if (cancelled) {
      return cancelled;
    }

    recordCounter("durable_job.failed.total", 1, {
      jobKind: job.kind
    });
    return {
      claimedJob: job,
      finalJob: await params.queue.fail({ job, error: coerceJobFailure(error) })
    };
  }
}

async function runJobHandlerWithOptionalTimeout(
  job: JobRecord,
  handler: JobHandler,
  cancellation?: JobCancellationWatch
): Promise<void> {
  // Fast path preserved exactly: no timeout and no cancellation watch means a
  // fresh, never-aborted signal and a direct await.
  if (!job.timeoutMs && !cancellation) {
    await handler(job, { signal: new AbortController().signal });
    return;
  }

  const controller = new AbortController();
  const handlerPromise = Promise.resolve().then(() => handler(job, { signal: controller.signal }));
  const cleanups: Array<() => void> = [];
  const timeoutError = new Error(`Durable job ${job.id} timed out after ${job.timeoutMs}ms.`);
  const cancelledError = new JobCancelledError(job.id);
  const raceContenders: Array<Promise<void>> = [handlerPromise];
  let timedOut = false;
  let cancelled = false;
  let done = false;

  if (job.timeoutMs) {
    raceContenders.push(
      new Promise<void>((resolve) => {
        const timeout = setTimeout(() => {
          timedOut = true;
          controller.abort(timeoutError);
          resolve();
        }, job.timeoutMs ?? 0);
        cleanups.push(() => clearTimeout(timeout));
      })
    );
  }

  if (cancellation) {
    const pollIntervalMs = Math.max(1, cancellation.pollIntervalMs ?? DEFAULT_CANCELLATION_POLL_INTERVAL_MS);
    raceContenders.push(
      new Promise<void>((resolve) => {
        const interval = setInterval(() => {
          if (done || timedOut || cancelled) {
            return;
          }

          void cancellation
            .readLatest(job)
            .then((current) => {
              if (done || timedOut || cancelled) {
                return;
              }

              if (isJobOwnershipLost(job, current)) {
                cancelled = true;
                controller.abort(cancelledError);
                resolve();
              }
            })
            .catch(() => {
              // A transient read failure must not abort a healthy attempt; keep polling.
            });
        }, pollIntervalMs);
        cleanups.push(() => clearInterval(interval));
      })
    );
  }

  try {
    await Promise.race(raceContenders);

    if (timedOut || cancelled) {
      const handlerSettled = await waitForHandlerSettlement(handlerPromise, DEFAULT_TIMEOUT_SETTLEMENT_GRACE_MS);
      if (!handlerSettled) {
        handlerPromise.catch(() => undefined);
      }
      throw cancelled ? cancelledError : timeoutError;
    }
  } finally {
    done = true;
    for (const cleanup of cleanups) {
      cleanup();
    }
  }
}

async function waitForHandlerSettlement(handlerPromise: Promise<void>, graceMs: number): Promise<boolean> {
  return new Promise((resolve) => {
    let settled = false;
    const timeout = setTimeout(() => {
      if (!settled) {
        settled = true;
        resolve(false);
      }
    }, graceMs);

    handlerPromise
      .then(
        () => true,
        () => true
      )
      .then((handlerSettled) => {
        if (settled) {
          return;
        }

        settled = true;
        clearTimeout(timeout);
        resolve(handlerSettled);
      });
  });
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
  watchers: Watcher[],
  controlStatus?: "paused" | "cancelled" | null
): { goalStatus: Goal["status"]; workflowStatus: WorkflowState["status"] } {
  // AOS-25: a persisted operator pause/cancel control takes precedence over the
  // status derived from tasks/approvals/watchers, so governed control is never
  // clobbered back to "running"/"completed" on the next recompute. The Goal status
  // enum has no paused/cancelled member, so both controls roll up to "waiting" at
  // the goal level (a non-terminal halt that, unlike "completed", does not trigger
  // the worker's success-completion side effects); the authoritative paused/cancelled
  // state lives on the free-form WorkflowState status and the persisted control log.
  if (controlStatus === "paused") {
    return { goalStatus: "waiting", workflowStatus: "paused" };
  }
  if (controlStatus === "cancelled") {
    return { goalStatus: "waiting", workflowStatus: "cancelled" };
  }

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
