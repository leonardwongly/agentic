import { AgentDefinitionSchema, TaskSchema, nowIso } from "@agentic/contracts";
import { runAgent } from "@agentic/agents";

function buildTask(assignedAgent: "communications" | "travel" | "workflow") {
  return TaskSchema.parse({
    id: `task-${assignedAgent}`,
    goalId: "goal-1",
    workflowId: "workflow-1",
    title: `Task for ${assignedAgent}`,
    summary: "Prepare a bounded result.",
    assignedAgent,
    state: "running",
    riskClass: "R2",
    requiresApproval: false,
    toolCapabilities: ["read", "search"],
    artifactIds: [],
    createdAt: nowIso(),
    updatedAt: nowIso()
  });
}

describe("runAgent", () => {
  it("marks built-in deterministic scaffolds explicitly in the result and artifact metadata", () => {
    const result = runAgent(buildTask("communications"), "Triage the current inbox.");

    expect(result.executionMode).toBe("deterministic_scaffold");
    expect(result.explanation).toMatch(/deterministic playbook artifact/i);
    expect(result.confidence).toBe(0.73);
    expect(result.artifacts[0]?.metadata).toMatchObject({
      agent: "communications",
      executionMode: "deterministic_scaffold",
      requiresManualReview: false
    });
  });

  it("marks custom agents as prompt-backed scaffolds instead of simulated execution", () => {
    const result = runAgent(buildTask("workflow"), "Draft a delivery plan.", {
      agentDefinition: AgentDefinitionSchema.parse({
        id: "agent-custom-1",
        userId: "user-1",
        name: "deal-desk",
        displayName: "Deal Desk",
        description: "Prepares commercial delivery artifacts.",
        systemPrompt: "Produce concise deal desk execution plans with clear checkpoints and risks.",
        artifactType: "draft",
        allowedCapabilities: ["read", "search", "draft"],
        createdAt: nowIso(),
        updatedAt: nowIso()
      })
    });

    expect(result.executionMode).toBe("custom_prompt_scaffold");
    expect(result.confidence).toBe(0.58);
    expect(result.explanation).toMatch(/execution remains scaffolded/i);
    expect(result.artifacts[0]?.metadata).toMatchObject({
      agent: "workflow",
      executionMode: "custom_prompt_scaffold",
      requiresManualReview: false,
      agentDefinitionId: "agent-custom-1"
    });
    expect(result.artifacts[0]?.content).toMatch(/no model-backed specialist runner is active/i);
  });

  it("flags unsupported built-ins for manual review instead of claiming specialist execution", () => {
    const result = runAgent(buildTask("travel"), "Prepare next week's itinerary.");

    expect(result.executionMode).toBe("manual_review_required");
    expect(result.confidence).toBe(0.28);
    expect(result.summary).toMatch(/manual-review scaffold/i);
    expect(result.explanation).toMatch(/does not yet have a production specialist runner/i);
    expect(result.artifacts[0]?.metadata).toMatchObject({
      agent: "travel",
      executionMode: "manual_review_required",
      requiresManualReview: true
    });
    expect(result.artifacts[0]?.content).toMatch(/planning material only/i);
  });
});
