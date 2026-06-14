import { mkdtemp } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { DEFAULT_OWNER_USER_ID } from "@agentic/contracts";
import { createModelPlanner, processUserRequest, type Planner, type PlannerModelClient } from "@agentic/orchestrator";
import { createRepository } from "@agentic/repository";
import { describe, expect, it } from "vitest";

const validPlanJson = JSON.stringify({
  tasks: [
    {
      title: "Scope the request",
      summary: "Clarify goals and constraints.",
      assignedAgent: "workflow",
      capabilities: ["read", "search"],
      riskClass: "R1",
      confidence: 0.7
    },
    {
      title: "Draft the plan",
      summary: "Write a safe draft plan before any action.",
      assignedAgent: "workflow",
      capabilities: ["draft", "create"],
      riskClass: "R2",
      confidence: 0.66
    }
  ]
});

function planner(modelClient: PlannerModelClient): Planner {
  return createModelPlanner({ enabled: true, isConfigured: () => true, modelClient });
}

describe("model-backed planner (AOS-22)", () => {
  it("produces validated tasks from well-formed model output", async () => {
    const result = await planner(async () => validPlanJson).plan({ request: "Organize my office move." });
    expect(result).toHaveLength(2);
    expect(result?.[0]).toMatchObject({ assignedAgent: "workflow", title: "Scope the request" });
  });

  it("tolerates markdown-fenced JSON", async () => {
    const result = await planner(async () => "```json\n" + validPlanJson + "\n```").plan({ request: "x" });
    expect(result).toHaveLength(2);
  });

  it("falls back (null) on malformed model output", async () => {
    expect(await planner(async () => "not json at all").plan({ request: "x" })).toBeNull();
  });

  it("falls back (null) on oversized output", async () => {
    expect(await planner(async () => "{" + "a".repeat(9_000)).plan({ request: "x" })).toBeNull();
  });

  it("rejects capability escalation beyond the agent allowlist", async () => {
    const escalation = JSON.stringify({
      tasks: [{ title: "x", summary: "y", assignedAgent: "research", capabilities: ["delete"], riskClass: "R2", confidence: 0.7 }]
    });
    expect(await planner(async () => escalation).plan({ request: "x" })).toBeNull();
  });

  it("rejects unknown agents and invalid capabilities", async () => {
    const unknownAgent = JSON.stringify({
      tasks: [{ title: "x", summary: "y", assignedAgent: "rogue", capabilities: ["read"], confidence: 0.7 }]
    });
    const badCapability = JSON.stringify({
      tasks: [{ title: "x", summary: "y", assignedAgent: "workflow", capabilities: ["hack"], confidence: 0.7 }]
    });
    expect(await planner(async () => unknownAgent).plan({ request: "x" })).toBeNull();
    expect(await planner(async () => badCapability).plan({ request: "x" })).toBeNull();
  });

  it("returns null when disabled, unconfigured, or the model returns nothing", async () => {
    expect(
      await createModelPlanner({ enabled: false, isConfigured: () => true, modelClient: async () => validPlanJson }).plan({
        request: "x"
      })
    ).toBeNull();
    expect(
      await createModelPlanner({ enabled: true, isConfigured: () => false, modelClient: async () => validPlanJson }).plan({
        request: "x"
      })
    ).toBeNull();
    expect(await planner(async () => null).plan({ request: "x" })).toBeNull();
  });

  it("integrates: planner tasks replace the catalog for general-coordination", async () => {
    const tempDir = await mkdtemp(path.join(os.tmpdir(), "agentic-planner-"));
    const repository = createRepository({ storePath: path.join(tempDir, "runtime-store.json") });
    await repository.seedDefaults(DEFAULT_OWNER_USER_ID);
    const fakePlanner: Planner = {
      async plan() {
        return [
          { title: "Planner step A", summary: "Do A.", assignedAgent: "workflow", capabilities: ["read"], confidence: 0.7 },
          { title: "Planner step B", summary: "Do B.", assignedAgent: "knowledge", capabilities: ["read", "search"], confidence: 0.7 }
        ];
      }
    };
    const bundle = await processUserRequest({
      userId: DEFAULT_OWNER_USER_ID,
      request: "Organize my home office supplies inventory.",
      memories: await repository.listMemory(DEFAULT_OWNER_USER_ID),
      integrations: await repository.listIntegrations(DEFAULT_OWNER_USER_ID),
      planner: fakePlanner
    });
    const titles = bundle.tasks.map((task) => task.title);
    expect(titles).toContain("Planner step A");
    expect(titles).toContain("Planner step B");
  });

  it("integrates: falls back to catalog tasks when the planner returns null", async () => {
    const tempDir = await mkdtemp(path.join(os.tmpdir(), "agentic-planner-fb-"));
    const repository = createRepository({ storePath: path.join(tempDir, "runtime-store.json") });
    await repository.seedDefaults(DEFAULT_OWNER_USER_ID);
    const nullPlanner: Planner = {
      async plan() {
        return null;
      }
    };
    const bundle = await processUserRequest({
      userId: DEFAULT_OWNER_USER_ID,
      request: "Organize my home office supplies inventory.",
      memories: await repository.listMemory(DEFAULT_OWNER_USER_ID),
      integrations: await repository.listIntegrations(DEFAULT_OWNER_USER_ID),
      planner: nullPlanner
    });
    expect(bundle.tasks.map((task) => task.title)).toContain("Interpret the request");
  });
});
