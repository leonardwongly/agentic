import { pgTable, text, timestamp, boolean, jsonb, real } from "drizzle-orm/pg-core";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";

export const users = pgTable("users", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull()
});

export const workflows = pgTable("workflows", {
  id: text("id").primaryKey(),
  goalId: text("goal_id").notNull(),
  status: text("status").notNull(),
  currentStep: text("current_step").notNull(),
  checkpoint: text("checkpoint"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull()
});

export const goals = pgTable("goals", {
  id: text("id").primaryKey(),
  userId: text("user_id").notNull(),
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
  createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
  respondedAt: timestamp("responded_at", { withTimezone: true })
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

export function createDb(url: string) {
  const pool = new Pool({ connectionString: url });
  return drizzle({ client: pool });
}

