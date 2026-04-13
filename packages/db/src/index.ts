import { pgTable, text, timestamp, boolean, jsonb, real, integer, index } from "drizzle-orm/pg-core";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";

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
  selectedAt: timestamp("selected_at", { withTimezone: true }).notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull()
});

export const workspaceGovernance = pgTable("workspace_governance", {
  workspaceId: text("workspace_id").primaryKey(),
  approvalMode: text("approval_mode").notNull(),
  requireAuditExports: boolean("require_audit_exports").notNull(),
  maxAutoRunRiskClass: text("max_auto_run_risk_class").notNull(),
  externalSendRequiresApproval: boolean("external_send_requires_approval").notNull(),
  calendarWriteRequiresApproval: boolean("calendar_write_requires_approval").notNull(),
  retentionDays: integer("retention_days").notNull(),
  updatedBy: text("updated_by").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull()
});

export const briefingPreferences = pgTable("briefing_preferences", {
  userId: text("user_id").primaryKey(),
  timezone: text("timezone").notNull(),
  focus: text("focus").notNull(),
  schedules: jsonb("schedules").$type<Array<Record<string, unknown>>>().notNull(),
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
  createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull()
});

export const autopilotSettings = pgTable("autopilot_settings", {
  userId: text("user_id").primaryKey(),
  mode: text("mode").notNull(),
  debounceMinutes: integer("debounce_minutes").notNull(),
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
  createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
  processedAt: timestamp("processed_at", { withTimezone: true }),
  resultGoalId: text("result_goal_id"),
  error: text("error")
});

export const integrationAccounts = pgTable("integration_accounts", {
  id: text("id").primaryKey(),
  userId: text("user_id").notNull(),
  name: text("name").notNull(),
  system: text("system").notNull(),
  status: text("status").notNull(),
  scopes: jsonb("scopes").$type<string[]>().notNull(),
  capabilities: jsonb("capabilities").$type<string[]>().notNull(),
  metadata: jsonb("metadata").$type<Record<string, unknown>>().notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull()
});

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
  selectedAt: timestamp("selected_at", { withTimezone: true }).notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull()
});

export function createDb(url: string) {
  const pool = new Pool({ connectionString: url });
  return drizzle({ client: pool });
}
