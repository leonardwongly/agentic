import { AgentDefinitionSchema, SubAgentPlanSchema, TaskSchema, nowIso } from "@agentic/contracts";
import { runAgent } from "@agentic/agents";

function buildTask(assignedAgent: "communications" | "travel" | "workflow" | "orchestrator") {
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

  it("supports orchestrator coordination scaffolds without claiming external execution", () => {
    const result = runAgent(buildTask("orchestrator"), "Coordinate specialist agents.");

    expect(result.executionMode).toBe("deterministic_scaffold");
    expect(result.confidence).toBe(0.76);
    expect(result.summary).toMatch(/orchestration scaffold/i);
    expect(result.explanation).toMatch(/deterministic coordination scaffold/i);
    expect(result.artifacts[0]?.metadata).toMatchObject({
      agent: "orchestrator",
      executionMode: "deterministic_scaffold",
      requiresManualReview: false
    });
    expect(result.artifacts[0]?.content).toMatch(/Delegate specialist lanes/i);
  });
});

describe("sub-agent contracts", () => {
  it("validates bounded role responsibilities, guardrails, and handoffs", () => {
    const plan = SubAgentPlanSchema.parse({
      id: "subagents-goal-1",
      goalId: "goal-1",
      anchorTaskId: null,
      parentAgent: "orchestrator",
      coordinationStrategy: "hybrid",
      roles: [
        {
          id: "recon-scoping",
          name: "Recon and Scoping Agent",
          agent: "research",
          role: "Discover affected surfaces before implementation starts.",
          responsibilities: ["Map affected modules and tests."],
          allowedCapabilities: ["read", "search"],
          inputContracts: ["Normalized request."],
          expectedOutputs: ["Affected-surface map."],
          dependsOn: [],
          riskClass: "R2",
          handoffCriteria: ["Evidence is cited."],
          guardrails: ["Read-only unless explicitly assigned implementation ownership."]
        }
      ],
      successCriteria: ["Every spawned role has clear ownership and handoff criteria."],
      createdAt: nowIso()
    });

    expect(plan.roles[0]).toMatchObject({
      id: "recon-scoping",
      agent: "research",
      allowedCapabilities: ["read", "search"]
    });
  });

  it("rejects vague sub-agent roles without explicit responsibilities", () => {
    expect(() =>
      SubAgentPlanSchema.parse({
        id: "subagents-goal-1",
        goalId: "goal-1",
        anchorTaskId: null,
        parentAgent: "orchestrator",
        coordinationStrategy: "parallel",
        roles: [
          {
            id: "empty-role",
            name: "Empty Role",
            agent: "workflow",
            role: "Do work.",
            responsibilities: [],
            allowedCapabilities: ["read"],
            inputContracts: [],
            expectedOutputs: ["Output."],
            dependsOn: [],
            riskClass: "R1",
            handoffCriteria: ["Done."],
            guardrails: ["Stay bounded."]
          }
        ],
        successCriteria: ["Done."],
        createdAt: nowIso()
      })
    ).toThrow();
  });
});
