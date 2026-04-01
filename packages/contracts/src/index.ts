import { z } from "zod";

export const capabilityValues = [
  "read",
  "search",
  "create",
  "update",
  "draft",
  "send",
  "schedule",
  "monitor",
  "approve",
  "delete"
] as const;

export const riskClassValues = ["R1", "R2", "R3", "R4"] as const;
export const taskStateValues = [
  "queued",
  "running",
  "waiting",
  "blocked",
  "retrying",
  "failed",
  "completed"
] as const;
export const goalStatusValues = ["planned", "running", "waiting", "completed"] as const;
export const memoryTypeValues = ["observed", "inferred", "confirmed"] as const;
export const approvalDecisionValues = ["pending", "approved", "rejected"] as const;
export const artifactTypeValues = ["summary", "brief", "checklist", "draft", "explanation"] as const;
export const agentNameValues = [
  "communications",
  "calendar",
  "workflow",
  "research",
  "knowledge",
  "travel",
  "personal-admin",
  "finance-support",
  "orchestrator"
] as const;

export const CapabilitySchema = z.enum(capabilityValues);
export const RiskClassSchema = z.enum(riskClassValues);
export const TaskStateSchema = z.enum(taskStateValues);
export const GoalStatusSchema = z.enum(goalStatusValues);
export const MemoryTypeSchema = z.enum(memoryTypeValues);
export const ApprovalDecisionSchema = z.enum(approvalDecisionValues);
export const ArtifactTypeSchema = z.enum(artifactTypeValues);
export const AgentNameSchema = z.enum(agentNameValues);

export const ToolInvocationSchema = z.object({
  adapterKey: z.string().min(1),
  capability: CapabilitySchema,
  label: z.string().min(1),
  input: z.record(z.string(), z.unknown()).default({})
});

export const ArtifactSchema = z.object({
  id: z.string().min(1),
  goalId: z.string().min(1),
  taskId: z.string().min(1).optional(),
  artifactType: ArtifactTypeSchema,
  title: z.string().min(1),
  content: z.string().min(1),
  metadata: z.record(z.string(), z.unknown()).default({}),
  createdAt: z.string().datetime()
});

export const AgentResultSchema = z.object({
  agent: AgentNameSchema,
  summary: z.string().min(1),
  confidence: z.number().min(0).max(1),
  artifacts: z.array(ArtifactSchema).default([]),
  proposedToolCalls: z.array(ToolInvocationSchema).default([]),
  nextSteps: z.array(z.string()).default([]),
  explanation: z.string().min(1)
});

export const WorkflowStateSchema = z.object({
  id: z.string().min(1),
  goalId: z.string().min(1),
  status: z.string().min(1),
  currentStep: z.string().min(1),
  checkpoint: z.string().nullable().default(null),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime()
});

export const GoalSchema = z.object({
  id: z.string().min(1),
  userId: z.string().min(1),
  workflowId: z.string().min(1),
  title: z.string().min(1),
  request: z.string().min(1),
  intent: z.string().min(1),
  status: GoalStatusSchema,
  confidence: z.number().min(0).max(1),
  explanation: z.string().min(1),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime()
});

export const TaskSchema = z.object({
  id: z.string().min(1),
  goalId: z.string().min(1),
  workflowId: z.string().min(1),
  title: z.string().min(1),
  summary: z.string().min(1),
  assignedAgent: AgentNameSchema,
  state: TaskStateSchema,
  riskClass: RiskClassSchema,
  requiresApproval: z.boolean(),
  dependsOn: z.array(z.string()).default([]),
  toolCapabilities: z.array(CapabilitySchema).default([]),
  artifactIds: z.array(z.string()).default([]),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime()
});

export const MemoryRecordSchema = z.object({
  id: z.string().min(1),
  userId: z.string().min(1),
  category: z.string().min(1),
  memoryType: MemoryTypeSchema,
  content: z.string().min(1),
  confidence: z.number().min(0).max(1),
  source: z.string().min(1),
  sensitivity: z.string().min(1),
  permissions: z.array(AgentNameSchema).default([]),
  reviewAt: z.string().datetime().nullable().default(null),
  expiryAt: z.string().datetime().nullable().default(null),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime()
});

export const PolicyDecisionSchema = z.object({
  riskClass: RiskClassSchema,
  outcome: z.enum(["allowed", "allowed_with_confirmation", "blocked", "downgrade_to_draft", "escalate"]),
  rationale: z.string().min(1),
  confidence: z.number().min(0).max(1),
  requiresApproval: z.boolean()
});

export const ApprovalRequestSchema = z.object({
  id: z.string().min(1),
  goalId: z.string().min(1),
  taskId: z.string().min(1),
  title: z.string().min(1),
  rationale: z.string().min(1),
  riskClass: RiskClassSchema,
  decision: ApprovalDecisionSchema,
  requestedAction: z.string().min(1),
  createdAt: z.string().datetime(),
  respondedAt: z.string().datetime().nullable().default(null)
});

export const WatcherSchema = z.object({
  id: z.string().min(1),
  goalId: z.string().min(1),
  targetEntity: z.string().min(1),
  condition: z.string().min(1),
  frequency: z.string().min(1),
  triggerAction: z.string().min(1),
  sourceSystems: z.array(z.string()).default([]),
  status: z.enum(["active", "paused", "expired"]).default("active"),
  expiryAt: z.string().datetime().nullable().default(null),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime()
});

export const ActionLogSchema = z.object({
  id: z.string().min(1),
  goalId: z.string().min(1),
  taskId: z.string().nullable().default(null),
  workflowId: z.string().nullable().default(null),
  actor: z.string().min(1),
  kind: z.string().min(1),
  message: z.string().min(1),
  details: z.record(z.string(), z.unknown()).default({}),
  createdAt: z.string().datetime()
});

export const IntegrationAccountSchema = z.object({
  id: z.string().min(1),
  userId: z.string().min(1),
  name: z.string().min(1),
  system: z.string().min(1),
  status: z.enum(["ready", "mock", "manual", "disabled"]),
  scopes: z.array(z.string()).default([]),
  capabilities: z.array(CapabilitySchema).default([]),
  metadata: z.record(z.string(), z.unknown()).default({}),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime()
});

export const GoalBundleSchema = z.object({
  goal: GoalSchema,
  workflow: WorkflowStateSchema,
  tasks: z.array(TaskSchema),
  artifacts: z.array(ArtifactSchema),
  approvals: z.array(ApprovalRequestSchema),
  watchers: z.array(WatcherSchema),
  actionLogs: z.array(ActionLogSchema)
});

export type Capability = z.infer<typeof CapabilitySchema>;
export type RiskClass = z.infer<typeof RiskClassSchema>;
export type TaskState = z.infer<typeof TaskStateSchema>;
export type GoalStatus = z.infer<typeof GoalStatusSchema>;
export type MemoryType = z.infer<typeof MemoryTypeSchema>;
export type ApprovalDecision = z.infer<typeof ApprovalDecisionSchema>;
export type ArtifactType = z.infer<typeof ArtifactTypeSchema>;
export type AgentName = z.infer<typeof AgentNameSchema>;
export type ToolInvocation = z.infer<typeof ToolInvocationSchema>;
export type Artifact = z.infer<typeof ArtifactSchema>;
export type AgentResult = z.infer<typeof AgentResultSchema>;
export type WorkflowState = z.infer<typeof WorkflowStateSchema>;
export type Goal = z.infer<typeof GoalSchema>;
export type Task = z.infer<typeof TaskSchema>;
export type MemoryRecord = z.infer<typeof MemoryRecordSchema>;
export type PolicyDecision = z.infer<typeof PolicyDecisionSchema>;
export type ApprovalRequest = z.infer<typeof ApprovalRequestSchema>;
export type Watcher = z.infer<typeof WatcherSchema>;
export type ActionLog = z.infer<typeof ActionLogSchema>;
export type IntegrationAccount = z.infer<typeof IntegrationAccountSchema>;
export type GoalBundle = z.infer<typeof GoalBundleSchema>;

export const SYSTEM_USER_ID = "user-primary";

export function nowIso(): string {
  return new Date().toISOString();
}

export function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

