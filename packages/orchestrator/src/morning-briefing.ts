import {
  GoalBundleSchema,
  GoalSchema,
  TaskSchema,
  deriveTaskResponsibility,
  nowIso,
  type ActionLog,
  type ApprovalRequest,
  type BriefingPreferences,
  type BriefingType,
  type GoalBundle,
  type IntegrationAccount,
  type MemoryRecord,
  type AgentMetrics,
  type Capability,
  type RiskClass,
  type Task,
  type Watcher,
  type WorkspaceGovernance
} from "@agentic/contracts";
import { runAgent } from "@agentic/agents";
import { createTask, createWorkflowState, recomputeWorkflowStatuses } from "@agentic/execution";
import { buildWorkflowContextPack, summarizeWorkflowContextPack } from "@agentic/memory";
import { createActionLog } from "@agentic/observability";
import { buildPolicyDecisionTrace, riskFromCapabilities, simulateTaskPolicy, type PolicyReplayValidation } from "@agentic/policy";

type BriefingTask = {
  title: string;
  summary: string;
  assignedAgent: Task["assignedAgent"];
  capabilities: Task["toolCapabilities"];
  confidence: number;
};

type BriefingDefinition = {
  titlePrefix: string;
  requestBuilder: (dateLabel: string, focus: BriefingPreferences["focus"]) => string;
  explanationBuilder: (params: {
    focus: BriefingPreferences["focus"];
    memoryCount: number;
    readyIntegrations: number;
    pendingApprovals: number;
    activeWatchers: number;
  }) => string;
  tasks: BriefingTask[];
};

const briefingCatalog: Record<BriefingType, BriefingDefinition> = {
  startup: {
    titlePrefix: "Startup briefing",
    requestBuilder: (dateLabel, focus) =>
      `Generate a startup briefing for ${dateLabel} covering inbox, calendar, and pending items with a ${focus} focus.`,
    explanationBuilder: ({ focus, memoryCount, readyIntegrations, pendingApprovals, activeWatchers }) =>
      `Startup briefing with a ${focus} focus. Resolved ${memoryCount} memory records, ${readyIntegrations} enabled adapters, ${pendingApprovals} pending approvals, and ${activeWatchers} active watchers.`,
    tasks: [
      {
        title: "Inbox summary",
        summary: "Scan recent communications, surface urgent threads, and summarize key messages requiring attention.",
        assignedAgent: "communications",
        capabilities: ["read", "search"],
        confidence: 0.88
      },
      {
        title: "Calendar overview",
        summary: "Review today's schedule, highlight conflicts, and identify preparation needed for upcoming meetings.",
        assignedAgent: "calendar",
        capabilities: ["read", "search"],
        confidence: 0.85
      },
      {
        title: "Pending items review",
        summary: "Consolidate pending approvals, active watchers, and outstanding workflow items into a single status view.",
        assignedAgent: "workflow",
        capabilities: ["read", "monitor"],
        confidence: 0.82
      }
    ]
  },
  midday: {
    titlePrefix: "Midday drift check",
    requestBuilder: (dateLabel, focus) =>
      `Generate a midday drift check for ${dateLabel} covering schedule changes, blocked work, and urgent follow-ups with a ${focus} focus.`,
    explanationBuilder: ({ focus, memoryCount, readyIntegrations, pendingApprovals, activeWatchers }) =>
      `Midday drift check with a ${focus} focus. Reused ${memoryCount} memory records, ${readyIntegrations} enabled adapters, ${pendingApprovals} pending approvals, and ${activeWatchers} active watchers.`,
    tasks: [
      {
        title: "Schedule drift review",
        summary: "Inspect changes since the start of the day and highlight new conflicts or compressed windows.",
        assignedAgent: "calendar",
        capabilities: ["read", "search"],
        confidence: 0.84
      },
      {
        title: "Blocked workflow scan",
        summary: "Review active workflows for waiting, blocked, or overdue tasks that now need intervention.",
        assignedAgent: "workflow",
        capabilities: ["read", "monitor"],
        confidence: 0.83
      },
      {
        title: "Urgent follow-up summary",
        summary: "Surface communication or operational items that should be handled before the day loses momentum.",
        assignedAgent: "communications",
        capabilities: ["read", "search", "draft"],
        confidence: 0.8
      }
    ]
  },
  pre_meeting: {
    titlePrefix: "Pre-meeting prep",
    requestBuilder: (dateLabel, focus) =>
      `Generate a pre-meeting prep briefing for ${dateLabel} covering upcoming meetings, context, and unresolved decisions with a ${focus} focus.`,
    explanationBuilder: ({ focus, memoryCount, readyIntegrations, pendingApprovals, activeWatchers }) =>
      `Pre-meeting prep with a ${focus} focus. Resolved ${memoryCount} memory records, ${readyIntegrations} enabled adapters, ${pendingApprovals} pending approvals, and ${activeWatchers} active watchers.`,
    tasks: [
      {
        title: "Upcoming meeting scan",
        summary: "Identify imminent meetings, required preparation, and likely collision risks.",
        assignedAgent: "calendar",
        capabilities: ["read", "search"],
        confidence: 0.86
      },
      {
        title: "Context pack retrieval",
        summary: "Pull supporting notes, preferences, and recent artifacts that will improve meeting readiness.",
        assignedAgent: "knowledge",
        capabilities: ["read", "search"],
        confidence: 0.84
      },
      {
        title: "Decision and follow-up brief",
        summary: "Summarize pending approvals and workflow decisions that may affect upcoming conversations.",
        assignedAgent: "workflow",
        capabilities: ["read", "monitor"],
        confidence: 0.81
      }
    ]
  },
  end_of_day: {
    titlePrefix: "End-of-day closure",
    requestBuilder: (dateLabel, focus) =>
      `Generate an end-of-day closure briefing for ${dateLabel} covering completed work, unresolved risks, and handoff-ready notes with a ${focus} focus.`,
    explanationBuilder: ({ focus, memoryCount, readyIntegrations, pendingApprovals, activeWatchers }) =>
      `End-of-day closure with a ${focus} focus. Reused ${memoryCount} memory records, ${readyIntegrations} enabled adapters, ${pendingApprovals} pending approvals, and ${activeWatchers} active watchers.`,
    tasks: [
      {
        title: "Completed work recap",
        summary: "Summarize what moved today and which outcomes are now safe to consider closed.",
        assignedAgent: "workflow",
        capabilities: ["read", "search"],
        confidence: 0.82
      },
      {
        title: "Open risk and approval review",
        summary: "Identify unresolved approvals, blocked tasks, and reliability issues that should not roll over silently.",
        assignedAgent: "workflow",
        capabilities: ["read", "monitor"],
        confidence: 0.85
      },
      {
        title: "Handoff-ready note draft",
        summary: "Prepare a compact closure note that captures the state another operator would need tomorrow.",
        assignedAgent: "communications",
        capabilities: ["read", "draft"],
        confidence: 0.79
      }
    ]
  },
  next_day: {
    titlePrefix: "Next-day setup",
    requestBuilder: (dateLabel, focus) =>
      `Generate a next-day setup briefing for ${dateLabel} covering priorities, prep work, and timing risks for tomorrow with a ${focus} focus.`,
    explanationBuilder: ({ focus, memoryCount, readyIntegrations, pendingApprovals, activeWatchers }) =>
      `Next-day setup with a ${focus} focus. Reused ${memoryCount} memory records, ${readyIntegrations} enabled adapters, ${pendingApprovals} pending approvals, and ${activeWatchers} active watchers.`,
    tasks: [
      {
        title: "Tomorrow priority lineup",
        summary: "Assemble the next operating sequence from current commitments, approvals, and active workflows.",
        assignedAgent: "workflow",
        capabilities: ["read", "search"],
        confidence: 0.84
      },
      {
        title: "Calendar prep for tomorrow",
        summary: "Review upcoming schedule pressure and identify preparation gaps before the next workday starts.",
        assignedAgent: "calendar",
        capabilities: ["read", "search"],
        confidence: 0.83
      },
      {
        title: "Context carry-forward",
        summary: "Surface memories and artifacts that should explicitly carry forward into tomorrow's execution context.",
        assignedAgent: "knowledge",
        capabilities: ["read", "search", "draft"],
        confidence: 0.8
      }
    ]
  }
};

function formatBriefingDate(timezone: string): string {
  try {
    return new Intl.DateTimeFormat("en-CA", {
      timeZone: timezone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit"
    }).format(new Date());
  } catch {
    return new Date().toISOString().slice(0, 10);
  }
}

function defaultFocus(preferences?: Pick<BriefingPreferences, "focus">): BriefingPreferences["focus"] {
  return preferences?.focus ?? "balanced";
}

function defaultTimezone(preferences?: Pick<BriefingPreferences, "timezone">): string {
  return preferences?.timezone ?? process.env.AGENTIC_DEFAULT_TIMEZONE ?? process.env.TZ ?? "UTC";
}

export async function generateBriefing(params: {
  type: BriefingType;
  userId: string;
  workspaceId?: string | null;
  governance?: WorkspaceGovernance | null;
  memories: MemoryRecord[];
  integrations: IntegrationAccount[];
  pendingApprovals: ApprovalRequest[];
  activeWatchers: Watcher[];
  preferences?: Pick<BriefingPreferences, "focus" | "timezone">;
  goalId?: string;
  workflowId?: string;
  resolveAgentMetrics?: (agentIdOrName: string) => Promise<AgentMetrics | null>;
  resolvePolicyReplayValidation?: (params: {
    agent: Task["assignedAgent"];
    capabilities: Capability[];
    riskClass: RiskClass;
    title: string;
  }) => Promise<PolicyReplayValidation | null>;
}): Promise<GoalBundle> {
  const definition = briefingCatalog[params.type];
  const dateLabel = formatBriefingDate(defaultTimezone(params.preferences));
  const focus = defaultFocus(params.preferences);
  const goalId = params.goalId ?? crypto.randomUUID();
  const workspaceId = params.workspaceId ?? null;
  const workflow = createWorkflowState(goalId, `briefing:${params.type}`, workspaceId, params.workflowId);
  const createdAt = nowIso();
  const logs: ActionLog[] = [];
  const tasks: Task[] = [];
  const approvals: ApprovalRequest[] = [];
  const artifacts = [];
  const scenarioTitle = `${definition.titlePrefix} for ${dateLabel}`;
  const readyIntegrations = params.integrations.filter((integration) => integration.status !== "disabled").length;
  const contextPack = buildWorkflowContextPack({
    kind: "briefing",
    query: `${params.type} briefing ${focus}`,
    records: params.memories,
    agent: "orchestrator"
  });
  const contextReviewSuffix =
    contextPack.reviewRequiredMemoryIds.length > 0
      ? ` ${contextPack.reviewRequiredMemoryIds.length} context signal${contextPack.reviewRequiredMemoryIds.length === 1 ? "" : "s"} still need review.`
      : "";

  const goal = GoalSchema.parse({
    id: goalId,
    userId: params.userId,
    workspaceId,
    workflowId: workflow.id,
    title: scenarioTitle,
    request: definition.requestBuilder(dateLabel, focus),
    intent: `briefing:${params.type}`,
    status: "planned",
    confidence: 0.86,
    explanation:
      definition.explanationBuilder({
        focus,
        memoryCount: contextPack.selectedMemories.length,
        readyIntegrations,
        pendingApprovals: params.pendingApprovals.length,
        activeWatchers: params.activeWatchers.length
      }) + contextReviewSuffix,
    createdAt,
    updatedAt: createdAt
  });

  logs.push(
    createActionLog({
      goalId: goal.id,
      workflowId: workflow.id,
      actor: "orchestrator",
      kind: "goal.created",
      message: `Created ${params.type} briefing goal "${goal.title}".`,
      details: {
        intent: goal.intent,
        status: goal.status,
        briefingType: params.type,
        workspaceId,
        briefingFocus: focus,
        pendingApprovals: params.pendingApprovals.length,
        activeWatchers: params.activeWatchers.length
      }
    })
  );

  logs.push(
    createActionLog({
      goalId,
      workflowId: workflow.id,
      actor: "orchestrator",
      kind: "context.resolved",
      message: `Resolved context for the ${params.type} briefing.`,
      details: {
        briefingType: params.type,
        briefingFocus: focus,
        memoryCount: params.memories.length,
        resolvedMemoryCount: contextPack.selectedMemories.length,
        resolvedMemoryIds: contextPack.selectedMemoryIds,
        contextPack: summarizeWorkflowContextPack(contextPack),
        integrationCount: params.integrations.length,
        pendingApprovalCount: params.pendingApprovals.length,
        activeWatcherCount: params.activeWatchers.length
      }
    })
  );

  for (const planned of definition.tasks) {
    const policyRiskClass = riskFromCapabilities(planned.capabilities);
    const scorecard = await params.resolveAgentMetrics?.(planned.assignedAgent);
    const learningValidation = await params.resolvePolicyReplayValidation?.({
      agent: planned.assignedAgent,
      capabilities: planned.capabilities,
      riskClass: policyRiskClass,
      title: planned.title
    });
    const policyResult = simulateTaskPolicy({
      capabilities: planned.capabilities,
      confidence: planned.confidence,
      title: planned.title,
      memories: params.memories,
      scorecard,
      governance: params.governance,
      learningValidation
    });
    const decision = policyResult.decision;

    const state = decision.outcome === "blocked" ? "blocked" : decision.requiresApproval ? "waiting" : "completed";
    const task = createTask({
      goalId,
      workflowId: workflow.id,
      title: planned.title,
      summary: planned.summary,
      assignedAgent: planned.assignedAgent,
      riskClass: decision.riskClass,
      requiresApproval: decision.requiresApproval,
      toolCapabilities: planned.capabilities,
      responsibility: deriveTaskResponsibility({
        assignedAgent: planned.assignedAgent,
        requiresApproval: decision.requiresApproval,
        ownerUserId: params.userId,
        workspaceId: params.workspaceId
      }),
      state
    });

    const agentResult = await runAgent(task, scenarioTitle);
    const nextTask = TaskSchema.parse({
      ...task,
      artifactIds: agentResult.artifacts.map((artifact) => artifact.id)
    });

    tasks.push(nextTask);
    artifacts.push(...agentResult.artifacts);

    logs.push(
      createActionLog({
        goalId,
        taskId: nextTask.id,
        workflowId: workflow.id,
        actor: "workflow",
        kind: "task.created",
        message: `Created task "${nextTask.title}" in state "${nextTask.state}".`,
        details: {
          briefingType: params.type,
          assignedAgent: nextTask.assignedAgent,
          state: nextTask.state,
          requiresApproval: nextTask.requiresApproval
        }
      })
    );

    logs.push(
      createActionLog({
        goalId,
        taskId: nextTask.id,
        workflowId: workflow.id,
        actor: "policy",
        kind: "policy.evaluated",
        message: `Evaluated policy for "${nextTask.title}".`,
        details: {
          ...decision,
          policyTrace: buildPolicyDecisionTrace(policyResult),
          briefingType: params.type
        }
      })
    );

    logs.push(
      createActionLog({
        goalId,
        taskId: nextTask.id,
        workflowId: workflow.id,
        actor: nextTask.assignedAgent,
        kind: "agent.completed",
        message: agentResult.summary,
        details: {
          briefingType: params.type,
          confidence: agentResult.confidence,
          executionMode: agentResult.executionMode,
          implementationTier: agentResult.implementationTier,
          nextSteps: agentResult.nextSteps
        }
      })
    );
  }

  const statuses = recomputeWorkflowStatuses(tasks, approvals, []);

  return GoalBundleSchema.parse({
    goal: {
      ...goal,
      status: statuses.goalStatus,
      updatedAt: nowIso()
    },
    workflow: {
      ...workflow,
      status: statuses.workflowStatus,
      checkpoint: "done",
      updatedAt: nowIso()
    },
    tasks,
    artifacts,
    approvals,
    watchers: [],
    actionLogs: logs
  });
}

export async function generateMorningBriefing(params: {
  userId: string;
  workspaceId?: string | null;
  governance?: WorkspaceGovernance | null;
  memories: MemoryRecord[];
  integrations: IntegrationAccount[];
  pendingApprovals: ApprovalRequest[];
  activeWatchers: Watcher[];
  preferences?: Pick<BriefingPreferences, "focus" | "timezone">;
}): Promise<GoalBundle> {
  return generateBriefing({
    ...params,
    type: "startup"
  });
}
