import { readFile, writeFile, mkdir, rename, unlink } from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";
import { z } from "zod";
import {
  SYSTEM_USER_ID,
  nowIso,
  clone,
  createSystemActorContext,
  deriveGoalResponsibility,
  deriveTaskResponsibility,
  deriveApprovalResponsibility,
  deriveWatcherResponsibility,
  deriveAutopilotEventResponsibility,
  ActorContextSchema,
  GoalSchema,
  GoalShareRecordSchema,
  GoalShareStatusSchema,
  GoalTemplateSchema,
  IntegrationAccountSchema,
  JobRecordSchema,
  MemoryRecordSchema,
  OperatorProductSchema,
  OperatorProductSelectionSchema,
  PrivacyOperationKindSchema,
  PrivacyOperationSchema,
  PrivacyOperationStatusSchema,
  ProviderCredentialSchema,
  ProviderCredentialSecretRecordSchema,
  TaskSchema,
  GoalBundleSchema,
  WatcherSchema,
  AutopilotEventSchema,
  WorkflowCanvasTemplateSchema,
  WorkflowStateSchema,
  WorkspaceSchema,
  WorkspaceMemberSchema,
  WorkspaceGovernanceSchema,
  WorkspaceSelectionSchema,
  BriefingPreferencesSchema,
  AutopilotSettingsSchema,
  DEFAULT_AUTOPILOT_RELIABILITY_CONTROLS,
  AgentDefinitionSchema,
  briefingTypeValues,
  type ActorContext,
  type AgentDefinition,
  type AutopilotEvent,
  type AutopilotSettings,
  type BriefingPreferences,
  type Goal,
  type GoalBundle,
  type GoalShareRecord,
  type GoalShareStatus,
  type IntegrationAccount,
  type JobRecord,
  type MemoryRecord,
  type PrivacyOperation,
  type PrivacyOperationKind,
  type PrivacyOperationStatus,
  type ProviderCredential,
  type ProviderCredentialSecretRecord,
  type Watcher,
  type Workspace,
  type WorkspaceGovernance,
  type WorkspaceMember,
  type WorkspaceSelection
} from "@agentic/contracts";
import { buildDefaultIntegrationAccounts } from "@agentic/integrations";
import { createMemoryRecord } from "@agentic/memory";
import { buildApprovalResponseMutation } from "./approval-response-helpers";
import { PolicyRuleRecordSchema, RuntimeStoreSchema, type RuntimeStore } from "./runtime-store-schema";
import { resolveWorkspaceGovernanceDefaultsFromEnv } from "./governance-defaults";
import { defaultAgents, defaultOperatorProducts } from "./built-in-catalog";
import { ApprovalMutationError, type GoalShareListFilters, type PrivacyOperationListFilters } from "./repository-types";
import { resolveDefaultTimezone } from "./repository-constants";

export async function normalizeStore(raw: string): Promise<RuntimeStore> {
  return RuntimeStoreSchema.parse(JSON.parse(raw) as unknown);
}

export function isStoreCorruptionError(error: unknown): boolean {
  return error instanceof SyntaxError || error instanceof z.ZodError;
}

export function createEmptyStore(): RuntimeStore {
  return RuntimeStoreSchema.parse({
    version: 1,
    users: [],
    goals: [],
    workflows: [],
    tasks: [],
    memories: [],
    approvals: [],
    actionLogs: [],
    watchers: [],
    integrations: [],
    providerCredentials: [],
    providerCredentialSecrets: [],
    providerSideEffects: [],
    artifacts: [],
    workspaces: [],
    workspaceMembers: [],
    workspaceSelections: [],
    workspaceGovernance: [],
    goalShares: [],
    privacyOperations: [],
    commitments: [],
    policyRules: [],
    templates: [],
    workflowTemplates: [],
    autopilotSettings: [],
    autopilotEvents: [],
    jobs: [],
    agents: [],
    agentMetrics: [],
    briefingPreferences: [],
    operatorProducts: [],
    operatorProductSelections: []
  });
}

export function upsertById<T extends { id: string }>(items: T[], nextItem: T): T[] {
  return [...items.filter((item) => item.id !== nextItem.id), nextItem];
}

export function upsertByKey<T>(items: T[], nextItem: T, getKey: (item: T) => string): T[] {
  const nextKey = getKey(nextItem);
  return [...items.filter((item) => getKey(item) !== nextKey), nextItem];
}

export function uniqueById<T extends { id: string }>(items: T[]): T[] {
  const map = new Map<string, T>();
  for (const item of items) {
    map.set(item.id, item);
  }
  return [...map.values()];
}

export function normalizeGoalBundleResponsibilities(bundle: GoalBundle): GoalBundle {
  const validated = GoalBundleSchema.parse(bundle);
  const tasksById = new Map(validated.tasks.map((task) => [task.id, task] as const));
  const goalResponsibility = deriveGoalResponsibility({
    userId: validated.goal.userId,
    workspaceId: validated.goal.workspaceId
  });

  return GoalBundleSchema.parse({
    ...validated,
    goal: {
      ...validated.goal,
      responsibility: goalResponsibility
    },
    tasks: validated.tasks.map((task) => ({
      ...task,
      responsibility: deriveTaskResponsibility({
        assignedAgent: task.assignedAgent,
        requiresApproval: task.requiresApproval,
        ownerUserId: validated.goal.userId,
        workspaceId: validated.goal.workspaceId
      })
    })),
    approvals: validated.approvals.map((approval) => ({
      ...approval,
      responsibility: deriveApprovalResponsibility({
        ownerUserId: validated.goal.userId,
        workspaceId: validated.goal.workspaceId,
        delegateAgent: tasksById.get(approval.taskId)?.assignedAgent ?? null
      })
    })),
    watchers: validated.watchers.map((watcher) => ({
      ...watcher,
      responsibility: deriveWatcherResponsibility({
        ownerUserId: validated.goal.userId,
        workspaceId: validated.goal.workspaceId,
        createdByUserId: watcher.actorContext?.subjectUserId ?? null,
        targetEntity: watcher.targetEntity
      })
    }))
  });
}

export function personalWorkspaceIdForUser(userId: string): string {
  return `workspace-personal-${userId}`;
}

export function personalWorkspaceSlugForUser(userId: string): string {
  return userId === SYSTEM_USER_ID ? "personal" : `personal-${userId.toLowerCase()}`;
}

export function defaultWorkspace(userId: string): Workspace {
  const timestamp = nowIso();
  return WorkspaceSchema.parse({
    id: personalWorkspaceIdForUser(userId),
    ownerUserId: userId,
    slug: personalWorkspaceSlugForUser(userId),
    name: "Personal Workspace",
    description: "Default workspace for personal planning and execution.",
    isPersonal: true,
    createdAt: timestamp,
    updatedAt: timestamp
  });
}

export function defaultWorkspaceMember(workspaceId: string, userId: string): WorkspaceMember {
  const timestamp = nowIso();
  return WorkspaceMemberSchema.parse({
    id: `workspace-member-${workspaceId}-${userId}`,
    workspaceId,
    userId,
    role: "owner",
    joinedAt: timestamp,
    updatedAt: timestamp
  });
}

export function defaultWorkspaceGovernance(workspaceId: string, updatedBy: string): WorkspaceGovernance {
  const timestamp = nowIso();
  return WorkspaceGovernanceSchema.parse({
    workspaceId,
    ...resolveWorkspaceGovernanceDefaultsFromEnv(),
    updatedBy,
    createdAt: timestamp,
    updatedAt: timestamp
  });
}

export function workspaceIdsForUser(store: RuntimeStore, userId: string): Set<string> {
  return new Set(
    store.workspaceMembers
      .filter((member) => member.userId === userId)
      .map((member) => member.workspaceId)
  );
}

export function listWorkspacesForUserFromStore(store: RuntimeStore, userId: string): Workspace[] {
  const visibleWorkspaceIds = workspaceIdsForUser(store, userId);
  return store.workspaces
    .filter((workspace) => visibleWorkspaceIds.has(workspace.id))
    .sort((left, right) => {
      if (left.isPersonal !== right.isPersonal) {
        return left.isPersonal ? -1 : 1;
      }
      return left.name.localeCompare(right.name);
    })
    .map((workspace) => WorkspaceSchema.parse(clone(workspace)));
}

export function normalizeWorkspaceSelectionForUser(store: RuntimeStore, userId: string): WorkspaceSelection | null {
  const selection = store.workspaceSelections.find((candidate) => candidate.userId === userId) ?? null;
  if (!selection) return null;
  const workspaceIds = workspaceIdsForUser(store, userId);
  return workspaceIds.has(selection.workspaceId) ? selection : null;
}

export function defaultMemories(userId: string): MemoryRecord[] {
  return [
    createMemoryRecord({
      userId,
      category: "working-style",
      memoryType: "confirmed",
      content: "The instance owner prefers auditable plans with explicit trade-offs, validation evidence, and exact run commands.",
      confidence: 0.99,
      source: "project-default",
      sensitivity: "internal",
      permissions: ["orchestrator", "workflow", "knowledge"]
    }),
    createMemoryRecord({
      userId,
      category: "product-scope",
      memoryType: "observed",
      content: "The current Agentic MVP targets a single trusted user and defaults to provider-neutral adapters.",
      confidence: 0.94,
      source: "project-default",
      sensitivity: "internal",
      permissions: ["orchestrator", "research", "workflow", "knowledge"]
    })
  ];
}

export function defaultPolicyRules(userId: string) {
  const timestamp = nowIso();
  return [
    PolicyRuleRecordSchema.parse({
      id: "policy-risk-r3",
      userId,
      name: "Approval for external commitments",
      description: "Require approval before sending messages or changing calendar commitments.",
      active: true,
      createdAt: timestamp,
      updatedAt: timestamp
    }),
    PolicyRuleRecordSchema.parse({
      id: "policy-risk-r4",
      userId,
      name: "Block irreversible actions",
      description: "Block deletes and sensitive approvals until an explicit override exists.",
      active: true,
      createdAt: timestamp,
      updatedAt: timestamp
    })
  ];
}

export function defaultBriefingPreferences(userId: string): BriefingPreferences {
  const timestamp = nowIso();
  return BriefingPreferencesSchema.parse({
    userId,
    timezone: resolveDefaultTimezone(),
    focus: "balanced",
    schedules: briefingTypeValues.map((type, index) => ({
      type,
      enabled: type === "startup",
      time: ["08:00", "12:30", "09:00", "17:30", "18:00"][index]
    })),
    createdAt: timestamp,
    updatedAt: timestamp
  });
}

export function defaultAutopilotSettings(userId: string): AutopilotSettings {
  const timestamp = nowIso();
  return AutopilotSettingsSchema.parse({
    userId,
    mode: "notify_only",
    debounceMinutes: 15,
    reliabilityControls: DEFAULT_AUTOPILOT_RELIABILITY_CONTROLS,
    actorContext: null,
    createdAt: timestamp,
    updatedAt: timestamp
  });
}

export function integrationStoreKey(account: Pick<IntegrationAccount, "id" | "userId">): string {
  return `${account.userId}:${account.id}`;
}

export function workspaceMemberStoreKey(member: Pick<WorkspaceMember, "workspaceId" | "userId">): string {
  return `${member.workspaceId}:${member.userId}`;
}

export function providerCredentialStoreKey(credential: Pick<ProviderCredential, "id" | "userId">): string {
  return `${credential.userId}:${credential.id}`;
}

export function providerCredentialSecretStoreKey(
  record: Pick<ProviderCredentialSecretRecord, "credentialId" | "kind" | "userId">
): string {
  return `${record.userId}:${record.credentialId}:${record.kind}`;
}

export function goalShareFingerprintStoreKey(share: Pick<GoalShareRecord, "tokenFingerprint">): string {
  return share.tokenFingerprint.toLowerCase();
}

export function resolveAgentFromDefinitions(
  agents: AgentDefinition[],
  agentIdOrName: string,
  userId?: string
): AgentDefinition | null {
  const normalized = agentIdOrName.trim();
  if (!normalized) return null;
  const visibleAgents = userId
    ? agents.filter((agent) => agent.isBuiltIn || agent.userId === userId)
    : agents;
  return (
    visibleAgents.find((agent) => agent.id === normalized) ??
    visibleAgents.find((agent) => agent.name === normalized) ??
    null
  );
}

export function parseActorContext(actor: ActorContext): ActorContext {
  return ActorContextSchema.parse(actor);
}

export function subjectUserIdForActor(actor: ActorContext): string {
  return parseActorContext(actor).subjectUserId;
}

export function governanceUpdatedByForActor(actor: ActorContext): string {
  const parsed = parseActorContext(actor);
  return parsed.initiator.userId ?? parsed.subjectUserId;
}

export function isGoalVisibleToUser(goal: GoalBundle["goal"], workspaceIds: Set<string>, userId: string): boolean {
  if (goal.workspaceId) {
    return workspaceIds.has(goal.workspaceId);
  }
  return goal.userId === userId;
}

export function visibleGoalsForUser(store: RuntimeStore, userId: string): GoalBundle["goal"][] {
  const workspaceIds = workspaceIdsForUser(store, userId);
  return store.goals.filter((goal) => isGoalVisibleToUser(goal, workspaceIds, userId));
}

export function goalIdsForUser(store: RuntimeStore, userId: string): Set<string> {
  return new Set(visibleGoalsForUser(store, userId).map((goal) => goal.id));
}

export function getWorkspaceMemberFromStore(store: RuntimeStore, workspaceId: string, userId: string): WorkspaceMember | null {
  return (
    store.workspaceMembers.find(
      (member) => member.workspaceId === workspaceId && member.userId === userId
    ) ?? null
  );
}

export function assertWorkspaceMember(store: RuntimeStore, workspaceId: string, userId: string): WorkspaceMember {
  const member = getWorkspaceMemberFromStore(store, workspaceId, userId);
  if (!member) {
    throw new Error(`User ${userId} does not have access to workspace ${workspaceId}.`);
  }
  return member;
}

export function assertWorkspaceOwner(store: RuntimeStore, workspaceId: string, userId: string): WorkspaceMember {
  const member = assertWorkspaceMember(store, workspaceId, userId);
  if (member.role !== "owner") {
    throw new Error(`User ${userId} cannot administer workspace ${workspaceId}.`);
  }
  return member;
}

export function assertWorkspaceExistsInStore(store: RuntimeStore, workspaceId: string): Workspace {
  const workspace = store.workspaces.find((candidate) => candidate.id === workspaceId);
  if (!workspace) {
    throw new Error(`Workspace ${workspaceId} was not found.`);
  }
  return workspace;
}

export function assertSharedApprovalResponder(
  store: RuntimeStore,
  goal: GoalBundle["goal"],
  userId: string,
  approvalId: string
): void {
  if (!goal.workspaceId) return;
  const member = getWorkspaceMemberFromStore(store, goal.workspaceId, userId);
  if (!member) {
    throw new ApprovalMutationError("not_found", `Approval ${approvalId} was not found.`);
  }
  if (member.role !== "owner") {
    throw new ApprovalMutationError("forbidden", "Only the workspace owner can respond to shared approvals.");
  }
}

export function goalByIdFromStore(store: RuntimeStore, goalId: string): GoalBundle["goal"] | null {
  return store.goals.find((candidate) => candidate.id === goalId) ?? null;
}

export function watcherByIdFromStore(store: RuntimeStore, watcherId: string): Watcher | null {
  return store.watchers.find((candidate) => candidate.id === watcherId) ?? null;
}

export function isGoalIdVisibleToUser(
  store: RuntimeStore,
  goalId: string,
  workspaceIds: Set<string>,
  userId: string
): boolean {
  const goal = goalByIdFromStore(store, goalId);
  return goal ? isGoalVisibleToUser(goal, workspaceIds, userId) : false;
}

export function isJobVisibleToUserInStore(
  store: RuntimeStore,
  job: JobRecord,
  workspaceIds: Set<string>,
  userId: string
): boolean {
  if (job.userId === userId) return true;
  switch (job.payload.type) {
    case "goal_create":
    case "goal_refine":
    case "briefing_create":
    case "template_run":
    case "approval_follow_up":
    case "approval_notification":
      return (
        (job.payload.workspaceId ? workspaceIds.has(job.payload.workspaceId) : false) ||
        isGoalIdVisibleToUser(store, job.payload.goalId, workspaceIds, userId)
      );
    case "public_share_view":
      return isGoalIdVisibleToUser(store, job.payload.goalId, workspaceIds, userId);
    case "privacy_operation":
    case "github_issue_intake":
      return job.payload.workspaceId ? workspaceIds.has(job.payload.workspaceId) : false;
    case "autopilot_process": {
      const watcher = watcherByIdFromStore(store, job.payload.sourceId);
      const goal = watcher ? goalByIdFromStore(store, watcher.goalId) : null;
      return goal?.workspaceId ? workspaceIds.has(goal.workspaceId) : false;
    }
    case "docs_render":
      return false;
    default:
      return false;
  }
}

export function isGoalShareVisibleToUser(store: RuntimeStore, share: GoalShareRecord, userId: string): boolean {
  const goal = goalByIdFromStore(store, share.goalId);
  if (!goal) return false;
  const workspaceIds = workspaceIdsForUser(store, userId);
  return isGoalVisibleToUser(goal, workspaceIds, userId);
}

export function normalizeGoalShareFilters(filters?: GoalShareListFilters): GoalShareListFilters {
  return {
    userId: filters?.userId ?? SYSTEM_USER_ID,
    goalId: filters?.goalId,
    workspaceId: filters?.workspaceId,
    statuses: filters?.statuses?.map((status) => GoalShareStatusSchema.parse(status))
  };
}

export function normalizePrivacyOperationFilters(filters?: PrivacyOperationListFilters): PrivacyOperationListFilters {
  return {
    userId: filters?.userId ?? SYSTEM_USER_ID,
    workspaceId: filters?.workspaceId,
    kinds: filters?.kinds?.map((kind) => PrivacyOperationKindSchema.parse(kind)),
    statuses: filters?.statuses?.map((status) => PrivacyOperationStatusSchema.parse(status))
  };
}

export function isGoalInActiveWorkspaceScope(
  goal: Pick<Goal, "workspaceId" | "userId">,
  activeWorkspace: Workspace | null,
  userId: string
): boolean {
  if (!activeWorkspace) return false;
  if (goal.workspaceId) {
    return goal.workspaceId === activeWorkspace.id;
  }
  return activeWorkspace.isPersonal && goal.userId === userId;
}

export function filterBundlesForWorkspace(
  bundles: GoalBundle[],
  activeWorkspace: Workspace | null,
  userId: string
): GoalBundle[] {
  return bundles.filter((bundle) => isGoalInActiveWorkspaceScope(bundle.goal, activeWorkspace, userId));
}

export function listWorkspaceMembersForWorkspaceFromStore(store: RuntimeStore, workspaceId: string): WorkspaceMember[] {
  return store.workspaceMembers
    .filter((member) => member.workspaceId === workspaceId)
    .sort((left, right) => left.joinedAt.localeCompare(right.joinedAt))
    .map((member) => WorkspaceMemberSchema.parse(clone(member)));
}

export function resolveActiveWorkspaceFromStore(store: RuntimeStore, userId: string): {
  activeWorkspace: Workspace | null;
  workspaceSelection: WorkspaceSelection | null;
} {
  const availableWorkspaces = listWorkspacesForUserFromStore(store, userId);
  const selected = normalizeWorkspaceSelectionForUser(store, userId);
  const activeWorkspace =
    availableWorkspaces.find((workspace) => workspace.id === selected?.workspaceId) ??
    availableWorkspaces.find((workspace) => workspace.isPersonal) ??
    availableWorkspaces[0] ??
    null;

  if (!activeWorkspace) {
    return {
      activeWorkspace: null,
      workspaceSelection: selected
    };
  }

  return {
    activeWorkspace,
    workspaceSelection:
      selected && selected.workspaceId === activeWorkspace.id
        ? selected
        : WorkspaceSelectionSchema.parse({
            userId,
            workspaceId: activeWorkspace.id,
            selectedAt: selected?.selectedAt ?? activeWorkspace.updatedAt,
            updatedAt: selected?.updatedAt ?? activeWorkspace.updatedAt
          })
  };
}

export function bundleFromStore(store: RuntimeStore, goalId: string): GoalBundle | null {
  const goal = store.goals.find((candidate) => candidate.id === goalId);
  if (!goal) return null;
  const workflow = store.workflows.find((candidate) => candidate.id === goal.workflowId);
  if (!workflow) {
    throw new Error(`Workflow ${goal.workflowId} is missing for goal ${goalId}.`);
  }
  return normalizeGoalBundleResponsibilities(
    GoalBundleSchema.parse({
      goal,
      workflow,
      tasks: store.tasks.filter((task) => task.goalId === goalId).sort((left, right) => left.createdAt.localeCompare(right.createdAt)),
      artifacts: store.artifacts.filter((artifact) => artifact.goalId === goalId).sort((left, right) => left.createdAt.localeCompare(right.createdAt)),
      approvals: store.approvals.filter((approval) => approval.goalId === goalId).sort((left, right) => left.createdAt.localeCompare(right.createdAt)),
      watchers: store.watchers.filter((watcher) => watcher.goalId === goalId).sort((left, right) => left.createdAt.localeCompare(right.createdAt)),
      actionLogs: store.actionLogs.filter((log) => log.goalId === goalId).sort((left, right) => left.createdAt.localeCompare(right.createdAt))
    })
  );
}

export function mergeGoalBundleIntoStore(store: RuntimeStore, bundle: GoalBundle): GoalBundle {
  const validated = normalizeGoalBundleResponsibilities(GoalBundleSchema.parse(bundle));
  const goalId = validated.goal.id;

  store.goals = upsertById(store.goals, validated.goal);
  store.workflows = upsertById(store.workflows, validated.workflow);
  store.tasks = store.tasks.filter((task) => task.goalId !== goalId);
  store.artifacts = store.artifacts.filter((artifact) => artifact.goalId !== goalId);
  store.approvals = store.approvals.filter((approval) => approval.goalId !== goalId);
  store.watchers = store.watchers.filter((watcher) => watcher.goalId !== goalId);
  store.actionLogs = store.actionLogs.filter((log) => log.goalId !== goalId);

  for (const task of validated.tasks) {
    store.tasks = upsertById(store.tasks, task);
  }
  for (const artifact of validated.artifacts) {
    store.artifacts = upsertById(store.artifacts, artifact);
  }
  for (const approval of validated.approvals) {
    store.approvals = upsertById(store.approvals, approval);
  }
  for (const watcher of validated.watchers) {
    store.watchers = upsertById(store.watchers, watcher);
  }
  store.actionLogs = uniqueById([...store.actionLogs, ...validated.actionLogs]);
  return validated;
}

export function normalizeWatcherForGoal(goal: GoalBundle["goal"], watcher: Watcher): Watcher {
  const validated = WatcherSchema.parse(watcher);
  return WatcherSchema.parse({
    ...validated,
    responsibility: deriveWatcherResponsibility({
      ownerUserId: goal.userId,
      workspaceId: goal.workspaceId,
      createdByUserId: validated.actorContext?.subjectUserId ?? null,
      targetEntity: validated.targetEntity
    })
  });
}

export function normalizeAutopilotEvent(event: AutopilotEvent): AutopilotEvent {
  const validated = AutopilotEventSchema.parse(event);
  return AutopilotEventSchema.parse({
    ...validated,
    responsibility: deriveAutopilotEventResponsibility({
      userId: validated.userId,
      mode: validated.mode
    })
  });
}

export function normalizeProvenanceCollectionLimit(value: number | undefined): number | null {
  return value === undefined ? null : Math.max(1, Math.min(Math.trunc(value), 500));
}
