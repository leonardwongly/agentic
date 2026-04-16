import { mkdtemp } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  GoalBundleSchema,
  SYSTEM_USER_ID,
  createSystemActorContext
} from "@agentic/contracts";
import { createJobRecord } from "@agentic/execution";
import * as orchestrator from "@agentic/orchestrator";
import { createRepository } from "@agentic/repository";
import { EpisodeRecordSchema, createSelfImprovementRepository } from "@agentic/self-improvement-memory";
import {
  enqueueGoalCreateJob,
  executeGoalCreateJob,
  runWorkerRuntime
} from "@agentic/worker-runtime";
import { vi } from "vitest";

describe("worker runtime", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  async function createTestRuntime() {
    const tempDir = await mkdtemp(path.join(os.tmpdir(), "agentic-worker-runtime-"));
    const repository = createRepository({
      storePath: path.join(tempDir, "runtime-store.json")
    });
    const selfImprovementRepository = createSelfImprovementRepository({
      baseDir: path.join(tempDir, "self-improvement")
    });

    await Promise.all([
      repository.seedDefaults(SYSTEM_USER_ID),
      selfImprovementRepository.seed()
    ]);

    return {
      repository,
      selfImprovementRepository
    };
  }

  function buildCompletedBundle(goalId: string, workflowId: string) {
    return GoalBundleSchema.parse({
      goal: {
        id: goalId,
        userId: SYSTEM_USER_ID,
        workspaceId: null,
        workflowId,
        title: "Prepare weekly operating plan",
        request: "Prepare a weekly operating plan with approval-safe follow-ups.",
        intent: "weekly-operating-plan",
        status: "completed",
        confidence: 0.91,
        explanation: "Completed by worker runtime test fixture.",
        createdAt: "2026-04-16T00:00:00.000Z",
        updatedAt: "2026-04-16T00:05:00.000Z"
      },
      workflow: {
        id: workflowId,
        goalId,
        workspaceId: null,
        status: "completed",
        currentStep: "done",
        checkpoint: null,
        createdAt: "2026-04-16T00:00:00.000Z",
        updatedAt: "2026-04-16T00:05:00.000Z"
      },
      tasks: [
        {
          id: "task-worker-runtime-completed",
          goalId,
          workflowId,
          title: "Draft weekly operating plan",
          summary: "Create the completed plan artifact.",
          assignedAgent: "workflow",
          state: "completed",
          riskClass: "R1",
          requiresApproval: false,
          dependsOn: [],
          toolCapabilities: ["create"],
          artifactIds: [],
          createdAt: "2026-04-16T00:00:00.000Z",
          updatedAt: "2026-04-16T00:05:00.000Z"
        }
      ],
      artifacts: [],
      approvals: [],
      watchers: [],
      actionLogs: []
    });
  }

  it("processes queued goal jobs through the worker loop and persists completion state", async () => {
    const { repository, selfImprovementRepository } = await createTestRuntime();
    const memoryCountBefore = (await repository.listMemory(SYSTEM_USER_ID)).length;
    const episodeCountBefore = (await selfImprovementRepository.listEpisodes()).length;
    const queued = await enqueueGoalCreateJob({
      repository,
      userId: SYSTEM_USER_ID,
      request: "Prepare a weekly operating plan with approval-safe follow-ups.",
      workspaceId: null,
      agentId: null,
      actorContext: createSystemActorContext(SYSTEM_USER_ID),
      idempotencyKey: "worker-runtime-goal-1"
    });

    const result = await runWorkerRuntime({
      repository,
      selfImprovementRepository,
      runnerId: "worker-runtime-test",
      maxJobs: 1,
      pollIntervalMs: 50
    });
    const persistedJob = await repository.getJob(queued.id, SYSTEM_USER_ID);
    const persistedBundle = await repository.getGoalBundleForUser(queued.payload.goalId, SYSTEM_USER_ID);
    const memories = await repository.listMemory(SYSTEM_USER_ID);
    const episodes = await selfImprovementRepository.listEpisodes();

    expect(result).toEqual({
      processedCount: 1,
      stopReason: "max_jobs"
    });
    expect(persistedJob).toMatchObject({
      id: queued.id,
      status: "completed",
      attemptCount: 1
    });
    expect(persistedBundle?.goal.id).toBe(queued.payload.goalId);
    expect(persistedBundle?.goal.status).not.toBe("completed");
    expect(memories).toHaveLength(memoryCountBefore);
    expect(episodes).toHaveLength(episodeCountBefore);
  });

  it("keeps goal persistence, memory capture, and self-improvement episodes idempotent across retries", async () => {
    const { repository, selfImprovementRepository } = await createTestRuntime();
    const job = createJobRecord({
      userId: SYSTEM_USER_ID,
      kind: "goal_create",
      actorContext: createSystemActorContext(SYSTEM_USER_ID),
      payload: {
        type: "goal_create",
        goalId: "goal-idempotent-retry",
        workflowId: "workflow-idempotent-retry",
        request: "Create an idempotent weekly planning workflow with safe retries.",
        workspaceId: null,
        agentId: null,
        metadata: {}
      }
    });

    await executeGoalCreateJob({
      repository,
      selfImprovementRepository,
      job
    });

    const goalsAfterFirstAttempt = await repository.listGoals(SYSTEM_USER_ID);
    const memoriesAfterFirstAttempt = await repository.listMemory(SYSTEM_USER_ID);
    const episodesAfterFirstAttempt = await selfImprovementRepository.listEpisodes();

    await executeGoalCreateJob({
      repository,
      selfImprovementRepository,
      job
    });

    const goalsAfterSecondAttempt = await repository.listGoals(SYSTEM_USER_ID);
    const memoriesAfterSecondAttempt = await repository.listMemory(SYSTEM_USER_ID);
    const episodesAfterSecondAttempt = await selfImprovementRepository.listEpisodes();

    expect(goalsAfterFirstAttempt).toHaveLength(1);
    expect(goalsAfterSecondAttempt).toHaveLength(1);
    expect(goalsAfterSecondAttempt[0]?.goal.id).toBe(job.payload.goalId);
    expect(memoriesAfterSecondAttempt.map((memory) => memory.id)).toEqual(
      memoriesAfterFirstAttempt.map((memory) => memory.id)
    );
    expect(episodesAfterSecondAttempt.map((episode) => episode.id)).toEqual(
      episodesAfterFirstAttempt.map((episode) => episode.id)
    );
  });

  it("dead-letters the job when worker-owned side effects fail after bundle persistence", async () => {
    const { repository, selfImprovementRepository } = await createTestRuntime();
    const appendEpisodeFailure = new Error("episode store unavailable");
    selfImprovementRepository.appendEpisode = async () => {
      throw appendEpisodeFailure;
    };

    const job = createJobRecord({
      userId: SYSTEM_USER_ID,
      kind: "goal_create",
      actorContext: createSystemActorContext(SYSTEM_USER_ID),
      maxAttempts: 1,
      payload: {
        type: "goal_create",
        goalId: "goal-side-effect-failure",
        workflowId: "workflow-side-effect-failure",
        request: "Persist the plan and capture worker-owned side effects.",
        workspaceId: null,
        agentId: null,
        metadata: {}
      }
    });

    vi.spyOn(orchestrator, "processUserRequest").mockResolvedValue(
      buildCompletedBundle(job.payload.goalId, job.payload.workflowId)
    );
    vi.spyOn(orchestrator, "captureMemoriesFromBundle").mockReturnValue({
      memories: [],
      episodes: [
        EpisodeRecordSchema.parse({
          id: "episode-worker-runtime-side-effect",
          timestamp: "2026-04-16T00:05:00.000Z",
          skill: "workflow",
          task: "Draft weekly operating plan",
          outcome: "success",
          situation: "Worker completed the async goal-create path.",
          rootCause: null,
          solution: "Persisted the bundle before recording self-improvement output.",
          lesson: "Worker-owned side effects must fail visibly when storage is unavailable.",
          relatedPatternId: null,
          userFeedback: null,
          metadata: {
            goalId: job.payload.goalId,
            taskId: "task-worker-runtime-completed"
          }
        })
      ]
    });

    await repository.enqueueJob(job);

    const result = await runWorkerRuntime({
      repository,
      selfImprovementRepository,
      runnerId: "worker-runtime-side-effect-test",
      maxJobs: 1,
      pollIntervalMs: 10
    });

    const persistedJob = await repository.getJob(job.id, SYSTEM_USER_ID);
    const persistedBundle = await repository.getGoalBundleForUser(job.payload.goalId, SYSTEM_USER_ID);
    const episodes = await selfImprovementRepository.listEpisodes();

    expect(result).toEqual({
      processedCount: 1,
      stopReason: "max_jobs"
    });
    expect(persistedBundle?.goal.id).toBe(job.payload.goalId);
    expect(persistedJob).toMatchObject({
      id: job.id,
      status: "dead_letter",
      attemptCount: 1
    });
    expect(persistedJob?.lastError).toContain("episode store unavailable");
    expect(episodes).toHaveLength(0);
  });
});
