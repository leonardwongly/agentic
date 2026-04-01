import { evaluateTaskPolicy, riskFromCapabilities } from "@agentic/policy";

describe("policy", () => {
  it("maps low-impact capabilities to R1", () => {
    expect(riskFromCapabilities(["read", "search"])).toBe("R1");
  });

  it("requires approval for external commitments", () => {
    const decision = evaluateTaskPolicy({
      capabilities: ["read", "send"],
      confidence: 0.84,
      title: "Send a customer reply"
    });

    expect(decision.riskClass).toBe("R3");
    expect(decision.requiresApproval).toBe(true);
    expect(decision.outcome).toBe("allowed_with_confirmation");
  });

  it("blocks irreversible actions", () => {
    const decision = evaluateTaskPolicy({
      capabilities: ["delete"],
      confidence: 0.91,
      title: "Delete the note"
    });

    expect(decision.riskClass).toBe("R4");
    expect(decision.requiresApproval).toBe(true);
    expect(decision.outcome).toBe("blocked");
  });

  it("downgrades low-confidence tasks to draft behavior", () => {
    const decision = evaluateTaskPolicy({
      capabilities: ["send"],
      confidence: 0.42,
      title: "Send a vague message"
    });

    expect(decision.outcome).toBe("downgrade_to_draft");
    expect(decision.requiresApproval).toBe(false);
  });
});
