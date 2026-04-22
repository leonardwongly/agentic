import { AgentDefinitionSchema, TaskSchema, nowIso } from "@agentic/contracts";
import { runAgent } from "@agentic/agents";

function buildTask(
  assignedAgent: "calendar" | "communications" | "travel" | "workflow",
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
});
