import { AgentResultSchema } from "@agentic/contracts";
import { describe, expect, it } from "vitest";

const legacyResult = {
  agent: "workflow",
  summary: "Planned the work.",
  confidence: 0.72,
  executionMode: "deterministic_scaffold",
  implementationTier: "production",
  explanation: "Derived a stepwise plan."
};

describe("AgentResult structured envelope (AOS-21)", () => {
  it("parses a legacy result and defaults the new envelope fields (backward compatible)", () => {
    const parsed = AgentResultSchema.parse(legacyResult);

    expect(parsed.status).toBeUndefined();
    expect(parsed.resultType).toBeUndefined();
    expect(parsed.structuredResult).toBeNull();
    expect(parsed.evidenceRefs).toEqual([]);
    expect(parsed.assumptions).toEqual([]);
    expect(parsed.riskFlags).toEqual([]);
    expect(parsed.proposedActions).toEqual([]);
    expect(parsed.memoryUpdates).toEqual([]);
    expect(parsed.watcherRecommendations).toEqual([]);
    // Existing fields remain intact.
    expect(parsed.proposedToolCalls).toEqual([]);
    expect(parsed.nextSteps).toEqual([]);
    expect(parsed.summary).toBe("Planned the work.");
  });

  it("preserves a fully populated structured envelope", () => {
    const parsed = AgentResultSchema.parse({
      ...legacyResult,
      status: "needs_approval",
      resultType: "plan",
      structuredResult: { steps: 3, focus: "inbox" },
      evidenceRefs: ["memory:abc", "thread:123"],
      assumptions: ["Operator wants drafts, not sends."],
      riskFlags: ["external_send_requires_approval"],
      proposedActions: [
        {
          type: "manual_review",
          riskClass: "R3",
          actionType: "send",
          summary: "Draft a reply to the client",
          reason: "An external send must be approved before delivery."
        }
      ],
      memoryUpdates: [{ category: "preferences", memoryType: "observed", summary: "Prefers concise replies." }],
      watcherRecommendations: [
        { targetEntity: "VIP inbox", condition: "No reply in 3 days", triggerAction: "Escalate to operator.", frequency: "daily" }
      ]
    });

    expect(parsed.status).toBe("needs_approval");
    expect(parsed.resultType).toBe("plan");
    expect(parsed.structuredResult).toMatchObject({ steps: 3, focus: "inbox" });
    expect(parsed.evidenceRefs).toHaveLength(2);
    expect(parsed.proposedActions[0]).toMatchObject({ type: "manual_review", actionType: "send" });
    expect(parsed.memoryUpdates[0]).toMatchObject({ memoryType: "observed", confidence: 0.5 });
    expect(parsed.watcherRecommendations[0]).toMatchObject({ frequency: "daily" });
  });

  it("rejects invalid envelope values", () => {
    expect(() => AgentResultSchema.parse({ ...legacyResult, status: "bogus" })).toThrow();
    expect(() =>
      AgentResultSchema.parse({ ...legacyResult, memoryUpdates: [{ category: "x", memoryType: "bogus", summary: "y" }] })
    ).toThrow();
    expect(() =>
      AgentResultSchema.parse({ ...legacyResult, proposedActions: [{ type: "manual_review" }] })
    ).toThrow();
  });
});
