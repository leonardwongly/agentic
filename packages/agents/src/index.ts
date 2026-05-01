import {
  AgentResultSchema,
  ArtifactSchema,
  nowIso,
  type AgentDefinition,
  type AgentExecutionMode,
  type AgentName,
  type AgentResult,
  type ArtifactType,
  type Task
} from "@agentic/contracts";
import { assertCapabilitiesWithinAllowlist } from "@agentic/integrations";

// Options for running an agent with custom configuration
export type RunAgentOptions = {
  agentDefinition?: AgentDefinition;
};

function buildArtifact(
  task: Task,
  title: string,
  content: string,
  artifactType: ArtifactType,
  executionMode: AgentExecutionMode,
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
      requiresManualReview: executionMode === "manual_review_required",
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
};

function summarizePrompt(systemPrompt: string): string {
  return systemPrompt.replace(/\s+/gu, " ").trim().slice(0, 200);
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
    case "communications":
      return {
        summary: "Prepared a deterministic communications playbook artifact.",
        artifactType: "summary",
        content:
          `Scenario: ${scenario}\n\nFocus areas:\n` +
          "- Prioritize urgent threads and VIP senders.\n" +
          "- Extract promised follow-ups and pending external dependencies.\n" +
          "- Hold outbound sending behind approval when the policy outcome requires it.",
        executionMode: "deterministic_scaffold",
        explanation: `communications produced a deterministic playbook artifact for "${task.title}" rather than simulating external execution.`,
        nextSteps: [
          "Persist the artifact on the goal timeline.",
          "Respect approval gates before any external side effect."
        ],
        confidence: task.riskClass === "R1" ? 0.82 : 0.73
      };
    case "calendar":
      return {
        summary: "Prepared a deterministic calendar review artifact.",
        artifactType: "brief",
        content:
          `Scenario: ${scenario}\n\nCalendar findings:\n` +
          "- Map existing commitments against the requested goal.\n" +
          "- Flag overload windows and reschedule candidates.\n" +
          "- Preserve external commitments until the user approves changes.",
        executionMode: "deterministic_scaffold",
        explanation: `calendar produced a deterministic planning artifact for "${task.title}" rather than changing schedule state directly.`,
        nextSteps: [
          "Persist the artifact on the goal timeline.",
          "Respect approval gates before any calendar side effect."
        ],
        confidence: task.riskClass === "R1" ? 0.82 : 0.73
      };
    case "workflow":
      return {
        summary: "Prepared a deterministic workflow scaffold.",
        artifactType: "checklist",
        content:
          `Scenario: ${scenario}\n\nChecklist:\n` +
          "- Capture the top-level goal and dependencies.\n" +
          "- Create low-risk reminders and internal tasks.\n" +
          "- Keep resumable checkpoints for waiting states or partial completion.",
        executionMode: "deterministic_scaffold",
        explanation: `workflow produced a deterministic execution scaffold for "${task.title}".`,
        nextSteps: [
          "Persist the artifact on the goal timeline.",
          "Use the scaffold to drive the next approved workflow step."
        ],
        confidence: task.riskClass === "R1" ? 0.82 : 0.73
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
    case "orchestrator":
      return {
        summary: "Prepared a deterministic orchestration scaffold.",
        artifactType: "checklist",
        content:
          `Scenario: ${scenario}\n\nOrchestration plan:\n` +
          "- Clarify the parent objective, constraints, and trust boundaries.\n" +
          "- Delegate specialist lanes only with explicit responsibilities, capability envelopes, and handoff criteria.\n" +
          "- Merge specialist outputs through one integration checkpoint before claiming completion.",
        executionMode: "deterministic_scaffold",
        explanation: `orchestrator produced a deterministic coordination scaffold for "${task.title}".`,
        nextSteps: [
          "Persist the coordination scaffold on the goal timeline.",
          "Keep specialist work inside the parent policy and capability envelope."
        ],
        confidence: task.riskClass === "R1" ? 0.84 : 0.76
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

export function runAgent(task: Task, scenario: string, options?: RunAgentOptions): AgentResult {
  // Enforce that every capability granted to this agent is within its type-level allowlist.
  assertCapabilitiesWithinAllowlist(task.assignedAgent, task.toolCapabilities);

  // Use dynamic agent definition if provided, otherwise fall back to built-in
  const result = options?.agentDefinition
    ? contentForDynamicAgent(options.agentDefinition, task, scenario)
    : contentForBuiltInAgent(task, scenario);

  const agentId = options?.agentDefinition?.id;
  const artifact = buildArtifact(task, `${task.title} output`, result.content, result.artifactType, result.executionMode, agentId);

  return AgentResultSchema.parse({
    agent: task.assignedAgent satisfies AgentName,
    summary: result.summary,
    confidence: result.confidence,
    executionMode: result.executionMode,
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

// Check if an agent name is a built-in agent
export function isBuiltInAgent(agentName: string): agentName is AgentName {
  return BUILT_IN_AGENT_NAMES.includes(agentName as AgentName);
}
