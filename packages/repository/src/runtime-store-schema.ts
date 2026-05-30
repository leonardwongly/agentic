import { z } from "zod";
import {
  ActionLogSchema,
  AgentDefinitionSchema,
  AgentMetricsSchema,
  ApprovalRequestSchema,
  ArtifactSchema,
  AutopilotEventSchema,
  AutopilotSettingsSchema,
  BriefingPreferencesSchema,
  CommitmentSchema,
  EvidenceRecordSchema,
  GoalSchema,
  GoalShareRecordSchema,
  GoalTemplateSchema,
  IntegrationAccountSchema,
  JobRecordSchema,
  LlmCacheEntrySchema,
  MemoryRecordSchema,
  OperatorProductSchema,
  OperatorProductSelectionSchema,
  PrivacyOperationSchema,
  ProviderCredentialSchema,
  ProviderCredentialSecretRecordSchema,
  ProviderSideEffectRecordSchema,
  TaskSchema,
  WatcherSchema,
  WorkflowCanvasTemplateSchema,
  WorkflowStateSchema,
  WorkspaceGovernanceSchema,
  WorkspaceMemberSchema,
  WorkspaceSchema,
  WorkspaceSelectionSchema
} from "@agentic/contracts";

export const UserRecordSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  timezone: z.string().min(1),
  createdAt: z.string().datetime()
});

export type UserRecord = z.infer<typeof UserRecordSchema>;

export const PolicyRuleRecordSchema = z.object({
  id: z.string().min(1),
  userId: z.string().min(1),
  name: z.string().min(1),
  description: z.string().min(1),
  active: z.boolean(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime()
});

export type PolicyRuleRecord = z.infer<typeof PolicyRuleRecordSchema>;

export const RuntimeStoreSchema = z.object({
  version: z.literal(1),
  users: z.array(UserRecordSchema),
  goals: z.array(GoalSchema),
  workflows: z.array(WorkflowStateSchema),
  tasks: z.array(TaskSchema),
  memories: z.array(MemoryRecordSchema),
  approvals: z.array(ApprovalRequestSchema),
  actionLogs: z.array(ActionLogSchema),
  evidenceRecords: z.array(EvidenceRecordSchema).default([]),
  watchers: z.array(WatcherSchema),
  integrations: z.array(IntegrationAccountSchema),
  providerCredentials: z.array(ProviderCredentialSchema).default([]),
  providerCredentialSecrets: z.array(ProviderCredentialSecretRecordSchema).default([]),
  providerSideEffects: z.array(ProviderSideEffectRecordSchema).default([]),
  artifacts: z.array(ArtifactSchema),
  workspaces: z.array(WorkspaceSchema).default([]),
  workspaceMembers: z.array(WorkspaceMemberSchema).default([]),
  workspaceSelections: z.array(WorkspaceSelectionSchema).default([]),
  workspaceGovernance: z.array(WorkspaceGovernanceSchema).default([]),
  goalShares: z.array(GoalShareRecordSchema).default([]),
  privacyOperations: z.array(PrivacyOperationSchema).default([]),
  commitments: z.array(CommitmentSchema).default([]),
  policyRules: z.array(PolicyRuleRecordSchema),
  templates: z.array(GoalTemplateSchema).default([]),
  workflowTemplates: z.array(WorkflowCanvasTemplateSchema).default([]),
  autopilotSettings: z.array(AutopilotSettingsSchema).default([]),
  autopilotEvents: z.array(AutopilotEventSchema).default([]),
  jobs: z.array(JobRecordSchema).default([]),
  agents: z.array(AgentDefinitionSchema).default([]),
  agentMetrics: z.array(AgentMetricsSchema).default([]),
  briefingPreferences: z.array(BriefingPreferencesSchema).default([]),
  operatorProducts: z.array(OperatorProductSchema).default([]),
  operatorProductSelections: z.array(OperatorProductSelectionSchema).default([]),
  llmCache: z.array(LlmCacheEntrySchema).default([])
});

export type RuntimeStore = z.infer<typeof RuntimeStoreSchema>;
