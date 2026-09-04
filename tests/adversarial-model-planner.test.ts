import { describe, expect, it, vi } from "vitest";
import { createModelPlanner } from "@agentic/orchestrator";

describe("adversarial model planner inputs", () => {
  it("returns null when the model client throws", async () => {
    const planner = createModelPlanner({
      enabled: true,
      isConfigured: () => true,
      modelClient: async () => { throw new Error("Model provider unavailable"); }
    });
    expect(await planner.plan({ request: "Plan something" })).toBeNull();
  });

  it("returns null when the model returns null", async () => {
    const planner = createModelPlanner({
      enabled: true,
      isConfigured: () => true,
      modelClient: async () => null
    });
    expect(await planner.plan({ request: "Plan something" })).toBeNull();
  });

  it("returns null when the model output exceeds the character limit", async () => {
    const planner = createModelPlanner({
      enabled: true,
      isConfigured: () => true,
      modelClient: async () => "x".repeat(8_001)
    });
    expect(await planner.plan({ request: "Plan something" })).toBeNull();
  });

  it("returns null when the model output is not valid JSON", async () => {
    const planner = createModelPlanner({
      enabled: true,
      isConfigured: () => true,
      modelClient: async () => "This is not JSON at all"
    });
    expect(await planner.plan({ request: "Plan something" })).toBeNull();
  });

  it("returns null when the model output contains JSON with wrong schema", async () => {
    const planner = createModelPlanner({
      enabled: true,
      isConfigured: () => true,
      modelClient: async () => JSON.stringify({ tasks: [{ title: "Missing required fields" }] })
    });
    expect(await planner.plan({ request: "Plan something" })).toBeNull();
  });

  it("returns null when the model output has an empty tasks array", async () => {
    const planner = createModelPlanner({
      enabled: true,
      isConfigured: () => true,
      modelClient: async () => JSON.stringify({ tasks: [] })
    });
    expect(await planner.plan({ request: "Plan something" })).toBeNull();
  });

  it("returns null when disabled even if the model is configured", async () => {
    const modelClient = vi.fn().mockResolvedValue('{"tasks":[]}');
    const planner = createModelPlanner({ enabled: false, isConfigured: () => true, modelClient });
    expect(await planner.plan({ request: "Plan something" })).toBeNull();
    expect(modelClient).not.toHaveBeenCalled();
  });

  it("returns null when the model is not configured even if enabled", async () => {
    const modelClient = vi.fn().mockResolvedValue('{"tasks":[]}');
    const planner = createModelPlanner({ enabled: true, isConfigured: () => false, modelClient });
    expect(await planner.plan({ request: "Plan something" })).toBeNull();
    expect(modelClient).not.toHaveBeenCalled();
  });

  it("extracts JSON from surrounding prose", async () => {
    const validResponse = 'Here is your plan:\n{"tasks":[{"title":"Do thing","summary":"A thing to do","assignedAgent":"workflow","capabilities":["read"],"riskClass":"R2","confidence":0.8}]}\nHope this helps!';
    const planner = createModelPlanner({
      enabled: true,
      isConfigured: () => true,
      modelClient: async () => validResponse
    });
    const result = await planner.plan({ request: "Plan something" });
    expect(result).not.toBeNull();
    expect(result).toHaveLength(1);
    expect(result![0]?.title).toBe("Do thing");
  });

  it("returns null when JSON has no opening brace", async () => {
    const planner = createModelPlanner({
      enabled: true,
      isConfigured: () => true,
      modelClient: async () => 'tasks:[{"title":"No braces"}]}'
    });
    expect(await planner.plan({ request: "Plan something" })).toBeNull();
  });

  it("accepts a valid plan with the maximum 12 tasks", async () => {
    const tasks = Array.from({ length: 12 }, (_, i) => ({
      title: `Task ${i}`,
      summary: `Summary for task ${i}`,
      assignedAgent: "workflow",
      capabilities: ["read"],
      riskClass: "R2",
      confidence: 0.7
    }));
    const planner = createModelPlanner({
      enabled: true,
      isConfigured: () => true,
      modelClient: async () => JSON.stringify({ tasks })
    });
    const result = await planner.plan({ request: "Plan something complex" });
    expect(result).toHaveLength(12);
  });

  it("returns null when the plan has more than 12 tasks", async () => {
    const tasks = Array.from({ length: 13 }, (_, i) => ({
      title: `Task ${i}`,
      summary: `Summary for task ${i}`,
      assignedAgent: "workflow",
      capabilities: ["read"],
      riskClass: "R2",
      confidence: 0.7
    }));
    const planner = createModelPlanner({
      enabled: true,
      isConfigured: () => true,
      modelClient: async () => JSON.stringify({ tasks })
    });
    expect(await planner.plan({ request: "Plan something too complex" })).toBeNull();
  });
});
