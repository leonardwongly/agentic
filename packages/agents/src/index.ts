import {
  ActionIntentSchema,
  AgentRunnerContractSchema,
  AgentRunnerInputSchema,
  AgentRunnerOutputSchema,
  AgentResultSchema,
  ArtifactSchema,
  deriveAgentImplementationTier,
  nowIso,
  type ActionIntent,
  type AgentDefinition,
  type AgentExecutionMode,
  type AgentImplementationTier,
  type AgentRunnerContract,
  type AgentRunnerFailureCode,
  type AgentRunnerInput,
  type AgentRunnerOutput,
  type AgentName,
  type AgentResult,
  type ArtifactType,
  type Capability,
  type Task
} from "@agentic/contracts";
import { assertCapabilitiesWithinAllowlist } from "@agentic/integrations";

// Options for running an agent with custom configuration
export type RunAgentOptions = {
  agentDefinition?: AgentDefinition;
  requestContext?: string;
  timeoutMs?: number;
  traceId?: string | null;
  runner?: AgentRunner;
};

const SELECTED_WEDGE_EXECUTION_MODE: AgentExecutionMode = "governed_specialist";
const RUNNER_CONTRACT_VERSION = "v1";
const DEFAULT_AGENT_RUNNER_TIMEOUT_MS = 30_000;
const SIDE_EFFECT_CAPABILITIES = new Set<Capability>(["create", "update", "draft", "send", "schedule", "approve", "delete"]);

export class AgentRunnerExecutionError extends Error {
  constructor(
    public readonly code: AgentRunnerFailureCode,
    message: string,
    public readonly retryable = false
  ) {
    super(message);
    this.name = "AgentRunnerExecutionError";
  }
}

export type AgentRunner = {
  contract: AgentRunnerContract;
  run(input: AgentRunnerInput): AgentRunnerOutput;
};

function buildArtifact(
  task: Task,
  title: string,
  content: string,
  artifactType: ArtifactType,
  executionMode: AgentExecutionMode,
  implementationTier: AgentImplementationTier,
  actionIntent?: ActionIntent | null,
  agentId?: string
) {
  return ArtifactSchema.parse({
    id: crypto.randomUUID(),
    goalId: task.goalId,
    taskId: task.id,
    artifactType,
    title,
    content,
    metadata: {
      agent: task.assignedAgent,
      executionMode,
      implementationTier,
      requiresManualReview: executionMode === "manual_review_required",
      // Keep the legacy alias populated while orchestration still accepts both keys.
      ...(actionIntent ? { actionIntent, executionIntent: actionIntent } : {}),
      ...(agentId && { agentDefinitionId: agentId })
    },
    createdAt: nowIso()
  });
}

type AgentContent = {
  summary: string;
  artifactType: ArtifactType;
  content: string;
  executionMode: AgentExecutionMode;
  explanation: string;
  nextSteps: string[];
  confidence: number;
  actionIntent?: ActionIntent | null;
};

function buildLabeledFieldPattern(labels: readonly string[]): RegExp {
  const escapedLabels = labels
    .map((label) => label.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&"))
    .sort((left, right) => right.length - left.length);

  return new RegExp(`\\b(${escapedLabels.join("|")})\\s*:`, "giu");
}

function normalizeLabeledFieldValue(value: string): string {
  const trimmed = value.trim();

  if (
    trimmed.length >= 2 &&
    ((trimmed.startsWith('"') && trimmed.endsWith('"')) || (trimmed.startsWith("'") && trimmed.endsWith("'")))
  ) {
    return trimmed.slice(1, -1).trim();
  }

  return trimmed;
}

function readLabeledFields(input: string, labels: readonly string[]): Map<string, string> {
  const fields = new Map<string, string>();
  const pattern = buildLabeledFieldPattern(labels);
  const matches = Array.from(input.matchAll(pattern));

  for (const [index, match] of matches.entries()) {
    const label = match[1]?.toLowerCase();
    const valueStart = (match.index ?? 0) + match[0].length;
    const valueEnd = matches[index + 1]?.index ?? input.length;
    const normalizedValue = normalizeLabeledFieldValue(input.slice(valueStart, valueEnd));

    if (label && normalizedValue) {
      fields.set(label, normalizedValue);
    }
  }

  return fields;
}

function maybeBuildCommunicationsActionIntent(task: Task, scenario: string): ActionIntent | null {
  if (!task.toolCapabilities.includes("draft") && !task.toolCapabilities.includes("send")) {
    return null;
  }

  const fields = readLabeledFields(scenario, ["To", "Subject", "Body", "Mode", "Thread-ID", "Thread ID"]);
  const to = fields.get("to");
  const subject = fields.get("subject");
  const body = fields.get("body");

  if (!to || !subject || !body) {
    return null;
  }

  const requestedMode = fields.get("mode")?.toLowerCase();
  const mode =
    requestedMode === "send"
      ? "send"
      : requestedMode === "draft"
        ? "draft"
        : task.toolCapabilities.includes("draft")
          ? "draft"
          : task.toolCapabilities.includes("send")
            ? "send"
            : null;

  if (!mode) {
    return null;
  }

  if (mode === "send" && !task.toolCapabilities.includes("send")) {
    return null;
  }

  if (mode === "draft" && !task.toolCapabilities.includes("draft") && !task.toolCapabilities.includes("send")) {
    return null;
  }

  const parsed = ActionIntentSchema.safeParse({
    type: "send_message",
    to,
    subject,
    body,
    mode,
    threadId: fields.get("thread-id") ?? fields.get("thread id") ?? null
  });

  return parsed.success ? parsed.data : null;
}

function maybeBuildCalendarActionIntent(task: Task, scenario: string): ActionIntent | null {
  if (!task.toolCapabilities.includes("schedule")) {
    return null;
  }

  const fields = readLabeledFields(scenario, ["Event", "Start", "End", "Attendees", "Description"]);
  const summary = fields.get("event");
  const start = fields.get("start");
  const end = fields.get("end");

  if (!summary || !start || !end) {
    return null;
  }

  const attendees =
    fields
      .get("attendees")
      ?.split(",")
      .map((attendee) => attendee.trim())
      .filter(Boolean) ?? [];
  const parsed = ActionIntentSchema.safeParse({
    type: "schedule_event",
    summary,
    start,
    end,
    attendees,
    description: fields.get("description") ?? null
  });

  return parsed.success ? parsed.data : null;
}

function summarizePrompt(systemPrompt: string): string {
  return systemPrompt.replace(/\s+/gu, " ").trim().slice(0, 200);
}

function buildWorkflowScaffoldContent(scenario: string): string {
  return (
    `Scenario: ${scenario}\n\nChecklist:\n` +
    "- Capture the top-level goal and dependencies.\n" +
    "- Create low-risk reminders and internal tasks.\n" +
    "- Keep resumable checkpoints for waiting states or partial completion."
  );
}

function buildCommunicationsSpecialistContent(scenario: string, actionIntent: ActionIntent | null): string {
  return (
    `Scenario: ${scenario}\n\nCommunications execution:\n` +
    "- Review the highest-signal threads and rank them for follow-up.\n" +
    "- Prepare a reply-ready artifact with explicit outbound guardrails.\n" +
    "- Capture unresolved dependencies before external delivery.\n" +
    `${
      actionIntent
        ? "- A typed outbound message intent was captured from explicit request cues and remains approval-gated."
        : "- No typed outbound message intent was captured, so execution remains artifact-first until explicit send details are provided."
    }`
  );
}

function buildCalendarSpecialistContent(scenario: string, actionIntent: ActionIntent | null): string {
  return (
    `Scenario: ${scenario}\n\nScheduling execution:\n` +
    "- Consolidate the current commitments, deadlines, and overload windows.\n" +
    "- Produce a reviewable weekly operating plan with bounded tradeoffs.\n" +
    "- Keep any calendar mutation behind approval or review.\n" +
    `${
      actionIntent
        ? "- A typed scheduling intent was captured from explicit request cues and remains governance-bound until approved."
        : "- No typed scheduling intent was captured, so execution remains planning-first until explicit event details are provided."
    }`
  );
}

// Generate content for dynamic agent definitions
function contentForDynamicAgent(
  agent: AgentDefinition,
  task: Task,
  scenario: string
): AgentContent {
  const artifactType = agent.artifactType as ArtifactType;

  return {
    summary: `${agent.displayName} prepared a configuration-backed artifact for "${task.title}".`,
    artifactType,
    content:
      `Scenario: ${scenario}\n\n` +
      `Agent: ${agent.displayName}\n\n` +
      `Configured capabilities: ${agent.allowedCapabilities.join(", ") || "none"}\n\n` +
      `System prompt preview:\n${summarizePrompt(agent.systemPrompt)}...\n\n` +
      "Execution status: this artifact reflects the custom agent configuration, but no model-backed specialist runner is active here yet.",
    executionMode: "custom_prompt_scaffold",
    explanation:
      `${agent.displayName} shaped the artifact using its saved configuration, but execution remains scaffolded until a model-backed runner is introduced.`,
    nextSteps: [
      "Review the artifact as preparation material rather than confirmed execution output.",
      "Validate the custom agent's prompt and capability allowlist before approving side effects."
    ],
    confidence: 0.58
  };
}

// Generate content for built-in agents (fallback)
function contentForBuiltInAgent(task: Task, scenario: string): AgentContent {
  switch (task.assignedAgent) {
    case "communications": {
      const actionIntent = maybeBuildCommunicationsActionIntent(task, scenario);
      return {
        summary: "Prepared a governed communications execution artifact.",
        artifactType: "summary",
        content: buildCommunicationsSpecialistContent(scenario, actionIntent),
        executionMode: SELECTED_WEDGE_EXECUTION_MODE,
        explanation:
          `communications ran through the selected governed specialist wedge for "${task.title}", keeping any external side effect behind approval.`,
        nextSteps: [
          "Persist the artifact on the goal timeline.",
          "Respect approval gates before any external side effect."
        ],
        confidence: task.riskClass === "R1" ? 0.82 : 0.73,
        actionIntent
      };
    }
    case "calendar": {
      const actionIntent = maybeBuildCalendarActionIntent(task, scenario);
      return {
        summary: "Prepared a governed scheduling execution artifact.",
        artifactType: "brief",
        content: buildCalendarSpecialistContent(scenario, actionIntent),
        executionMode: SELECTED_WEDGE_EXECUTION_MODE,
        explanation:
          `calendar ran through the selected governed specialist wedge for "${task.title}", keeping schedule mutations behind review.`,
        nextSteps: [
          "Persist the artifact on the goal timeline.",
          "Respect approval gates before any calendar side effect."
        ],
        confidence: task.riskClass === "R1" ? 0.82 : 0.73,
        actionIntent
      };
    }
    case "workflow":
      const content = buildWorkflowScaffoldContent(scenario);
      return {
        summary: "Prepared a deterministic workflow scaffold.",
        artifactType: "checklist",
        content,
        executionMode: "deterministic_scaffold",
        explanation: `workflow produced a deterministic execution scaffold for "${task.title}".`,
        nextSteps: [
          "Persist the artifact on the goal timeline.",
          "Use the scaffold to drive the next approved workflow step."
        ],
        confidence: task.riskClass === "R1" ? 0.82 : 0.73,
        actionIntent: task.toolCapabilities.includes("create")
          ? ActionIntentSchema.parse({
              type: "create_note",
              title: task.title,
              content
            })
          : null
      };
    case "research":
      return {
        summary: "Prepared a deterministic research briefing artifact.",
        artifactType: "brief",
        content:
          `Scenario: ${scenario}\n\nResearch approach:\n` +
          "- Summarize the current situation.\n" +
          "- Compare options with risks and assumptions.\n" +
          "- Separate confirmed evidence from inferred recommendations.",
        executionMode: "deterministic_scaffold",
        explanation: `research produced a deterministic briefing scaffold for "${task.title}".`,
        nextSteps: [
          "Persist the artifact on the goal timeline.",
          "Validate external claims before treating them as confirmed evidence."
        ],
        confidence: task.riskClass === "R1" ? 0.82 : 0.73
      };
    case "knowledge":
      return {
        summary: "Prepared a deterministic knowledge-resolution artifact.",
        artifactType: "explanation",
        content:
          `Scenario: ${scenario}\n\nKnowledge retrieval:\n` +
          "- Pull confirmed preferences first.\n" +
          "- Add recent working state and episodic context.\n" +
          "- Avoid surfacing stale or low-confidence memories as facts.",
        executionMode: "deterministic_scaffold",
        explanation: `knowledge produced a deterministic memory-resolution scaffold for "${task.title}".`,
        nextSteps: [
          "Persist the artifact on the goal timeline.",
          "Keep stale or low-confidence memories behind human review."
        ],
        confidence: task.riskClass === "R1" ? 0.82 : 0.73
      };
    default:
      return {
        summary: `Prepared a manual-review scaffold because ${task.assignedAgent} is not production-implemented yet.`,
        artifactType: "summary",
        content:
          `Scenario: ${scenario}\n\n` +
          `Execution status: ${task.assignedAgent} does not yet have a production specialist runner.\n\n` +
          "This artifact is planning material only. No typed execution payload was produced, and any outward action should remain in manual review.",
        executionMode: "manual_review_required",
        explanation:
          `${task.assignedAgent} does not yet have a production specialist runner, so Agentic generated a manual-review scaffold instead of simulating execution.`,
        nextSteps: [
          "Treat the artifact as planning material until a production execution path exists.",
          "Keep any external side effect behind explicit review."
        ],
        confidence: 0.28
      };
  }
}

function buildAgentResult(task: Task, result: AgentContent, agentDefinition?: AgentDefinition | null): AgentResult {
  const implementationTier = deriveAgentImplementationTier(result.executionMode);

  const artifact = buildArtifact(
    task,
    `${task.title} output`,
    result.content,
    result.artifactType,
    result.executionMode,
    implementationTier,
    result.actionIntent,
    agentDefinition?.id
  );

  return AgentResultSchema.parse({
    agent: task.assignedAgent satisfies AgentName,
    summary: result.summary,
    confidence: result.confidence,
    executionMode: result.executionMode,
    implementationTier,
    artifacts: [artifact],
    proposedToolCalls: [],
    nextSteps: result.nextSteps,
    explanation: result.explanation
  });
}

// List of built-in agent names for reference
export const BUILT_IN_AGENT_NAMES: AgentName[] = [
  "communications",
  "calendar", 
  "workflow",
  "research",
  "knowledge",
  "travel",
  "personal-admin",
  "finance-support",
  "orchestrator"
];

const builtInAgentRunner: AgentRunner = {
  contract: AgentRunnerContractSchema.parse({
    id: "agentic.built-in.deterministic-runner",
    version: RUNNER_CONTRACT_VERSION,
    agentNames: BUILT_IN_AGENT_NAMES,
    declaredCapabilities: [],
    outputModes: [
      "governed_specialist",
      "deterministic_scaffold",
      "manual_review_required"
    ],
    timeoutMs: DEFAULT_AGENT_RUNNER_TIMEOUT_MS,
    telemetryEvents: ["agent.started", "agent.completed", "agent.failed"],
    failureCodes: [
      "validation_failure",
      "permission_denied",
      "dependency_failure",
      "timeout",
      "unsafe_output",
      "unsupported_agent"
    ]
  }),
  run(input) {
    const started = Date.parse(input.telemetry.startedAt);
    const result = buildAgentResult(input.task, contentForBuiltInAgent(input.task, input.requestContext));

    return AgentRunnerOutputSchema.parse({
      result,
      telemetry: {
        ...input.telemetry,
        completedAt: nowIso(),
        durationMs: Math.max(0, Date.now() - started)
      }
    });
  }
};

const customPromptAgentRunner: AgentRunner = {
  contract: AgentRunnerContractSchema.parse({
    id: "agentic.custom-prompt.scaffold-runner",
    version: RUNNER_CONTRACT_VERSION,
    agentNames: BUILT_IN_AGENT_NAMES,
    declaredCapabilities: [],
    outputModes: ["custom_prompt_scaffold"],
    timeoutMs: DEFAULT_AGENT_RUNNER_TIMEOUT_MS,
    telemetryEvents: ["agent.started", "agent.completed", "agent.failed"],
    failureCodes: [
      "validation_failure",
      "permission_denied",
      "dependency_failure",
      "timeout",
      "unsafe_output",
      "unsupported_agent"
    ]
  }),
  run(input) {
    if (!input.agentDefinition) {
      throw new AgentRunnerExecutionError("validation_failure", "Custom prompt runner requires an agent definition.");
    }

    const started = Date.parse(input.telemetry.startedAt);
    const result = buildAgentResult(
      input.task,
      contentForDynamicAgent(input.agentDefinition, input.task, input.requestContext),
      input.agentDefinition
    );

    return AgentRunnerOutputSchema.parse({
      result,
      telemetry: {
        ...input.telemetry,
        completedAt: nowIso(),
        durationMs: Math.max(0, Date.now() - started)
      }
    });
  }
};

// Check if an agent name is a built-in agent
export function isBuiltInAgent(agentName: string): agentName is AgentName {
  return BUILT_IN_AGENT_NAMES.includes(agentName as AgentName);
}

function compareRiskClass(left: Task["riskClass"], right: Task["riskClass"]): number {
  const order = new Map<Task["riskClass"], number>([
    ["R1", 1],
    ["R2", 2],
    ["R3", 3],
    ["R4", 4]
  ]);

  return (order.get(left) ?? Number.POSITIVE_INFINITY) - (order.get(right) ?? Number.POSITIVE_INFINITY);
}

function sideEffectCapabilitiesFor(capabilities: Capability[]): Capability[] {
  return capabilities.filter((capability) => SIDE_EFFECT_CAPABILITIES.has(capability));
}

function permissionsForTask(task: Task, agentDefinition?: AgentDefinition | null) {
  const allowedCapabilities = agentDefinition?.allowedCapabilities ?? task.toolCapabilities;

  return {
    allowedCapabilities,
    blockedCapabilities: agentDefinition?.blockedCapabilities ?? [],
    maxRiskClass: agentDefinition?.maxRiskClass ?? task.riskClass,
    sideEffectCapabilities: sideEffectCapabilitiesFor(allowedCapabilities)
  };
}

function validateRunnerPermissions(input: AgentRunnerInput) {
  assertCapabilitiesWithinAllowlist(input.task.assignedAgent, input.task.toolCapabilities);

  for (const capability of input.task.toolCapabilities) {
    if (input.permissions.blockedCapabilities.includes(capability)) {
      throw new AgentRunnerExecutionError(
        "permission_denied",
        `Agent runner rejected blocked capability "${capability}" for ${input.task.assignedAgent}.`
      );
    }

    if (!input.permissions.allowedCapabilities.includes(capability)) {
      throw new AgentRunnerExecutionError(
        "permission_denied",
        `Agent runner rejected undeclared capability "${capability}" for ${input.task.assignedAgent}.`
      );
    }
  }

  if (compareRiskClass(input.task.riskClass, input.permissions.maxRiskClass) > 0) {
    throw new AgentRunnerExecutionError(
      "permission_denied",
      `Agent runner rejected ${input.task.riskClass} task because max risk is ${input.permissions.maxRiskClass}.`
    );
  }
}

function selectAgentRunner(options?: RunAgentOptions): AgentRunner {
  if (options?.runner) {
    return options.runner;
  }

  return options?.agentDefinition ? customPromptAgentRunner : builtInAgentRunner;
}

function createAgentRunnerInput(task: Task, scenario: string, options?: RunAgentOptions): AgentRunnerInput {
  return AgentRunnerInputSchema.parse({
    task,
    scenario,
    requestContext: options?.requestContext ?? scenario,
    agentDefinition: options?.agentDefinition ?? null,
    permissions: permissionsForTask(task, options?.agentDefinition ?? null),
    timeoutMs: options?.timeoutMs ?? DEFAULT_AGENT_RUNNER_TIMEOUT_MS,
    telemetry: {
      runnerId: selectAgentRunner(options).contract.id,
      executionId: crypto.randomUUID(),
      traceId: options?.traceId ?? null,
      startedAt: nowIso()
    }
  });
}

function describeAgentRunnerFailure(error: unknown): { code: string; retryable: boolean } {
  if (error instanceof AgentRunnerExecutionError) {
    return {
      code: error.code,
      retryable: error.retryable
    };
  }

  return {
    code: "unknown_error",
    retryable: false
  };
}

function buildRunnerFailureFallbackResult(params: {
  task: Task;
  scenario: string;
  runner: AgentRunner;
  agentDefinition?: AgentDefinition | null;
  error: unknown;
}): AgentResult {
  const failure = describeAgentRunnerFailure(params.error);
  const content =
    `Scenario: ${params.scenario}\n\n` +
    `Execution status: the agent runner failed to produce a bounded artifact. Manual review is required.\n\n` +
    `Runner: ${params.runner.contract.id}\n` +
    `Failure code: ${failure.code}\n` +
    `Retryable: ${failure.retryable ? "yes" : "no"}\n\n` +
    "This artifact is an immune-system fallback. No typed execution payload was produced.";

  return buildAgentResult(
    params.task,
    {
      summary: "Prepared a manual-review fallback due to an agent runner failure.",
      artifactType: "summary",
      content,
      executionMode: "manual_review_required",
      explanation:
        "The agent runner failed during execution, so Agentic fell back to a manual-review artifact to keep the workflow resilient and approval-safe.",
      nextSteps: [
        "Review the fallback artifact and retry once dependencies are healthy.",
        "If failures persist, switch to manual execution or adjust agent configuration."
      ],
      confidence: 0.22,
      actionIntent: null
    },
    params.agentDefinition
  );
}

export function validateAgentRunnerRegistration(runner: AgentRunner): AgentRunnerContract {
  const contract = AgentRunnerContractSchema.parse(runner.contract);

  for (const agentName of contract.agentNames) {
    assertCapabilitiesWithinAllowlist(agentName, contract.declaredCapabilities);
  }

  return contract;
}

export function runAgent(task: Task, scenario: string, options?: RunAgentOptions): AgentResult {
  const runner = selectAgentRunner(options);
  validateAgentRunnerRegistration(runner);

  const input = createAgentRunnerInput(task, scenario, options);
  validateRunnerPermissions(input);

  try {
    return runner.run(input).result;
  } catch (error) {
    return buildRunnerFailureFallbackResult({
      task,
      scenario,
      runner,
      agentDefinition: options?.agentDefinition ?? null,
      error
    });
  }
}
