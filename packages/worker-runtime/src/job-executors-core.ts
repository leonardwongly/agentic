import { runDocsBuild } from "@agentic/docs-runtime";
import {
  GoalTemplateSchema,
  RecommendationRefinementSourceSchema,
  createSystemActorContext,
  nowIso,
  type ActorContext,
  type BriefingCreateJobPayload,
  type Capability,
  type DocsRenderJobPayload,
  type GoalBundle,
  type GoalCreateJobPayload,
  type GoalRefineJobPayload,
  type GoalTemplate,
  type JobRecord,
  type TemplateRunJobPayload,
  type WorkspaceGovernance
} from "@agentic/contracts";
import { logError, logWarn } from "@agentic/integrations";
import {
  captureMemoriesFromBundle,
  computeNextRun,
  generateBriefing,
  interpolateTemplate,
  processUserRequest,
  refineGoal
} from "@agentic/orchestrator";
import type { AgenticRepository } from "@agentic/repository";
import {
  assertEpisodeLearningPrivacyPreflight,
  SelfImprovementConflictError,
  buildPolicyLearningValidation,
  type SelfImprovementRepository
} from "@agentic/self-improvement-memory";

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

const REPLAY_VALIDATION_CAPABILITIES = new Set<Capability>(["send", "schedule"]);

type PolicyReplayValidationResolver = NonNullable<Parameters<typeof processUserRequest>[0]["resolvePolicyReplayValidation"]>;

export function isGoalCreateJob(job: JobRecord | null): job is JobRecord & { payload: GoalCreateJobPayload } {
  return job?.kind === "goal_create" && job.payload.type === "goal_create";
}

export function isGoalRefineJob(job: JobRecord | null): job is JobRecord & { payload: GoalRefineJobPayload } {
  return job?.kind === "goal_refine" && job.payload.type === "goal_refine";
}

export function isBriefingCreateJob(
  job: JobRecord | null
): job is JobRecord & { payload: BriefingCreateJobPayload } {
  return job?.kind === "briefing_create" && job.payload.type === "briefing_create";
}

export function isTemplateRunJob(job: JobRecord | null): job is JobRecord & { payload: TemplateRunJobPayload } {
  return job?.kind === "template_run" && job.payload.type === "template_run";
}

export function isDocsRenderJob(job: JobRecord | null): job is JobRecord & { payload: DocsRenderJobPayload } {
  return job?.kind === "docs_render" && job.payload.type === "docs_render";
}

export function createPolicyReplayValidationResolver(
  episodes: Awaited<ReturnType<SelfImprovementRepository["listEpisodes"]>>
): PolicyReplayValidationResolver {
  return async ({ agent, capabilities, riskClass }) => {
    if (!capabilities.some((capability) => REPLAY_VALIDATION_CAPABILITIES.has(capability))) {
      return null;
    }

    return buildPolicyLearningValidation(episodes, {
      kind: "execution_path",
      agent,
      riskClass,
      capabilities
    });
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
    logWarn("goal_job.agent_override_missing", {
      agentId,
      userId
    });
    return undefined;
  }
}

export async function persistCapturedMemories(params: {
  repository: AgenticRepository;
  selfImprovementRepository: SelfImprovementRepository;
  userId: string;
  actorContext: ActorContext | null;
  jobId: string;
  bundle: GoalBundle;
  governance?: WorkspaceGovernance | null;
}) {
  if (params.bundle.goal.status !== "completed") {
    return;
  }

  try {
    const captured = captureMemoriesFromBundle(
      params.bundle,
      params.userId,
      params.actorContext ?? createSystemActorContext(params.userId),
      {
        governance: params.governance ?? null
      }
    );

    await Promise.all(captured.memories.map((memory) => params.repository.saveMemory(memory)));

    for (const episode of captured.episodes) {
      try {
        assertEpisodeLearningPrivacyPreflight(episode, {
          userId: params.userId,
          workspaceId: params.bundle.goal.workspaceId ?? null
        });
        await params.selfImprovementRepository.appendEpisode(episode);
      } catch (error) {
        if (error instanceof SelfImprovementConflictError) {
          continue;
        }

        throw error;
      }
    }
  } catch (error) {
    logError("goal_job.memory_capture_failed", error, {
      jobId: params.jobId,
      userId: params.userId
    });
    throw error;
  }
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
  const [memories, integrations, agentDefinition, episodes] = await Promise.all([
    repository.listMemory(job.userId),
    repository.listIntegrations(job.userId),
    resolveGoalCreateAgentDefinition(repository, job.userId, job.payload.agentId),
    params.selfImprovementRepository.listEpisodes()
  ]);
  const resolvePolicyReplayValidation = createPolicyReplayValidationResolver(episodes);
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
    resolveAgentMetrics: (agentIdOrName) => repository.getAgentMetrics(agentIdOrName, "all", job.userId),
    resolvePolicyReplayValidation
  });

  await repository.saveGoalBundle(bundle);
  await persistCapturedMemories({
    repository,
    selfImprovementRepository: params.selfImprovementRepository,
    userId: job.userId,
    actorContext: job.actorContext,
    jobId: job.id,
    bundle,
    governance
  });
}

export async function executeGoalRefineJob(params: {
  repository: AgenticRepository;
  selfImprovementRepository: SelfImprovementRepository;
  job: JobRecord;
}) {
  const { job, repository } = params;

  if (!isGoalRefineJob(job)) {
    throw new Error(`Expected a goal_refine payload for job ${job.id}.`);
  }

  const bundle = await repository.getGoalBundleForUser(job.payload.goalId, job.userId);

  if (!bundle) {
    throw new Error(`Goal ${job.payload.goalId} was not found.`);
  }

  const [memories, episodes, governance] = await Promise.all([
    repository.listMemory(job.userId),
    params.selfImprovementRepository.listEpisodes(),
    job.payload.workspaceId
      ? repository.getWorkspaceGovernance(job.payload.workspaceId, job.userId)
      : Promise.resolve(null)
  ]);
  const resolvePolicyReplayValidation = createPolicyReplayValidationResolver(episodes);
  const updatedBundle = await refineGoal({
    bundle,
    refinement: job.payload.refinement,
    memories,
    actorContext: job.actorContext,
    sourceRecommendation:
      job.payload.metadata && typeof job.payload.metadata === "object" && "sourceRecommendation" in job.payload.metadata
        ? RecommendationRefinementSourceSchema.parse(job.payload.metadata.sourceRecommendation)
        : null,
    governance,
    resolveAgentMetrics: (agentIdOrName) => repository.getAgentMetrics(agentIdOrName, "all", job.userId),
    resolvePolicyReplayValidation
  });

  await repository.saveGoalBundle(updatedBundle);
}

export async function executeBriefingCreateJob(params: {
  repository: AgenticRepository;
  selfImprovementRepository: SelfImprovementRepository;
  job: JobRecord;
}) {
  const { job, repository } = params;

  if (!isBriefingCreateJob(job)) {
    throw new Error(`Expected a briefing_create payload for job ${job.id}.`);
  }

  const governance = job.payload.workspaceId
    ? await repository.getWorkspaceGovernance(job.payload.workspaceId, job.userId)
    : null;
  const [preferences, memories, integrations, approvals, watchers, episodes] = await Promise.all([
    repository.getBriefingPreferences(job.userId),
    repository.listMemory(job.userId),
    repository.listIntegrations(job.userId),
    repository.listApprovals(job.userId),
    repository.listWatchers({ userId: job.userId }),
    params.selfImprovementRepository.listEpisodes()
  ]);
  const resolvePolicyReplayValidation = createPolicyReplayValidationResolver(episodes);
  const bundle = await generateBriefing({
    type: job.payload.briefingType,
    userId: job.userId,
    workspaceId: job.payload.workspaceId,
    governance,
    preferences,
    memories,
    integrations,
    pendingApprovals: approvals.filter((approval) => approval.decision === "pending"),
    activeWatchers: watchers.filter((watcher) => watcher.status === "active"),
    goalId: job.payload.goalId,
    workflowId: job.payload.workflowId,
    resolveAgentMetrics: (agentIdOrName) => repository.getAgentMetrics(agentIdOrName, "all", job.userId),
    resolvePolicyReplayValidation
  });

  await repository.saveGoalBundle(bundle);
  await persistCapturedMemories({
    repository,
    selfImprovementRepository: params.selfImprovementRepository,
    userId: job.userId,
    actorContext: job.actorContext,
    jobId: job.id,
    bundle,
    governance
  });
}

export async function runTemplateExecution(params: {
  repository: AgenticRepository;
  selfImprovementRepository: SelfImprovementRepository;
  userId: string;
  actorContext: ActorContext | null;
  template: GoalTemplate;
  goalId: string;
  workflowId: string;
  workspaceId: string | null;
  workspaceGovernance: WorkspaceGovernance | null;
  jobId: string;
}) {
  const [memories, integrations, episodes] = await Promise.all([
    params.repository.listMemory(params.userId),
    params.repository.listIntegrations(params.userId),
    params.selfImprovementRepository.listEpisodes()
  ]);
  const resolvePolicyReplayValidation = createPolicyReplayValidationResolver(episodes);
  const bundle = await processUserRequest({
    userId: params.userId,
    workspaceId: params.workspaceId,
    governance: params.workspaceGovernance,
    request: interpolateTemplate(params.template),
    memories,
    integrations,
    goalId: params.goalId,
    workflowId: params.workflowId,
    resolveAgentMetrics: (agentIdOrName) => params.repository.getAgentMetrics(agentIdOrName, "all", params.userId),
    resolvePolicyReplayValidation
  });

  await params.repository.saveGoalBundle(bundle);
  await params.repository.saveTemplate(
    GoalTemplateSchema.parse({
      ...params.template,
      schedule: {
        ...params.template.schedule,
        lastRunAt: nowIso(),
        nextRunAt:
          params.template.schedule.enabled && params.template.schedule.cron
            ? computeNextRun(params.template.schedule.cron, params.template.schedule.timezone)
            : null
      },
      actorContext: params.actorContext,
      updatedAt: nowIso()
    })
  );
  await persistCapturedMemories({
    repository: params.repository,
    selfImprovementRepository: params.selfImprovementRepository,
    userId: params.userId,
    actorContext: params.actorContext,
    jobId: params.jobId,
    bundle,
    governance: params.workspaceGovernance
  });
  return bundle;
}

export async function executeTemplateRunJob(params: {
  repository: AgenticRepository;
  selfImprovementRepository: SelfImprovementRepository;
  job: JobRecord;
}) {
  const { job, repository } = params;

  if (!isTemplateRunJob(job)) {
    throw new Error(`Expected a template_run payload for job ${job.id}.`);
  }

  const templates = await repository.listTemplates(job.userId);
  const template = templates.find((candidate) => candidate.id === job.payload.templateId);

  if (!template) {
    throw new Error(`Template ${job.payload.templateId} was not found.`);
  }

  await runTemplateExecution({
    repository,
    selfImprovementRepository: params.selfImprovementRepository,
    userId: job.userId,
    actorContext: job.actorContext,
    template,
    goalId: job.payload.goalId,
    workflowId: job.payload.workflowId,
    workspaceId: job.payload.workspaceId,
    workspaceGovernance:
      job.payload.workspaceId ? await repository.getWorkspaceGovernance(job.payload.workspaceId, job.userId) : null,
    jobId: job.id
  });
}

export async function executeDocsRenderJob(params: {
  job: JobRecord;
}) {
  const { job } = params;

  if (!isDocsRenderJob(job)) {
    throw new Error(`Expected a docs_render payload for job ${job.id}.`);
  }

  await runDocsBuild();
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
