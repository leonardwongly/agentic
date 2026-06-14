import { enrichAgentResultEnvelopeWithModel, runAgent } from "@agentic/agents";
import { TaskSchema, nowIso, type AgentName, type Task } from "@agentic/contracts";
import { describe, expect, it } from "vitest";

function task(agent: AgentName, overrides: Record<string, unknown> = {}): Task {
  return TaskSchema.parse({
    id: `task-${agent}`,
    goalId: "g1",
    workflowId: "w1",
    title: `${agent} task`,
    summary: "Do bounded work.",
    assignedAgent: agent,
    state: "running",
    riskClass: "R2",
    requiresApproval: false,
    toolCapabilities: ["read", "search"],
    artifactIds: [],
    createdAt: nowIso(),
    updatedAt: nowIso(),
    ...overrides
  });
}

describe("agents emit the structured envelope (AOS-23)", () => {
  it.each(["workflow", "research", "knowledge"] as const)("emits an envelope for %s", (agent) => {
    const result = runAgent(task(agent), "Coordinate bounded work.");

    expect(result.status).toBeDefined();
    expect(["recommendation", "action_result"]).toContain(result.resultType);
    expect(result.evidenceRefs.length).toBeGreaterThanOrEqual(2);
    expect(result.evidenceRefs.some((ref) => ref.startsWith("artifact:"))).toBe(true);
    expect(Array.isArray(result.proposedActions)).toBe(true);
  });

  it("flags approval-gated tasks in riskFlags", () => {
    const result = runAgent(
      task("workflow", { riskClass: "R3", requiresApproval: true, toolCapabilities: ["read", "create"] }),
      "Coordinate higher-risk work."
    );

    expect(result.riskFlags).toContain("external_action_requires_approval");
    expect(result.riskFlags).toContain("human_approval_required");
  });

  it("marks manual-review agents as needs_approval", () => {
    const result = runAgent(task("travel"), "Plan a trip checklist.");

    expect(result.executionMode).toBe("manual_review_required");
    expect(result.status).toBe("needs_approval");
  });

  it("emits empty proposedActions and a recommendation when no action is produced", () => {
    const result = runAgent(task("research"), "Summarize background research.");

    expect(result.proposedActions).toEqual([]);
    expect(result.resultType).toBe("recommendation");
  });
});

describe("model-backed envelope enrichment (AOS-23)", () => {
  const base = runAgent(task("workflow"), "Coordinate bounded work.");
  const enrich = (modelClient: (req: { prompt: string; maxTokens: number }) => Promise<string | null>) =>
    enrichAgentResultEnvelopeWithModel(base, "scenario", { enabled: true, isConfigured: () => true, modelClient });

  it("merges model-provided assumptions and risk flags", async () => {
    const result = await enrich(async () =>
      JSON.stringify({ assumptions: ["Operator wants drafts, not sends"], riskFlags: ["external_send"] })
    );

    expect(result.assumptions).toContain("Operator wants drafts, not sends");
    expect(result.riskFlags).toContain("external_send");
  });

  it("ignores extra keys so the model cannot inject status or actions", async () => {
    const result = await enrich(async () =>
      JSON.stringify({ assumptions: ["a"], riskFlags: ["b"], status: "success", proposedActions: [{ type: "manual_review" }] })
    );

    // The strict enrichment schema rejects extra keys, so the result is unchanged.
    expect(result.assumptions).toEqual(base.assumptions);
    expect(result.status).toBe(base.status);
    expect(result.proposedActions).toEqual(base.proposedActions);
  });

  it("returns the result unchanged on malformed, oversized, or null model output", async () => {
    expect((await enrich(async () => "not json")).assumptions).toEqual(base.assumptions);
    expect((await enrich(async () => "{" + "x".repeat(5_000))).assumptions).toEqual(base.assumptions);
    expect((await enrich(async () => null)).assumptions).toEqual(base.assumptions);
  });

  it("is a no-op when disabled or unconfigured", async () => {
    const payload = async () => JSON.stringify({ assumptions: ["x"], riskFlags: [] });
    const disabled = await enrichAgentResultEnvelopeWithModel(base, "s", {
      enabled: false,
      isConfigured: () => true,
      modelClient: payload
    });
    const unconfigured = await enrichAgentResultEnvelopeWithModel(base, "s", {
      enabled: true,
      isConfigured: () => false,
      modelClient: payload
    });

    expect(disabled.assumptions).toEqual(base.assumptions);
    expect(unconfigured.assumptions).toEqual(base.assumptions);
  });
});
