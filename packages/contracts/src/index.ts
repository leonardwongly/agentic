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
  "general_coordination",
  "briefing"
] as const;
export const goalWedgeSelectionValues = ["selected_production", "supporting"] as const;
export const memoryTypeValues = ["observed", "inferred", "confirmed"] as const;
export const agentMemoryScopeValues = ["global", "agent-only", "agent-preferred"] as const;
export const approvalDecisionValues = ["pending", "approved", "rejected"] as const;
export const approvalActionTypeValues = ["send", "schedule", "create", "update", "delete", "draft", "artifact-only"] as const;
export const approvalDecisionScopeValues = ["once", "similar_24h", "always_review"] as const;
export const artifactTypeValues = ["summary", "brief", "checklist", "draft", "explanation"] as const;
export const agentExecutionModeValues = [
  "governed_specialist",
  "deterministic_scaffold",
  "custom_prompt_scaffold",
  "manual_review_required"
] as const;
export const agentImplementationTierValues = ["production", "experimental"] as const;
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
export const autopilotEventKindValues = [
  "watcher_triggered",
  "template_due",
  "briefing_due",
  "communication_received",
  "inbound_communication_received",
  "deadline_drift_detected",
  "approval_sla_breached",
  "approval_attention_required",
  "connector_failed",
  "execution_failure_detected",
  "workflow_stalled",
  "dormant_workflow_review_due"
] as const;
export const autopilotEventSeverityValues = ["low", "medium", "high", "critical"] as const;
export const autopilotEventPolicyValues = [
  "notify_operator",
  "draft_goal",
  "queue_operator_review",
  "queue_approval_review",
  "escalate_immediately"
] as const;
export const autopilotEventOperatorRouteValues = [
  "operations",
  "communications",
  "approvals",
  "workflow",
  "platform"
] as const;
export const autopilotEventStatusValues = ["pending", "simulated", "notified", "executed", "debounced", "ignored", "failed"] as const;
export const autopilotEventFamilyValues = [
  "watcher",
  "template",
  "briefing",
  "communication",
  "deadline",
  "approval",
  "connector",
  "workflow"
] as const;
export const autopilotEventPriorityValues = ["low", "medium", "high", "critical"] as const;
export const autopilotEventBudgetScopeValues = ["user", "source"] as const;
export const autopilotEventSuppressionOutcomeValues = [
  "allowed",
  "duplicate",
  "debounced",
  "budget_exhausted",
  "suppressed"
] as const;
export const goalShareStatusValues = ["active", "revoked"] as const;
export const privacyOperationKindValues = ["retention_enforcement", "workspace_export", "workspace_delete"] as const;
export const privacyOperationStatusValues = ["queued", "running", "completed", "failed"] as const;
export const jobKindValues = [
  "goal_create",
  "goal_refine",
  "briefing_create",
  "template_run",
  "docs_render",
  "autopilot_process",
  "github_issue_intake",
  "approval_follow_up",
  "approval_notification",
  "privacy_operation",
  "public_share_view"
] as const;
export const jobStatusValues = ["queued", "running", "retrying", "completed", "dead_letter"] as const;
export const jobPriorityValues = ["critical", "high", "normal", "low", "maintenance"] as const;
export const githubIssueAutomationModeValues = ["intake", "plan", "work"] as const;
export const githubIssueTriggerEventValues = ["issues", "issue_comment"] as const;
export const githubIssueTriggerActionValues = ["opened", "reopened", "labeled", "created", "sync"] as const;
export const evidenceRecordSourceKindValues = ["approval_response"] as const;
export const workspaceRoleValues = ["owner", "editor", "viewer"] as const;
export const workspaceApprovalModeValues = ["always_review", "risk_based"] as const;
export const actorKindValues = ["human", "system"] as const;
export const workflowResponsibilityAssigneeKindValues = ["user", "workspace_role", "system_actor"] as const;
export const workflowResponsibilityStatusValues = [
  "owner_control",
  "delegated",
  "review_pending",
  "escalated",
  "returned_to_owner"
] as const;
export const workflowResponsibilityAuditEventValues = [
  "delegation_change",
  "handoff_acceptance",
  "review_assignment",
  "escalation_trigger"
] as const;
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
export const learningPromotionModeValues = ["disabled", "shadow_only", "validated_autonomy"] as const;
export const learningRollbackOutcomeValues = ["allowed_with_confirmation", "downgrade_to_draft"] as const;
export const workflowDagStatusValues = ["queued", "running", "paused", "completed", "failed", "cancelled"] as const;
export const workflowDagNodeStatusValues = ["queued", "running", "paused", "completed", "failed", "skipped", "cancelled"] as const;

export const CapabilitySchema = z.enum(capabilityValues);
export const RiskClassSchema = z.enum(riskClassValues);
export const TaskStateSchema = z.enum(taskStateValues);
export const GoalStatusSchema = z.enum(goalStatusValues);
export const GoalWedgeKeySchema = z.enum(goalWedgeKeyValues);
export const GoalWedgeSelectionSchema = z.enum(goalWedgeSelectionValues);
export const MemoryTypeSchema = z.enum(memoryTypeValues);
export const AgentMemoryScopeSchema = z.enum(agentMemoryScopeValues);
export const ApprovalDecisionSchema = z.enum(approvalDecisionValues);
export const ApprovalActionTypeSchema = z.enum(approvalActionTypeValues);
export const ApprovalDecisionScopeSchema = z.enum(approvalDecisionScopeValues);
export const ArtifactTypeSchema = z.enum(artifactTypeValues);
export const AgentExecutionModeSchema = z.enum(agentExecutionModeValues);
export const AgentImplementationTierSchema = z.enum(agentImplementationTierValues);
export const CommitmentStatusSchema = z.enum(commitmentStatusValues);
export const CommitmentSourceKindSchema = z.enum(commitmentSourceKindValues);
export const CommitmentUrgencySchema = z.enum(commitmentUrgencyValues);
export const CommitmentSuggestedActionKindSchema = z.enum(commitmentSuggestedActionKindValues);
export const BriefingTypeSchema = z.enum(briefingTypeValues);
export const BriefingFocusSchema = z.enum(briefingFocusValues);
export const AutopilotModeSchema = z.enum(autopilotModeValues);
export const AutopilotEventKindSchema = z.enum(autopilotEventKindValues);
export const AutopilotEventSeveritySchema = z.enum(autopilotEventSeverityValues);
export const AutopilotEventPolicySchema = z.enum(autopilotEventPolicyValues);
export const AutopilotEventOperatorRouteSchema = z.enum(autopilotEventOperatorRouteValues);
export const AutopilotEventStatusSchema = z.enum(autopilotEventStatusValues);
export const AutopilotEventFamilySchema = z.enum(autopilotEventFamilyValues);
export const AutopilotEventPrioritySchema = z.enum(autopilotEventPriorityValues);
export const AutopilotEventBudgetScopeSchema = z.enum(autopilotEventBudgetScopeValues);
export const AutopilotEventSuppressionOutcomeSchema = z.enum(autopilotEventSuppressionOutcomeValues);
export const GoalShareStatusSchema = z.enum(goalShareStatusValues);
export const PrivacyOperationKindSchema = z.enum(privacyOperationKindValues);
export const PrivacyOperationStatusSchema = z.enum(privacyOperationStatusValues);
export const JobKindSchema = z.enum(jobKindValues);
export const JobStatusSchema = z.enum(jobStatusValues);
export const JobPrioritySchema = z.enum(jobPriorityValues);
export const GitHubIssueAutomationModeSchema = z.enum(githubIssueAutomationModeValues);
export const GitHubIssueTriggerEventSchema = z.enum(githubIssueTriggerEventValues);
export const GitHubIssueTriggerActionSchema = z.enum(githubIssueTriggerActionValues);
export const EvidenceRecordSourceKindSchema = z.enum(evidenceRecordSourceKindValues);
export const WorkspaceRoleSchema = z.enum(workspaceRoleValues);
export const WorkspaceApprovalModeSchema = z.enum(workspaceApprovalModeValues);
export const ActorKindSchema = z.enum(actorKindValues);
export const WorkflowResponsibilityAssigneeKindSchema = z.enum(workflowResponsibilityAssigneeKindValues);
export const WorkflowResponsibilityStatusSchema = z.enum(workflowResponsibilityStatusValues);
export const WorkflowResponsibilityAuditEventSchema = z.enum(workflowResponsibilityAuditEventValues);
export const ProviderSchema = z.enum(providerValues);
export const ProviderCredentialStatusSchema = z.enum(providerCredentialStatusValues);
export const ProviderCredentialSecretKindSchema = z.enum(providerCredentialSecretKindValues);
export const AgentNameSchema = z.enum(agentNameValues);
export const OperatorProductStatusSchema = z.enum(operatorProductStatusValues);
export const OperatorProductReadinessSchema = z.enum(operatorProductReadinessValues);
export const LearningPromotionModeSchema = z.enum(learningPromotionModeValues);
export const LearningRollbackOutcomeSchema = z.enum(learningRollbackOutcomeValues);
export const WorkflowDagStatusSchema = z.enum(workflowDagStatusValues);
export const WorkflowDagNodeStatusSchema = z.enum(workflowDagNodeStatusValues);

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
  implementationTier: AgentImplementationTierSchema,
  artifacts: z.array(ArtifactSchema).default([]),
  proposedToolCalls: z.array(ToolInvocationSchema).default([]),
  nextSteps: z.array(z.string()).default([]),
  explanation: z.string().min(1)
});

export const SubAgentCoordinationStrategySchema = z.enum(["parallel", "sequential", "hybrid"]);

export const SubAgentRoleSchema = z.object({
  id: z.string().min(1).max(80),
  name: z.string().min(1).max(120),
  agent: AgentNameSchema,
  role: z.string().min(1).max(160),
  responsibilities: z.array(z.string().min(1).max(300)).min(1).max(8),
  allowedCapabilities: z.array(CapabilitySchema).default([]),
  inputContracts: z.array(z.string().min(1).max(300)).default([]),
  expectedOutputs: z.array(z.string().min(1).max(300)).min(1).max(8),
  dependsOn: z.array(z.string().min(1).max(80)).default([]),
  riskClass: RiskClassSchema,
  handoffCriteria: z.array(z.string().min(1).max(300)).min(1).max(8),
  guardrails: z.array(z.string().min(1).max(300)).min(1).max(8)
});

export const SubAgentPlanSchema = z.object({
  id: z.string().min(1).max(120),
  goalId: z.string().min(1),
  anchorTaskId: z.string().min(1).nullable().default(null),
  parentAgent: AgentNameSchema,
  coordinationStrategy: SubAgentCoordinationStrategySchema,
  roles: z.array(SubAgentRoleSchema).min(1).max(8),
  successCriteria: z.array(z.string().min(1).max(300)).min(1).max(8),
  createdAt: z.string().datetime()
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
  },
  briefing: {
    wedge: {
      key: "briefing",
      label: "Briefing generation",
      selection: "supporting",
      rationale: "Briefings are an operator-support surface, not a selected production wedge."
    },
    completionContract: {
      id: "briefing-v1",
      summary: "Generate a briefing artifact that reflects current priorities, context, and open decisions.",
      successCriteria: [
        "The briefing reflects the requested briefing type and focus.",
        "Open approvals, watchers, and context are summarized into the generated output.",
        "The briefing is saved as a reusable artifact."
      ],
      evidenceSignals: [
        "Briefing artifact exists.",
        "The goal explanation reflects the requested focus and available context.",
        "Briefing tasks complete without unapproved external side effects."
      ],
      approvalExpectations: [],
      doneWhen: "The requested briefing type is generated with current context and stored as an artifact the operator can use immediately."
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

  if (intent.startsWith("briefing:")) {
    return goalContractProfiles.briefing;
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

const defaultWorkflowResponsibilityAudit: {
  requiredEvents: Array<(typeof workflowResponsibilityAuditEventValues)[number]>;
  requireActorContext: boolean;
  requireReasonForDelegation: boolean;
  requireReasonForEscalation: boolean;
  requireReviewerIdentity: boolean;
} = {
  requiredEvents: ["delegation_change", "handoff_acceptance", "review_assignment", "escalation_trigger"],
  requireActorContext: true,
  requireReasonForDelegation: true,
  requireReasonForEscalation: true,
  requireReviewerIdentity: true
};

export const WorkflowResponsibilityAssigneeSchema = z
  .object({
    kind: WorkflowResponsibilityAssigneeKindSchema,
    userId: z.string().min(1).nullable().default(null),
    workspaceRole: WorkspaceRoleSchema.nullable().default(null),
    systemActor: z.string().min(1).max(100).nullable().default(null),
    label: z.string().min(1).max(120)
  })
  .strict()
  .superRefine((value, context) => {
    if (value.kind === "user" && !value.userId) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "User responsibility assignments require a userId.",
        path: ["userId"]
      });
    }

    if (value.kind === "workspace_role" && !value.workspaceRole) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Workspace-role responsibility assignments require a workspaceRole.",
        path: ["workspaceRole"]
      });
    }

    if (value.kind === "system_actor" && !value.systemActor) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "System responsibility assignments require a systemActor.",
        path: ["systemActor"]
      });
    }
  });

export const WorkflowResponsibilityAuditSchema = z
  .object({
    requiredEvents: z.array(WorkflowResponsibilityAuditEventSchema).min(1).default(defaultWorkflowResponsibilityAudit.requiredEvents),
    requireActorContext: z.boolean().default(defaultWorkflowResponsibilityAudit.requireActorContext),
    requireReasonForDelegation: z.boolean().default(defaultWorkflowResponsibilityAudit.requireReasonForDelegation),
    requireReasonForEscalation: z.boolean().default(defaultWorkflowResponsibilityAudit.requireReasonForEscalation),
    requireReviewerIdentity: z.boolean().default(defaultWorkflowResponsibilityAudit.requireReviewerIdentity)
  })
  .strict();

export const WorkflowResponsibilitySchema = z
  .object({
    owner: WorkflowResponsibilityAssigneeSchema,
    delegate: WorkflowResponsibilityAssigneeSchema.nullable().default(null),
    reviewer: WorkflowResponsibilityAssigneeSchema.nullable().default(null),
    escalationOwner: WorkflowResponsibilityAssigneeSchema.nullable().default(null),
    handoffStatus: WorkflowResponsibilityStatusSchema.default("owner_control"),
    handoffSummary: z.string().min(1).max(500).nullable().default(null),
    delegationReason: z.string().min(1).max(500).nullable().default(null),
    escalationReason: z.string().min(1).max(500).nullable().default(null),
    audit: WorkflowResponsibilityAuditSchema.default(defaultWorkflowResponsibilityAudit),
    lastChangedAt: z.string().datetime().nullable().default(null),
    lastChangedBy: WorkflowResponsibilityAssigneeSchema.nullable().default(null)
  })
  .strict();

export function createUserResponsibilityAssignee(userId: string, label: string) {
  return WorkflowResponsibilityAssigneeSchema.parse({
    kind: "user",
    userId,
    workspaceRole: null,
    systemActor: null,
    label
  });
}

export function createWorkspaceRoleResponsibilityAssignee(workspaceRole: WorkspaceRole, label: string) {
  return WorkflowResponsibilityAssigneeSchema.parse({
    kind: "workspace_role",
    userId: null,
    workspaceRole,
    systemActor: null,
    label
  });
}

export function createSystemResponsibilityAssignee(systemActor: string, label: string) {
  return WorkflowResponsibilityAssigneeSchema.parse({
    kind: "system_actor",
    userId: null,
    workspaceRole: null,
    systemActor,
    label
  });
}

function defaultEscalationOwner(params: { ownerUserId?: string | null; workspaceId?: string | null; label: string }) {
  if (params.workspaceId) {
    return createWorkspaceRoleResponsibilityAssignee("owner", params.label);
  }

  if (params.ownerUserId) {
    return createUserResponsibilityAssignee(params.ownerUserId, params.label);
  }

  return createWorkspaceRoleResponsibilityAssignee("owner", params.label);
}

export function deriveGoalResponsibility(params: { userId: string; workspaceId?: string | null }) {
  return WorkflowResponsibilitySchema.parse({
    owner: createUserResponsibilityAssignee(params.userId, "Goal owner"),
    delegate: null,
    reviewer: defaultEscalationOwner({
      ownerUserId: params.userId,
      workspaceId: params.workspaceId ?? null,
      label: "Goal reviewer"
    }),
    escalationOwner: defaultEscalationOwner({
      ownerUserId: params.userId,
      workspaceId: params.workspaceId ?? null,
      label: "Escalation owner"
    }),
    handoffStatus: "owner_control",
    handoffSummary:
      params.workspaceId
        ? "The workspace owner retains goal accountability. Task-level execution and approval objects carry the active handoffs."
        : "The requesting user retains direct control until a task, approval, or escalation changes hands.",
    delegationReason: null,
    escalationReason: null,
    audit: defaultWorkflowResponsibilityAudit,
    lastChangedAt: null,
    lastChangedBy: createUserResponsibilityAssignee(params.userId, "Goal owner")
  });
}

export function deriveTaskResponsibility(params: {
  assignedAgent: AgentName;
  requiresApproval: boolean;
  ownerUserId?: string | null;
  workspaceId?: string | null;
}) {
  const owner = params.ownerUserId
    ? createUserResponsibilityAssignee(params.ownerUserId, "Goal owner")
    : createWorkspaceRoleResponsibilityAssignee("owner", "Goal owner");

  const reviewer = params.requiresApproval
    ? defaultEscalationOwner({
        ownerUserId: params.ownerUserId ?? null,
        workspaceId: params.workspaceId ?? null,
        label: "Human reviewer"
      })
    : null;

  return WorkflowResponsibilitySchema.parse({
    owner,
    delegate: createSystemResponsibilityAssignee(params.assignedAgent, `${params.assignedAgent} execution lane`),
    reviewer,
    escalationOwner: defaultEscalationOwner({
      ownerUserId: params.ownerUserId ?? null,
      workspaceId: params.workspaceId ?? null,
      label: "Escalation owner"
    }),
    handoffStatus: params.requiresApproval ? "review_pending" : "delegated",
    handoffSummary: params.requiresApproval
      ? `Execution is staged behind reviewer approval before the ${params.assignedAgent} lane can proceed.`
      : `The ${params.assignedAgent} lane is the active execution delegate for this task.`,
    delegationReason: `Assigned to the ${params.assignedAgent} execution lane.`,
    escalationReason: null,
    audit: defaultWorkflowResponsibilityAudit,
    lastChangedAt: null,
    lastChangedBy: owner
  });
}

export function deriveApprovalResponsibility(params: {
  ownerUserId?: string | null;
  workspaceId?: string | null;
  delegateAgent?: AgentName | null;
}) {
  const owner = params.ownerUserId
    ? createUserResponsibilityAssignee(params.ownerUserId, "Goal owner")
    : createWorkspaceRoleResponsibilityAssignee("owner", "Goal owner");
  const reviewer = defaultEscalationOwner({
    ownerUserId: params.ownerUserId ?? null,
    workspaceId: params.workspaceId ?? null,
    label: "Approval reviewer"
  });

  return WorkflowResponsibilitySchema.parse({
    owner,
    delegate: params.delegateAgent
      ? createSystemResponsibilityAssignee(params.delegateAgent, `${params.delegateAgent} execution lane`)
      : null,
    reviewer,
    escalationOwner: defaultEscalationOwner({
      ownerUserId: params.ownerUserId ?? null,
      workspaceId: params.workspaceId ?? null,
      label: "Escalation owner"
    }),
    handoffStatus: "review_pending",
    handoffSummary: "Human review is required before the requested action can proceed.",
    delegationReason: params.delegateAgent ? `Prepared by the ${params.delegateAgent} lane and staged for review.` : null,
    escalationReason: null,
    audit: defaultWorkflowResponsibilityAudit,
    lastChangedAt: null,
    lastChangedBy: owner
  });
}

export function deriveWatcherResponsibility(params: {
  ownerUserId?: string | null;
  workspaceId?: string | null;
  createdByUserId?: string | null;
  targetEntity: string;
}) {
  const owner = params.ownerUserId
    ? createUserResponsibilityAssignee(params.ownerUserId, "Goal owner")
    : createWorkspaceRoleResponsibilityAssignee("owner", "Goal owner");
  const delegate = params.workspaceId
    ? createWorkspaceRoleResponsibilityAssignee("editor", "Workspace editor")
    : params.createdByUserId
      ? createUserResponsibilityAssignee(params.createdByUserId, "Watcher operator")
      : null;
  const reviewer = defaultEscalationOwner({
    ownerUserId: params.ownerUserId ?? params.createdByUserId ?? null,
    workspaceId: params.workspaceId ?? null,
    label: "Escalation owner"
  });

  return WorkflowResponsibilitySchema.parse({
    owner,
    delegate,
    reviewer,
    escalationOwner: reviewer,
    handoffStatus: delegate ? "delegated" : "owner_control",
    handoffSummary: delegate
      ? `Workspace editors can maintain the ${params.targetEntity} watcher while owner approval and escalation stay explicit.`
      : `The owner directly manages the ${params.targetEntity} watcher.`,
    delegationReason: delegate ? `Delegated watcher maintenance for ${params.targetEntity}.` : null,
    escalationReason: null,
    audit: defaultWorkflowResponsibilityAudit,
    lastChangedAt: null,
    lastChangedBy: owner
  });
}

export function deriveAutopilotEventResponsibility(params: { userId: string; mode: AutopilotMode }) {
  const owner = createUserResponsibilityAssignee(params.userId, "Autopilot owner");
  return WorkflowResponsibilitySchema.parse({
    owner,
    delegate: createSystemResponsibilityAssignee("autopilot", "Autopilot processor"),
    reviewer: params.mode === "notify_only" ? createUserResponsibilityAssignee(params.userId, "Human reviewer") : null,
    escalationOwner: createUserResponsibilityAssignee(params.userId, "Escalation owner"),
    handoffStatus: params.mode === "notify_only" ? "review_pending" : "delegated",
    handoffSummary:
      params.mode === "notify_only"
        ? "Autopilot will surface this event for human review before any further action is taken."
        : "Autopilot is the active delegate for this event until it completes or escalates.",
    delegationReason: "Queued for autopilot processing.",
    escalationReason: null,
    audit: defaultWorkflowResponsibilityAudit,
    lastChangedAt: null,
    lastChangedBy: owner
  });
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
  responsibility: WorkflowResponsibilitySchema.optional(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime()
});

export const GoalSchema = GoalInputSchema.transform((goal) => {
  const derived = deriveGoalContract(goal.intent);

  return {
    ...goal,
    wedge: goal.wedge ?? derived.wedge,
    completionContract: goal.completionContract ?? derived.completionContract,
    responsibility: goal.responsibility ?? deriveGoalResponsibility({ userId: goal.userId, workspaceId: goal.workspaceId })
  };
});

const TaskInputSchema = z.object({
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
  responsibility: WorkflowResponsibilitySchema.optional(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime()
});

export const TaskSchema = TaskInputSchema.transform((task) => ({
  ...task,
  responsibility:
    task.responsibility ??
    deriveTaskResponsibility({
      assignedAgent: task.assignedAgent,
      requiresApproval: task.requiresApproval
    })
}));

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
  contextPacketConsent: z.object({
    basis: z.enum(["explicit", "implied", "system", "derived"]),
    grantedBy: z.string().min(1).max(120).nullable().default(null),
    grantedAt: z.string().datetime().nullable().default(null)
  }).strict().nullable().default(null),
  // Agent-scoped memories
  agentId: z.string().nullable().default(null),
  agentScope: AgentMemoryScopeSchema.default("global"),
  reviewAt: z.string().datetime().nullable().default(null),
  expiryAt: z.string().datetime().nullable().default(null),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime()
});

export const ContextPacketSourceSchema = z
  .object({
    kind: z.enum(["memory", "user_input", "system", "integration", "job", "derived"]),
    id: z.string().min(1),
    summary: z.string().min(1).max(280)
  })
  .strict();

export const ContextPacketConsentSchema = z
  .object({
    basis: z.enum(["explicit", "implied", "system", "derived"]),
    grantedBy: z.string().min(1).max(120).nullable().default(null),
    grantedAt: z.string().datetime().nullable().default(null)
  })
  .strict();

export const ContextPacketRetentionSchema = z
  .object({
    reviewAt: z.string().datetime().nullable().default(null),
    expiryAt: z.string().datetime().nullable().default(null)
  })
  .strict();

export const ContextPacketFreshnessSchema = z
  .object({
    status: z.enum(["fresh", "review_due", "expired", "low_confidence"]),
    observedAt: z.string().datetime(),
    staleAt: z.string().datetime().nullable().default(null)
  })
  .strict();

export const ContextPacketTransformationSchema = z
  .object({
    id: z.string().min(1),
    kind: z.enum(["derived_from_memory", "summarized", "redacted", "normalized"]),
    at: z.string().datetime(),
    inputIds: z.array(z.string().min(1)).max(20).default([]),
    outputId: z.string().min(1),
    summary: z.string().min(1).max(280)
  })
  .strict();

export const ContextPacketUsageSchema = z
  .object({
    usedBy: z.string().min(1).max(120),
    purpose: z.string().min(1).max(160),
    usedAt: z.string().datetime()
  })
  .strict();

export const ContextPacketLineageSchema = z
  .object({
    parentPacketIds: z.array(z.string().min(1)).max(20).default([]),
    sourceMemoryIds: z.array(z.string().min(1)).max(20).default([]),
    transformationIds: z.array(z.string().min(1)).max(20).default([])
  })
  .strict();

export const ContextPacketSchema = z
  .object({
    id: z.string().min(1),
    userId: z.string().min(1),
    source: ContextPacketSourceSchema,
    category: z.string().min(1).max(120),
    contentSummary: z.string().min(1).max(500),
    memoryType: MemoryTypeSchema,
    sensitivity: z.string().min(1).max(80),
    permissions: z.array(AgentNameSchema).default([]),
    retention: ContextPacketRetentionSchema,
    consent: ContextPacketConsentSchema,
    freshness: ContextPacketFreshnessSchema,
    lineage: ContextPacketLineageSchema,
    transformations: z.array(ContextPacketTransformationSchema).max(20).default([]),
    usage: z.array(ContextPacketUsageSchema).max(20).default([]),
    actorContext: z.lazy(() => ActorContextSchema).nullable().default(null),
    createdAt: z.string().datetime(),
    updatedAt: z.string().datetime()
  })
  .strict();

export const executionProvenanceNodeTypeValues = [
  "goal",
  "task",
  "decision",
  "approval",
  "action",
  "job",
  "memory",
  "context_packet",
  "output",
  "failure"
] as const;
export const executionProvenanceEdgeTypeValues = [
  "created",
  "decided",
  "approved",
  "queued",
  "executed",
  "produced",
  "captured",
  "derived_from",
  "failed",
  "replayed_from",
  "uses_context"
] as const;

export const ExecutionProvenanceNodeTypeSchema = z.enum(executionProvenanceNodeTypeValues);
export const ExecutionProvenanceEdgeTypeSchema = z.enum(executionProvenanceEdgeTypeValues);

export const ExecutionProvenanceNodeSchema = z
  .object({
    id: z.string().min(1),
    type: ExecutionProvenanceNodeTypeSchema,
    ownerUserId: z.string().min(1),
    label: z.string().min(1).max(160),
    summary: z.string().min(1).max(500),
    sensitivity: z.string().min(1).max(80).default("internal"),
    createdAt: z.string().datetime().nullable().default(null),
    metadata: z.record(z.string(), z.unknown()).default({})
  })
  .strict();

export const ExecutionProvenanceEdgeSchema = z
  .object({
    id: z.string().min(1),
    type: ExecutionProvenanceEdgeTypeSchema,
    from: z.string().min(1),
    to: z.string().min(1),
    label: z.string().min(1).max(160),
    createdAt: z.string().datetime().nullable().default(null),
    metadata: z.record(z.string(), z.unknown()).default({})
  })
  .strict();

export const ExecutionProvenanceTimelineEntrySchema = z
  .object({
    id: z.string().min(1),
    nodeId: z.string().min(1),
    at: z.string().datetime(),
    type: ExecutionProvenanceNodeTypeSchema,
    label: z.string().min(1).max(160),
    summary: z.string().min(1).max(500)
  })
  .strict();

export const ExecutionProvenanceGraphSchema = z
  .object({
    nodes: z.array(ExecutionProvenanceNodeSchema).max(500),
    edges: z.array(ExecutionProvenanceEdgeSchema).max(1_000),
    timeline: z.array(ExecutionProvenanceTimelineEntrySchema).max(500),
    query: z
      .object({
        rootId: z.string().min(1).nullable().default(null),
        depth: z.number().int().min(0).max(4),
        limit: z.number().int().min(1).max(500)
      })
      .strict()
  })
  .strict();

export const PolicyDecisionSchema = z.object({
  riskClass: RiskClassSchema,
  outcome: z.enum(["allowed", "allowed_with_confirmation", "blocked", "downgrade_to_draft", "escalate"]),
  rationale: z.string().min(1),
  confidence: z.number().min(0).max(1),
  requiresApproval: z.boolean()
});

export const GovernanceConformanceCheckSchema = z.object({
  id: z.string().min(1),
  status: z.enum(["pass", "warn", "fail"]),
  summary: z.string().min(1),
  detail: z.string().min(1)
});

export const GovernanceConformanceReportSchema = z.object({
  status: z.enum(["conformant", "needs_attention", "non_conformant"]),
  summary: z.string().min(1),
  checks: z.array(GovernanceConformanceCheckSchema).default([])
});

export const PolicySimulationCheckSchema = z.object({
  id: z.string().min(1),
  stage: z.enum(["input", "risk", "governance", "trust", "decision"]),
  status: z.enum(["pass", "warn", "fail", "info"]),
  summary: z.string().min(1),
  detail: z.string().min(1)
});

export const PolicyReplayValidationSchema = z.object({
  replayValidated: z.boolean(),
  matchedPatterns: z.number().int().min(0),
  matchedEpisodes: z.number().int().min(0),
  suggestedPatterns: z.number().int().min(0),
  safeSuggestionPrecision: z.number().min(0).max(1),
  negativeOutcomeRate: z.number().min(0).max(1),
  failureCostRate: z.number().min(0).max(1),
  driftStatus: z.enum(["improving", "stable", "regressing", "insufficient_data"]),
  rationale: z.string().min(1)
});

export const AutonomyBudgetDecisionInputSchema = z.object({
  id: z.enum([
    "confidence_threshold",
    "capability_risk_class",
    "approval_mode",
    "governance_ceiling",
    "external_send_gate",
    "calendar_write_gate",
    "shadow_replay_policy",
    "learning_promotion_mode",
    "learning_rollback_control",
    "memory_trust",
    "scorecard_trust",
    "replay_validation"
  ]),
  category: z.enum(["input", "governance", "trust", "learning"]),
  active: z.boolean(),
  summary: z.string().min(1),
  detail: z.string().min(1)
});

export const AutonomyBudgetShadowReplaySchema = z.object({
  eligibleForR3: z.boolean(),
  enabled: z.boolean(),
  required: z.boolean(),
  promotionMode: LearningPromotionModeSchema,
  rollbackOutcome: LearningRollbackOutcomeSchema,
  thresholdSummary: z.array(z.string().min(1)).default([]),
  summary: z.string().min(1)
});

export const AutonomyBudgetSchema = z.object({
  approvalMode: WorkspaceApprovalModeSchema,
  governanceCeilingRiskClass: RiskClassSchema,
  requiresExplicitApprovalCapabilities: z.array(CapabilitySchema).default([]),
  r3AutonomyEligible: z.boolean(),
  shadowReplay: AutonomyBudgetShadowReplaySchema,
  decisionInputs: z.array(AutonomyBudgetDecisionInputSchema).default([]),
  summary: z.string().min(1)
});

export const PolicyDecisionTraceSchema = z.object({
  decision: PolicyDecisionSchema,
  checks: z.array(PolicySimulationCheckSchema).default([]),
  trust: z.object({
    approvedCount: z.number().int().min(0),
    rejectedCount: z.number().int().min(0),
    trustScore: z.number().min(-1).max(1)
  }),
  scorecardTrust: z.object({
    strong: z.boolean(),
    weak: z.boolean(),
    rationale: z.string().min(1).nullable().default(null)
  }),
  autonomyBudget: AutonomyBudgetSchema.nullable().default(null),
  conformance: GovernanceConformanceReportSchema.nullable().default(null),
  learningValidation: PolicyReplayValidationSchema.nullable().default(null)
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
const ActionIntentSchemaVersionSchema = z.literal("v1");
const ActionIntentMetadataSchema = z.record(z.string(), z.union([z.string(), z.number(), z.boolean(), z.null()])).default({});

export const SendMessageActionIntentSchema = z
  .object({
    schemaVersion: ActionIntentSchemaVersionSchema.default("v1"),
    type: z.literal("send_message"),
    adapter: z.literal("gmail").default("gmail"),
    riskClass: RiskClassSchema.default("R3"),
    to: ActionIntentEmailSchema,
    subject: z.string().trim().min(1).max(240),
    body: z.string().min(1).max(20_000),
    threadId: z.string().trim().min(1).max(200).nullable().default(null),
    mode: z.enum(["draft", "send"]).default("draft"),
    metadata: ActionIntentMetadataSchema
  })
  .strict();

export const ScheduleEventActionIntentSchema = z
  .object({
    schemaVersion: ActionIntentSchemaVersionSchema.default("v1"),
    type: z.literal("schedule_event"),
    adapter: z.literal("calendar").default("calendar"),
    riskClass: RiskClassSchema.default("R3"),
    summary: z.string().trim().min(1).max(240),
    start: z.string().datetime(),
    end: z.string().datetime(),
    description: z.string().max(10_000).nullable().default(null),
    attendees: z.array(ActionIntentEmailSchema).max(50).default([]),
    metadata: ActionIntentMetadataSchema
  })
  .strict()
  .refine((value) => new Date(value.start).getTime() < new Date(value.end).getTime(), {
    message: "Schedule event intents require an end time after the start time.",
    path: ["end"]
  });

export const CreateNoteActionIntentSchema = z
  .object({
    schemaVersion: ActionIntentSchemaVersionSchema.default("v1"),
    type: z.literal("create_note"),
    adapter: z.literal("notes").default("notes"),
    riskClass: RiskClassSchema.default("R2"),
    title: z.string().trim().min(1).max(240),
    content: z.string().min(1).max(20_000),
    metadata: ActionIntentMetadataSchema
  })
  .strict();

export const ManualReviewActionIntentSchema = z
  .object({
    schemaVersion: ActionIntentSchemaVersionSchema.default("v1"),
    type: z.literal("manual_review"),
    riskClass: RiskClassSchema.default("R2"),
    actionType: ApprovalActionTypeSchema,
    summary: z.string().min(1).max(500),
    reason: z.string().min(1).max(1_000),
    artifactIds: z.array(z.string().min(1)).max(20).default([]),
    metadata: ActionIntentMetadataSchema
  })
  .strict();

export const UpdateRecordActionIntentSchema = z
  .object({
    schemaVersion: ActionIntentSchemaVersionSchema.default("v1"),
    type: z.literal("update_record"),
    adapter: z.literal("workspace").default("workspace"),
    riskClass: RiskClassSchema.default("R3"),
    targetType: z.string().trim().min(1).max(120),
    targetId: z.string().trim().min(1).max(200),
    patch: z.record(z.string(), z.union([z.string(), z.number(), z.boolean(), z.null()])).default({}),
    reason: z.string().trim().min(1).max(1_000),
    metadata: ActionIntentMetadataSchema
  })
  .strict()
  .refine((value) => Object.keys(value.patch).length > 0, {
    message: "Update record intents require at least one patch field.",
    path: ["patch"]
  });

export const DeleteRecordActionIntentSchema = z
  .object({
    schemaVersion: ActionIntentSchemaVersionSchema.default("v1"),
    type: z.literal("delete_record"),
    adapter: z.literal("workspace").default("workspace"),
    riskClass: RiskClassSchema.default("R4"),
    targetType: z.string().trim().min(1).max(120),
    targetId: z.string().trim().min(1).max(200),
    reason: z.string().trim().min(1).max(1_000),
    confirmationToken: z.string().trim().min(8).max(120).nullable().default(null),
    metadata: ActionIntentMetadataSchema
  })
  .strict();

export const MonitorSignalActionIntentSchema = z
  .object({
    schemaVersion: ActionIntentSchemaVersionSchema.default("v1"),
    type: z.literal("monitor_signal"),
    adapter: z.literal("watcher").default("watcher"),
    riskClass: RiskClassSchema.default("R2"),
    targetEntity: z.string().trim().min(1).max(240),
    condition: z.string().trim().min(1).max(1_000),
    triggerAction: z.string().trim().min(1).max(1_000),
    sourceSystems: z.array(z.string().trim().min(1).max(120)).max(20).default([]),
    metadata: ActionIntentMetadataSchema
  })
  .strict();

export const actionIntentTypeValues = [
  "send_message",
  "schedule_event",
  "create_note",
  "manual_review",
  "update_record",
  "delete_record",
  "monitor_signal"
] as const;
export const ActionIntentTypeSchema = z.enum(actionIntentTypeValues);

export const ActionIntentSchema = z.discriminatedUnion("type", [
  SendMessageActionIntentSchema,
  ScheduleEventActionIntentSchema,
  CreateNoteActionIntentSchema,
  ManualReviewActionIntentSchema,
  UpdateRecordActionIntentSchema,
  DeleteRecordActionIntentSchema,
  MonitorSignalActionIntentSchema
]);

export const actionAdapterKeyValues = ["gmail", "calendar", "notes", "manual_review", "workspace", "watcher"] as const;
export const ActionAdapterKeySchema = z.enum(actionAdapterKeyValues);

export const actionExecutionOperationValues = [
  "send_message",
  "create_draft",
  "create_event",
  "create_note",
  "manual_review",
  "update_record",
  "delete_record",
  "monitor_signal"
] as const;
export const ActionExecutionOperationSchema = z.enum(actionExecutionOperationValues);

export const actionExecutionRecoveryStrategyValues = ["none", "retry", "manual_review"] as const;
export const ActionExecutionRecoveryStrategySchema = z.enum(actionExecutionRecoveryStrategyValues);

export const ActionExecutionRecoverySchema = z
  .object({
    strategy: ActionExecutionRecoveryStrategySchema,
    note: z.string().min(1).max(400),
    compensationHints: z.array(z.string().min(1).max(200)).max(10).default([])
  })
  .strict();

export const ActionExecutionPlanSchema = z
  .object({
    actionType: ActionIntentTypeSchema,
    adapter: ActionAdapterKeySchema,
    operation: ActionExecutionOperationSchema,
    dryRunSummary: z.string().min(1).max(500),
    preview: ApprovalPreviewSchema,
    idempotencyKey: z.string().min(1).max(200).nullable().default(null),
    sideEffectTarget: z.string().min(1).max(400).nullable().default(null),
    recovery: ActionExecutionRecoverySchema
  })
  .strict();

export const actionExecutionOutcomeStatusValues = ["completed", "partial_success", "failed", "skipped"] as const;
export const ActionExecutionOutcomeStatusSchema = z.enum(actionExecutionOutcomeStatusValues);

export const ActionExecutionOutcomeSchema = z
  .object({
    status: ActionExecutionOutcomeStatusSchema,
    detail: z.string().min(1).max(1_000),
    preview: ApprovalPreviewSchema,
    retryable: z.boolean().default(false),
    providerRef: z.string().min(1).max(200).nullable().default(null),
    idempotencyKey: z.string().min(1).max(200).nullable().default(null),
    sideEffectTarget: z.string().min(1).max(400).nullable().default(null),
    recovery: ActionExecutionRecoverySchema
  })
  .strict();

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

const ApprovalRequestInputSchema = z.object({
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
  responsibility: WorkflowResponsibilitySchema.optional(),
  createdAt: z.string().datetime(),
  expiryAt: z.string().datetime(),
  respondedAt: z.string().datetime().nullable().default(null)
});

export const ApprovalRequestSchema = ApprovalRequestInputSchema.transform((approval) => ({
  ...approval,
  responsibility: approval.responsibility ?? deriveApprovalResponsibility({})
}));

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
export const dashboardNextBestActionKindValues = [
  "configure_workspace",
  "review_now",
  "review_approval",
  "recover_execution",
  "repair_connector"
] as const;
export const dashboardTeamWorkflowModeValues = ["setup", "owner_control", "editor_execution", "viewer_review"] as const;
export const dashboardTeamWorkflowAssignmentKeyValues = [
  "shared_queue",
  "approval_boundary",
  "execution_recovery"
] as const;
export const dashboardTeamWorkflowQueueKeyValues = ["mine", "delegated", "escalated", "blocked", "waiting"] as const;
export const dashboardTeamWorkflowControlKeyValues = [
  "open_mine",
  "rebalance_queue",
  "escalate_overdue",
  "review_blockers",
  "export_audit"
] as const;

export const DashboardOperatingSectionKeySchema = z.enum(dashboardOperatingSectionKeyValues);
export const DashboardOperatingSectionStatusSchema = z.enum(dashboardOperatingSectionStatusValues);
export const DashboardNextBestActionKindSchema = z.enum(dashboardNextBestActionKindValues);
export const DashboardTeamWorkflowModeSchema = z.enum(dashboardTeamWorkflowModeValues);
export const DashboardTeamWorkflowAssignmentKeySchema = z.enum(dashboardTeamWorkflowAssignmentKeyValues);
export const DashboardTeamWorkflowQueueKeySchema = z.enum(dashboardTeamWorkflowQueueKeyValues);
export const DashboardTeamWorkflowControlKeySchema = z.enum(dashboardTeamWorkflowControlKeyValues);

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

export const DashboardRoleViewSchema = z.object({
  role: WorkspaceRoleSchema.nullable().default(null),
  label: z.string().min(1),
  summary: z.string().min(1),
  focusAreas: z.array(z.string().min(1)).default([]),
  prioritizedSectionKeys: z.array(DashboardOperatingSectionKeySchema).default([])
});

export const DashboardNextBestActionSchema = z.object({
  kind: DashboardNextBestActionKindSchema,
  label: z.string().min(1),
  summary: z.string().min(1),
  status: DashboardOperatingSectionStatusSchema,
  targetSection: z.string().min(1),
  targetItemId: z.string().min(1).optional(),
  reason: z.string().min(1).optional(),
  role: WorkspaceRoleSchema.nullable().default(null)
});

export const DashboardPermissionSchema = z.object({
  allowed: z.boolean(),
  reason: z.string().min(1)
});

export const DashboardTeamWorkflowAssignmentSchema = z.object({
  key: DashboardTeamWorkflowAssignmentKeySchema,
  label: z.string().min(1),
  ownerRole: WorkspaceRoleSchema.nullable().default(null),
  status: DashboardOperatingSectionStatusSchema,
  summary: z.string().min(1)
});

export const DashboardTeamWorkflowQueueSchema = z.object({
  key: DashboardTeamWorkflowQueueKeySchema,
  label: z.string().min(1),
  ownerRole: WorkspaceRoleSchema.nullable().default(null),
  status: DashboardOperatingSectionStatusSchema,
  count: z.number().int().min(0),
  summary: z.string().min(1),
  oldestAgeLabel: z.string().min(1).nullable().default(null),
  targetSection: z.string().min(1),
  targetItemId: z.string().min(1).optional(),
  targetFilter: CommitmentInboxBucketSchema.nullable().default(null)
});

export const DashboardTeamWorkflowControlSchema = z.object({
  key: DashboardTeamWorkflowControlKeySchema,
  label: z.string().min(1),
  summary: z.string().min(1),
  status: DashboardOperatingSectionStatusSchema,
  targetSection: z.string().min(1),
  targetItemId: z.string().min(1).optional(),
  targetFilter: CommitmentInboxBucketSchema.nullable().default(null),
  permission: DashboardPermissionSchema
});

export const DashboardTeamWorkflowAuditCoverageSchema = z.object({
  required: z.boolean(),
  status: DashboardOperatingSectionStatusSchema,
  summary: z.string().min(1),
  latestStatus: PrivacyOperationStatusSchema.nullable().default(null),
  latestCompletedAt: z.string().datetime().nullable().default(null)
});

export const DashboardTeamWorkflowSchema = z.object({
  mode: DashboardTeamWorkflowModeSchema,
  label: z.string().min(1),
  summary: z.string().min(1),
  visibilityLabel: z.string().min(1),
  queueMetrics: z.array(z.string().min(1)).default([]),
  ownershipAssignments: z.array(DashboardTeamWorkflowAssignmentSchema).default([]),
  queues: z.array(DashboardTeamWorkflowQueueSchema).default([]),
  controls: z.array(DashboardTeamWorkflowControlSchema).default([]),
  auditCoverage: DashboardTeamWorkflowAuditCoverageSchema,
  actionBoundaries: z.array(z.string().min(1)).default([]),
  handoffGuidance: z.array(z.string().min(1)).default([]),
  permissions: z.object({
    manageMembers: DashboardPermissionSchema,
    editGovernance: DashboardPermissionSchema,
    exportAudit: DashboardPermissionSchema,
    managePrivacyOperations: DashboardPermissionSchema
  }),
  escalationTargetRole: WorkspaceRoleSchema.nullable().default(null),
  slaStatus: DashboardOperatingSectionStatusSchema,
  slaSummary: z.string().min(1)
});

export const DashboardOperatingSectionsSchema = z.object({
  generatedAt: z.string().datetime(),
  roleView: DashboardRoleViewSchema,
  teamWorkflow: DashboardTeamWorkflowSchema,
  nextBestAction: DashboardNextBestActionSchema,
  sections: z.array(DashboardOperatingSectionSchema).default([])
});

export const defaultWorkspaceShadowReplayPolicy = {
  enabled: true,
  promotionMode: "shadow_only",
  rollbackOutcome: "downgrade_to_draft",
  minimumMatchedEpisodes: 3,
  minimumPrecision: 0.8,
  maximumNegativeOutcomeRate: 0.15,
  maximumFailureCostRate: 0.2
} as const;

export const enterpriseWorkspaceGovernanceDefaults = {
  approvalMode: "always_review",
  requireAuditExports: true,
  maxAutoRunRiskClass: "R1",
  publicSharingEnabled: false,
  providerAccessRequiresApproval: true,
  escalationRequiresApproval: true,
  externalSendRequiresApproval: true,
  calendarWriteRequiresApproval: true,
  shadowReplayPolicy: defaultWorkspaceShadowReplayPolicy,
  retentionDays: 90
} as const;

export const WorkspaceShadowReplayPolicySchema = z
  .object({
    enabled: z.boolean().default(defaultWorkspaceShadowReplayPolicy.enabled),
    promotionMode: LearningPromotionModeSchema.default(defaultWorkspaceShadowReplayPolicy.promotionMode),
    rollbackOutcome: LearningRollbackOutcomeSchema.default(defaultWorkspaceShadowReplayPolicy.rollbackOutcome),
    minimumMatchedEpisodes: z.number().int().min(1).max(50).default(defaultWorkspaceShadowReplayPolicy.minimumMatchedEpisodes),
    minimumPrecision: z.number().min(0).max(1).default(defaultWorkspaceShadowReplayPolicy.minimumPrecision),
    maximumNegativeOutcomeRate: z.number().min(0).max(1).default(defaultWorkspaceShadowReplayPolicy.maximumNegativeOutcomeRate),
    maximumFailureCostRate: z.number().min(0).max(1).default(defaultWorkspaceShadowReplayPolicy.maximumFailureCostRate)
  })
  .strict();

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
  approvalMode: WorkspaceApprovalModeSchema.default(enterpriseWorkspaceGovernanceDefaults.approvalMode),
  requireAuditExports: z.boolean().default(enterpriseWorkspaceGovernanceDefaults.requireAuditExports),
  maxAutoRunRiskClass: RiskClassSchema.default(enterpriseWorkspaceGovernanceDefaults.maxAutoRunRiskClass),
  publicSharingEnabled: z.boolean().default(enterpriseWorkspaceGovernanceDefaults.publicSharingEnabled),
  providerAccessRequiresApproval: z.boolean().default(enterpriseWorkspaceGovernanceDefaults.providerAccessRequiresApproval),
  escalationRequiresApproval: z.boolean().default(enterpriseWorkspaceGovernanceDefaults.escalationRequiresApproval),
  externalSendRequiresApproval: z.boolean().default(enterpriseWorkspaceGovernanceDefaults.externalSendRequiresApproval),
  calendarWriteRequiresApproval: z.boolean().default(enterpriseWorkspaceGovernanceDefaults.calendarWriteRequiresApproval),
  shadowReplayPolicy: WorkspaceShadowReplayPolicySchema.default(enterpriseWorkspaceGovernanceDefaults.shadowReplayPolicy),
  retentionDays: z.number().int().min(7).max(3650).default(enterpriseWorkspaceGovernanceDefaults.retentionDays),
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
  disclosureReview: z.record(z.string(), z.unknown()).nullable().optional(),
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

export const DEFAULT_AUTOPILOT_RELIABILITY_CONTROLS = {
  budgetWindowMinutes: 60,
  maxEventsPerWindow: 12,
  maxPendingEvents: 3,
  maxConsecutiveFailures: 2
} as const;

export const AutopilotReliabilityControlsSchema = z
  .object({
    budgetWindowMinutes: z.number().int().min(1).max(24 * 60),
    maxEventsPerWindow: z.number().int().min(1).max(500),
    maxPendingEvents: z.number().int().min(1).max(100),
    maxConsecutiveFailures: z.number().int().min(1).max(20)
  })
  .strict();

export const AutopilotSettingsSchema = z.object({
  userId: z.string().min(1),
  mode: AutopilotModeSchema,
  debounceMinutes: z.number().int().min(1).max(24 * 60),
  reliabilityControls: AutopilotReliabilityControlsSchema.default(DEFAULT_AUTOPILOT_RELIABILITY_CONTROLS),
  actorContext: z.lazy(() => ActorContextSchema).nullable().default(null),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime()
});

export const AutopilotEventEnvelopeSchema = z
  .object({
    family: AutopilotEventFamilySchema,
    trigger: AutopilotEventKindSchema,
    priority: AutopilotEventPrioritySchema,
    tags: z.array(z.string().trim().min(1).max(32)).max(8).default([]),
    correlationKey: z.string().trim().min(1).max(200).nullable().default(null)
  })
  .strict();

export const AutopilotEventBudgetSchema = z
  .object({
    key: z.string().trim().min(1).max(120),
    windowMinutes: z.number().int().min(1).max(24 * 60),
    maxEvents: z.number().int().min(1).max(100),
    scope: AutopilotEventBudgetScopeSchema.default("source")
  })
  .strict();

export const AutopilotEventSuppressionSchema = z
  .object({
    outcome: AutopilotEventSuppressionOutcomeSchema,
    reason: z.string().trim().min(1).max(200).nullable().default(null),
    relatedEventId: z.string().trim().min(1).max(200).nullable().default(null),
    budgetKey: z.string().trim().min(1).max(120).nullable().default(null),
    observedCount: z.number().int().min(0).max(100_000).nullable().default(null),
    budgetWindowMinutes: z.number().int().min(1).max(24 * 60).nullable().default(null),
    recentBudgetedEventCount: z.number().int().min(0).max(100_000).nullable().default(null),
    maxEventsPerWindow: z.number().int().min(1).max(100_000).nullable().default(null),
    pendingEventCount: z.number().int().min(0).max(100_000).nullable().default(null),
    maxPendingEvents: z.number().int().min(1).max(100_000).nullable().default(null),
    consecutiveFailureCount: z.number().int().min(0).max(100_000).nullable().default(null),
    maxConsecutiveFailures: z.number().int().min(1).max(100_000).nullable().default(null)
  })
  .strict();

export const AutopilotEventFabricReferenceSchema = z
  .object({
    goalId: z.string().min(1).nullable().default(null),
    workflowId: z.string().min(1).nullable().default(null),
    approvalId: z.string().min(1).nullable().default(null),
    watcherId: z.string().min(1).nullable().default(null),
    templateId: z.string().min(1).nullable().default(null),
    briefingType: BriefingTypeSchema.nullable().default(null)
  })
  .strict();

export const AutopilotEventFabricEnvelopeSchema = z
  .object({
    version: z.literal(1),
    family: z.string().min(1).max(80),
    severity: AutopilotEventSeveritySchema,
    operatorRoute: AutopilotEventOperatorRouteSchema,
    policy: AutopilotEventPolicySchema,
    references: AutopilotEventFabricReferenceSchema.default({
      goalId: null,
      workflowId: null,
      approvalId: null,
      watcherId: null,
      templateId: null,
      briefingType: null
    }),
    signals: z.array(z.string().min(1).max(200)).max(10).default([]),
    trigger: z.record(z.string(), z.unknown()).default({}),
    summary: z.string().min(1).max(500)
  })
  .strict();

export const AutopilotEventDetailsSchema = z
  .object({
    eventEnvelope: AutopilotEventEnvelopeSchema.nullable().default(null),
    budget: AutopilotEventBudgetSchema.nullable().default(null),
    suppression: AutopilotEventSuppressionSchema.nullable().default(null),
    fabric: AutopilotEventFabricEnvelopeSchema.nullable().default(null)
  })
  .catchall(z.unknown())
  .default({
    eventEnvelope: null,
    budget: null,
    suppression: null,
    fabric: null
  });

const AutopilotEventInputSchema = z.object({
  id: z.string().min(1),
  userId: z.string().min(1),
  kind: AutopilotEventKindSchema,
  sourceId: z.string().min(1),
  idempotencyKey: z.string().min(1).max(200).nullable().default(null),
  mode: AutopilotModeSchema,
  summary: z.string().min(1).max(500),
  status: AutopilotEventStatusSchema,
  details: AutopilotEventDetailsSchema,
  actorContext: z.lazy(() => ActorContextSchema).nullable().default(null),
  responsibility: WorkflowResponsibilitySchema.optional(),
  createdAt: z.string().datetime(),
  processedAt: z.string().datetime().nullable().default(null),
  resultGoalId: z.string().min(1).nullable().default(null),
  error: z.string().max(1000).nullable().default(null)
});

export const AutopilotEventSchema = AutopilotEventInputSchema.transform((event) => ({
  ...event,
  responsibility: event.responsibility ?? deriveAutopilotEventResponsibility({ userId: event.userId, mode: event.mode })
}));

export const AUTOPILOT_EVENT_TAXONOMY = {
  watcher_triggered: {
    family: "watcher_signal",
    defaultSeverity: "medium",
    operatorRoute: "workflow",
    policy: "draft_goal"
  },
  template_due: {
    family: "scheduled_template",
    defaultSeverity: "low",
    operatorRoute: "workflow",
    policy: "draft_goal"
  },
  briefing_due: {
    family: "scheduled_briefing",
    defaultSeverity: "low",
    operatorRoute: "operations",
    policy: "notify_operator"
  },
  communication_received: {
    family: "inbound_communication",
    defaultSeverity: "high",
    operatorRoute: "communications",
    policy: "draft_goal"
  },
  inbound_communication_received: {
    family: "inbound_communication",
    defaultSeverity: "high",
    operatorRoute: "communications",
    policy: "draft_goal"
  },
  deadline_drift_detected: {
    family: "deadline_drift",
    defaultSeverity: "high",
    operatorRoute: "operations",
    policy: "queue_operator_review"
  },
  approval_sla_breached: {
    family: "approval_attention",
    defaultSeverity: "high",
    operatorRoute: "approvals",
    policy: "queue_approval_review"
  },
  approval_attention_required: {
    family: "approval_attention",
    defaultSeverity: "high",
    operatorRoute: "approvals",
    policy: "queue_approval_review"
  },
  connector_failed: {
    family: "execution_failure",
    defaultSeverity: "critical",
    operatorRoute: "platform",
    policy: "escalate_immediately"
  },
  execution_failure_detected: {
    family: "execution_failure",
    defaultSeverity: "critical",
    operatorRoute: "platform",
    policy: "escalate_immediately"
  },
  workflow_stalled: {
    family: "workflow_stall",
    defaultSeverity: "medium",
    operatorRoute: "workflow",
    policy: "queue_operator_review"
  },
  dormant_workflow_review_due: {
    family: "dormant_workflow_review",
    defaultSeverity: "medium",
    operatorRoute: "workflow",
    policy: "queue_operator_review"
  }
} as const satisfies Record<
  (typeof autopilotEventKindValues)[number],
  {
    family: string;
    defaultSeverity: (typeof autopilotEventSeverityValues)[number];
    operatorRoute: (typeof autopilotEventOperatorRouteValues)[number];
    policy: (typeof autopilotEventPolicyValues)[number];
  }
>;

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

export const RecommendationRefinementSourceSchema = z
  .object({
    key: z.string().trim().min(1).max(160),
    source: z.literal("outcome_trace"),
    suggestedMessage: z.string().trim().min(1).max(2_000)
  })
  .strict();

export const RecommendationEditDistanceSchema = z
  .object({
    baselineLength: z.number().int().min(1).max(2_000),
    submittedLength: z.number().int().min(1).max(2_000),
    editDistance: z.number().int().min(0).max(2_000),
    normalizedEditDistance: z.number().min(0).max(1)
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

export const GitHubIssueIntakeJobPayloadSchema = z
  .object({
    type: z.literal("github_issue_intake"),
    goalId: z.string().min(1),
    workflowId: z.string().min(1),
    automationMode: GitHubIssueAutomationModeSchema.default("intake"),
    workspaceId: z.string().min(1).max(160).nullable().default(null),
    agentId: z.string().min(1).max(120).nullable().default(null),
    repository: z
      .object({
        fullName: z.string().trim().min(3).max(150).regex(/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/u),
        htmlUrl: z.string().url().max(500),
        defaultBranch: z.string().trim().min(1).max(200),
        private: z.boolean()
      })
      .strict(),
    issue: z
      .object({
        number: z.number().int().positive().max(1_000_000_000),
        nodeId: z.string().trim().min(1).max(200).nullable().default(null),
        title: z.string().trim().min(1).max(300),
        body: z.string().max(10_000).nullable().default(null),
        url: z.string().url().max(500),
        authorLogin: z.string().trim().min(1).max(120).nullable().default(null),
        labels: z.array(z.string().trim().min(1).max(80)).max(50).default([]),
        assignees: z.array(z.string().trim().min(1).max(120)).max(20).default([]),
        createdAt: z.string().datetime(),
        updatedAt: z.string().datetime()
      })
      .strict(),
    deliveryId: z.string().trim().min(1).max(120),
    receivedAt: z.string().datetime(),
    metadata: z
      .object({
        event: GitHubIssueTriggerEventSchema.default("issues"),
        action: GitHubIssueTriggerActionSchema.default("opened"),
        senderLogin: z.string().trim().min(1).max(120).nullable().default(null),
        triggerLabel: z.string().trim().min(1).max(80).nullable().default(null),
        command: z.string().trim().min(1).max(40).nullable().default(null),
        triggerId: z.string().trim().min(1).max(160).nullable().default(null),
        riskTags: z.array(z.string().trim().min(1).max(64)).max(20).default(["untrusted_external_input"])
      })
      .catchall(z.unknown())
      .default({
        event: "issues",
        action: "opened",
        senderLogin: null,
        triggerLabel: null,
        command: null,
        triggerId: null,
        riskTags: ["untrusted_external_input"]
      })
  })
  .strict();

export const ApprovalFollowUpJobPayloadSchema = z
  .object({
    type: z.literal("approval_follow_up"),
    approvalId: z.string().min(1),
    goalId: z.string().min(1),
    taskId: z.string().min(1),
    decision: ApprovalDecisionSchema.exclude(["pending"]),
    workspaceId: z.string().min(1).nullable().default(null),
    metadata: z
      .object({
        replayedFromJobId: z.string().min(1).nullable().default(null),
        actionId: z.string().min(1).max(200).nullable().default(null)
      })
      .catchall(z.unknown())
      .default({
        replayedFromJobId: null,
        actionId: null
      })
  })
  .strict();

const ApprovalNotificationMetadataSchema = z
  .object({
    replayedFromJobId: z.string().min(1).nullable().default(null)
  })
  .catchall(z.unknown())
  .default({
    replayedFromJobId: null
  });

const ApprovalNotificationJobBaseSchema = z.object({
  type: z.literal("approval_notification"),
  approvalId: z.string().min(1),
  goalId: z.string().min(1),
  taskId: z.string().min(1),
  decision: ApprovalDecisionSchema.exclude(["pending"]),
  workspaceId: z.string().min(1).nullable().default(null),
  metadata: ApprovalNotificationMetadataSchema
});

const SlackApprovalNotificationJobPayloadSchema = ApprovalNotificationJobBaseSchema.extend({
  channel: z.literal("slack")
}).strict();

const SlackApprovalReceiptJobPayloadSchema = ApprovalNotificationJobBaseSchema.extend({
  channel: z.literal("slack_receipt"),
  slackChannelId: z.string().trim().min(1).max(80),
  slackMessageTs: z.string().trim().regex(/^\d+\.\d+$/u)
}).strict();

const TelegramApprovalReceiptJobPayloadSchema = ApprovalNotificationJobBaseSchema.extend({
  channel: z.literal("telegram_receipt"),
  telegramChatId: z.string().trim().min(1).max(80),
  telegramMessageId: z.number().int().nonnegative()
}).strict();

export const ApprovalNotificationJobPayloadSchema = z.discriminatedUnion("channel", [
  SlackApprovalNotificationJobPayloadSchema,
  SlackApprovalReceiptJobPayloadSchema,
  TelegramApprovalReceiptJobPayloadSchema
]);

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
  GitHubIssueIntakeJobPayloadSchema,
  ApprovalFollowUpJobPayloadSchema,
  ApprovalNotificationJobPayloadSchema,
  PrivacyOperationJobPayloadSchema,
  PublicShareViewJobPayloadSchema
]);

export const jobRecoveryStrategyValues = ["retry_job", "replay_job", "manual_review"] as const;
export const JobRecoveryStrategySchema = z.enum(jobRecoveryStrategyValues);

export const JobExecutionJournalEntrySchema = z
  .object({
    at: z.string().datetime(),
    state: JobStatusSchema,
    attempt: z.number().int().min(0).max(25),
    summary: z.string().min(1).max(280),
    error: z.string().max(1000).nullable().default(null),
    metadata: z.record(z.string(), z.unknown()).default({})
  })
  .strict();

export const JobRecoveryStateSchema = z
  .object({
    strategy: JobRecoveryStrategySchema,
    note: z.string().min(1).max(400),
    operatorActionLabel: z.string().min(1).max(120).nullable().default(null),
    statusUrl: z.string().min(1).max(400).nullable().default(null),
    replayedFromJobId: z.string().min(1).max(200).nullable().default(null),
    compensationHints: z.array(z.string().min(1).max(200)).max(10).default([])
  })
  .strict();

export const JobExecutionJournalSchema = z
  .object({
    lifecycleState: JobStatusSchema,
    idempotencyKey: z.string().min(1).max(200).nullable().default(null),
    sideEffectTarget: z.string().min(1).max(200).nullable().default(null),
    providerRef: z.string().min(1).max(200).nullable().default(null),
    replayedFromJobId: z.string().min(1).max(200).nullable().default(null),
    retryCount: z.number().int().min(0).max(25).default(0),
    entries: z.array(JobExecutionJournalEntrySchema).max(25).default([]),
    recovery: JobRecoveryStateSchema.nullable().default(null),
    lastUpdatedAt: z.string().datetime()
  })
  .strict();

const MAX_JOB_EXECUTION_JOURNAL_ENTRIES = 25;

export function buildApprovalNotificationDeliveryTarget(
  payload: ApprovalNotificationJobPayload
): string {
  switch (payload.channel) {
    case "slack":
      return `approval-notification:${payload.approvalId}:slack`;
    case "slack_receipt":
      return `approval-notification:${payload.approvalId}:slack_receipt:${payload.slackChannelId}:${payload.slackMessageTs}`;
    case "telegram_receipt":
      return `approval-notification:${payload.approvalId}:telegram_receipt:${payload.telegramChatId}:${payload.telegramMessageId}`;
  }
}

function deriveJobExecutionSideEffectTarget(payload: JobPayload): string | null {
  if (payload.type === "approval_follow_up") {
    return `goal:${payload.goalId}:task:${payload.taskId}`;
  }

  if (payload.type === "approval_notification") {
    return buildApprovalNotificationDeliveryTarget(payload);
  }

  if (payload.type === "autopilot_process") {
    return `autopilot-event:${payload.autopilotEventId}`;
  }

  if (payload.type === "github_issue_intake") {
    return `github-issue:${payload.repository.fullName.toLowerCase()}#${payload.issue.number}`;
  }

  if ("goalId" in payload && typeof payload.goalId === "string" && payload.goalId.trim()) {
    return `goal:${payload.goalId}`;
  }

  if (payload.type === "privacy_operation") {
    return `privacy:${payload.operationId}`;
  }

  if (payload.type === "public_share_view") {
    return `share:${payload.shareId}`;
  }

  return null;
}

function deriveReplayedFromJobId(payload: JobPayload): string | null {
  const candidate =
    payload.metadata && typeof payload.metadata.replayedFromJobId === "string"
      ? payload.metadata.replayedFromJobId.trim()
      : "";
  return candidate || null;
}

function summarizeJobExecutionState(params: {
  status: JobStatus;
  attemptCount: number;
  maxAttempts: number;
  claimedBy?: string | null;
  replayedFromJobId?: string | null;
}): string {
  switch (params.status) {
    case "queued":
      return params.replayedFromJobId
        ? `Replay queued from job ${params.replayedFromJobId}.`
        : "Job queued for worker execution.";
    case "running":
      return `Attempt ${params.attemptCount} claimed by ${params.claimedBy ?? "worker"}.`;
    case "retrying":
      return `Attempt ${params.attemptCount} failed and retry ${params.attemptCount + 1} was scheduled.`;
    case "completed":
      return `Job completed successfully on attempt ${params.attemptCount}.`;
    case "dead_letter":
      return `Job dead-lettered after ${params.attemptCount}/${params.maxAttempts} attempts.`;
  }
}

export function deriveJobRecoveryState(params: {
  jobId: string;
  status: JobStatus;
  payload: JobPayload;
  replayedFromJobId?: string | null;
}): JobRecoveryState | null {
  const replayedFromJobId = params.replayedFromJobId ?? deriveReplayedFromJobId(params.payload);

  if (params.status === "retrying") {
    const statusUrl =
      params.payload.type === "approval_follow_up"
        ? `/api/approvals/jobs/${params.jobId}`
        : params.payload.type === "approval_notification" ||
            params.payload.type === "autopilot_process" ||
            params.payload.type === "github_issue_intake"
          ? `/api/jobs/${params.jobId}`
          : null;
    return JobRecoveryStateSchema.parse({
      strategy: "retry_job",
      note: "Worker retry is already queued with the same idempotency reference.",
      operatorActionLabel: null,
      statusUrl,
      replayedFromJobId,
      compensationHints: []
    });
  }

  if (params.status === "dead_letter" && params.payload.type === "approval_follow_up") {
    return JobRecoveryStateSchema.parse({
      strategy: "replay_job",
      note: "Replay the approval follow-up job to recover the queued side effect without manual state edits.",
      operatorActionLabel: "Replay job",
      statusUrl: `/api/approvals/jobs/${params.jobId}`,
      replayedFromJobId,
      compensationHints: [`Inspect approval ${params.payload.approvalId}`, `Review task ${params.payload.taskId}`]
    });
  }

  if (params.status === "dead_letter" && params.payload.type === "autopilot_process") {
    return JobRecoveryStateSchema.parse({
      strategy: "replay_job",
      note: "Replay the autopilot event job to reprocess the failed trigger without recreating the source event.",
      operatorActionLabel: "Replay event",
      statusUrl: `/api/jobs/${params.jobId}`,
      replayedFromJobId,
      compensationHints: [`Inspect autopilot event ${params.payload.autopilotEventId}`]
    });
  }

  if (params.status === "dead_letter" && params.payload.type === "github_issue_intake") {
    return JobRecoveryStateSchema.parse({
      strategy: "replay_job",
      note: "Replay the GitHub issue intake job to rebuild the governed Agentic work item without reopening the GitHub issue.",
      operatorActionLabel: "Replay issue intake",
      statusUrl: `/api/jobs/${params.jobId}`,
      replayedFromJobId,
      compensationHints: [
        `Inspect ${params.payload.repository.fullName}#${params.payload.issue.number}`,
        "Verify the issue is still open before replaying"
      ]
    });
  }

  if (params.status === "dead_letter" && params.payload.type === "approval_notification") {
    return JobRecoveryStateSchema.parse({
      strategy: "replay_job",
      note: "Replay the approval notification job to retry connector delivery without repeating the governed task side effect.",
      operatorActionLabel: "Replay notification",
      statusUrl: `/api/jobs/${params.jobId}`,
      replayedFromJobId,
      compensationHints: [`Inspect approval ${params.payload.approvalId}`, `Review task ${params.payload.taskId}`]
    });
  }

  if (params.status === "dead_letter") {
    return JobRecoveryStateSchema.parse({
      strategy: "manual_review",
      note: "Inspect the worker error and workflow context before attempting manual recovery.",
      operatorActionLabel: null,
      statusUrl: null,
      replayedFromJobId,
      compensationHints: []
    });
  }

  return null;
}

export function createJobExecutionJournal(params: {
  at: string;
  status: JobStatus;
  attemptCount?: number;
  maxAttempts?: number;
  claimedBy?: string | null;
  idempotencyKey?: string | null;
  sideEffectTarget?: string | null;
  providerRef?: string | null;
  replayedFromJobId?: string | null;
  summary: string;
  error?: string | null;
  metadata?: Record<string, unknown>;
  recovery?: JobRecoveryState | null;
  retryCount?: number;
}): JobExecutionJournal {
  return JobExecutionJournalSchema.parse({
    lifecycleState: params.status,
    idempotencyKey: params.idempotencyKey?.trim() || null,
    sideEffectTarget: params.sideEffectTarget?.trim() || null,
    providerRef: params.providerRef?.trim() || null,
    replayedFromJobId: params.replayedFromJobId?.trim() || null,
    retryCount: params.retryCount ?? 0,
    entries: [
      JobExecutionJournalEntrySchema.parse({
        at: params.at,
        state: params.status,
        attempt: params.attemptCount ?? 0,
        summary: params.summary,
        error: params.error?.trim() || null,
        metadata: params.metadata ?? {}
      })
    ],
    recovery: params.recovery ?? null,
    lastUpdatedAt: params.at
  });
}

export function appendJobExecutionJournalEntry(params: {
  journal: JobExecutionJournal;
  at: string;
  status: JobStatus;
  attemptCount: number;
  summary: string;
  error?: string | null;
  metadata?: Record<string, unknown>;
  recovery?: JobRecoveryState | null;
  retryCount?: number;
  sideEffectTarget?: string | null;
  providerRef?: string | null;
  replayedFromJobId?: string | null;
  idempotencyKey?: string | null;
}): JobExecutionJournal {
  return JobExecutionJournalSchema.parse({
    ...params.journal,
    lifecycleState: params.status,
    idempotencyKey:
      params.idempotencyKey === undefined ? params.journal.idempotencyKey : params.idempotencyKey?.trim() || null,
    sideEffectTarget:
      params.sideEffectTarget === undefined ? params.journal.sideEffectTarget : params.sideEffectTarget?.trim() || null,
    providerRef: params.providerRef === undefined ? params.journal.providerRef : params.providerRef?.trim() || null,
    replayedFromJobId:
      params.replayedFromJobId === undefined
        ? params.journal.replayedFromJobId
        : params.replayedFromJobId?.trim() || null,
    retryCount: params.retryCount ?? params.journal.retryCount,
    entries: [
      ...params.journal.entries,
      JobExecutionJournalEntrySchema.parse({
        at: params.at,
        state: params.status,
        attempt: params.attemptCount,
        summary: params.summary,
        error: params.error?.trim() || null,
        metadata: params.metadata ?? {}
      })
    ].slice(-MAX_JOB_EXECUTION_JOURNAL_ENTRIES),
    recovery: params.recovery === undefined ? params.journal.recovery : params.recovery,
    lastUpdatedAt: params.at
  });
}

function buildDerivedJobExecutionJournal(record: {
  id: string;
  status: JobStatus;
  idempotencyKey?: string | null;
  payload: JobPayload;
  maxAttempts: number;
  attemptCount: number;
  claimedBy?: string | null;
  availableAt: string;
  completedAt?: string | null;
  deadLetteredAt?: string | null;
  claimedAt?: string | null;
  createdAt: string;
  lastError?: string | null;
}): JobExecutionJournal {
  const replayedFromJobId = deriveReplayedFromJobId(record.payload);
  const anchorAt =
    record.deadLetteredAt ??
    record.completedAt ??
    record.claimedAt ??
    record.availableAt ??
    record.createdAt;

  return createJobExecutionJournal({
    at: anchorAt,
    status: record.status,
    attemptCount: record.attemptCount,
    maxAttempts: record.maxAttempts,
    claimedBy: record.claimedBy ?? null,
    idempotencyKey: record.idempotencyKey ?? null,
    sideEffectTarget: deriveJobExecutionSideEffectTarget(record.payload),
    replayedFromJobId,
    summary: summarizeJobExecutionState({
      status: record.status,
      attemptCount: record.attemptCount,
      maxAttempts: record.maxAttempts,
      claimedBy: record.claimedBy ?? null,
      replayedFromJobId
    }),
    error: record.lastError ?? null,
    recovery: deriveJobRecoveryState({
      jobId: record.id,
      status: record.status,
      payload: record.payload,
      replayedFromJobId
    }),
    retryCount: record.status === "retrying" || record.status === "dead_letter" ? record.attemptCount : 0
  });
}

const JobRecordBaseSchema = z
  .object({
    id: z.string().min(1),
    userId: z.string().min(1),
    kind: JobKindSchema,
    status: JobStatusSchema,
    priority: JobPrioritySchema.default("normal"),
    queue: z.string().trim().min(1).max(80).default("default"),
    concurrencyKey: z.string().trim().min(1).max(160).nullable().default(null),
    timeoutMs: z.number().int().min(100).max(30 * 60_000).nullable().default(null),
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
    journal: JobExecutionJournalSchema.optional(),
    createdAt: z.string().datetime(),
    updatedAt: z.string().datetime()
  });

export const JobRecordSchema = JobRecordBaseSchema
  .transform((value) => ({
    ...value,
    journal:
      value.journal ??
      buildDerivedJobExecutionJournal({
        id: value.id,
        status: value.status,
        idempotencyKey: value.idempotencyKey,
        payload: value.payload,
        maxAttempts: value.maxAttempts,
        attemptCount: value.attemptCount,
        claimedBy: value.claimedBy,
        availableAt: value.availableAt,
        completedAt: value.completedAt,
        deadLetteredAt: value.deadLetteredAt,
        claimedAt: value.claimedAt,
        createdAt: value.createdAt,
        lastError: value.lastError
      })
  }))
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

    if (value.kind === "github_issue_intake" && value.payload.type !== "github_issue_intake") {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["payload", "type"],
        message: 'GitHub issue intake jobs must carry a "github_issue_intake" payload.'
      });
    }

    if (value.kind === "approval_follow_up" && value.payload.type !== "approval_follow_up") {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["payload", "type"],
        message: 'Approval follow-up jobs must carry an "approval_follow_up" payload.'
      });
    }

    if (value.kind === "approval_notification" && value.payload.type !== "approval_notification") {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["payload", "type"],
        message: 'Approval-notification jobs must carry an "approval_notification" payload.'
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

export const WorkflowDagRetryPolicySchema = z
  .object({
    maxAttempts: z.number().int().min(1).max(25).default(3),
    backoffMs: z.number().int().min(0).max(3_600_000).default(1_000)
  })
  .strict();

export const WorkflowDagPermissionGrantSchema = z
  .object({
    capabilities: z.array(CapabilitySchema).default([]),
    maxRiskClass: RiskClassSchema.default("R2")
  })
  .strict();

export const WorkflowDagCompensationSchema = z
  .object({
    actionIntent: ActionIntentSchema.nullable().default(null),
    required: z.boolean().default(false),
    note: z.string().min(1).max(500).nullable().default(null)
  })
  .strict();

export const WorkflowDagNodeSchema = z
  .object({
    id: z.string().trim().min(1).max(160),
    label: z.string().trim().min(1).max(240),
    actionIntent: ActionIntentSchema,
    dependsOn: z.array(z.string().trim().min(1).max(160)).default([]),
    permissionGrant: WorkflowDagPermissionGrantSchema,
    retryPolicy: WorkflowDagRetryPolicySchema.default({ maxAttempts: 3, backoffMs: 1_000 }),
    compensation: WorkflowDagCompensationSchema.default({ actionIntent: null, required: false, note: null })
  })
  .strict();

export const WorkflowDagEdgeSchema = z
  .object({
    from: z.string().trim().min(1).max(160),
    to: z.string().trim().min(1).max(160),
    condition: z.enum(["success", "failure", "always"]).default("success")
  })
  .strict()
  .refine((edge) => edge.from !== edge.to, {
    message: "Workflow DAG edges cannot target the same node they originate from.",
    path: ["to"]
  });

export const WorkflowDagSchema = z
  .object({
    id: z.string().trim().min(1).max(160),
    workflowId: z.string().trim().min(1).max(160),
    schemaVersion: z.literal("v1").default("v1"),
    nodes: z.array(WorkflowDagNodeSchema).min(1).max(250),
    edges: z.array(WorkflowDagEdgeSchema).max(1_000).default([]),
    createdAt: z.string().datetime(),
    updatedAt: z.string().datetime()
  })
  .strict()
  .superRefine((dag, context) => {
    const nodeIds = new Set<string>();

    for (const [index, node] of dag.nodes.entries()) {
      if (nodeIds.has(node.id)) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          message: `Duplicate workflow DAG node "${node.id}".`,
          path: ["nodes", index, "id"]
        });
      }

      nodeIds.add(node.id);
    }

    for (const [index, node] of dag.nodes.entries()) {
      for (const dependency of node.dependsOn) {
        if (!nodeIds.has(dependency)) {
          context.addIssue({
            code: z.ZodIssueCode.custom,
            message: `Workflow DAG node "${node.id}" depends on missing node "${dependency}".`,
            path: ["nodes", index, "dependsOn"]
          });
        }
      }
    }

    for (const [index, edge] of dag.edges.entries()) {
      if (!nodeIds.has(edge.from)) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          message: `Workflow DAG edge references missing source node "${edge.from}".`,
          path: ["edges", index, "from"]
        });
      }

      if (!nodeIds.has(edge.to)) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          message: `Workflow DAG edge references missing target node "${edge.to}".`,
          path: ["edges", index, "to"]
        });
      }
    }
  });

export const WorkflowDagNodeExecutionSchema = z
  .object({
    id: z.string().trim().min(1).max(160),
    instanceId: z.string().trim().min(1).max(160),
    nodeId: z.string().trim().min(1).max(160),
    status: WorkflowDagNodeStatusSchema.default("queued"),
    attemptCount: z.number().int().min(0).max(25).default(0),
    maxAttempts: z.number().int().min(1).max(25).default(3),
    runnerId: z.string().trim().min(1).max(120).nullable().default(null),
    lastError: z.string().max(1_000).nullable().default(null),
    startedAt: z.string().datetime().nullable().default(null),
    completedAt: z.string().datetime().nullable().default(null),
    updatedAt: z.string().datetime()
  })
  .strict();

export const WorkflowDagInstanceSchema = z
  .object({
    id: z.string().trim().min(1).max(160),
    dagId: z.string().trim().min(1).max(160),
    workflowId: z.string().trim().min(1).max(160),
    status: WorkflowDagStatusSchema.default("queued"),
    pausedAt: z.string().datetime().nullable().default(null),
    cancelledAt: z.string().datetime().nullable().default(null),
    cancelReason: z.string().max(500).nullable().default(null),
    nodeExecutions: z.array(WorkflowDagNodeExecutionSchema).default([]),
    auditLog: z.array(z.string().min(1).max(500)).default([]),
    createdAt: z.string().datetime(),
    updatedAt: z.string().datetime()
  })
  .strict();

export const watcherFrequencyValues = ["realtime", "5min", "15min", "hourly", "daily"] as const;
export const WatcherFrequencySchema = z.enum(watcherFrequencyValues);

export const WatcherScheduleLeaseSchema = z
  .object({
    ownerId: z.string().trim().min(1).max(120),
    acquiredAt: z.string().datetime(),
    expiresAt: z.string().datetime()
  })
  .strict();

export const WatcherScheduleSchema = z
  .object({
    enabled: z.boolean().default(true),
    dryRun: z.boolean().default(true),
    cursor: z.string().max(500).nullable().default(null),
    lastRunAt: z.string().datetime().nullable().default(null),
    nextRunAt: z.string().datetime().nullable().default(null),
    lease: WatcherScheduleLeaseSchema.nullable().default(null)
  })
  .strict();

export const WatcherDryRunResultSchema = z
  .object({
    evaluatedAt: z.string().datetime(),
    wouldTrigger: z.boolean(),
    reason: z.string().min(1).max(500),
    idempotencyKey: z.string().min(1).max(200).nullable().default(null),
    sideEffectsSuppressed: z.boolean().default(true)
  })
  .strict();

export const WatcherEscalationPolicySchema = z
  .object({
    notify: z.boolean().default(true),
    minSuppressionMs: z.number().int().min(0).max(86_400_000).default(15 * 60_000),
    maxTriggersPerHour: z.number().int().min(1).max(60).default(4)
  })
  .strict();

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
  schedule: WatcherScheduleSchema.default({
    enabled: true,
    dryRun: true,
    cursor: null,
    lastRunAt: null,
    nextRunAt: null,
    lease: null
  }),
  lastEvaluation: WatcherDryRunResultSchema.nullable().default(null),
  escalationPolicy: WatcherEscalationPolicySchema.default({
    notify: true,
    minSuppressionMs: 15 * 60_000,
    maxTriggersPerHour: 4
  }),
  actorContext: z.lazy(() => ActorContextSchema).nullable().default(null),
  responsibility: WorkflowResponsibilitySchema.optional(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime()
}).transform((watcher) => ({
  ...watcher,
  responsibility:
    watcher.responsibility ??
    deriveWatcherResponsibility({
      createdByUserId: watcher.actorContext?.subjectUserId ?? null,
      targetEntity: watcher.targetEntity
    })
}));

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

export const agentRunnerFailureCodeValues = [
  "validation_failure",
  "permission_denied",
  "dependency_failure",
  "timeout",
  "unsafe_output",
  "unsupported_agent"
] as const;
export const AgentRunnerFailureCodeSchema = z.enum(agentRunnerFailureCodeValues);

export const AgentRunnerPermissionsSchema = z
  .object({
    allowedCapabilities: z.array(CapabilitySchema).default([]),
    blockedCapabilities: z.array(CapabilitySchema).default([]),
    maxRiskClass: RiskClassSchema.default("R2"),
    sideEffectCapabilities: z.array(CapabilitySchema).default([])
  })
  .strict()
  .superRefine((value, context) => {
    const blocked = new Set(value.blockedCapabilities);

    for (const capability of value.allowedCapabilities) {
      if (blocked.has(capability)) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          message: `Capability "${capability}" cannot be both allowed and blocked.`,
          path: ["blockedCapabilities"]
        });
      }
    }

    for (const capability of value.sideEffectCapabilities) {
      if (!value.allowedCapabilities.includes(capability)) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          message: `Side-effect capability "${capability}" must also be explicitly allowed.`,
          path: ["sideEffectCapabilities"]
        });
      }
    }
  });

export const AgentRunnerTelemetrySchema = z
  .object({
    runnerId: z.string().min(1).max(120),
    executionId: z.string().min(1).max(160),
    traceId: z.string().min(1).max(160).nullable().default(null),
    startedAt: z.string().datetime()
  })
  .strict();

export const AgentRunnerInputSchema = z
  .object({
    task: TaskSchema,
    scenario: z.string().min(1).max(20_000),
    requestContext: z.string().min(1).max(20_000),
    agentDefinition: AgentDefinitionSchema.nullable().default(null),
    permissions: AgentRunnerPermissionsSchema,
    timeoutMs: z.number().int().min(100).max(300_000).default(30_000),
    telemetry: AgentRunnerTelemetrySchema
  })
  .strict();

export const AgentRunnerOutputSchema = z
  .object({
    result: AgentResultSchema,
    telemetry: AgentRunnerTelemetrySchema.extend({
      completedAt: z.string().datetime(),
      durationMs: z.number().int().min(0)
    })
  })
  .strict();

export const AgentRunnerContractSchema = z
  .object({
    id: z.string().min(1).max(120),
    version: z.string().regex(/^v\d+$/u, "Agent runner contract versions must use v<integer> format."),
    agentNames: z.array(AgentNameSchema).min(1),
    declaredCapabilities: z.array(CapabilitySchema).default([]),
    outputModes: z.array(AgentExecutionModeSchema).min(1),
    timeoutMs: z.number().int().min(100).max(300_000),
    telemetryEvents: z.array(z.enum(["agent.started", "agent.completed", "agent.failed"])).min(2),
    failureCodes: z.array(AgentRunnerFailureCodeSchema).min(1)
  })
  .strict();

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
export type AgentImplementationTier = z.infer<typeof AgentImplementationTierSchema>;
export type CommitmentStatus = z.infer<typeof CommitmentStatusSchema>;
export type CommitmentSourceKind = z.infer<typeof CommitmentSourceKindSchema>;
export type CommitmentUrgency = z.infer<typeof CommitmentUrgencySchema>;
export type BriefingType = z.infer<typeof BriefingTypeSchema>;
export type BriefingFocus = z.infer<typeof BriefingFocusSchema>;
export type AutopilotMode = z.infer<typeof AutopilotModeSchema>;
export type AutopilotEventKind = z.infer<typeof AutopilotEventKindSchema>;
export type AutopilotEventSeverity = z.infer<typeof AutopilotEventSeveritySchema>;
export type AutopilotEventPolicy = z.infer<typeof AutopilotEventPolicySchema>;
export type AutopilotEventOperatorRoute = z.infer<typeof AutopilotEventOperatorRouteSchema>;
export type AutopilotEventStatus = z.infer<typeof AutopilotEventStatusSchema>;
export type AutopilotEventFamily = z.infer<typeof AutopilotEventFamilySchema>;
export type AutopilotEventPriority = z.infer<typeof AutopilotEventPrioritySchema>;
export type AutopilotEventBudgetScope = z.infer<typeof AutopilotEventBudgetScopeSchema>;
export type AutopilotEventSuppressionOutcome = z.infer<typeof AutopilotEventSuppressionOutcomeSchema>;
export type JobKind = z.infer<typeof JobKindSchema>;
export type JobStatus = z.infer<typeof JobStatusSchema>;
export type EvidenceRecordSourceKind = z.infer<typeof EvidenceRecordSourceKindSchema>;
export type WorkspaceRole = z.infer<typeof WorkspaceRoleSchema>;
export type WorkspaceApprovalMode = z.infer<typeof WorkspaceApprovalModeSchema>;
export type WorkflowResponsibilityAssigneeKind = z.infer<typeof WorkflowResponsibilityAssigneeKindSchema>;
export type WorkflowResponsibilityStatus = z.infer<typeof WorkflowResponsibilityStatusSchema>;
export type WorkflowResponsibilityAuditEvent = z.infer<typeof WorkflowResponsibilityAuditEventSchema>;
export type AgentName = z.infer<typeof AgentNameSchema>;
export type ToolInvocation = z.infer<typeof ToolInvocationSchema>;
export type Artifact = z.infer<typeof ArtifactSchema>;
export type AgentResult = z.infer<typeof AgentResultSchema>;
export type SubAgentCoordinationStrategy = z.infer<typeof SubAgentCoordinationStrategySchema>;
export type SubAgentRole = z.infer<typeof SubAgentRoleSchema>;
export type SubAgentPlan = z.infer<typeof SubAgentPlanSchema>;
export type WorkflowState = z.infer<typeof WorkflowStateSchema>;
export type Goal = z.infer<typeof GoalSchema>;
export type Task = z.infer<typeof TaskSchema>;
export type WorkflowResponsibilityAssignee = z.infer<typeof WorkflowResponsibilityAssigneeSchema>;
export type WorkflowResponsibilityAudit = z.infer<typeof WorkflowResponsibilityAuditSchema>;
export type WorkflowResponsibility = z.infer<typeof WorkflowResponsibilitySchema>;
export type MemoryRecord = z.infer<typeof MemoryRecordSchema>;
export type AgentMemoryScope = z.infer<typeof AgentMemoryScopeSchema>;
export type ContextPacket = z.infer<typeof ContextPacketSchema>;
export type ContextPacketTransformation = z.infer<typeof ContextPacketTransformationSchema>;
export type ContextPacketUsage = z.infer<typeof ContextPacketUsageSchema>;
export type ExecutionProvenanceNodeType = z.infer<typeof ExecutionProvenanceNodeTypeSchema>;
export type ExecutionProvenanceEdgeType = z.infer<typeof ExecutionProvenanceEdgeTypeSchema>;
export type ExecutionProvenanceNode = z.infer<typeof ExecutionProvenanceNodeSchema>;
export type ExecutionProvenanceEdge = z.infer<typeof ExecutionProvenanceEdgeSchema>;
export type ExecutionProvenanceGraph = z.infer<typeof ExecutionProvenanceGraphSchema>;
export type PolicyDecision = z.infer<typeof PolicyDecisionSchema>;
export type GovernanceConformanceCheck = z.infer<typeof GovernanceConformanceCheckSchema>;
export type GovernanceConformanceReport = z.infer<typeof GovernanceConformanceReportSchema>;
export type PolicySimulationCheck = z.infer<typeof PolicySimulationCheckSchema>;
export type PolicyReplayValidation = z.infer<typeof PolicyReplayValidationSchema>;
export type PolicyDecisionTrace = z.infer<typeof PolicyDecisionTraceSchema>;
export type ApprovalPreviewChange = z.infer<typeof ApprovalPreviewChangeSchema>;
export type ApprovalImpact = z.infer<typeof ApprovalImpactSchema>;
export type ApprovalPreview = z.infer<typeof ApprovalPreviewSchema>;
export type SendMessageActionIntent = z.infer<typeof SendMessageActionIntentSchema>;
export type ScheduleEventActionIntent = z.infer<typeof ScheduleEventActionIntentSchema>;
export type CreateNoteActionIntent = z.infer<typeof CreateNoteActionIntentSchema>;
export type ManualReviewActionIntent = z.infer<typeof ManualReviewActionIntentSchema>;
export type UpdateRecordActionIntent = z.infer<typeof UpdateRecordActionIntentSchema>;
export type DeleteRecordActionIntent = z.infer<typeof DeleteRecordActionIntentSchema>;
export type MonitorSignalActionIntent = z.infer<typeof MonitorSignalActionIntentSchema>;
export type ActionIntent = z.infer<typeof ActionIntentSchema>;
export type ActionAdapterKey = z.infer<typeof ActionAdapterKeySchema>;
export type ActionExecutionOperation = z.infer<typeof ActionExecutionOperationSchema>;
export type ActionExecutionRecoveryStrategy = z.infer<typeof ActionExecutionRecoveryStrategySchema>;
export type ActionExecutionRecovery = z.infer<typeof ActionExecutionRecoverySchema>;
export type ActionExecutionPlan = z.infer<typeof ActionExecutionPlanSchema>;
export type ActionExecutionOutcomeStatus = z.infer<typeof ActionExecutionOutcomeStatusSchema>;
export type ActionExecutionOutcome = z.infer<typeof ActionExecutionOutcomeSchema>;
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
export type DashboardNextBestActionKind = z.infer<typeof DashboardNextBestActionKindSchema>;
export type DashboardTeamWorkflowMode = z.infer<typeof DashboardTeamWorkflowModeSchema>;
export type DashboardTeamWorkflowAssignmentKey = z.infer<typeof DashboardTeamWorkflowAssignmentKeySchema>;
export type DashboardTeamWorkflowQueueKey = z.infer<typeof DashboardTeamWorkflowQueueKeySchema>;
export type DashboardTeamWorkflowControlKey = z.infer<typeof DashboardTeamWorkflowControlKeySchema>;
export type DashboardOperatingSection = z.infer<typeof DashboardOperatingSectionSchema>;
export type DashboardRoleView = z.infer<typeof DashboardRoleViewSchema>;
export type DashboardNextBestAction = z.infer<typeof DashboardNextBestActionSchema>;
export type DashboardPermission = z.infer<typeof DashboardPermissionSchema>;
export type DashboardTeamWorkflowAssignment = z.infer<typeof DashboardTeamWorkflowAssignmentSchema>;
export type DashboardTeamWorkflowQueue = z.infer<typeof DashboardTeamWorkflowQueueSchema>;
export type DashboardTeamWorkflowControl = z.infer<typeof DashboardTeamWorkflowControlSchema>;
export type DashboardTeamWorkflowAuditCoverage = z.infer<typeof DashboardTeamWorkflowAuditCoverageSchema>;
export type DashboardTeamWorkflow = z.infer<typeof DashboardTeamWorkflowSchema>;
export type DashboardOperatingSections = z.infer<typeof DashboardOperatingSectionsSchema>;
export type Workspace = z.infer<typeof WorkspaceSchema>;
export type WorkspaceMember = z.infer<typeof WorkspaceMemberSchema>;
export type WorkspaceSelection = z.infer<typeof WorkspaceSelectionSchema>;
export type AutonomyBudgetDecisionInput = z.infer<typeof AutonomyBudgetDecisionInputSchema>;
export type AutonomyBudgetShadowReplay = z.infer<typeof AutonomyBudgetShadowReplaySchema>;
export type AutonomyBudget = z.infer<typeof AutonomyBudgetSchema>;
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
export type AutopilotEventEnvelope = z.infer<typeof AutopilotEventEnvelopeSchema>;
export type AutopilotEventBudget = z.infer<typeof AutopilotEventBudgetSchema>;
export type AutopilotEventSuppression = z.infer<typeof AutopilotEventSuppressionSchema>;
export type AutopilotEventDetails = z.infer<typeof AutopilotEventDetailsSchema>;
export type AutopilotEvent = z.infer<typeof AutopilotEventSchema>;
export type AutopilotEventFabricReference = z.infer<typeof AutopilotEventFabricReferenceSchema>;
export type AutopilotEventFabricEnvelope = z.infer<typeof AutopilotEventFabricEnvelopeSchema>;
export type GoalCreateJobPayload = z.infer<typeof GoalCreateJobPayloadSchema>;
export type GoalRefineJobPayload = z.infer<typeof GoalRefineJobPayloadSchema>;
export type RecommendationRefinementSource = z.infer<typeof RecommendationRefinementSourceSchema>;
export type RecommendationEditDistance = z.infer<typeof RecommendationEditDistanceSchema>;
export type BriefingCreateJobPayload = z.infer<typeof BriefingCreateJobPayloadSchema>;
export type TemplateRunJobPayload = z.infer<typeof TemplateRunJobPayloadSchema>;
export type DocsRenderJobPayload = z.infer<typeof DocsRenderJobPayloadSchema>;
export type AutopilotProcessJobPayload = z.infer<typeof AutopilotProcessJobPayloadSchema>;
export type GitHubIssueIntakeJobPayload = z.infer<typeof GitHubIssueIntakeJobPayloadSchema>;
export type ApprovalFollowUpJobPayload = z.infer<typeof ApprovalFollowUpJobPayloadSchema>;
export type ApprovalNotificationJobPayload = z.infer<typeof ApprovalNotificationJobPayloadSchema>;
export type PrivacyOperationJobPayload = z.infer<typeof PrivacyOperationJobPayloadSchema>;
export type PublicShareViewJobPayload = z.infer<typeof PublicShareViewJobPayloadSchema>;
export type JobPayload = z.infer<typeof JobPayloadSchema>;
export type JobExecutionJournalEntry = z.infer<typeof JobExecutionJournalEntrySchema>;
export type JobRecoveryStrategy = z.infer<typeof JobRecoveryStrategySchema>;
export type JobRecoveryState = z.infer<typeof JobRecoveryStateSchema>;
export type JobExecutionJournal = z.infer<typeof JobExecutionJournalSchema>;
export type JobRecord = z.infer<typeof JobRecordSchema>;
export type JobPriority = z.infer<typeof JobPrioritySchema>;
export type WorkflowDag = z.infer<typeof WorkflowDagSchema>;
export type WorkflowDagNode = z.infer<typeof WorkflowDagNodeSchema>;
export type WorkflowDagInstance = z.infer<typeof WorkflowDagInstanceSchema>;
export type WorkflowDagNodeExecution = z.infer<typeof WorkflowDagNodeExecutionSchema>;
export type WorkflowDagStatus = z.infer<typeof WorkflowDagStatusSchema>;
export type WorkflowDagNodeStatus = z.infer<typeof WorkflowDagNodeStatusSchema>;
export type WatcherFrequency = z.infer<typeof WatcherFrequencySchema>;
export type WatcherSchedule = z.infer<typeof WatcherScheduleSchema>;
export type WatcherDryRunResult = z.infer<typeof WatcherDryRunResultSchema>;
export type WatcherEscalationPolicy = z.infer<typeof WatcherEscalationPolicySchema>;
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
export type AgentRunnerFailureCode = z.infer<typeof AgentRunnerFailureCodeSchema>;
export type AgentRunnerPermissions = z.infer<typeof AgentRunnerPermissionsSchema>;
export type AgentRunnerTelemetry = z.infer<typeof AgentRunnerTelemetrySchema>;
export type AgentRunnerInput = z.infer<typeof AgentRunnerInputSchema>;
export type AgentRunnerOutput = z.infer<typeof AgentRunnerOutputSchema>;
export type AgentRunnerContract = z.infer<typeof AgentRunnerContractSchema>;
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

export function deriveAgentImplementationTier(executionMode: AgentExecutionMode): AgentImplementationTier {
  switch (executionMode) {
    case "governed_specialist":
      return "production";
    case "deterministic_scaffold":
    case "custom_prompt_scaffold":
    case "manual_review_required":
      return "experimental";
  }
}

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
