import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  MemoryRecordSchema,
  DEFAULT_OWNER_USER_ID,
  WorkerRuntimeHealthSnapshotSchema,
  WorkspaceSchema,
  createSystemActorContext,
  nowIso
} from "@agentic/contracts";
import { createJobRecord } from "@agentic/execution";
import { createRepository, type AgenticRepository } from "@agentic/repository";

const PARITY_DATABASE_URL = process.env.AGENTIC_REPOSITORY_PARITY_DATABASE_URL?.trim();
const parityDescribe = PARITY_DATABASE_URL ? describe : describe.skip;

parityDescribe("repository Postgres parity", () => {
  let fileRepository: AgenticRepository;
  let postgresRepository: AgenticRepository;
  let tempDir: string;

  const unique = `${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const actor = createSystemActorContext(DEFAULT_OWNER_USER_ID);

  beforeAll(async () => {
    tempDir = await mkdtemp(path.join(os.tmpdir(), "agentic-repository-parity-"));
    fileRepository = createRepository({
      storePath: path.join(tempDir, "runtime-store.json")
    });
    postgresRepository = createRepository({
      databaseUrl: PARITY_DATABASE_URL
    });

    await fileRepository.seedDefaults(DEFAULT_OWNER_USER_ID);
    await postgresRepository.seedDefaults(DEFAULT_OWNER_USER_ID);
  });

  afterAll(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  it("uses the expected repository backends", () => {
    expect(fileRepository.backend).toBe("file");
    expect(postgresRepository.backend).toBe("postgres");
  });

  it("records and reads the worker runtime heartbeat consistently", async () => {
    const runnerId = `runner-parity-${unique}`;
    const now = nowIso();
    const record = WorkerRuntimeHealthSnapshotSchema.parse({
      version: 1,
      runnerId,
      pid: 4242,
      status: "running",
      startedAt: now,
      updatedAt: now,
      processedCount: 2,
      lastProcessedAt: now,
      lastErrorAt: null,
      lastErrorClass: null,
      scheduler: {
        enabled: false,
        lastRunAt: null,
        lastCompletedAt: null,
        lastDecisionCount: null,
        lastErrorAt: null,
        lastErrorClass: null
      }
    });

    await fileRepository.recordWorkerRuntimeHealth(record);
    await postgresRepository.recordWorkerRuntimeHealth(record);

    const fileLatest = await fileRepository.getLatestWorkerRuntimeHealth();
    const postgresLatest = await postgresRepository.getLatestWorkerRuntimeHealth();

    expect(fileLatest?.runnerId).toBe(runnerId);
    expect(postgresLatest?.runnerId).toBe(runnerId);
    expect(postgresLatest?.processedCount).toBe(2);
    expect(postgresLatest).toEqual(fileLatest);
  });

  it("persists workspace membership consistently", async () => {
    const workspace = WorkspaceSchema.parse({
      id: `ws-parity-${unique}`,
      name: "Repository Parity Workspace",
      slug: `repository-parity-${unique}`,
      isPersonal: false,
      ownerUserId: DEFAULT_OWNER_USER_ID,
      createdAt: nowIso(),
      updatedAt: nowIso()
    });

    await fileRepository.saveWorkspace(workspace, actor);
    await postgresRepository.saveWorkspace(workspace, actor);

    const fileWorkspace = (await fileRepository.listWorkspaces(DEFAULT_OWNER_USER_ID)).find(
      (candidate) => candidate.id === workspace.id
    );
    const postgresWorkspace = (await postgresRepository.listWorkspaces(DEFAULT_OWNER_USER_ID)).find(
      (candidate) => candidate.id === workspace.id
    );

    expect(fileWorkspace).toMatchObject({
      id: workspace.id,
      name: workspace.name,
      slug: workspace.slug,
      ownerUserId: DEFAULT_OWNER_USER_ID
    });
    expect(postgresWorkspace).toMatchObject({
      id: workspace.id,
      name: fileWorkspace?.name,
      slug: fileWorkspace?.slug,
      ownerUserId: fileWorkspace?.ownerUserId
    });
  });

  it("persists memory records consistently", async () => {
    const memory = MemoryRecordSchema.parse({
      id: `mem-parity-${unique}`,
      userId: DEFAULT_OWNER_USER_ID,
      category: "core",
      memoryType: "observed",
      content: "Repository parity validation memory.",
      confidence: 1,
      source: "repository-parity-test",
      sensitivity: "public",
      permissions: [],
      actorContext: actor,
      contextPacketConsent: { basis: "system" },
      agentId: null,
      agentScope: "global",
      reviewAt: null,
      expiryAt: null,
      createdAt: nowIso(),
      updatedAt: nowIso()
    });

    await fileRepository.saveMemory(memory);
    await postgresRepository.saveMemory(memory);

    const fileMemory = (await fileRepository.listMemory(DEFAULT_OWNER_USER_ID)).find(
      (candidate) => candidate.id === memory.id
    );
    const postgresMemory = (await postgresRepository.listMemory(DEFAULT_OWNER_USER_ID)).find(
      (candidate) => candidate.id === memory.id
    );

    expect(fileMemory).toMatchObject({
      id: memory.id,
      content: memory.content,
      category: memory.category,
      sensitivity: memory.sensitivity
    });
    expect(postgresMemory).toMatchObject({
      id: memory.id,
      content: fileMemory?.content,
      category: fileMemory?.category,
      sensitivity: fileMemory?.sensitivity
    });
  });

  it("persists durable jobs consistently", async () => {
    const job = createJobRecord({
      id: `job-parity-${unique}`,
      userId: DEFAULT_OWNER_USER_ID,
      kind: "goal_create",
      payload: {
        type: "goal_create",
        goalId: `goal-parity-${unique}`,
        workflowId: `workflow-parity-${unique}`,
        request: "Validate repository parity against Postgres.",
        workspaceId: null,
        agentId: null,
        metadata: {}
      }
    });

    await fileRepository.enqueueJob(job);
    await postgresRepository.enqueueJob(job);

    const fileJob = await fileRepository.getJob(job.id, DEFAULT_OWNER_USER_ID);
    const postgresJob = await postgresRepository.getJob(job.id, DEFAULT_OWNER_USER_ID);

    expect(fileJob).toMatchObject({
      id: job.id,
      userId: DEFAULT_OWNER_USER_ID,
      kind: "goal_create",
      status: "queued"
    });
    expect(postgresJob).toMatchObject({
      id: job.id,
      userId: fileJob?.userId,
      kind: fileJob?.kind,
      status: fileJob?.status
    });
  });

  it("summarizes durable job readiness consistently", async () => {
    const staleQueued = createJobRecord({
      id: `job-readiness-queued-${unique}`,
      userId: DEFAULT_OWNER_USER_ID,
      kind: "goal_create",
      availableAt: "2026-04-16T03:40:00.000Z",
      payload: {
        type: "goal_create",
        goalId: `goal-readiness-queued-${unique}`,
        workflowId: `workflow-readiness-queued-${unique}`,
        request: "Validate readiness summary parity.",
        workspaceId: null,
        agentId: null,
        metadata: {}
      }
    });
    const expiredRunning = createJobRecord({
      id: `job-readiness-running-${unique}`,
      userId: DEFAULT_OWNER_USER_ID,
      kind: "docs_render",
      payload: {
        type: "docs_render",
        metadata: {}
      }
    });
    const deadLetter = createJobRecord({
      id: `job-readiness-dead-${unique}`,
      userId: DEFAULT_OWNER_USER_ID,
      kind: "docs_render",
      payload: {
        type: "docs_render",
        metadata: {}
      }
    });
    const records = [
      staleQueued,
      {
        ...expiredRunning,
        status: "running" as const,
        claimedBy: "worker-parity",
        claimedAt: "2026-04-16T03:30:00.000Z",
        leaseExpiresAt: "2026-04-16T03:59:00.000Z"
      },
      {
        ...deadLetter,
        status: "dead_letter" as const,
        deadLetteredAt: "2026-04-16T03:50:00.000Z",
        lastError: "Parity dead letter."
      }
    ];

    for (const record of records) {
      await fileRepository.enqueueJob(record);
      await postgresRepository.enqueueJob(record);
    }

    const fileSummary = await fileRepository.getJobReadinessSummary({
      now: "2026-04-16T04:00:00.000Z",
      maxPendingJobAgeMs: 15 * 60 * 1000
    });
    const postgresSummary = await postgresRepository.getJobReadinessSummary({
      now: "2026-04-16T04:00:00.000Z",
      maxPendingJobAgeMs: 15 * 60 * 1000
    });

    expect(postgresSummary).toEqual(fileSummary);
  });
});
