import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { nowIso, TaskSchema } from "@agentic/contracts";

const CANNED = "MODEL-GENERATED ARTIFACT BODY";

// Force the model path on and stub the provider so the eval runs offline/deterministically.
vi.mock("../packages/agents/src/model-runner", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../packages/agents/src/model-runner")>();
  return { ...actual, isModelConfigured: () => true, runTextModel: async () => CANNED };
});

import { runAgent, runAgentWithModel } from "@agentic/agents";

function buildTask(
  assignedAgent: "communications" | "calendar" | "workflow",
  riskClass: "R1" | "R2" | "R3",
  toolCapabilities: string[]
) {
  return TaskSchema.parse({
    id: `task-${assignedAgent}`,
    goalId: "goal-1",
    workflowId: "workflow-1",
    title: `Task for ${assignedAgent}`,
    summary: "Prepare a bounded result.",
    assignedAgent,
    state: "running",
    riskClass,
    requiresApproval: false,
    toolCapabilities,
    artifactIds: [],
    createdAt: nowIso(),
    updatedAt: nowIso()
  });
}

const GOLDEN = [
  buildTask("communications", "R2", ["read", "draft"]),
  buildTask("calendar", "R3", ["read", "schedule"]),
  buildTask("workflow", "R1", ["read", "draft", "create"])
];

let savedNodeEnv: string | undefined;
beforeEach(() => {
  savedNodeEnv = process.env.NODE_ENV;
  process.env.NODE_ENV = "production";
});
afterEach(() => {
  if (savedNodeEnv === undefined) delete process.env.NODE_ENV;
  else process.env.NODE_ENV = savedNodeEnv;
});

describe("runAgentWithModel eval gate", () => {
  it("model-backs the artifact body but never alters governance-relevant fields", async () => {
    for (const task of GOLDEN) {
      const baseline = runAgent(task, "Handle the request.");
      const result = await runAgentWithModel(task, "Handle the request.");

      // Model path was taken and changed the human-readable body...
      expect(result.artifacts[0]?.content).toBe(CANNED);
      expect(result.artifacts[0]?.content).not.toBe(baseline.artifacts[0]?.content);

      // ...while risk/approval-governing fields stay exactly as the deterministic runner produced them.
      expect(result.executionMode).toBe(baseline.executionMode);
      expect(result.confidence).toBe(baseline.confidence);
      expect(result.artifacts[0]?.metadata).toEqual(baseline.artifacts[0]?.metadata);
    }
  });
});
