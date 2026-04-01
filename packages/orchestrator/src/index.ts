import {
  ActionLogSchema,
  ApprovalRequestSchema,
  GoalBundleSchema,
  GoalSchema,
  TaskSchema,
  WorkflowStateSchema,
  WatcherSchema,
  nowIso,
  type ActionLog,
  type ApprovalDecision,
  type ApprovalRequest,
  type Goal,
  type GoalBundle,
  type IntegrationAccount,
  type MemoryRecord,
  type Task,
  type Watcher,
  type WorkflowState
} from "@agentic/contracts";
import { runAgent } from "@agentic/agents";
import { createTask, createWorkflowState, transitionTaskState } from "@agentic/execution";
import { inferCapabilitiesFromRequest } from "@agentic/integrations";
import { rankRelevantMemories } from "@agentic/memory";
import { createActionLog } from "@agentic/observability";
import { evaluateTaskPolicy } from "@agentic/policy";

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

function detectScenario(request: string): ScenarioKey {
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

function normalizeRequest(request: string): string {
  return request.trim().replace(/\s+/g, " ");
}

function explanationForGoal(params: {
  scenario: ScenarioKey;
  memories: MemoryRecord[];
  integrations: IntegrationAccount[];
}): string {
  const catalog = scenarioCatalog[params.scenario];
  const readyIntegrations = params.integrations.filter((integration) => integration.status !== "disabled").length;
  const confirmedMemories = params.memories.filter((memory) => memory.memoryType === "confirmed").length;

  return `${catalog.description} The orchestrator resolved ${confirmedMemories} confirmed relevant memories and ${readyIntegrations} enabled adapters before planning the workflow.`;
}

function recomputeStatuses(tasks: Task[], approvals: ApprovalRequest[], watchers: Watcher[]): { goalStatus: Goal["status"]; workflowStatus: WorkflowState["status"] } {
  const hasPendingApprovals = approvals.some((approval) => approval.decision === "pending");
  const hasBlockedTask = tasks.some((task) => task.state === "blocked");
  const hasOpenWatchers = watchers.some((watcher) => watcher.status === "active");
  const allTasksCompleted = tasks.every((task) => task.state === "completed");

  if (hasPendingApprovals) {
    return {
      goalStatus: "waiting",
      workflowStatus: "waiting"
    };
  }

  if (hasBlockedTask) {
    return {
      goalStatus: "running",
      workflowStatus: "running"
    };
  }

  if (allTasksCompleted && !hasOpenWatchers) {
    return {
      goalStatus: "completed",
      workflowStatus: "completed"
    };
  }

  return {
    goalStatus: "running",
    workflowStatus: "running"
  };
}

export function processUserRequest(params: {
  userId: string;
  request: string;
  memories: MemoryRecord[];
  integrations: IntegrationAccount[];
}): GoalBundle {
  const request = normalizeRequest(params.request);

  if (!request) {
    throw new Error("A non-empty request is required.");
  }

  if (request.length > 2_000) {
    throw new Error("The request exceeds the 2000 character safety limit.");
  }

  const relevantMemories = rankRelevantMemories(request, params.memories, 5, {
    agent: "orchestrator"
  });
  const scenario = detectScenario(request);
  const catalog = scenarioCatalog[scenario];
  const goalId = crypto.randomUUID();
  const workflow = createWorkflowState(goalId, scenario);
  const createdAt = nowIso();
  const logs: ActionLog[] = [];
  const tasks: Task[] = [];
  const approvals: ApprovalRequest[] = [];
  const artifacts = [];
  const requestCapabilities = inferCapabilitiesFromRequest(request);
  const confidenceBias = Math.min(0.08, relevantMemories.length * 0.01);

  const goal = GoalSchema.parse({
    id: goalId,
    userId: params.userId,
    workflowId: workflow.id,
    title: catalog.title,
    request,
    intent: catalog.intent,
    status: "planned",
    confidence: Math.min(0.92, 0.72 + confidenceBias),
    explanation: explanationForGoal({
      scenario,
      memories: relevantMemories,
      integrations: params.integrations
    }),
    createdAt,
    updatedAt: createdAt
  });

  logs.push(
    createActionLog({
      goalId: goal.id,
      workflowId: workflow.id,
      actor: "orchestrator",
      kind: "goal.created",
      message: `Created goal "${goal.title}" from the user request.`,
      details: {
        intent: goal.intent,
        status: goal.status
      }
    })
  );
  logs.push(
    createActionLog({
      goalId,
      workflowId: workflow.id,
      actor: "orchestrator",
      kind: "context.resolved",
      message: "Resolved memories and integration surfaces before planning.",
      details: {
        memoryCount: params.memories.length,
        resolvedMemoryCount: relevantMemories.length,
        resolvedMemoryIds: relevantMemories.map((memory) => memory.id),
        integrationCount: params.integrations.length,
        requestCapabilities
      }
    })
  );

  for (const plannedTask of catalog.tasks) {
    const capabilities = Array.from(
      new Set([
        ...plannedTask.capabilities,
        ...requestCapabilities.filter((capability) => plannedTask.capabilities.includes(capability))
      ])
    );
    const decision = evaluateTaskPolicy({
      capabilities,
      confidence: plannedTask.confidence,
      title: plannedTask.title
    });
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
      state
    });
    const agentResult = runAgent(task, catalog.title);
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
        actor: "policy",
        kind: "policy.evaluated",
        message: `Evaluated policy for "${nextTask.title}".`,
        details: decision
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
          confidence: agentResult.confidence,
          nextSteps: agentResult.nextSteps
        }
      })
    );

    if (decision.requiresApproval) {
      const approval = ApprovalRequestSchema.parse({
        id: crypto.randomUUID(),
        goalId,
        taskId: nextTask.id,
        title: `${nextTask.title} requires approval`,
        rationale: decision.rationale,
        riskClass: decision.riskClass,
        decision: "pending",
        requestedAction: nextTask.summary,
        createdAt: nowIso(),
        respondedAt: null
      });

      approvals.push(approval);
      logs.push(
        createActionLog({
          goalId,
          taskId: nextTask.id,
          workflowId: workflow.id,
          actor: "policy",
          kind: "approval.requested",
          message: `Queued approval for "${nextTask.title}".`,
          details: {
            approvalId: approval.id,
            requestedAction: approval.requestedAction
          }
        })
      );
    }
  }

  const watchers = catalog.watcherFactory(goalId);

  for (const watcher of watchers) {
    logs.push(
      createActionLog({
        goalId,
        workflowId: workflow.id,
        actor: "workflow",
        kind: "watcher.created",
        message: `Registered watcher "${watcher.targetEntity}".`,
        details: {
          condition: watcher.condition,
          frequency: watcher.frequency
        }
      })
    );
  }

  const statuses = recomputeStatuses(tasks, approvals, watchers);

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
}): GoalBundle {
  const bundle = GoalBundleSchema.parse(params.bundle);
  const approval = bundle.approvals.find((candidate) => candidate.id === params.approvalId);

  if (!approval) {
    throw new Error(`Approval ${params.approvalId} was not found.`);
  }

  if (approval.decision !== "pending") {
    throw new Error(`Approval ${params.approvalId} has already been handled.`);
  }

  const respondedAt = nowIso();
  const approvals = bundle.approvals.map((candidate) =>
    candidate.id === params.approvalId
      ? ApprovalRequestSchema.parse({
          ...candidate,
          decision: params.decision,
          respondedAt
        })
      : candidate
  );
  const tasks = bundle.tasks.map((task) => {
    if (task.id !== approval.taskId) {
      return task;
    }

    return params.decision === "approved" ? transitionTaskState(task, "completed") : transitionTaskState(task, "blocked");
  });
  const statuses = recomputeStatuses(tasks, approvals, bundle.watchers);

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
      ActionLogSchema.parse(
        createActionLog({
          goalId: bundle.goal.id,
          taskId: approval.taskId,
          workflowId: bundle.workflow.id,
          actor: "user",
          kind: "approval.responded",
          message: `${params.decision === "approved" ? "Approved" : "Rejected"} "${approval.title}".`,
          details: {
            approvalId: approval.id,
            decision: params.decision
          }
        })
      )
    ]
  });
}
