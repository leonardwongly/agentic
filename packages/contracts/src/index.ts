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
  // Agent-scoped memories
  agentId: z.string().nullable().default(null),
  agentScope: z.enum(["global", "agent-only", "agent-preferred"]).default("global"),
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

export const APPROVAL_EXPIRY_MS = 48 * 60 * 60 * 1000; // 48 hours

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
  expiryAt: z.string().datetime(),
  respondedAt: z.string().datetime().nullable().default(null)
});

export const watcherFrequencyValues = ["realtime", "5min", "15min", "hourly", "daily"] as const;
export const WatcherFrequencySchema = z.enum(watcherFrequencyValues);

export const WatcherSchema = z.object({
  id: z.string().min(1),
  goalId: z.string().min(1),
  targetEntity: z.string().min(1),
  condition: z.string().min(1),
  frequency: WatcherFrequencySchema,
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
  createdAt: z.string().datetime(),
  prevHash: z.string().nullable().default(null)
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

export const GoalTemplateSchema = z.object({
  id: z.string().min(1),
  userId: z.string().min(1),
  name: z.string().min(1).max(200),
  description: z.string().max(500).default(""),
  request: z.string().min(1).max(2_000),
  parameters: z.record(z.string(), z.string()).default({}),
  schedule: z.object({
    enabled: z.boolean().default(false),
    cron: z.string().max(100).default(""),
    timezone: z.string().max(100).default("UTC"),
    lastRunAt: z.string().datetime().nullable().default(null),
    nextRunAt: z.string().datetime().nullable().default(null)
  }).default({ enabled: false, cron: "", timezone: "UTC", lastRunAt: null, nextRunAt: null }),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime()
});

// ============================================================================
// AGENT MANAGEMENT SCHEMAS
// ============================================================================

/**
 * Agent status values for lifecycle management
 */
export const agentStatusValues = ["active", "paused", "archived", "draft"] as const;
export const AgentStatusSchema = z.enum(agentStatusValues);

/**
 * Agent category for organization and filtering
 */
export const agentCategoryValues = [
  "productivity",
  "communication",
  "research",
  "scheduling",
  "finance",
  "development",
  "creative",
  "administrative",
  "custom"
] as const;
export const AgentCategorySchema = z.enum(agentCategoryValues);

/**
 * Integration permission levels for fine-grained access control
 */
export const integrationPermissionValues = ["none", "read", "write", "full"] as const;
export const IntegrationPermissionSchema = z.enum(integrationPermissionValues);

/**
 * Agent-specific integration permissions
 */
export const AgentIntegrationPermissionSchema = z.object({
  integrationId: z.string().min(1),
  permission: IntegrationPermissionSchema,
  allowedScopes: z.array(z.string()).default([])
});

/**
 * Agent-specific memory permissions per category
 */
export const AgentMemoryPermissionSchema = z.object({
  category: z.string().min(1),
  canRead: z.boolean().default(true),
  canWrite: z.boolean().default(false)
});

/**
 * Prompt variable definition for dynamic agent prompts
 */
export const PromptVariableSchema = z.object({
  name: z.string().min(1).max(64).regex(/^[a-z_][a-z0-9_]*$/i, "Variable name must be alphanumeric with underscores"),
  description: z.string().max(200).default(""),
  defaultValue: z.string().max(500).default(""),
  required: z.boolean().default(false)
});

/**
 * Agent behavior configuration for tuning outputs
 */
export const AgentBehaviorConfigSchema = z.object({
  temperature: z.number().min(0).max(2).default(0.7),
  maxTokens: z.number().int().min(100).max(8000).default(1500),
  topP: z.number().min(0).max(1).default(1),
  frequencyPenalty: z.number().min(-2).max(2).default(0),
  presencePenalty: z.number().min(-2).max(2).default(0),
  responseStyle: z.enum(["concise", "detailed", "balanced"]).default("balanced"),
  formality: z.enum(["casual", "professional", "formal"]).default("professional")
});

/**
 * Full agent definition schema - the core entity for agent management
 */
export const AgentDefinitionSchema = z.object({
  // Identity
  id: z.string().min(1),
  userId: z.string().min(1),
  name: z.string().min(1).max(64),
  displayName: z.string().min(1).max(100),
  description: z.string().max(500).default(""),
  icon: z.string().max(50).default("🤖"),
  category: AgentCategorySchema.default("custom"),
  tags: z.array(z.string().max(32)).max(10).default([]),

  // Behavior
  systemPrompt: z.string().min(10).max(8000),
  promptVariables: z.array(PromptVariableSchema).max(20).default([]),
  artifactType: ArtifactTypeSchema.default("summary"),
  behaviorConfig: AgentBehaviorConfigSchema.optional().default({
    temperature: 0.7,
    maxTokens: 1500,
    topP: 1,
    frequencyPenalty: 0,
    presencePenalty: 0,
    responseStyle: "balanced",
    formality: "professional"
  }),

  // Capabilities & Permissions
  allowedCapabilities: z.array(CapabilitySchema).default(["read", "search"]),
  blockedCapabilities: z.array(CapabilitySchema).default([]),
  maxRiskClass: RiskClassSchema.default("R2"),
  integrationPermissions: z.array(AgentIntegrationPermissionSchema).default([]),
  memoryPermissions: z.array(AgentMemoryPermissionSchema).default([]),

  // Lineage & Metadata
  isBuiltIn: z.boolean().default(false),
  parentAgentId: z.string().nullable().default(null),
  version: z.number().int().min(1).default(1),
  status: AgentStatusSchema.default("active"),

  // Timestamps
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime()
});

/**
 * Agent metrics for performance tracking
 */
export const AgentMetricsSchema = z.object({
  agentId: z.string().min(1),
  period: z.enum(["day", "week", "month", "all"]),
  periodStart: z.string().datetime(),
  periodEnd: z.string().datetime(),

  // Task metrics
  tasksTotal: z.number().int().min(0).default(0),
  tasksCompleted: z.number().int().min(0).default(0),
  tasksFailed: z.number().int().min(0).default(0),
  tasksBlocked: z.number().int().min(0).default(0),

  // Approval metrics
  approvalsRequested: z.number().int().min(0).default(0),
  approvalsApproved: z.number().int().min(0).default(0),
  approvalsRejected: z.number().int().min(0).default(0),

  // Quality metrics
  averageConfidence: z.number().min(0).max(1).default(0),
  averageExecutionTimeMs: z.number().min(0).default(0),

  // Artifact metrics
  artifactsProduced: z.number().int().min(0).default(0),
  artifactsByType: z.record(z.string(), z.number().int()).default({}),

  // Error tracking
  errorCount: z.number().int().min(0).default(0),
  lastErrorAt: z.string().datetime().nullable().default(null),
  lastErrorMessage: z.string().max(500).nullable().default(null),

  // User feedback
  feedbackCount: z.number().int().min(0).default(0),
  averageRating: z.number().min(0).max(10).nullable().default(null),

  // Computed at aggregation
  successRate: z.number().min(0).max(1).default(0),
  approvalRate: z.number().min(0).max(1).default(0),

  updatedAt: z.string().datetime()
});

/**
 * Agent activity event types for real-time streaming
 */
export const agentActivityEventKindValues = [
  "agent.started",
  "agent.thinking",
  "agent.integration_call",
  "agent.integration_response",
  "agent.artifact_created",
  "agent.completed",
  "agent.failed",
  "agent.waiting_approval",
  "agent.resumed"
] as const;
export const AgentActivityEventKindSchema = z.enum(agentActivityEventKindValues);

/**
 * Agent activity event for real-time streaming
 */
export const AgentActivityEventSchema = z.object({
  id: z.string().min(1),
  agentId: z.string().min(1),
  agentName: z.string().min(1),
  goalId: z.string().nullable().default(null),
  taskId: z.string().nullable().default(null),
  kind: AgentActivityEventKindSchema,
  message: z.string().min(1).max(500),
  details: z.record(z.string(), z.unknown()).default({}),
  progress: z.number().min(0).max(100).nullable().default(null),
  timestamp: z.string().datetime()
});

/**
 * Agent runtime state for status indicators
 */
export const agentRuntimeStateValues = ["idle", "working", "waiting", "errored", "paused"] as const;
export const AgentRuntimeStateSchema = z.enum(agentRuntimeStateValues);

export const AgentRuntimeStatusSchema = z.object({
  agentId: z.string().min(1),
  state: AgentRuntimeStateSchema,
  currentTaskId: z.string().nullable().default(null),
  currentTaskTitle: z.string().nullable().default(null),
  currentGoalId: z.string().nullable().default(null),
  lastActivityAt: z.string().datetime().nullable().default(null),
  lastErrorAt: z.string().datetime().nullable().default(null),
  lastErrorMessage: z.string().max(500).nullable().default(null)
});

// ============================================================================
// WORKFLOW TEMPLATE SCHEMAS
// ============================================================================

/**
 * Workflow step condition for conditional branching
 */
export const WorkflowStepConditionSchema = z.object({
  field: z.string().min(1).max(100),
  operator: z.enum(["equals", "not_equals", "contains", "not_contains", "greater_than", "less_than", "is_empty", "is_not_empty"]),
  value: z.string().max(500).default("")
});

/**
 * Workflow step input mapping from previous step outputs
 */
export const WorkflowStepInputSchema = z.object({
  variableName: z.string().min(1).max(64),
  sourceStepId: z.string().min(1),
  sourceField: z.string().min(1).max(100),
  transformation: z.enum(["none", "json_extract", "first_line", "summary"]).default("none"),
  transformationConfig: z.record(z.string(), z.unknown()).default({})
});

/**
 * Individual workflow step definition
 */
export const WorkflowStepSchema = z.object({
  id: z.string().min(1),
  order: z.number().int().min(0),
  name: z.string().min(1).max(100),
  description: z.string().max(500).default(""),

  // Agent assignment
  agentId: z.string().min(1),
  taskPrompt: z.string().min(1).max(2000),

  // Input/output configuration
  inputs: z.array(WorkflowStepInputSchema).max(20).default([]),
  outputVariables: z.array(z.string().max(64)).max(10).default([]),

  // Flow control
  requiresApproval: z.boolean().default(false),
  approvalPrompt: z.string().max(500).default(""),
  onApprovalRejected: z.enum(["stop", "skip", "retry", "goto"]).default("stop"),
  gotoStepId: z.string().nullable().default(null),

  // Conditional execution
  condition: WorkflowStepConditionSchema.nullable().default(null),
  skipOnConditionFail: z.boolean().default(false),

  // Error handling
  onError: z.enum(["stop", "skip", "retry", "goto"]).default("stop"),
  maxRetries: z.number().int().min(0).max(5).default(0),
  errorGotoStepId: z.string().nullable().default(null),

  // Timeout
  timeoutMs: z.number().int().min(1000).max(300000).default(60000)
});

/**
 * Workflow template schedule configuration
 */
export const WorkflowScheduleSchema = z.object({
  enabled: z.boolean().default(false),
  cron: z.string().max(100).default(""),
  timezone: z.string().max(100).default("UTC"),
  lastRunAt: z.string().datetime().nullable().default(null),
  nextRunAt: z.string().datetime().nullable().default(null),
  runCount: z.number().int().min(0).default(0),
  maxRuns: z.number().int().min(0).nullable().default(null)
});

/**
 * Full workflow template schema for multi-agent orchestration
 */
export const WorkflowTemplateSchema = z.object({
  id: z.string().min(1),
  userId: z.string().min(1),
  name: z.string().min(1).max(200),
  description: z.string().max(1000).default(""),
  icon: z.string().max(50).default("⚡"),
  category: AgentCategorySchema.default("custom"),
  tags: z.array(z.string().max(32)).max(10).default([]),

  // Steps
  steps: z.array(WorkflowStepSchema).min(1).max(20),

  // Variables
  variables: z.record(z.string(), z.object({
    description: z.string().max(200).default(""),
    defaultValue: z.string().max(500).default(""),
    required: z.boolean().default(false)
  })).default({}),

  // Schedule
  schedule: WorkflowScheduleSchema.optional().default({
    enabled: false,
    cron: "",
    timezone: "UTC",
    lastRunAt: null,
    nextRunAt: null,
    runCount: 0,
    maxRuns: null
  }),

  // Execution settings
  stopOnFirstError: z.boolean().default(true),
  notifyOnComplete: z.boolean().default(false),
  notifyOnError: z.boolean().default(true),

  // Metadata
  status: AgentStatusSchema.default("active"),
  version: z.number().int().min(1).default(1),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime()
});

/**
 * Workflow execution state for tracking running workflows
 */
export const WorkflowExecutionStateSchema = z.object({
  id: z.string().min(1),
  templateId: z.string().min(1),
  goalId: z.string().min(1),
  status: z.enum(["running", "paused", "completed", "failed", "cancelled"]),
  currentStepId: z.string().nullable().default(null),
  currentStepIndex: z.number().int().min(0).default(0),
  stepResults: z.record(z.string(), z.object({
    status: z.enum(["pending", "running", "completed", "failed", "skipped"]),
    output: z.record(z.string(), z.unknown()).default({}),
    error: z.string().nullable().default(null),
    startedAt: z.string().datetime().nullable().default(null),
    completedAt: z.string().datetime().nullable().default(null)
  })).default({}),
  variables: z.record(z.string(), z.string()).default({}),
  startedAt: z.string().datetime(),
  completedAt: z.string().datetime().nullable().default(null),
  error: z.string().nullable().default(null)
});

/**
 * Agent export format for import/export marketplace
 */
export const AgentExportSchema = z.object({
  version: z.literal(1),
  exportedAt: z.string().datetime(),
  agent: AgentDefinitionSchema.omit({ userId: true, isBuiltIn: true, createdAt: true, updatedAt: true }),
  metadata: z.object({
    exportedBy: z.string().max(100).optional(),
    sourceVersion: z.string().max(20).optional(),
    description: z.string().max(1000).optional(),
    tags: z.array(z.string().max(32)).max(10).default([]),
    usageHints: z.array(z.string().max(200)).max(5).default([])
  }).optional().default({
    tags: [],
    usageHints: []
  })
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
export type WatcherFrequency = z.infer<typeof WatcherFrequencySchema>;
export type Watcher = z.infer<typeof WatcherSchema>;
export type ActionLog = z.infer<typeof ActionLogSchema>;
export type IntegrationAccount = z.infer<typeof IntegrationAccountSchema>;
export type GoalBundle = z.infer<typeof GoalBundleSchema>;
export type GoalTemplate = z.infer<typeof GoalTemplateSchema>;

// Agent Management Types
export type AgentStatus = z.infer<typeof AgentStatusSchema>;
export type AgentCategory = z.infer<typeof AgentCategorySchema>;
export type IntegrationPermission = z.infer<typeof IntegrationPermissionSchema>;
export type AgentIntegrationPermission = z.infer<typeof AgentIntegrationPermissionSchema>;
export type AgentMemoryPermission = z.infer<typeof AgentMemoryPermissionSchema>;
export type PromptVariable = z.infer<typeof PromptVariableSchema>;
export type AgentBehaviorConfig = z.infer<typeof AgentBehaviorConfigSchema>;
export type AgentDefinition = z.infer<typeof AgentDefinitionSchema>;
export type AgentMetrics = z.infer<typeof AgentMetricsSchema>;
export type AgentActivityEventKind = z.infer<typeof AgentActivityEventKindSchema>;
export type AgentActivityEvent = z.infer<typeof AgentActivityEventSchema>;
export type AgentRuntimeState = z.infer<typeof AgentRuntimeStateSchema>;
export type AgentRuntimeStatus = z.infer<typeof AgentRuntimeStatusSchema>;

// Workflow Template Types
export type WorkflowStepCondition = z.infer<typeof WorkflowStepConditionSchema>;
export type WorkflowStepInput = z.infer<typeof WorkflowStepInputSchema>;
export type WorkflowStep = z.infer<typeof WorkflowStepSchema>;
export type WorkflowSchedule = z.infer<typeof WorkflowScheduleSchema>;
export type WorkflowTemplate = z.infer<typeof WorkflowTemplateSchema>;
export type WorkflowExecutionState = z.infer<typeof WorkflowExecutionStateSchema>;
export type AgentExport = z.infer<typeof AgentExportSchema>;

export const SYSTEM_USER_ID = "user-primary";

export function nowIso(): string {
  return new Date().toISOString();
}

export function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

