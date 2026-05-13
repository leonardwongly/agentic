import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, readdir, rmdir, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { Client } from "pg";
import {
  AgentDefinitionSchema,
  AutopilotEventSchema,
  DEFAULT_AUTOPILOT_RELIABILITY_CONTROLS,
  ProviderCredentialSchema,
  GoalTemplateSchema,
  IntegrationAccountSchema,
  SYSTEM_USER_ID,
  WatcherSchema,
  WorkspaceGovernanceSchema,
  WorkspaceMemberSchema,
  WorkspaceSchema,
  WorkspaceSelectionSchema,
  briefingTypeValues,
  createHumanActorContext,
  createSystemActorContext,
  nowIso
} from "@agentic/contracts";
import { buildDefaultIntegrationAccounts, createProviderCredentialSecretStore } from "@agentic/integrations";
import { createRepository } from "@agentic/repository";
import { createDurableJobQueue, createJobRecord } from "@agentic/execution";
import { generateBriefing, processUserRequest } from "@agentic/orchestrator";
import { createMemoryRecord } from "@agentic/memory";

describe("repository", () => {
  const systemActor = createSystemActorContext(SYSTEM_USER_ID);

  function buildProviderCredential(params: {
    userId: string;
    workspaceId?: string | null;
    accountId?: string;
    accountEmail?: string;
    status?: "connected" | "reconnect_required" | "refresh_failed" | "revoked";
    lastValidatedAt?: string | null;
    lastRefreshFailureAt?: string | null;
    reconnectRequiredAt?: string | null;
    revokedAt?: string | null;
    expiresAt?: string | null;
  }) {
    const workspaceSegment = params.workspaceId ?? "global";

    return ProviderCredentialSchema.parse({
      id: `google:${workspaceSegment}:${params.accountId ?? "acct-123"}`,
      userId: params.userId,
      workspaceId: params.workspaceId ?? null,
      provider: "google",
      accountId: params.accountId ?? "acct-123",
      accountEmail: params.accountEmail ?? "owner@example.com",
      displayName: "Example Person",
      status: params.status ?? "connected",
      scopes: [
        "https://www.googleapis.com/auth/gmail.modify",
        "https://www.googleapis.com/auth/calendar"
      ],
      lastValidatedAt: params.lastValidatedAt ?? nowIso(),
      lastRefreshFailureAt: params.lastRefreshFailureAt ?? null,
      reconnectRequiredAt: params.reconnectRequiredAt ?? null,
      revokedAt: params.revokedAt ?? null,
      expiresAt: params.expiresAt ?? null,
      metadata: {
        providerAccountId: params.accountId ?? "acct-123"
      },
      actorContext: systemActor,
      createdAt: nowIso(),
      updatedAt: nowIso()
    });
  }

  async function createGoalForUser(
    repository: ReturnType<typeof createRepository>,
    userId: string,
    request: string,
    workspaceId?: string | null
  ) {
    const bundle = await processUserRequest({
      userId,
      request,
      workspaceId,
      memories: await repository.listMemory(userId),
      integrations: await repository.listIntegrations(userId)
    });

    await repository.saveGoalBundle(bundle);
    return bundle;
  }

  async function expectApprovalEvidenceCapture(
    repository: ReturnType<typeof createRepository>,
    decision: "approved" | "rejected"
  ) {
    await repository.seedDefaults(SYSTEM_USER_ID);

    const bundle = await createGoalForUser(repository, SYSTEM_USER_ID, "Review my inbox and send one external reply.");
    const approval = bundle.approvals[0];

    expect(approval).toBeDefined();

    const updatedBundle = await repository.respondToApproval({
      approvalId: approval!.id,
      decision,
      actor: systemActor,
      scope: decision === "approved" ? "similar_24h" : "once",
      rationale:
        decision === "approved"
          ? "This reply pattern is safe for closely similar follow-ups."
          : "This needs manual review before any external message is sent."
    });
    const evidenceRecords = await repository.listEvidenceRecords({
      userId: SYSTEM_USER_ID,
      approvalId: approval!.id
    });
    const invisibleEvidence = await repository.listEvidenceRecords({
      userId: "user-without-access",
      approvalId: approval!.id
    });

    expect(invisibleEvidence).toEqual([]);
    expect(evidenceRecords).toHaveLength(1);

    const evidence = evidenceRecords[0];
    const resultingTask = updatedBundle.tasks.find((task) => task.id === approval!.taskId);
    const appendedLogIds = updatedBundle.actionLogs
      .filter((log) => !bundle.actionLogs.some((existing) => existing.id === log.id))
      .map((log) => log.id);

    expect(resultingTask).toBeDefined();
    expect(evidence).toMatchObject({
      userId: SYSTEM_USER_ID,
      goalId: bundle.goal.id,
      taskId: approval!.taskId,
      approvalId: approval!.id,
      sourceKind: "approval_response",
      sourceId: approval!.id,
      riskClass: approval!.riskClass,
      requestedAction: approval!.requestedAction,
      requestRationale: approval!.rationale,
      requiresApproval: true,
      decision,
      decisionScope: decision === "approved" ? "similar_24h" : "once",
      decisionRationale:
        decision === "approved"
          ? "This reply pattern is safe for closely similar follow-ups."
          : "This needs manual review before any external message is sent.",
      resultingTaskState: resultingTask!.state,
      resultingGoalStatus: updatedBundle.goal.status,
      actionLogIds: appendedLogIds,
      artifactIds: approval!.actionIntent?.artifactIds ?? [],
      memoryIds: [],
      actorContext: systemActor
    });
    expect(evidence.sourceSummary).toContain(approval!.title);
    expect(new Date(evidence.respondedAt).toString()).not.toBe("Invalid Date");
  }

  function createGoalCreateJob(params: {
    userId: string;
    request?: string;
    idempotencyKey?: string | null;
    availableAt?: string;
    maxAttempts?: number;
    goalId?: string;
    workflowId?: string;
    priority?: "critical" | "high" | "normal" | "low" | "maintenance";
    concurrencyKey?: string | null;
    queue?: string;
  }) {
    return createJobRecord({
      userId: params.userId,
      kind: "goal_create",
      idempotencyKey: params.idempotencyKey,
      availableAt: params.availableAt,
      maxAttempts: params.maxAttempts,
      priority: params.priority,
      concurrencyKey: params.concurrencyKey,
      queue: params.queue,
      payload: {
        type: "goal_create",
        goalId: params.goalId ?? crypto.randomUUID(),
        workflowId: params.workflowId ?? crypto.randomUUID(),
        request: params.request ?? "Draft a durable execution plan.",
        workspaceId: null,
        agentId: null,
        metadata: {}
      }
    });
  }

  async function expectDurableQueueLifecycle(repository: ReturnType<typeof createRepository>, userId: string) {
    const queue = createDurableJobQueue(repository, {
      runnerId: `worker-${userId}`,
      leaseMs: 1_000,
      retryPolicy: {
        baseDelayMs: 250,
        maxDelayMs: 250
      }
    });
    const queued = await queue.enqueue(
      createGoalCreateJob({
        userId,
        request: `Queue lifecycle validation for ${userId}.`,
        maxAttempts: 2,
        availableAt: "2026-04-16T03:00:00.000Z"
      })
    );
    const firstClaim = await queue.claimNext({
      userId,
      now: "2026-04-16T03:00:00.000Z"
    });

    expect(firstClaim).not.toBeNull();
    expect(firstClaim?.id).toBe(queued.id);
    expect(firstClaim?.attemptCount).toBe(1);

    const retried = await queue.fail({
      job: firstClaim!,
      error: new Error("temporary upstream failure"),
      now: "2026-04-16T03:00:00.000Z"
    });
    const hiddenUntilRetry = await queue.claimNext({
      userId,
      now: "2026-04-16T03:00:00.200Z"
    });
    const secondClaim = await queue.claimNext({
      userId,
      now: "2026-04-16T03:00:00.250Z"
    });

    expect(retried.status).toBe("retrying");
    expect(retried.availableAt).toBe("2026-04-16T03:00:00.250Z");
    expect(hiddenUntilRetry).toBeNull();
    expect(secondClaim).not.toBeNull();
    expect(secondClaim?.id).toBe(queued.id);
    expect(secondClaim?.attemptCount).toBe(2);

    const deadLettered = await queue.fail({
      job: secondClaim!,
      error: "permanent upstream failure",
      now: "2026-04-16T03:05:00.000Z"
    });
    const persisted = await repository.getJob(queued.id, userId);

    expect(deadLettered.status).toBe("dead_letter");
    expect(deadLettered.deadLetteredAt).toBe("2026-04-16T03:05:00.000Z");
    expect(deadLettered.lastError).toContain("permanent upstream failure");
    expect(persisted).not.toBeNull();
    expect(persisted).toMatchObject({
      id: queued.id,
      status: "dead_letter",
      attemptCount: 2,
      deadLetteredAt: "2026-04-16T03:05:00.000Z"
    });
  }

  async function expectPriorityAndConcurrencyControls(repository: ReturnType<typeof createRepository>, userId: string) {
    const queue = createDurableJobQueue(repository, {
      runnerId: `worker-${userId}`,
      leaseMs: 60_000
    });
    const normal = await repository.enqueueJob(
      createGoalCreateJob({
        userId,
        priority: "normal",
        concurrencyKey: `${userId}:exclusive`,
        availableAt: "2026-04-16T03:00:00.000Z"
      })
    );
    const critical = await repository.enqueueJob(
      createGoalCreateJob({
        userId,
        priority: "critical",
        concurrencyKey: `${userId}:exclusive`,
        availableAt: "2026-04-16T03:00:00.000Z"
      })
    );
    const claimedCritical = await queue.claimNext({
      userId,
      now: "2026-04-16T03:00:00.000Z",
      concurrencyLimits: {
        maxRunningPerConcurrencyKey: 1
      }
    });
    const blockedByConcurrency = await queue.claimNext({
      userId,
      now: "2026-04-16T03:00:01.000Z",
      concurrencyLimits: {
        maxRunningPerConcurrencyKey: 1
      }
    });
    const reclaimedAfterLeaseExpiry = await queue.claimNext({
      userId,
      now: "2026-04-16T03:01:01.000Z",
      concurrencyLimits: {
        maxRunningPerConcurrencyKey: 1
      }
    });

    expect(claimedCritical?.id).toBe(critical.id);
    expect(claimedCritical?.priority).toBe("critical");
    expect(blockedByConcurrency).toBeNull();
    expect(reclaimedAfterLeaseExpiry?.id).toBe(critical.id);
    expect(normal.id).not.toBe(critical.id);
  }

  it("appends goal action logs without rewriting the full bundle", async () => {
    const repository = createRepository({
      storePath: path.join(await mkdtemp(path.join(os.tmpdir(), "agentic-repository-append-logs-")), "runtime-store.json")
    });

    await repository.seedDefaults(SYSTEM_USER_ID);
    const bundle = await createGoalForUser(repository, SYSTEM_USER_ID, "Record public-share audit logs append-only.");
    const firstLog = {
      id: "share-audit-append-1",
      goalId: bundle.goal.id,
      taskId: null,
      workflowId: bundle.workflow.id,
      actor: "public-share",
      kind: "share.access_failed",
      message: "Blocked public share access.",
      details: {
        shareId: "share-append",
        tokenFingerprint: "abc123def456",
        reason: "expired"
      },
      createdAt: "2026-04-30T00:00:00.000Z"
    };
    const secondLog = {
      ...firstLog,
      id: "share-audit-append-2",
      details: {
        shareId: "share-append",
        tokenFingerprint: "abc123def456",
        reason: "revoked"
      },
      createdAt: "2026-04-30T00:00:01.000Z"
    };

    await repository.appendGoalActionLogs(bundle.goal.id, [firstLog]);
    await repository.appendGoalActionLogs(bundle.goal.id, [secondLog, firstLog]);

    const reloaded = await repository.getGoalBundle(bundle.goal.id);
    const appendedLogs = reloaded?.actionLogs.filter((log) => log.id.startsWith("share-audit-append-")) ?? [];

    expect(appendedLogs.map((log) => log.id)).toEqual(["share-audit-append-1", "share-audit-append-2"]);
    expect(appendedLogs[0]?.message).toBe("Blocked public share access.");

    await repository.appendGoalActionLogs(bundle.goal.id, [
      {
        ...firstLog,
        message: "Mutated duplicate audit entry."
      }
    ]);

    const reloadedAfterDuplicate = await repository.getGoalBundle(bundle.goal.id);
    const duplicateLogs =
      reloadedAfterDuplicate?.actionLogs.filter((log) => log.id === "share-audit-append-1") ?? [];

    expect(duplicateLogs).toHaveLength(1);
    expect(duplicateLogs[0]?.message).toBe("Blocked public share access.");
    expect(reloaded?.tasks.map((task) => task.id)).toEqual(bundle.tasks.map((task) => task.id));
    await expect(
      repository.appendGoalActionLogs("missing-goal", [
        {
          ...firstLog,
          id: "share-audit-missing-goal",
          goalId: "missing-goal"
        }
      ])
    ).rejects.toThrow("Goal missing-goal was not found.");
    await expect(
      repository.appendGoalActionLogs(bundle.goal.id, [
        {
          ...firstLog,
          id: "share-audit-wrong-goal",
          goalId: "another-goal"
        }
      ])
    ).rejects.toThrow(`Action log share-audit-wrong-goal belongs to goal another-goal, not ${bundle.goal.id}.`);
  });

  it("persists a goal bundle to the file-backed store", async () => {
    const tempDir = await mkdtemp(path.join(os.tmpdir(), "agentic-repo-"));
    const storePath = path.join(tempDir, "runtime-store.json");
    const repository = createRepository({
      storePath
    });

    await repository.seedDefaults(SYSTEM_USER_ID);

    const bundle = await createGoalForUser(repository, SYSTEM_USER_ID, "Plan my week around focus time and meetings.");

    const reloaded = await repository.getGoalBundle(bundle.goal.id);
    const persisted = JSON.parse(await readFile(storePath, "utf8")) as {
      goals: Array<{
        id: string;
        wedge?: { key: string; selection: string };
        completionContract?: { id: string };
      }>;
    };

    expect(reloaded?.goal.id).toBe(bundle.goal.id);
    expect(reloaded?.goal.wedge).toMatchObject({
      key: "scheduling_execution",
      selection: "selected_production"
    });
    expect(reloaded?.goal.completionContract).toMatchObject({
      id: "scheduling-execution-v1"
    });
    expect(persisted.goals.some((goal) => goal.id === bundle.goal.id)).toBe(true);
    expect(
      persisted.goals.find((goal) => goal.id === bundle.goal.id)
    ).toMatchObject({
      wedge: {
        key: "scheduling_execution",
        selection: "selected_production"
      },
      completionContract: {
        id: "scheduling-execution-v1"
      }
    });
    expect(reloaded?.goal.responsibility.owner.userId).toBe(SYSTEM_USER_ID);
    expect(reloaded?.goal.responsibility.reviewer?.label).toBe("Goal reviewer");
    expect(reloaded?.tasks[0]?.responsibility.owner.userId).toBe(SYSTEM_USER_ID);
    expect(reloaded?.tasks[0]?.responsibility.delegate?.kind).toBe("system_actor");
    expect(reloaded?.tasks[0]?.responsibility.delegate?.label).toContain("execution lane");

    if (reloaded?.approvals.length) {
      expect(reloaded.approvals[0].responsibility.owner.userId).toBe(SYSTEM_USER_ID);
      expect(reloaded.approvals[0].responsibility.reviewer?.label).toBe("Approval reviewer");
    }
  }, 15_000);

  it("rejects duplicate approval responses once the first decision is committed", async () => {
    const tempDir = await mkdtemp(path.join(os.tmpdir(), "agentic-repo-"));
    const storePath = path.join(tempDir, "runtime-store.json");
    const repository = createRepository({
      storePath
    });

    await repository.seedDefaults(SYSTEM_USER_ID);

    const bundle = await createGoalForUser(repository, SYSTEM_USER_ID, "Review my inbox and send one external reply.");
    const approval = bundle.approvals[0];

    expect(approval).toBeDefined();

    const approvedBundle = await repository.respondToApproval({
      approvalId: approval.id,
      decision: "approved",
      actor: systemActor,
      scope: "similar_24h",
      rationale: "The next few outbound replies can follow the same pattern."
    });
    const approvedApproval = approvedBundle.approvals.find((candidate) => candidate.id === approval.id);

    await expect(
      repository.respondToApproval({
        approvalId: approval.id,
        decision: "rejected",
        actor: systemActor
      })
    ).rejects.toThrow(/already been handled/);

    expect(approvedApproval).toMatchObject({
      decision: "approved",
      decisionScope: "similar_24h",
      decisionRationale: "The next few outbound replies can follow the same pattern."
    });
    expect(approvedApproval?.history.at(-1)).toMatchObject({
      decision: "approved",
      scope: "similar_24h",
      rationale: "The next few outbound replies can follow the same pattern.",
      actorContext: systemActor
    });
  }, 15_000);

  it("records approval decisions and follow-up jobs as one durable mutation", async () => {
    const tempDir = await mkdtemp(path.join(os.tmpdir(), "agentic-repo-"));
    const storePath = path.join(tempDir, "runtime-store.json");
    const repository = createRepository({
      storePath
    });

    await repository.seedDefaults(SYSTEM_USER_ID);

    const bundle = await createGoalForUser(repository, SYSTEM_USER_ID, "Review my inbox and send one external reply.");
    const approval = bundle.approvals[0];

    expect(approval).toBeDefined();

    const actionId = "approval-action:test";
    const result = await repository.respondToApprovalAndEnqueueJob!({
      approvalId: approval!.id,
      decision: "approved",
      actor: systemActor,
      scope: "once",
      rationale: "Approved for this exact reply.",
      buildJob: (updatedBundle) =>
        createJobRecord({
          userId: SYSTEM_USER_ID,
          kind: "approval_follow_up",
          actorContext: systemActor,
          maxAttempts: 1,
          idempotencyKey: `approval-follow-up:${approval!.id}:${actionId}:approved`,
          payload: {
            type: "approval_follow_up",
            approvalId: approval!.id,
            goalId: updatedBundle.goal.id,
            taskId: approval!.taskId,
            decision: "approved",
            workspaceId: updatedBundle.goal.workspaceId,
            metadata: {
              replayedFromJobId: null,
              actionId
            }
          }
        })
    });
    const persistedBundle = await repository.getGoalBundleForUser(bundle.goal.id, SYSTEM_USER_ID);
    const jobs = await repository.listJobs({ userId: SYSTEM_USER_ID, kinds: ["approval_follow_up"] });
    const evidenceRecords = await repository.listEvidenceRecords({
      userId: SYSTEM_USER_ID,
      approvalId: approval!.id
    });

    expect(result.bundle.approvals.find((candidate) => candidate.id === approval!.id)?.decision).toBe("approved");
    expect(result.job).toMatchObject({
      kind: "approval_follow_up",
      status: "queued",
      idempotencyKey: `approval-follow-up:${approval!.id}:${actionId}:approved`,
      payload: {
        type: "approval_follow_up",
        approvalId: approval!.id,
        goalId: bundle.goal.id,
        taskId: approval!.taskId,
        decision: "approved",
        metadata: {
          actionId
        }
      }
    });
    expect(persistedBundle?.approvals.find((candidate) => candidate.id === approval!.id)?.decision).toBe("approved");
    expect(jobs.map((job) => job.id)).toEqual([result.job.id]);
    expect(evidenceRecords).toHaveLength(1);
  }, 15_000);

  it("rejects atomic approval follow-up jobs owned by a different user", async () => {
    const tempDir = await mkdtemp(path.join(os.tmpdir(), "agentic-repo-"));
    const storePath = path.join(tempDir, "runtime-store.json");
    const repository = createRepository({
      storePath
    });
    const mismatchedUserId = "user-approval-job-owner-mismatch";

    await repository.seedDefaults(SYSTEM_USER_ID);
    await repository.seedDefaults(mismatchedUserId);

    const bundle = await createGoalForUser(repository, SYSTEM_USER_ID, "Review my inbox and send one external reply.");
    const approval = bundle.approvals[0];

    expect(approval).toBeDefined();

    await expect(
      repository.respondToApprovalAndEnqueueJob!({
        approvalId: approval!.id,
        decision: "approved",
        actor: systemActor,
        scope: "once",
        rationale: "Approved for this exact reply.",
        buildJob: (updatedBundle) =>
          createJobRecord({
            userId: mismatchedUserId,
            kind: "approval_follow_up",
            actorContext: systemActor,
            maxAttempts: 1,
            idempotencyKey: `approval-follow-up:${approval!.id}:owner-mismatch:approved`,
            payload: {
              type: "approval_follow_up",
              approvalId: approval!.id,
              goalId: updatedBundle.goal.id,
              taskId: approval!.taskId,
              decision: "approved",
              workspaceId: updatedBundle.goal.workspaceId,
              metadata: {
                replayedFromJobId: null,
                actionId: "owner-mismatch"
              }
            }
          })
      })
    ).rejects.toThrow(/job owner must match/i);

    const persistedBundle = await repository.getGoalBundleForUser(bundle.goal.id, SYSTEM_USER_ID);
    const ownerJobs = await repository.listJobs({ userId: SYSTEM_USER_ID, kinds: ["approval_follow_up"] });
    const mismatchedJobs = await repository.listJobs({ userId: mismatchedUserId, kinds: ["approval_follow_up"] });
    const evidenceRecords = await repository.listEvidenceRecords({
      userId: SYSTEM_USER_ID,
      approvalId: approval!.id
    });

    expect(persistedBundle?.approvals.find((candidate) => candidate.id === approval!.id)?.decision).toBe("pending");
    expect(ownerJobs).toEqual([]);
    expect(mismatchedJobs).toEqual([]);
    expect(evidenceRecords).toEqual([]);
  }, 15_000);

  it("keeps approval decisions pending when atomic follow-up job construction fails", async () => {
    const tempDir = await mkdtemp(path.join(os.tmpdir(), "agentic-repo-"));
    const storePath = path.join(tempDir, "runtime-store.json");
    const repository = createRepository({
      storePath
    });

    await repository.seedDefaults(SYSTEM_USER_ID);

    const bundle = await createGoalForUser(repository, SYSTEM_USER_ID, "Review my inbox and send one external reply.");
    const approval = bundle.approvals[0];

    expect(approval).toBeDefined();

    await expect(
      repository.respondToApprovalAndEnqueueJob!({
        approvalId: approval!.id,
        decision: "approved",
        actor: systemActor,
        scope: "once",
        rationale: "Approved for this exact reply.",
        buildJob: () => {
          throw new Error("simulated follow-up job construction failure");
        }
      })
    ).rejects.toThrow("simulated follow-up job construction failure");

    const persistedBundle = await repository.getGoalBundleForUser(bundle.goal.id, SYSTEM_USER_ID);
    const jobs = await repository.listJobs({ userId: SYSTEM_USER_ID, kinds: ["approval_follow_up"] });
    const evidenceRecords = await repository.listEvidenceRecords({
      userId: SYSTEM_USER_ID,
      approvalId: approval!.id
    });

    expect(persistedBundle?.approvals.find((candidate) => candidate.id === approval!.id)?.decision).toBe("pending");
    expect(jobs).toEqual([]);
    expect(evidenceRecords).toEqual([]);
  }, 15_000);

  it("hides approval responses from other users and keeps the approval pending", async () => {
    const tempDir = await mkdtemp(path.join(os.tmpdir(), "agentic-repo-"));
    const storePath = path.join(tempDir, "runtime-store.json");
    const repository = createRepository({
      storePath
    });
    const secondaryUserId = "user-secondary";

    await repository.seedDefaults(SYSTEM_USER_ID);
    await repository.seedDefaults(secondaryUserId);

    const bundle = await createGoalForUser(repository, secondaryUserId, "Review my inbox and send one external reply.");
    const approval = bundle.approvals[0];

    expect(approval).toBeDefined();

    await expect(
      repository.respondToApproval({
        approvalId: approval!.id,
        decision: "approved",
        actor: systemActor,
        scope: "similar_24h",
        rationale: "This should stay hidden from other users."
      })
    ).rejects.toThrow(/was not found/);

    const hiddenEvidence = await repository.listEvidenceRecords({
      userId: SYSTEM_USER_ID,
      approvalId: approval!.id
    });
    const visibleBundle = await repository.getGoalBundleForUser(bundle.goal.id, secondaryUserId);
    const visibleApproval = visibleBundle?.approvals.find((candidate) => candidate.id === approval!.id);

    expect(hiddenEvidence).toEqual([]);
    expect(visibleApproval).toMatchObject({
      id: approval!.id,
      decision: "pending",
      respondedAt: null
    });
    expect(visibleApproval?.history).toEqual([]);
  });

  it("requires the workspace owner to respond to shared approvals and preserves audit evidence", async () => {
    const tempDir = await mkdtemp(path.join(os.tmpdir(), "agentic-repo-"));
    const storePath = path.join(tempDir, "runtime-store.json");
    const repository = createRepository({
      storePath
    });
    const editorUserId = "user-editor";
    const viewerUserId = "user-viewer";
    const timestamp = nowIso();

    await repository.seedDefaults(SYSTEM_USER_ID);
    await repository.seedDefaults(editorUserId);
    await repository.seedDefaults(viewerUserId);

    const sharedWorkspace = WorkspaceSchema.parse({
      id: "workspace-owner-boundary",
      ownerUserId: SYSTEM_USER_ID,
      slug: "owner-boundary",
      name: "Owner Boundary",
      description: "Shared approvals stay with the workspace owner.",
      isPersonal: false,
      createdAt: timestamp,
      updatedAt: timestamp
    });

    await repository.saveWorkspace(sharedWorkspace, systemActor);
    await repository.saveWorkspaceMember(
      WorkspaceMemberSchema.parse({
        id: "workspace-owner-boundary-owner",
        workspaceId: sharedWorkspace.id,
        userId: SYSTEM_USER_ID,
        role: "owner",
        joinedAt: timestamp,
        updatedAt: timestamp
      }),
      systemActor
    );
    await repository.saveWorkspaceMember(
      WorkspaceMemberSchema.parse({
        id: "workspace-owner-boundary-editor",
        workspaceId: sharedWorkspace.id,
        userId: editorUserId,
        role: "editor",
        joinedAt: timestamp,
        updatedAt: timestamp
      }),
      systemActor
    );
    await repository.saveWorkspaceMember(
      WorkspaceMemberSchema.parse({
        id: "workspace-owner-boundary-viewer",
        workspaceId: sharedWorkspace.id,
        userId: viewerUserId,
        role: "viewer",
        joinedAt: timestamp,
        updatedAt: timestamp
      }),
      systemActor
    );

    const bundle = await createGoalForUser(
      repository,
      SYSTEM_USER_ID,
      "Review my inbox and send one external reply.",
      sharedWorkspace.id
    );
    const approval = bundle.approvals[0];

    expect(approval).toBeDefined();
    await expect(repository.getGoalBundleForUser(bundle.goal.id, editorUserId)).resolves.not.toBeNull();
    await expect(repository.getGoalBundleForUser(bundle.goal.id, viewerUserId)).resolves.not.toBeNull();

    await expect(
      repository.respondToApproval({
        approvalId: approval!.id,
        decision: "approved",
        actor: createHumanActorContext(editorUserId),
        scope: "once",
        rationale: "Editors should not be able to clear shared-team approvals."
      })
    ).rejects.toThrow("Only the workspace owner can respond to shared approvals.");
    await expect(
      repository.respondToApproval({
        approvalId: approval!.id,
        decision: "approved",
        actor: createHumanActorContext(viewerUserId),
        scope: "once",
        rationale: "Viewers should remain read-only on shared-team approvals."
      })
    ).rejects.toThrow("Only the workspace owner can respond to shared approvals.");

    const pendingBundle = await repository.getGoalBundleForUser(bundle.goal.id, SYSTEM_USER_ID);
    const pendingApproval = pendingBundle?.approvals.find((candidate) => candidate.id === approval!.id);

    expect(pendingApproval).toMatchObject({
      id: approval!.id,
      decision: "pending",
      respondedAt: null
    });
    expect(pendingApproval?.history).toEqual([]);
    await expect(
      repository.listEvidenceRecords({
        userId: SYSTEM_USER_ID,
        approvalId: approval!.id
      })
    ).resolves.toEqual([]);

    const approvedBundle = await repository.respondToApproval({
      approvalId: approval!.id,
      decision: "approved",
      actor: systemActor,
      scope: "similar_24h",
      rationale: "Owner approved the shared-team send after reviewing the delegated draft."
    });
    const approvedApproval = approvedBundle.approvals.find((candidate) => candidate.id === approval!.id);
    const ownerEvidence = await repository.listEvidenceRecords({
      userId: SYSTEM_USER_ID,
      approvalId: approval!.id
    });

    expect(approvedApproval).toMatchObject({
      decision: "approved",
      decisionScope: "similar_24h",
      decisionRationale: "Owner approved the shared-team send after reviewing the delegated draft."
    });
    expect(ownerEvidence).toHaveLength(1);
    expect(ownerEvidence[0]).toMatchObject({
      approvalId: approval!.id,
      decision: "approved",
      actorContext: systemActor
    });
  });

  it("surfaces dead-lettered approval follow-up jobs as replayable async execution issues", async () => {
    const tempDir = await mkdtemp(path.join(os.tmpdir(), "agentic-repo-"));
    const storePath = path.join(tempDir, "runtime-store.json");
    const repository = createRepository({
      storePath
    });

    await repository.seedDefaults(SYSTEM_USER_ID);

    const bundle = await createGoalForUser(repository, SYSTEM_USER_ID, "Review my inbox and draft responses.");
    const approval = bundle.approvals[0];

    expect(approval).toBeDefined();

    const updatedBundle = await repository.respondToApproval({
      approvalId: approval!.id,
      decision: "rejected",
      actor: systemActor,
      scope: "once",
      rationale: "Keep this in manual review until an operator inspects the draft."
    });
    const queuedJob = await repository.enqueueJob(
      createJobRecord({
        userId: SYSTEM_USER_ID,
        kind: "approval_follow_up",
        actorContext: systemActor,
        maxAttempts: 1,
        payload: {
          type: "approval_follow_up",
          approvalId: approval!.id,
          goalId: updatedBundle.goal.id,
          taskId: approval!.taskId,
          decision: "rejected",
          workspaceId: updatedBundle.goal.workspaceId,
          metadata: {
            replayedFromJobId: null
          }
        }
      })
    );
    const claimedJob = await repository.claimNextJob({
      userId: SYSTEM_USER_ID,
      kinds: ["approval_follow_up"],
      runnerId: "worker-dashboard-approval-replay",
      leaseMs: 30_000,
      now: "2099-04-19T02:00:00.000Z"
    });

    expect(claimedJob?.id).toBe(queuedJob.id);

    await repository.deadLetterJob({
      jobId: queuedJob.id,
      runnerId: "worker-dashboard-approval-replay",
      deadLetteredAt: "2026-04-19T02:01:00.000Z",
      error: "approval follow-up replay test failure"
    });

    const dashboard = await repository.getDashboardData(SYSTEM_USER_ID);
    const asyncIssue = dashboard.operations?.asyncExecution.items.find((item) => item.jobId === queuedJob.id);
    const storedJob = await repository.getJob(queuedJob.id, SYSTEM_USER_ID);

    expect(storedJob?.journal).toMatchObject({
      lifecycleState: "dead_letter",
      retryCount: 1,
      sideEffectTarget: `goal:${updatedBundle.goal.id}:task:${approval!.taskId}`,
      recovery: {
        strategy: "replay_job",
        statusUrl: `/api/approvals/jobs/${queuedJob.id}`,
        operatorActionLabel: "Replay job"
      }
    });
    expect(storedJob?.journal.entries.at(-1)).toMatchObject({
      state: "dead_letter",
      attempt: 1,
      error: "approval follow-up replay test failure"
    });

    expect(asyncIssue).toMatchObject({
      id: `operations-job-${queuedJob.id}`,
      jobId: queuedJob.id,
      label: `Approval follow-up · ${updatedBundle.goal.title}`,
      summary: "Dead-lettered after 1/1 attempts.",
      severity: "critical",
      status: "dead_letter",
      target: {
        section: "goals",
        itemId: updatedBundle.goal.id,
        label: updatedBundle.goal.title
      },
      remediation: {
        kind: "replay_job",
        label: "Replay job",
        note: "Replay the approval follow-up job to recover the queued side effect without manual state edits.",
        permission: "owner",
        statusUrl: `/api/approvals/jobs/${queuedJob.id}`
      }
    });
  }, 15_000);

  it("surfaces dead-lettered autopilot jobs as replayable async execution issues", async () => {
    const tempDir = await mkdtemp(path.join(os.tmpdir(), "agentic-repo-"));
    const storePath = path.join(tempDir, "runtime-store.json");
    const repository = createRepository({
      storePath
    });

    await repository.seedDefaults(SYSTEM_USER_ID);

    const autopilotEvent = await repository.saveAutopilotEvent(
      AutopilotEventSchema.parse({
        id: "autopilot-event-dashboard-replay",
        userId: SYSTEM_USER_ID,
        kind: "watcher_triggered",
        sourceId: "watcher-dashboard-replay",
        idempotencyKey: "watcher-dashboard-replay",
        mode: "draft_goal",
        summary: "Replay a dead-lettered autopilot watcher event.",
        status: "failed",
        details: {
          failureStage: "execution",
          requiresReview: true,
          recoveryAction: "review_event_error"
        },
        actorContext: systemActor,
        createdAt: nowIso(),
        processedAt: nowIso(),
        resultGoalId: null,
        error: "Autopilot execution failed."
      })
    );
    const queuedJob = await repository.enqueueJob(
      createJobRecord({
        userId: SYSTEM_USER_ID,
        kind: "autopilot_process",
        actorContext: systemActor,
        maxAttempts: 1,
        payload: {
          type: "autopilot_process",
          autopilotEventId: autopilotEvent.id,
          kind: autopilotEvent.kind,
          sourceId: autopilotEvent.sourceId,
          mode: autopilotEvent.mode,
          metadata: {}
        }
      })
    );
    const claimedJob = await repository.claimNextJob({
      userId: SYSTEM_USER_ID,
      kinds: ["autopilot_process"],
      runnerId: "worker-dashboard-autopilot-replay",
      leaseMs: 30_000,
      now: "2099-04-19T02:00:00.000Z"
    });

    expect(claimedJob?.id).toBe(queuedJob.id);

    await repository.deadLetterJob({
      jobId: queuedJob.id,
      runnerId: "worker-dashboard-autopilot-replay",
      deadLetteredAt: "2026-04-19T02:01:00.000Z",
      error: "autopilot replay test failure"
    });

    const dashboard = await repository.getDashboardData(SYSTEM_USER_ID);
    const asyncIssue = dashboard.operations?.asyncExecution.items.find((item) => item.jobId === queuedJob.id);
    const storedJob = await repository.getJob(queuedJob.id, SYSTEM_USER_ID);

    expect(storedJob?.journal).toMatchObject({
      lifecycleState: "dead_letter",
      retryCount: 1,
      sideEffectTarget: `autopilot-event:${autopilotEvent.id}`,
      recovery: {
        strategy: "replay_job",
        statusUrl: `/api/jobs/${queuedJob.id}`,
        operatorActionLabel: "Replay event"
      }
    });
    expect(storedJob?.journal.entries.at(-1)).toMatchObject({
      state: "dead_letter",
      attempt: 1,
      error: "autopilot replay test failure"
    });

    expect(asyncIssue).toMatchObject({
      id: `operations-job-${queuedJob.id}`,
      jobId: queuedJob.id,
      label: "Autopilot event · watcher triggered",
      summary: "Dead-lettered after 1/1 attempts.",
      severity: "critical",
      status: "dead_letter",
      target: {
        section: "autopilot",
        itemId: autopilotEvent.id,
        label: "Open autopilot event"
      },
      remediation: {
        kind: "replay_job",
        label: "Replay event",
        note: "Replay the autopilot event job to reprocess the failed trigger without recreating the source event.",
        permission: "owner",
        statusUrl: `/api/jobs/${queuedJob.id}`
      }
    });
  }, 15_000);

  it("round-trips approval previews and decision history through the file-backed store", async () => {
    const tempDir = await mkdtemp(path.join(os.tmpdir(), "agentic-repo-"));
    const storePath = path.join(tempDir, "runtime-store.json");
    const repository = createRepository({
      storePath
    });

    await repository.seedDefaults(SYSTEM_USER_ID);

    const bundle = await createGoalForUser(repository, SYSTEM_USER_ID, "Review my inbox and send one external reply.");
    const approval = bundle.approvals[0];

    expect(approval).toBeDefined();
    expect(approval?.preview.actionType).toBe("send");

    await repository.respondToApproval({
      approvalId: approval!.id,
      decision: "approved",
      actor: systemActor,
      scope: "similar_24h",
      rationale: "This exact external reply pattern is safe for the next day."
    });

    const reloaded = await repository.getGoalBundle(bundle.goal.id);
    const persistedApproval = reloaded?.approvals.find((candidate) => candidate.id === approval?.id);

    expect(persistedApproval).toMatchObject({
      id: approval?.id,
      actionIntent: {
        type: "manual_review",
        actionType: "send"
      },
      preview: {
        actionType: "send"
      },
      decisionScope: "similar_24h",
      decisionRationale: "This exact external reply pattern is safe for the next day."
    });
    expect(persistedApproval?.history.at(-1)).toMatchObject({
      decision: "approved",
      scope: "similar_24h",
      rationale: "This exact external reply pattern is safe for the next day.",
      actorContext: systemActor
    });
  });

  it("fails closed to manual review when a persisted approval intent is malformed", async () => {
    const tempDir = await mkdtemp(path.join(os.tmpdir(), "agentic-repo-"));
    const storePath = path.join(tempDir, "runtime-store.json");
    const repository = createRepository({
      storePath
    });

    await repository.seedDefaults(SYSTEM_USER_ID);

    const bundle = await createGoalForUser(repository, SYSTEM_USER_ID, "Review my inbox and send one external reply.");
    const approval = bundle.approvals[0];
    const persisted = JSON.parse(await readFile(storePath, "utf8")) as {
      approvals?: Array<{ id: string; action_intent?: unknown }>;
    };
    const persistedApproval = persisted.approvals?.find((candidate) => candidate.id === approval?.id);

    expect(persistedApproval).toBeDefined();

    persistedApproval!.action_intent = {
      type: "send_message",
      to: "client@example.com"
    };

    await writeFile(storePath, JSON.stringify(persisted, null, 2));

    const reloaded = await repository.getGoalBundle(bundle.goal.id);
    const reloadedApproval = reloaded?.approvals.find((candidate) => candidate.id === approval?.id);

    expect(reloadedApproval?.actionIntent).toMatchObject({
      type: "manual_review",
      actionType: "send"
    });
  });

  it("captures durable evidence records for approval responses in the file-backed store", async () => {
    const tempDir = await mkdtemp(path.join(os.tmpdir(), "agentic-repo-"));
    const storePath = path.join(tempDir, "runtime-store.json");
    const repository = createRepository({
      storePath
    });

    await expectApprovalEvidenceCapture(repository, "approved");
    await expectApprovalEvidenceCapture(repository, "rejected");

    const persisted = JSON.parse(await readFile(storePath, "utf8")) as {
      evidenceRecords?: Array<{ approvalId: string; decision: string }>;
    };

    expect(persisted.evidenceRecords).toHaveLength(2);
    expect(persisted.evidenceRecords?.map((record) => record.decision).sort()).toEqual(["approved", "rejected"]);
  });

  it("deduplicates user-scoped job idempotency keys and enforces runner ownership in the file-backed store", async () => {
    const tempDir = await mkdtemp(path.join(os.tmpdir(), "agentic-repo-"));
    const storePath = path.join(tempDir, "runtime-store.json");
    const repository = createRepository({
      storePath
    });
    const primaryUserId = `jobs-primary-${Date.now()}`;
    const secondaryUserId = `jobs-secondary-${Date.now()}`;
    const first = createGoalCreateJob({
      userId: primaryUserId,
      request: "Create a durable goal.",
      idempotencyKey: " goal:dedupe ",
      availableAt: "2026-04-16T02:00:00.000Z"
    });
    const duplicate = createGoalCreateJob({
      userId: primaryUserId,
      request: "Duplicate durable goal.",
      idempotencyKey: "goal:dedupe",
      availableAt: "2026-04-16T02:00:00.000Z"
    });
    const otherUser = createGoalCreateJob({
      userId: secondaryUserId,
      request: "Same key but different user.",
      idempotencyKey: "goal:dedupe",
      availableAt: "2026-04-16T02:00:00.000Z"
    });

    const savedFirst = await repository.enqueueJob(first);
    const savedDuplicate = await repository.enqueueJob(duplicate);
    const savedOtherUser = await repository.enqueueJob(otherUser);
    const claimed = await repository.claimNextJob({
      userId: primaryUserId,
      runnerId: "worker-a",
      leaseMs: 30_000,
      now: "2026-04-16T02:00:00.000Z"
    });

    expect(savedDuplicate.id).toBe(savedFirst.id);
    expect(savedOtherUser.id).not.toBe(savedFirst.id);
    expect((await repository.listJobs({ userId: primaryUserId }))).toHaveLength(1);
    expect(claimed).not.toBeNull();
    await expect(
      repository.completeJob({
        jobId: claimed!.id,
        runnerId: "worker-b",
        completedAt: "2026-04-16T02:00:05.000Z"
      })
    ).rejects.toThrow(/claimed by another worker/);

    const completed = await repository.completeJob({
      jobId: claimed!.id,
      runnerId: "worker-a",
      completedAt: "2026-04-16T02:00:05.000Z"
    });

    expect(completed).toMatchObject({
      id: savedFirst.id,
      status: "completed",
      completedAt: "2026-04-16T02:00:05.000Z"
    });
  });

  it("waits for the file-store lock before mutating the runtime store", async () => {
    const tempDir = await mkdtemp(path.join(os.tmpdir(), "agentic-repo-file-lock-"));
    const storePath = path.join(tempDir, "runtime-store.json");
    const lockPath = `${storePath}.lock`;
    const repository = createRepository({
      storePath
    });
    const job = createGoalCreateJob({
      userId: SYSTEM_USER_ID,
      request: "Validate cross-process file store locking.",
      idempotencyKey: "file-lock-validation"
    });

    await mkdir(lockPath);

    let settled = false;
    const enqueuePromise = repository.enqueueJob(job).finally(() => {
      settled = true;
    });
    const blockedResult = await Promise.race([
      enqueuePromise.then(() => "completed"),
      new Promise<"blocked">((resolve) => setTimeout(() => resolve("blocked"), 75))
    ]);

    expect(blockedResult).toBe("blocked");
    expect(settled).toBe(false);

    await rmdir(lockPath);

    const saved = await enqueuePromise;

    expect(saved.id).toBe(job.id);
    expect(await repository.listJobs({ userId: SYSTEM_USER_ID })).toHaveLength(1);
  });

  it("reclaims expired job leases ahead of later work in the file-backed store", async () => {
    const tempDir = await mkdtemp(path.join(os.tmpdir(), "agentic-repo-"));
    const storePath = path.join(tempDir, "runtime-store.json");
    const repository = createRepository({
      storePath
    });
    const userId = `jobs-lease-${Date.now()}`;
    const dueNow = await repository.enqueueJob(
      createGoalCreateJob({
        userId,
        request: "Process the earliest durable job.",
        availableAt: "2026-04-16T00:00:00.000Z"
      })
    );

    await repository.enqueueJob(
      createGoalCreateJob({
        userId,
        request: "Process the later durable job.",
        availableAt: "2026-04-16T00:01:00.000Z"
      })
    );

    const firstClaim = await repository.claimNextJob({
      userId,
      runnerId: "worker-a",
      leaseMs: 1_000,
      now: "2026-04-16T00:00:00.000Z"
    });
    const hiddenWhileLeased = await repository.claimNextJob({
      userId,
      runnerId: "worker-b",
      leaseMs: 1_000,
      now: "2026-04-16T00:00:00.500Z"
    });
    const reclaimed = await repository.claimNextJob({
      userId,
      runnerId: "worker-c",
      leaseMs: 1_000,
      now: "2026-04-16T00:01:30.000Z"
    });

    expect(firstClaim?.id).toBe(dueNow.id);
    expect(hiddenWhileLeased).toBeNull();
    expect(reclaimed).not.toBeNull();
    expect(reclaimed).toMatchObject({
      id: dueNow.id,
      claimedBy: "worker-c",
      attemptCount: 2
    });

    await repository.completeJob({
      jobId: reclaimed!.id,
      runnerId: "worker-c",
      completedAt: "2026-04-16T00:01:31.000Z"
    });

    const nextClaim = await repository.claimNextJob({
      userId,
      runnerId: "worker-d",
      leaseMs: 1_000,
      now: "2026-04-16T00:01:31.000Z"
    });

    expect(nextClaim).not.toBeNull();
    expect(nextClaim?.id).not.toBe(dueNow.id);
    expect(nextClaim?.attemptCount).toBe(1);
  });

  it("claims only jobs from the requested queue in the file-backed store", async () => {
    const tempDir = await mkdtemp(path.join(os.tmpdir(), "agentic-repo-"));
    const repository = createRepository({
      storePath: path.join(tempDir, "runtime-store.json")
    });
    const userId = `jobs-queue-affinity-${Date.now()}`;
    await repository.enqueueJob(
      createGoalCreateJob({ userId, queue: "maintenance", availableAt: "2026-04-16T02:00:00.000Z" })
    );
    const defaultJob = await repository.enqueueJob(
      createGoalCreateJob({ userId, queue: "default", availableAt: "2026-04-16T02:00:00.000Z" })
    );

    const claimed = await repository.claimNextJob({
      userId,
      queue: "default",
      runnerId: "worker-default",
      leaseMs: 30_000,
      now: "2026-04-16T02:00:00.000Z"
    });

    expect(claimed?.id).toBe(defaultJob.id);
    expect(claimed?.queue).toBe("default");
  });

  it("replaces an existing goal bundle snapshot instead of retaining stale child records in the file-backed store", async () => {
    const tempDir = await mkdtemp(path.join(os.tmpdir(), "agentic-repo-"));
    const storePath = path.join(tempDir, "runtime-store.json");
    const repository = createRepository({
      storePath
    });
    const goalId = `goal-fixed-${Date.now()}`;
    const workflowId = `workflow-fixed-${Date.now()}`;

    await repository.seedDefaults(SYSTEM_USER_ID);

    const firstBundle = await processUserRequest({
      userId: SYSTEM_USER_ID,
      request: "Draft a weekly planning workflow.",
      memories: await repository.listMemory(SYSTEM_USER_ID),
      integrations: await repository.listIntegrations(SYSTEM_USER_ID),
      goalId,
      workflowId
    });

    await repository.saveGoalBundle(firstBundle);

    const replacementBundle = await processUserRequest({
      userId: SYSTEM_USER_ID,
      request: "Prepare travel readiness coordination.",
      memories: await repository.listMemory(SYSTEM_USER_ID),
      integrations: await repository.listIntegrations(SYSTEM_USER_ID),
      goalId,
      workflowId
    });

    await repository.saveGoalBundle(replacementBundle);

    const reloaded = await repository.getGoalBundle(goalId);

    expect(reloaded).not.toBeNull();
    expect(reloaded?.tasks.map((task) => task.id)).toEqual(replacementBundle.tasks.map((task) => task.id));
    expect(reloaded?.artifacts.map((artifact) => artifact.id)).toEqual(replacementBundle.artifacts.map((artifact) => artifact.id));
    expect(reloaded?.approvals.map((approval) => approval.id)).toEqual(replacementBundle.approvals.map((approval) => approval.id));
    expect(reloaded?.watchers.map((watcher) => watcher.id)).toEqual(replacementBundle.watchers.map((watcher) => watcher.id));
    expect(reloaded?.actionLogs.map((log) => log.id)).toEqual(replacementBundle.actionLogs.map((log) => log.id));
    expect(reloaded?.tasks.some((task) => firstBundle.tasks.some((candidate) => candidate.id === task.id))).toBe(false);
  }, 15_000);

  it("persists retry and dead-letter transitions through the durable queue in the file-backed store", async () => {
    const tempDir = await mkdtemp(path.join(os.tmpdir(), "agentic-repo-"));
    const storePath = path.join(tempDir, "runtime-store.json");
    const repository = createRepository({
      storePath
    });

    await expectDurableQueueLifecycle(repository, `jobs-queue-${Date.now()}`);
  });

  it("claims higher-priority jobs first and respects concurrency keys in the file-backed store", async () => {
    const tempDir = await mkdtemp(path.join(os.tmpdir(), "agentic-repo-"));
    const storePath = path.join(tempDir, "runtime-store.json");
    const repository = createRepository({
      storePath
    });

    await expectPriorityAndConcurrencyControls(repository, `jobs-priority-${Date.now()}`);
  });

  it("persists provider credentials, encrypted secrets, and managed Google integrations in the file-backed store", async () => {
    const tempDir = await mkdtemp(path.join(os.tmpdir(), "agentic-repo-"));
    const storePath = path.join(tempDir, "runtime-store.json");
    const repository = createRepository({
      storePath
    });
    const secretStore = createProviderCredentialSecretStore({
      masterKey: "test-provider-secret-key",
      keyVersion: "test-v1"
    });
    const credential = buildProviderCredential({
      userId: SYSTEM_USER_ID,
      workspaceId: "workspace-alpha",
      accountId: "acct-alpha",
      accountEmail: "owner@example.com"
    });
    const refreshToken = "refresh-token-alpha";

    await repository.seedDefaults(SYSTEM_USER_ID);
    await repository.saveProviderCredential(credential);
    await repository.saveProviderCredentialSecret({
      credentialId: credential.id,
      userId: SYSTEM_USER_ID,
      kind: "oauth_refresh_token",
      secret: secretStore.encrypt(refreshToken),
      createdAt: nowIso(),
      updatedAt: nowIso()
    });

    const listedCredentials = await repository.listProviderCredentials(SYSTEM_USER_ID);
    const storedSecret = await repository.getProviderCredentialSecret(
      credential.id,
      "oauth_refresh_token",
      SYSTEM_USER_ID
    );
    const integrations = await repository.listIntegrations(SYSTEM_USER_ID);
    const rawStore = await readFile(storePath, "utf8");

    expect(listedCredentials).toEqual([credential]);
    expect(storedSecret).not.toBeNull();
    expect(secretStore.decrypt(storedSecret!.secret)).toBe(refreshToken);
    expect(integrations.find((integration) => integration.id === "gmail")).toMatchObject({
      id: "gmail",
      status: "ready",
      metadata: expect.objectContaining({
        provider: "google",
        providerCredentialId: credential.id,
        managed: true,
        workspaceId: "workspace-alpha"
      })
    });
    expect(integrations.find((integration) => integration.id === "google-calendar")).toMatchObject({
      id: "google-calendar",
      status: "ready",
      metadata: expect.objectContaining({
        provider: "google",
        providerCredentialId: credential.id,
        managed: true,
        workspaceId: "workspace-alpha"
      })
    });
    expect(rawStore).not.toContain(refreshToken);
  });

  it("isolates provider credentials and secrets by user", async () => {
    const tempDir = await mkdtemp(path.join(os.tmpdir(), "agentic-repo-"));
    const storePath = path.join(tempDir, "runtime-store.json");
    const repository = createRepository({
      storePath
    });
    const primaryUserId = `provider-primary-${Date.now()}`;
    const secondaryUserId = `provider-secondary-${Date.now()}`;
    const secretStore = createProviderCredentialSecretStore({
      masterKey: "test-provider-secret-key",
      keyVersion: "test-v1"
    });
    const primaryCredential = buildProviderCredential({
      userId: primaryUserId,
      workspaceId: "workspace-primary",
      accountId: "acct-primary",
      accountEmail: "primary@example.com"
    });
    const secondaryCredential = buildProviderCredential({
      userId: secondaryUserId,
      workspaceId: "workspace-secondary",
      accountId: "acct-secondary",
      accountEmail: "secondary@example.com"
    });

    await repository.seedDefaults(primaryUserId);
    await repository.seedDefaults(secondaryUserId);
    await repository.saveProviderCredential(primaryCredential);
    await repository.saveProviderCredential(secondaryCredential);
    await repository.saveProviderCredentialSecret({
      credentialId: primaryCredential.id,
      userId: primaryUserId,
      kind: "oauth_refresh_token",
      secret: secretStore.encrypt("refresh-token-primary"),
      createdAt: nowIso(),
      updatedAt: nowIso()
    });

    expect(await repository.listProviderCredentials(primaryUserId)).toEqual([primaryCredential]);
    expect(await repository.listProviderCredentials(secondaryUserId)).toEqual([secondaryCredential]);
    expect(
      await repository.getProviderCredentialSecret(primaryCredential.id, "oauth_refresh_token", secondaryUserId)
    ).toBeNull();
    expect(
      await repository.getProviderCredentialSecret(secondaryCredential.id, "oauth_refresh_token", secondaryUserId)
    ).toBeNull();
  });

  it("keeps integration records isolated when multiple users share the same integration id", async () => {
    const tempDir = await mkdtemp(path.join(os.tmpdir(), "agentic-repo-"));
    const storePath = path.join(tempDir, "runtime-store.json");
    const repository = createRepository({
      storePath
    });
    const primaryUserId = `integration-primary-${Date.now()}`;
    const secondaryUserId = `integration-secondary-${Date.now()}`;
    const primaryLocalNotes = buildDefaultIntegrationAccounts(primaryUserId).find(
      (integration) => integration.id === "local-notes"
    );
    const secondaryLocalNotes = buildDefaultIntegrationAccounts(secondaryUserId).find(
      (integration) => integration.id === "local-notes"
    );

    await repository.seedDefaults(primaryUserId);
    await repository.seedDefaults(secondaryUserId);
    await repository.upsertIntegration({
      ...primaryLocalNotes!,
      status: "disabled",
      metadata: {
        owner: "primary"
      },
      actorContext: systemActor,
      updatedAt: nowIso()
    });
    await repository.upsertIntegration({
      ...secondaryLocalNotes!,
      status: "ready",
      metadata: {
        owner: "secondary"
      },
      actorContext: systemActor,
      updatedAt: nowIso()
    });

    expect((await repository.listIntegrations(primaryUserId)).find((integration) => integration.id === "local-notes")).toMatchObject({
      id: "local-notes",
      userId: primaryUserId,
      status: "disabled",
      metadata: {
        owner: "primary"
      }
    });
    expect((await repository.listIntegrations(secondaryUserId)).find((integration) => integration.id === "local-notes")).toMatchObject({
      id: "local-notes",
      userId: secondaryUserId,
      status: "ready",
      metadata: {
        owner: "secondary"
      }
    });
  });

  it("rejects provider secrets for missing parent credentials", async () => {
    const tempDir = await mkdtemp(path.join(os.tmpdir(), "agentic-repo-"));
    const storePath = path.join(tempDir, "runtime-store.json");
    const repository = createRepository({
      storePath
    });
    const secretStore = createProviderCredentialSecretStore({
      masterKey: "test-provider-secret-key",
      keyVersion: "test-v1"
    });

    await repository.seedDefaults(SYSTEM_USER_ID);

    await expect(
      repository.saveProviderCredentialSecret({
        credentialId: "google:missing:acct-404",
        userId: SYSTEM_USER_ID,
        kind: "oauth_refresh_token",
        secret: secretStore.encrypt("refresh-token-missing"),
        createdAt: nowIso(),
        updatedAt: nowIso()
      })
    ).rejects.toThrow(/Provider credential google:missing:acct-404 was not found/);
  });

  const databaseUrl = process.env.DATABASE_URL;
  const postgresIt = databaseUrl ? it : it.skip;

  async function countPostgresQueries<T>(
    repository: ReturnType<typeof createRepository>,
    run: () => Promise<T>
  ): Promise<{ result: T; queryCount: number }> {
    let queryCount = 0;
    const originalClientQuery = Client.prototype.query;
    const instrumentedQuery: typeof Client.prototype.query = function (...args) {
      queryCount += 1;
      return originalClientQuery.apply(this, args);
    };
    Client.prototype.query = instrumentedQuery;

    try {
      const result = await run();
      return { result, queryCount };
    } finally {
      Client.prototype.query = originalClientQuery;
    }
  }

  postgresIt("persists and reloads a goal bundle in Postgres when DATABASE_URL is configured", async () => {
    const repository = createRepository({
      databaseUrl
    });

    await repository.seedDefaults(SYSTEM_USER_ID);

    const bundle = await createGoalForUser(repository, SYSTEM_USER_ID, `Prepare a travel plan with approvals ${Date.now()}.`);

    const reloaded = await repository.getGoalBundle(bundle.goal.id);
    const goals = await repository.listGoals(SYSTEM_USER_ID);

    expect(reloaded?.goal.id).toBe(bundle.goal.id);
    expect(goals.some((goalBundle) => goalBundle.goal.id === bundle.goal.id)).toBe(true);
  });

  postgresIt("hydrates Postgres goal pages without per-goal query fanout when DATABASE_URL is configured", async () => {
    const repository = createRepository({
      databaseUrl
    });

    await repository.seedDefaults(SYSTEM_USER_ID);

    for (let index = 0; index < 6; index += 1) {
      await createGoalForUser(repository, SYSTEM_USER_ID, `Measure paged Postgres hydration ${Date.now()}-${index}.`);
    }

    const { result: firstPage, queryCount } = await countPostgresQueries(repository, () =>
      repository.listGoalsPage({ userId: SYSTEM_USER_ID, limit: 3 })
    );

    expect(firstPage.items).toHaveLength(3);
    expect(queryCount).toBeLessThanOrEqual(8);
  }, 15_000);

  postgresIt("replaces an existing goal bundle snapshot in Postgres without leaving stale child records", async () => {
    const repository = createRepository({
      databaseUrl
    });
    const goalId = `goal-fixed-postgres-${Date.now()}`;
    const workflowId = `workflow-fixed-postgres-${Date.now()}`;

    await repository.seedDefaults(SYSTEM_USER_ID);

    const firstBundle = await processUserRequest({
      userId: SYSTEM_USER_ID,
      request: "Draft a weekly planning workflow.",
      memories: await repository.listMemory(SYSTEM_USER_ID),
      integrations: await repository.listIntegrations(SYSTEM_USER_ID),
      goalId,
      workflowId
    });

    await repository.saveGoalBundle(firstBundle);

    const replacementBundle = await processUserRequest({
      userId: SYSTEM_USER_ID,
      request: "Prepare travel readiness coordination.",
      memories: await repository.listMemory(SYSTEM_USER_ID),
      integrations: await repository.listIntegrations(SYSTEM_USER_ID),
      goalId,
      workflowId
    });

    await repository.saveGoalBundle(replacementBundle);

    const reloaded = await repository.getGoalBundle(goalId);

    expect(reloaded).not.toBeNull();
    expect(reloaded?.tasks.map((task) => task.id)).toEqual(replacementBundle.tasks.map((task) => task.id));
    expect(reloaded?.artifacts.map((artifact) => artifact.id)).toEqual(replacementBundle.artifacts.map((artifact) => artifact.id));
    expect(reloaded?.approvals.map((approval) => approval.id)).toEqual(replacementBundle.approvals.map((approval) => approval.id));
    expect(reloaded?.watchers.map((watcher) => watcher.id)).toEqual(replacementBundle.watchers.map((watcher) => watcher.id));
    expect(reloaded?.actionLogs.map((log) => log.id)).toEqual(replacementBundle.actionLogs.map((log) => log.id));
    expect(reloaded?.tasks.some((task) => firstBundle.tasks.some((candidate) => candidate.id === task.id))).toBe(false);
  });

  postgresIt("captures durable evidence records for approval responses in Postgres when DATABASE_URL is configured", async () => {
    const repository = createRepository({
      databaseUrl
    });

    await expectApprovalEvidenceCapture(repository, "approved");
    await expectApprovalEvidenceCapture(repository, "rejected");
  });

  postgresIt("rejects atomic approval follow-up jobs owned by a different user in Postgres when DATABASE_URL is configured", async () => {
    const repository = createRepository({
      databaseUrl
    });
    const ownerUserId = `approval-owner-postgres-${Date.now()}`;
    const mismatchedUserId = `approval-owner-mismatch-postgres-${Date.now()}`;
    const ownerActor = createSystemActorContext(ownerUserId);

    await repository.seedDefaults(ownerUserId);
    await repository.seedDefaults(mismatchedUserId);

    const bundle = await createGoalForUser(
      repository,
      ownerUserId,
      `Review my inbox and send one external reply for Postgres ownership ${Date.now()}.`
    );
    const approval = bundle.approvals[0];

    expect(approval).toBeDefined();

    await expect(
      repository.respondToApprovalAndEnqueueJob!({
        approvalId: approval!.id,
        decision: "approved",
        actor: ownerActor,
        scope: "once",
        rationale: "Approved for this exact reply.",
        buildJob: (updatedBundle) =>
          createJobRecord({
            userId: mismatchedUserId,
            kind: "approval_follow_up",
            actorContext: ownerActor,
            maxAttempts: 1,
            idempotencyKey: `approval-follow-up:${approval!.id}:owner-mismatch:approved`,
            payload: {
              type: "approval_follow_up",
              approvalId: approval!.id,
              goalId: updatedBundle.goal.id,
              taskId: approval!.taskId,
              decision: "approved",
              workspaceId: updatedBundle.goal.workspaceId,
              metadata: {
                replayedFromJobId: null,
                actionId: "owner-mismatch"
              }
            }
          })
      })
    ).rejects.toThrow(/job owner must match/i);

    const persistedBundle = await repository.getGoalBundleForUser(bundle.goal.id, ownerUserId);
    const ownerJobs = await repository.listJobs({ userId: ownerUserId, kinds: ["approval_follow_up"] });
    const mismatchedJobs = await repository.listJobs({ userId: mismatchedUserId, kinds: ["approval_follow_up"] });
    const evidenceRecords = await repository.listEvidenceRecords({
      userId: ownerUserId,
      approvalId: approval!.id
    });

    expect(persistedBundle?.approvals.find((candidate) => candidate.id === approval!.id)?.decision).toBe("pending");
    expect(ownerJobs).toEqual([]);
    expect(mismatchedJobs).toEqual([]);
    expect(evidenceRecords).toEqual([]);
  });

  postgresIt("persists agent actor attribution and enforces user scoping in Postgres when DATABASE_URL is configured", async () => {
    const repository = createRepository({
      databaseUrl
    });
    const secondaryUserId = "user-secondary";
    const createdAt = nowIso();
    const agentId = `agent-actor-${Date.now()}`;

    await repository.seedDefaults(SYSTEM_USER_ID);
    await repository.seedDefaults(secondaryUserId);

    const agent = await repository.saveAgent(
      AgentDefinitionSchema.parse({
        id: agentId,
        userId: SYSTEM_USER_ID,
        name: "private-ops-postgres",
        displayName: "Private Ops Postgres",
        description: "Handles private operational workflows.",
        icon: "ops",
        category: "custom",
        tags: ["ops"],
        systemPrompt: "Review operational signals and propose the next action plan.",
        promptVariables: [],
        artifactType: "summary",
        behaviorConfig: {
          temperature: 0.4,
          maxTokens: 1200,
          topP: 1,
          frequencyPenalty: 0,
          presencePenalty: 0,
          responseStyle: "balanced",
          formality: "professional"
        },
        allowedCapabilities: ["read", "search"],
        blockedCapabilities: [],
        maxRiskClass: "R2",
        integrationPermissions: [],
        memoryPermissions: [],
        actorContext: systemActor,
        isBuiltIn: false,
        parentAgentId: null,
        version: 1,
        status: "active",
        createdAt,
        updatedAt: createdAt
      })
    );

    const reloadedRepository = createRepository({
      databaseUrl
    });
    const visible = await reloadedRepository.getAgent(agent.id, SYSTEM_USER_ID);
    const hidden = await reloadedRepository.getAgent(agent.id, secondaryUserId);

    await reloadedRepository.deleteAgent(agent.id, secondaryUserId);
    const stillVisible = await reloadedRepository.getAgent(agent.id, SYSTEM_USER_ID);

    await reloadedRepository.deleteAgent(agent.id, SYSTEM_USER_ID);
    const deleted = await reloadedRepository.getAgent(agent.id, SYSTEM_USER_ID);

    expect(visible).toMatchObject({
      id: agent.id,
      actorContext: systemActor
    });
    expect(hidden).toBeNull();
    expect(stillVisible).toMatchObject({
      id: agent.id
    });
    expect(deleted).toBeNull();
  });

  postgresIt("deduplicates job idempotency keys and persists durable queue transitions in Postgres when DATABASE_URL is configured", async () => {
    const repository = createRepository({
      databaseUrl
    });
    const userId = `jobs-postgres-${Date.now()}`;
    const duplicateKey = `goal:${Date.now()}`;
    const first = await repository.enqueueJob(
      createGoalCreateJob({
        userId,
        request: "Persist the first durable job.",
        idempotencyKey: duplicateKey
      })
    );
    const duplicate = await repository.enqueueJob(
      createGoalCreateJob({
        userId,
        request: "Attempt the same durable job again.",
        idempotencyKey: ` ${duplicateKey} `
      })
    );

    expect(duplicate.id).toBe(first.id);
    expect(await repository.listJobs({ userId })).toHaveLength(1);

    await expectDurableQueueLifecycle(repository, `${userId}-queue`);
    await expectPriorityAndConcurrencyControls(repository, `${userId}-priority`);
  });

  postgresIt("reclaims expired job leases ahead of later work in Postgres when DATABASE_URL is configured", async () => {
    const repository = createRepository({
      databaseUrl
    });
    const userId = `jobs-postgres-lease-${Date.now()}`;
    const dueNow = await repository.enqueueJob(
      createGoalCreateJob({
        userId,
        request: "Process the earliest durable Postgres job.",
        availableAt: "2026-04-16T00:00:00.000Z"
      })
    );

    await repository.enqueueJob(
      createGoalCreateJob({
        userId,
        request: "Process the later durable Postgres job.",
        availableAt: "2026-04-16T00:01:00.000Z"
      })
    );

    const firstClaim = await repository.claimNextJob({
      userId,
      runnerId: "worker-a",
      leaseMs: 1_000,
      now: "2026-04-16T00:00:00.000Z"
    });
    const hiddenWhileLeased = await repository.claimNextJob({
      userId,
      runnerId: "worker-b",
      leaseMs: 1_000,
      now: "2026-04-16T00:00:00.500Z"
    });
    const reclaimed = await repository.claimNextJob({
      userId,
      runnerId: "worker-c",
      leaseMs: 1_000,
      now: "2026-04-16T00:01:30.000Z"
    });

    expect(firstClaim?.id).toBe(dueNow.id);
    expect(hiddenWhileLeased).toBeNull();
    expect(reclaimed).not.toBeNull();
    expect(reclaimed).toMatchObject({
      id: dueNow.id,
      claimedBy: "worker-c",
      attemptCount: 2
    });
  });

  postgresIt("bounds dashboard query count and recent slices in Postgres when DATABASE_URL is configured", async () => {
    const repository = createRepository({
      databaseUrl
    });
    const unique = Date.now();
    const timestamp = nowIso();

    await repository.seedDefaults(SYSTEM_USER_ID);

    const workspace = await repository.saveWorkspace(
      WorkspaceSchema.parse({
        id: `workspace-scale-postgres-${unique}`,
        ownerUserId: SYSTEM_USER_ID,
        slug: `scale-postgres-${unique}`,
        name: "Scale Postgres",
        description: "Workspace for dashboard scale validation.",
        isPersonal: false,
        createdAt: timestamp,
        updatedAt: timestamp
      }),
      systemActor
    );
    await repository.saveWorkspaceMember(
      WorkspaceMemberSchema.parse({
        id: `workspace-member-scale-postgres-${unique}`,
        workspaceId: workspace.id,
        userId: SYSTEM_USER_ID,
        role: "owner",
        joinedAt: timestamp,
        updatedAt: timestamp
      }),
      systemActor
    );
    await repository.saveWorkspaceSelection(
      WorkspaceSelectionSchema.parse({
        userId: SYSTEM_USER_ID,
        workspaceId: workspace.id,
        selectedAt: timestamp,
        updatedAt: timestamp
      })
    );
    const initialMemoryCount = (await repository.listMemory(SYSTEM_USER_ID)).length;
    const initialIntegrationCount = (await repository.listIntegrations(SYSTEM_USER_ID)).length;

    for (let index = 0; index < 41; index += 1) {
      await createGoalForUser(repository, SYSTEM_USER_ID, `Bounded dashboard goal ${unique}-${index}.`, workspace.id);
    }

    for (let index = 0; index < 25; index += 1) {
      await repository.saveAutopilotEvent(
        AutopilotEventSchema.parse({
          id: `autopilot-scale-postgres-${unique}-${index}`,
          userId: SYSTEM_USER_ID,
          kind: "watcher_triggered",
          sourceId: `calendar-scale-postgres-${index}`,
          idempotencyKey: null,
          mode: "notify_only",
          summary: `Watcher trigger ${index}`,
          status: "pending",
          details: { index },
          actorContext: systemActor,
          createdAt: nowIso(),
          processedAt: null,
          resultGoalId: null,
          error: null
        })
      );
      await repository.saveMemory(
        createMemoryRecord({
          userId: SYSTEM_USER_ID,
          category: "preferences",
          memoryType: "observed",
          content: `Scale memory ${unique}-${index}`,
          confidence: 0.75,
          source: "postgres-test",
          actorContext: systemActor
        })
      );
      await repository.upsertIntegration(
        IntegrationAccountSchema.parse({
          id: `integration-scale-postgres-${unique}-${index}`,
          userId: SYSTEM_USER_ID,
          name: `Scale Integration ${index}`,
          system: `system-${index}`,
          status: "ready",
          scopes: ["scope.read"],
          capabilities: ["read"],
          metadata: { index },
          actorContext: systemActor,
          createdAt: nowIso(),
          updatedAt: nowIso()
        })
      );
    }

    const { result: dashboard, queryCount } = await countPostgresQueries(repository, () =>
      repository.getDashboardData(SYSTEM_USER_ID)
    );

    expect(dashboard.activeWorkspace?.id).toBe(workspace.id);
    expect(dashboard.goals).toHaveLength(40);
    expect(dashboard.goals.every((bundle) => bundle.goal.workspaceId === workspace.id)).toBe(true);
    expect(dashboard.autopilotEvents).toHaveLength(8);
    expect(dashboard.memories).toHaveLength(Math.min(40, initialMemoryCount + 25));
    expect(dashboard.integrations).toHaveLength(Math.min(24, initialIntegrationCount + 25));
    // Workspace governance/member/privacy slices add a small constant number of
    // queries; the regression guard is that the total stays flat as goal count grows.
    expect(queryCount).toBeLessThanOrEqual(24);
  }, 60_000);

  postgresIt("upserts workspace members by workspace and user in Postgres when DATABASE_URL is configured", async () => {
    const repository = createRepository({
      databaseUrl
    });
    const unique = Date.now();
    const timestamp = nowIso();
    const collaboratorUserId = `workspace-collaborator-${unique}`;

    await repository.seedDefaults(SYSTEM_USER_ID);
    await repository.seedDefaults(collaboratorUserId);

    const workspace = await repository.saveWorkspace(
      WorkspaceSchema.parse({
        id: `workspace-member-upsert-${unique}`,
        ownerUserId: SYSTEM_USER_ID,
        slug: `member-upsert-${unique}`,
        name: "Workspace Member Upsert",
        description: "Ensures workspace membership is keyed by workspace and user.",
        isPersonal: false,
        createdAt: timestamp,
        updatedAt: timestamp
      }),
      systemActor
    );

    await repository.saveWorkspaceMember(
      WorkspaceMemberSchema.parse({
        id: `workspace-member-owner-${unique}`,
        workspaceId: workspace.id,
        userId: SYSTEM_USER_ID,
        role: "owner",
        joinedAt: timestamp,
        updatedAt: timestamp
      }),
      systemActor
    );

    await repository.saveWorkspaceMember(
      WorkspaceMemberSchema.parse({
        id: `workspace-member-collaborator-initial-${unique}`,
        workspaceId: workspace.id,
        userId: collaboratorUserId,
        role: "viewer",
        joinedAt: timestamp,
        updatedAt: timestamp
      }),
      systemActor
    );

    const updatedMember = await repository.saveWorkspaceMember(
      WorkspaceMemberSchema.parse({
        id: `workspace-member-collaborator-updated-${unique}`,
        workspaceId: workspace.id,
        userId: collaboratorUserId,
        role: "editor",
        joinedAt: timestamp,
        updatedAt: nowIso()
      }),
      systemActor
    );

    const members = await repository.listWorkspaceMembers(workspace.id, SYSTEM_USER_ID);
    const collaboratorMembers = members.filter((member) => member.userId === collaboratorUserId);

    expect(collaboratorMembers).toHaveLength(1);
    expect(collaboratorMembers[0]).toMatchObject({
      id: updatedMember.id,
      role: "editor"
    });
  });

  it("derives agent scorecards from persisted goal execution history", async () => {
    const tempDir = await mkdtemp(path.join(os.tmpdir(), "agentic-repo-"));
    const storePath = path.join(tempDir, "runtime-store.json");
    const repository = createRepository({
      storePath
    });

    await repository.seedDefaults(SYSTEM_USER_ID);

    const bundle = await createGoalForUser(repository, SYSTEM_USER_ID, "Review my inbox and send one external reply.");
    const startedAt = Date.now() - bundle.tasks.length * 60_000;

    await repository.saveGoalBundle({
      ...bundle,
      tasks: bundle.tasks.map((task, index) => ({
        ...task,
        assignedAgent: "communications",
        state: index === 0 ? "completed" : "failed",
        createdAt: new Date(startedAt + index * 1_000).toISOString(),
        updatedAt: new Date(startedAt + (index + 1) * 60_000).toISOString()
      })),
      approvals: bundle.approvals.map((approval, index) => ({
        ...approval,
        decision: index === 0 ? "approved" : "rejected"
      }))
    });

    const metrics = await repository.getAgentMetrics("communications", "all");

    expect(metrics).not.toBeNull();
    expect(metrics).toMatchObject({
      period: "all",
      tasksTotal: bundle.tasks.length,
      tasksCompleted: Math.min(bundle.tasks.length, 1),
      tasksFailed: Math.max(bundle.tasks.length - 1, 0),
      approvalsRequested: bundle.approvals.length,
      approvalsApproved: Math.min(bundle.approvals.length, 1),
      approvalsRejected: Math.max(bundle.approvals.length - 1, 0)
    });
    expect(metrics?.averageExecutionTimeMs).toBeGreaterThan(0);
    expect(metrics?.successRate).toBeGreaterThanOrEqual(0);
    expect(metrics?.successRate).toBeLessThanOrEqual(1);
    expect(metrics?.approvalRate).toBeGreaterThanOrEqual(0);
    expect(metrics?.approvalRate).toBeLessThanOrEqual(1);
  });

  it("feeds approval corrections and post-approval failures into derived agent scorecards", async () => {
    const tempDir = await mkdtemp(path.join(os.tmpdir(), "agentic-repo-"));
    const storePath = path.join(tempDir, "runtime-store.json");
    const repository = createRepository({
      storePath
    });

    await repository.seedDefaults(SYSTEM_USER_ID);

    const rejectedBundle = await createGoalForUser(repository, SYSTEM_USER_ID, "Review my inbox and send one external reply.");
    const rejectedApproval = rejectedBundle.approvals[0];
    const rejectedTask = rejectedBundle.tasks.find((task) => task.id === rejectedApproval?.taskId);

    expect(rejectedApproval).toBeDefined();
    expect(rejectedTask).toBeDefined();

    const rejectedAt = new Date(Date.now() - 2 * 60_000).toISOString();

    await repository.saveGoalBundle({
      ...rejectedBundle,
      tasks: rejectedBundle.tasks.map((task) => ({
        ...task,
        assignedAgent: "communications",
        state: task.id === rejectedTask!.id ? "blocked" : task.state,
        updatedAt: rejectedAt
      })),
      approvals: rejectedBundle.approvals.map((approval) => ({
        ...approval,
        decision: approval.id === rejectedApproval!.id ? "rejected" : approval.decision,
        decisionScope: approval.id === rejectedApproval!.id ? "once" : approval.decisionScope,
        decisionRationale:
          approval.id === rejectedApproval!.id ? "User rejected this external send and corrected the plan." : approval.decisionRationale,
        respondedAt: approval.id === rejectedApproval!.id ? rejectedAt : approval.respondedAt
      }))
    });

    await repository.saveEvidenceRecord({
      id: "evidence-scorecard-rejected",
      userId: SYSTEM_USER_ID,
      goalId: rejectedBundle.goal.id,
      taskId: rejectedTask!.id,
      approvalId: rejectedApproval!.id,
      sourceKind: "approval_response",
      sourceId: rejectedApproval!.id,
      sourceSummary: `Rejected "${rejectedApproval!.title}".`,
      riskClass: rejectedApproval!.riskClass,
      requestedAction: rejectedApproval!.requestedAction,
      requestRationale: rejectedApproval!.rationale,
      requiresApproval: true,
      decision: "rejected",
      decisionScope: "once",
      decisionRationale: "User rejected this external send and corrected the plan.",
      respondedAt: rejectedAt,
      resultingTaskState: "blocked",
      resultingGoalStatus: rejectedBundle.goal.status,
      actionLogIds: [],
      artifactIds: [],
      memoryIds: [],
      createdAt: rejectedAt,
      updatedAt: rejectedAt
    });

    const failedBundle = await createGoalForUser(repository, SYSTEM_USER_ID, "Review my inbox and send one external reply.");
    const failedApproval = failedBundle.approvals[0];
    const failedTask = failedBundle.tasks.find((task) => task.id === failedApproval?.taskId);

    expect(failedApproval).toBeDefined();
    expect(failedTask).toBeDefined();

    const failedAt = new Date(Date.now() - 60_000).toISOString();

    await repository.saveGoalBundle({
      ...failedBundle,
      tasks: failedBundle.tasks.map((task) => ({
        ...task,
        assignedAgent: "communications",
        state: task.id === failedTask!.id ? "failed" : task.state,
        updatedAt: failedAt
      })),
      approvals: failedBundle.approvals.map((approval) => ({
        ...approval,
        decision: approval.id === failedApproval!.id ? "approved" : approval.decision,
        decisionScope: approval.id === failedApproval!.id ? "similar_24h" : approval.decisionScope,
        decisionRationale:
          approval.id === failedApproval!.id ? "This send pattern is acceptable if execution remains reliable." : approval.decisionRationale,
        respondedAt: approval.id === failedApproval!.id ? failedAt : approval.respondedAt
      }))
    });

    await repository.saveEvidenceRecord({
      id: "evidence-scorecard-post-approval-failure",
      userId: SYSTEM_USER_ID,
      goalId: failedBundle.goal.id,
      taskId: failedTask!.id,
      approvalId: failedApproval!.id,
      sourceKind: "approval_response",
      sourceId: failedApproval!.id,
      sourceSummary: `Approved "${failedApproval!.title}".`,
      riskClass: failedApproval!.riskClass,
      requestedAction: failedApproval!.requestedAction,
      requestRationale: failedApproval!.rationale,
      requiresApproval: true,
      decision: "approved",
      decisionScope: "similar_24h",
      decisionRationale: "This send pattern is acceptable if execution remains reliable.",
      respondedAt: failedAt,
      resultingTaskState: "failed",
      resultingGoalStatus: failedBundle.goal.status,
      actionLogIds: [],
      artifactIds: [],
      memoryIds: [],
      createdAt: failedAt,
      updatedAt: failedAt
    });

    const metrics = await repository.getAgentMetrics("communications", "all");

    expect(metrics).not.toBeNull();
    expect(metrics).toMatchObject({
      feedbackCount: 2,
      userCorrectionCount: 1,
      postApprovalFailureCount: 1
    });
    expect(metrics?.correctionRate).toBeCloseTo(0.5, 5);
    expect(metrics?.postApprovalFailureRate).toBeCloseTo(1, 5);
  });

  it("seeds built-in operator products and persists the selected product", async () => {
    const tempDir = await mkdtemp(path.join(os.tmpdir(), "agentic-repo-"));
    const storePath = path.join(tempDir, "runtime-store.json");
    const repository = createRepository({
      storePath
    });

    await repository.seedDefaults(SYSTEM_USER_ID);

    const products = await repository.listOperatorProducts(SYSTEM_USER_ID);
    const selection = await repository.getOperatorProductSelection(SYSTEM_USER_ID);

    expect(products.some((product) => product.slug === "communications-operator")).toBe(true);
    expect(selection).not.toBeNull();
    expect(selection?.operatorProductId).toBe(products[0]?.id);

    const customProduct = {
      ...products[0],
      id: "operator-product-custom",
      slug: "custom-operator",
      name: "Custom Operator",
      isBuiltIn: false,
      createdAt: nowIso(),
      updatedAt: nowIso()
    };

    await repository.saveOperatorProduct(customProduct);
    await repository.saveOperatorProductSelection({
      userId: SYSTEM_USER_ID,
      operatorProductId: customProduct.id,
      actorContext: systemActor,
      selectedAt: nowIso(),
      updatedAt: nowIso()
    });

    const persistedSelection = await repository.getOperatorProductSelection(SYSTEM_USER_ID);

    expect(persistedSelection?.operatorProductId).toBe(customProduct.id);
    expect(persistedSelection?.actorContext).toEqual(systemActor);
  });

  it("rejects watchers that reference missing goals", async () => {
    const tempDir = await mkdtemp(path.join(os.tmpdir(), "agentic-repo-"));
    const storePath = path.join(tempDir, "runtime-store.json");
    const repository = createRepository({
      storePath
    });

    await repository.seedDefaults(SYSTEM_USER_ID);

    await expect(
      repository.saveWatcher(
        WatcherSchema.parse({
          id: "watcher-missing-goal",
          goalId: "goal-does-not-exist",
          targetEntity: "priority-inbox",
          condition: "urgent thread appears",
          frequency: "hourly",
          triggerAction: "notify me",
          sourceSystems: ["email"],
          status: "active",
          expiryAt: null,
          createdAt: nowIso(),
          updatedAt: nowIso()
        })
      )
    ).rejects.toThrow(/Goal goal-does-not-exist was not found/);
  });

  it("derives shared workspace watcher responsibility from the goal owner and workspace role", async () => {
    const tempDir = await mkdtemp(path.join(os.tmpdir(), "agentic-repo-"));
    const storePath = path.join(tempDir, "runtime-store.json");
    const repository = createRepository({
      storePath
    });
    const editorUserId = "user-editor";
    const timestamp = nowIso();

    await repository.seedDefaults(SYSTEM_USER_ID);
    await repository.seedDefaults(editorUserId);

    const sharedWorkspace = WorkspaceSchema.parse({
      id: "workspace-watcher-responsibility",
      ownerUserId: SYSTEM_USER_ID,
      slug: "watcher-responsibility",
      name: "Watcher Responsibility",
      description: "Shared watcher ownership should remain explicit.",
      isPersonal: false,
      createdAt: timestamp,
      updatedAt: timestamp
    });

    await repository.saveWorkspace(sharedWorkspace, systemActor);
    await repository.saveWorkspaceMember(
      WorkspaceMemberSchema.parse({
        id: "workspace-watcher-responsibility-owner",
        workspaceId: sharedWorkspace.id,
        userId: SYSTEM_USER_ID,
        role: "owner",
        joinedAt: timestamp,
        updatedAt: timestamp
      }),
      systemActor
    );
    await repository.saveWorkspaceMember(
      WorkspaceMemberSchema.parse({
        id: "workspace-watcher-responsibility-editor",
        workspaceId: sharedWorkspace.id,
        userId: editorUserId,
        role: "editor",
        joinedAt: timestamp,
        updatedAt: timestamp
      }),
      systemActor
    );

    const bundle = await createGoalForUser(
      repository,
      SYSTEM_USER_ID,
      "Watch the shared inbox for escalation risk.",
      sharedWorkspace.id
    );

    await repository.saveWatcher(
      WatcherSchema.parse({
        id: "watcher-shared-responsibility",
        goalId: bundle.goal.id,
        targetEntity: "shared-priority-inbox",
        condition: "an escalation appears",
        frequency: "hourly",
        triggerAction: "draft the next response",
        sourceSystems: ["email"],
        status: "active",
        expiryAt: null,
        actorContext: createHumanActorContext(editorUserId),
        createdAt: timestamp,
        updatedAt: timestamp
      })
    );

    const reloaded = await repository.getGoalBundleForUser(bundle.goal.id, editorUserId);
    const watcher = reloaded?.watchers.find((candidate) => candidate.id === "watcher-shared-responsibility");

    expect(watcher?.responsibility.owner.userId).toBe(SYSTEM_USER_ID);
    expect(watcher?.responsibility.delegate).toMatchObject({
      kind: "workspace_role",
      workspaceRole: "editor"
    });
    expect(watcher?.responsibility.reviewer).toMatchObject({
      kind: "workspace_role",
      workspaceRole: "owner"
    });
  });

  it("returns only watchers owned by the requested user", async () => {
    const tempDir = await mkdtemp(path.join(os.tmpdir(), "agentic-repo-"));
    const storePath = path.join(tempDir, "runtime-store.json");
    const repository = createRepository({
      storePath
    });
    const secondaryUserId = "user-secondary";

    await repository.seedDefaults(SYSTEM_USER_ID);
    await repository.seedDefaults(secondaryUserId);

    const primaryBundle = await createGoalForUser(repository, SYSTEM_USER_ID, "Protect my calendar planning workflow.");
    const secondaryBundle = await createGoalForUser(repository, secondaryUserId, "Track another user's inbox automation.");

    await repository.saveWatcher(
      WatcherSchema.parse({
        id: "watcher-primary",
        goalId: primaryBundle.goal.id,
        targetEntity: "calendar",
        condition: "focus time disappears",
        frequency: "hourly",
        triggerAction: "notify me",
        sourceSystems: ["calendar"],
        status: "active",
        expiryAt: null,
        actorContext: systemActor,
        createdAt: nowIso(),
        updatedAt: nowIso()
      })
    );

    await repository.saveWatcher(
      WatcherSchema.parse({
        id: "watcher-secondary",
        goalId: secondaryBundle.goal.id,
        targetEntity: "inbox",
        condition: "vip message arrives",
        frequency: "hourly",
        triggerAction: "draft reply",
        sourceSystems: ["email"],
        status: "active",
        expiryAt: null,
        actorContext: createSystemActorContext(secondaryUserId),
        createdAt: nowIso(),
        updatedAt: nowIso()
      })
    );

    const primaryWatchers = await repository.listWatchers({ userId: SYSTEM_USER_ID });
    const primaryDashboard = await repository.getDashboardData(SYSTEM_USER_ID);
    const unauthorizedGoalLookup = await repository.listWatchers({
      userId: SYSTEM_USER_ID,
      goalId: secondaryBundle.goal.id
    });

    expect(primaryWatchers.some((watcher) => watcher.id === "watcher-primary")).toBe(true);
    expect(primaryWatchers.every((watcher) => watcher.goalId === primaryBundle.goal.id)).toBe(true);
    expect(primaryWatchers[0]?.actorContext).toEqual(systemActor);
    expect(primaryWatchers.some((watcher) => watcher.id === "watcher-secondary")).toBe(false);
    expect(primaryDashboard.watchers.some((watcher) => watcher.id === "watcher-primary")).toBe(true);
    expect(primaryDashboard.watchers.every((watcher) => watcher.goalId === primaryBundle.goal.id)).toBe(true);
    expect(primaryDashboard.watchers[0]?.actorContext).toEqual(systemActor);
    expect(primaryDashboard.watchers.some((watcher) => watcher.id === "watcher-secondary")).toBe(false);
    expect(unauthorizedGoalLookup).toEqual([]);
  });

  it("returns null when loading a goal bundle owned by another user", async () => {
    const tempDir = await mkdtemp(path.join(os.tmpdir(), "agentic-repo-"));
    const storePath = path.join(tempDir, "runtime-store.json");
    const repository = createRepository({
      storePath
    });
    const secondaryUserId = "user-secondary";

    await repository.seedDefaults(SYSTEM_USER_ID);
    await repository.seedDefaults(secondaryUserId);

    const secondaryBundle = await createGoalForUser(repository, secondaryUserId, "Keep this planning workflow private.");

    const hiddenBundle = await repository.getGoalBundleForUser(secondaryBundle.goal.id, SYSTEM_USER_ID);
    const visibleBundle = await repository.getGoalBundleForUser(secondaryBundle.goal.id, secondaryUserId);

    expect(hiddenBundle).toBeNull();
    expect(visibleBundle?.goal.id).toBe(secondaryBundle.goal.id);
  });

  it("seeds a personal workspace and exposes it as the active dashboard scope", async () => {
    const tempDir = await mkdtemp(path.join(os.tmpdir(), "agentic-repo-"));
    const storePath = path.join(tempDir, "runtime-store.json");
    const repository = createRepository({
      storePath
    });

    await repository.seedDefaults(SYSTEM_USER_ID);

    const workspaces = await repository.listWorkspaces(SYSTEM_USER_ID);
    const selection = await repository.getWorkspaceSelection(SYSTEM_USER_ID);
    const dashboard = await repository.getDashboardData(SYSTEM_USER_ID);

    expect(workspaces).toHaveLength(1);
    expect(workspaces[0]).toMatchObject({
      ownerUserId: SYSTEM_USER_ID,
      isPersonal: true,
      name: "Personal Workspace"
    });
    expect(selection).toMatchObject({
      userId: SYSTEM_USER_ID,
      workspaceId: workspaces[0]?.id
    });
    expect(dashboard.activeWorkspace?.id).toBe(workspaces[0]?.id);
    expect(dashboard.workspaceMembers).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          workspaceId: workspaces[0]?.id,
          userId: SYSTEM_USER_ID,
          role: "owner"
        })
      ])
    );
    expect(dashboard.workspaceGovernance).toMatchObject({
      workspaceId: workspaces[0]?.id,
      approvalMode: "always_review",
      requireAuditExports: true,
      publicSharingEnabled: false,
      providerAccessRequiresApproval: true,
      escalationRequiresApproval: true,
      maxAutoRunRiskClass: "R1",
      externalSendRequiresApproval: true,
      calendarWriteRequiresApproval: true,
      retentionDays: 90,
      shadowReplayPolicy: expect.objectContaining({
        promotionMode: "shadow_only",
        rollbackOutcome: "downgrade_to_draft"
      })
    });
  });

  it("paginates goal bundles with stable cursors and rejects malformed cursors", async () => {
    const tempDir = await mkdtemp(path.join(os.tmpdir(), "agentic-repo-"));
    const storePath = path.join(tempDir, "runtime-store.json");
    const repository = createRepository({
      storePath
    });

    await repository.seedDefaults(SYSTEM_USER_ID);

    for (let index = 0; index < 6; index += 1) {
      await createGoalForUser(repository, SYSTEM_USER_ID, `Paged file goal ${Date.now()}-${index}.`);
    }

    const fullList = await repository.listGoals(SYSTEM_USER_ID);
    const firstPage = await repository.listGoalsPage({ userId: SYSTEM_USER_ID, limit: 3 });
    const secondPage = await repository.listGoalsPage({
      userId: SYSTEM_USER_ID,
      limit: 3,
      cursor: firstPage.nextCursor
    });

    expect(firstPage.items.map((bundle) => bundle.goal.id)).toEqual(fullList.slice(0, 3).map((bundle) => bundle.goal.id));
    expect(secondPage.items.map((bundle) => bundle.goal.id)).toEqual(fullList.slice(3, 6).map((bundle) => bundle.goal.id));
    expect(secondPage.items.some((bundle) => firstPage.items.some((prior) => prior.goal.id === bundle.goal.id))).toBe(false);
    expect(secondPage.nextCursor).toBeNull();

    await expect(repository.listGoalsPage({ userId: SYSTEM_USER_ID, cursor: "not-base64" })).rejects.toMatchObject({
      code: "invalid_cursor"
    });
  }, 10_000);

  it("bounds dashboard collections to the active workspace scope in the file-backed store", async () => {
    const tempDir = await mkdtemp(path.join(os.tmpdir(), "agentic-repo-"));
    const storePath = path.join(tempDir, "runtime-store.json");
    const repository = createRepository({
      storePath
    });
    const timestamp = nowIso();

    await repository.seedDefaults(SYSTEM_USER_ID);

    const workspace = await repository.saveWorkspace(
      WorkspaceSchema.parse({
        id: "workspace-scale-file",
        ownerUserId: SYSTEM_USER_ID,
        slug: "scale-file",
        name: "Scale File",
        description: "Workspace for bounded file-backed dashboard validation.",
        isPersonal: false,
        createdAt: timestamp,
        updatedAt: timestamp
      }),
      systemActor
    );
    await repository.saveWorkspaceMember(
      WorkspaceMemberSchema.parse({
        id: "workspace-member-scale-file",
        workspaceId: workspace.id,
        userId: SYSTEM_USER_ID,
        role: "owner",
        joinedAt: timestamp,
        updatedAt: timestamp
      }),
      systemActor
    );
    await repository.saveWorkspaceSelection(
      WorkspaceSelectionSchema.parse({
        userId: SYSTEM_USER_ID,
        workspaceId: workspace.id,
        selectedAt: timestamp,
        updatedAt: timestamp
      })
    );
    const initialMemoryCount = (await repository.listMemory(SYSTEM_USER_ID)).length;
    const initialIntegrationCount = (await repository.listIntegrations(SYSTEM_USER_ID)).length;

    for (let index = 0; index < 41; index += 1) {
      await createGoalForUser(repository, SYSTEM_USER_ID, `Bounded file goal ${Date.now()}-${index}.`, workspace.id);
    }

    for (let index = 0; index < 25; index += 1) {
      await repository.saveAutopilotEvent(
        AutopilotEventSchema.parse({
          id: `autopilot-scale-file-${index}`,
          userId: SYSTEM_USER_ID,
          kind: "watcher_triggered",
          sourceId: `calendar-scale-file-${index}`,
          idempotencyKey: null,
          mode: "notify_only",
          summary: `Watcher trigger ${index}`,
          status: "pending",
          details: { index },
          actorContext: systemActor,
          createdAt: nowIso(),
          processedAt: null,
          resultGoalId: null,
          error: null
        })
      );
      await repository.saveMemory(
        createMemoryRecord({
          userId: SYSTEM_USER_ID,
          category: "preferences",
          memoryType: "observed",
          content: `Scale file memory ${index}`,
          confidence: 0.8,
          source: "file-test",
          actorContext: systemActor
        })
      );
      await repository.upsertIntegration(
        IntegrationAccountSchema.parse({
          id: `integration-scale-file-${index}`,
          userId: SYSTEM_USER_ID,
          name: `Scale File Integration ${index}`,
          system: `scale-file-system-${index}`,
          status: "ready",
          scopes: ["scope.read"],
          capabilities: ["read"],
          metadata: { index },
          actorContext: systemActor,
          createdAt: nowIso(),
          updatedAt: nowIso()
        })
      );
    }

    for (let index = 0; index < 2; index += 1) {
      await createGoalForUser(repository, SYSTEM_USER_ID, `Out-of-scope goal ${Date.now()}-${index}.`);
    }

    const dashboard = await repository.getDashboardData(SYSTEM_USER_ID);

    expect(dashboard.activeWorkspace?.id).toBe(workspace.id);
    expect(dashboard.goals).toHaveLength(40);
    expect(dashboard.goals.every((bundle) => bundle.goal.workspaceId === workspace.id)).toBe(true);
    expect(dashboard.autopilotEvents).toHaveLength(8);
    expect(dashboard.memories).toHaveLength(Math.min(40, initialMemoryCount + 25));
    expect(dashboard.integrations).toHaveLength(Math.min(24, initialIntegrationCount + 25));
  }, 45_000);

  it("shares workspace-scoped goals with workspace members and isolates inactive workspaces", async () => {
    const tempDir = await mkdtemp(path.join(os.tmpdir(), "agentic-repo-"));
    const storePath = path.join(tempDir, "runtime-store.json");
    const repository = createRepository({
      storePath
    });
    const collaboratorUserId = "user-collaborator";
    const timestamp = nowIso();

    await repository.seedDefaults(SYSTEM_USER_ID);
    await repository.seedDefaults(collaboratorUserId);

    const sharedWorkspace = WorkspaceSchema.parse({
      id: "workspace-shared-team",
      ownerUserId: SYSTEM_USER_ID,
      slug: "shared-team",
      name: "Shared Team",
      description: "Shared execution surface for collaborators.",
      isPersonal: false,
      createdAt: timestamp,
      updatedAt: timestamp
    });

    await repository.saveWorkspace(sharedWorkspace, systemActor);
    await repository.saveWorkspaceMember(
      WorkspaceMemberSchema.parse({
        id: "workspace-member-owner",
        workspaceId: sharedWorkspace.id,
        userId: SYSTEM_USER_ID,
        role: "owner",
        joinedAt: timestamp,
        updatedAt: timestamp
      }),
      systemActor
    );
    await repository.saveWorkspaceMember(
      WorkspaceMemberSchema.parse({
        id: "workspace-member-collaborator",
        workspaceId: sharedWorkspace.id,
        userId: collaboratorUserId,
        role: "editor",
        joinedAt: timestamp,
        updatedAt: timestamp
      }),
      systemActor
    );
    await repository.saveWorkspaceGovernance(
      WorkspaceGovernanceSchema.parse({
        workspaceId: sharedWorkspace.id,
        approvalMode: "always_review",
        requireAuditExports: true,
        maxAutoRunRiskClass: "R1",
        externalSendRequiresApproval: true,
        calendarWriteRequiresApproval: true,
        retentionDays: 180,
        updatedBy: SYSTEM_USER_ID,
        createdAt: timestamp,
        updatedAt: timestamp
      }),
      systemActor
    );
    await repository.saveWorkspaceSelection(
      WorkspaceSelectionSchema.parse({
        userId: SYSTEM_USER_ID,
        workspaceId: sharedWorkspace.id,
        selectedAt: timestamp,
        updatedAt: timestamp
      })
    );
    await repository.saveWorkspaceSelection(
      WorkspaceSelectionSchema.parse({
        userId: collaboratorUserId,
        workspaceId: sharedWorkspace.id,
        selectedAt: timestamp,
        updatedAt: timestamp
      })
    );

    const sharedBundle = await createGoalForUser(
      repository,
      SYSTEM_USER_ID,
      "Coordinate a shared launch checklist with the team.",
      sharedWorkspace.id
    );
    const privateBundle = await createGoalForUser(
      repository,
      SYSTEM_USER_ID,
      "Keep a personal planning note private."
    );

    const collaboratorDashboard = await repository.getDashboardData(collaboratorUserId);
    const collaboratorSharedGoal = await repository.getGoalBundleForUser(sharedBundle.goal.id, collaboratorUserId);
    const collaboratorPrivateGoal = await repository.getGoalBundleForUser(privateBundle.goal.id, collaboratorUserId);
    const sharedJob = await repository.enqueueJob(
      createJobRecord({
        userId: SYSTEM_USER_ID,
        kind: "goal_refine",
        actorContext: systemActor,
        payload: {
          type: "goal_refine",
          goalId: sharedBundle.goal.id,
          workflowId: sharedBundle.workflow.id,
          refinement: "Add the shared operator recovery path.",
          workspaceId: sharedWorkspace.id,
          metadata: {}
        }
      })
    );
    const privateJob = await repository.enqueueJob(
      createJobRecord({
        userId: SYSTEM_USER_ID,
        kind: "goal_refine",
        actorContext: systemActor,
        payload: {
          type: "goal_refine",
          goalId: privateBundle.goal.id,
          workflowId: privateBundle.workflow.id,
          refinement: "Keep this personal workflow private.",
          workspaceId: privateBundle.goal.workspaceId,
          metadata: {}
        }
      })
    );
    const collaboratorVisibleJobs = await repository.listJobs({ userId: collaboratorUserId });

    expect(collaboratorDashboard.activeWorkspace?.id).toBe(sharedWorkspace.id);
    expect(collaboratorDashboard.goals.map((bundle) => bundle.goal.id)).toContain(sharedBundle.goal.id);
    expect(collaboratorDashboard.goals.map((bundle) => bundle.goal.id)).not.toContain(privateBundle.goal.id);
    expect(collaboratorSharedGoal?.goal.workspaceId).toBe(sharedWorkspace.id);
    expect(collaboratorPrivateGoal).toBeNull();
    expect(collaboratorVisibleJobs.map((job) => job.id)).toContain(sharedJob.id);
    expect(collaboratorVisibleJobs.map((job) => job.id)).not.toContain(privateJob.id);
    await expect(repository.getJob(sharedJob.id, collaboratorUserId)).resolves.toMatchObject({
      id: sharedJob.id,
      payload: {
        type: "goal_refine",
        goalId: sharedBundle.goal.id
      }
    });
    await expect(repository.getJob(privateJob.id, collaboratorUserId)).resolves.toBeNull();

    await repository.saveWorkspaceSelection(
      WorkspaceSelectionSchema.parse({
        userId: collaboratorUserId,
        workspaceId: collaboratorDashboard.workspaces.find((workspace) => workspace.isPersonal)?.id,
        selectedAt: nowIso(),
        updatedAt: nowIso()
      })
    );

    const personalDashboard = await repository.getDashboardData(collaboratorUserId);
    expect(personalDashboard.activeWorkspace?.isPersonal).toBe(true);
    expect(personalDashboard.goals.some((bundle) => bundle.goal.id === sharedBundle.goal.id)).toBe(false);
  }, 15_000);

  it("derives commitments from active goals and pending approvals", async () => {
    const tempDir = await mkdtemp(path.join(os.tmpdir(), "agentic-repo-"));
    const storePath = path.join(tempDir, "runtime-store.json");
    const repository = createRepository({
      storePath
    });

    await repository.seedDefaults(SYSTEM_USER_ID);

    const bundle = await createGoalForUser(repository, SYSTEM_USER_ID, "Review my inbox and send one external reply.");
    const dashboard = await repository.getDashboardData(SYSTEM_USER_ID);
    const goalCommitment = dashboard.commitments.find((commitment) => commitment.sourceKind === "goal");
    const approvalCommitment = dashboard.commitments.find((commitment) => commitment.sourceKind === "approval");

    expect(goalCommitment).toMatchObject({
      id: `commitment-goal-${bundle.goal.id}`,
      goalId: bundle.goal.id,
      sourceId: bundle.goal.id,
      status: "needs-review",
      urgency: "immediate",
      riskClass: bundle.approvals[0]?.riskClass,
      provenanceSummary: expect.stringContaining("pending approval"),
      suggestedNextAction: {
        kind: "review_approval",
        section: "approvals",
        itemId: bundle.approvals[0]?.id
      }
    });
    expect(goalCommitment?.summary).toContain("approval");
    expect(goalCommitment?.evidence).toEqual([
      {
        section: "goals",
        itemId: bundle.goal.id,
        label: bundle.goal.title
      }
    ]);

    expect(approvalCommitment).toMatchObject({
      id: `commitment-approval-${bundle.approvals[0]?.id}`,
      approvalId: bundle.approvals[0]?.id,
      goalId: bundle.goal.id,
      status: "needs-review",
      urgency: "immediate",
      riskClass: bundle.approvals[0]?.riskClass,
      provenanceSummary: expect.stringContaining("pending approval"),
      suggestedNextAction: {
        kind: "review_approval",
        section: "approvals",
        itemId: bundle.approvals[0]?.id
      }
    });
    expect(approvalCommitment?.summary).toContain(bundle.goal.title);
    expect(approvalCommitment?.evidence).toEqual(
      expect.arrayContaining([
        {
          section: "approvals",
          itemId: bundle.approvals[0]?.id,
          label: bundle.approvals[0]?.title
        },
        {
          section: "goals",
          itemId: bundle.goal.id,
          label: bundle.goal.title
        }
      ])
    );
  });

  it("preserves persisted commitment overrides until the user reopens them", async () => {
    const tempDir = await mkdtemp(path.join(os.tmpdir(), "agentic-repo-"));
    const storePath = path.join(tempDir, "runtime-store.json");
    const repository = createRepository({
      storePath
    });

    await repository.seedDefaults(SYSTEM_USER_ID);

    const bundle = await createGoalForUser(repository, SYSTEM_USER_ID, "Review my inbox and send one external reply.");
    const initialDashboard = await repository.getDashboardData(SYSTEM_USER_ID);
    const goalCommitment = initialDashboard.commitments.find((commitment) => commitment.sourceKind === "goal");

    expect(goalCommitment).toBeDefined();

    await repository.saveCommitment({
      ...goalCommitment!,
      status: "completed",
      updatedAt: nowIso()
    });

    const completedDashboard = await repository.getDashboardData(SYSTEM_USER_ID);
    expect(
      completedDashboard.commitments.find((commitment) => commitment.id === goalCommitment?.id)?.status
    ).toBe("completed");

    await repository.deleteCommitment(goalCommitment!.id, SYSTEM_USER_ID);

    const reopenedDashboard = await repository.getDashboardData(SYSTEM_USER_ID);
    expect(
      reopenedDashboard.commitments.find((commitment) => commitment.id === goalCommitment?.id)?.status
    ).toBe("needs-review");
    expect(reopenedDashboard.commitments.find((commitment) => commitment.id === goalCommitment?.id)?.sourceId).toBe(
      bundle.goal.id
    );
  }, 15_000);

  it("builds a bounded commitments inbox with server-side buckets and persisted-only items", async () => {
    const tempDir = await mkdtemp(path.join(os.tmpdir(), "agentic-repo-"));
    const storePath = path.join(tempDir, "runtime-store.json");
    const repository = createRepository({
      storePath
    });

    await repository.seedDefaults(SYSTEM_USER_ID);

    await createGoalForUser(repository, SYSTEM_USER_ID, "Review my inbox and send one external reply.");
    await repository.saveCommitment({
      id: "commitment-manual-low-confidence",
      userId: SYSTEM_USER_ID,
      title: "Follow up on a fuzzy obligation",
      summary: "Persisted-only commitment for bucket coverage",
      status: "pending",
      sourceKind: "goal",
      sourceId: "manual-low-confidence",
      goalId: null,
      approvalId: null,
      dueAt: null,
      confidence: 0.42,
      evidence: [
        {
          section: "goals",
          itemId: "manual-low-confidence",
          label: "Follow up on a fuzzy obligation"
        }
      ],
      createdAt: nowIso(),
      updatedAt: nowIso()
    });
    await repository.saveCommitment({
      id: "commitment-manual-waiting",
      userId: SYSTEM_USER_ID,
      title: "Waiting on a vendor response",
      summary: "Persisted-only waiting commitment",
      status: "blocked",
      sourceKind: "goal",
      sourceId: "manual-waiting",
      goalId: null,
      approvalId: null,
      dueAt: null,
      confidence: 0.88,
      evidence: [
        {
          section: "goals",
          itemId: "manual-waiting",
          label: "Waiting on a vendor response"
        }
      ],
      createdAt: nowIso(),
      updatedAt: nowIso()
    });
    await repository.saveCommitment({
      id: "commitment-manual-completed",
      userId: SYSTEM_USER_ID,
      title: "Already done",
      summary: "Persisted-only completed commitment",
      status: "completed",
      sourceKind: "goal",
      sourceId: "manual-completed",
      goalId: null,
      approvalId: null,
      dueAt: null,
      confidence: 0.99,
      evidence: [
        {
          section: "goals",
          itemId: "manual-completed",
          label: "Already done"
        }
      ],
      createdAt: nowIso(),
      updatedAt: nowIso()
    });

    const firstPage = await repository.listCommitmentInbox({
      userId: SYSTEM_USER_ID,
      bucket: "unresolved",
      limit: 1
    });
    const secondPage = await repository.listCommitmentInbox({
      userId: SYSTEM_USER_ID,
      bucket: "unresolved",
      limit: 1,
      cursor: firstPage.nextCursor
    });
    const lowConfidence = await repository.listCommitmentInbox({
      userId: SYSTEM_USER_ID,
      bucket: "low_confidence",
      limit: 5
    });
    const waiting = await repository.listCommitmentInbox({
      userId: SYSTEM_USER_ID,
      bucket: "waiting_on_others",
      limit: 5
    });
    const completed = await repository.listCommitmentInbox({
      userId: SYSTEM_USER_ID,
      bucket: "completed",
      limit: 5
    });

    expect(firstPage.bucket).toBe("unresolved");
    expect(firstPage.items).toHaveLength(1);
    expect(firstPage.totalCount).toBe(3);
    expect(firstPage.counts.urgent).toBe(2);
    expect(firstPage.counts.low_confidence).toBe(2);
    expect(firstPage.counts.waiting_on_others).toBe(1);
    expect(firstPage.counts.completed).toBe(1);
    expect(firstPage.nextCursor).toBeTruthy();

    expect(secondPage.items).toHaveLength(1);
    expect(secondPage.items[0]?.id).not.toBe(firstPage.items[0]?.id);
    expect(lowConfidence.totalCount).toBe(2);
    expect(lowConfidence.items.map((item) => item.id)).toEqual(
      expect.arrayContaining(["commitment-manual-low-confidence"])
    );
    expect(waiting.items.map((item) => item.id)).toEqual(["commitment-manual-waiting"]);
    expect(completed.items.map((item) => item.id)).toEqual(["commitment-manual-completed"]);
  });

  it("rejects malformed commitment inbox cursors", async () => {
    const tempDir = await mkdtemp(path.join(os.tmpdir(), "agentic-repo-"));
    const storePath = path.join(tempDir, "runtime-store.json");
    const repository = createRepository({
      storePath
    });

    await repository.seedDefaults(SYSTEM_USER_ID);

    await expect(
      repository.listCommitmentInbox({
        userId: SYSTEM_USER_ID,
        bucket: "all",
        cursor: "not-a-valid-cursor"
      })
    ).rejects.toThrow(/cursor is invalid/i);
  });

  it("round-trips autopilot settings through the repository", async () => {
    const tempDir = await mkdtemp(path.join(os.tmpdir(), "agentic-repo-"));
    const storePath = path.join(tempDir, "runtime-store.json");
    const repository = createRepository({
      storePath
    });

    await repository.seedDefaults(SYSTEM_USER_ID);

    const defaults = await repository.getAutopilotSettings(SYSTEM_USER_ID);
    expect(defaults).toMatchObject({
      userId: SYSTEM_USER_ID,
      mode: "notify_only",
      debounceMinutes: 15,
      reliabilityControls: DEFAULT_AUTOPILOT_RELIABILITY_CONTROLS
    });

    const updated = await repository.saveAutopilotSettings({
      ...defaults,
      mode: "auto_run",
      debounceMinutes: 45,
      reliabilityControls: {
        budgetWindowMinutes: 30,
        maxEventsPerWindow: 8,
        maxPendingEvents: 2,
        maxConsecutiveFailures: 3
      },
      actorContext: systemActor,
      updatedAt: nowIso()
    });

    const reloaded = await repository.getAutopilotSettings(SYSTEM_USER_ID);
    const dashboard = await repository.getDashboardData(SYSTEM_USER_ID);

    expect(updated).toMatchObject({
      mode: "auto_run",
      debounceMinutes: 45,
      reliabilityControls: {
        budgetWindowMinutes: 30,
        maxEventsPerWindow: 8,
        maxPendingEvents: 2,
        maxConsecutiveFailures: 3
      },
      actorContext: systemActor
    });
    expect(reloaded).toMatchObject({
      mode: "auto_run",
      debounceMinutes: 45,
      reliabilityControls: {
        budgetWindowMinutes: 30,
        maxEventsPerWindow: 8,
        maxPendingEvents: 2,
        maxConsecutiveFailures: 3
      },
      actorContext: systemActor
    });
    expect(dashboard.autopilotSettings).toMatchObject({
      mode: "auto_run",
      debounceMinutes: 45,
      reliabilityControls: {
        budgetWindowMinutes: 30,
        maxEventsPerWindow: 8,
        maxPendingEvents: 2,
        maxConsecutiveFailures: 3
      },
      actorContext: systemActor
    });
  });

  it("claims autopilot events once and then returns duplicate and debounced outcomes deterministically", async () => {
    const tempDir = await mkdtemp(path.join(os.tmpdir(), "agentic-repo-"));
    const storePath = path.join(tempDir, "runtime-store.json");
    const repository = createRepository({
      storePath
    });

    await repository.seedDefaults(SYSTEM_USER_ID);

    const firstClaim = await repository.claimAutopilotEvent({
      userId: SYSTEM_USER_ID,
      kind: "watcher_triggered",
      sourceId: "watcher-vip-thread",
      idempotencyKey: "watcher-vip-thread-1",
      mode: "draft_goal",
      summary: "Watcher triggered for a VIP thread",
      details: {
        eventEnvelope: {
          family: "watcher",
          trigger: "watcher_triggered",
          priority: "high",
          tags: ["vip", "inbox"],
          correlationKey: "watcher:vip-thread"
        },
        watcherId: "watcher-vip-thread"
      },
      actorContext: systemActor,
      debounceMinutes: 15,
      reliabilityControls: DEFAULT_AUTOPILOT_RELIABILITY_CONTROLS
    });

    const duplicateClaim = await repository.claimAutopilotEvent({
      userId: SYSTEM_USER_ID,
      kind: "watcher_triggered",
      sourceId: "watcher-vip-thread",
      idempotencyKey: "watcher-vip-thread-1",
      mode: "draft_goal",
      summary: "Watcher triggered for a VIP thread",
      actorContext: systemActor,
      debounceMinutes: 15,
      reliabilityControls: DEFAULT_AUTOPILOT_RELIABILITY_CONTROLS
    });

    const debouncedClaim = await repository.claimAutopilotEvent({
      userId: SYSTEM_USER_ID,
      kind: "watcher_triggered",
      sourceId: "watcher-vip-thread",
      mode: "draft_goal",
      summary: "Watcher triggered again for the same source",
      actorContext: systemActor,
      debounceMinutes: 15,
      reliabilityControls: DEFAULT_AUTOPILOT_RELIABILITY_CONTROLS
    });

    const events = await repository.listAutopilotEvents(SYSTEM_USER_ID);

    expect(firstClaim.outcome).toBe("claimed");
    expect(firstClaim.event).toMatchObject({
      kind: "watcher_triggered",
      sourceId: "watcher-vip-thread",
      status: "pending",
      mode: "draft_goal",
      idempotencyKey: "watcher-vip-thread-1",
      actorContext: systemActor
    });
    expect(firstClaim.event.details).toMatchObject({
      eventEnvelope: {
        family: "watcher",
        trigger: "watcher_triggered",
        priority: "high",
        tags: ["vip", "inbox"],
        correlationKey: "watcher:vip-thread"
      },
      suppression: {
        outcome: "allowed"
      },
      watcherId: "watcher-vip-thread"
    });

    expect(duplicateClaim).toMatchObject({
      outcome: "duplicate",
      event: {
        id: firstClaim.event.id,
        status: "pending"
      }
    });

    expect(debouncedClaim.outcome).toBe("debounced");
    expect(debouncedClaim.event).toMatchObject({
      kind: "watcher_triggered",
      sourceId: "watcher-vip-thread",
      status: "debounced",
      mode: "draft_goal",
      actorContext: systemActor
    });
    expect(debouncedClaim.event.details).toMatchObject({
      debouncedByEventId: firstClaim.event.id,
      suppression: {
        outcome: "debounced",
        relatedEventId: firstClaim.event.id
      }
    });
    expect(debouncedClaim.event.processedAt).toBeTruthy();

    expect(events).toHaveLength(2);
    expect(events.map((event) => event.status).sort()).toEqual(["debounced", "pending"]);
    expect(events.every((event) => event.actorContext?.subjectUserId === systemActor.subjectUserId)).toBe(true);
  });

  it("suppresses autopilot events when a per-source event budget is exhausted", async () => {
    const tempDir = await mkdtemp(path.join(os.tmpdir(), "agentic-repo-"));
    const storePath = path.join(tempDir, "runtime-store.json");
    const repository = createRepository({
      storePath
    });

    await repository.seedDefaults(SYSTEM_USER_ID);

    const budget = {
      key: "watcher:vip-inbox",
      windowMinutes: 60,
      maxEvents: 1,
      scope: "source" as const
    };

    const firstClaim = await repository.claimAutopilotEvent({
      userId: SYSTEM_USER_ID,
      kind: "watcher_triggered",
      sourceId: "watcher-vip-budget",
      idempotencyKey: "watcher-vip-budget-1",
      mode: "draft_goal",
      summary: "Watcher triggered for a VIP inbox budget test",
      details: {
        eventEnvelope: {
          family: "watcher",
          trigger: "watcher_triggered",
          priority: "high",
          tags: ["vip"],
          correlationKey: "watcher:vip-budget"
        },
        budget,
        watcherId: "watcher-vip-budget"
      },
      actorContext: systemActor,
      debounceMinutes: 15
    });

    const secondClaim = await repository.claimAutopilotEvent({
      userId: SYSTEM_USER_ID,
      kind: "watcher_triggered",
      sourceId: "watcher-vip-budget",
      idempotencyKey: "watcher-vip-budget-2",
      mode: "draft_goal",
      summary: "Watcher triggered again inside the active budget window",
      details: {
        eventEnvelope: {
          family: "watcher",
          trigger: "watcher_triggered",
          priority: "critical",
          tags: ["vip"],
          correlationKey: "watcher:vip-budget"
        },
        budget,
        watcherId: "watcher-vip-budget"
      },
      actorContext: systemActor,
      debounceMinutes: 15
    });

    const events = await repository.listAutopilotEvents(SYSTEM_USER_ID);

    expect(firstClaim.outcome).toBe("claimed");
    expect(secondClaim.outcome).toBe("ignored");
    expect(secondClaim.event).toMatchObject({
      status: "ignored",
      sourceId: "watcher-vip-budget"
    });
    expect(secondClaim.event.processedAt).toBeTruthy();
    expect(secondClaim.event.details).toMatchObject({
      budget,
      suppression: {
        outcome: "budget_exhausted",
        budgetKey: budget.key,
        observedCount: 1
      }
    });
    expect(events.map((event) => event.status).sort()).toEqual(["ignored", "pending"]);
  });

  it("suppresses new autopilot events when the pending backlog crosses the configured threshold", async () => {
    const tempDir = await mkdtemp(path.join(os.tmpdir(), "agentic-repo-"));
    const storePath = path.join(tempDir, "runtime-store.json");
    const repository = createRepository({
      storePath
    });

    await repository.seedDefaults(SYSTEM_USER_ID);

    const firstClaim = await repository.claimAutopilotEvent({
      userId: SYSTEM_USER_ID,
      kind: "watcher_triggered",
      sourceId: "watcher-backlog-1",
      mode: "draft_goal",
      summary: "First pending watcher signal.",
      actorContext: systemActor,
      debounceMinutes: 15,
      reliabilityControls: {
        budgetWindowMinutes: 60,
        maxEventsPerWindow: 12,
        maxPendingEvents: 1,
        maxConsecutiveFailures: 2
      }
    });
    const secondClaim = await repository.claimAutopilotEvent({
      userId: SYSTEM_USER_ID,
      kind: "watcher_triggered",
      sourceId: "watcher-backlog-2",
      mode: "draft_goal",
      summary: "Second watcher signal should be suppressed until backlog clears.",
      actorContext: systemActor,
      debounceMinutes: 15,
      reliabilityControls: {
        budgetWindowMinutes: 60,
        maxEventsPerWindow: 12,
        maxPendingEvents: 1,
        maxConsecutiveFailures: 2
      }
    });

    const events = await repository.listAutopilotEvents(SYSTEM_USER_ID);

    expect(firstClaim.outcome).toBe("claimed");
    expect(secondClaim.outcome).toBe("suppressed");
    expect(secondClaim.event.status).toBe("ignored");
    expect(secondClaim.event.details).toMatchObject({
      suppression: {
        reason: "pending_backlog",
        pendingEventCount: 1,
        maxPendingEvents: 1
      }
    });
    expect(events.map((event) => event.status).sort()).toEqual(["ignored", "pending"]);
  });

  it("suppresses new autopilot events when the event budget for the active window is exhausted", async () => {
    const tempDir = await mkdtemp(path.join(os.tmpdir(), "agentic-repo-"));
    const storePath = path.join(tempDir, "runtime-store.json");
    const repository = createRepository({
      storePath
    });

    await repository.seedDefaults(SYSTEM_USER_ID);

    for (const sourceId of ["watcher-budget-1", "watcher-budget-2"]) {
      const claim = await repository.claimAutopilotEvent({
        userId: SYSTEM_USER_ID,
        kind: "watcher_triggered",
        sourceId,
        mode: "draft_goal",
        summary: `Budgeted event for ${sourceId}.`,
        actorContext: systemActor,
        debounceMinutes: 15,
        reliabilityControls: {
          budgetWindowMinutes: 60,
          maxEventsPerWindow: 2,
          maxPendingEvents: 5,
          maxConsecutiveFailures: 2
        }
      });

      expect(claim.outcome).toBe("claimed");
    }

    const suppressedClaim = await repository.claimAutopilotEvent({
      userId: SYSTEM_USER_ID,
      kind: "watcher_triggered",
      sourceId: "watcher-budget-3",
      mode: "draft_goal",
      summary: "Third event should be budget-suppressed.",
      actorContext: systemActor,
      debounceMinutes: 15,
      reliabilityControls: {
        budgetWindowMinutes: 60,
        maxEventsPerWindow: 2,
        maxPendingEvents: 5,
        maxConsecutiveFailures: 2
      }
    });

    expect(suppressedClaim.outcome).toBe("suppressed");
    expect(suppressedClaim.event.status).toBe("ignored");
    expect(suppressedClaim.event.details).toMatchObject({
      suppression: {
        reason: "event_budget_exceeded",
        recentBudgetedEventCount: 2,
        maxEventsPerWindow: 2
      }
    });
  });

  it("opens a failure circuit and suppresses new autopilot events after consecutive failures", async () => {
    const tempDir = await mkdtemp(path.join(os.tmpdir(), "agentic-repo-"));
    const storePath = path.join(tempDir, "runtime-store.json");
    const repository = createRepository({
      storePath
    });

    await repository.seedDefaults(SYSTEM_USER_ID);

    await repository.saveAutopilotEvent(
      AutopilotEventSchema.parse({
        id: "autopilot-failure-1",
        userId: SYSTEM_USER_ID,
        kind: "watcher_triggered",
        sourceId: "watcher-failure-circuit-1",
        idempotencyKey: null,
        mode: "draft_goal",
        summary: "First failed event",
        status: "failed",
        details: {},
        actorContext: systemActor,
        createdAt: new Date(Date.now() - 5 * 60 * 1000).toISOString(),
        processedAt: new Date(Date.now() - 5 * 60 * 1000).toISOString(),
        resultGoalId: null,
        error: "Autopilot execution failed."
      })
    );
    await repository.saveAutopilotEvent(
      AutopilotEventSchema.parse({
        id: "autopilot-failure-2",
        userId: SYSTEM_USER_ID,
        kind: "watcher_triggered",
        sourceId: "watcher-failure-circuit-2",
        idempotencyKey: null,
        mode: "draft_goal",
        summary: "Second failed event",
        status: "failed",
        details: {},
        actorContext: systemActor,
        createdAt: new Date(Date.now() - 2 * 60 * 1000).toISOString(),
        processedAt: new Date(Date.now() - 2 * 60 * 1000).toISOString(),
        resultGoalId: null,
        error: "Autopilot execution failed."
      })
    );

    const suppressedClaim = await repository.claimAutopilotEvent({
      userId: SYSTEM_USER_ID,
      kind: "watcher_triggered",
      sourceId: "watcher-failure-circuit-3",
      mode: "draft_goal",
      summary: "New events should stay suppressed while the failure circuit is open.",
      actorContext: systemActor,
      debounceMinutes: 15,
      reliabilityControls: {
        budgetWindowMinutes: 60,
        maxEventsPerWindow: 12,
        maxPendingEvents: 5,
        maxConsecutiveFailures: 2
      }
    });

    expect(suppressedClaim.outcome).toBe("suppressed");
    expect(suppressedClaim.event.status).toBe("ignored");
    expect(suppressedClaim.event.details).toMatchObject({
      suppression: {
        reason: "failure_circuit_open",
        consecutiveFailureCount: 2,
        maxConsecutiveFailures: 2
      }
    });
  });

  it("derives dashboard diagnostics for expired approvals, stale memories, stuck workflows, and orphan watchers", async () => {
    const tempDir = await mkdtemp(path.join(os.tmpdir(), "agentic-repo-"));
    const storePath = path.join(tempDir, "runtime-store.json");
    const repository = createRepository({
      storePath
    });
    const timestamp = nowIso();
    const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000).toISOString();
    const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString();

    await repository.seedDefaults(SYSTEM_USER_ID);

    const blockedBundle = await createGoalForUser(repository, SYSTEM_USER_ID, "Draft a risky outbound response for a client.");
    await repository.saveGoalBundle({
      ...blockedBundle,
      goal: {
        ...blockedBundle.goal,
        status: "running",
        updatedAt: timestamp
      },
      workflow: {
        ...blockedBundle.workflow,
        status: "running",
        updatedAt: timestamp
      },
      tasks: blockedBundle.tasks.map((task, index) =>
        index === 0
          ? {
              ...task,
              state: "blocked",
              updatedAt: timestamp
            }
          : task
      ),
      approvals: [
        ...blockedBundle.approvals,
        {
          id: "approval-expired",
          goalId: blockedBundle.goal.id,
          taskId: blockedBundle.tasks[0]?.id ?? "task-missing",
          title: "Send the outbound response",
          rationale: "The action commits to an external stakeholder.",
          riskClass: "R3",
          decision: "pending",
          requestedAction: "Send the drafted response",
          preview: {
            actionType: "send",
            target: "External communication",
            summary: "Send the drafted response to the client.",
            changes: [
              {
                label: "Body",
                before: "Draft not yet sent",
                after: "Client receives the drafted response"
              }
            ],
            impact: {
              affectedPeople: ["external recipients"],
              affectedSystems: ["email"],
              permissions: ["send"],
              rollback: "manual"
            }
          },
          decisionScope: null,
          decisionRationale: null,
          history: [],
          createdAt: oneHourAgo,
          expiryAt: oneHourAgo,
          respondedAt: null
        }
      ]
    });

    const completedBundle = await createGoalForUser(repository, SYSTEM_USER_ID, "Complete a passive monitoring workflow.");
    await repository.saveGoalBundle({
      ...completedBundle,
      goal: {
        ...completedBundle.goal,
        status: "completed",
        updatedAt: timestamp
      },
      workflow: {
        ...completedBundle.workflow,
        status: "completed",
        updatedAt: timestamp
      },
      tasks: completedBundle.tasks.map((task) => ({
        ...task,
        state: "completed",
        updatedAt: timestamp
      })),
      watchers: [
        WatcherSchema.parse({
          id: "watcher-orphaned",
          goalId: completedBundle.goal.id,
          targetEntity: "priority inbox",
          condition: "urgent customer email arrives",
          frequency: "hourly",
          triggerAction: "surface alert",
          sourceSystems: ["email"],
          status: "active",
          expiryAt: null,
          createdAt: timestamp,
          updatedAt: timestamp
        })
      ]
    });

    const stalledBundle = await createGoalForUser(repository, SYSTEM_USER_ID, "Keep a planning workflow moving.");
    await repository.saveGoalBundle({
      ...stalledBundle,
      goal: {
        ...stalledBundle.goal,
        status: "running",
        updatedAt: twoHoursAgo
      },
      workflow: {
        ...stalledBundle.workflow,
        status: "running",
        updatedAt: twoHoursAgo
      },
      tasks: stalledBundle.tasks.map((task, index) => ({
        ...task,
        state: index === 0 ? "running" : "queued",
        updatedAt: twoHoursAgo
      }))
    });

    const reviewDueMemory = createMemoryRecord({
      userId: SYSTEM_USER_ID,
      category: "preferences",
      memoryType: "observed",
      content: "Prefers morning reviews for outbound drafts.",
      confidence: 0.92,
      source: "test-suite",
      reviewAt: oneHourAgo
    });
    const lowConfidenceMemory = createMemoryRecord({
      userId: SYSTEM_USER_ID,
      category: "preferences",
      memoryType: "observed",
      content: "Sometimes skips lunch when in a hurry.",
      confidence: 0.42,
      source: "test-suite"
    });

    await repository.saveMemory(reviewDueMemory);
    await repository.saveMemory(lowConfidenceMemory);
    const asyncIssueJob = await repository.enqueueJob(
      createGoalCreateJob({
        userId: SYSTEM_USER_ID,
        request: "Recover a degraded queue path.",
        goalId: blockedBundle.goal.id,
        availableAt: "2026-04-17T08:00:00.000Z",
        maxAttempts: 2
      })
    );
    const claimedAsyncIssueJob = await repository.claimNextJob({
      userId: SYSTEM_USER_ID,
      runnerId: "worker-dashboard",
      leaseMs: 30_000,
      now: "2026-04-17T08:00:00.000Z"
    });

    expect(claimedAsyncIssueJob?.id).toBe(asyncIssueJob.id);

    await repository.deadLetterJob({
      jobId: asyncIssueJob.id,
      runnerId: "worker-dashboard",
      deadLetteredAt: timestamp,
      error: "worker failed to complete async recovery"
    });

    await repository.saveProviderCredential(
      buildProviderCredential({
        userId: SYSTEM_USER_ID,
        status: "refresh_failed",
        lastValidatedAt: "2026-04-08T09:00:00.000Z",
        lastRefreshFailureAt: timestamp
      })
    );

    const dashboard = await repository.getDashboardData(SYSTEM_USER_ID);
    const expiredApprovals = dashboard.diagnostics.items.find((item) => item.kind === "expired_approvals");
    const staleMemories = dashboard.diagnostics.items.find((item) => item.kind === "stale_memories");
    const stuckWorkflows = dashboard.diagnostics.items.find((item) => item.kind === "stuck_workflows");
    const orphanWatchers = dashboard.diagnostics.items.find((item) => item.kind === "orphan_watchers");
    const asyncExecutionIssues = dashboard.diagnostics.items.find((item) => item.kind === "async_execution_issues");
    const connectorDegradation = dashboard.diagnostics.items.find((item) => item.kind === "connector_degradation");

    expect(dashboard.diagnostics.status).toBe("critical");
    expect(dashboard.diagnostics.totalCount).toBe(8);
    expect(expiredApprovals).toMatchObject({
      count: 1,
      severity: "critical"
    });
    expect(expiredApprovals?.reasons[0]).toContain("Send the outbound response");
    expect(expiredApprovals?.targets).toEqual([
      {
        section: "approvals",
        itemId: "approval-expired",
        label: "Send the outbound response"
      }
    ]);
    expect(staleMemories).toMatchObject({
      count: 2,
      severity: "warning"
    });
    expect(staleMemories?.reasons).toEqual(
      expect.arrayContaining(["1 memory overdue for review", "1 memory low confidence"])
    );
    expect(staleMemories?.targets).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          section: "memory",
          itemId: reviewDueMemory.id,
          action: "review_memory",
          actionLabel: "Review"
        }),
        expect.objectContaining({
          section: "memory",
          itemId: lowConfidenceMemory.id,
          action: "review_memory",
          actionLabel: "Review"
        })
      ])
    );
    expect(stuckWorkflows).toMatchObject({
      count: 2,
      severity: "critical"
    });
    expect(stuckWorkflows?.reasons).toEqual(
      expect.arrayContaining([
        expect.stringContaining("blocked task"),
        expect.stringContaining("last progress")
      ])
    );
    expect(stuckWorkflows?.targets).toEqual(
      expect.arrayContaining([
        {
          section: "goals",
          itemId: blockedBundle.goal.id,
          label: blockedBundle.goal.title
        },
        {
          section: "goals",
          itemId: stalledBundle.goal.id,
          label: stalledBundle.goal.title
        }
      ])
    );
    expect(orphanWatchers).toMatchObject({
      count: 1,
      severity: "warning"
    });
    expect(orphanWatchers?.reasons[0]).toContain("priority inbox watcher");
    expect(orphanWatchers?.targets).toEqual([
      {
        section: "watchers",
        itemId: "watcher-orphaned",
        label: "priority inbox",
        action: "pause_watcher",
        actionLabel: "Pause"
      }
    ]);
    expect(asyncExecutionIssues).toMatchObject({
      count: 1,
      severity: "critical"
    });
    expect(asyncExecutionIssues?.reasons).toEqual(
      expect.arrayContaining(["1 dead-letter job need operator recovery"])
    );
    expect(asyncExecutionIssues?.targets).toEqual([
      {
        section: "operations",
        itemId: `operations-job-${asyncIssueJob.id}`,
        label: `Goal queue · ${blockedBundle.goal.title}`
      }
    ]);
    expect(connectorDegradation).toMatchObject({
      count: 1,
      severity: "warning"
    });
    expect(connectorDegradation?.reasons).toEqual(expect.arrayContaining(["1 connector hit token refresh failure"]));
    expect(connectorDegradation?.targets).toEqual([
      {
        section: "operations",
        itemId: "operations-connector-google:global:acct-123",
        label: "google · owner@example.com"
      }
    ]);
    expect(dashboard.operations).toBeDefined();
    expect(dashboard.operations?.generatedAt).toBe(dashboard.diagnostics.generatedAt);
    expect(dashboard.operations?.autonomyPosture.status).toBe("critical");
    expect(dashboard.operations?.autonomyPosture.level).toBe("blocked");
    expect(dashboard.operations?.autonomyPosture.label).toBe("Blocked");
    expect(dashboard.operations?.autonomyPosture.summary).toBe(
      "Autonomy is blocked until queue recovery and connector repair return the runtime to policy-safe bounds."
    );
    expect(dashboard.operations?.autonomyPosture.stats).toEqual(
      expect.arrayContaining([
        "Mode notify only",
        "Approval always review",
        "Max auto R1",
        "Shadow replay staged",
        "1 pending approval",
        "0 failed events"
      ])
    );
    expect(dashboard.operations?.autonomyPosture.reasons).toEqual(
      expect.arrayContaining([
        "Dead-lettered after 1/2 attempts.",
        "Token refresh failed, so the connector may stop working until it is revalidated.",
        "Autopilot mode is notify only, so execution remains operator-controlled.",
        "1 pending approval still needs operator review."
      ])
    );
    expect(dashboard.operations?.autonomyPosture.overridePaths).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "autonomy-open-queue-recovery",
          label: "Open queue recovery",
          permission: "owner",
          target: {
            section: "operations",
            itemId: `operations-job-${asyncIssueJob.id}`,
            label: blockedBundle.goal.title
          }
        }),
        expect.objectContaining({
          id: "autonomy-open-connector-repair",
          label: "Review connector health",
          permission: "owner",
          target: {
            section: "operations",
            itemId: "operations-connector-google:global:acct-123",
            label: "Open google integrations"
          }
        }),
        expect.objectContaining({
          id: "autonomy-review-approval",
          label: "Review pending approval",
          permission: "owner",
          target: {
            section: "approvals",
            itemId: "approval-expired",
            label: "Send the outbound response"
          }
        }),
        expect.objectContaining({
          id: "autonomy-open-autopilot",
          label: "Open autopilot controls",
          permission: "owner",
          target: {
            section: "autopilot",
            label: "Open autopilot controls"
          }
        })
      ])
    );
    expect(dashboard.operations?.asyncExecution).toMatchObject({
      status: "critical",
      issueCount: 1,
      deadLetterJobs: 1,
      retryingJobs: 0
    });
    expect(dashboard.operations?.asyncExecution.items[0]).toMatchObject({
      id: `operations-job-${asyncIssueJob.id}`,
      summary: "Dead-lettered after 1/2 attempts.",
      severity: "critical",
      target: {
        section: "goals",
        itemId: blockedBundle.goal.id,
        label: blockedBundle.goal.title
      }
    });
    expect(dashboard.operations?.connectorHealth).toMatchObject({
      status: "attention",
      totalCount: 1,
      issueCount: 1,
      refreshFailedCount: 1,
      validationStaleCount: 0
    });
    expect(dashboard.operations?.connectorHealth.items[0]).toMatchObject({
      id: "operations-connector-google:global:acct-123",
      summary: "Token refresh failed, so the connector may stop working until it is revalidated.",
      severity: "attention",
      expectedReadinessTier: "approval-grade",
      expectedReadinessLabel: "Approval-grade",
      expectedSupportedModes: ["draft", "approval"],
      linkedIntegrationIds: ["gmail", "google-calendar"],
      linkedIntegrationNames: ["Gmail Adapter", "Google Calendar Adapter"],
      meetingReadinessTarget: false,
      target: {
        section: "integrations",
        label: "Open google integrations"
      }
    });
    expect(dashboard.controlPlane.generatedAt).toBe(dashboard.diagnostics.generatedAt);
    expect(dashboard.controlPlane.sections.map((section) => section.key)).toEqual([
      "workspace",
      "commitments",
      "automation",
      "execution",
      "trust"
    ]);
    expect(dashboard.controlPlane.sections.find((section) => section.key === "workspace")).toMatchObject({
      status: "healthy",
      targetSection: "workspaces",
      stats: expect.arrayContaining(["1 member", "1 ready integration", "Approval always review"])
    });
    expect(dashboard.controlPlane.sections.find((section) => section.key === "commitments")).toMatchObject({
      status: "critical",
      targetSection: "commitments",
      stats: expect.arrayContaining(["3 open commitments", "2 needs-review items", "0 blocked items"])
    });
    expect(dashboard.controlPlane.sections.find((section) => section.key === "automation")).toMatchObject({
      status: "attention",
      targetSection: "autopilot",
      stats: expect.arrayContaining(["Mode notify only", "1 active watcher", "0 failed events"])
    });
    expect(dashboard.controlPlane.sections.find((section) => section.key === "execution")).toMatchObject({
      status: "critical",
      targetSection: "operations",
      targetItemId: `operations-job-${asyncIssueJob.id}`,
      stats: expect.arrayContaining(["2 active goals", "1 queue issue", "1 dead letter / 0 retrying jobs"])
    });
    expect(dashboard.controlPlane.sections.find((section) => section.key === "trust")).toMatchObject({
      status: "critical",
      targetSection: "operations",
      targetItemId: "operations-connector-google:global:acct-123",
      stats: expect.arrayContaining(["8 reliability signals", "2 stale memories", "Max auto R1"])
    });
    expect(dashboard.operatingSections.generatedAt).toBe(dashboard.diagnostics.generatedAt);
    expect(dashboard.operatingSections.roleView).toMatchObject({
      role: "owner",
      label: "Owner view",
      prioritizedSectionKeys: ["now", "execution", "trust", "automation", "build"]
    });
    expect(dashboard.operatingSections.roleView.summary).toContain("Recover async execution");
    expect(dashboard.operatingSections.roleView.focusAreas).toEqual(
      expect.arrayContaining([
        "Recover async execution before trusting fresh autopilot or queue activity.",
        "Clear pending approvals that are holding governed work at the boundary."
      ])
    );
    expect(dashboard.operatingSections.teamWorkflow).toMatchObject({
      mode: "owner_control",
      label: "Owner-controlled team workflow",
      visibilityLabel: "Full queue, approval, and governance visibility",
      escalationTargetRole: "owner",
      slaStatus: "critical"
    });
    expect(dashboard.operatingSections.teamWorkflow.queueMetrics).toEqual(
      expect.arrayContaining(["0 collaborators", "1 pending approval", "2 urgent queue items"])
    );
    expect(dashboard.operatingSections.teamWorkflow.ownershipAssignments).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          key: "shared_queue",
          ownerRole: "owner",
          status: "critical"
        }),
        expect.objectContaining({
          key: "approval_boundary",
          ownerRole: "owner",
          status: "critical"
        }),
        expect.objectContaining({
          key: "execution_recovery",
          ownerRole: "owner",
          status: "critical"
        })
      ])
    );
    expect(dashboard.operatingSections.teamWorkflow.queues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          key: "mine",
          label: "Mine",
          ownerRole: "owner",
          status: "critical",
          count: 3,
          targetSection: "approvals",
          targetItemId: "approval-expired"
        }),
        expect.objectContaining({
          key: "delegated",
          label: "Delegated",
          ownerRole: "owner",
          status: "critical",
          count: 0
        }),
        expect.objectContaining({
          key: "escalated",
          label: "Escalated",
          ownerRole: "owner",
          status: "critical",
          count: 2
        }),
        expect.objectContaining({
          key: "blocked",
          label: "Blocked",
          ownerRole: "owner",
          status: "critical",
          count: 1,
          targetSection: "operations"
        }),
        expect.objectContaining({
          key: "waiting",
          label: "Waiting",
          ownerRole: "owner",
          status: "healthy",
          count: 0
        })
      ])
    );
    expect(dashboard.operatingSections.teamWorkflow.controls).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          key: "open_mine",
          label: "Open owner lane",
          status: "critical",
          targetSection: "approvals",
          permission: expect.objectContaining({
            allowed: true
          })
        }),
        expect.objectContaining({
          key: "rebalance_queue",
          label: "Rebalance queue ownership",
          status: "attention",
          targetSection: "workspaces",
          permission: expect.objectContaining({
            allowed: true
          })
        }),
        expect.objectContaining({
          key: "escalate_overdue",
          label: "Escalate overdue approvals",
          status: "critical",
          targetSection: "approvals",
          targetItemId: "approval-expired"
        })
      ])
    );
    expect(dashboard.operatingSections.teamWorkflow.auditCoverage).toMatchObject({
      required: true,
      status: "attention",
      latestStatus: null,
      latestCompletedAt: null
    });
    expect(dashboard.operatingSections.teamWorkflow.auditCoverage.summary).toContain(
      "Audit exports are required for this workspace"
    );
    expect(dashboard.operatingSections.teamWorkflow.slaSummary).toContain("exceeded the shared-team response window");
    expect(dashboard.operatingSections.teamWorkflow.handoffGuidance).toEqual(
      expect.arrayContaining([
        "Oldest overdue approval: Send the outbound response",
        "Use the shared queue ordering before pulling in new ad hoc work."
      ])
    );
    expect(dashboard.operatingSections.nextBestAction).toMatchObject({
      kind: "recover_execution",
      label: "Recover async execution",
      status: "critical",
      targetSection: "operations",
      targetItemId: `operations-job-${asyncIssueJob.id}`,
      role: "owner"
    });
    expect(dashboard.operatingSections.nextBestAction.reason).toContain("highest-priority blocker");
    expect(dashboard.operatingSections.sections.map((section) => section.key)).toEqual([
      "now",
      "automation",
      "execution",
      "trust",
      "build"
    ]);
    expect(dashboard.operatingSections.sections.find((section) => section.key === "now")).toMatchObject({
      status: "critical",
      targetSection: "now",
      targetItemId: "commitment-approval-approval-expired",
      metrics: expect.arrayContaining(["3 ready items", "2 review gates", "0 blocked items"])
    });
    expect(dashboard.operatingSections.sections.find((section) => section.key === "automation")).toMatchObject({
      status: "attention",
      targetSection: "autopilot",
      metrics: expect.arrayContaining(["Mode notify only", "1 active watcher", "0 failed events"])
    });
    expect(dashboard.operatingSections.sections.find((section) => section.key === "execution")).toMatchObject({
      status: "critical",
      targetSection: "operations",
      targetItemId: `operations-job-${asyncIssueJob.id}`,
      metrics: expect.arrayContaining(["2 active goals", "1 queue issue", "1 recent artifact"])
    });
    expect(dashboard.operatingSections.sections.find((section) => section.key === "trust")).toMatchObject({
      status: "critical",
      targetSection: "operations",
      targetItemId: "operations-connector-google:global:acct-123",
      metrics: expect.arrayContaining(["8 reliability signals", "2 stale memories", "1 pending approval"])
    });
    expect(dashboard.operatingSections.sections.find((section) => section.key === "build")).toMatchObject({
      status: "healthy",
      targetSection: "integrations",
      metrics: expect.arrayContaining(["1 ready integration", "1 active watcher", "2 memories"])
    });
    expect(dashboard.nowQueue.generatedAt).toBe(dashboard.diagnostics.generatedAt);
    expect(dashboard.nowQueue.totalCount).toBe(3);
    expect(dashboard.nowQueue.items[0]).toMatchObject({
      commitmentId: "commitment-approval-approval-expired",
      status: "stale",
      urgency: "immediate",
      riskClass: "R3",
      suggestedNextAction: {
        kind: "review_approval",
        section: "approvals",
        itemId: "approval-expired"
      }
    });
    expect(dashboard.nowQueue.items[0]?.reasons).toEqual(
      expect.arrayContaining([
        expect.stringContaining("review"),
        expect.stringContaining("expired")
      ])
    );
  });

  it("surfaces conflicting memory context as a reviewable dashboard diagnostic", async () => {
    const tempDir = await mkdtemp(path.join(os.tmpdir(), "agentic-repo-"));
    const storePath = path.join(tempDir, "runtime-store.json");
    const repository = createRepository({
      storePath
    });

    await repository.seedDefaults(SYSTEM_USER_ID);
    const primary = createMemoryRecord({
      userId: SYSTEM_USER_ID,
      category: "travel",
      memoryType: "confirmed",
      content: "Seat preference is aisle.",
      confidence: 0.95,
      source: "test-suite",
      updatedAt: "2026-04-17T08:00:00.000Z"
    });
    const conflicting = createMemoryRecord({
      userId: SYSTEM_USER_ID,
      category: "travel",
      memoryType: "observed",
      content: "Seat preference is window.",
      confidence: 0.8,
      source: "test-suite",
      updatedAt: "2026-04-16T08:00:00.000Z"
    });

    await repository.saveMemory(primary);
    await repository.saveMemory(conflicting);

    const dashboard = await repository.getDashboardData(SYSTEM_USER_ID);
    const conflictDiagnostic = dashboard.diagnostics.items.find((item) => item.kind === "context_conflicts");

    expect(conflictDiagnostic).toMatchObject({
      title: "Conflicting context",
      count: 1,
      severity: "warning"
    });
    expect(conflictDiagnostic?.reasons).toEqual(
      expect.arrayContaining(['Conflicting travel context for "seat preference" needs review.'])
    );
    expect(conflictDiagnostic?.targets).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          section: "memory",
          itemId: primary.id,
          action: "review_memory",
          actionLabel: "Review"
        }),
        expect.objectContaining({
          section: "memory",
          itemId: conflicting.id,
          action: "review_memory",
          actionLabel: "Review"
        })
      ])
    );
  });

  it("round-trips workspace governance and exports a bounded workspace audit report", async () => {
    const tempDir = await mkdtemp(path.join(os.tmpdir(), "agentic-repo-"));
    const storePath = path.join(tempDir, "runtime-store.json");
    const repository = createRepository({
      storePath
    });
    const timestamp = nowIso();

    await repository.seedDefaults(SYSTEM_USER_ID);

    const workspace = WorkspaceSchema.parse({
      id: "workspace-governed-team",
      ownerUserId: SYSTEM_USER_ID,
      slug: "governed-team",
      name: "Governed Team",
      description: "Workspace for governance and audit coverage.",
      isPersonal: false,
      createdAt: timestamp,
      updatedAt: timestamp
    });

    await repository.saveWorkspace(workspace, systemActor);
    await repository.saveWorkspaceMember(
      WorkspaceMemberSchema.parse({
        id: "workspace-member-governed-owner",
        workspaceId: workspace.id,
        userId: SYSTEM_USER_ID,
        role: "owner",
        joinedAt: timestamp,
        updatedAt: timestamp
      }),
      systemActor
    );

    const governance = await repository.saveWorkspaceGovernance(
      WorkspaceGovernanceSchema.parse({
        workspaceId: workspace.id,
        approvalMode: "always_review",
        requireAuditExports: true,
        maxAutoRunRiskClass: "R1",
        externalSendRequiresApproval: true,
        calendarWriteRequiresApproval: true,
        shadowReplayPolicy: {
          enabled: false,
          promotionMode: "disabled",
          rollbackOutcome: "allowed_with_confirmation",
          minimumMatchedEpisodes: 6,
          minimumPrecision: 0.9,
          maximumNegativeOutcomeRate: 0.1,
          maximumFailureCostRate: 0.15
        },
        retentionDays: 90,
        updatedBy: SYSTEM_USER_ID,
        createdAt: timestamp,
        updatedAt: timestamp
      }),
      systemActor
    );
    await repository.saveWorkspaceSelection(
      WorkspaceSelectionSchema.parse({
        userId: SYSTEM_USER_ID,
        workspaceId: workspace.id,
        selectedAt: timestamp,
        updatedAt: timestamp
      })
    );

    const bundle = await createGoalForUser(
      repository,
      SYSTEM_USER_ID,
      "Prepare a governed external response.",
      workspace.id
    );
    const audit = await repository.exportWorkspaceAudit(workspace.id, SYSTEM_USER_ID);
    const parsedAudit = JSON.parse(audit.content) as {
      generatedAt: string;
      workspace: { id: string };
      governance: {
        approvalMode: string;
        requireAuditExports: boolean;
        shadowReplayPolicy: {
          enabled: boolean;
          promotionMode: string;
          rollbackOutcome: string;
          minimumMatchedEpisodes: number;
          minimumPrecision: number;
        };
      };
      goals: Array<{
        goal: { id: string };
        approvals: Array<{ id: string }>;
        actionLogs: Array<{ kind: string }>;
      }>;
      goalShares: Array<unknown>;
      privacyOperations: Array<unknown>;
      members: Array<unknown>;
      integrity: {
        version: string;
        algorithm: string;
        canonicalization: string;
        digest: string;
        recordCounts: {
          members: number;
          goalShares: number;
          privacyOperations: number;
          goals: number;
        };
      };
    };
    const { integrity, ...auditPayload } = parsedAudit;
    const expectedDigest = createHash("sha256").update(JSON.stringify(auditPayload)).digest("hex");

    expect(governance).toMatchObject({
      workspaceId: workspace.id,
      approvalMode: "always_review",
      requireAuditExports: true,
      retentionDays: 90,
      shadowReplayPolicy: {
        enabled: false,
        promotionMode: "disabled",
        rollbackOutcome: "allowed_with_confirmation",
        minimumMatchedEpisodes: 6,
        minimumPrecision: 0.9
      }
    });
    expect(audit.contentType).toBe("application/json");
    expect(audit.fileName).toContain(workspace.slug);
    expect(parsedAudit.workspace.id).toBe(workspace.id);
    expect(parsedAudit.governance).toMatchObject({
      approvalMode: "always_review",
      requireAuditExports: true,
      shadowReplayPolicy: {
        enabled: false,
        promotionMode: "disabled",
        rollbackOutcome: "allowed_with_confirmation",
        minimumMatchedEpisodes: 6,
        minimumPrecision: 0.9
      }
    });
    expect(parsedAudit.generatedAt).toBe(audit.generatedAt);
    expect(parsedAudit.goals).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          goal: expect.objectContaining({
            id: bundle.goal.id
          })
        })
      ])
    );
    const auditedGoal = parsedAudit.goals.find((item) => item.goal.id === bundle.goal.id);
    expect(integrity).toEqual({
      version: "agentic-workspace-audit-integrity-v1",
      algorithm: "sha256",
      canonicalization: "json-stringify-v1",
      digest: expectedDigest,
      recordCounts: {
        members: parsedAudit.members.length,
        goalShares: parsedAudit.goalShares.length,
        privacyOperations: parsedAudit.privacyOperations.length,
        goals: parsedAudit.goals.length
      }
    });
    expect(Array.isArray(auditedGoal?.approvals)).toBe(true);
    expect(auditedGoal?.actionLogs.some((log) => log.kind === "goal.created")).toBe(true);
    const dashboard = await repository.getDashboardData(SYSTEM_USER_ID);

    expect(dashboard.operatingSections.teamWorkflow.auditCoverage).toMatchObject({
      required: true,
      status: "healthy",
      latestStatus: "completed",
      latestCompletedAt: audit.generatedAt
    });
    expect(dashboard.operatingSections.teamWorkflow.auditCoverage.summary).toContain(audit.generatedAt);
  });

  it("fails fast with a clear error when the file-backed store is corrupted", async () => {
    const tempDir = await mkdtemp(path.join(os.tmpdir(), "agentic-repo-"));
    const storePath = path.join(tempDir, "runtime-store.json");
    await writeFile(storePath, "{not-valid-json", "utf8");

    const repository = createRepository({
      storePath
    });

    await expect(repository.listGoals(SYSTEM_USER_ID)).rejects.toThrow(/Runtime store .* is corrupted/);
  });

  it("uses unique temp files for concurrent file-backed writes across repository instances", async () => {
    const tempDir = await mkdtemp(path.join(os.tmpdir(), "agentic-repo-"));
    const storePath = path.join(tempDir, "runtime-store.json");
    const repositoryA = createRepository({
      storePath
    });
    const repositoryB = createRepository({
      storePath
    });

    await repositoryA.seedDefaults(SYSTEM_USER_ID);
    const existingSelection = await repositoryA.getWorkspaceSelection(SYSTEM_USER_ID);

    expect(existingSelection).not.toBeNull();

    const writes = Array.from({ length: 24 }, (_, index) => {
      const timestamp = new Date(Date.UTC(2026, 0, 1, 0, 0, index)).toISOString();

      return (index % 2 === 0 ? repositoryA : repositoryB).saveWorkspaceSelection(
        WorkspaceSelectionSchema.parse({
          userId: SYSTEM_USER_ID,
          workspaceId: existingSelection!.workspaceId,
          actorContext: systemActor,
          selectedAt: timestamp,
          updatedAt: timestamp
        })
      );
    });

    await expect(Promise.all(writes)).resolves.toHaveLength(24);

    const reloadedRepository = createRepository({
      storePath
    });
    const reloadedSelection = await reloadedRepository.getWorkspaceSelection(SYSTEM_USER_ID);
    const persisted = JSON.parse(await readFile(storePath, "utf8")) as {
      workspaceSelections: Array<{ userId: string; workspaceId: string; selectedAt: string }>;
    };
    const leftoverTempFiles = (await readdir(tempDir)).filter((name) => name.startsWith("runtime-store.json.") && name.endsWith(".tmp"));

    expect(reloadedSelection).toMatchObject({
      userId: SYSTEM_USER_ID,
      workspaceId: existingSelection!.workspaceId
    });
    expect(persisted.workspaceSelections).toContainEqual(
      expect.objectContaining({
        userId: SYSTEM_USER_ID,
        workspaceId: existingSelection!.workspaceId
      })
    );
    expect(leftoverTempFiles).toEqual([]);
  });

  it("persists briefing preferences and derives briefing history from briefing goals", async () => {
    const tempDir = await mkdtemp(path.join(os.tmpdir(), "agentic-repo-"));
    const storePath = path.join(tempDir, "runtime-store.json");
    const repository = createRepository({
      storePath
    });

    await repository.seedDefaults(SYSTEM_USER_ID);

    const defaults = await repository.getBriefingPreferences(SYSTEM_USER_ID);
    expect(defaults.schedules).toHaveLength(briefingTypeValues.length);

    const updatedPreferences = await repository.saveBriefingPreferences({
      ...defaults,
      timezone: "America/New_York",
      focus: "urgent",
      schedules: defaults.schedules.map((schedule) =>
        schedule.type === "midday"
          ? {
              ...schedule,
              enabled: true,
              time: "13:30"
            }
          : schedule
      ),
      actorContext: systemActor,
      updatedAt: nowIso()
    });

    const briefingBundle = await generateBriefing({
      type: "midday",
      userId: SYSTEM_USER_ID,
      memories: await repository.listMemory(SYSTEM_USER_ID),
      integrations: await repository.listIntegrations(SYSTEM_USER_ID),
      pendingApprovals: [],
      activeWatchers: [],
      preferences: updatedPreferences
    });

    await repository.saveGoalBundle(briefingBundle);

    const reloadedRepository = createRepository({
      storePath
    });
    const dashboard = await repository.getDashboardData(SYSTEM_USER_ID);
    const reloadedPreferences = await reloadedRepository.getBriefingPreferences(SYSTEM_USER_ID);
    const persisted = JSON.parse(await readFile(storePath, "utf8")) as {
      briefingPreferences: Array<{ userId: string; actorContext: unknown }>;
    };

    expect(dashboard.briefingPreferences).toMatchObject({
      timezone: "America/New_York",
      focus: "urgent",
      actorContext: systemActor
    });
    expect(dashboard.briefingPreferences.schedules.find((schedule) => schedule.type === "midday")).toMatchObject({
      enabled: true,
      time: "13:30"
    });
    expect(reloadedPreferences.actorContext).toEqual(systemActor);
    expect(dashboard.briefingHistory[0]).toMatchObject({
      goalId: briefingBundle.goal.id,
      type: "midday",
      title: briefingBundle.goal.title,
      status: briefingBundle.goal.status
    });
    expect(
      persisted.briefingPreferences.some(
        (candidate) =>
          candidate.userId === SYSTEM_USER_ID &&
          JSON.stringify(candidate.actorContext) === JSON.stringify(systemActor)
      )
    ).toBe(true);
  });

  it("persists workspace selection actor attribution across repository reloads", async () => {
    const tempDir = await mkdtemp(path.join(os.tmpdir(), "agentic-repo-"));
    const storePath = path.join(tempDir, "runtime-store.json");
    const repository = createRepository({
      storePath
    });

    await repository.seedDefaults(SYSTEM_USER_ID);

    const workspace = WorkspaceSchema.parse({
      id: "workspace-collab",
      ownerUserId: SYSTEM_USER_ID,
      slug: "collab",
      name: "Collab",
      description: "Shared planning workspace.",
      isPersonal: false,
      createdAt: nowIso(),
      updatedAt: nowIso()
    });

    await repository.saveWorkspace(workspace, systemActor);
    await repository.saveWorkspaceMember(
      WorkspaceMemberSchema.parse({
        id: "workspace-member-collab-owner",
        workspaceId: workspace.id,
        userId: SYSTEM_USER_ID,
        role: "owner",
        joinedAt: nowIso(),
        updatedAt: nowIso()
      }),
      systemActor
    );
    await repository.saveWorkspaceSelection(
      WorkspaceSelectionSchema.parse({
        userId: SYSTEM_USER_ID,
        workspaceId: workspace.id,
        actorContext: systemActor,
        selectedAt: nowIso(),
        updatedAt: nowIso()
      })
    );

    const reloadedRepository = createRepository({
      storePath
    });
    const reloadedSelection = await reloadedRepository.getWorkspaceSelection(SYSTEM_USER_ID);
    const persisted = JSON.parse(await readFile(storePath, "utf8")) as {
      workspaceSelections: Array<{ userId: string; actorContext: unknown; workspaceId: string }>;
    };

    expect(reloadedSelection).toMatchObject({
      userId: SYSTEM_USER_ID,
      workspaceId: workspace.id,
      actorContext: systemActor
    });
    expect(
      persisted.workspaceSelections.some(
        (candidate) =>
          candidate.userId === SYSTEM_USER_ID &&
          candidate.workspaceId === workspace.id &&
          JSON.stringify(candidate.actorContext) === JSON.stringify(systemActor)
      )
    ).toBe(true);
  });

  it("persists memory actor attribution across repository reloads", async () => {
    const tempDir = await mkdtemp(path.join(os.tmpdir(), "agentic-repo-"));
    const storePath = path.join(tempDir, "runtime-store.json");
    const repository = createRepository({
      storePath
    });

    await repository.seedDefaults(SYSTEM_USER_ID);

    const memory = createMemoryRecord({
      userId: SYSTEM_USER_ID,
      category: "preferences",
      memoryType: "observed",
      content: "Prefers concise approval summaries.",
      confidence: 0.8,
      source: "test-suite",
      actorContext: systemActor
    });

    await repository.saveMemory(memory);

    const reloadedRepository = createRepository({
      storePath
    });
    const listed = await reloadedRepository.listMemory(SYSTEM_USER_ID);
    const persisted = JSON.parse(await readFile(storePath, "utf8")) as {
      memories: Array<{ id: string; actorContext: unknown }>;
    };

    expect(listed.find((candidate) => candidate.id === memory.id)).toMatchObject({
      id: memory.id,
      actorContext: systemActor
    });
    expect(
      persisted.memories.some(
        (candidate) =>
          candidate.id === memory.id &&
          JSON.stringify(candidate.actorContext) === JSON.stringify(systemActor)
      )
    ).toBe(true);
  });

  it("persists integration actor attribution across seeded defaults and updates", async () => {
    const tempDir = await mkdtemp(path.join(os.tmpdir(), "agentic-repo-"));
    const storePath = path.join(tempDir, "runtime-store.json");
    const repository = createRepository({
      storePath
    });

    await repository.seedDefaults(SYSTEM_USER_ID);

    const seededIntegrations = await repository.listIntegrations(SYSTEM_USER_ID);
    const expectedSeededId = buildDefaultIntegrationAccounts(SYSTEM_USER_ID)[0]?.id;
    const seededIntegration = seededIntegrations.find((candidate) => candidate.id === expectedSeededId);

    expect(seededIntegration).toMatchObject({
      id: expectedSeededId,
      actorContext: systemActor
    });

    const updatedIntegration = await repository.upsertIntegration({
      ...seededIntegration!,
      status: "disabled",
      actorContext: systemActor,
      updatedAt: nowIso()
    });

    const reloadedRepository = createRepository({
      storePath
    });
    const listed = await reloadedRepository.listIntegrations(SYSTEM_USER_ID);
    const persisted = JSON.parse(await readFile(storePath, "utf8")) as {
      integrations: Array<{ id: string; actorContext: unknown; status: string }>;
    };

    expect(updatedIntegration).toMatchObject({
      id: seededIntegration!.id,
      status: "disabled",
      actorContext: systemActor
    });
    expect(listed.find((candidate) => candidate.id === seededIntegration!.id)).toMatchObject({
      id: seededIntegration!.id,
      status: "disabled",
      actorContext: systemActor
    });
    expect(
      persisted.integrations.some(
        (candidate) =>
          candidate.id === seededIntegration!.id &&
          candidate.status === "disabled" &&
          JSON.stringify(candidate.actorContext) === JSON.stringify(systemActor)
      )
    ).toBe(true);
  });

  it("persists commitment actor attribution across repository reloads", async () => {
    const tempDir = await mkdtemp(path.join(os.tmpdir(), "agentic-repo-"));
    const storePath = path.join(tempDir, "runtime-store.json");
    const repository = createRepository({
      storePath
    });

    await repository.seedDefaults(SYSTEM_USER_ID);

    const commitment = await repository.saveCommitment({
      id: "commitment-actor-1",
      userId: SYSTEM_USER_ID,
      title: "Verify actor attribution",
      summary: "Ensure commitments persist who updated them.",
      status: "completed",
      sourceKind: "goal",
      sourceId: "goal-actor-1",
      goalId: "goal-actor-1",
      approvalId: null,
      dueAt: null,
      confidence: 0.94,
      evidence: [
        {
          section: "goals",
          itemId: "goal-actor-1",
          label: "Verify actor attribution"
        }
      ],
      actorContext: systemActor,
      createdAt: nowIso(),
      updatedAt: nowIso()
    });

    const reloadedRepository = createRepository({
      storePath
    });
    const listed = await reloadedRepository.listCommitments(SYSTEM_USER_ID);
    const persisted = JSON.parse(await readFile(storePath, "utf8")) as {
      commitments: Array<{ id: string; actorContext: unknown }>;
    };

    expect(listed.find((candidate) => candidate.id === commitment.id)).toMatchObject({
      id: commitment.id,
      actorContext: systemActor
    });
    expect(
      persisted.commitments.some(
        (candidate) =>
          candidate.id === commitment.id &&
          JSON.stringify(candidate.actorContext) === JSON.stringify(systemActor)
      )
    ).toBe(true);
  });

  it("persists agent actor attribution and enforces user scoping across repository reloads", async () => {
    const tempDir = await mkdtemp(path.join(os.tmpdir(), "agentic-repo-"));
    const storePath = path.join(tempDir, "runtime-store.json");
    const repository = createRepository({
      storePath
    });
    const secondaryUserId = "user-secondary";
    const createdAt = nowIso();
    const agentId = `agent-actor-${Date.now()}`;

    await repository.seedDefaults(SYSTEM_USER_ID);
    await repository.seedDefaults(secondaryUserId);

    const agent = await repository.saveAgent(
      AgentDefinitionSchema.parse({
        id: agentId,
        userId: SYSTEM_USER_ID,
        name: "private-ops",
        displayName: "Private Ops",
        description: "Handles private operational workflows.",
        icon: "ops",
        category: "custom",
        tags: ["ops"],
        systemPrompt: "Review operational signals and propose the next action plan.",
        promptVariables: [],
        artifactType: "summary",
        behaviorConfig: {
          temperature: 0.4,
          maxTokens: 1200,
          topP: 1,
          frequencyPenalty: 0,
          presencePenalty: 0,
          responseStyle: "balanced",
          formality: "professional"
        },
        allowedCapabilities: ["read", "search"],
        blockedCapabilities: [],
        maxRiskClass: "R2",
        integrationPermissions: [],
        memoryPermissions: [],
        actorContext: systemActor,
        isBuiltIn: false,
        parentAgentId: null,
        version: 1,
        status: "active",
        createdAt,
        updatedAt: createdAt
      })
    );

    const reloadedRepository = createRepository({
      storePath
    });
    const visible = await reloadedRepository.getAgent(agent.id, SYSTEM_USER_ID);
    const hidden = await reloadedRepository.getAgent(agent.id, secondaryUserId);
    const persistedBeforeDelete = JSON.parse(await readFile(storePath, "utf8")) as {
      agents: Array<{ id: string; actorContext: unknown }>;
    };

    await reloadedRepository.deleteAgent(agent.id, secondaryUserId);
    const stillVisible = await reloadedRepository.getAgent(agent.id, SYSTEM_USER_ID);

    await reloadedRepository.deleteAgent(agent.id, SYSTEM_USER_ID);
    const deleted = await reloadedRepository.getAgent(agent.id, SYSTEM_USER_ID);

    expect(visible).toMatchObject({
      id: agent.id,
      actorContext: systemActor
    });
    expect(hidden).toBeNull();
    expect(
      persistedBeforeDelete.agents.some(
        (candidate) =>
          candidate.id === agent.id &&
          JSON.stringify(candidate.actorContext) === JSON.stringify(systemActor)
      )
    ).toBe(true);
    expect(stillVisible).toMatchObject({
      id: agent.id
    });
    expect(deleted).toBeNull();
  });

  it("persists workflow canvas templates across repository reloads", async () => {
    const tempDir = await mkdtemp(path.join(os.tmpdir(), "agentic-repo-"));
    const storePath = path.join(tempDir, "runtime-store.json");
    const repository = createRepository({
      storePath
    });

    await repository.seedDefaults(SYSTEM_USER_ID);

    const createdAt = nowIso();
    const template = await repository.saveWorkflowTemplate({
      id: "workflow-template-1",
      userId: SYSTEM_USER_ID,
      name: "Morning ops sweep",
      description: "Review overnight alerts before the day starts.",
      nodes: [
        {
          id: "trigger-1",
          type: "trigger",
          label: "Schedule",
          icon: "clock",
          position: { x: 40, y: 80 },
          config: {
            cron: "0 8 * * *"
          }
        },
        {
          id: "agent-1",
          type: "agent",
          agentId: "operations",
          label: "Operations agent",
          icon: "bot",
          position: { x: 220, y: 80 },
          config: {
            prompt: "Check overnight signals and summarize anything urgent."
          }
        }
      ],
      edges: [
        {
          id: "edge-1",
          source: "trigger-1",
          target: "agent-1"
        }
      ],
      triggers: [
        {
          type: "schedule",
          config: {
            cron: "0 8 * * *",
            timezone: "Asia/Singapore"
          }
        }
      ],
      actorContext: systemActor,
      createdAt,
      updatedAt: createdAt
    });

    const reloadedRepository = createRepository({
      storePath
    });
    const [listed, loaded] = await Promise.all([
      reloadedRepository.listWorkflowTemplates(SYSTEM_USER_ID),
      reloadedRepository.getWorkflowTemplate(template.id, SYSTEM_USER_ID)
    ]);
    const persisted = JSON.parse(await readFile(storePath, "utf8")) as {
      workflowTemplates: Array<{ id: string }>;
    };

    expect(listed).toHaveLength(1);
    expect(listed[0]).toMatchObject({
      id: template.id,
      name: "Morning ops sweep",
      actorContext: systemActor
    });
    expect(loaded).toMatchObject({
      id: template.id,
      actorContext: systemActor,
      triggers: [
        expect.objectContaining({
          type: "schedule"
        })
      ]
    });
    expect(persisted.workflowTemplates.some((candidate) => candidate.id === template.id)).toBe(true);
  });

  it("persists goal templates with actor attribution across repository reloads", async () => {
    const tempDir = await mkdtemp(path.join(os.tmpdir(), "agentic-repo-"));
    const storePath = path.join(tempDir, "runtime-store.json");
    const repository = createRepository({
      storePath
    });

    await repository.seedDefaults(SYSTEM_USER_ID);

    const createdAt = nowIso();
    const template = await repository.saveTemplate(
      GoalTemplateSchema.parse({
        id: "goal-template-actor-1",
        userId: SYSTEM_USER_ID,
        name: "Daily inbox review",
        description: "Review priority inbox items.",
        request: "Review my inbox and prepare the next response plan.",
        parameters: {},
        schedule: {
          enabled: true,
          cron: "0 9 * * *",
          timezone: "UTC",
          lastRunAt: null,
          nextRunAt: null
        },
        actorContext: systemActor,
        createdAt,
        updatedAt: createdAt
      })
    );

    const reloadedRepository = createRepository({
      storePath
    });
    const listed = await reloadedRepository.listTemplates(SYSTEM_USER_ID);
    const listedTemplate = listed.find((candidate) => candidate.id === template.id);
    const persisted = JSON.parse(await readFile(storePath, "utf8")) as {
      templates: Array<{ id: string; actorContext: unknown }>;
    };

    expect(listed.some((candidate) => candidate.id === "template-builtin-inbox-triage")).toBe(true);
    expect(listedTemplate).toMatchObject({
      id: template.id,
      actorContext: systemActor
    });
    expect(
      persisted.templates.some(
        (candidate) =>
          candidate.id === template.id &&
          JSON.stringify(candidate.actorContext) === JSON.stringify(systemActor)
      )
    ).toBe(true);
  });
});
