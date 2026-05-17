import { AgentDefinitionSchema, AgentRunnerContractSchema, SubAgentPlanSchema, TaskSchema, nowIso } from "@agentic/contracts";
import { AgentRunnerExecutionError, runAgent, validateAgentRunnerRegistration, type AgentRunner } from "@agentic/agents";

function buildTask(
  assignedAgent: "calendar" | "communications" | "orchestrator" | "travel" | "workflow",
  toolCapabilities: Array<"create" | "draft" | "monitor" | "read" | "schedule" | "search" | "send"> = ["read", "search"]
) {
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
    toolCapabilities,
    artifactIds: [],
    createdAt: nowIso(),
    updatedAt: nowIso()
  });
}

describe("runAgent", () => {
  it("marks selected production wedges as governed specialists in the result and artifact metadata", () => {
    const result = runAgent(buildTask("communications"), "Triage the current inbox.");

    expect(result.executionMode).toBe("governed_specialist");
    expect(result.implementationTier).toBe("production");
    expect(result.explanation).toMatch(/selected governed specialist wedge/i);
    expect(result.confidence).toBe(0.73);
    expect(result.artifacts[0]?.metadata).toMatchObject({
      agent: "communications",
      executionMode: "governed_specialist",
      implementationTier: "production",
      requiresManualReview: false
    });
    expect(result.artifacts[0]?.content).toMatch(/No typed outbound message intent was captured/i);
    expect(result.artifacts[0]?.metadata.actionIntent).toBeUndefined();
    expect(result.artifacts[0]?.metadata.executionIntent).toBeUndefined();
  });

  it("emits typed send_message intents only when explicit communications cues validate", () => {
    const result = runAgent(
      buildTask("communications", ["draft", "read", "search", "send"]),
      'Triage the inbox. To: client@example.com Subject: Follow-up Body: "Approved response body." Mode: draft Thread-ID: thread-123'
    );
    const artifact = result.artifacts[0];

    expect(result.executionMode).toBe("governed_specialist");
    expect(result.implementationTier).toBe("production");
    expect(artifact?.content).toMatch(/typed outbound message intent was captured/i);
    expect(artifact?.metadata).toMatchObject({
      agent: "communications",
      actionIntent: {
        type: "send_message",
        to: "client@example.com",
        subject: "Follow-up",
        body: "Approved response body.",
        mode: "draft",
        threadId: "thread-123"
      },
      executionIntent: {
        type: "send_message",
        to: "client@example.com",
        subject: "Follow-up",
        body: "Approved response body.",
        mode: "draft",
        threadId: "thread-123"
      }
    });
  });

  it("emits typed schedule_event intents only when explicit calendar cues validate", () => {
    const result = runAgent(
      buildTask("calendar", ["read", "schedule", "search"]),
      "Plan the week. Event: Customer handoff Start: 2026-04-20T09:00:00.000Z End: 2026-04-20T09:30:00.000Z Attendees: owner@example.com, client@example.com Description: Share next steps."
    );
    const artifact = result.artifacts[0];

    expect(result.executionMode).toBe("governed_specialist");
    expect(result.implementationTier).toBe("production");
    expect(artifact?.content).toMatch(/typed scheduling intent was captured/i);
    expect(artifact?.metadata).toMatchObject({
      agent: "calendar",
      actionIntent: {
        type: "schedule_event",
        summary: "Customer handoff",
        start: "2026-04-20T09:00:00.000Z",
        end: "2026-04-20T09:30:00.000Z",
        attendees: ["owner@example.com", "client@example.com"],
        description: "Share next steps."
      },
      executionIntent: {
        type: "schedule_event",
        summary: "Customer handoff",
        start: "2026-04-20T09:00:00.000Z",
        end: "2026-04-20T09:30:00.000Z",
        attendees: ["owner@example.com", "client@example.com"],
        description: "Share next steps."
      }
    });
  });

  it("emits typed note intents for workflow scaffolds that already own create capability", () => {
    const result = runAgent(buildTask("workflow", ["create", "monitor"]), "Convert follow-ups into a bounded workflow.");
    const artifact = result.artifacts[0];

    expect(result.executionMode).toBe("deterministic_scaffold");
    expect(result.implementationTier).toBe("experimental");
    expect(artifact?.metadata).toMatchObject({
      agent: "workflow",
      executionMode: "deterministic_scaffold",
      implementationTier: "experimental",
      requiresManualReview: false,
      actionIntent: {
        type: "create_note",
        title: "Task for workflow"
      },
      executionIntent: {
        type: "create_note",
        title: "Task for workflow"
      }
    });
    expect(artifact?.metadata.actionIntent).toMatchObject({
      content: artifact?.content
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
    expect(result.implementationTier).toBe("experimental");
    expect(result.confidence).toBe(0.58);
    expect(result.explanation).toMatch(/execution remains scaffolded/i);
    expect(result.artifacts[0]?.metadata).toMatchObject({
      agent: "workflow",
      executionMode: "custom_prompt_scaffold",
      implementationTier: "experimental",
      requiresManualReview: false,
      agentDefinitionId: "agent-custom-1"
    });
    expect(result.artifacts[0]?.content).toMatch(/no model-backed specialist runner is active/i);
  });

  it("rejects custom runner execution when the task asks for undeclared capabilities", () => {
    const agentDefinition = AgentDefinitionSchema.parse({
      id: "agent-custom-locked",
      userId: "user-1",
      name: "locked-deal-desk",
      displayName: "Locked Deal Desk",
      description: "Prepares commercial delivery artifacts without outbound actions.",
      systemPrompt: "Produce concise deal desk execution plans with clear checkpoints and risks.",
      artifactType: "draft",
      allowedCapabilities: ["read", "search"],
      createdAt: nowIso(),
      updatedAt: nowIso()
    });

    expect(() =>
      runAgent(
        buildTask("communications", ["read", "search", "draft"]),
        "Prepare a reply draft.",
        {
          agentDefinition
        }
      )
    ).toThrow(AgentRunnerExecutionError);

    try {
      runAgent(
        buildTask("communications", ["read", "search", "draft"]),
        "Prepare a reply draft.",
        {
          agentDefinition
        }
      );
    } catch (error) {
      expect(error).toBeInstanceOf(AgentRunnerExecutionError);
      expect((error as AgentRunnerExecutionError).code).toBe("permission_denied");
      expect((error as Error).message).toContain('undeclared capability "draft"');
    }
  });

  it("flags unsupported built-ins for manual review instead of claiming specialist execution", () => {
    const result = runAgent(buildTask("travel"), "Prepare next week's itinerary.");

    expect(result.executionMode).toBe("manual_review_required");
    expect(result.implementationTier).toBe("experimental");
    expect(result.confidence).toBe(0.28);
    expect(result.summary).toMatch(/manual-review scaffold/i);
    expect(result.explanation).toMatch(/does not yet have a production specialist runner/i);
    expect(result.artifacts[0]?.metadata).toMatchObject({
      agent: "travel",
      executionMode: "manual_review_required",
      implementationTier: "experimental",
      requiresManualReview: true
    });
    expect(result.artifacts[0]?.content).toMatch(/planning material only/i);
  });

  it("falls back to a manual-review artifact when the runner throws, without leaking the error message", () => {
    const runner: AgentRunner = {
      contract: AgentRunnerContractSchema.parse({
        id: "agentic.test.throwing-runner",
        version: "v1",
        agentNames: ["communications"],
        declaredCapabilities: [],
        outputModes: ["governed_specialist"],
        timeoutMs: 1000,
        telemetryEvents: ["agent.started", "agent.completed", "agent.failed"],
        failureCodes: ["dependency_failure"]
      }),
      run() {
        throw new Error("Synthetic runner failure with secret-token-like value");
      }
    };

    const result = runAgent(buildTask("communications"), "Triage the inbox.", { runner });

    expect(result.executionMode).toBe("manual_review_required");
    expect(result.artifacts[0]?.metadata.requiresManualReview).toBe(true);
    expect(result.summary).toMatch(/manual-review fallback/i);
    expect(result.artifacts[0]?.content).toContain("Failure code: unknown_error");
    expect(result.artifacts[0]?.content).not.toContain("secret-token-like");
  });

  it("falls back when a custom runner returns output outside its declared contract", () => {
    const runner: AgentRunner = {
      contract: AgentRunnerContractSchema.parse({
        id: "agentic.test.unsafe-output-runner",
        version: "v1",
        agentNames: ["communications"],
        declaredCapabilities: [],
        outputModes: ["governed_specialist"],
        timeoutMs: 1000,
        telemetryEvents: ["agent.started", "agent.completed", "agent.failed"],
        failureCodes: ["unsafe_output"]
      }),
      run(input) {
        return {
          result: {
            agent: "communications",
            summary: "Returned undeclared scaffold output.",
            confidence: 0.91,
            executionMode: "deterministic_scaffold",
            implementationTier: "experimental",
            artifacts: [],
            proposedToolCalls: [],
            nextSteps: [],
            explanation: "This output is deliberately outside the runner contract."
          },
          telemetry: {
            ...input.telemetry,
            completedAt: nowIso(),
            durationMs: 0
          }
        };
      }
    };

    const result = runAgent(buildTask("communications"), "Triage the inbox.", { runner });

    expect(result.executionMode).toBe("manual_review_required");
    expect(result.artifacts[0]?.metadata.requiresManualReview).toBe(true);
    expect(result.artifacts[0]?.content).toContain("Failure code: unsafe_output");
  });

  it("supports orchestrator coordination scaffolds without claiming external execution", () => {
    const result = runAgent(buildTask("orchestrator"), "Coordinate specialist agents.");

    expect(result.executionMode).toBe("deterministic_scaffold");
    expect(result.implementationTier).toBe("experimental");
    expect(result.confidence).toBe(0.76);
    expect(result.summary).toMatch(/orchestration scaffold/i);
    expect(result.explanation).toMatch(/deterministic coordination scaffold/i);
    expect(result.artifacts[0]?.metadata).toMatchObject({
      agent: "orchestrator",
      executionMode: "deterministic_scaffold",
      implementationTier: "experimental",
      requiresManualReview: false
    });
    expect(result.artifacts[0]?.content).toMatch(/Delegate specialist lanes/i);
  });

  it("validates runner registration contracts and rejects unsupported capability claims", () => {
    const runner: AgentRunner = {
      contract: AgentRunnerContractSchema.parse({
        id: "agentic.test.invalid-runner",
        version: "v1",
        agentNames: ["communications"],
        declaredCapabilities: ["delete"],
        outputModes: ["governed_specialist"],
        timeoutMs: 1000,
        telemetryEvents: ["agent.started", "agent.completed"],
        failureCodes: ["validation_failure", "permission_denied"]
      }),
      run(input) {
        throw new AgentRunnerExecutionError(
          "unsupported_agent",
          `Unexpected test runner invocation for ${input.task.assignedAgent}.`
        );
      }
    };

    expect(() => validateAgentRunnerRegistration(runner)).toThrow(/outside its allowlist/i);
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
