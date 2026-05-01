import {
  APPROVAL_EXPIRY_MS,
  ActionLogSchema,
  ActionIntentSchema,
  type ActorContext,
  type ApprovalDecisionRecord,
  type ApprovalDecisionScope,
  type ApprovalPreview,
  ApprovalRequestSchema,
  ArtifactSchema,
  GoalBundleSchema,
  GoalSchema,
  SubAgentPlanSchema,
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
  type SubAgentPlan,
  type SubAgentRole,
  type Task,
  type Watcher,
  type WorkspaceGovernance
} from "@agentic/contracts";
import { runAgent } from "@agentic/agents";
import { createTask, createWorkflowState, recomputeWorkflowStatuses, transitionTaskState } from "@agentic/execution";
import { inferCapabilitiesFromRequest } from "@agentic/integrations";
import { rankRelevantMemories } from "@agentic/memory";
import { createActionLog } from "@agentic/observability";
import { evaluateTaskPolicy } from "@agentic/policy";
import Anthropic from "@anthropic-ai/sdk";
import OpenAI from "openai";

export { captureExecutionOutcomeSignals, captureMemoriesFromBundle, type CapturedMemories } from "./memory-capture";
export { executeApprovedTask, executeApprovedTasks, reconcileExecutionResults, type ExecutionResult } from "./execution-dispatch";
export { generateBriefing, generateMorningBriefing } from "./morning-briefing";
export { refineGoal } from "./goal-refinement";
export { createGoalTemplate, interpolateTemplate, computeNextRun, shouldTemplateRun } from "./goal-templates";

export type ScenarioKey =
  | "inbox-triage"
  | "weekly-planning"
  | "travel-preparation"
  | "complex-delegation"
  | "general-coordination";

type PlannedTask = {
  title: string;
  summary: string;
  assignedAgent: Task["assignedAgent"];
  capabilities: Task["toolCapabilities"];
  confidence: number;
  dependsOnRoleIds?: string[];
  subAgentRole?: SubAgentRole;
  subAgentPlanId?: string;
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
  "complex-delegation": {
    title: "Complex multi-agent delegation",
    intent: "complex-delegation",
    description:
      "Break complex work into explicit sub-agent roles with bounded responsibilities, dependencies, guardrails, and policy-aware handoffs.",
    tasks: [
      {
        title: "Define the sub-agent operating plan",
        summary:
          "Create the parent work breakdown, role boundaries, dependency graph, handoff criteria, and approval-sensitive guardrails before specialist work starts.",
        assignedAgent: "orchestrator",
        capabilities: ["read", "search", "create", "monitor"],
        confidence: 0.82
      }
    ],
    watcherFactory: () => []
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

  if (/(sub-?agents?|delegate|delegation|parallel workstreams?|multi[- ]agent|specialist agents?|complex task)/.test(normalized)) {
    return "complex-delegation";
  }

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
  const validScenarios: ScenarioKey[] = [
    "inbox-triage",
    "weekly-planning",
    "travel-preparation",
    "complex-delegation",
    "general-coordination"
  ];
  const prompt = `Classify this user request into exactly one scenario. Reply with ONLY the scenario key, nothing else.

Scenarios:
- inbox-triage: Email management, message triage, drafting replies, communication follow-ups
- weekly-planning: Calendar review, week planning, scheduling, focus blocks, commitment management
- travel-preparation: Trip planning, flights, hotels, itineraries, travel checklists, packing
- complex-delegation: Complex work that asks for sub-agents, delegation, parallel workstreams, specialist roles, or role responsibilities
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
  if (process.env.ANTHROPIC_API_KEY || process.env.OPENAI_API_KEY) {
    return detectScenarioLlm(request);
  }
  return detectScenarioRegex(request);
}

function normalizeRequest(request: string): string {
  return request.trim().replace(/\s+/g, " ");
}

type SubAgentRoleTemplate = {
  id: string;
  name: string;
  agent: Task["assignedAgent"];
  role: string;
  capabilities: Capability[];
  responsibilities: string[];
  inputContracts: string[];
  expectedOutputs: string[];
  dependsOn: string[];
  riskClass: RiskClass;
  handoffCriteria: string[];
  guardrails: string[];
  confidence: number;
};

const subAgentRoleTemplates: SubAgentRoleTemplate[] = [
  {
    id: "recon-scoping",
    name: "Recon and Scoping Agent",
    agent: "research",
    role: "Discover affected surfaces, constraints, prior art, and unresolved assumptions before implementation begins.",
    capabilities: ["read", "search", "draft"],
    responsibilities: [
      "Map the affected modules, contracts, configs, and tests.",
      "Separate verified evidence from assumptions and identify blockers.",
      "Recommend the safest implementation seam and validation scope."
    ],
    inputContracts: ["Normalized request and parent operating plan.", "Relevant memories, integrations, and governance posture."],
    expectedOutputs: [
      "Affected-surface map with concrete references.",
      "Ranked risks, dependencies, and recommended next implementation step."
    ],
    dependsOn: [],
    riskClass: "R2",
    handoffCriteria: [
      "Recon output cites evidence and open questions.",
      "Implementation can begin without broadening the request scope."
    ],
    guardrails: [
      "Read-only unless explicitly assigned implementation ownership.",
      "Do not treat inferred behavior as verified behavior."
    ],
    confidence: 0.8
  },
  {
    id: "core-implementation",
    name: "Core Implementation Agent",
    agent: "workflow",
    role: "Convert the accepted design into small, reversible, test-backed implementation work.",
    capabilities: ["read", "search", "draft", "create", "update", "monitor"],
    responsibilities: [
      "Implement the main logic using existing project patterns.",
      "Keep diffs scoped to the assigned ownership boundary.",
      "Attach tests and validation evidence to the same logical work unit."
    ],
    inputContracts: ["Recon output and accepted design constraints.", "Explicit file/module ownership boundaries."],
    expectedOutputs: [
      "Focused implementation output or patch plan.",
      "Changed contracts, runtime assumptions, and rollback notes."
    ],
    dependsOn: ["recon-scoping"],
    riskClass: "R2",
    handoffCriteria: [
      "Core behavior is covered by targeted tests.",
      "Any compatibility or rollout implications are documented."
    ],
    guardrails: [
      "Avoid unrelated refactors.",
      "Preserve existing public contracts unless a breaking change is intentional and documented."
    ],
    confidence: 0.78
  },
  {
    id: "test-hardening",
    name: "Test and Hardening Agent",
    agent: "knowledge",
    role: "Challenge the implementation with regression, edge, negative, and governance-oriented validation.",
    capabilities: ["read", "search", "create", "monitor"],
    responsibilities: [
      "Add or recommend focused tests for happy path, edge cases, and abuse cases.",
      "Verify policy gates, provenance, and role boundaries remain intact.",
      "Capture unresolved risks with concrete mitigation steps."
    ],
    inputContracts: ["Implementation output and recon evidence.", "Policy, security, and validation expectations."],
    expectedOutputs: [
      "Targeted test coverage and validation checklist.",
      "Residual risk list with owner and follow-up recommendation."
    ],
    dependsOn: ["core-implementation"],
    riskClass: "R2",
    handoffCriteria: [
      "Validation commands and results are explicitly named.",
      "Failures are triaged as code defects, environment blockers, or accepted residual risk."
    ],
    guardrails: [
      "Do not mark work complete without evidence.",
      "Do not expose raw prompts, secrets, or private context in summaries."
    ],
    confidence: 0.79
  },
  {
    id: "handoff-coordination",
    name: "Handoff Coordination Agent",
    agent: "communications",
    role: "Prepare user-facing status, review requests, and approval-safe communication after specialist work converges.",
    capabilities: ["read", "search", "draft"],
    responsibilities: [
      "Summarize completed work, validation, risks, and next actions.",
      "Draft approval requests when work would create external side effects.",
      "Keep final claims aligned with actual verification evidence."
    ],
    inputContracts: ["Final integration checklist.", "Validation and residual-risk notes from specialist roles."],
    expectedOutputs: [
      "Concise delivery summary.",
      "Approval-safe follow-up draft when user or external action is required."
    ],
    dependsOn: ["test-hardening"],
    riskClass: "R2",
    handoffCriteria: [
      "Summary distinguishes implemented, validated, blocked, and proposed work.",
      "Any external send remains behind the existing approval workflow."
    ],
    guardrails: [
      "Never send messages as part of planning.",
      "Do not overstate execution or validation status."
    ],
    confidence: 0.76
  }
];

function intersectCapabilities(allowed: Capability[], granted: Capability[]): Capability[] {
  const grantedCapabilities = new Set(granted);
  return allowed.filter((capability) => grantedCapabilities.has(capability));
}

function buildSubAgentPlan(params: {
  goalId: string;
  requestCapabilities: Capability[];
  createdAt: string;
}): SubAgentPlan {
  const fallbackCapabilities: Capability[] = ["read", "search", "draft", "create", "update", "monitor"];
  const parentCapabilities = Array.from(new Set([...fallbackCapabilities, ...params.requestCapabilities]));
  const roles = subAgentRoleTemplates.map((template): SubAgentRole => {
    const allowedCapabilities = intersectCapabilities(template.capabilities, parentCapabilities);

    return {
      id: template.id,
      name: template.name,
      agent: template.agent,
      role: template.role,
      responsibilities: template.responsibilities,
      allowedCapabilities,
      inputContracts: template.inputContracts,
      expectedOutputs: template.expectedOutputs,
      dependsOn: template.dependsOn,
      riskClass: template.riskClass,
      handoffCriteria: template.handoffCriteria,
      guardrails: template.guardrails
    };
  });

  return SubAgentPlanSchema.parse({
    id: `subagents-${params.goalId}`,
    goalId: params.goalId,
    anchorTaskId: null,
    parentAgent: "orchestrator",
    coordinationStrategy: "hybrid",
    roles,
    successCriteria: [
      "Every spawned role has a clear owner, capability envelope, dependency list, handoff criteria, and guardrails.",
      "Parallel workstreams converge through the orchestrator before completion is claimed.",
      "External side effects remain gated by the existing task policy and approval workflow."
    ],
    createdAt: params.createdAt
  });
}

function formatSubAgentPlan(plan: SubAgentPlan): string {
  const roles = plan.roles
    .map(
      (role, index) =>
        `${index + 1}. ${role.name} (${role.agent})\n` +
        `   Role: ${role.role}\n` +
        `   Responsibilities: ${role.responsibilities.join(" | ")}\n` +
        `   Capabilities: ${role.allowedCapabilities.join(", ") || "artifact-only"}\n` +
        `   Depends on: ${role.dependsOn.join(", ") || "none"}\n` +
        `   Expected outputs: ${role.expectedOutputs.join(" | ")}\n` +
        `   Handoff criteria: ${role.handoffCriteria.join(" | ")}\n` +
        `   Guardrails: ${role.guardrails.join(" | ")}`
    )
    .join("\n\n");

  return (
    `Sub-agent plan: ${plan.id}\n` +
    `Coordination strategy: ${plan.coordinationStrategy}\n` +
    `Parent agent: ${plan.parentAgent}\n\n` +
    `${roles}\n\n` +
    `Success criteria:\n- ${plan.successCriteria.join("\n- ")}`
  );
}

function expandPlannedTasks(params: {
  baseTasks: PlannedTask[];
  subAgentPlan: SubAgentPlan | null;
}): PlannedTask[] {
  if (!params.subAgentPlan) {
    return params.baseTasks;
  }

  const subAgentPlan = params.subAgentPlan;
  const spawnedTasks = subAgentPlan.roles.map((role) => {
    const template = subAgentRoleTemplates.find((candidate) => candidate.id === role.id);

    return {
      title: `Sub-agent: ${role.name}`,
      summary: `${role.role} Responsibilities: ${role.responsibilities.join(" ")}`,
      assignedAgent: role.agent,
      capabilities: role.allowedCapabilities,
      confidence: template?.confidence ?? 0.74,
      dependsOnRoleIds: role.dependsOn,
      subAgentRole: role,
      subAgentPlanId: subAgentPlan.id
    } satisfies PlannedTask;
  });

  return [...params.baseTasks, ...spawnedTasks];
}

function buildSubAgentPlanArtifact(plan: SubAgentPlan): Artifact {
  return ArtifactSchema.parse({
    id: crypto.randomUUID(),
    goalId: plan.goalId,
    artifactType: "checklist",
    title: "Sub-agent operating plan",
    content: formatSubAgentPlan(plan),
    metadata: {
      kind: "sub_agent_plan",
      subAgentPlanId: plan.id,
      coordinationStrategy: plan.coordinationStrategy,
      parentAgent: plan.parentAgent,
      subAgentCount: plan.roles.length,
      subAgentIds: plan.roles.map((role) => role.id)
    },
    createdAt: plan.createdAt
  });
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

function inferApprovalImpact(task: Task, actionType: ApprovalPreview["actionType"]): ApprovalPreview["impact"] {
  const affectedSystems = new Set<string>();

  if (task.assignedAgent === "communications" || task.toolCapabilities.includes("send")) {
    affectedSystems.add("email");
  }

  if (task.assignedAgent === "calendar" || task.toolCapabilities.includes("schedule")) {
    affectedSystems.add("calendar");
  }

  if (task.toolCapabilities.includes("create") || task.toolCapabilities.includes("update")) {
    affectedSystems.add("workspace");
  }

  return {
    affectedPeople: actionType === "send" ? ["external recipients"] : [],
    affectedSystems: [...affectedSystems],
    permissions: task.toolCapabilities,
    rollback: actionType === "delete" ? "not_supported" : actionType === "draft" || actionType === "artifact-only" ? "supported" : "manual"
  };
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

function actionTypeForApproval(task: Task, actionIntent: ActionIntent): ApprovalPreview["actionType"] {
  switch (actionIntent.type) {
    case "send_message":
      return "send";
    case "schedule_event":
      return "schedule";
    case "create_note":
      return "create";
    case "manual_review":
      return actionIntent.actionType;
    default:
      return inferApprovalActionType(task);
  }
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
  const actionType = actionTypeForApproval(task, resolvedActionIntent);
  const target =
    resolvedActionIntent.type === "send_message"
      ? resolvedActionIntent.to
      : resolvedActionIntent.type === "schedule_event"
        ? "Calendar commitment"
        : resolvedActionIntent.type === "create_note"
          ? resolvedActionIntent.title
          : actionType === "send"
            ? "External communication"
            : actionType === "schedule"
              ? "Calendar commitment"
              : actionType === "create"
                ? "New workspace artifact"
                : actionType === "update"
                  ? "Existing workspace state"
                  : actionType === "delete"
                    ? "Existing record"
                    : actionType === "draft"
                      ? "Draft artifact"
                      : task.title;
  const summary =
    resolvedActionIntent.type === "send_message"
      ? `Draft ${resolvedActionIntent.mode === "send" ? "and send" : "an"} email to ${resolvedActionIntent.to}: ${resolvedActionIntent.subject}`
      : resolvedActionIntent.type === "schedule_event"
        ? `Schedule "${resolvedActionIntent.summary}" from ${resolvedActionIntent.start} to ${resolvedActionIntent.end}`
        : resolvedActionIntent.type === "create_note"
          ? `Create note "${resolvedActionIntent.title}"`
          : resolvedActionIntent.summary;
  const changes =
    resolvedActionIntent.type === "send_message"
      ? [
          {
            label: "Recipient",
            before: "Pending user review",
            after: resolvedActionIntent.to
          },
          {
            label: "Subject",
            before: "Pending user review",
            after: resolvedActionIntent.subject
          }
        ]
      : resolvedActionIntent.type === "schedule_event"
        ? [
            {
              label: "Scheduled window",
              before: "Pending user review",
              after: `${resolvedActionIntent.start} -> ${resolvedActionIntent.end}`
            }
          ]
        : resolvedActionIntent.type === "create_note"
          ? [
              {
                label: "Note title",
                before: "Pending user review",
                after: resolvedActionIntent.title
              }
            ]
          : [
              {
                label: "Requested action",
                before: "Pending user review",
                after: resolvedActionIntent.summary
              }
            ];

  return {
    actionType,
    summary,
    target,
    changes,
    impact: inferApprovalImpact(task, actionType)
  };
}

export async function processUserRequest(params: {
  userId: string;
  workspaceId?: string | null;
  request: string;
  memories: MemoryRecord[];
  integrations: IntegrationAccount[];
  agentDefinition?: AgentDefinition;
  resolveAgentMetrics?: (agentIdOrName: string) => Promise<AgentMetrics | null>;
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

  const relevantMemories = rankRelevantMemories(request, params.memories, 5, {
    agent: "orchestrator"
  });
  const scenario = await detectScenario(request);
  const catalog = scenarioCatalog[scenario];
  const goalId = params.goalId ?? crypto.randomUUID();
  const workspaceId = params.workspaceId ?? null;
  const workflow = createWorkflowState(goalId, scenario, workspaceId, params.workflowId);
  const createdAt = nowIso();
  const logs: ActionLog[] = [];
  const tasks: Task[] = [];
  const approvals: ApprovalRequest[] = [];
  const artifacts: Artifact[] = [];
  const requestCapabilities = inferCapabilitiesFromRequest(request);
  const subAgentPlan =
    scenario === "complex-delegation"
      ? buildSubAgentPlan({
          goalId,
          requestCapabilities,
          createdAt
        })
      : null;
  const plannedTasks = expandPlannedTasks({
    baseTasks: catalog.tasks,
    subAgentPlan
  });
  const subAgentTaskIds = new Map<string, string>();
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
      memories: relevantMemories,
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
      integrationCount: params.integrations.length,
      requestCapabilities
    }
  });

  if (subAgentPlan) {
    const subAgentArtifact = buildSubAgentPlanArtifact(subAgentPlan);
    artifacts.push(subAgentArtifact);
    appendLog({
      goalId,
      workflowId: workflow.id,
      actor: "orchestrator",
      kind: "subagents.planned",
      message: `Prepared ${subAgentPlan.roles.length} sub-agent roles for complex delegation.`,
      details: {
        subAgentPlanId: subAgentPlan.id,
        coordinationStrategy: subAgentPlan.coordinationStrategy,
        roles: subAgentPlan.roles.map((role) => ({
          id: role.id,
          name: role.name,
          agent: role.agent,
          responsibilities: role.responsibilities,
          allowedCapabilities: role.allowedCapabilities,
          dependsOn: role.dependsOn,
          riskClass: role.riskClass
        })),
        artifactId: subAgentArtifact.id
      }
    });
  }

  for (const plannedTask of plannedTasks) {
    const capabilities = Array.from(
      new Set([
        ...plannedTask.capabilities,
        ...requestCapabilities.filter((capability) => plannedTask.capabilities.includes(capability))
      ])
    );
    const dependsOn = plannedTask.dependsOnRoleIds
      ?.map((roleId) => subAgentTaskIds.get(roleId))
      .filter((taskId): taskId is string => Boolean(taskId));
    const scorecard = await params.resolveAgentMetrics?.(plannedTask.assignedAgent);
    const decision = evaluateTaskPolicy({
      capabilities,
      confidence: plannedTask.confidence,
      title: plannedTask.title,
      memories: params.memories,
      scorecard,
      governance: params.governance
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
      dependsOn,
      state
    });
    const agentResult = await runAgent(task, catalog.title, {
      agentDefinition: params.agentDefinition
    });
    const agentArtifacts = plannedTask.subAgentRole
      ? agentResult.artifacts.map((artifact) =>
          ArtifactSchema.parse({
            ...artifact,
            metadata: {
              ...artifact.metadata,
              kind: "sub_agent_output",
              subAgentPlanId: plannedTask.subAgentPlanId,
              subAgentRoleId: plannedTask.subAgentRole?.id,
              subAgentRoleName: plannedTask.subAgentRole?.name,
              responsibilities: plannedTask.subAgentRole?.responsibilities,
              expectedOutputs: plannedTask.subAgentRole?.expectedOutputs,
              handoffCriteria: plannedTask.subAgentRole?.handoffCriteria,
              guardrails: plannedTask.subAgentRole?.guardrails
            }
          })
        )
      : agentResult.artifacts;
    const nextTask = TaskSchema.parse({
      ...task,
      artifactIds: agentArtifacts.map((artifact) => artifact.id)
    });
    const actionIntent = decision.requiresApproval ? inferActionIntentFromArtifacts(nextTask, agentArtifacts) : null;

    tasks.push(nextTask);
    artifacts.push(...agentArtifacts);
    if (plannedTask.subAgentRole) {
      subAgentTaskIds.set(plannedTask.subAgentRole.id, nextTask.id);
    }
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
        requiresApproval: nextTask.requiresApproval,
        ...(plannedTask.subAgentRole && {
          subAgentPlanId: plannedTask.subAgentPlanId,
          subAgentRoleId: plannedTask.subAgentRole.id,
          subAgentRoleName: plannedTask.subAgentRole.name,
          responsibilities: plannedTask.subAgentRole.responsibilities,
          dependsOnRoleIds: plannedTask.dependsOnRoleIds ?? []
        })
      }
    });
    appendLog({
      goalId,
      taskId: nextTask.id,
      workflowId: workflow.id,
      actor: "policy",
      kind: "policy.evaluated",
      message: `Evaluated policy for "${nextTask.title}".`,
      details: decision
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
    return nextTask;
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
