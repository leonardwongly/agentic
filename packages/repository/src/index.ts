import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { Pool, type PoolClient } from "pg";
import { z } from "zod";
import {
  ActionLogSchema,
  ApprovalRequestSchema,
  ArtifactSchema,
  GoalBundleSchema,
  GoalSchema,
  IntegrationAccountSchema,
  MemoryRecordSchema,
  SYSTEM_USER_ID,
  TaskSchema,
  WatcherSchema,
  WorkflowStateSchema,
  clone,
  nowIso,
  type ActionLog,
  type ApprovalRequest,
  type Artifact,
  type GoalBundle,
  type IntegrationAccount,
  type MemoryRecord,
  type Watcher
} from "@agentic/contracts";
import { buildDefaultIntegrationAccounts } from "@agentic/integrations";
import { createMemoryRecord } from "@agentic/memory";

const UserRecordSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  timezone: z.string().min(1),
  createdAt: z.string().datetime()
});

const PolicyRuleRecordSchema = z.object({
  id: z.string().min(1),
  userId: z.string().min(1),
  name: z.string().min(1),
  description: z.string().min(1),
  active: z.boolean(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime()
});

const RuntimeStoreSchema = z.object({
  version: z.literal(1),
  users: z.array(UserRecordSchema),
  goals: z.array(GoalSchema),
  workflows: z.array(WorkflowStateSchema),
  tasks: z.array(TaskSchema),
  memories: z.array(MemoryRecordSchema),
  approvals: z.array(ApprovalRequestSchema),
  actionLogs: z.array(ActionLogSchema),
  watchers: z.array(WatcherSchema),
  integrations: z.array(IntegrationAccountSchema),
  artifacts: z.array(ArtifactSchema),
  policyRules: z.array(PolicyRuleRecordSchema)
});

type RuntimeStore = z.infer<typeof RuntimeStoreSchema>;

export type DashboardData = {
  goals: GoalBundle[];
  approvals: ApprovalRequest[];
  memories: MemoryRecord[];
  watchers: Watcher[];
  integrations: IntegrationAccount[];
  latestArtifacts: Artifact[];
  actionLogs: ActionLog[];
};

export type WatcherListFilters = {
  userId?: string;
  goalId?: string;
};

export type AgenticRepository = {
  backend: "file" | "postgres";
  seedDefaults(userId?: string): Promise<void>;
  saveGoalBundle(bundle: GoalBundle): Promise<GoalBundle>;
  getGoalBundle(goalId: string): Promise<GoalBundle | null>;
  getGoalBundleForUser(goalId: string, userId?: string): Promise<GoalBundle | null>;
  listGoals(userId?: string): Promise<GoalBundle[]>;
  listApprovals(userId?: string): Promise<ApprovalRequest[]>;
  listMemory(userId?: string): Promise<MemoryRecord[]>;
  saveMemory(record: MemoryRecord): Promise<MemoryRecord>;
  listWatchers(filters?: WatcherListFilters): Promise<Watcher[]>;
  saveWatcher(watcher: Watcher): Promise<Watcher>;
  listIntegrations(userId?: string): Promise<IntegrationAccount[]>;
  upsertIntegration(account: IntegrationAccount): Promise<IntegrationAccount>;
  getDashboardData(userId?: string): Promise<DashboardData>;
};

const migrationPath = path.join(process.cwd(), "packages", "db", "migrations", "0001_init.sql");

function resolveDefaultStorePath(): string {
  const configured = process.env.AGENTIC_RUNTIME_STORE_PATH?.trim();

  if (configured) {
    return path.resolve(configured);
  }

  return path.join(process.cwd(), ".agentic", "runtime-store.json");
}

function createEmptyStore(): RuntimeStore {
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
    artifacts: [],
    policyRules: []
  });
}

function upsertById<T extends { id: string }>(items: T[], nextItem: T): T[] {
  return [...items.filter((item) => item.id !== nextItem.id), nextItem];
}

function uniqueById<T extends { id: string }>(items: T[]): T[] {
  const map = new Map<string, T>();

  for (const item of items) {
    map.set(item.id, item);
  }

  return [...map.values()];
}

function sortByCreatedDesc<T extends { createdAt: string }>(items: T[]): T[] {
  return [...items].sort((left, right) => right.createdAt.localeCompare(left.createdAt));
}

function defaultUser(userId: string) {
  return UserRecordSchema.parse({
    id: userId,
    name: "Leonard",
    timezone: process.env.TZ ?? "Asia/Singapore",
    createdAt: nowIso()
  });
}

function defaultPolicyRules(userId: string) {
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

function defaultMemories(userId: string): MemoryRecord[] {
  return [
    createMemoryRecord({
      userId,
      category: "working-style",
      memoryType: "confirmed",
      content: "Leonard prefers concise, auditable plans with explicit trade-offs and exact run commands.",
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

async function normalizeStore(raw: string): Promise<RuntimeStore> {
  return RuntimeStoreSchema.parse(JSON.parse(raw) as unknown);
}

function bundleFromStore(store: RuntimeStore, goalId: string): GoalBundle | null {
  const goal = store.goals.find((candidate) => candidate.id === goalId);

  if (!goal) {
    return null;
  }

  const workflow = store.workflows.find((candidate) => candidate.id === goal.workflowId);

  if (!workflow) {
    throw new Error(`Workflow ${goal.workflowId} is missing for goal ${goalId}.`);
  }

  return GoalBundleSchema.parse({
    goal,
    workflow,
    tasks: store.tasks.filter((task) => task.goalId === goalId).sort((left, right) => left.createdAt.localeCompare(right.createdAt)),
    artifacts: store.artifacts.filter((artifact) => artifact.goalId === goalId).sort((left, right) => left.createdAt.localeCompare(right.createdAt)),
    approvals: store.approvals.filter((approval) => approval.goalId === goalId).sort((left, right) => left.createdAt.localeCompare(right.createdAt)),
    watchers: store.watchers.filter((watcher) => watcher.goalId === goalId).sort((left, right) => left.createdAt.localeCompare(right.createdAt)),
    actionLogs: store.actionLogs.filter((log) => log.goalId === goalId).sort((left, right) => left.createdAt.localeCompare(right.createdAt))
  });
}

function assertGoalExistsInStore(store: RuntimeStore, goalId: string): void {
  if (!store.goals.some((goal) => goal.id === goalId)) {
    throw new Error(`Goal ${goalId} was not found.`);
  }
}

function goalIdsForUser(store: RuntimeStore, userId: string): Set<string> {
  return new Set(store.goals.filter((goal) => goal.userId === userId).map((goal) => goal.id));
}

class FileRepository implements AgenticRepository {
  backend = "file" as const;

  constructor(private readonly storePath = resolveDefaultStorePath()) {}

  private async readStore(): Promise<RuntimeStore> {
    try {
      return await normalizeStore(await readFile(this.storePath, "utf8"));
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);

      if (message.includes("ENOENT")) {
        const store = createEmptyStore();
        await this.writeStore(store);
        return store;
      }

      throw error;
    }
  }

  private async writeStore(store: RuntimeStore): Promise<void> {
    const validated = RuntimeStoreSchema.parse(store);
    const directory = path.dirname(this.storePath);
    const tempPath = `${this.storePath}.tmp`;

    await mkdir(directory, { recursive: true });
    await writeFile(tempPath, JSON.stringify(validated, null, 2), "utf8");
    await rename(tempPath, this.storePath);
  }

  async seedDefaults(userId = SYSTEM_USER_ID): Promise<void> {
    const store = await this.readStore();

    if (!store.users.find((user) => user.id === userId)) {
      store.users.push(defaultUser(userId));
    }

    if (!store.integrations.some((integration) => integration.userId === userId)) {
      store.integrations.push(...buildDefaultIntegrationAccounts(userId));
    }

    if (!store.memories.some((memory) => memory.userId === userId)) {
      store.memories.push(...defaultMemories(userId));
    }

    if (!store.policyRules.some((rule) => rule.userId === userId)) {
      store.policyRules.push(...defaultPolicyRules(userId));
    }

    await this.writeStore(store);
  }

  async saveGoalBundle(bundle: GoalBundle): Promise<GoalBundle> {
    const store = await this.readStore();
    const validated = GoalBundleSchema.parse(bundle);

    store.goals = upsertById(store.goals, validated.goal);
    store.workflows = upsertById(store.workflows, validated.workflow);

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
    await this.writeStore(store);

    return GoalBundleSchema.parse(clone(validated));
  }

  async getGoalBundle(goalId: string): Promise<GoalBundle | null> {
    const bundle = bundleFromStore(await this.readStore(), goalId);
    return bundle ? GoalBundleSchema.parse(clone(bundle)) : null;
  }

  async getGoalBundleForUser(goalId: string, userId = SYSTEM_USER_ID): Promise<GoalBundle | null> {
    const bundle = await this.getGoalBundle(goalId);

    if (!bundle || bundle.goal.userId !== userId) {
      return null;
    }

    return GoalBundleSchema.parse(clone(bundle));
  }

  async listGoals(userId = SYSTEM_USER_ID): Promise<GoalBundle[]> {
    const store = await this.readStore();

    return sortByCreatedDesc(store.goals.filter((goal) => goal.userId === userId))
      .map((goal) => bundleFromStore(store, goal.id))
      .filter((bundle): bundle is GoalBundle => bundle !== null)
      .map((bundle) => GoalBundleSchema.parse(clone(bundle)));
  }

  async listApprovals(userId = SYSTEM_USER_ID): Promise<ApprovalRequest[]> {
    const store = await this.readStore();
    const goalIds = goalIdsForUser(store, userId);

    return sortByCreatedDesc(store.approvals.filter((approval) => goalIds.has(approval.goalId))).map((approval) =>
      ApprovalRequestSchema.parse(clone(approval))
    );
  }

  async listMemory(userId = SYSTEM_USER_ID): Promise<MemoryRecord[]> {
    const store = await this.readStore();
    return sortByCreatedDesc(store.memories.filter((memory) => memory.userId === userId)).map((memory) =>
      MemoryRecordSchema.parse(clone(memory))
    );
  }

  async saveMemory(record: MemoryRecord): Promise<MemoryRecord> {
    const store = await this.readStore();
    const validated = MemoryRecordSchema.parse(record);
    store.memories = upsertById(store.memories, validated);
    await this.writeStore(store);
    return MemoryRecordSchema.parse(clone(validated));
  }

  async listWatchers(filters?: WatcherListFilters): Promise<Watcher[]> {
    const store = await this.readStore();
    const userId = filters?.userId ?? SYSTEM_USER_ID;
    const goalIds = goalIdsForUser(store, userId);
    const watchers = store.watchers.filter((watcher) => {
      if (!goalIds.has(watcher.goalId)) {
        return false;
      }

      return filters?.goalId ? watcher.goalId === filters.goalId : true;
    });

    return sortByCreatedDesc(watchers).map((watcher) => WatcherSchema.parse(clone(watcher)));
  }

  async saveWatcher(watcher: Watcher): Promise<Watcher> {
    const store = await this.readStore();
    const validated = WatcherSchema.parse(watcher);
    assertGoalExistsInStore(store, validated.goalId);
    store.watchers = upsertById(store.watchers, validated);
    await this.writeStore(store);
    return WatcherSchema.parse(clone(validated));
  }

  async listIntegrations(userId = SYSTEM_USER_ID): Promise<IntegrationAccount[]> {
    const store = await this.readStore();
    return sortByCreatedDesc(store.integrations.filter((integration) => integration.userId === userId)).map((integration) =>
      IntegrationAccountSchema.parse(clone(integration))
    );
  }

  async upsertIntegration(account: IntegrationAccount): Promise<IntegrationAccount> {
    const store = await this.readStore();
    const validated = IntegrationAccountSchema.parse(account);
    store.integrations = upsertById(store.integrations, validated);
    await this.writeStore(store);
    return IntegrationAccountSchema.parse(clone(validated));
  }

  async getDashboardData(userId = SYSTEM_USER_ID): Promise<DashboardData> {
    const [goals, approvals, memories, integrations, watchers] = await Promise.all([
      this.listGoals(userId),
      this.listApprovals(userId),
      this.listMemory(userId),
      this.listIntegrations(userId),
      this.listWatchers({ userId })
    ]);

    return {
      goals,
      approvals,
      memories,
      watchers,
      integrations,
      latestArtifacts: sortByCreatedDesc(goals.flatMap((bundle) => bundle.artifacts)).slice(0, 8),
      actionLogs: sortByCreatedDesc(goals.flatMap((bundle) => bundle.actionLogs)).slice(0, 20)
    };
  }
}

class PostgresRepository implements AgenticRepository {
  backend = "postgres" as const;
  private readonly pool: Pool;
  private readonly ready: Promise<void>;

  constructor(url: string) {
    this.pool = new Pool({ connectionString: url });
    this.ready = this.ensureSchema();
  }

  private async ensureSchema(): Promise<void> {
    await this.pool.query(await readFile(migrationPath, "utf8"));
  }

  private async withTransaction<T>(callback: (client: PoolClient) => Promise<T>): Promise<T> {
    await this.ready;
    const client = await this.pool.connect();

    try {
      await client.query("BEGIN");
      const result = await callback(client);
      await client.query("COMMIT");
      return result;
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  private async saveMemoryWithClient(client: PoolClient, record: MemoryRecord): Promise<void> {
    const memory = MemoryRecordSchema.parse(record);
    await client.query(
      `
        insert into memory_records (
          id, user_id, category, memory_type, content, confidence, source, sensitivity, permissions, review_at, expiry_at, created_at, updated_at
        )
        values ($1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb, $10, $11, $12, $13)
        on conflict (id) do update
        set category = excluded.category,
            memory_type = excluded.memory_type,
            content = excluded.content,
            confidence = excluded.confidence,
            source = excluded.source,
            sensitivity = excluded.sensitivity,
            permissions = excluded.permissions,
            review_at = excluded.review_at,
            expiry_at = excluded.expiry_at,
            updated_at = excluded.updated_at
      `,
      [
        memory.id,
        memory.userId,
        memory.category,
        memory.memoryType,
        memory.content,
        memory.confidence,
        memory.source,
        memory.sensitivity,
        JSON.stringify(memory.permissions),
        memory.reviewAt,
        memory.expiryAt,
        memory.createdAt,
        memory.updatedAt
      ]
    );
  }

  private async saveIntegrationWithClient(client: PoolClient, account: IntegrationAccount): Promise<void> {
    const integration = IntegrationAccountSchema.parse(account);
    await client.query(
      `
        insert into integration_accounts (
          id, user_id, name, system, status, scopes, capabilities, metadata, created_at, updated_at
        )
        values ($1, $2, $3, $4, $5, $6::jsonb, $7::jsonb, $8::jsonb, $9, $10)
        on conflict (id) do update
        set user_id = excluded.user_id,
            name = excluded.name,
            system = excluded.system,
            status = excluded.status,
            scopes = excluded.scopes,
            capabilities = excluded.capabilities,
            metadata = excluded.metadata,
            updated_at = excluded.updated_at
      `,
      [
        integration.id,
        integration.userId,
        integration.name,
        integration.system,
        integration.status,
        JSON.stringify(integration.scopes),
        JSON.stringify(integration.capabilities),
        JSON.stringify(integration.metadata),
        integration.createdAt,
        integration.updatedAt
      ]
    );
  }

  private async upsertGoalBundle(client: PoolClient, bundle: GoalBundle): Promise<void> {
    const validated = GoalBundleSchema.parse(bundle);

    await client.query(
      `
        insert into workflows (id, goal_id, status, current_step, checkpoint, created_at, updated_at)
        values ($1, $2, $3, $4, $5, $6, $7)
        on conflict (id) do update
        set goal_id = excluded.goal_id,
            status = excluded.status,
            current_step = excluded.current_step,
            checkpoint = excluded.checkpoint,
            updated_at = excluded.updated_at
      `,
      [
        validated.workflow.id,
        validated.workflow.goalId,
        validated.workflow.status,
        validated.workflow.currentStep,
        validated.workflow.checkpoint,
        validated.workflow.createdAt,
        validated.workflow.updatedAt
      ]
    );

    await client.query(
      `
        insert into goals (id, user_id, workflow_id, title, request, intent, status, confidence, explanation, created_at, updated_at)
        values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
        on conflict (id) do update
        set user_id = excluded.user_id,
            workflow_id = excluded.workflow_id,
            title = excluded.title,
            request = excluded.request,
            intent = excluded.intent,
            status = excluded.status,
            confidence = excluded.confidence,
            explanation = excluded.explanation,
            updated_at = excluded.updated_at
      `,
      [
        validated.goal.id,
        validated.goal.userId,
        validated.goal.workflowId,
        validated.goal.title,
        validated.goal.request,
        validated.goal.intent,
        validated.goal.status,
        validated.goal.confidence,
        validated.goal.explanation,
        validated.goal.createdAt,
        validated.goal.updatedAt
      ]
    );

    for (const task of validated.tasks) {
      await client.query(
        `
          insert into tasks (
            id, goal_id, workflow_id, title, summary, assigned_agent, state, risk_class, requires_approval,
            depends_on, tool_capabilities, artifact_ids, created_at, updated_at
          )
          values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10::jsonb, $11::jsonb, $12::jsonb, $13, $14)
          on conflict (id) do update
          set goal_id = excluded.goal_id,
              workflow_id = excluded.workflow_id,
              title = excluded.title,
              summary = excluded.summary,
              assigned_agent = excluded.assigned_agent,
              state = excluded.state,
              risk_class = excluded.risk_class,
              requires_approval = excluded.requires_approval,
              depends_on = excluded.depends_on,
              tool_capabilities = excluded.tool_capabilities,
              artifact_ids = excluded.artifact_ids,
              updated_at = excluded.updated_at
        `,
        [
          task.id,
          task.goalId,
          task.workflowId,
          task.title,
          task.summary,
          task.assignedAgent,
          task.state,
          task.riskClass,
          task.requiresApproval,
          JSON.stringify(task.dependsOn),
          JSON.stringify(task.toolCapabilities),
          JSON.stringify(task.artifactIds),
          task.createdAt,
          task.updatedAt
        ]
      );
    }

    for (const artifact of validated.artifacts) {
      await client.query(
        `
          insert into artifacts (id, goal_id, task_id, artifact_type, title, content, metadata, created_at)
          values ($1, $2, $3, $4, $5, $6, $7::jsonb, $8)
          on conflict (id) do update
          set goal_id = excluded.goal_id,
              task_id = excluded.task_id,
              artifact_type = excluded.artifact_type,
              title = excluded.title,
              content = excluded.content,
              metadata = excluded.metadata
        `,
        [
          artifact.id,
          artifact.goalId,
          artifact.taskId ?? null,
          artifact.artifactType,
          artifact.title,
          artifact.content,
          JSON.stringify(artifact.metadata),
          artifact.createdAt
        ]
      );
    }

    for (const approval of validated.approvals) {
      await client.query(
        `
          insert into approval_requests (id, goal_id, task_id, title, rationale, risk_class, decision, requested_action, created_at, responded_at)
          values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
          on conflict (id) do update
          set goal_id = excluded.goal_id,
              task_id = excluded.task_id,
              title = excluded.title,
              rationale = excluded.rationale,
              risk_class = excluded.risk_class,
              decision = excluded.decision,
              requested_action = excluded.requested_action,
              responded_at = excluded.responded_at
        `,
        [
          approval.id,
          approval.goalId,
          approval.taskId,
          approval.title,
          approval.rationale,
          approval.riskClass,
          approval.decision,
          approval.requestedAction,
          approval.createdAt,
          approval.respondedAt
        ]
      );
    }

    for (const watcher of validated.watchers) {
      await client.query(
        `
          insert into watchers (
            id, goal_id, target_entity, condition, frequency, trigger_action, source_systems, status, expiry_at, created_at, updated_at
          )
          values ($1, $2, $3, $4, $5, $6, $7::jsonb, $8, $9, $10, $11)
          on conflict (id) do update
          set goal_id = excluded.goal_id,
              target_entity = excluded.target_entity,
              condition = excluded.condition,
              frequency = excluded.frequency,
              trigger_action = excluded.trigger_action,
              source_systems = excluded.source_systems,
              status = excluded.status,
              expiry_at = excluded.expiry_at,
              updated_at = excluded.updated_at
        `,
        [
          watcher.id,
          watcher.goalId,
          watcher.targetEntity,
          watcher.condition,
          watcher.frequency,
          watcher.triggerAction,
          JSON.stringify(watcher.sourceSystems),
          watcher.status,
          watcher.expiryAt,
          watcher.createdAt,
          watcher.updatedAt
        ]
      );
    }

    for (const log of validated.actionLogs) {
      await client.query(
        `
          insert into action_logs (id, goal_id, task_id, workflow_id, actor, kind, message, details, created_at)
          values ($1, $2, $3, $4, $5, $6, $7, $8::jsonb, $9)
          on conflict (id) do nothing
        `,
        [
          log.id,
          log.goalId,
          log.taskId,
          log.workflowId,
          log.actor,
          log.kind,
          log.message,
          JSON.stringify(log.details),
          log.createdAt
        ]
      );
    }
  }

  private async mapGoalBundle(goalId: string): Promise<GoalBundle | null> {
    await this.ready;
    const client = await this.pool.connect();

    try {
      const goalResult = await client.query("select * from goals where id = $1 limit 1", [goalId]);

      if (goalResult.rowCount === 0) {
        return null;
      }

      const goalRow = goalResult.rows[0];
      const workflowResult = await client.query("select * from workflows where id = $1 limit 1", [goalRow.workflow_id]);
      const tasksResult = await client.query("select * from tasks where goal_id = $1 order by created_at asc", [goalId]);
      const artifactsResult = await client.query("select * from artifacts where goal_id = $1 order by created_at asc", [goalId]);
      const approvalsResult = await client.query("select * from approval_requests where goal_id = $1 order by created_at asc", [goalId]);
      const watchersResult = await client.query("select * from watchers where goal_id = $1 order by created_at asc", [goalId]);
      const logsResult = await client.query("select * from action_logs where goal_id = $1 order by created_at asc", [goalId]);

      return GoalBundleSchema.parse({
        goal: {
          id: goalRow.id,
          userId: goalRow.user_id,
          workflowId: goalRow.workflow_id,
          title: goalRow.title,
          request: goalRow.request,
          intent: goalRow.intent,
          status: goalRow.status,
          confidence: Number(goalRow.confidence),
          explanation: goalRow.explanation,
          createdAt: new Date(goalRow.created_at).toISOString(),
          updatedAt: new Date(goalRow.updated_at).toISOString()
        },
        workflow: {
          id: workflowResult.rows[0].id,
          goalId: workflowResult.rows[0].goal_id,
          status: workflowResult.rows[0].status,
          currentStep: workflowResult.rows[0].current_step,
          checkpoint: workflowResult.rows[0].checkpoint,
          createdAt: new Date(workflowResult.rows[0].created_at).toISOString(),
          updatedAt: new Date(workflowResult.rows[0].updated_at).toISOString()
        },
        tasks: tasksResult.rows.map((row) =>
          TaskSchema.parse({
            id: row.id,
            goalId: row.goal_id,
            workflowId: row.workflow_id,
            title: row.title,
            summary: row.summary,
            assignedAgent: row.assigned_agent,
            state: row.state,
            riskClass: row.risk_class,
            requiresApproval: row.requires_approval,
            dependsOn: row.depends_on ?? [],
            toolCapabilities: row.tool_capabilities ?? [],
            artifactIds: row.artifact_ids ?? [],
            createdAt: new Date(row.created_at).toISOString(),
            updatedAt: new Date(row.updated_at).toISOString()
          })
        ),
        artifacts: artifactsResult.rows.map((row) =>
          ArtifactSchema.parse({
            id: row.id,
            goalId: row.goal_id,
            taskId: row.task_id ?? undefined,
            artifactType: row.artifact_type,
            title: row.title,
            content: row.content,
            metadata: row.metadata ?? {},
            createdAt: new Date(row.created_at).toISOString()
          })
        ),
        approvals: approvalsResult.rows.map((row) =>
          ApprovalRequestSchema.parse({
            id: row.id,
            goalId: row.goal_id,
            taskId: row.task_id,
            title: row.title,
            rationale: row.rationale,
            riskClass: row.risk_class,
            decision: row.decision,
            requestedAction: row.requested_action,
            createdAt: new Date(row.created_at).toISOString(),
            respondedAt: row.responded_at ? new Date(row.responded_at).toISOString() : null
          })
        ),
        watchers: watchersResult.rows.map((row) =>
          WatcherSchema.parse({
            id: row.id,
            goalId: row.goal_id,
            targetEntity: row.target_entity,
            condition: row.condition,
            frequency: row.frequency,
            triggerAction: row.trigger_action,
            sourceSystems: row.source_systems ?? [],
            status: row.status,
            expiryAt: row.expiry_at ? new Date(row.expiry_at).toISOString() : null,
            createdAt: new Date(row.created_at).toISOString(),
            updatedAt: new Date(row.updated_at).toISOString()
          })
        ),
        actionLogs: logsResult.rows.map((row) =>
          ActionLogSchema.parse({
            id: row.id,
            goalId: row.goal_id,
            taskId: row.task_id,
            workflowId: row.workflow_id,
            actor: row.actor,
            kind: row.kind,
            message: row.message,
            details: row.details ?? {},
            createdAt: new Date(row.created_at).toISOString()
          })
        )
      });
    } finally {
      client.release();
    }
  }

  async seedDefaults(userId = SYSTEM_USER_ID): Promise<void> {
    await this.withTransaction(async (client) => {
      const user = defaultUser(userId);
      await client.query(
        `
          insert into users (id, name, created_at)
          values ($1, $2, $3)
          on conflict (id) do nothing
        `,
        [user.id, user.name, user.createdAt]
      );

      for (const memory of defaultMemories(userId)) {
        await this.saveMemoryWithClient(client, memory);
      }

      for (const integration of buildDefaultIntegrationAccounts(userId)) {
        await this.saveIntegrationWithClient(client, integration);
      }

      for (const rule of defaultPolicyRules(userId)) {
        await client.query(
          `
            insert into policy_rules (id, user_id, name, description, active, created_at, updated_at)
            values ($1, $2, $3, $4, $5, $6, $7)
            on conflict (id) do update
            set name = excluded.name,
                description = excluded.description,
                active = excluded.active,
                updated_at = excluded.updated_at
          `,
          [rule.id, rule.userId, rule.name, rule.description, rule.active, rule.createdAt, rule.updatedAt]
        );
      }
    });
  }

  async saveGoalBundle(bundle: GoalBundle): Promise<GoalBundle> {
    const validated = GoalBundleSchema.parse(bundle);
    await this.withTransaction((client) => this.upsertGoalBundle(client, validated));
    return GoalBundleSchema.parse(clone(validated));
  }

  async getGoalBundle(goalId: string): Promise<GoalBundle | null> {
    const bundle = await this.mapGoalBundle(goalId);
    return bundle ? GoalBundleSchema.parse(clone(bundle)) : null;
  }

  async getGoalBundleForUser(goalId: string, userId = SYSTEM_USER_ID): Promise<GoalBundle | null> {
    await this.ready;
    const result = await this.pool.query("select id from goals where id = $1 and user_id = $2 limit 1", [goalId, userId]);

    if (result.rowCount === 0) {
      return null;
    }

    const bundle = await this.mapGoalBundle(goalId);
    return bundle ? GoalBundleSchema.parse(clone(bundle)) : null;
  }

  async listGoals(userId = SYSTEM_USER_ID): Promise<GoalBundle[]> {
    await this.ready;
    const result = await this.pool.query("select id from goals where user_id = $1 order by created_at desc", [userId]);
    const bundles = await Promise.all(result.rows.map((row) => this.mapGoalBundle(row.id)));
    return bundles.filter((bundle): bundle is GoalBundle => bundle !== null).map((bundle) => GoalBundleSchema.parse(clone(bundle)));
  }

  async listApprovals(userId = SYSTEM_USER_ID): Promise<ApprovalRequest[]> {
    await this.ready;
    const result = await this.pool.query(
      `
        select a.*
        from approval_requests a
        join goals g on g.id = a.goal_id
        where g.user_id = $1
        order by a.created_at desc
      `,
      [userId]
    );

    return result.rows.map((row) =>
      ApprovalRequestSchema.parse({
        id: row.id,
        goalId: row.goal_id,
        taskId: row.task_id,
        title: row.title,
        rationale: row.rationale,
        riskClass: row.risk_class,
        decision: row.decision,
        requestedAction: row.requested_action,
        createdAt: new Date(row.created_at).toISOString(),
        respondedAt: row.responded_at ? new Date(row.responded_at).toISOString() : null
      })
    );
  }

  async listMemory(userId = SYSTEM_USER_ID): Promise<MemoryRecord[]> {
    await this.ready;
    const result = await this.pool.query("select * from memory_records where user_id = $1 order by created_at desc", [userId]);

    return result.rows.map((row) =>
      MemoryRecordSchema.parse({
        id: row.id,
        userId: row.user_id,
        category: row.category,
        memoryType: row.memory_type,
        content: row.content,
        confidence: Number(row.confidence),
        source: row.source,
        sensitivity: row.sensitivity,
        permissions: row.permissions ?? [],
        reviewAt: row.review_at ? new Date(row.review_at).toISOString() : null,
        expiryAt: row.expiry_at ? new Date(row.expiry_at).toISOString() : null,
        createdAt: new Date(row.created_at).toISOString(),
        updatedAt: new Date(row.updated_at).toISOString()
      })
    );
  }

  async saveMemory(record: MemoryRecord): Promise<MemoryRecord> {
    await this.withTransaction((client) => this.saveMemoryWithClient(client, record));
    return MemoryRecordSchema.parse(clone(record));
  }

  async listWatchers(filters?: WatcherListFilters): Promise<Watcher[]> {
    await this.ready;
    const userId = filters?.userId ?? SYSTEM_USER_ID;
    const values: string[] = [userId];
    let goalClause = "";

    if (filters?.goalId) {
      values.push(filters.goalId);
      goalClause = " and w.goal_id = $2";
    }

    const result = await this.pool.query(
      `
        select w.*
        from watchers w
        join goals g on g.id = w.goal_id
        where g.user_id = $1${goalClause}
        order by w.created_at desc
      `,
      values
    );

    return result.rows.map((row) =>
      WatcherSchema.parse({
        id: row.id,
        goalId: row.goal_id,
        targetEntity: row.target_entity,
        condition: row.condition,
        frequency: row.frequency,
        triggerAction: row.trigger_action,
        sourceSystems: row.source_systems ?? [],
        status: row.status,
        expiryAt: row.expiry_at ? new Date(row.expiry_at).toISOString() : null,
        createdAt: new Date(row.created_at).toISOString(),
        updatedAt: new Date(row.updated_at).toISOString()
      })
    );
  }

  async saveWatcher(watcher: Watcher): Promise<Watcher> {
    const validated = WatcherSchema.parse(watcher);

    await this.withTransaction(async (client) => {
      const goalResult = await client.query("select 1 from goals where id = $1 limit 1", [validated.goalId]);

      if (goalResult.rowCount === 0) {
        throw new Error(`Goal ${validated.goalId} was not found.`);
      }

      await client.query(
        `
          insert into watchers (
            id, goal_id, target_entity, condition, frequency, trigger_action, source_systems, status, expiry_at, created_at, updated_at
          )
          values ($1, $2, $3, $4, $5, $6, $7::jsonb, $8, $9, $10, $11)
          on conflict (id) do update
          set goal_id = excluded.goal_id,
              target_entity = excluded.target_entity,
              condition = excluded.condition,
              frequency = excluded.frequency,
              trigger_action = excluded.trigger_action,
              source_systems = excluded.source_systems,
              status = excluded.status,
              expiry_at = excluded.expiry_at,
              updated_at = excluded.updated_at
        `,
        [
          validated.id,
          validated.goalId,
          validated.targetEntity,
          validated.condition,
          validated.frequency,
          validated.triggerAction,
          JSON.stringify(validated.sourceSystems),
          validated.status,
          validated.expiryAt,
          validated.createdAt,
          validated.updatedAt
        ]
      );
    });

    return WatcherSchema.parse(clone(validated));
  }

  async listIntegrations(userId = SYSTEM_USER_ID): Promise<IntegrationAccount[]> {
    await this.ready;
    const result = await this.pool.query("select * from integration_accounts where user_id = $1 order by created_at desc", [userId]);

    return result.rows.map((row) =>
      IntegrationAccountSchema.parse({
        id: row.id,
        userId: row.user_id,
        name: row.name,
        system: row.system,
        status: row.status,
        scopes: row.scopes ?? [],
        capabilities: row.capabilities ?? [],
        metadata: row.metadata ?? {},
        createdAt: new Date(row.created_at).toISOString(),
        updatedAt: new Date(row.updated_at).toISOString()
      })
    );
  }

  async upsertIntegration(account: IntegrationAccount): Promise<IntegrationAccount> {
    await this.withTransaction((client) => this.saveIntegrationWithClient(client, account));
    return IntegrationAccountSchema.parse(clone(account));
  }

  async getDashboardData(userId = SYSTEM_USER_ID): Promise<DashboardData> {
    const [goals, approvals, memories, integrations, watchers] = await Promise.all([
      this.listGoals(userId),
      this.listApprovals(userId),
      this.listMemory(userId),
      this.listIntegrations(userId),
      this.listWatchers({ userId })
    ]);

    return {
      goals,
      approvals,
      memories,
      watchers,
      integrations,
      latestArtifacts: sortByCreatedDesc(goals.flatMap((bundle) => bundle.artifacts)).slice(0, 8),
      actionLogs: sortByCreatedDesc(goals.flatMap((bundle) => bundle.actionLogs)).slice(0, 20)
    };
  }
}

export function createRepository(options?: { storePath?: string; databaseUrl?: string }): AgenticRepository {
  const databaseUrl = options?.databaseUrl ?? process.env.DATABASE_URL;

  if (databaseUrl) {
    return new PostgresRepository(databaseUrl);
  }

  return new FileRepository(options?.storePath);
}
