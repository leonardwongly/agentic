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
export const goalWedgeKeyValues = [
  "communications_execution",
  "scheduling_execution",
  "travel_readiness",
  "general_coordination"
] as const;
export const goalWedgeSelectionValues = ["selected_production", "supporting"] as const;
export const memoryTypeValues = ["observed", "inferred", "confirmed"] as const;
export const approvalDecisionValues = ["pending", "approved", "rejected"] as const;
export const approvalActionTypeValues = ["send", "schedule", "create", "update", "delete", "draft", "artifact-only"] as const;
export const approvalDecisionScopeValues = ["once", "similar_24h", "always_review"] as const;
export const artifactTypeValues = ["summary", "brief", "checklist", "draft", "explanation"] as const;
export const agentExecutionModeValues = [
  "deterministic_scaffold",
  "custom_prompt_scaffold",
  "governed_specialist",
  "manual_review_required"
] as const;
export const commitmentStatusValues = [
  "pending",
  "needs-review",
  "scheduled",
  "blocked",
  "completed",
  "stale",
  "dismissed"
] as const;
export const commitmentSourceKindValues = ["goal", "approval"] as const;
export const commitmentUrgencyValues = ["immediate", "today", "soon", "later"] as const;
export const commitmentSuggestedActionKindValues = [
  "review_approval",
  "continue_goal",
  "resolve_blocker",
  "review_source"
] as const;
export const briefingTypeValues = ["startup", "midday", "pre_meeting", "end_of_day", "next_day"] as const;
export const briefingFocusValues = ["balanced", "urgent", "deep"] as const;
export const autopilotModeValues = ["notify_only", "draft_goal", "auto_run"] as const;
export const autopilotEventKindValues = ["watcher_triggered", "template_due", "briefing_due"] as const;
export const autopilotEventStatusValues = ["pending", "simulated", "notified", "executed", "debounced", "ignored", "failed"] as const;
export const goalShareStatusValues = ["active", "revoked"] as const;
export const privacyOperationKindValues = ["retention_enforcement", "workspace_export", "workspace_delete"] as const;
export const privacyOperationStatusValues = ["queued", "running", "completed", "failed"] as const;
export const jobKindValues = ["goal_create", "goal_refine", "briefing_create", "template_run", "docs_render", "autopilot_process", "privacy_operation", "public_share_view"] as const;
export const jobStatusValues = ["queued", "running", "retrying", "completed", "dead_letter"] as const;
export const evidenceRecordSourceKindValues = ["approval_response"] as const;
export const workspaceRoleValues = ["owner", "editor", "viewer"] as const;
export const workspaceApprovalModeValues = ["always_review", "risk_based"] as const;
export const actorKindValues = ["human", "system"] as const;
export const providerValues = ["google"] as const;
export const providerCredentialStatusValues = [
  "connected",
  "reconnect_required",
  "refresh_failed",
  "revoked"
] as const;
export const providerCredentialSecretKindValues = ["oauth_refresh_token"] as const;
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
export const operatorProductStatusValues = ["active", "draft", "archived"] as const;
export const operatorProductReadinessValues = ["ready", "recommended", "optional", "missing"] as const;

export const CapabilitySchema = z.enum(capabilityValues);
export const RiskClassSchema = z.enum(riskClassValues);
export const TaskStateSchema = z.enum(taskStateValues);
export const GoalStatusSchema = z.enum(goalStatusValues);
export const GoalWedgeKeySchema = z.enum(goalWedgeKeyValues);
export const GoalWedgeSelectionSchema = z.enum(goalWedgeSelectionValues);
export const MemoryTypeSchema = z.enum(memoryTypeValues);
export const ApprovalDecisionSchema = z.enum(approvalDecisionValues);
export const ApprovalActionTypeSchema = z.enum(approvalActionTypeValues);
export const ApprovalDecisionScopeSchema = z.enum(approvalDecisionScopeValues);
export const ArtifactTypeSchema = z.enum(artifactTypeValues);
export const AgentExecutionModeSchema = z.enum(agentExecutionModeValues);
export const CommitmentStatusSchema = z.enum(commitmentStatusValues);
export const CommitmentSourceKindSchema = z.enum(commitmentSourceKindValues);
export const CommitmentUrgencySchema = z.enum(commitmentUrgencyValues);
export const CommitmentSuggestedActionKindSchema = z.enum(commitmentSuggestedActionKindValues);
export const BriefingTypeSchema = z.enum(briefingTypeValues);
export const BriefingFocusSchema = z.enum(briefingFocusValues);
export const AutopilotModeSchema = z.enum(autopilotModeValues);
export const AutopilotEventKindSchema = z.enum(autopilotEventKindValues);
export const AutopilotEventStatusSchema = z.enum(autopilotEventStatusValues);
export const GoalShareStatusSchema = z.enum(goalShareStatusValues);
export const PrivacyOperationKindSchema = z.enum(privacyOperationKindValues);
export const PrivacyOperationStatusSchema = z.enum(privacyOperationStatusValues);
export const JobKindSchema = z.enum(jobKindValues);
export const JobStatusSchema = z.enum(jobStatusValues);
export const EvidenceRecordSourceKindSchema = z.enum(evidenceRecordSourceKindValues);
export const WorkspaceRoleSchema = z.enum(workspaceRoleValues);
export const WorkspaceApprovalModeSchema = z.enum(workspaceApprovalModeValues);
export const ActorKindSchema = z.enum(actorKindValues);
export const ProviderSchema = z.enum(providerValues);
export const ProviderCredentialStatusSchema = z.enum(providerCredentialStatusValues);
export const ProviderCredentialSecretKindSchema = z.enum(providerCredentialSecretKindValues);
export const AgentNameSchema = z.enum(agentNameValues);
export const OperatorProductStatusSchema = z.enum(operatorProductStatusValues);
export const OperatorProductReadinessSchema = z.enum(operatorProductReadinessValues);

const TimeOfDaySchema = z
  .string()
  .regex(/^\d{2}:\d{2}$/, "Time must be in HH:MM format.")
  .refine(
    (value) => {
      const [hours, minutes] = value.split(":").map(Number);
      return hours >= 0 && hours <= 23 && minutes >= 0 && minutes <= 59;
    },
    { message: "Time must be a valid HH:MM value." }
  );

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
  executionMode: AgentExecutionModeSchema,
  artifacts: z.array(ArtifactSchema).default([]),
  proposedToolCalls: z.array(ToolInvocationSchema).default([]),
  nextSteps: z.array(z.string()).default([]),
  explanation: z.string().min(1)
});

export const WorkflowStateSchema = z.object({
  id: z.string().min(1),
  goalId: z.string().min(1),
  workspaceId: z.string().min(1).nullable().default(null),
  status: z.string().min(1),
  currentStep: z.string().min(1),
  checkpoint: z.string().nullable().default(null),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime()
});

export const GoalWedgeSchema = z.object({
  key: GoalWedgeKeySchema,
  label: z.string().min(1),
  selection: GoalWedgeSelectionSchema,
  rationale: z.string().min(1)
});

export const GoalCompletionContractSchema = z.object({
  id: z.string().min(1),
  summary: z.string().min(1),
  successCriteria: z.array(z.string().min(1)).min(1),
  evidenceSignals: z.array(z.string().min(1)).min(1),
  approvalExpectations: z.array(z.string().min(1)).default([]),
  doneWhen: z.string().min(1)
});

const goalContractProfiles = {
  communications_execution: {
    wedge: {
      key: "communications_execution",
      label: "Communications execution",
      selection: "selected_production",
      rationale: "Inbox triage and follow-up are one of the two explicitly selected Phase 3 production wedges."
    },
    completionContract: {
      id: "communications-execution-v1",
      summary: "Produce a prioritized inbox follow-up bundle with outbound side effects held behind approval.",
      successCriteria: [
        "Urgent and high-signal inbound threads are reviewed and ranked.",
        "Actionable reply drafts or escalation notes are prepared for the surfaced threads.",
        "Follow-up commitments are captured before any external send is executed."
      ],
      evidenceSignals: [
        "Priority message review artifact exists.",
        "Draft or escalation artifact exists for the reply step.",
        "Any external send remains approval-gated until a human decision is recorded."
      ],
      approvalExpectations: [
        "External message sends require an explicit approval record before execution."
      ],
      doneWhen: "The inbox triage workflow has surfaced the urgent threads, prepared the follow-up artifacts, and left external delivery behind the approval boundary."
    }
  },
  scheduling_execution: {
    wedge: {
      key: "scheduling_execution",
      label: "Scheduling execution",
      selection: "selected_production",
      rationale: "Weekly planning and calendar shaping are the second explicitly selected Phase 3 production wedge."
    },
    completionContract: {
      id: "scheduling-execution-v1",
      summary: "Turn calendar commitments into a reviewable weekly operating plan without silently mutating the calendar.",
      successCriteria: [
        "Current commitments and deadlines are consolidated into one planning view.",
        "A weekly operating plan is drafted with focus blocks, risk notes, and tradeoffs.",
        "Proposed scheduling changes remain reviewable instead of auto-committed."
      ],
      evidenceSignals: [
        "Calendar and commitment artifacts are captured for the planning bundle.",
        "A weekly planning draft artifact exists.",
        "Calendar write actions stay behind review or approval when required."
      ],
      approvalExpectations: [
        "Calendar changes that exceed the workspace auto-run policy require explicit review."
      ],
      doneWhen: "The system has produced a coherent weekly plan with visible risks and any write-side calendar changes remain explicitly reviewable."
    }
  },
  travel_readiness: {
    wedge: {
      key: "travel_readiness",
      label: "Travel readiness",
      selection: "supporting",
      rationale: "Travel preparation remains a supporting workflow, not one of the selected production wedges."
    },
    completionContract: {
      id: "travel-readiness-v1",
      summary: "Assemble a travel brief, checklist, and monitoring plan for upcoming itinerary work.",
      successCriteria: [
        "A trip brief captures itinerary assumptions and likely risks.",
        "A readiness checklist captures the open dependencies.",
        "Any scheduling changes remain reviewable before execution."
      ],
      evidenceSignals: [
        "Travel briefing artifact exists.",
        "Checklist artifact exists.",
        "Watcher coverage is attached for the travel workflow."
      ],
      approvalExpectations: [
        "Schedule-changing travel actions stay reviewable when they affect external commitments."
      ],
      doneWhen: "The trip has a usable brief, a checklist of missing dependencies, and monitoring for approaching deadlines or missing bookings."
    }
  },
  general_coordination: {
    wedge: {
      key: "general_coordination",
      label: "General coordination",
      selection: "supporting",
      rationale: "Broad coordination remains a fallback path outside the selected production wedges."
    },
    completionContract: {
      id: "general-coordination-v1",
      summary: "Turn an underspecified user request into a bounded, policy-aware workflow plan.",
      successCriteria: [
        "The request is decomposed into explicit tasks and constraints.",
        "Supporting context is resolved before any side effect is attempted.",
        "The next step is drafted safely when the request does not yet qualify for typed execution."
      ],
      evidenceSignals: [
        "Interpretation task exists.",
        "Supporting context resolution is logged.",
        "The next-step draft is visible in the resulting artifacts or tasks."
      ],
      approvalExpectations: [
        "Outward side effects are deferred until the request qualifies for the typed-action boundary."
      ],
      doneWhen: "The user has a safe, bounded workflow with clear next steps and no hidden side effects."
    }
  }
} as const satisfies Record<
  z.infer<typeof GoalWedgeKeySchema>,
  {
    wedge: z.input<typeof GoalWedgeSchema>;
    completionContract: z.input<typeof GoalCompletionContractSchema>;
  }
>;

function profileForGoalIntent(intent: string) {
  if (intent === "communications-triage") {
    return goalContractProfiles.communications_execution;
  }

  if (intent === "weekly-planning") {
    return goalContractProfiles.scheduling_execution;
  }

  if (intent === "travel-readiness") {
    return goalContractProfiles.travel_readiness;
  }

  return goalContractProfiles.general_coordination;
}

export function deriveGoalContract(intent: string) {
  const profile = profileForGoalIntent(intent);

  return {
    wedge: GoalWedgeSchema.parse(profile.wedge),
    completionContract: GoalCompletionContractSchema.parse(profile.completionContract)
  };
}

const GoalInputSchema = z.object({
  id: z.string().min(1),
  userId: z.string().min(1),
  workspaceId: z.string().min(1).nullable().default(null),
  workflowId: z.string().min(1),
  title: z.string().min(1),
  request: z.string().min(1),
  intent: z.string().min(1),
  status: GoalStatusSchema,
  confidence: z.number().min(0).max(1),
  explanation: z.string().min(1),
  wedge: GoalWedgeSchema.optional(),
  completionContract: GoalCompletionContractSchema.optional(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime()
});

export const GoalSchema = GoalInputSchema.transform((goal) => {
  const derived = deriveGoalContract(goal.intent);

  return {
    ...goal,
    wedge: goal.wedge ?? derived.wedge,
    completionContract: goal.completionContract ?? derived.completionContract
  };
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
  actorContext: z.lazy(() => ActorContextSchema).nullable().default(null),
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

export const ApprovalPreviewChangeSchema = z.object({
  label: z.string().min(1),
  before: z.string().min(1),
  after: z.string().min(1)
});

export const ApprovalImpactSchema = z.object({
  affectedPeople: z.array(z.string()).default([]),
  affectedSystems: z.array(z.string()).default([]),
  permissions: z.array(CapabilitySchema).default([]),
  rollback: z.enum(["supported", "manual", "not_supported"]).default("manual")
});

export const ApprovalPreviewSchema = z.object({
  actionType: ApprovalActionTypeSchema,
  summary: z.string().min(1),
  target: z.string().min(1),
  changes: z.array(ApprovalPreviewChangeSchema).default([]),
  impact: ApprovalImpactSchema.default({
    affectedPeople: [],
    affectedSystems: [],
    permissions: [],
    rollback: "manual"
  })
});

const ActionIntentEmailSchema = z.string().trim().email().max(320);

export const SendMessageActionIntentSchema = z
  .object({
    type: z.literal("send_message"),
    adapter: z.literal("gmail").default("gmail"),
    to: ActionIntentEmailSchema,
    subject: z.string().trim().min(1).max(240),
    body: z.string().min(1).max(20_000),
    threadId: z.string().trim().min(1).max(200).nullable().default(null),
    mode: z.enum(["draft", "send"]).default("draft")
  })
  .strict();

export const ScheduleEventActionIntentSchema = z
  .object({
    type: z.literal("schedule_event"),
    adapter: z.literal("calendar").default("calendar"),
    summary: z.string().trim().min(1).max(240),
    start: z.string().datetime(),
    end: z.string().datetime(),
    description: z.string().max(10_000).nullable().default(null),
    attendees: z.array(ActionIntentEmailSchema).max(50).default([])
  })
  .strict()
  .refine((value) => new Date(value.start).getTime() < new Date(value.end).getTime(), {
    message: "Schedule event intents require an end time after the start time.",
    path: ["end"]
  });

export const CreateNoteActionIntentSchema = z
  .object({
    type: z.literal("create_note"),
    adapter: z.literal("notes").default("notes"),
    title: z.string().trim().min(1).max(240),
    content: z.string().min(1).max(20_000)
  })
  .strict();

export const ManualReviewActionIntentSchema = z
  .object({
    type: z.literal("manual_review"),
    actionType: ApprovalActionTypeSchema,
    summary: z.string().min(1).max(500),
    reason: z.string().min(1).max(1_000),
    artifactIds: z.array(z.string().min(1)).max(20).default([])
  })
  .strict();

export const ActionIntentSchema = z.union([
  SendMessageActionIntentSchema,
  ScheduleEventActionIntentSchema,
  CreateNoteActionIntentSchema,
  ManualReviewActionIntentSchema
]);

export const ApprovalDecisionRecordSchema = z.object({
  decision: ApprovalDecisionSchema.exclude(["pending"]),
  scope: ApprovalDecisionScopeSchema,
  rationale: z.string().max(1000).nullable().default(null),
  actor: z.string().min(1),
  actorContext: z.lazy(() => ActorContextSchema).nullable().default(null),
  createdAt: z.string().datetime()
});

export const ApprovalExplanationEvidenceSchema = z.object({
  actionLogCount: z.number().int().min(0).default(0),
  artifactCount: z.number().int().min(0).default(0),
  memoryCount: z.number().int().min(0).default(0),
  updatedAt: z.string().datetime().nullable().default(null)
});

export const ApprovalExplanationSchema = z.object({
  requestReason: z.string().min(1).max(1000),
  impactSummary: z.string().min(1).max(1000),
  decisionSummary: z.string().min(1).max(1000).nullable().default(null),
  outcomeSummary: z.string().min(1).max(1000).nullable().default(null),
  evidenceSummary: z.string().min(1).max(1000).nullable().default(null),
  evidence: ApprovalExplanationEvidenceSchema.default({
    actionLogCount: 0,
    artifactCount: 0,
    memoryCount: 0,
    updatedAt: null
  })
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
  actionIntent: ActionIntentSchema.nullable().default(null),
  preview: ApprovalPreviewSchema.default({
    actionType: "artifact-only",
    summary: "Approval requested before execution.",
    target: "Pending action",
    changes: [],
    impact: {
      affectedPeople: [],
      affectedSystems: [],
      permissions: [],
      rollback: "manual"
    }
  }),
  decisionScope: ApprovalDecisionScopeSchema.nullable().default(null),
  decisionRationale: z.string().max(1000).nullable().default(null),
  history: z.array(ApprovalDecisionRecordSchema).default([]),
  explanation: ApprovalExplanationSchema.nullable().default(null),
  createdAt: z.string().datetime(),
  expiryAt: z.string().datetime(),
  respondedAt: z.string().datetime().nullable().default(null)
});

export const CommitmentEvidenceSchema = z.object({
  section: z.enum(["goals", "approvals"]),
  itemId: z.string().min(1),
  label: z.string().min(1)
});

export const CommitmentSuggestedActionSchema = z.object({
  kind: CommitmentSuggestedActionKindSchema,
  label: z.string().min(1).max(120),
  section: z.enum(["goals", "approvals"]),
  itemId: z.string().min(1)
});

export const CommitmentSchema = z.object({
  id: z.string().min(1),
  userId: z.string().min(1),
  title: z.string().min(1),
  summary: z.string().min(1),
  status: CommitmentStatusSchema,
  sourceKind: CommitmentSourceKindSchema,
  sourceId: z.string().min(1),
  goalId: z.string().min(1).nullable().default(null),
  approvalId: z.string().min(1).nullable().default(null),
  dueAt: z.string().datetime().nullable().default(null),
  actorContext: z.lazy(() => ActorContextSchema).nullable().default(null),
  urgency: CommitmentUrgencySchema.default("later"),
  riskClass: RiskClassSchema.nullable().default(null),
  confidence: z.number().min(0).max(1),
  provenanceSummary: z.string().min(1).max(280).default("Captured commitment."),
  suggestedNextAction: CommitmentSuggestedActionSchema.nullable().default(null),
  evidence: z.array(CommitmentEvidenceSchema).min(1),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime()
});

export const commitmentInboxBucketValues = [
  "all",
  "unresolved",
  "urgent",
  "due_soon",
  "waiting_on_others",
  "low_confidence",
  "completed"
] as const;

export const CommitmentInboxBucketSchema = z.enum(commitmentInboxBucketValues);

export const DEFAULT_COMMITMENT_INBOX_BUCKET = "unresolved" as const;
export const DEFAULT_COMMITMENT_INBOX_LIMIT = 8;
export const MAX_COMMITMENT_INBOX_LIMIT = 50;
export const DEFAULT_COLLECTION_PAGE_LIMIT = 20;
export const MAX_COLLECTION_PAGE_LIMIT = 100;

export const CommitmentInboxPageSchema = z.object({
  bucket: CommitmentInboxBucketSchema,
  items: z.array(CommitmentSchema),
  counts: z.record(CommitmentInboxBucketSchema, z.number().int().min(0)),
  totalCount: z.number().int().min(0),
  limit: z.number().int().min(1).max(MAX_COMMITMENT_INBOX_LIMIT),
  nextCursor: z.string().min(1).nullable(),
  generatedAt: z.string().datetime()
});

export const NowQueueItemSchema = z.object({
  commitmentId: z.string().min(1),
  title: z.string().min(1),
  summary: z.string().min(1),
  status: CommitmentStatusSchema,
  urgency: CommitmentUrgencySchema,
  riskClass: RiskClassSchema.nullable().default(null),
  confidence: z.number().min(0).max(1),
  dueAt: z.string().datetime().nullable().default(null),
  reasons: z.array(z.string().min(1)).default([]),
  suggestedNextAction: CommitmentSuggestedActionSchema.nullable().default(null)
});

export const NowQueueSchema = z.object({
  generatedAt: z.string().datetime(),
  totalCount: z.number().int().min(0),
  items: z.array(NowQueueItemSchema)
});

function buildCollectionPageSchema<TItem extends z.ZodTypeAny>(itemSchema: TItem) {
  return z.object({
    items: z.array(itemSchema),
    limit: z.number().int().min(1).max(MAX_COLLECTION_PAGE_LIMIT),
    nextCursor: z.string().min(1).nullable(),
    generatedAt: z.string().datetime()
  });
}

export const dashboardOperatingSectionKeyValues = ["now", "automation", "execution", "trust", "build"] as const;
export const dashboardOperatingSectionStatusValues = ["healthy", "attention", "critical", "idle"] as const;

export const DashboardOperatingSectionKeySchema = z.enum(dashboardOperatingSectionKeyValues);
export const DashboardOperatingSectionStatusSchema = z.enum(dashboardOperatingSectionStatusValues);

export const DashboardOperatingSectionSchema = z.object({
  key: DashboardOperatingSectionKeySchema,
  title: z.string().min(1),
  description: z.string().min(1),
  status: DashboardOperatingSectionStatusSchema,
  targetSection: z.string().min(1),
  targetItemId: z.string().min(1).optional(),
  metrics: z.array(z.string().min(1)).default([]),
  highlights: z.array(z.string().min(1)).default([])
});

export const DashboardOperatingSectionsSchema = z.object({
  generatedAt: z.string().datetime(),
  sections: z.array(DashboardOperatingSectionSchema).default([])
});

export const WorkspaceSchema = z.object({
  id: z.string().min(1),
  ownerUserId: z.string().min(1),
  slug: z.string().min(1).max(120).regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/),
  name: z.string().min(1).max(120),
  description: z.string().max(500).default(""),
  isPersonal: z.boolean().default(false),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime()
});

export const WorkspaceMemberSchema = z.object({
  id: z.string().min(1),
  workspaceId: z.string().min(1),
  userId: z.string().min(1),
  role: WorkspaceRoleSchema,
  joinedAt: z.string().datetime(),
  updatedAt: z.string().datetime()
});

export const WorkspaceSelectionSchema = z.object({
  userId: z.string().min(1),
  workspaceId: z.string().min(1),
  actorContext: z.lazy(() => ActorContextSchema).nullable().default(null),
  selectedAt: z.string().datetime(),
  updatedAt: z.string().datetime()
});

export const WorkspaceGovernanceSchema = z.object({
  workspaceId: z.string().min(1),
  approvalMode: WorkspaceApprovalModeSchema,
  requireAuditExports: z.boolean().default(false),
  maxAutoRunRiskClass: RiskClassSchema.default("R1"),
  externalSendRequiresApproval: z.boolean().default(true),
  calendarWriteRequiresApproval: z.boolean().default(true),
  retentionDays: z.number().int().min(7).max(3650).default(365),
  updatedBy: z.string().min(1),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime()
});

export const GoalShareRecordSchema = z.object({
  id: z.string().min(1),
  goalId: z.string().min(1),
  userId: z.string().min(1),
  workspaceId: z.string().min(1).nullable().default(null),
  tokenFingerprint: z.string().regex(/^[a-f0-9]{12,64}$/),
  status: GoalShareStatusSchema,
  actorContext: z.lazy(() => ActorContextSchema).nullable().default(null),
  expiresAt: z.string().datetime(),
  lastViewedAt: z.string().datetime().nullable().default(null),
  revokedAt: z.string().datetime().nullable().default(null),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime()
});

export const PrivacyOperationSchema = z.object({
  id: z.string().min(1),
  workspaceId: z.string().min(1),
  userId: z.string().min(1),
  kind: PrivacyOperationKindSchema,
  status: PrivacyOperationStatusSchema,
  requestedBy: z.string().min(1),
  actorContext: z.lazy(() => ActorContextSchema).nullable().default(null),
  jobId: z.string().min(1).nullable().default(null),
  details: z.record(z.string(), z.unknown()).default({}),
  result: z.record(z.string(), z.unknown()).default({}),
  startedAt: z.string().datetime().nullable().default(null),
  completedAt: z.string().datetime().nullable().default(null),
  error: z.string().max(1000).nullable().default(null),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime()
});

export const BriefingScheduleEntrySchema = z.object({
  type: BriefingTypeSchema,
  enabled: z.boolean(),
  time: TimeOfDaySchema
});

export const BriefingPreferencesSchema = z.object({
  userId: z.string().min(1),
  timezone: z.string().min(1),
  focus: BriefingFocusSchema,
  schedules: z.array(BriefingScheduleEntrySchema).length(briefingTypeValues.length),
  actorContext: z.lazy(() => ActorContextSchema).nullable().default(null),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime()
}).superRefine((value, context) => {
  const seen = new Set<string>();

  for (const schedule of value.schedules) {
    if (seen.has(schedule.type)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["schedules"],
        message: `Duplicate briefing schedule for "${schedule.type}".`
      });
    }

    seen.add(schedule.type);
  }

  for (const type of briefingTypeValues) {
    if (!seen.has(type)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["schedules"],
        message: `Missing briefing schedule for "${type}".`
      });
    }
  }
});

export const BriefingHistoryItemSchema = z.object({
  goalId: z.string().min(1),
  type: BriefingTypeSchema,
  title: z.string().min(1),
  status: GoalStatusSchema,
  summary: z.string().min(1),
  generatedAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
  artifactId: z.string().min(1).nullable().default(null),
  artifactTitle: z.string().min(1).nullable().default(null)
});

export const AutopilotSettingsSchema = z.object({
  userId: z.string().min(1),
  mode: AutopilotModeSchema,
  debounceMinutes: z.number().int().min(1).max(24 * 60),
  actorContext: z.lazy(() => ActorContextSchema).nullable().default(null),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime()
});

export const AutopilotEventSchema = z.object({
  id: z.string().min(1),
  userId: z.string().min(1),
  kind: AutopilotEventKindSchema,
  sourceId: z.string().min(1),
  idempotencyKey: z.string().min(1).max(200).nullable().default(null),
  mode: AutopilotModeSchema,
  summary: z.string().min(1).max(500),
  status: AutopilotEventStatusSchema,
  details: z.record(z.string(), z.unknown()).default({}),
  actorContext: z.lazy(() => ActorContextSchema).nullable().default(null),
  createdAt: z.string().datetime(),
  processedAt: z.string().datetime().nullable().default(null),
  resultGoalId: z.string().min(1).nullable().default(null),
  error: z.string().max(1000).nullable().default(null)
});

export const GoalCreateJobPayloadSchema = z
  .object({
    type: z.literal("goal_create"),
    goalId: z.string().min(1),
    workflowId: z.string().min(1),
    request: z.string().trim().min(1).max(20_000),
    workspaceId: z.string().min(1).nullable().default(null),
    agentId: z.string().min(1).nullable().default(null),
    metadata: z.record(z.string(), z.unknown()).default({})
  })
  .strict();

export const GoalRefineJobPayloadSchema = z
  .object({
    type: z.literal("goal_refine"),
    goalId: z.string().min(1),
    workflowId: z.string().min(1),
    refinement: z.string().trim().min(1).max(2_000),
    workspaceId: z.string().min(1).nullable().default(null),
    metadata: z.record(z.string(), z.unknown()).default({})
  })
  .strict();

export const BriefingCreateJobPayloadSchema = z
  .object({
    type: z.literal("briefing_create"),
    goalId: z.string().min(1),
    workflowId: z.string().min(1),
    briefingType: BriefingTypeSchema,
    workspaceId: z.string().min(1).nullable().default(null),
    metadata: z.record(z.string(), z.unknown()).default({})
  })
  .strict();

export const TemplateRunJobPayloadSchema = z
  .object({
    type: z.literal("template_run"),
    templateId: z.string().min(1),
    goalId: z.string().min(1),
    workflowId: z.string().min(1),
    workspaceId: z.string().min(1).nullable().default(null),
    metadata: z.record(z.string(), z.unknown()).default({})
  })
  .strict();

export const DocsRenderJobPayloadSchema = z
  .object({
    type: z.literal("docs_render"),
    metadata: z.record(z.string(), z.unknown()).default({})
  })
  .strict();

export const AutopilotProcessJobPayloadSchema = z
  .object({
    type: z.literal("autopilot_process"),
    autopilotEventId: z.string().min(1),
    kind: AutopilotEventKindSchema,
    sourceId: z.string().min(1),
    mode: AutopilotModeSchema,
    metadata: z.record(z.string(), z.unknown()).default({})
  })
  .strict();

export const PrivacyOperationJobPayloadSchema = z
  .object({
    type: z.literal("privacy_operation"),
    operationId: z.string().min(1),
    workspaceId: z.string().min(1),
    kind: PrivacyOperationKindSchema,
    metadata: z.record(z.string(), z.unknown()).default({})
  })
  .strict();

export const PublicShareViewJobPayloadSchema = z
  .object({
    type: z.literal("public_share_view"),
    shareId: z.string().min(1),
    goalId: z.string().min(1),
    tokenFingerprint: z.string().regex(/^[a-f0-9]{12}$/u),
    viewedAt: z.string().datetime(),
    metadata: z.record(z.string(), z.unknown()).default({})
  })
  .strict();

export const JobPayloadSchema = z.discriminatedUnion("type", [
  GoalCreateJobPayloadSchema,
  GoalRefineJobPayloadSchema,
  BriefingCreateJobPayloadSchema,
  TemplateRunJobPayloadSchema,
  DocsRenderJobPayloadSchema,
  AutopilotProcessJobPayloadSchema,
  PrivacyOperationJobPayloadSchema,
  PublicShareViewJobPayloadSchema
]);

export const JobRecordSchema = z
  .object({
    id: z.string().min(1),
    userId: z.string().min(1),
    kind: JobKindSchema,
    status: JobStatusSchema,
    idempotencyKey: z.string().min(1).max(200).nullable().default(null),
    payload: JobPayloadSchema,
    actorContext: z.lazy(() => ActorContextSchema).nullable().default(null),
    maxAttempts: z.number().int().min(1).max(25),
    attemptCount: z.number().int().min(0).max(25),
    claimedBy: z.string().min(1).max(120).nullable().default(null),
    lastAttemptAt: z.string().datetime().nullable().default(null),
    claimedAt: z.string().datetime().nullable().default(null),
    leaseExpiresAt: z.string().datetime().nullable().default(null),
    availableAt: z.string().datetime(),
    completedAt: z.string().datetime().nullable().default(null),
    deadLetteredAt: z.string().datetime().nullable().default(null),
    lastError: z.string().max(1000).nullable().default(null),
    createdAt: z.string().datetime(),
    updatedAt: z.string().datetime()
  })
  .superRefine((value, context) => {
    if (value.kind === "goal_create" && value.payload.type !== "goal_create") {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["payload", "type"],
        message: 'Goal-create jobs must carry a "goal_create" payload.'
      });
    }

    if (value.kind === "goal_refine" && value.payload.type !== "goal_refine") {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["payload", "type"],
        message: 'Goal-refine jobs must carry a "goal_refine" payload.'
      });
    }

    if (value.kind === "briefing_create" && value.payload.type !== "briefing_create") {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["payload", "type"],
        message: 'Briefing-create jobs must carry a "briefing_create" payload.'
      });
    }

    if (value.kind === "template_run" && value.payload.type !== "template_run") {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["payload", "type"],
        message: 'Template-run jobs must carry a "template_run" payload.'
      });
    }

    if (value.kind === "docs_render" && value.payload.type !== "docs_render") {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["payload", "type"],
        message: 'Docs-render jobs must carry a "docs_render" payload.'
      });
    }

    if (value.kind === "autopilot_process" && value.payload.type !== "autopilot_process") {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["payload", "type"],
        message: 'Autopilot jobs must carry an "autopilot_process" payload.'
      });
    }

    if (value.kind === "privacy_operation" && value.payload.type !== "privacy_operation") {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["payload", "type"],
        message: 'Privacy-operation jobs must carry a "privacy_operation" payload.'
      });
    }

    if (value.kind === "public_share_view" && value.payload.type !== "public_share_view") {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["payload", "type"],
        message: 'Public-share-view jobs must carry a "public_share_view" payload.'
      });
    }

    if (value.status === "running") {
      if (!value.claimedBy) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["claimedBy"],
          message: "Running jobs must record the claiming worker."
        });
      }

      if (!value.claimedAt) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["claimedAt"],
          message: "Running jobs must record when the lease started."
        });
      }

      if (!value.leaseExpiresAt) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["leaseExpiresAt"],
          message: "Running jobs must record a lease expiry."
        });
      }
    }

    if (value.status === "completed" && !value.completedAt) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["completedAt"],
        message: "Completed jobs must record when they finished."
      });
    }

    if (value.status === "dead_letter" && !value.deadLetteredAt) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["deadLetteredAt"],
        message: "Dead-lettered jobs must record when they were abandoned."
      });
    }
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
  actorContext: z.lazy(() => ActorContextSchema).nullable().default(null),
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

export const ActorIdentitySchema = z.object({
  kind: ActorKindSchema,
  userId: z.string().min(1).nullable().default(null),
  label: z.string().min(1).max(120)
});

export const ActorContextSchema = z.object({
  subjectUserId: z.string().min(1),
  initiator: ActorIdentitySchema,
  executor: ActorIdentitySchema,
  sessionId: z.string().min(1).nullable().default(null)
});

export const EvidenceRecordSchema = z.object({
  id: z.string().min(1),
  userId: z.string().min(1),
  goalId: z.string().min(1),
  taskId: z.string().min(1),
  approvalId: z.string().min(1),
  sourceKind: EvidenceRecordSourceKindSchema,
  sourceId: z.string().min(1),
  sourceSummary: z.string().min(1).max(280),
  riskClass: RiskClassSchema,
  requestedAction: z.string().min(1),
  requestRationale: z.string().min(1),
  requiresApproval: z.literal(true),
  decision: ApprovalDecisionSchema.exclude(["pending"]),
  decisionScope: ApprovalDecisionScopeSchema,
  decisionRationale: z.string().max(1000).nullable().default(null),
  respondedAt: z.string().datetime(),
  resultingTaskState: TaskStateSchema,
  resultingGoalStatus: GoalStatusSchema,
  actionLogIds: z.array(z.string().min(1)).default([]),
  artifactIds: z.array(z.string().min(1)).default([]),
  memoryIds: z.array(z.string().min(1)).default([]),
  actorContext: ActorContextSchema.nullable().default(null),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime()
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
  actorContext: z.lazy(() => ActorContextSchema).nullable().default(null),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime()
});

export const EncryptedSecretEnvelopeSchema = z.object({
  algorithm: z.literal("aes-256-gcm"),
  keyVersion: z.string().min(1).max(100),
  kdf: z.literal("scrypt"),
  ciphertext: z.string().min(1),
  iv: z.string().min(1),
  authTag: z.string().min(1)
});

export const ProviderCredentialSchema = z.object({
  id: z.string().min(1),
  userId: z.string().min(1),
  workspaceId: z.string().min(1).nullable().default(null),
  provider: ProviderSchema,
  accountId: z.string().min(1).max(200).nullable().default(null),
  accountEmail: z.string().trim().email().max(320).nullable().default(null),
  displayName: z.string().max(200).default(""),
  status: ProviderCredentialStatusSchema,
  scopes: z.array(z.string().min(1)).default([]),
  lastValidatedAt: z.string().datetime().nullable().default(null),
  lastRotatedAt: z.string().datetime().nullable().default(null),
  lastRefreshAt: z.string().datetime().nullable().default(null),
  lastRefreshFailureAt: z.string().datetime().nullable().default(null),
  reconnectRequiredAt: z.string().datetime().nullable().default(null),
  revokedAt: z.string().datetime().nullable().default(null),
  expiresAt: z.string().datetime().nullable().default(null),
  metadata: z.record(z.string(), z.unknown()).default({}),
  actorContext: z.lazy(() => ActorContextSchema).nullable().default(null),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime()
});

export const ProviderCredentialSecretRecordSchema = z.object({
  credentialId: z.string().min(1),
  userId: z.string().min(1),
  kind: ProviderCredentialSecretKindSchema,
  secret: EncryptedSecretEnvelopeSchema,
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

export const GoalBundlePageSchema = buildCollectionPageSchema(GoalBundleSchema);
export const AutopilotEventPageSchema = buildCollectionPageSchema(AutopilotEventSchema);
export const MemoryRecordPageSchema = buildCollectionPageSchema(MemoryRecordSchema);
export const WatcherPageSchema = buildCollectionPageSchema(WatcherSchema);
export const IntegrationAccountPageSchema = buildCollectionPageSchema(IntegrationAccountSchema);

export const GoalTemplateSchema = z.object({
  id: z.string().min(1),
  userId: z.string().min(1),
  name: z.string().min(1).max(200),
  description: z.string().max(500).default(""),
  request: z.string().min(1).max(2_000),
  parameters: z.record(z.string(), z.string()).default({}),
  actorContext: z.lazy(() => ActorContextSchema).nullable().default(null),
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

export const WorkflowCanvasNodeSchema = z.object({
  id: z.string().min(1).max(200),
  type: z.enum(["agent", "trigger", "condition", "action", "output"]),
  agentId: z.string().min(1).max(200).optional(),
  label: z.string().min(1).max(200),
  icon: z.string().min(1).max(50),
  position: z.object({
    x: z.number().finite(),
    y: z.number().finite()
  }),
  config: z.record(z.string().min(1).max(100), z.unknown()).default({})
});

export const WorkflowCanvasEdgeSchema = z.object({
  id: z.string().min(1).max(200),
  source: z.string().min(1).max(200),
  target: z.string().min(1).max(200),
  label: z.string().max(200).optional(),
  condition: z.string().max(500).optional()
});

export const WorkflowCanvasTriggerSchema = z.object({
  type: z.string().min(1).max(100),
  config: z.record(z.string().min(1).max(100), z.unknown()).default({})
});

export const WorkflowCanvasTemplateSchema = z.object({
  id: z.string().min(1),
  userId: z.string().min(1),
  name: z.string().min(1).max(100),
  description: z.string().max(500).default(""),
  nodes: z.array(WorkflowCanvasNodeSchema).max(100).default([]),
  edges: z.array(WorkflowCanvasEdgeSchema).max(200).default([]),
  triggers: z.array(WorkflowCanvasTriggerSchema).max(50).default([]),
  actorContext: z.lazy(() => ActorContextSchema).nullable().default(null),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime()
});

export const WorkflowCanvasTemplateCreateSchema = WorkflowCanvasTemplateSchema.omit({
  id: true,
  userId: true,
  actorContext: true,
  createdAt: true,
  updatedAt: true
}).strict();

export const WorkflowCanvasTemplateUpdateSchema = WorkflowCanvasTemplateCreateSchema.partial().strict();

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
  actorContext: z.lazy(() => ActorContextSchema).nullable().default(null),

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
  userCorrectionCount: z.number().int().min(0).default(0),
  postApprovalFailureCount: z.number().int().min(0).default(0),
  averageRating: z.number().min(0).max(10).nullable().default(null),

  // Computed at aggregation
  successRate: z.number().min(0).max(1).default(0),
  approvalRate: z.number().min(0).max(1).default(0),
  correctionRate: z.number().min(0).max(1).default(0),
  postApprovalFailureRate: z.number().min(0).max(1).default(0),

  updatedAt: z.string().datetime()
});

export const OperatorProductKpiSchema = z.object({
  id: z.string().min(1).max(100),
  label: z.string().min(1).max(120),
  description: z.string().max(300).default(""),
  metric: z.string().min(1).max(120)
});

export const OperatorProductOnboardingStepSchema = z.object({
  id: z.string().min(1).max(100),
  title: z.string().min(1).max(120),
  description: z.string().max(300).default(""),
  actionLabel: z.string().min(1).max(80).nullable().default(null)
});

export const OperatorProductIntegrationRequirementSchema = z.object({
  system: z.string().min(1).max(100),
  label: z.string().min(1).max(120),
  readiness: OperatorProductReadinessSchema,
  description: z.string().max(300).default("")
});

export const OperatorProductSchema = z.object({
  id: z.string().min(1),
  userId: z.string().min(1),
  slug: z.string().min(1).max(100).regex(/^[a-z][a-z0-9-]*$/),
  name: z.string().min(1).max(120),
  tagline: z.string().min(1).max(200),
  description: z.string().min(1).max(1000),
  icon: z.string().max(50).default("📦"),
  recommendedAgentIds: z.array(z.string().min(1)).max(20).default([]),
  recommendedTemplateIds: z.array(z.string().min(1)).max(20).default([]),
  recommendedIntegrations: z.array(OperatorProductIntegrationRequirementSchema).max(20).default([]),
  kpis: z.array(OperatorProductKpiSchema).max(10).default([]),
  onboardingSteps: z.array(OperatorProductOnboardingStepSchema).max(10).default([]),
  isBuiltIn: z.boolean().default(false),
  status: OperatorProductStatusSchema.default("active"),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime()
});

export const OperatorProductSelectionSchema = z.object({
  userId: z.string().min(1),
  operatorProductId: z.string().min(1),
  actorContext: z.lazy(() => ActorContextSchema).nullable().default(null),
  selectedAt: z.string().datetime(),
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
  agent: AgentDefinitionSchema.omit({
    userId: true,
    isBuiltIn: true,
    createdAt: true,
    updatedAt: true,
    actorContext: true
  }),
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
export type ApprovalActionType = z.infer<typeof ApprovalActionTypeSchema>;
export type ApprovalDecisionScope = z.infer<typeof ApprovalDecisionScopeSchema>;
export type ArtifactType = z.infer<typeof ArtifactTypeSchema>;
export type AgentExecutionMode = z.infer<typeof AgentExecutionModeSchema>;
export type CommitmentStatus = z.infer<typeof CommitmentStatusSchema>;
export type CommitmentSourceKind = z.infer<typeof CommitmentSourceKindSchema>;
export type CommitmentUrgency = z.infer<typeof CommitmentUrgencySchema>;
export type BriefingType = z.infer<typeof BriefingTypeSchema>;
export type BriefingFocus = z.infer<typeof BriefingFocusSchema>;
export type AutopilotMode = z.infer<typeof AutopilotModeSchema>;
export type AutopilotEventKind = z.infer<typeof AutopilotEventKindSchema>;
export type AutopilotEventStatus = z.infer<typeof AutopilotEventStatusSchema>;
export type JobKind = z.infer<typeof JobKindSchema>;
export type JobStatus = z.infer<typeof JobStatusSchema>;
export type EvidenceRecordSourceKind = z.infer<typeof EvidenceRecordSourceKindSchema>;
export type WorkspaceRole = z.infer<typeof WorkspaceRoleSchema>;
export type WorkspaceApprovalMode = z.infer<typeof WorkspaceApprovalModeSchema>;
export type AgentName = z.infer<typeof AgentNameSchema>;
export type ToolInvocation = z.infer<typeof ToolInvocationSchema>;
export type Artifact = z.infer<typeof ArtifactSchema>;
export type AgentResult = z.infer<typeof AgentResultSchema>;
export type WorkflowState = z.infer<typeof WorkflowStateSchema>;
export type Goal = z.infer<typeof GoalSchema>;
export type Task = z.infer<typeof TaskSchema>;
export type MemoryRecord = z.infer<typeof MemoryRecordSchema>;
export type PolicyDecision = z.infer<typeof PolicyDecisionSchema>;
export type ApprovalPreviewChange = z.infer<typeof ApprovalPreviewChangeSchema>;
export type ApprovalImpact = z.infer<typeof ApprovalImpactSchema>;
export type ApprovalPreview = z.infer<typeof ApprovalPreviewSchema>;
export type SendMessageActionIntent = z.infer<typeof SendMessageActionIntentSchema>;
export type ScheduleEventActionIntent = z.infer<typeof ScheduleEventActionIntentSchema>;
export type CreateNoteActionIntent = z.infer<typeof CreateNoteActionIntentSchema>;
export type ManualReviewActionIntent = z.infer<typeof ManualReviewActionIntentSchema>;
export type ActionIntent = z.infer<typeof ActionIntentSchema>;
export type ApprovalDecisionRecord = z.infer<typeof ApprovalDecisionRecordSchema>;
export type ApprovalExplanationEvidence = z.infer<typeof ApprovalExplanationEvidenceSchema>;
export type ApprovalExplanation = z.infer<typeof ApprovalExplanationSchema>;
export type ApprovalRequest = z.infer<typeof ApprovalRequestSchema>;
export type CommitmentEvidence = z.infer<typeof CommitmentEvidenceSchema>;
export type CommitmentSuggestedAction = z.infer<typeof CommitmentSuggestedActionSchema>;
export type Commitment = z.infer<typeof CommitmentSchema>;
export type CommitmentInboxBucket = z.infer<typeof CommitmentInboxBucketSchema>;
export type CommitmentInboxPage = z.infer<typeof CommitmentInboxPageSchema>;
export type GoalBundlePage = z.infer<typeof GoalBundlePageSchema>;
export type AutopilotEventPage = z.infer<typeof AutopilotEventPageSchema>;
export type MemoryRecordPage = z.infer<typeof MemoryRecordPageSchema>;
export type WatcherPage = z.infer<typeof WatcherPageSchema>;
export type IntegrationAccountPage = z.infer<typeof IntegrationAccountPageSchema>;
export type NowQueueItem = z.infer<typeof NowQueueItemSchema>;
export type NowQueue = z.infer<typeof NowQueueSchema>;
export type DashboardOperatingSectionKey = z.infer<typeof DashboardOperatingSectionKeySchema>;
export type DashboardOperatingSectionStatus = z.infer<typeof DashboardOperatingSectionStatusSchema>;
export type DashboardOperatingSection = z.infer<typeof DashboardOperatingSectionSchema>;
export type DashboardOperatingSections = z.infer<typeof DashboardOperatingSectionsSchema>;
export type Workspace = z.infer<typeof WorkspaceSchema>;
export type WorkspaceMember = z.infer<typeof WorkspaceMemberSchema>;
export type WorkspaceSelection = z.infer<typeof WorkspaceSelectionSchema>;
export type WorkspaceGovernance = z.infer<typeof WorkspaceGovernanceSchema>;
export type GoalShareStatus = z.infer<typeof GoalShareStatusSchema>;
export type GoalShareRecord = z.infer<typeof GoalShareRecordSchema>;
export type PrivacyOperationKind = z.infer<typeof PrivacyOperationKindSchema>;
export type PrivacyOperationStatus = z.infer<typeof PrivacyOperationStatusSchema>;
export type PrivacyOperation = z.infer<typeof PrivacyOperationSchema>;
export type ActorKind = z.infer<typeof ActorKindSchema>;
export type ActorIdentity = z.infer<typeof ActorIdentitySchema>;
export type ActorContext = z.infer<typeof ActorContextSchema>;
export type BriefingScheduleEntry = z.infer<typeof BriefingScheduleEntrySchema>;
export type BriefingPreferences = z.infer<typeof BriefingPreferencesSchema>;
export type BriefingHistoryItem = z.infer<typeof BriefingHistoryItemSchema>;
export type AutopilotSettings = z.infer<typeof AutopilotSettingsSchema>;
export type AutopilotEvent = z.infer<typeof AutopilotEventSchema>;
export type GoalCreateJobPayload = z.infer<typeof GoalCreateJobPayloadSchema>;
export type GoalRefineJobPayload = z.infer<typeof GoalRefineJobPayloadSchema>;
export type BriefingCreateJobPayload = z.infer<typeof BriefingCreateJobPayloadSchema>;
export type TemplateRunJobPayload = z.infer<typeof TemplateRunJobPayloadSchema>;
export type DocsRenderJobPayload = z.infer<typeof DocsRenderJobPayloadSchema>;
export type AutopilotProcessJobPayload = z.infer<typeof AutopilotProcessJobPayloadSchema>;
export type PrivacyOperationJobPayload = z.infer<typeof PrivacyOperationJobPayloadSchema>;
export type PublicShareViewJobPayload = z.infer<typeof PublicShareViewJobPayloadSchema>;
export type JobPayload = z.infer<typeof JobPayloadSchema>;
export type JobRecord = z.infer<typeof JobRecordSchema>;
export type WatcherFrequency = z.infer<typeof WatcherFrequencySchema>;
export type Watcher = z.infer<typeof WatcherSchema>;
export type ActionLog = z.infer<typeof ActionLogSchema>;
export type EvidenceRecord = z.infer<typeof EvidenceRecordSchema>;
export type IntegrationAccount = z.infer<typeof IntegrationAccountSchema>;
export type EncryptedSecretEnvelope = z.infer<typeof EncryptedSecretEnvelopeSchema>;
export type Provider = z.infer<typeof ProviderSchema>;
export type ProviderCredentialStatus = z.infer<typeof ProviderCredentialStatusSchema>;
export type ProviderCredentialSecretKind = z.infer<typeof ProviderCredentialSecretKindSchema>;
export type ProviderCredential = z.infer<typeof ProviderCredentialSchema>;
export type ProviderCredentialSecretRecord = z.infer<typeof ProviderCredentialSecretRecordSchema>;
export type GoalBundle = z.infer<typeof GoalBundleSchema>;
export type GoalTemplate = z.infer<typeof GoalTemplateSchema>;
export type WorkflowCanvasNode = z.infer<typeof WorkflowCanvasNodeSchema>;
export type WorkflowCanvasEdge = z.infer<typeof WorkflowCanvasEdgeSchema>;
export type WorkflowCanvasTrigger = z.infer<typeof WorkflowCanvasTriggerSchema>;
export type WorkflowCanvasTemplate = z.infer<typeof WorkflowCanvasTemplateSchema>;

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
export type OperatorProductStatus = z.infer<typeof OperatorProductStatusSchema>;
export type OperatorProductReadiness = z.infer<typeof OperatorProductReadinessSchema>;
export type OperatorProductKpi = z.infer<typeof OperatorProductKpiSchema>;
export type OperatorProductOnboardingStep = z.infer<typeof OperatorProductOnboardingStepSchema>;
export type OperatorProductIntegrationRequirement = z.infer<typeof OperatorProductIntegrationRequirementSchema>;
export type OperatorProduct = z.infer<typeof OperatorProductSchema>;
export type OperatorProductSelection = z.infer<typeof OperatorProductSelectionSchema>;
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

export function buildHumanActorIdentity(userId: string, label = userId): ActorIdentity {
  return ActorIdentitySchema.parse({
    kind: "human",
    userId,
    label
  });
}

export function buildSystemActorIdentity(options?: {
  userId?: string | null;
  label?: string;
}): ActorIdentity {
  return ActorIdentitySchema.parse({
    kind: "system",
    userId: options?.userId ?? SYSTEM_USER_ID,
    label: options?.label ?? "system"
  });
}

export function createActorContext(params: {
  subjectUserId: string;
  initiator: ActorIdentity;
  executor?: ActorIdentity;
  sessionId?: string | null;
}): ActorContext {
  return ActorContextSchema.parse({
    subjectUserId: params.subjectUserId,
    initiator: params.initiator,
    executor: params.executor ?? params.initiator,
    sessionId: params.sessionId ?? null
  });
}

export function createHumanActorContext(subjectUserId: string, sessionId: string | null = null): ActorContext {
  const actor = buildHumanActorIdentity(subjectUserId);

  return createActorContext({
    subjectUserId,
    initiator: actor,
    executor: actor,
    sessionId
  });
}

export function createSystemActorContext(subjectUserId = SYSTEM_USER_ID, sessionId: string | null = null): ActorContext {
  const actor = buildSystemActorIdentity({
    userId: subjectUserId
  });

  return createActorContext({
    subjectUserId,
    initiator: actor,
    executor: actor,
    sessionId
  });
}

export function withSystemExecutor(
  actorContext: ActorContext,
  options?: {
    userId?: string | null;
    label?: string;
  }
): ActorContext {
  return createActorContext({
    subjectUserId: actorContext.subjectUserId,
    initiator: actorContext.initiator,
    executor: buildSystemActorIdentity({
      userId: options?.userId,
      label: options?.label
    }),
    sessionId: actorContext.sessionId
  });
}

export function actorIdentityLabel(actor: ActorIdentity): string {
  return actor.userId ?? actor.label;
}

export function nowIso(): string {
  return new Date().toISOString();
}

export function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}
