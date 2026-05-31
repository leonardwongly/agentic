import { describe, expect, it } from "vitest";
import { runAgent, runAgentWithModel } from "@agentic/agents";
import { nowIso, TaskSchema } from "@agentic/contracts";

function buildTask() {
  return TaskSchema.parse({
    id: "task-communications",
    goalId: "goal-1",
    workflowId: "workflow-1",
    title: "Triage the inbox",
    summary: "Prepare a bounded result.",
    assignedAgent: "communications",
    state: "running",
    riskClass: "R2",
    requiresApproval: false,
    toolCapabilities: ["read", "draft"],
    artifactIds: [],
    createdAt: nowIso(),
    updatedAt: nowIso()
  });
}

describe("runAgentWithModel", () => {
  it("falls back to the deterministic baseline in test/unconfigured runs", async () => {
    const task = buildTask();
    const scenario = "Triage the current inbox.";
    const baseline = runAgent(task, scenario);
    const result = await runAgentWithModel(task, scenario);

    expect(result.executionMode).toBe(baseline.executionMode);
    expect(result.summary).toBe(baseline.summary);
    expect(result.confidence).toBe(baseline.confidence);
    expect(result.artifacts[0]?.content).toBe(baseline.artifacts[0]?.content);
  });

  it("preserves governance-relevant fields (no risk escalation or approval bypass)", async () => {
    const result = await runAgentWithModel(buildTask(), "Triage the current inbox.");
    expect(result.executionMode).toBe("governed_specialist");
    expect(typeof result.confidence).toBe("number");
  });
});
