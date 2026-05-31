import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { nowIso, TaskSchema } from "@agentic/contracts";

const modelMockState = vi.hoisted(() => ({
  extractionThrows: false,
  prompts: [] as string[]
}));

// Body prompt -> canned prose; action-extraction prompt -> a send request the model "proposes".
vi.mock("../packages/agents/src/model-runner", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../packages/agents/src/model-runner")>();
  return {
    ...actual,
    isModelConfigured: () => true,
    runTextModel: async ({ prompt }: { prompt: string }) => {
      modelMockState.prompts.push(prompt);
      if (!prompt.includes("Extract a single")) {
        return "MODEL BODY";
      }
      if (modelMockState.extractionThrows) {
        throw new Error("transient extraction failure");
      }
      return "To: sarah@example.com\nSubject: Launch delay\nBody: Heads up, the launch slips a week.\nMode: send";
    }
  };
});

import { runAgentWithModel } from "@agentic/agents";

function buildTask(toolCapabilities: string[]) {
  return TaskSchema.parse({
    id: "task-communications",
    goalId: "goal-1",
    workflowId: "workflow-1",
    title: "Notify about the launch delay",
    summary: "Prepare a bounded result.",
    assignedAgent: "communications",
    state: "running",
    riskClass: "R3",
    requiresApproval: false,
    toolCapabilities,
    artifactIds: [],
    createdAt: nowIso(),
    updatedAt: nowIso()
  });
}

function actionIntentOf(result: { artifacts: Array<{ metadata: Record<string, unknown> }> }) {
  return result.artifacts[0]?.metadata.actionIntent as { type?: string; mode?: string } | undefined;
}

let savedNodeEnv: string | undefined;
beforeEach(() => {
  savedNodeEnv = process.env.NODE_ENV;
  process.env.NODE_ENV = "production";
  modelMockState.extractionThrows = false;
  modelMockState.prompts = [];
});
afterEach(() => {
  if (savedNodeEnv === undefined) delete process.env.NODE_ENV;
  else process.env.NODE_ENV = savedNodeEnv;
});

describe("model-proposed action gating", () => {
  it("accepts a proposed send only when the task carries the send capability", async () => {
    const result = await runAgentWithModel(buildTask(["read", "draft", "send"]), "Email Sarah about the delay.");
    const intent = actionIntentOf(result);
    expect(intent?.type).toBe("send_message");
    expect(intent?.mode).toBe("send");
  });

  it("rejects an over-privileged proposed send when the task lacks the send capability", async () => {
    const result = await runAgentWithModel(buildTask(["read", "draft"]), "Email Sarah about the delay.");
    expect(actionIntentOf(result)).toBeUndefined();
  });

  it("proposes no action when the task has no action capability at all", async () => {
    const result = await runAgentWithModel(buildTask(["read"]), "Email Sarah about the delay.");
    expect(actionIntentOf(result)).toBeUndefined();
  });

  it("uses requestContext for model prompting and action extraction when provided", async () => {
    await runAgentWithModel(buildTask(["read", "draft", "send"]), "Generic communications catalog item.", {
      requestContext: "Email Sarah about the launch delay with a one-week slip."
    });

    expect(modelMockState.prompts[0]).toContain("Email Sarah about the launch delay with a one-week slip.");
    expect(modelMockState.prompts[0]).not.toContain("Scenario: Generic communications catalog item.");
    expect(modelMockState.prompts[1]).toContain("Request: Email Sarah about the launch delay with a one-week slip.");
  });

  it("keeps the generated artifact when optional action extraction fails", async () => {
    modelMockState.extractionThrows = true;

    const result = await runAgentWithModel(buildTask(["read", "draft", "send"]), "Email Sarah about the delay.");

    expect(result.artifacts[0]?.content).toBe("MODEL BODY");
    expect(actionIntentOf(result)).toBeUndefined();
  });
});
