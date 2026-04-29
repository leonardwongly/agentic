import crypto from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { pgTable, text, timestamp, boolean, jsonb, real, integer, index, primaryKey, uniqueIndex } from "drizzle-orm/pg-core";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool, type PoolClient } from "pg";

export const users = pgTable("users", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull()
});

export const authSessionRateLimits = pgTable(
  "auth_session_rate_limits",
  {
    key: text("key").primaryKey(),
    attempts: integer("attempts").notNull(),
    windowStart: timestamp("window_start", { withTimezone: true }).notNull(),
    lockedUntil: timestamp("locked_until", { withTimezone: true }),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull()
  },
  (table) => ({
    updatedAtIdx: index("auth_session_rate_limits_updated_at_idx").on(table.updatedAt)
  })
);

export const authRevokedSessions = pgTable(
  "auth_revoked_sessions",
  {
    sessionId: text("session_id").primaryKey(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    revokedAt: timestamp("revoked_at", { withTimezone: true }).notNull()
  },
  (table) => ({
    expiresAtIdx: index("auth_revoked_sessions_expires_at_idx").on(table.expiresAt)
  })
);

export const sessionUnlockAttempts = pgTable(
  "session_unlock_attempts",
  {
    key: text("key").primaryKey(),
    failures: integer("failures").notNull(),
    firstFailureAt: timestamp("first_failure_at", { withTimezone: true }).notNull(),
    lastSeenAt: timestamp("last_seen_at", { withTimezone: true }).notNull(),
    blockedUntil: timestamp("blocked_until", { withTimezone: true }).notNull()
  },
  (table) => ({
    lastSeenAtIdx: index("session_unlock_attempts_last_seen_at_idx").on(table.lastSeenAt)
  })
);

export const telegramApprovalActions = pgTable(
  "telegram_approval_actions",
  {
    actionId: text("action_id").primaryKey(),
    approvalId: text("approval_id").notNull(),
    goalId: text("goal_id").notNull(),
    workspaceId: text("workspace_id"),
    decision: text("decision").notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    consumedAt: timestamp("consumed_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull()
  },
  (table) => ({
    approvalIdIdx: index("telegram_approval_actions_approval_id_idx").on(table.approvalId),
    expiresAtIdx: index("telegram_approval_actions_expires_at_idx").on(table.expiresAt)
  })
);

export const workflows = pgTable("workflows", {
  id: text("id").primaryKey(),
  goalId: text("goal_id").notNull(),
  workspaceId: text("workspace_id"),
  status: text("status").notNull(),
  currentStep: text("current_step").notNull(),
  checkpoint: text("checkpoint"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull()
});

export const goals = pgTable("goals", {
  id: text("id").primaryKey(),
  userId: text("user_id").notNull(),
  workspaceId: text("workspace_id"),
  workflowId: text("workflow_id").notNull(),
  title: text("title").notNull(),
  request: text("request").notNull(),
  intent: text("intent").notNull(),
  status: text("status").notNull(),
  confidence: real("confidence").notNull(),
  explanation: text("explanation").notNull(),
  goalContract: jsonb("goal_contract").$type<Record<string, unknown> | null>(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull()
});

export const tasks = pgTable("tasks", {
  id: text("id").primaryKey(),
  goalId: text("goal_id").notNull(),
  workflowId: text("workflow_id").notNull(),
  title: text("title").notNull(),
  summary: text("summary").notNull(),
  assignedAgent: text("assigned_agent").notNull(),
  state: text("state").notNull(),
  riskClass: text("risk_class").notNull(),
  requiresApproval: boolean("requires_approval").notNull(),
  dependsOn: jsonb("depends_on").$type<string[]>().notNull(),
  toolCapabilities: jsonb("tool_capabilities").$type<string[]>().notNull(),
  artifactIds: jsonb("artifact_ids").$type<string[]>().notNull(),
  teamResponsibility: jsonb("team_responsibility").$type<Record<string, unknown> | null>(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull()
});

export const memoryRecords = pgTable("memory_records", {
  id: text("id").primaryKey(),
  userId: text("user_id").notNull(),
  category: text("category").notNull(),
  memoryType: text("memory_type").notNull(),
  content: text("content").notNull(),
  confidence: real("confidence").notNull(),
  source: text("source").notNull(),
  sensitivity: text("sensitivity").notNull(),
  permissions: jsonb("permissions").$type<string[]>().notNull(),
  actorContext: jsonb("actor_context").$type<Record<string, unknown> | null>(),
  reviewAt: timestamp("review_at", { withTimezone: true }),
  expiryAt: timestamp("expiry_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull()
});

export const policyRules = pgTable("policy_rules", {
  id: text("id").primaryKey(),
  userId: text("user_id").notNull(),
  name: text("name").notNull(),
  description: text("description").notNull(),
  active: boolean("active").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull()
});

export const approvalRequests = pgTable("approval_requests", {
  id: text("id").primaryKey(),
  goalId: text("goal_id").notNull(),
  taskId: text("task_id").notNull(),
  title: text("title").notNull(),
  rationale: text("rationale").notNull(),
  riskClass: text("risk_class").notNull(),
  decision: text("decision").notNull(),
  requestedAction: text("requested_action").notNull(),
  preview: jsonb("preview").$type<Record<string, unknown>>().notNull(),
  decisionScope: text("decision_scope"),
  decisionRationale: text("decision_rationale"),
  history: jsonb("history").$type<Array<Record<string, unknown>>>().notNull(),
  teamResponsibility: jsonb("team_responsibility").$type<Record<string, unknown> | null>(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
  expiryAt: timestamp("expiry_at", { withTimezone: true }).notNull(),
  respondedAt: timestamp("responded_at", { withTimezone: true })
});

export const commitments = pgTable("commitments", {
  id: text("id").primaryKey(),
  userId: text("user_id").notNull(),
  title: text("title").notNull(),
  summary: text("summary").notNull(),
  status: text("status").notNull(),
  sourceKind: text("source_kind").notNull(),
  sourceId: text("source_id").notNull(),
  goalId: text("goal_id"),
  approvalId: text("approval_id"),
  dueAt: timestamp("due_at", { withTimezone: true }),
  actorContext: jsonb("actor_context").$type<Record<string, unknown> | null>(),
  confidence: real("confidence").notNull(),
  evidence: jsonb("evidence").$type<Array<Record<string, unknown>>>().notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull()
});

export const workspaces = pgTable("workspaces", {
  id: text("id").primaryKey(),
  ownerUserId: text("owner_user_id").notNull(),
  slug: text("slug").notNull(),
  name: text("name").notNull(),
  description: text("description").notNull(),
  isPersonal: boolean("is_personal").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull()
});

export const workspaceMembers = pgTable("workspace_members", {
  id: text("id").primaryKey(),
  workspaceId: text("workspace_id").notNull(),
  userId: text("user_id").notNull(),
  role: text("role").notNull(),
  joinedAt: timestamp("joined_at", { withTimezone: true }).notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull()
});

export const workspaceSelections = pgTable("workspace_selections", {
  userId: text("user_id").primaryKey(),
  workspaceId: text("workspace_id").notNull(),
  actorContext: jsonb("actor_context").$type<Record<string, unknown> | null>(),
  selectedAt: timestamp("selected_at", { withTimezone: true }).notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull()
});

export const workspaceGovernance = pgTable("workspace_governance", {
  workspaceId: text("workspace_id").primaryKey(),
  approvalMode: text("approval_mode").notNull(),
  requireAuditExports: boolean("require_audit_exports").notNull(),
  maxAutoRunRiskClass: text("max_auto_run_risk_class").notNull(),
  publicSharingEnabled: boolean("public_sharing_enabled").notNull().default(false),
  providerAccessRequiresApproval: boolean("provider_access_requires_approval").notNull().default(true),
  escalationRequiresApproval: boolean("escalation_requires_approval").notNull().default(true),
  externalSendRequiresApproval: boolean("external_send_requires_approval").notNull(),
  calendarWriteRequiresApproval: boolean("calendar_write_requires_approval").notNull(),
  shadowReplayPolicy: jsonb("shadow_replay_policy").$type<Record<string, unknown> | null>(),
  retentionDays: integer("retention_days").notNull(),
  updatedBy: text("updated_by").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull()
});

export const goalShares = pgTable(
  "goal_shares",
  {
    id: text("id").primaryKey(),
    goalId: text("goal_id").notNull(),
    userId: text("user_id").notNull(),
    workspaceId: text("workspace_id"),
    tokenFingerprint: text("token_fingerprint").notNull(),
    status: text("status").notNull(),
    actorContext: jsonb("actor_context").$type<Record<string, unknown> | null>(),
    disclosureReview: jsonb("disclosure_review").$type<Record<string, unknown> | null>(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    lastViewedAt: timestamp("last_viewed_at", { withTimezone: true }),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull()
  },
  (table) => ({
    tokenFingerprintIdx: uniqueIndex("goal_shares_token_fingerprint_idx").on(table.tokenFingerprint),
    goalIdx: index("goal_shares_goal_id_idx").on(table.goalId),
    workspaceIdx: index("goal_shares_workspace_id_idx").on(table.workspaceId),
    userUpdatedAtIdx: index("goal_shares_user_updated_at_idx").on(table.userId, table.updatedAt)
  })
);

export const privacyOperations = pgTable(
  "privacy_operations",
  {
    id: text("id").primaryKey(),
    workspaceId: text("workspace_id").notNull(),
    userId: text("user_id").notNull(),
    kind: text("kind").notNull(),
    status: text("status").notNull(),
    requestedBy: text("requested_by").notNull(),
    actorContext: jsonb("actor_context").$type<Record<string, unknown> | null>(),
    jobId: text("job_id"),
    details: jsonb("details").$type<Record<string, unknown>>().notNull(),
    result: jsonb("result").$type<Record<string, unknown>>().notNull(),
    startedAt: timestamp("started_at", { withTimezone: true }),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    error: text("error"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull()
  },
  (table) => ({
    workspaceCreatedAtIdx: index("privacy_operations_workspace_created_at_idx").on(table.workspaceId, table.createdAt),
    userCreatedAtIdx: index("privacy_operations_user_created_at_idx").on(table.userId, table.createdAt),
    statusCreatedAtIdx: index("privacy_operations_status_created_at_idx").on(table.status, table.createdAt),
    jobIdIdx: index("privacy_operations_job_id_idx").on(table.jobId)
  })
);

export const briefingPreferences = pgTable("briefing_preferences", {
  userId: text("user_id").primaryKey(),
  timezone: text("timezone").notNull(),
  focus: text("focus").notNull(),
  schedules: jsonb("schedules").$type<Array<Record<string, unknown>>>().notNull(),
  actorContext: jsonb("actor_context").$type<Record<string, unknown> | null>(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull()
});

export const actionLogs = pgTable("action_logs", {
  id: text("id").primaryKey(),
  goalId: text("goal_id").notNull(),
  taskId: text("task_id"),
  workflowId: text("workflow_id"),
  actor: text("actor").notNull(),
  kind: text("kind").notNull(),
  message: text("message").notNull(),
  details: jsonb("details").$type<Record<string, unknown>>().notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull()
});

export const evidenceRecords = pgTable("evidence_records", {
  id: text("id").primaryKey(),
  userId: text("user_id").notNull(),
  goalId: text("goal_id").notNull(),
  taskId: text("task_id").notNull(),
  approvalId: text("approval_id").notNull(),
  sourceKind: text("source_kind").notNull(),
  sourceId: text("source_id").notNull(),
  sourceSummary: text("source_summary").notNull(),
  riskClass: text("risk_class").notNull(),
  requestedAction: text("requested_action").notNull(),
  requestRationale: text("request_rationale").notNull(),
  requiresApproval: boolean("requires_approval").notNull(),
  decision: text("decision").notNull(),
  decisionScope: text("decision_scope").notNull(),
  decisionRationale: text("decision_rationale"),
  respondedAt: timestamp("responded_at", { withTimezone: true }).notNull(),
  resultingTaskState: text("resulting_task_state").notNull(),
  resultingGoalStatus: text("resulting_goal_status").notNull(),
  actionLogIds: jsonb("action_log_ids").$type<string[]>().notNull(),
  artifactIds: jsonb("artifact_ids").$type<string[]>().notNull(),
  memoryIds: jsonb("memory_ids").$type<string[]>().notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull()
});

export const watchers = pgTable("watchers", {
  id: text("id").primaryKey(),
  goalId: text("goal_id").notNull(),
  targetEntity: text("target_entity").notNull(),
  condition: text("condition").notNull(),
  frequency: text("frequency").notNull(),
  triggerAction: text("trigger_action").notNull(),
  sourceSystems: jsonb("source_systems").$type<string[]>().notNull(),
  status: text("status").notNull(),
  expiryAt: timestamp("expiry_at", { withTimezone: true }),
  actorContext: jsonb("actor_context").$type<Record<string, unknown> | null>(),
  teamResponsibility: jsonb("team_responsibility").$type<Record<string, unknown> | null>(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull()
});

export const goalTemplates = pgTable("goal_templates", {
  id: text("id").primaryKey(),
  userId: text("user_id").notNull(),
  name: text("name").notNull(),
  description: text("description").notNull(),
  request: text("request").notNull(),
  parameters: jsonb("parameters").$type<Record<string, string>>().notNull(),
  schedule: jsonb("schedule").$type<Record<string, unknown>>().notNull(),
  actorContext: jsonb("actor_context").$type<Record<string, unknown> | null>(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull()
});

export const workflowTemplates = pgTable("workflow_templates", {
  id: text("id").primaryKey(),
  userId: text("user_id").notNull(),
  name: text("name").notNull(),
  description: text("description").notNull(),
  nodes: jsonb("nodes").$type<Array<Record<string, unknown>>>().notNull(),
  edges: jsonb("edges").$type<Array<Record<string, unknown>>>().notNull(),
  triggers: jsonb("triggers").$type<Array<Record<string, unknown>>>().notNull(),
  actorContext: jsonb("actor_context").$type<Record<string, unknown> | null>(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull()
});

export const autopilotSettings = pgTable("autopilot_settings", {
  userId: text("user_id").primaryKey(),
  mode: text("mode").notNull(),
  debounceMinutes: integer("debounce_minutes").notNull(),
  actorContext: jsonb("actor_context").$type<Record<string, unknown> | null>(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull()
});

export const autopilotEvents = pgTable("autopilot_events", {
  id: text("id").primaryKey(),
  userId: text("user_id").notNull(),
  kind: text("kind").notNull(),
  sourceId: text("source_id").notNull(),
  idempotencyKey: text("idempotency_key"),
  mode: text("mode").notNull(),
  summary: text("summary").notNull(),
  status: text("status").notNull(),
  details: jsonb("details").$type<Record<string, unknown>>().notNull(),
  actorContext: jsonb("actor_context").$type<Record<string, unknown> | null>(),
  teamResponsibility: jsonb("team_responsibility").$type<Record<string, unknown> | null>(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
  processedAt: timestamp("processed_at", { withTimezone: true }),
  resultGoalId: text("result_goal_id"),
  error: text("error")
});

export const jobs = pgTable(
  "jobs",
  {
    id: text("id").primaryKey(),
    userId: text("user_id").notNull(),
    kind: text("kind").notNull(),
    status: text("status").notNull(),
    idempotencyKey: text("idempotency_key"),
    payload: jsonb("payload").$type<Record<string, unknown>>().notNull(),
    actorContext: jsonb("actor_context").$type<Record<string, unknown> | null>(),
    maxAttempts: integer("max_attempts").notNull(),
    attemptCount: integer("attempt_count").notNull(),
    claimedBy: text("claimed_by"),
    lastAttemptAt: timestamp("last_attempt_at", { withTimezone: true }),
    claimedAt: timestamp("claimed_at", { withTimezone: true }),
    leaseExpiresAt: timestamp("lease_expires_at", { withTimezone: true }),
    availableAt: timestamp("available_at", { withTimezone: true }).notNull(),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    deadLetteredAt: timestamp("dead_lettered_at", { withTimezone: true }),
    lastError: text("last_error"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull()
  },
  (table) => ({
    userStatusAvailableAtIdx: index("jobs_user_status_available_at_idx").on(table.userId, table.status, table.availableAt),
    kindStatusAvailableAtIdx: index("jobs_kind_status_available_at_idx").on(table.kind, table.status, table.availableAt),
    leaseExpiresAtIdx: index("jobs_lease_expires_at_idx").on(table.leaseExpiresAt)
  })
);

export const integrationAccounts = pgTable(
  "integration_accounts",
  {
    id: text("id").notNull(),
    userId: text("user_id").notNull(),
    name: text("name").notNull(),
    system: text("system").notNull(),
    status: text("status").notNull(),
    scopes: jsonb("scopes").$type<string[]>().notNull(),
    capabilities: jsonb("capabilities").$type<string[]>().notNull(),
    metadata: jsonb("metadata").$type<Record<string, unknown>>().notNull(),
    actorContext: jsonb("actor_context").$type<Record<string, unknown> | null>(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull()
  },
  (table) => ({
    pk: primaryKey({ columns: [table.userId, table.id] }),
    systemIdx: index("integration_accounts_user_system_idx").on(table.userId, table.system)
  })
);

export const providerCredentials = pgTable(
  "provider_credentials",
  {
    id: text("id").notNull(),
    userId: text("user_id").notNull(),
    workspaceId: text("workspace_id"),
    provider: text("provider").notNull(),
    accountId: text("account_id"),
    accountEmail: text("account_email"),
    displayName: text("display_name").notNull(),
    status: text("status").notNull(),
    scopes: jsonb("scopes").$type<string[]>().notNull(),
    lastValidatedAt: timestamp("last_validated_at", { withTimezone: true }),
    lastRotatedAt: timestamp("last_rotated_at", { withTimezone: true }),
    lastRefreshAt: timestamp("last_refresh_at", { withTimezone: true }),
    lastRefreshFailureAt: timestamp("last_refresh_failure_at", { withTimezone: true }),
    reconnectRequiredAt: timestamp("reconnect_required_at", { withTimezone: true }),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
    expiresAt: timestamp("expires_at", { withTimezone: true }),
    metadata: jsonb("metadata").$type<Record<string, unknown>>().notNull(),
    actorContext: jsonb("actor_context").$type<Record<string, unknown> | null>(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull()
  },
  (table) => ({
    pk: primaryKey({ columns: [table.userId, table.id] }),
    providerIdx: index("provider_credentials_user_provider_idx").on(table.userId, table.provider),
    workspaceIdx: index("provider_credentials_workspace_idx").on(table.userId, table.workspaceId)
  })
);

export const providerCredentialSecrets = pgTable(
  "provider_credential_secrets",
  {
    credentialId: text("credential_id").notNull(),
    userId: text("user_id").notNull(),
    kind: text("kind").notNull(),
    secret: jsonb("secret").$type<Record<string, unknown>>().notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull()
  },
  (table) => ({
    pk: primaryKey({ columns: [table.userId, table.credentialId, table.kind] }),
    credentialIdx: index("provider_credential_secrets_user_credential_idx").on(table.userId, table.credentialId)
  })
);

export const artifacts = pgTable("artifacts", {
  id: text("id").primaryKey(),
  goalId: text("goal_id").notNull(),
  taskId: text("task_id"),
  artifactType: text("artifact_type").notNull(),
  title: text("title").notNull(),
  content: text("content").notNull(),
  metadata: jsonb("metadata").$type<Record<string, unknown>>().notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull()
});

export const agentDefinitions = pgTable("agent_definitions", {
  id: text("id").primaryKey(),
  userId: text("user_id").notNull(),
  name: text("name").notNull(),
  displayName: text("display_name").notNull(),
  description: text("description").notNull(),
  icon: text("icon").notNull(),
  category: text("category").notNull(),
  tags: jsonb("tags").$type<string[]>().notNull(),
  systemPrompt: text("system_prompt").notNull(),
  promptVariables: jsonb("prompt_variables").$type<string[]>().notNull(),
  artifactType: text("artifact_type").notNull(),
  behaviorConfig: jsonb("behavior_config").$type<Record<string, unknown>>().notNull(),
  allowedCapabilities: jsonb("allowed_capabilities").$type<string[]>().notNull(),
  blockedCapabilities: jsonb("blocked_capabilities").$type<string[]>().notNull(),
  maxRiskClass: text("max_risk_class").notNull(),
  integrationPermissions: jsonb("integration_permissions").$type<string[]>().notNull(),
  memoryPermissions: jsonb("memory_permissions").$type<string[]>().notNull(),
  actorContext: jsonb("actor_context").$type<Record<string, unknown> | null>(),
  isBuiltIn: boolean("is_built_in").notNull(),
  parentAgentId: text("parent_agent_id"),
  version: integer("version").notNull(),
  status: text("status").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull()
});

export const agentMetrics = pgTable("agent_metrics", {
  agentId: text("agent_id").notNull(),
  period: text("period").notNull(),
  periodStart: timestamp("period_start", { withTimezone: true }).notNull(),
  periodEnd: timestamp("period_end", { withTimezone: true }).notNull(),
  tasksTotal: integer("tasks_total").notNull(),
  tasksCompleted: integer("tasks_completed").notNull(),
  tasksFailed: integer("tasks_failed").notNull(),
  tasksBlocked: integer("tasks_blocked").notNull(),
  approvalsRequested: integer("approvals_requested").notNull(),
  approvalsApproved: integer("approvals_approved").notNull(),
  approvalsRejected: integer("approvals_rejected").notNull(),
  averageConfidence: real("average_confidence"),
  averageExecutionTimeMs: integer("average_execution_time_ms"),
  artifactsProduced: integer("artifacts_produced").notNull(),
  artifactsByType: jsonb("artifacts_by_type").$type<Record<string, number>>().notNull(),
  errorCount: integer("error_count").notNull(),
  lastErrorAt: timestamp("last_error_at", { withTimezone: true }),
  lastErrorMessage: text("last_error_message"),
  feedbackCount: integer("feedback_count").notNull(),
  userCorrectionCount: integer("user_correction_count").notNull(),
  postApprovalFailureCount: integer("post_approval_failure_count").notNull(),
  averageRating: real("average_rating"),
  successRate: real("success_rate"),
  approvalRate: real("approval_rate"),
  correctionRate: real("correction_rate"),
  postApprovalFailureRate: real("post_approval_failure_rate"),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull()
});

export const operatorProducts = pgTable("operator_products", {
  id: text("id").primaryKey(),
  userId: text("user_id").notNull(),
  slug: text("slug").notNull(),
  name: text("name").notNull(),
  tagline: text("tagline").notNull(),
  description: text("description").notNull(),
  icon: text("icon").notNull(),
  recommendedAgentIds: jsonb("recommended_agent_ids").$type<string[]>().notNull(),
  recommendedTemplateIds: jsonb("recommended_template_ids").$type<string[]>().notNull(),
  recommendedIntegrations: jsonb("recommended_integrations").$type<Array<Record<string, unknown>>>().notNull(),
  kpis: jsonb("kpis").$type<Array<Record<string, unknown>>>().notNull(),
  onboardingSteps: jsonb("onboarding_steps").$type<Array<Record<string, unknown>>>().notNull(),
  isBuiltIn: boolean("is_built_in").notNull(),
  status: text("status").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull()
});

export const operatorProductSelections = pgTable("operator_product_selections", {
  userId: text("user_id").primaryKey(),
  operatorProductId: text("operator_product_id").notNull(),
  actorContext: jsonb("actor_context").$type<Record<string, unknown> | null>(),
  selectedAt: timestamp("selected_at", { withTimezone: true }).notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull()
});

export function createDb(url: string) {
  const pool = new Pool({ connectionString: url });
  return drizzle({ client: pool });
}

const DEFAULT_MIGRATIONS_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "migrations");
const SCHEMA_MIGRATIONS_TABLE = "agentic_schema_migrations";
const LEGACY_AGENT_DEFINITIONS_BOOTSTRAP_SQL = `
  create table if not exists agent_definitions (
    id text primary key,
    user_id text not null,
    name text not null,
    display_name text not null,
    description text not null,
    icon text not null,
    category text not null,
    tags jsonb not null default '[]'::jsonb,
    system_prompt text not null,
    prompt_variables jsonb not null default '[]'::jsonb,
    artifact_type text not null,
    behavior_config jsonb not null default '{}'::jsonb,
    allowed_capabilities jsonb not null default '[]'::jsonb,
    blocked_capabilities jsonb not null default '[]'::jsonb,
    max_risk_class text not null,
    integration_permissions jsonb not null default '[]'::jsonb,
    memory_permissions jsonb not null default '[]'::jsonb,
    actor_context jsonb,
    is_built_in boolean not null default false,
    parent_agent_id text,
    version integer not null,
    status text not null,
    created_at timestamptz not null,
    updated_at timestamptz not null
  );

  create unique index if not exists agent_definitions_user_name_idx
    on agent_definitions (user_id, name);
`;

type MigrationQueryable = Pick<Pool, "query"> | PoolClient;

export type DatabaseMigrationFile = {
  name: string;
  absolutePath: string;
  checksum: string;
  sql: string;
};

export type DatabaseSchemaStatus = {
  reachable: boolean;
  ready: boolean;
  failureReason: "unreachable" | "metadata_missing" | "pending_migrations" | "migration_drift" | null;
  missingMetadataTable: boolean;
  appliedMigrations: string[];
  pendingMigrations: string[];
  driftedMigrations: string[];
  lastAppliedAt: string | null;
};

export class DatabaseConfigurationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DatabaseConfigurationError";
  }
}

export class DatabaseSchemaNotReadyError extends Error {
  constructor(
    message: string,
    public readonly status: DatabaseSchemaStatus
  ) {
    super(message);
    this.name = "DatabaseSchemaNotReadyError";
  }
}

function resolveMigrationsDir(migrationsDir?: string): string {
  return path.resolve(migrationsDir ?? DEFAULT_MIGRATIONS_DIR);
}

function hashMigration(sql: string): string {
  return crypto.createHash("sha256").update(sql, "utf8").digest("hex");
}

function isPoolClient(queryable: MigrationQueryable): queryable is PoolClient {
  return typeof (queryable as PoolClient).release === "function";
}

function createEmptySchemaStatus(
  overrides?: Partial<DatabaseSchemaStatus>
): DatabaseSchemaStatus {
  return {
    reachable: true,
    ready: false,
    failureReason: null,
    missingMetadataTable: false,
    appliedMigrations: [],
    pendingMigrations: [],
    driftedMigrations: [],
    lastAppliedAt: null,
    ...overrides
  };
}

async function withMigrationQueryable<T>(
  params: { databaseUrl?: string; pool?: Pool },
  callback: (queryable: MigrationQueryable) => Promise<T>
): Promise<T> {
  if (params.pool) {
    return callback(params.pool);
  }

  const databaseUrl = params.databaseUrl?.trim();

  if (!databaseUrl) {
    throw new DatabaseConfigurationError("DATABASE_URL must be configured for database operations.");
  }

  const pool = new Pool({ connectionString: databaseUrl });

  try {
    return await callback(pool);
  } finally {
    await pool.end();
  }
}

async function ensureMigrationMetadataTable(queryable: MigrationQueryable): Promise<void> {
  await queryable.query(`
    create table if not exists ${SCHEMA_MIGRATIONS_TABLE} (
      name text primary key,
      checksum text not null,
      applied_at timestamptz not null default now()
    )
  `);
}

async function ensureLegacyMigrationBootstrapTables(queryable: MigrationQueryable): Promise<void> {
  // `0001_init.sql` alters `agent_definitions` before it creates the table. Bootstrap the
  // final table shape first so fresh databases can apply the legacy migration without drift.
  await queryable.query(LEGACY_AGENT_DEFINITIONS_BOOTSTRAP_SQL);
}

async function loadAppliedMigrationRows(
  queryable: MigrationQueryable
): Promise<Array<{ name: string; checksum: string; appliedAt: string }>> {
  const result = await queryable.query<{
    name: string;
    checksum: string;
    applied_at: string | Date;
  }>(`
    select name, checksum, applied_at
    from ${SCHEMA_MIGRATIONS_TABLE}
    order by name asc
  `);

  return result.rows.map((row) => ({
    name: row.name,
    checksum: row.checksum,
    appliedAt: new Date(row.applied_at).toISOString()
  }));
}

function summarizeDatabaseSchemaStatus(params: {
  missingMetadataTable: boolean;
  pendingMigrations: string[];
  driftedMigrations: string[];
}): Pick<DatabaseSchemaStatus, "ready" | "failureReason"> {
  if (params.driftedMigrations.length > 0) {
    return {
      ready: false,
      failureReason: "migration_drift"
    };
  }

  if (params.pendingMigrations.length > 0) {
    return {
      ready: false,
      failureReason: params.missingMetadataTable ? "metadata_missing" : "pending_migrations"
    };
  }

  return {
    ready: true,
    failureReason: null
  };
}

function buildSchemaNotReadyMessage(status: DatabaseSchemaStatus): string {
  switch (status.failureReason) {
    case "unreachable":
      return "Database is unreachable.";
    case "metadata_missing":
    case "pending_migrations":
      return "Database schema is not ready. Run database migrations before starting the application.";
    case "migration_drift":
      return "Database migration metadata does not match the checked-in migration files.";
    default:
      return "Database schema is not ready.";
  }
}

export async function listMigrationFiles(options?: { migrationsDir?: string }): Promise<DatabaseMigrationFile[]> {
  const migrationsDir = resolveMigrationsDir(options?.migrationsDir);
  const entries = await readdir(migrationsDir, { withFileTypes: true });
  const migrationNames = entries
    .filter((entry) => entry.isFile() && entry.name.endsWith(".sql"))
    .map((entry) => entry.name)
    .sort((left, right) => left.localeCompare(right));

  return Promise.all(
    migrationNames.map(async (name) => {
      const absolutePath = path.join(migrationsDir, name);
      const sql = await readFile(absolutePath, "utf8");

      return {
        name,
        absolutePath,
        checksum: hashMigration(sql),
        sql
      };
    })
  );
}

export async function getDatabaseSchemaStatus(options?: {
  databaseUrl?: string;
  pool?: Pool;
  migrationsDir?: string;
}): Promise<DatabaseSchemaStatus> {
  const migrationFiles = await listMigrationFiles({ migrationsDir: options?.migrationsDir });

  return withMigrationQueryable(
    {
      databaseUrl: options?.databaseUrl,
      pool: options?.pool
    },
    async (queryable) => {
      try {
        await queryable.query("select 1");
      } catch {
        return createEmptySchemaStatus({
          reachable: false,
          failureReason: "unreachable"
        });
      }

      const metadataTableResult = await queryable.query<{ exists: string | null }>(
        `select to_regclass('public.${SCHEMA_MIGRATIONS_TABLE}') as exists`
      );
      const metadataTableExists = Boolean(metadataTableResult.rows[0]?.exists);

      if (!metadataTableExists) {
        const pendingMigrations = migrationFiles.map((migration) => migration.name);
        const summary = summarizeDatabaseSchemaStatus({
          missingMetadataTable: true,
          pendingMigrations,
          driftedMigrations: []
        });

        return createEmptySchemaStatus({
          ...summary,
          missingMetadataTable: true,
          pendingMigrations
        });
      }

      const appliedRows = await loadAppliedMigrationRows(queryable);
      const appliedByName = new Map(appliedRows.map((row) => [row.name, row]));
      const migrationNames = new Set(migrationFiles.map((migration) => migration.name));
      const pendingMigrations: string[] = [];
      const driftedMigrations: string[] = [];

      for (const migration of migrationFiles) {
        const applied = appliedByName.get(migration.name);

        if (!applied) {
          pendingMigrations.push(migration.name);
          continue;
        }

        if (applied.checksum !== migration.checksum) {
          driftedMigrations.push(migration.name);
        }
      }

      for (const applied of appliedRows) {
        if (!migrationNames.has(applied.name)) {
          driftedMigrations.push(applied.name);
        }
      }

      const summary = summarizeDatabaseSchemaStatus({
        missingMetadataTable: false,
        pendingMigrations,
        driftedMigrations
      });

      return createEmptySchemaStatus({
        ...summary,
        appliedMigrations: appliedRows.map((row) => row.name),
        pendingMigrations,
        driftedMigrations: Array.from(new Set(driftedMigrations)).sort((left, right) => left.localeCompare(right)),
        lastAppliedAt: appliedRows.length > 0 ? appliedRows[appliedRows.length - 1]!.appliedAt : null
      });
    }
  );
}

export async function assertDatabaseSchemaReady(options?: {
  databaseUrl?: string;
  pool?: Pool;
  migrationsDir?: string;
}): Promise<DatabaseSchemaStatus> {
  const status = await getDatabaseSchemaStatus(options);

  if (!status.ready) {
    throw new DatabaseSchemaNotReadyError(buildSchemaNotReadyMessage(status), status);
  }

  return status;
}

export async function runDatabaseMigrations(options?: {
  databaseUrl?: string;
  pool?: Pool;
  migrationsDir?: string;
}): Promise<DatabaseSchemaStatus> {
  const migrationFiles = await listMigrationFiles({ migrationsDir: options?.migrationsDir });

  await withMigrationQueryable(
    {
      databaseUrl: options?.databaseUrl,
      pool: options?.pool
    },
    async (queryable) => {
      try {
        await queryable.query("select 1");
      } catch {
        throw new DatabaseSchemaNotReadyError(
          "Database is unreachable.",
          createEmptySchemaStatus({
            reachable: false,
            failureReason: "unreachable"
          })
        );
      }

      await ensureMigrationMetadataTable(queryable);
      await ensureLegacyMigrationBootstrapTables(queryable);
      const appliedRows = await loadAppliedMigrationRows(queryable);
      const appliedByName = new Map(appliedRows.map((row) => [row.name, row]));

      for (const applied of appliedRows) {
        if (!migrationFiles.some((migration) => migration.name === applied.name)) {
          throw new DatabaseSchemaNotReadyError(
            "Database migration metadata does not match the checked-in migration files.",
            createEmptySchemaStatus({
              driftedMigrations: [applied.name],
              failureReason: "migration_drift"
            })
          );
        }
      }

      for (const migration of migrationFiles) {
        const applied = appliedByName.get(migration.name);

        if (applied) {
          if (applied.checksum !== migration.checksum) {
            throw new DatabaseSchemaNotReadyError(
              "Database migration metadata does not match the checked-in migration files.",
              createEmptySchemaStatus({
                driftedMigrations: [migration.name],
                failureReason: "migration_drift"
              })
            );
          }

          continue;
        }

        const client = "connect" in queryable ? await queryable.connect() : queryable;

        try {
          await client.query("BEGIN");
          await client.query(migration.sql);
          await client.query(
            `
              insert into ${SCHEMA_MIGRATIONS_TABLE} (name, checksum)
              values ($1, $2)
            `,
            [migration.name, migration.checksum]
          );
          await client.query("COMMIT");
        } catch (error) {
          await client.query("ROLLBACK");
          throw error;
        } finally {
          if (isPoolClient(client)) {
            client.release();
          }
        }
      }
    }
  );

  return getDatabaseSchemaStatus(options);
}
