import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  AgentDefinitionSchema,
  GoalTemplateSchema,
  SYSTEM_USER_ID,
  WatcherSchema,
  WorkspaceGovernanceSchema,
  WorkspaceMemberSchema,
  WorkspaceSchema,
  WorkspaceSelectionSchema,
  briefingTypeValues,
  createSystemActorContext,
  nowIso
} from "@agentic/contracts";
import { buildDefaultIntegrationAccounts } from "@agentic/integrations";
import { createRepository } from "@agentic/repository";
import { generateBriefing, processUserRequest } from "@agentic/orchestrator";
import { createMemoryRecord } from "@agentic/memory";

describe("repository", () => {
  const systemActor = createSystemActorContext(SYSTEM_USER_ID);

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

  it("persists a goal bundle to the file-backed store", async () => {
    const tempDir = await mkdtemp(path.join(os.tmpdir(), "agentic-repo-"));
    const storePath = path.join(tempDir, "runtime-store.json");
    const repository = createRepository({
      storePath
    });

    await repository.seedDefaults(SYSTEM_USER_ID);

    const bundle = await createGoalForUser(repository, SYSTEM_USER_ID, "Plan my week around focus time and meetings.");

    const reloaded = await repository.getGoalBundle(bundle.goal.id);
    const persisted = JSON.parse(await readFile(storePath, "utf8")) as { goals: Array<{ id: string }> };

    expect(reloaded?.goal.id).toBe(bundle.goal.id);
    expect(persisted.goals.some((goal) => goal.id === bundle.goal.id)).toBe(true);
  });

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
  });

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

  const databaseUrl = process.env.DATABASE_URL;
  const postgresIt = databaseUrl ? it : it.skip;

  postgresIt("persists and reloads a goal bundle in Postgres when DATABASE_URL is configured", async () => {
    const repository = createRepository({
      databaseUrl
    });

    await repository.seedDefaults(SYSTEM_USER_ID);

    const bundle = await createGoalForUser(repository, SYSTEM_USER_ID, `Prepare a travel plan with approvals ${Date.now()}.`);

    const reloaded = await repository.getGoalBundle(bundle.goal.id);
    const dashboard = await repository.getDashboardData(SYSTEM_USER_ID);

    expect(reloaded?.goal.id).toBe(bundle.goal.id);
    expect(dashboard.goals.some((goalBundle) => goalBundle.goal.id === bundle.goal.id)).toBe(true);
  });

  postgresIt("captures durable evidence records for approval responses in Postgres when DATABASE_URL is configured", async () => {
    const repository = createRepository({
      databaseUrl
    });

    await expectApprovalEvidenceCapture(repository, "approved");
    await expectApprovalEvidenceCapture(repository, "rejected");
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
      approvalMode: "risk_based"
    });
  });

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

    expect(collaboratorDashboard.activeWorkspace?.id).toBe(sharedWorkspace.id);
    expect(collaboratorDashboard.goals.map((bundle) => bundle.goal.id)).toContain(sharedBundle.goal.id);
    expect(collaboratorDashboard.goals.map((bundle) => bundle.goal.id)).not.toContain(privateBundle.goal.id);
    expect(collaboratorSharedGoal?.goal.workspaceId).toBe(sharedWorkspace.id);
    expect(collaboratorPrivateGoal).toBeNull();

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
  });

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
  });

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
      debounceMinutes: 15
    });

    const updated = await repository.saveAutopilotSettings({
      ...defaults,
      mode: "auto_run",
      debounceMinutes: 45,
      actorContext: systemActor,
      updatedAt: nowIso()
    });

    const reloaded = await repository.getAutopilotSettings(SYSTEM_USER_ID);
    const dashboard = await repository.getDashboardData(SYSTEM_USER_ID);

    expect(updated).toMatchObject({
      mode: "auto_run",
      debounceMinutes: 45,
      actorContext: systemActor
    });
    expect(reloaded).toMatchObject({
      mode: "auto_run",
      debounceMinutes: 45,
      actorContext: systemActor
    });
    expect(dashboard.autopilotSettings).toMatchObject({
      mode: "auto_run",
      debounceMinutes: 45,
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
        watcherId: "watcher-vip-thread"
      },
      actorContext: systemActor,
      debounceMinutes: 15
    });

    const duplicateClaim = await repository.claimAutopilotEvent({
      userId: SYSTEM_USER_ID,
      kind: "watcher_triggered",
      sourceId: "watcher-vip-thread",
      idempotencyKey: "watcher-vip-thread-1",
      mode: "draft_goal",
      summary: "Watcher triggered for a VIP thread",
      actorContext: systemActor,
      debounceMinutes: 15
    });

    const debouncedClaim = await repository.claimAutopilotEvent({
      userId: SYSTEM_USER_ID,
      kind: "watcher_triggered",
      sourceId: "watcher-vip-thread",
      mode: "draft_goal",
      summary: "Watcher triggered again for the same source",
      actorContext: systemActor,
      debounceMinutes: 15
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
      debouncedByEventId: firstClaim.event.id
    });
    expect(debouncedClaim.event.processedAt).toBeTruthy();

    expect(events).toHaveLength(2);
    expect(events.map((event) => event.status).sort()).toEqual(["debounced", "pending"]);
    expect(events.every((event) => event.actorContext?.subjectUserId === systemActor.subjectUserId)).toBe(true);
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

    const dashboard = await repository.getDashboardData(SYSTEM_USER_ID);
    const expiredApprovals = dashboard.diagnostics.items.find((item) => item.kind === "expired_approvals");
    const staleMemories = dashboard.diagnostics.items.find((item) => item.kind === "stale_memories");
    const stuckWorkflows = dashboard.diagnostics.items.find((item) => item.kind === "stuck_workflows");
    const orphanWatchers = dashboard.diagnostics.items.find((item) => item.kind === "orphan_watchers");

    expect(dashboard.diagnostics.status).toBe("critical");
    expect(dashboard.diagnostics.totalCount).toBe(6);
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
      stats: expect.arrayContaining(["1 member", "1 ready integration", "Approval risk based"])
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
      targetSection: "approvals",
      targetItemId: "approval-expired",
      stats: expect.arrayContaining(["2 active goals", "2 running goals", "1 pending approval"])
    });
    expect(dashboard.controlPlane.sections.find((section) => section.key === "trust")).toMatchObject({
      status: "critical",
      targetSection: "approvals",
      targetItemId: "approval-expired",
      stats: expect.arrayContaining(["6 reliability signals", "2 stale memories", "Max auto R1"])
    });
    expect(dashboard.operatingSections.generatedAt).toBe(dashboard.diagnostics.generatedAt);
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
      targetSection: "approvals",
      targetItemId: "approval-expired",
      metrics: expect.arrayContaining(["2 active goals", "2 running goals", "1 recent artifact"])
    });
    expect(dashboard.operatingSections.sections.find((section) => section.key === "trust")).toMatchObject({
      status: "critical",
      targetSection: "approvals",
      targetItemId: "approval-expired",
      metrics: expect.arrayContaining(["6 reliability signals", "2 stale memories", "1 pending approval"])
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
      workspace: { id: string };
      governance: { approvalMode: string; requireAuditExports: boolean };
      goals: Array<{
        goal: { id: string };
        approvals: Array<{ id: string }>;
        actionLogs: Array<{ kind: string }>;
      }>;
    };

    expect(governance).toMatchObject({
      workspaceId: workspace.id,
      approvalMode: "always_review",
      requireAuditExports: true,
      retentionDays: 90
    });
    expect(audit.contentType).toBe("application/json");
    expect(audit.fileName).toContain(workspace.slug);
    expect(parsedAudit.workspace.id).toBe(workspace.id);
    expect(parsedAudit.governance).toMatchObject({
      approvalMode: "always_review",
      requireAuditExports: true
    });
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
    expect(Array.isArray(auditedGoal?.approvals)).toBe(true);
    expect(auditedGoal?.actionLogs.some((log) => log.kind === "goal.created")).toBe(true);
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

    const [seededIntegration] = await repository.listIntegrations(SYSTEM_USER_ID);

    expect(seededIntegration).toMatchObject({
      id: buildDefaultIntegrationAccounts(SYSTEM_USER_ID)[0]?.id,
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
    const persisted = JSON.parse(await readFile(storePath, "utf8")) as {
      templates: Array<{ id: string; actorContext: unknown }>;
    };

    expect(listed).toHaveLength(1);
    expect(listed[0]).toMatchObject({
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
