import { AgentResultSchema, ArtifactSchema, nowIso, type AgentDefinition, type AgentName, type AgentResult, type Task } from "@agentic/contracts";
import { assertCapabilitiesWithinAllowlist } from "@agentic/integrations";

// Options for running an agent with custom configuration
export type RunAgentOptions = {
  agentDefinition?: AgentDefinition;
};

function buildArtifact(
  task: Task,
  title: string,
  content: string,
  artifactType: "summary" | "brief" | "checklist" | "draft" | "explanation",
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
      ...(agentId && { agentDefinitionId: agentId })
    },
    createdAt: nowIso()
  });
}

// Generate content for dynamic agent definitions
function contentForDynamicAgent(
  agent: AgentDefinition,
  task: Task,
  scenario: string
): { summary: string; artifactType: "summary" | "brief" | "checklist" | "draft" | "explanation"; content: string } {
  const artifactType = agent.artifactType as "summary" | "brief" | "checklist" | "draft" | "explanation";
  
  return {
    summary: `${agent.displayName} processed "${task.title}".`,
    artifactType,
    content: `Scenario: ${scenario}\n\nAgent: ${agent.displayName}\n\nSystem prompt preview:\n${agent.systemPrompt.slice(0, 200)}...\n\nThis task was processed by a custom agent configuration.`
  };
}

// Generate content for built-in agents (fallback)
function contentForBuiltInAgent(task: Task, scenario: string): { summary: string; artifactType: "summary" | "brief" | "checklist" | "draft" | "explanation"; content: string } {
  switch (task.assignedAgent) {
    case "communications":
      return {
        summary: "Triaged communication surfaces and prepared sender-aware follow-up guidance.",
        artifactType: "summary",
        content: `Scenario: ${scenario}\n\nFocus areas:\n- Prioritize urgent threads and VIP senders.\n- Extract promised follow-ups and pending external dependencies.\n- Hold outbound sending behind approval when the policy outcome requires it.`
      };
    case "calendar":
      return {
        summary: "Reviewed schedule pressure, conflicts, and commitment windows.",
        artifactType: "brief",
        content: `Scenario: ${scenario}\n\nCalendar findings:\n- Map existing commitments against the requested goal.\n- Flag overload windows and reschedule candidates.\n- Preserve external commitments until the user approves changes.`
      };
    case "workflow":
      return {
        summary: "Converted the request into a concrete workflow with checkpoints and reminders.",
        artifactType: "checklist",
        content: `Scenario: ${scenario}\n\nChecklist:\n- Capture the top-level goal and dependencies.\n- Create low-risk reminders and internal tasks.\n- Keep resumable checkpoints for waiting states or partial completion.`
      };
    case "research":
      return {
        summary: "Prepared an evidence-backed briefing with next-step framing.",
        artifactType: "brief",
        content: `Scenario: ${scenario}\n\nResearch approach:\n- Summarize the current situation.\n- Compare options with risks and assumptions.\n- Separate confirmed evidence from inferred recommendations.`
      };
    case "knowledge":
      return {
        summary: "Resolved relevant memory and standing instructions for the current goal.",
        artifactType: "explanation",
        content: `Scenario: ${scenario}\n\nKnowledge retrieval:\n- Pull confirmed preferences first.\n- Add recent working state and episodic context.\n- Avoid surfacing stale or low-confidence memories as facts.`
      };
    default:
      return {
        summary: "Prepared a bounded specialist output.",
        artifactType: "summary",
        content: `Scenario: ${scenario}\n\nThis task is represented as a specialist placeholder until a deeper implementation replaces it.`
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
  const artifact = buildArtifact(task, `${task.title} output`, result.content, result.artifactType, agentId);

  // Determine confidence based on agent source and risk class
  const baseConfidence = options?.agentDefinition
    ? 0.75
    : (task.riskClass === "R1" ? 0.82 : 0.73);

  return AgentResultSchema.parse({
    agent: task.assignedAgent satisfies AgentName,
    summary: result.summary,
    confidence: baseConfidence,
    artifacts: [artifact],
    proposedToolCalls: [],
    nextSteps: [
      "Persist the artifact on the goal timeline.",
      "Respect approval gates before any external side effect."
    ],
    explanation: `${task.assignedAgent} produced a schema-validated result for "${task.title}".`
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