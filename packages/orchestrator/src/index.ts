import {
  APPROVAL_EXPIRY_MS,
  ActionLogSchema,
  ActionIntentSchema,
  createSystemResponsibilityAssignee,
  createUserResponsibilityAssignee,
  type ActorContext,
  type ApprovalDecisionRecord,
  type ApprovalDecisionScope,
  type ApprovalPreview,
  ApprovalRequestSchema,
  deriveApprovalResponsibility,
  deriveTaskResponsibility,
  GoalBundleSchema,
  GoalSchema,
  TaskSchema,
  WorkflowStateSchema,
  WatcherSchema,
  nowIso,
  type ActionLog,
  type ActionIntent,
  type AgentDefinition,
  type AgentMetrics,
  type ApprovalDecision,
  type ApprovalRequest,
  type Artifact,
  type Capability,
  type Goal,
  type GoalBundle,
  type IntegrationAccount,
  type MemoryRecord,
  type RiskClass,
  type Task,
  type Watcher,
  type WorkspaceGovernance
} from "@agentic/contracts";
import { runAgent } from "@agentic/agents";
import { createTask, createWorkflowState, recomputeWorkflowStatuses, transitionTaskState } from "@agentic/execution";
import { inferCapabilitiesFromRequest, planActionExecution } from "@agentic/integrations";
import { buildWorkflowContextPack, summarizeWorkflowContextPack } from "@agentic/memory";
import { createActionLog } from "@agentic/observability";
import {
  buildPolicyDecisionTrace,
  detectAgentPoisoningAttempt,
  riskFromCapabilities,
  simulateTaskPolicy,
  type PolicyReplayValidation
} from "@agentic/policy";
import Anthropic from "@anthropic-ai/sdk";
import OpenAI from "openai";

export { captureExecutionOutcomeSignals, captureMemoriesFromBundle, type CapturedMemories } from "./memory-capture";
export { executeApprovedTask, executeApprovedTasks, reconcileExecutionResults, type ExecutionResult } from "./execution-dispatch";
export { generateBriefing, generateMorningBriefing } from "./morning-briefing";
export { refineGoal } from "./goal-refinement";
export { createGoalTemplate, interpolateTemplate, computeNextRun, shouldTemplateRun } from "./goal-templates";

export type ScenarioKey = "inbox-triage" | "weekly-planning" | "travel-preparation" | "general-coordination";

type PlannedTask = {
  title: string;
  summary: string;
  assignedAgent: Task["assignedAgent"];
  capabilities: Task["toolCapabilities"];
  confidence: number;
};

const scenarioCatalog: Record<
  ScenarioKey,
  {
    title: string;
    intent: string;
    description: string;
    tasks: PlannedTask[];
    watcherFactory: (goalId: string) => Watcher[];
  }
> = {
  "inbox-triage": {
    title: "Inbox triage and follow-up prep",
    intent: "communications-triage",
    description: "Rank inbound communication, prepare drafts, and hold external sends behind explicit approval.",
    tasks: [
      {
        title: "Review priority messages",
        summary: "Inspect the inbox, identify urgent threads, and surface missing context.",
        assignedAgent: "communications",
        capabilities: ["read", "search"],
        confidence: 0.88
      },
      {
        title: "Prepare sender-aware drafts",
        summary: "Generate reply drafts and escalation notes while preserving a human approval gate before sending.",
        assignedAgent: "communications",
        capabilities: ["read", "draft", "send"],
        confidence: 0.79
      },
      {
        title: "Capture follow-up commitments",
        summary: "Convert promised actions into a lightweight workflow with internal reminders.",
        assignedAgent: "workflow",
        capabilities: ["create", "monitor"],
        confidence: 0.76
      }
    ],
    watcherFactory: (goalId) => [
      WatcherSchema.parse({
        id: crypto.randomUUID(),
        goalId,
        targetEntity: "priority-inbox",
        condition: "new urgent email or unanswered VIP thread",
        frequency: "hourly",
        triggerAction: "notify user and attach prior triage context",
        sourceSystems: ["email"],
        status: "active",
        expiryAt: null,
        createdAt: nowIso(),
        updatedAt: nowIso()
      })
    ]
  },
  "weekly-planning": {
    title: "Weekly planning and calendar shaping",
    intent: "weekly-planning",
    description: "Balance commitments, identify overload windows, and turn the week into a structured operating plan.",
    tasks: [
      {
        title: "Gather week commitments",
        summary: "Pull the current calendar, priorities, and deadlines into a single planning view.",
        assignedAgent: "calendar",
        capabilities: ["read", "search", "schedule"],
        confidence: 0.81
      },
      {
        title: "Draft the weekly operating plan",
        summary: "Translate commitments into focus blocks, risks, and scheduling recommendations.",
        assignedAgent: "workflow",
        capabilities: ["read", "draft", "create"],
        confidence: 0.83
      },
      {
        title: "Surface relevant standing context",
        summary: "Retrieve preferences, commitments, and routines that should influence the plan.",
        assignedAgent: "knowledge",
        capabilities: ["read", "search"],
        confidence: 0.86
      }
    ],
    watcherFactory: (goalId) => [
      WatcherSchema.parse({
        id: crypto.randomUUID(),
        goalId,
        targetEntity: "week-plan",
        condition: "new meeting creates focus-block collision",
        frequency: "hourly",
        triggerAction: "flag the collision and suggest alternative slots",
        sourceSystems: ["calendar", "tasks"],
        status: "active",
        expiryAt: null,
        createdAt: nowIso(),
        updatedAt: nowIso()
      })
    ]
  },
  "travel-preparation": {
    title: "Travel preparation and readiness tracking",
    intent: "travel-readiness",
    description: "Prepare the itinerary, checklist, and monitoring needed to keep travel execution reliable.",
    tasks: [
      {
        title: "Assemble travel brief",
        summary: "Research the itinerary, dependencies, and likely risk points for the trip.",
        assignedAgent: "research",
        capabilities: ["read", "search", "draft"],
        confidence: 0.78
      },
      {
        title: "Prepare the travel checklist",
        summary: "Convert travel readiness into a checklist with assumptions, evidence, and open questions.",
        assignedAgent: "knowledge",
        capabilities: ["read", "create", "monitor"],
        confidence: 0.8
      },
      {
        title: "Hold scheduling changes for review",
        summary: "Draft calendar adjustments or reminders without committing them until the user approves.",
        assignedAgent: "calendar",
        capabilities: ["read", "schedule"],
        confidence: 0.74
      }
    ],
    watcherFactory: (goalId) => [
      WatcherSchema.parse({
        id: crypto.randomUUID(),
        goalId,
        targetEntity: "trip-readiness",
        condition: "travel date approaches or a required booking is still missing",
        frequency: "hourly",
        triggerAction: "re-open the checklist and notify the user with the missing dependency",
        sourceSystems: ["calendar", "notes", "tasks"],
        status: "active",
        expiryAt: null,
        createdAt: nowIso(),
        updatedAt: nowIso()
      })
    ]
  },
  "general-coordination": {
    title: "General coordination request",
    intent: "general-coordination",
    description: "Turn a broad user request into a bounded workflow with clear reasoning and policy-aware action edges.",
    tasks: [
      {
        title: "Interpret the request",
        summary: "Break the request into goals, constraints, and likely execution domains.",
        assignedAgent: "workflow",
        capabilities: ["read", "search"],
        confidence: 0.72
      },
      {
        title: "Retrieve supporting context",
        summary: "Resolve memory and background context that may change the preferred execution path.",
        assignedAgent: "knowledge",
        capabilities: ["read", "search"],
        confidence: 0.75
      },
      {
        title: "Prepare the next-step draft",
        summary: "Write a safe draft plan before any outward action occurs.",
        assignedAgent: "workflow",
        capabilities: ["draft", "create"],
        confidence: 0.7
      }
    ],
    watcherFactory: () => []
  }
};

function detectScenarioRegex(request: string): ScenarioKey {
  const normalized = request.toLowerCase();

  if (/(inbox|email|reply|triage|messages?)/.test(normalized)) {
    return "inbox-triage";
  }

  if (/(week|weekly|calendar|focus block|schedule)/.test(normalized)) {
    return "weekly-planning";
  }

  if (/(travel|trip|flight|hotel|itinerary)/.test(normalized)) {
    return "travel-preparation";
  }

  return "general-coordination";
}

async function detectScenarioLlm(request: string): Promise<ScenarioKey> {
  const validScenarios: ScenarioKey[] = ["inbox-triage", "weekly-planning", "travel-preparation", "general-coordination"];
  const prompt = `Classify this user request into exactly one scenario. Reply with ONLY the scenario key, nothing else.

Scenarios:
- inbox-triage: Email management, message triage, drafting replies, communication follow-ups
- weekly-planning: Calendar review, week planning, scheduling, focus blocks, commitment management
- travel-preparation: Trip planning, flights, hotels, itineraries, travel checklists, packing
- general-coordination: Everything else — general tasks, research, administrative work, multi-domain requests

User request: "${request.slice(0, 500)}"

Scenario key:`;

  try {
    if (process.env.ANTHROPIC_API_KEY) {
      const client = new Anthropic();
      const response = await client.messages.create({
        model: process.env.ANTHROPIC_MODEL ?? "claude-opus-4-6",
        max_tokens: 20,
        messages: [{ role: "user", content: prompt }]
      });
      const text = response.content.find((b) => b.type === "text")?.text?.trim().toLowerCase() ?? "";
      const matched = validScenarios.find((s) => text.includes(s));
      if (matched) return matched;
    } else if (process.env.OPENAI_API_KEY) {
      const client = new OpenAI();
      const response = await client.chat.completions.create({
        model: process.env.OPENAI_MODEL ?? "gpt-5.4",
        max_tokens: 20,
        messages: [{ role: "user", content: prompt }]
      });
      const text = response.choices[0]?.message?.content?.trim().toLowerCase() ?? "";
      const matched = validScenarios.find((s) => text.includes(s));
      if (matched) return matched;
    }
  } catch {
    // Fall through to regex
  }

  return detectScenarioRegex(request);
}

async function detectScenario(request: string): Promise<ScenarioKey> {
  // Tests must stay deterministic and offline even when developer shells expose model credentials.
  if (process.env.NODE_ENV === "test") {
    return detectScenarioRegex(request);
  }

  if (process.env.ANTHROPIC_API_KEY || process.env.OPENAI_API_KEY) {
    return detectScenarioLlm(request);
  }
  return detectScenarioRegex(request);
}

function normalizeRequest(request: string): string {
  return request.trim().replace(/\s+/g, " ");
}

function explanationForGoal(params: {
  scenario: ScenarioKey;
  resolvedMemories: MemoryRecord[];
  conflictCount: number;
  reviewRequiredCount: number;
  integrations: IntegrationAccount[];
}): string {
  const catalog = scenarioCatalog[params.scenario];
  const readyIntegrations = params.integrations.filter((integration) => integration.status !== "disabled").length;
  const confirmedMemories = params.resolvedMemories.filter((memory) => memory.memoryType === "confirmed").length;
  const reviewSuffix =
    params.reviewRequiredCount > 0
      ? ` ${params.reviewRequiredCount} context signal${params.reviewRequiredCount === 1 ? "" : "s"} need review before wider automation.`
      : "";
  const conflictSuffix =
    params.conflictCount > 0
      ? ` ${params.conflictCount} conflicting context signal${params.conflictCount === 1 ? "" : "s"} were kept visible instead of silently discarded.`
      : "";

  return `${catalog.description} The orchestrator resolved ${confirmedMemories} confirmed relevant memories and ${readyIntegrations} enabled adapters before planning the workflow.${reviewSuffix}${conflictSuffix}`;
}

function inferApprovalActionType(task: Task): ApprovalPreview["actionType"] {
  if (task.toolCapabilities.includes("delete")) {
    return "delete";
  }

  if (task.toolCapabilities.includes("send")) {
    return "send";
  }

  if (task.toolCapabilities.includes("schedule")) {
    return "schedule";
  }

  if (task.toolCapabilities.includes("update")) {
    return "update";
  }

  if (task.toolCapabilities.includes("create")) {
    return "create";
  }

  if (task.toolCapabilities.includes("draft")) {
    return "draft";
  }

  return "artifact-only";
}

function inferActionIntentFromArtifacts(task: Task, artifacts: Artifact[]): ActionIntent {
  for (const artifact of artifacts) {
    const candidate = artifact.metadata.actionIntent ?? artifact.metadata.executionIntent;
    const parsed = ActionIntentSchema.safeParse(candidate);

    if (parsed.success) {
      return parsed.data;
    }
  }

  if (task.toolCapabilities.includes("create")) {
    return ActionIntentSchema.parse({
      type: "create_note",
      title: task.title,
      content: artifacts.map((artifact) => artifact.content).join("\n\n").trim() || task.summary
    });
  }

  return ActionIntentSchema.parse({
    type: "manual_review",
    actionType: inferApprovalActionType(task),
    summary: task.summary,
    reason: "No typed execution payload was produced for this approval. Manual review is required before any external side effect.",
    artifactIds: artifacts.map((artifact) => artifact.id)
  });
}

function buildApprovalPreview(task: Task, actionIntent: ActionIntent | null): ApprovalPreview {
  const resolvedActionIntent =
    actionIntent ??
    ActionIntentSchema.parse({
      type: "manual_review",
      actionType: inferApprovalActionType(task),
      summary: task.summary,
      reason: "No typed execution payload is available yet for this approval.",
      artifactIds: []
    });
  return planActionExecution({
    task,
    actionIntent: resolvedActionIntent
  }).preview;
}

export async function processUserRequest(params: {
  userId: string;
  workspaceId?: string | null;
  request: string;
  memories: MemoryRecord[];
  integrations: IntegrationAccount[];
  agentDefinition?: AgentDefinition;
  resolveAgentMetrics?: (agentIdOrName: string) => Promise<AgentMetrics | null>;
  resolvePolicyReplayValidation?: (params: {
    agent: Task["assignedAgent"];
    capabilities: Capability[];
    riskClass: RiskClass;
    title: string;
  }) => Promise<PolicyReplayValidation | null>;
  governance?: WorkspaceGovernance | null;
  goalId?: string;
  workflowId?: string;
}): Promise<GoalBundle> {
  const request = normalizeRequest(params.request);

  if (!request) {
    throw new Error("A non-empty request is required.");
  }

  if (request.length > 2_000) {
    throw new Error("The request exceeds the 2000 character safety limit.");
  }

  const poisoningAttempt = detectAgentPoisoningAttempt(request);
  if (poisoningAttempt) {
    throw new Error(
      `Request rejected by Agentic International Law: agent poisoning attempts (bribery, corruption, collusion, or intent override) are blocked. (${poisoningAttempt.matchedTerms.join(
        ", "
      )})`
    );
  }

  const contextPack = buildWorkflowContextPack({
    kind: "goal_planning",
    query: request,
    records: params.memories,
    agent: "orchestrator"
  });
  const relevantMemories = contextPack.selectedMemories;
  const scenario = await detectScenario(request);
  const catalog = scenarioCatalog[scenario];
  const goalId = params.goalId ?? crypto.randomUUID();
  const workspaceId = params.workspaceId ?? null;
  const workflow = createWorkflowState(goalId, scenario, workspaceId, params.workflowId);
  const createdAt = nowIso();
  const logs: ActionLog[] = [];
  const tasks: Task[] = [];
  const approvals: ApprovalRequest[] = [];
  const artifacts = [];
  const requestCapabilities = inferCapabilitiesFromRequest(request);
  const confidenceBias = Math.min(0.08, relevantMemories.length * 0.01);

  function appendLog(input: Parameters<typeof createActionLog>[0]): ActionLog {
    const entry = createActionLog({ ...input, prevLog: logs.at(-1) ?? null });
    logs.push(entry);
    return entry;
  }

  const goal = GoalSchema.parse({
    id: goalId,
    userId: params.userId,
    workspaceId,
    workflowId: workflow.id,
    title: catalog.title,
    request,
    intent: catalog.intent,
    status: "planned",
    confidence: Math.min(0.92, 0.72 + confidenceBias),
    explanation: explanationForGoal({
      scenario,
      resolvedMemories: relevantMemories,
      conflictCount: contextPack.conflicts.length,
      reviewRequiredCount: contextPack.reviewRequiredMemoryIds.length,
      integrations: params.integrations
    }),
    createdAt,
    updatedAt: createdAt
  });

  appendLog({
    goalId: goal.id,
    workflowId: workflow.id,
    actor: "orchestrator",
    kind: "goal.created",
    message: `Created goal "${goal.title}" from the user request.`,
    details: {
      intent: goal.intent,
      status: goal.status,
      workspaceId
    }
  });
  appendLog({
    goalId,
    workflowId: workflow.id,
    actor: "orchestrator",
    kind: "context.resolved",
    message: "Resolved memories and integration surfaces before planning.",
    details: {
      memoryCount: params.memories.length,
      resolvedMemoryCount: relevantMemories.length,
      resolvedMemoryIds: relevantMemories.map((memory) => memory.id),
      contextPack: summarizeWorkflowContextPack(contextPack),
      integrationCount: params.integrations.length,
      requestCapabilities
    }
  });

  for (const plannedTask of catalog.tasks) {
    const capabilities = Array.from(
      new Set([
        ...plannedTask.capabilities,
        ...requestCapabilities.filter((capability) => plannedTask.capabilities.includes(capability))
      ])
    );
    const policyRiskClass = riskFromCapabilities(capabilities);
    const scorecard = await params.resolveAgentMetrics?.(plannedTask.assignedAgent);
    const learningValidation = await params.resolvePolicyReplayValidation?.({
      agent: plannedTask.assignedAgent,
      capabilities,
      riskClass: policyRiskClass,
      title: plannedTask.title
    });
    const policyResult = simulateTaskPolicy({
      capabilities,
      confidence: plannedTask.confidence,
      title: plannedTask.title,
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
      title: plannedTask.title,
      summary: plannedTask.summary,
      assignedAgent: plannedTask.assignedAgent,
      riskClass: decision.riskClass,
      requiresApproval: decision.requiresApproval,
      toolCapabilities: capabilities,
      state,
      responsibility: deriveTaskResponsibility({
        assignedAgent: plannedTask.assignedAgent,
        requiresApproval: decision.requiresApproval,
        ownerUserId: params.userId,
        workspaceId
      })
    });
    const agentResult = await runAgent(task, catalog.title, {
      agentDefinition: params.agentDefinition,
      requestContext: request
    });
    const nextTask = TaskSchema.parse({
      ...task,
      artifactIds: agentResult.artifacts.map((artifact) => artifact.id)
    });
    const actionIntent = decision.requiresApproval ? inferActionIntentFromArtifacts(nextTask, agentResult.artifacts) : null;

    tasks.push(nextTask);
    artifacts.push(...agentResult.artifacts);
    appendLog({
      goalId,
      taskId: nextTask.id,
      workflowId: workflow.id,
      actor: "workflow",
      kind: "task.created",
      message: `Created task "${nextTask.title}" in state "${nextTask.state}".`,
      details: {
        assignedAgent: nextTask.assignedAgent,
        state: nextTask.state,
        requiresApproval: nextTask.requiresApproval
      }
    });
    appendLog({
      goalId,
      taskId: nextTask.id,
      workflowId: workflow.id,
      actor: "policy",
      kind: "policy.evaluated",
      message: `Evaluated policy for "${nextTask.title}".`,
      details: {
        ...decision,
        policyTrace: buildPolicyDecisionTrace(policyResult)
      }
    });
    appendLog({
      goalId,
      taskId: nextTask.id,
      workflowId: workflow.id,
      actor: nextTask.assignedAgent,
      kind: "agent.completed",
      message: agentResult.summary,
      details: {
        confidence: agentResult.confidence,
        executionMode: agentResult.executionMode,
        implementationTier: agentResult.implementationTier,
        nextSteps: agentResult.nextSteps
      }
    });

    if (decision.requiresApproval) {
      const approvalCreatedAt = nowIso();
      const approval = ApprovalRequestSchema.parse({
        id: crypto.randomUUID(),
        goalId,
        taskId: nextTask.id,
        title: `${nextTask.title} requires approval`,
        rationale: decision.rationale,
        riskClass: decision.riskClass,
        decision: "pending",
        requestedAction: nextTask.summary,
        actionIntent,
        preview: buildApprovalPreview(nextTask, actionIntent),
        responsibility: deriveApprovalResponsibility({
          ownerUserId: params.userId,
          workspaceId,
          delegateAgent: nextTask.assignedAgent
        }),
        createdAt: approvalCreatedAt,
        expiryAt: new Date(Date.now() + APPROVAL_EXPIRY_MS).toISOString(),
        respondedAt: null
      });

      approvals.push(approval);
      appendLog({
        goalId,
        taskId: nextTask.id,
        workflowId: workflow.id,
        actor: "policy",
        kind: "approval.requested",
        message: `Queued approval for "${nextTask.title}".`,
        details: {
          approvalId: approval.id,
          requestedAction: approval.requestedAction,
          actionIntent: approval.actionIntent,
          preview: approval.preview
        }
      });
    }
  }

  const watchers = catalog.watcherFactory(goalId);

  for (const watcher of watchers) {
    appendLog({
      goalId,
      workflowId: workflow.id,
      actor: "workflow",
      kind: "watcher.created",
      message: `Registered watcher "${watcher.targetEntity}".`,
      details: {
        condition: watcher.condition,
        frequency: watcher.frequency
      }
    });
  }

  const statuses = recomputeWorkflowStatuses(tasks, approvals, watchers);

  return GoalBundleSchema.parse({
    goal: {
      ...goal,
      status: statuses.goalStatus,
      updatedAt: nowIso()
    },
    workflow: {
      ...workflow,
      status: statuses.workflowStatus,
      checkpoint: approvals.length > 0 ? "approval-gate" : watchers.length > 0 ? "watcher-monitoring" : "done",
      updatedAt: nowIso()
    },
    tasks,
    artifacts,
    approvals,
    watchers,
    actionLogs: logs
  });
}

export function respondToApproval(params: {
  bundle: GoalBundle;
  approvalId: string;
  decision: Exclude<ApprovalDecision, "pending">;
  actor: ActorContext;
  scope?: ApprovalDecisionScope;
  rationale?: string | null;
}): GoalBundle {
  const bundle = GoalBundleSchema.parse(params.bundle);
  const approval = bundle.approvals.find((candidate) => candidate.id === params.approvalId);

  if (!approval) {
    throw new Error(`Approval ${params.approvalId} was not found.`);
  }

  if (approval.decision !== "pending") {
    throw new Error(`Approval ${params.approvalId} has already been handled.`);
  }

  if (new Date(approval.expiryAt).getTime() <= Date.now()) {
    throw new Error(`Approval ${params.approvalId} has expired and can no longer be actioned.`);
  }

  const respondedAt = nowIso();
  const normalizedScope = params.scope ?? "once";
  const normalizedRationale = params.rationale?.trim() ? params.rationale.trim().slice(0, 1000) : null;
  const actorLabel = params.actor.executor.userId ?? params.actor.executor.label;
  const nextHistoryRecord: ApprovalDecisionRecord = {
    decision: params.decision,
    scope: normalizedScope,
    rationale: normalizedRationale,
    actor: actorLabel,
    actorContext: params.actor,
    createdAt: respondedAt
  };
  const approvals = bundle.approvals.map((candidate) =>
    candidate.id === params.approvalId
      ? ApprovalRequestSchema.parse({
          ...candidate,
          decision: params.decision,
          decisionScope: normalizedScope,
          decisionRationale: normalizedRationale,
          history: [...candidate.history, nextHistoryRecord],
          responsibility: {
            ...candidate.responsibility,
            handoffStatus: params.decision === "approved" ? "delegated" : "returned_to_owner",
            handoffSummary:
              params.decision === "approved"
                ? "The reviewer approved execution and returned the task to the active delegate."
                : "The reviewer rejected execution and returned control to the owner for rework or escalation.",
            lastChangedAt: respondedAt,
            lastChangedBy:
              params.actor.executor.kind === "human" && params.actor.executor.userId
                ? createUserResponsibilityAssignee(params.actor.executor.userId, params.actor.executor.label)
                : createSystemResponsibilityAssignee(params.actor.executor.label, params.actor.executor.label)
          },
          respondedAt
        })
      : candidate
  );
  let taskTransitionLog: ActionLog | null = null;
  const tasks = bundle.tasks.map((task) => {
    if (task.id !== approval.taskId) {
      return task;
    }

    const nextTask = params.decision === "approved" ? transitionTaskState(task, "queued") : transitionTaskState(task, "blocked");
    const lastChangedBy =
      params.actor.executor.kind === "human" && params.actor.executor.userId
        ? createUserResponsibilityAssignee(params.actor.executor.userId, params.actor.executor.label)
        : createSystemResponsibilityAssignee(params.actor.executor.label, params.actor.executor.label);
    const nextResponsibility = {
      ...nextTask.responsibility,
      handoffStatus: params.decision === "approved" ? "delegated" : "returned_to_owner",
      handoffSummary:
        params.decision === "approved"
          ? `The reviewer released "${task.title}" back to the execution delegate.`
          : `The reviewer blocked "${task.title}" and returned control to the owner.`,
      lastChangedAt: respondedAt,
      lastChangedBy
    };
    taskTransitionLog = ActionLogSchema.parse(
      createActionLog({
        goalId: bundle.goal.id,
        taskId: approval.taskId,
        workflowId: bundle.workflow.id,
        actor: "workflow",
        kind: "task.state_changed",
        message: `Moved "${task.title}" from "${task.state}" to "${nextTask.state}" after approval resolution.`,
        details: {
          from: task.state,
          to: nextTask.state,
          approvalId: approval.id,
          decision: params.decision,
          scope: normalizedScope,
          actorContext: params.actor
        },
        prevLog: bundle.actionLogs.at(-1) ?? null
      })
    );
    return TaskSchema.parse({
      ...nextTask,
      responsibility: nextResponsibility
    });
  });
  const statuses = recomputeWorkflowStatuses(tasks, approvals, bundle.watchers);
  const transitionLog = taskTransitionLog;
  const approvalResponseLog = ActionLogSchema.parse(
    createActionLog({
      goalId: bundle.goal.id,
      taskId: approval.taskId,
      workflowId: bundle.workflow.id,
      actor: actorLabel,
      kind: "approval.responded",
      message: `${params.decision === "approved" ? "Approved" : "Rejected"} "${approval.title}".`,
      details: {
        approvalId: approval.id,
        decision: params.decision,
        scope: normalizedScope,
        rationale: normalizedRationale,
        actorContext: params.actor
      },
      prevLog: transitionLog ?? bundle.actionLogs.at(-1) ?? null
    })
  );

  return GoalBundleSchema.parse({
    ...bundle,
    goal: {
      ...bundle.goal,
      status: statuses.goalStatus,
      updatedAt: nowIso()
    },
    workflow: WorkflowStateSchema.parse({
      ...bundle.workflow,
      status: statuses.workflowStatus,
      checkpoint: params.decision === "approved" ? "resumed-after-approval" : "awaiting-user-replan",
      updatedAt: nowIso()
    }),
    tasks,
    approvals,
    actionLogs: [
      ...bundle.actionLogs,
      ...(transitionLog ? [transitionLog] : []),
      approvalResponseLog
    ]
  });
}
