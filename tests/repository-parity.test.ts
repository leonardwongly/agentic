import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  MemoryRecordSchema,
  SYSTEM_USER_ID,
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
  const actor = createSystemActorContext(SYSTEM_USER_ID);

  beforeAll(async () => {
    tempDir = await mkdtemp(path.join(os.tmpdir(), "agentic-repository-parity-"));
    fileRepository = createRepository({
      storePath: path.join(tempDir, "runtime-store.json")
    });
    postgresRepository = createRepository({
      databaseUrl: PARITY_DATABASE_URL
    });

    await fileRepository.seedDefaults(SYSTEM_USER_ID);
    await postgresRepository.seedDefaults(SYSTEM_USER_ID);
  });

  afterAll(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  it("uses the expected repository backends", () => {
    expect(fileRepository.backend).toBe("file");
    expect(postgresRepository.backend).toBe("postgres");
  });

  it("persists workspace membership consistently", async () => {
    const workspace = WorkspaceSchema.parse({
      id: `ws-parity-${unique}`,
      name: "Repository Parity Workspace",
      slug: `repository-parity-${unique}`,
      isPersonal: false,
      ownerUserId: SYSTEM_USER_ID,
      createdAt: nowIso(),
      updatedAt: nowIso()
    });

    await fileRepository.saveWorkspace(workspace, actor);
    await postgresRepository.saveWorkspace(workspace, actor);

    const fileWorkspace = (await fileRepository.listWorkspaces(SYSTEM_USER_ID)).find(
      (candidate) => candidate.id === workspace.id
    );
    const postgresWorkspace = (await postgresRepository.listWorkspaces(SYSTEM_USER_ID)).find(
      (candidate) => candidate.id === workspace.id
    );

    expect(fileWorkspace).toMatchObject({
      id: workspace.id,
      name: workspace.name,
      slug: workspace.slug,
      ownerUserId: SYSTEM_USER_ID
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
      userId: SYSTEM_USER_ID,
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

    const fileMemory = (await fileRepository.listMemory(SYSTEM_USER_ID)).find(
      (candidate) => candidate.id === memory.id
    );
    const postgresMemory = (await postgresRepository.listMemory(SYSTEM_USER_ID)).find(
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
      userId: SYSTEM_USER_ID,
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

    const fileJob = await fileRepository.getJob(job.id, SYSTEM_USER_ID);
    const postgresJob = await postgresRepository.getJob(job.id, SYSTEM_USER_ID);

    expect(fileJob).toMatchObject({
      id: job.id,
      userId: SYSTEM_USER_ID,
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
});
