import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createRepository, type AgenticRepository } from "@agentic/repository";
import {
  SYSTEM_USER_ID,
  createSystemActorContext,
  nowIso
} from "@agentic/contracts";
import { mkdtemp, rm } from "node:fs/promises";
import path from "node:path";
import os from "node:os";

const PARITY_DATABASE_URL = process.env.AGENTIC_REPOSITORY_PARITY_DATABASE_URL?.trim();
const describePostgresParity = PARITY_DATABASE_URL ? describe : describe.skip;

describePostgresParity("Repository Parity", () => {
  let fileRepo: AgenticRepository;
  let pgRepo: AgenticRepository;
  let tempDir: string;
  const unique = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const systemActor = createSystemActorContext(SYSTEM_USER_ID);

  beforeAll(async () => {
    tempDir = await mkdtemp(path.join(os.tmpdir(), "agentic-test-"));
    fileRepo = createRepository({ storePath: path.join(tempDir, "store.json") });
    pgRepo = createRepository({ databaseUrl: PARITY_DATABASE_URL });

    // Seed defaults to start from a clean but initialized state
    await fileRepo.seedDefaults(SYSTEM_USER_ID);
    await pgRepo.seedDefaults(SYSTEM_USER_ID);
  });

  afterAll(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  it("should have consistent backend types", () => {
    expect(fileRepo.backend).toBe("file");
    expect(pgRepo.backend).toBe("postgres");
  });

  it("should maintain parity for Workspaces", async () => {
    const workspace = {
      id: `ws-parity-test-${unique}`,
      name: "Parity Test Workspace",
      isPersonal: false,
      ownerUserId: SYSTEM_USER_ID,
      slug: `ws-parity-test-${unique}`,
      createdAt: nowIso(),
      updatedAt: nowIso()
    };

    const savedFile = await fileRepo.saveWorkspace(workspace, systemActor);
    const savedPg = await pgRepo.saveWorkspace(workspace, systemActor);

    expect(savedFile.id).toBe(workspace.id);
    expect(savedPg.id).toBe(workspace.id);
    expect(savedFile.name).toBe(savedPg.name);

    const listFile = await fileRepo.listWorkspaces(SYSTEM_USER_ID);
    const listPg = await pgRepo.listWorkspaces(SYSTEM_USER_ID);

    const foundFile = listFile.find((w) => w.id === workspace.id);
    const foundPg = listPg.find((w) => w.id === workspace.id);

    expect(foundFile).toBeDefined();
    expect(foundPg).toBeDefined();
    expect(foundFile?.name).toBe(foundPg?.name);
  });

  it("should maintain parity for Memories", async () => {
    const memory = {
      id: `mem-parity-test-${unique}`,
      userId: SYSTEM_USER_ID,
      category: "core",
      memoryType: "observed",
      content: "Parity test memory content",
      confidence: 1.0,
      source: "test",
      sensitivity: "public",
      permissions: [],
      actorContext: systemActor,
      contextPacketConsent: { basis: "system" },
      agentId: null,
      agentScope: "global",
      reviewAt: null,
      expiryAt: null,
      createdAt: nowIso(),
      updatedAt: nowIso()
    };

    const savedFile = await fileRepo.saveMemory(memory);
    const savedPg = await pgRepo.saveMemory(memory);

    expect(savedFile.id).toBe(memory.id);
    expect(savedPg.id).toBe(memory.id);

    const listFile = await fileRepo.listMemory(SYSTEM_USER_ID);
    const listPg = await pgRepo.listMemory(SYSTEM_USER_ID);

    const foundFile = listFile.find((m) => m.id === memory.id);
    const foundPg = listPg.find((m) => m.id === memory.id);

    expect(foundFile?.content).toBe(foundPg?.content);
    expect(foundFile?.category).toBe(foundPg?.category);
  });

  it("should maintain parity for Jobs", async () => {
    const job = {
      id: `job-parity-test-${unique}`,
      userId: SYSTEM_USER_ID,
      kind: "goal_create",
      status: "queued",
      payload: {
        type: "goal_create",
        request: "test",
        goalId: `goal-test-${unique}`,
        workflowId: `wf-test-${unique}`
      },
      execution: { attempts: 0, journal: [] },
      recovery: { retryCount: 0, nextAttemptAt: null },
      maxAttempts: 3,
      attemptCount: 0,
      availableAt: nowIso(),
      lockId: null,
      lockExpiresAt: null,
      createdAt: nowIso(),
      updatedAt: nowIso()
    };

    const savedFile = await fileRepo.enqueueJob(job);
    const savedPg = await pgRepo.enqueueJob(job);

    expect(savedFile.id).toBe(job.id);
    expect(savedPg.id).toBe(job.id);

    const getFile = await fileRepo.getJob(job.id, SYSTEM_USER_ID);
    const getPg = await pgRepo.getJob(job.id, SYSTEM_USER_ID);

    expect(getFile?.kind).toBe(getPg?.kind);
    expect(getFile?.status).toBe(getPg?.status);
  });
});
