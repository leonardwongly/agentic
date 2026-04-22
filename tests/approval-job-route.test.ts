import { mkdtemp } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  SYSTEM_USER_ID,
  WorkspaceMemberSchema,
  WorkspaceSchema,
  createSystemActorContext,
  nowIso
} from "@agentic/contracts";
import { processUserRequest } from "@agentic/orchestrator";
import { createRepository } from "@agentic/repository";
import { createSelfImprovementRepository } from "@agentic/self-improvement-memory";
import {
  enqueueApprovalNotificationJob,
  enqueueAutopilotProcessJob,
  runWorkerRuntime
} from "@agentic/worker-runtime";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GET as approvalJobRoute } from "../apps/web/app/api/approvals/jobs/[id]/route";
import { GET as genericJobRoute } from "../apps/web/app/api/jobs/[id]/route";
import { POST as approvalResponseRoute } from "../apps/web/app/api/approvals/[id]/respond/route";
import { POST as replayJobRoute } from "../apps/web/app/api/jobs/[id]/replay/route";
import * as authModule from "../apps/web/lib/auth";
import {
  resetAuthSessionStateStoreForTesting
} from "../apps/web/lib/auth-session-store";
import {
  buildAuthorizedGetRequest,
  buildAuthorizedJsonRequest,
  expectNoStoreHeaders
} from "./route-test-helpers";

describe("approval job route", () => {
  const originalAccessKey = process.env.AGENTIC_ACCESS_KEY;
  const originalRuntimeStorePath = process.env.AGENTIC_RUNTIME_STORE_PATH;

  async function buildRepository() {
    const repository = createRepository({
      storePath: process.env.AGENTIC_RUNTIME_STORE_PATH
    });

    await repository.seedDefaults(SYSTEM_USER_ID);
    return repository;
  }

  async function createApprovalBundle(repository: ReturnType<typeof createRepository>) {
    const bundle = await processUserRequest({
      userId: SYSTEM_USER_ID,
      request: "Review my inbox and draft responses.",
      memories: await repository.listMemory(SYSTEM_USER_ID),
      integrations: await repository.listIntegrations(SYSTEM_USER_ID)
    });

    await repository.saveGoalBundle(bundle);
    expect(bundle.approvals[0]).toBeDefined();
    return bundle;
  }

  async function createSharedWorkspace(
    repository: ReturnType<typeof createRepository>,
    ownerUserId: string,
    memberUserId: string
  ) {
    const timestamp = "2026-04-22T00:00:00.000Z";
    const ownerActor = createSystemActorContext(ownerUserId);
    const workspaceId = "workspace-shared-job-replay";

    await repository.saveWorkspace(
      WorkspaceSchema.parse({
        id: workspaceId,
        ownerUserId,
        slug: "shared-job-replay",
        name: "Shared Job Replay Workspace",
        description: "Shared workspace for dead-letter replay permission tests.",
        isPersonal: false,
        createdAt: timestamp,
        updatedAt: timestamp
      }),
      ownerActor
    );
    await repository.saveWorkspaceMember(
      WorkspaceMemberSchema.parse({
        id: "workspace-shared-job-replay-owner",
        workspaceId,
        userId: ownerUserId,
        role: "owner",
        joinedAt: timestamp,
        updatedAt: timestamp
      }),
      ownerActor
    );

    return {
      workspaceId,
      addMember: async (role: "editor" | "viewer") =>
        repository.saveWorkspaceMember(
          WorkspaceMemberSchema.parse({
            id: `workspace-shared-job-replay-${memberUserId}-${role}`,
            workspaceId,
            userId: memberUserId,
            role,
            joinedAt: timestamp,
            updatedAt: timestamp
          }),
          ownerActor
        )
    };
  }

  async function createAutopilotReplayFixture(repository: ReturnType<typeof createRepository>) {
    const event = await repository.saveAutopilotEvent({
      id: "autopilot-event-replay-test",
      userId: SYSTEM_USER_ID,
      kind: "watcher_triggered",
      sourceId: "watcher-autopilot-replay-test",
      idempotencyKey: "autopilot-replay-test",
      mode: "draft_goal",
      summary: "Replay the failed autopilot watcher event.",
      status: "failed",
      details: {
        failureStage: "execution",
        requiresReview: true,
        recoveryAction: "review_event_error"
      },
      actorContext: createSystemActorContext(SYSTEM_USER_ID),
      createdAt: nowIso(),
      processedAt: nowIso(),
      resultGoalId: null,
      error: "Autopilot execution failed."
    });

    const job = await enqueueAutopilotProcessJob({
      repository,
      autopilotEvent: event
    });

    return { event, job };
  }

  async function processQueuedApprovalJobs(maxJobs = 1) {
    const repository = createRepository({
      storePath: process.env.AGENTIC_RUNTIME_STORE_PATH
    });
    const selfImprovementRepository = createSelfImprovementRepository({
      baseDir: await mkdtemp(path.join(os.tmpdir(), "agentic-approval-job-route-memory-"))
    });

    await Promise.all([
      repository.seedDefaults(SYSTEM_USER_ID),
      selfImprovementRepository.seed()
    ]);

    return runWorkerRuntime({
      repository,
      selfImprovementRepository,
      runnerId: "worker-approval-job-route-test",
      maxJobs,
      pollIntervalMs: 50
    });
  }

  beforeEach(async () => {
    process.env.AGENTIC_ACCESS_KEY = "test-access-key";
    process.env.AGENTIC_RUNTIME_STORE_PATH = path.join(
      await mkdtemp(path.join(os.tmpdir(), "agentic-approval-job-route-")),
      "runtime-store.json"
    );
    Reflect.set(globalThis, "__agenticRepository", undefined);
    Reflect.set(globalThis, "__agenticSelfImprovementRepository", undefined);
  });

  afterEach(() => {
    process.env.AGENTIC_ACCESS_KEY = originalAccessKey;
    process.env.AGENTIC_RUNTIME_STORE_PATH = originalRuntimeStorePath;
    Reflect.set(globalThis, "__agenticRepository", undefined);
    Reflect.set(globalThis, "__agenticSelfImprovementRepository", undefined);
    resetAuthSessionStateStoreForTesting();
  });

  it("queues approval follow-up, exposes a pollable status route, and completes through the worker runtime", async () => {
    const repository = await buildRepository();
    const bundle = await createApprovalBundle(repository);
    const approval = bundle.approvals[0]!;

    Reflect.set(globalThis, "__agenticRepository", undefined);

    const response = await approvalResponseRoute(
      buildAuthorizedJsonRequest(`http://localhost/api/approvals/${approval.id}/respond`, {
        decision: "rejected",
        scope: "once",
        rationale: "This path requires manual review before any external action."
      }),
      {
        params: Promise.resolve({ id: approval.id })
      }
    );
    const payload = (await response.json()) as {
      job: {
        id: string;
        kind: string;
        status: string;
        goalId: string;
        approvalId: string;
        taskId: string;
        decision: string;
      };
      statusUrl: string;
    };

    expect(response.status).toBe(202);
    expect(payload.job.kind).toBe("approval_follow_up");
    expect(payload.job.status).toBe("queued");
    expect(payload.job.goalId).toBe(bundle.goal.id);
    expect(payload.job.approvalId).toBe(approval.id);
    expect(payload.job.taskId).toBe(approval.taskId);
    expect(payload.job.decision).toBe("rejected");
    expect(payload.statusUrl).toBe(`/api/approvals/jobs/${payload.job.id}`);
    expectNoStoreHeaders(response);

    const queuedStatusResponse = await approvalJobRoute(
      buildAuthorizedGetRequest(`http://localhost${payload.statusUrl}`),
      {
        params: Promise.resolve({ id: payload.job.id })
      }
    );
    const queuedStatusPayload = (await queuedStatusResponse.json()) as {
      job: { id: string; status: string; goalId: string; approvalId: string };
      result: null;
      error: null;
    };

    expect(queuedStatusResponse.status).toBe(202);
    expect(queuedStatusPayload.job.id).toBe(payload.job.id);
    expect(queuedStatusPayload.job.status).toBe("queued");
    expect(queuedStatusPayload.job.goalId).toBe(bundle.goal.id);
    expect(queuedStatusPayload.job.approvalId).toBe(approval.id);
    expect(queuedStatusPayload.result).toBeNull();
    expect(queuedStatusPayload.error).toBeNull();
    expectNoStoreHeaders(queuedStatusResponse);

    const workerResult = await processQueuedApprovalJobs();
    const completedStatusResponse = await approvalJobRoute(
      buildAuthorizedGetRequest(`http://localhost${payload.statusUrl}`),
      {
        params: Promise.resolve({ id: payload.job.id })
      }
    );
    const completedStatusPayload = (await completedStatusResponse.json()) as {
      job: { id: string; status: string; goalId: string; approvalId: string };
      result: {
        goalId: string;
        taskCount: number;
        pendingApprovalCount: number;
      };
      error: null;
    };

    expect(workerResult).toEqual({
      processedCount: 1,
      stopReason: "max_jobs"
    });
    expect(completedStatusResponse.status).toBe(200);
    expect(completedStatusPayload.job.id).toBe(payload.job.id);
    expect(completedStatusPayload.job.status).toBe("completed");
    expect(completedStatusPayload.job.goalId).toBe(bundle.goal.id);
    expect(completedStatusPayload.job.approvalId).toBe(approval.id);
    expect(completedStatusPayload.result.goalId).toBe(bundle.goal.id);
    expect(completedStatusPayload.result.taskCount).toBeGreaterThan(0);
    expect(completedStatusPayload.result.pendingApprovalCount).toBe(0);
    expect(completedStatusPayload.error).toBeNull();
    expectNoStoreHeaders(completedStatusResponse);
  });

  it("rejects replay requests for approval jobs that are not dead-lettered", async () => {
    const repository = await buildRepository();
    const bundle = await createApprovalBundle(repository);
    const approval = bundle.approvals[0]!;

    Reflect.set(globalThis, "__agenticRepository", undefined);

    const response = await approvalResponseRoute(
      buildAuthorizedJsonRequest(`http://localhost/api/approvals/${approval.id}/respond`, {
        decision: "rejected",
        scope: "once",
        rationale: "This needs manual review before retry."
      }),
      {
        params: Promise.resolve({ id: approval.id })
      }
    );
    const payload = (await response.json()) as {
      job: { id: string };
      statusUrl: string;
    };

    expect(response.status).toBe(202);

    const replayResponse = await replayJobRoute(
      buildAuthorizedJsonRequest(`http://localhost/api/jobs/${payload.job.id}/replay`, {}),
      {
        params: Promise.resolve({ id: payload.job.id })
      }
    );
    const replayPayload = (await replayResponse.json()) as { error?: string };

    expect(replayResponse.status).toBe(409);
    expect(replayPayload.error).toContain("not dead-lettered");
    expectNoStoreHeaders(replayResponse);
  });

  it("requeues dead-lettered approval follow-up jobs with replay metadata", async () => {
    const repository = await buildRepository();
    const bundle = await createApprovalBundle(repository);
    const approval = bundle.approvals[0]!;

    Reflect.set(globalThis, "__agenticRepository", undefined);

    const response = await approvalResponseRoute(
      buildAuthorizedJsonRequest(`http://localhost/api/approvals/${approval.id}/respond`, {
        decision: "rejected",
        scope: "once",
        rationale: "Manual review remains required."
      }),
      {
        params: Promise.resolve({ id: approval.id })
      }
    );
    const payload = (await response.json()) as {
      job: { id: string };
      statusUrl: string;
    };

    expect(response.status).toBe(202);

    const queuedJob = await repository.getJob(payload.job.id, SYSTEM_USER_ID);
    expect(queuedJob).not.toBeNull();

    const claimedJob = await repository.claimNextJob({
      userId: SYSTEM_USER_ID,
      kinds: ["approval_follow_up"],
      runnerId: "worker-approval-job-replay-test",
      leaseMs: 30_000,
      now: "2099-04-19T00:00:00.000Z"
    });

    expect(claimedJob?.id).toBe(payload.job.id);

    await repository.deadLetterJob({
      jobId: payload.job.id,
      runnerId: "worker-approval-job-replay-test",
      deadLetteredAt: "2026-04-19T00:01:00.000Z",
      error: "approval replay test induced failure"
    });

    const failedStatusResponse = await approvalJobRoute(
      buildAuthorizedGetRequest(`http://localhost${payload.statusUrl}`),
      {
        params: Promise.resolve({ id: payload.job.id })
      }
    );
    const failedStatusPayload = (await failedStatusResponse.json()) as {
      job: {
        id: string;
        status: string;
        journal: {
          lifecycleState: string;
          retryCount: number;
          replayedFromJobId: string | null;
          recovery: {
            strategy: string;
            note: string;
            statusUrl: string | null;
            operatorActionLabel: string | null;
          } | null;
          entries: Array<{
            state: string;
            attempt: number;
            error: string | null;
          }>;
        };
      };
      result: null;
      error: string;
    };

    expect(failedStatusResponse.status).toBe(200);
    expect(failedStatusPayload.job.id).toBe(payload.job.id);
    expect(failedStatusPayload.job.status).toBe("dead_letter");
    expect(failedStatusPayload.job.journal).toMatchObject({
      lifecycleState: "dead_letter",
      retryCount: 1,
      replayedFromJobId: null,
      recovery: {
        strategy: "replay_job",
        note: "Replay the approval follow-up job to recover the queued side effect without manual state edits.",
        statusUrl: payload.statusUrl,
        operatorActionLabel: "Replay job"
      }
    });
    expect(failedStatusPayload.job.journal.entries.at(-1)).toMatchObject({
      state: "dead_letter",
      attempt: 1,
      error: "approval replay test induced failure"
    });
    expect(failedStatusPayload.result).toBeNull();
    expect(failedStatusPayload.error).toBe("Approval follow-up failed. Replay the job or inspect worker logs.");
    expectNoStoreHeaders(failedStatusResponse);

    const replayResponse = await replayJobRoute(
      buildAuthorizedJsonRequest(`http://localhost/api/jobs/${payload.job.id}/replay`, {}),
      {
        params: Promise.resolve({ id: payload.job.id })
      }
    );
    const replayPayload = (await replayResponse.json()) as {
      replayedFromJobId: string;
      job: {
        id: string;
        kind: string;
        status: string;
        goalId: string;
        approvalId: string;
        taskId: string;
        decision: string;
      };
      statusUrl: string;
    };
    const replayedJob = await repository.getJob(replayPayload.job.id, SYSTEM_USER_ID);

    expect(replayResponse.status).toBe(202);
    expect(replayPayload.replayedFromJobId).toBe(payload.job.id);
    expect(replayPayload.job.kind).toBe("approval_follow_up");
    expect(replayPayload.job.status).toBe("queued");
    expect(replayPayload.job.goalId).toBe(bundle.goal.id);
    expect(replayPayload.job.approvalId).toBe(approval.id);
    expect(replayPayload.job.taskId).toBe(approval.taskId);
    expect(replayPayload.job.decision).toBe("rejected");
    expect(replayPayload.statusUrl).toBe(`/api/approvals/jobs/${replayPayload.job.id}`);
    expect(replayedJob).toMatchObject({
      id: replayPayload.job.id,
      kind: "approval_follow_up",
      status: "queued",
      journal: {
        lifecycleState: "queued",
        replayedFromJobId: payload.job.id,
        sideEffectTarget: `goal:${bundle.goal.id}:task:${approval.taskId}`,
        recovery: null
      },
      payload: {
        type: "approval_follow_up",
        goalId: bundle.goal.id,
        approvalId: approval.id,
        taskId: approval.taskId,
        decision: "rejected",
        metadata: {
          replayedFromJobId: payload.job.id
        }
      }
    });
    expect(replayedJob?.journal.entries.at(-1)).toMatchObject({
      state: "queued",
      attempt: 0,
      summary: `Replay queued from job ${payload.job.id}.`
    });
    const replayedBundle = await repository.getGoalBundleForUser(bundle.goal.id, SYSTEM_USER_ID);

    expect(replayedBundle?.actionLogs.at(-1)).toMatchObject({
      actor: "system",
      kind: "approval_follow_up.replayed",
      message: `Replayed approval follow-up job ${payload.job.id} after dead-letter recovery.`,
      details: {
        replayedFromJobId: payload.job.id,
        replayedJobId: replayPayload.job.id,
        approvalId: approval.id,
        decision: "rejected",
        statusUrl: `/api/approvals/jobs/${replayPayload.job.id}`,
        recoveryLatencyMs: expect.any(Number)
      }
    });
    expectNoStoreHeaders(replayResponse);
  });

  it("denies approval follow-up job polling and replay for a different authenticated user", async () => {
    const repository = await buildRepository();
    const bundle = await createApprovalBundle(repository);
    const approval = bundle.approvals[0]!;

    Reflect.set(globalThis, "__agenticRepository", undefined);

    const response = await approvalResponseRoute(
      buildAuthorizedJsonRequest(`http://localhost/api/approvals/${approval.id}/respond`, {
        decision: "rejected",
        scope: "once",
        rationale: "Manual review remains required."
      }),
      {
        params: Promise.resolve({ id: approval.id })
      }
    );
    const payload = (await response.json()) as {
      job: { id: string };
      statusUrl: string;
    };

    expect(response.status).toBe(202);

    const claimedJob = await repository.claimNextJob({
      userId: SYSTEM_USER_ID,
      kinds: ["approval_follow_up"],
      runnerId: "worker-approval-job-cross-user-test",
      leaseMs: 30_000,
      now: "2099-04-19T03:00:00.000Z"
    });

    expect(claimedJob?.id).toBe(payload.job.id);

    await repository.deadLetterJob({
      jobId: payload.job.id,
      runnerId: "worker-approval-job-cross-user-test",
      deadLetteredAt: "2026-04-19T03:01:00.000Z",
      error: "cross-user access denial test"
    });

    const requireApiSessionSpy = vi.spyOn(authModule, "requireApiSession").mockResolvedValue({
      authMethod: "session",
      userId: "user-secondary",
      sessionId: "session-secondary",
      expiresAt: "2099-04-19T04:00:00.000Z"
    });

    try {
      const pollResponse = await approvalJobRoute(buildAuthorizedGetRequest(`http://localhost${payload.statusUrl}`), {
        params: Promise.resolve({ id: payload.job.id })
      });
      const pollPayload = (await pollResponse.json()) as { error?: string };

      expect(pollResponse.status).toBe(404);
      expect(pollPayload.error).toContain("was not found");
      expectNoStoreHeaders(pollResponse);

      const replayResponse = await replayJobRoute(
        buildAuthorizedJsonRequest(`http://localhost/api/jobs/${payload.job.id}/replay`, {}),
        {
          params: Promise.resolve({ id: payload.job.id })
        }
      );
      const replayPayload = (await replayResponse.json()) as { error?: string };

      expect(replayResponse.status).toBe(404);
      expect(replayPayload.error).toContain("was not found");
      expectNoStoreHeaders(replayResponse);
    } finally {
      requireApiSessionSpy.mockRestore();
    }
  });

  it("returns 403 when a viewer tries to replay a dead-lettered shared workspace job", async () => {
    const repository = await buildRepository();
    const viewerUserId = "user-viewer";

    await repository.seedDefaults(viewerUserId);

    const workspace = await createSharedWorkspace(repository, SYSTEM_USER_ID, viewerUserId);
    await workspace.addMember("viewer");
    const bundle = await processUserRequest({
      userId: SYSTEM_USER_ID,
      workspaceId: workspace.workspaceId,
      request: "Review my inbox and draft responses.",
      memories: await repository.listMemory(SYSTEM_USER_ID),
      integrations: await repository.listIntegrations(SYSTEM_USER_ID)
    });
    await repository.saveGoalBundle(bundle);
    const approval = bundle.approvals[0]!;

    const queuedJob = await enqueueApprovalNotificationJob({
      repository,
      userId: SYSTEM_USER_ID,
      approvalId: approval.id,
      goalId: bundle.goal.id,
      taskId: approval.taskId,
      decision: "approved",
      channel: "slack_receipt",
      slackChannelId: "C123",
      slackMessageTs: "1710000000.000100",
      workspaceId: bundle.goal.workspaceId,
      actorContext: createSystemActorContext(SYSTEM_USER_ID)
    });
    const claimedJob = await repository.claimNextJob({
      userId: SYSTEM_USER_ID,
      kinds: ["approval_notification"],
      runnerId: "worker-shared-job-replay-viewer-test",
      leaseMs: 30_000,
      now: "2099-04-22T06:00:00.000Z"
    });

    expect(claimedJob?.id).toBe(queuedJob.id);

    await repository.deadLetterJob({
      jobId: queuedJob.id,
      runnerId: "worker-shared-job-replay-viewer-test",
      deadLetteredAt: "2026-04-22T06:01:00.000Z",
      error: "shared workspace replay viewer denial test"
    });

    Reflect.set(globalThis, "__agenticRepository", undefined);

    const requireApiSessionSpy = vi.spyOn(authModule, "requireApiSession").mockResolvedValue({
      authMethod: "session",
      userId: viewerUserId,
      sessionId: "session-viewer",
      expiresAt: "2099-04-22T07:00:00.000Z"
    });

    try {
      const replayResponse = await replayJobRoute(
        buildAuthorizedJsonRequest(`http://localhost/api/jobs/${queuedJob.id}/replay`, {}),
        {
          params: Promise.resolve({ id: queuedJob.id })
        }
      );
      const replayPayload = (await replayResponse.json()) as { error?: string };
      const persistedJob = await repository.getJob(queuedJob.id, SYSTEM_USER_ID);

      expect(replayResponse.status).toBe(403);
      expect(replayPayload.error).toBe(
        "Viewers can inspect shared runtime issues, but only workspace owners and editors can replay dead-letter jobs."
      );
      expect(persistedJob?.status).toBe("dead_letter");
      expectNoStoreHeaders(replayResponse);
    } finally {
      requireApiSessionSpy.mockRestore();
    }
  });

  it("polls and replays dead-lettered approval notification jobs through the generic jobs route", async () => {
    const repository = await buildRepository();
    const bundle = await createApprovalBundle(repository);
    const approval = bundle.approvals[0]!;

    const queuedJob = await enqueueApprovalNotificationJob({
      repository,
      userId: SYSTEM_USER_ID,
      approvalId: approval.id,
      goalId: bundle.goal.id,
      taskId: approval.taskId,
      decision: "approved",
      channel: "slack_receipt",
      slackChannelId: "C123",
      slackMessageTs: "1710000000.000100",
      workspaceId: bundle.goal.workspaceId,
      actorContext: createSystemActorContext(SYSTEM_USER_ID)
    });

    const queuedStatusResponse = await genericJobRoute(
      buildAuthorizedGetRequest(`http://localhost/api/jobs/${queuedJob.id}`),
      {
        params: Promise.resolve({ id: queuedJob.id })
      }
    );
    const queuedStatusPayload = (await queuedStatusResponse.json()) as {
      job: {
        id: string;
        kind: string;
        status: string;
        approvalId: string;
        taskId: string;
        decision: string;
        channel: string;
        journal: {
          lifecycleState: string;
          sideEffectTarget: string | null;
          replayedFromJobId: string | null;
        };
      };
      result: {
        goalId: string;
      };
      error: null;
    };

    expect(queuedStatusResponse.status).toBe(202);
    expect(queuedStatusPayload.job).toMatchObject({
      id: queuedJob.id,
      kind: "approval_notification",
      status: "queued",
      approvalId: approval.id,
      taskId: approval.taskId,
      decision: "approved",
      channel: "slack_receipt",
      journal: {
        lifecycleState: "queued",
        sideEffectTarget: `approval-notification:${approval.id}:slack_receipt:C123:1710000000.000100`,
        replayedFromJobId: null
      }
    });
    expect(queuedStatusPayload.result.goalId).toBe(bundle.goal.id);
    expect(queuedStatusPayload.error).toBeNull();
    expectNoStoreHeaders(queuedStatusResponse);

    const claimedJob = await repository.claimNextJob({
      userId: SYSTEM_USER_ID,
      kinds: ["approval_notification"],
      runnerId: "worker-approval-notification-job-replay-test",
      leaseMs: 30_000,
      now: "2099-04-19T06:00:00.000Z"
    });

    expect(claimedJob?.id).toBe(queuedJob.id);

    await repository.deadLetterJob({
      jobId: queuedJob.id,
      runnerId: "worker-approval-notification-job-replay-test",
      deadLetteredAt: "2026-04-19T06:01:00.000Z",
      error: "approval notification replay test induced failure"
    });

    const failedStatusResponse = await genericJobRoute(
      buildAuthorizedGetRequest(`http://localhost/api/jobs/${queuedJob.id}`),
      {
        params: Promise.resolve({ id: queuedJob.id })
      }
    );
    const failedStatusPayload = (await failedStatusResponse.json()) as {
      job: {
        id: string;
        status: string;
        journal: {
          lifecycleState: string;
          retryCount: number;
          recovery: {
            strategy: string;
            note: string;
            statusUrl: string | null;
            operatorActionLabel: string | null;
          } | null;
        };
      };
      error: string;
    };

    expect(failedStatusResponse.status).toBe(200);
    expect(failedStatusPayload.job).toMatchObject({
      id: queuedJob.id,
      status: "dead_letter",
      journal: {
        lifecycleState: "dead_letter",
        retryCount: 1,
        recovery: {
          strategy: "replay_job",
          note: "Replay the approval notification job to retry connector delivery without repeating the governed task side effect.",
          statusUrl: `/api/jobs/${queuedJob.id}`,
          operatorActionLabel: "Replay notification"
        }
      }
    });
    expect(failedStatusPayload.error).toBe("Approval notification failed. Replay the job or inspect worker logs.");
    expectNoStoreHeaders(failedStatusResponse);

    const replayResponse = await replayJobRoute(
      buildAuthorizedJsonRequest(`http://localhost/api/jobs/${queuedJob.id}/replay`, {}),
      {
        params: Promise.resolve({ id: queuedJob.id })
      }
    );
    const replayPayload = (await replayResponse.json()) as {
      replayedFromJobId: string;
      job: {
        id: string;
        kind: string;
        status: string;
        goalId: string;
        approvalId: string;
        taskId: string;
        decision: string;
        channel: string;
      };
      statusUrl: string;
    };
    const replayedJob = await repository.getJob(replayPayload.job.id, SYSTEM_USER_ID);
    const replayedBundle = await repository.getGoalBundleForUser(bundle.goal.id, SYSTEM_USER_ID);

    expect(replayResponse.status).toBe(202);
    expect(replayPayload).toMatchObject({
      replayedFromJobId: queuedJob.id,
      job: {
        kind: "approval_notification",
        status: "queued",
        goalId: bundle.goal.id,
        approvalId: approval.id,
        taskId: approval.taskId,
        decision: "approved",
        channel: "slack_receipt"
      },
      statusUrl: `/api/jobs/${replayPayload.job.id}`
    });
    expect(replayedJob).toMatchObject({
      id: replayPayload.job.id,
      kind: "approval_notification",
      status: "queued",
      journal: {
        lifecycleState: "queued",
        replayedFromJobId: queuedJob.id,
        sideEffectTarget: `approval-notification:${approval.id}:slack_receipt:C123:1710000000.000100`,
        recovery: null
      },
      payload: {
        type: "approval_notification",
        goalId: bundle.goal.id,
        approvalId: approval.id,
        taskId: approval.taskId,
        decision: "approved",
        channel: "slack_receipt",
        slackChannelId: "C123",
        slackMessageTs: "1710000000.000100",
        metadata: {
          replayedFromJobId: queuedJob.id
        }
      }
    });
    expect(replayedBundle?.actionLogs.at(-1)).toMatchObject({
      actor: "system",
      kind: "approval_notification.replayed",
      message: `Replayed approval notification job ${queuedJob.id} after dead-letter recovery.`,
      details: {
        replayedFromJobId: queuedJob.id,
        replayedJobId: replayPayload.job.id,
        approvalId: approval.id,
        decision: "approved",
        channel: "slack_receipt",
        statusUrl: `/api/jobs/${replayPayload.job.id}`,
        recoveryLatencyMs: expect.any(Number)
      }
    });
    expectNoStoreHeaders(replayResponse);
  });

  it("requeues dead-lettered autopilot jobs with replay metadata and resets the event for worker pickup", async () => {
    const repository = await buildRepository();
    const { event, job } = await createAutopilotReplayFixture(repository);

    const claimedJob = await repository.claimNextJob({
      userId: SYSTEM_USER_ID,
      kinds: ["autopilot_process"],
      runnerId: "worker-autopilot-job-replay-test",
      leaseMs: 30_000,
      now: "2099-04-19T05:00:00.000Z"
    });

    expect(claimedJob?.id).toBe(job.id);

    await repository.deadLetterJob({
      jobId: job.id,
      runnerId: "worker-autopilot-job-replay-test",
      deadLetteredAt: "2026-04-19T05:01:00.000Z",
      error: "autopilot replay test induced failure"
    });

    const replayResponse = await replayJobRoute(
      buildAuthorizedJsonRequest(`http://localhost/api/jobs/${job.id}/replay`, {}),
      {
        params: Promise.resolve({ id: job.id })
      }
    );
    const replayPayload = (await replayResponse.json()) as {
      replayedFromJobId: string;
      job: {
        id: string;
        kind: string;
        status: string;
        autopilotEventId: string;
        eventKind: string;
        sourceId: string;
        mode: string;
      };
      statusUrl: string;
    };
    const replayedJob = await repository.getJob(replayPayload.job.id, SYSTEM_USER_ID);
    const replayedEvent = (await repository.listAutopilotEvents(SYSTEM_USER_ID)).find(
      (candidate) => candidate.id === event.id
    );

    expect(replayResponse.status).toBe(202);
    expect(replayPayload.replayedFromJobId).toBe(job.id);
    expect(replayPayload.job).toMatchObject({
      kind: "autopilot_process",
      status: "queued",
      autopilotEventId: event.id,
      eventKind: event.kind,
      sourceId: event.sourceId,
      mode: event.mode
    });
    expect(replayPayload.statusUrl).toBe(`/api/jobs/${replayPayload.job.id}`);
    expect(replayedJob).toMatchObject({
      id: replayPayload.job.id,
      kind: "autopilot_process",
      status: "queued",
      journal: {
        lifecycleState: "queued",
        replayedFromJobId: job.id,
        sideEffectTarget: `autopilot-event:${event.id}`,
        recovery: null
      },
      payload: {
        type: "autopilot_process",
        autopilotEventId: event.id,
        kind: event.kind,
        sourceId: event.sourceId,
        mode: event.mode,
        metadata: {
          replayedFromJobId: job.id
        }
      }
    });
    expect(replayedJob?.journal.entries.at(-1)).toMatchObject({
      state: "queued",
      attempt: 0,
      summary: `Replay queued from job ${job.id}.`
    });
    expect(replayedEvent).toMatchObject({
      id: event.id,
      status: "pending",
      processedAt: null,
      resultGoalId: null,
      error: null,
      details: {
        recoveryAction: "replay_job",
        requiresReview: false,
        replayRequestedFromJobId: job.id,
        replayedJobId: replayPayload.job.id,
        jobId: replayPayload.job.id,
        jobStatus: "queued"
      }
    });
    const queuedStatusResponse = await genericJobRoute(
      buildAuthorizedGetRequest(`http://localhost${replayPayload.statusUrl}`),
      {
        params: Promise.resolve({ id: replayPayload.job.id })
      }
    );
    const queuedStatusPayload = (await queuedStatusResponse.json()) as {
      job: {
        id: string;
        status: string;
        autopilotEventId: string;
        journal: {
          lifecycleState: string;
          replayedFromJobId: string | null;
          sideEffectTarget: string | null;
        };
      };
      result: {
        event: {
          id: string;
          status: string;
          resultGoalId: string | null;
        };
        goal: null;
      };
      error: null;
    };

    expect(queuedStatusResponse.status).toBe(202);
    expect(queuedStatusPayload.job).toMatchObject({
      id: replayPayload.job.id,
      status: "queued",
      autopilotEventId: event.id,
      journal: {
        lifecycleState: "queued",
        replayedFromJobId: job.id,
        sideEffectTarget: `autopilot-event:${event.id}`
      }
    });
    expect(queuedStatusPayload.result).toMatchObject({
      event: {
        id: event.id,
        status: "pending",
        resultGoalId: null
      },
      goal: null
    });
    expect(queuedStatusPayload.error).toBeNull();
    expectNoStoreHeaders(queuedStatusResponse);
    expectNoStoreHeaders(replayResponse);
  });
});
