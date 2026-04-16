import crypto from "node:crypto";
import {
  createSystemActorContext,
  type ActorContext,
  type GoalBundle,
  type GoalCreateJobPayload,
  type JobKind,
  type JobRecord,
  type WorkspaceGovernance
} from "@agentic/contracts";
import {
  createDurableJobQueue,
  createJobRecord,
  processNextDurableJob,
  type ClaimNextJobParams,
  type JobHandlerMap,
  type JobRetryPolicy
} from "@agentic/execution";
import { captureMemoriesFromBundle, processUserRequest } from "@agentic/orchestrator";
import type { AgenticRepository } from "@agentic/repository";
import {
  SelfImprovementConflictError,
  type SelfImprovementRepository
} from "@agentic/self-improvement-memory";

export const workerJobKindValues = ["goal_create", "autopilot_process"] as const;

export type GoalJobResultSummary = {
  goalId: string;
  goalStatus: GoalBundle["goal"]["status"];
  taskCount: number;
  completedTaskCount: number;
  pendingApprovalCount: number;
  artifactCount: number;
  watcherCount: number;
  requiresReview: boolean;
};

export type WorkerRuntimeResult = {
  processedCount: number;
  stopReason: "aborted" | "max_jobs";
};

export type WorkerRuntimeOptions = {
  repository: AgenticRepository;
  selfImprovementRepository: SelfImprovementRepository;
  runnerId: string;
  signal?: AbortSignal;
  pollIntervalMs?: number;
  leaseMs?: number;
  retryPolicy?: Partial<JobRetryPolicy>;
  maxJobs?: number;
  claim?: ClaimNextJobParams;
};

function buildGoalCreatePayload(params: {
  request: string;
  workspaceId: string | null;
  agentId: string | null;
}): GoalCreateJobPayload {
  return {
    type: "goal_create",
    goalId: crypto.randomUUID(),
    workflowId: crypto.randomUUID(),
    request: params.request,
    workspaceId: params.workspaceId,
    agentId: params.agentId,
    metadata: {}
  };
}

async function resolveGoalCreateGovernance(
  repository: AgenticRepository,
  userId: string,
  workspaceId: string | null
): Promise<WorkspaceGovernance | null> {
  if (!workspaceId) {
    return null;
  }

  return repository.getWorkspaceGovernance(workspaceId, userId);
}

async function resolveGoalCreateAgentDefinition(
  repository: AgenticRepository,
  userId: string,
  agentId: string | null
) {
  if (!agentId) {
    return undefined;
  }

  try {
    return (await repository.getAgent(agentId, userId)) ?? undefined;
  } catch {
    console.warn(`[goal-jobs] Agent ${agentId} was not found for user ${userId}; proceeding without override.`);
    return undefined;
  }
}

async function persistCapturedMemories(params: {
  repository: AgenticRepository;
  selfImprovementRepository: SelfImprovementRepository;
  userId: string;
  actorContext: ActorContext | null;
  jobId: string;
  bundle: GoalBundle;
}) {
  if (params.bundle.goal.status !== "completed") {
    return;
  }

  try {
    const captured = captureMemoriesFromBundle(
      params.bundle,
      params.userId,
      params.actorContext ?? createSystemActorContext(params.userId)
    );

    await Promise.all(captured.memories.map((memory) => params.repository.saveMemory(memory)));

    for (const episode of captured.episodes) {
      try {
        await params.selfImprovementRepository.appendEpisode(episode);
      } catch (error) {
        if (error instanceof SelfImprovementConflictError) {
          continue;
        }

        throw error;
      }
    }
  } catch (error) {
    console.error(`[goal-jobs] Failed to persist captured memories for job ${params.jobId}:`, error);
    throw error;
  }
}

function notImplementedAutopilotHandler(job: JobRecord): never {
  throw new Error(`Autopilot job handling is not implemented yet for durable job ${job.id}.`);
}

export function isGoalCreateJob(job: JobRecord | null): job is JobRecord & { payload: GoalCreateJobPayload } {
  return job?.kind === "goal_create" && job.payload.type === "goal_create";
}

export async function enqueueGoalCreateJob(params: {
  repository: AgenticRepository;
  userId: string;
  request: string;
  workspaceId: string | null;
  agentId: string | null;
  actorContext: ActorContext | null;
  idempotencyKey?: string | null;
}): Promise<JobRecord & { payload: GoalCreateJobPayload }> {
  const payload = buildGoalCreatePayload({
    request: params.request,
    workspaceId: params.workspaceId,
    agentId: params.agentId
  });

  return params.repository.enqueueJob(createJobRecord({
    userId: params.userId,
    kind: "goal_create",
    payload,
    actorContext: params.actorContext,
    idempotencyKey: params.idempotencyKey ?? null,
    maxAttempts: 3
  })) as Promise<JobRecord & { payload: GoalCreateJobPayload }>;
}

export async function executeGoalCreateJob(params: {
  repository: AgenticRepository;
  selfImprovementRepository: SelfImprovementRepository;
  job: JobRecord;
}) {
  const { job, repository } = params;

  if (!isGoalCreateJob(job)) {
    throw new Error(`Expected a goal_create payload for job ${job.id}.`);
  }

  const governance = await resolveGoalCreateGovernance(repository, job.userId, job.payload.workspaceId);
  const [memories, integrations, agentDefinition] = await Promise.all([
    repository.listMemory(job.userId),
    repository.listIntegrations(job.userId),
    resolveGoalCreateAgentDefinition(repository, job.userId, job.payload.agentId)
  ]);
  const bundle = await processUserRequest({
    userId: job.userId,
    request: job.payload.request,
    workspaceId: job.payload.workspaceId,
    governance,
    memories,
    integrations,
    agentDefinition,
    goalId: job.payload.goalId,
    workflowId: job.payload.workflowId,
    resolveAgentMetrics: (agentIdOrName) => repository.getAgentMetrics(agentIdOrName, "all", job.userId)
  });

  await repository.saveGoalBundle(bundle);
  await persistCapturedMemories({
    repository,
    selfImprovementRepository: params.selfImprovementRepository,
    userId: job.userId,
    actorContext: job.actorContext,
    jobId: job.id,
    bundle
  });
}

export function createWorkerJobHandlers(params: {
  repository: AgenticRepository;
  selfImprovementRepository: SelfImprovementRepository;
}): JobHandlerMap {
  return {
    goal_create: (job) =>
      executeGoalCreateJob({
        repository: params.repository,
        selfImprovementRepository: params.selfImprovementRepository,
        job
      }),
    autopilot_process: async (job) => {
      notImplementedAutopilotHandler(job);
    }
  };
}

export function buildGoalJobResultSummary(bundle: GoalBundle): GoalJobResultSummary {
  const completedTaskCount = bundle.tasks.filter((task) => task.state === "completed").length;
  const pendingApprovalCount = bundle.approvals.filter((approval) => approval.decision === "pending").length;
  const requiresReview =
    pendingApprovalCount > 0 ||
    bundle.tasks.some((task) => task.state === "blocked" || task.state === "failed");

  return {
    goalId: bundle.goal.id,
    goalStatus: bundle.goal.status,
    taskCount: bundle.tasks.length,
    completedTaskCount,
    pendingApprovalCount,
    artifactCount: bundle.artifacts.length,
    watcherCount: bundle.watchers.length,
    requiresReview
  };
}

function shouldClaimJob(jobKind: JobKind, filters: readonly JobKind[] | undefined): boolean {
  return !filters || filters.length === 0 || filters.includes(jobKind);
}

function delay(ms: number, signal?: AbortSignal): Promise<void> {
  if (ms <= 0) {
    return Promise.resolve();
  }

  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", abort);
      resolve();
    }, ms);

    function abort() {
      clearTimeout(timer);
      signal?.removeEventListener("abort", abort);
      resolve();
    }

    signal?.addEventListener("abort", abort, { once: true });
  });
}

export async function runWorkerRuntime(options: WorkerRuntimeOptions): Promise<WorkerRuntimeResult> {
  const queue = createDurableJobQueue(options.repository, {
    runnerId: options.runnerId,
    leaseMs: options.leaseMs,
    retryPolicy: options.retryPolicy
  });
  const handlers = createWorkerJobHandlers({
    repository: options.repository,
    selfImprovementRepository: options.selfImprovementRepository
  });
  const pollIntervalMs = Math.max(50, options.pollIntervalMs ?? 1_000);
  let processedCount = 0;

  while (!options.signal?.aborted) {
    const result = await processNextDurableJob({
      queue,
      handlers,
      claim: options.claim
    });

    if (result.claimedJob) {
      if (!shouldClaimJob(result.claimedJob.kind, options.claim?.kinds)) {
        throw new Error(`Worker claimed unexpected job kind "${result.claimedJob.kind}".`);
      }

      processedCount += 1;

      if (options.maxJobs && processedCount >= options.maxJobs) {
        return {
          processedCount,
          stopReason: "max_jobs"
        };
      }

      continue;
    }

    await delay(pollIntervalMs, options.signal);
  }

  return {
    processedCount,
    stopReason: "aborted"
  };
}
