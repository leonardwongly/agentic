import { describe, expect, it } from "vitest";
import { SubAgentPlanSchema, nowIso } from "@agentic/contracts";
import { validateSubAgentPlan } from "@agentic/orchestrator";

function buildSubAgentRole(id: string, dependsOn: string[] = []) {
  return {
    id,
    name: `Role ${id}`,
    agent: "workflow" as const,
    role: `Test role ${id}`,
    responsibilities: ["Test responsibility"],
    allowedCapabilities: ["read" as const],
    inputContracts: ["Input contract"],
    expectedOutputs: ["Expected output"],
    dependsOn,
    riskClass: "R2" as const,
    handoffCriteria: ["Handoff criterion"],
    guardrails: ["Guardrail"]
  };
}

function buildPlan(roles: ReturnType<typeof buildSubAgentRole>[], planId = "plan-test") {
  return SubAgentPlanSchema.parse({
    id: planId,
    goalId: "goal-1",
    anchorTaskId: null,
    parentAgent: "orchestrator",
    coordinationStrategy: "hybrid",
    roles,
    successCriteria: ["Criterion"],
    createdAt: nowIso()
  });
}

describe("adversarial validateSubAgentPlan", () => {
  it("rejects duplicate role IDs with a descriptive error", () => {
    const plan = buildPlan([buildSubAgentRole("role-a"), buildSubAgentRole("role-a")], "plan-dup");
    expect(() => validateSubAgentPlan(plan)).toThrow(/duplicate role id "role-a"/i);
  });

  it("rejects a dependency on an unknown role ID", () => {
    const plan = buildPlan([buildSubAgentRole("role-a", ["role-that-does-not-exist"])], "plan-unknown-dep");
    expect(() => validateSubAgentPlan(plan)).toThrow(/depends on unknown role "role-that-does-not-exist"/i);
  });

  it("detects a direct dependency cycle (A -> B -> A)", () => {
    const plan = buildPlan([
      buildSubAgentRole("role-a", ["role-b"]),
      buildSubAgentRole("role-b", ["role-a"])
    ], "plan-cycle-direct");
    expect(() => validateSubAgentPlan(plan)).toThrow(/dependency cycle/i);
  });

  it("detects a transitive dependency cycle (A -> B -> C -> A)", () => {
    const plan = buildPlan([
      buildSubAgentRole("role-a", ["role-b"]),
      buildSubAgentRole("role-b", ["role-c"]),
      buildSubAgentRole("role-c", ["role-a"])
    ], "plan-cycle-transitive");
    expect(() => validateSubAgentPlan(plan)).toThrow(/dependency cycle/i);
  });

  it("detects a self-referencing dependency cycle (A -> A)", () => {
    const plan = buildPlan([buildSubAgentRole("role-a", ["role-a"])], "plan-self-cycle");
    expect(() => validateSubAgentPlan(plan)).toThrow(/dependency cycle/i);
  });

  it("accepts a valid plan with a diamond dependency graph", () => {
    const plan = buildPlan([
      buildSubAgentRole("root"),
      buildSubAgentRole("left", ["root"]),
      buildSubAgentRole("right", ["root"]),
      buildSubAgentRole("leaf", ["left", "right"])
    ], "plan-diamond");
    expect(() => validateSubAgentPlan(plan)).not.toThrow();
    expect(validateSubAgentPlan(plan).roles).toHaveLength(4);
  });

  it("rejects a plan with zero roles at schema level", () => {
    // SubAgentPlanSchema requires at least 1 role; validateSubAgentPlan never sees empty plans.
    expect(() => buildPlan([], "plan-empty")).toThrow(/expected array to have >=1 items/i);
  });
});
