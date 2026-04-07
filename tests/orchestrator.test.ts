import { SYSTEM_USER_ID } from "@agentic/contracts";
import { respondToApproval, processUserRequest } from "@agentic/orchestrator";
import { buildDefaultIntegrationAccounts } from "@agentic/integrations";
import { createMemoryRecord } from "@agentic/memory";

function buildContext() {
  return {
    userId: SYSTEM_USER_ID,
    memories: [
      createMemoryRecord({
        userId: SYSTEM_USER_ID,
        category: "style",
        memoryType: "confirmed",
        content: "Use concise approval summaries.",
        confidence: 0.95,
        source: "test"
      })
    ],
    integrations: buildDefaultIntegrationAccounts(SYSTEM_USER_ID)
  };
}

describe("orchestrator", () => {
  it("creates approval-gated inbox triage bundles", async () => {
    const bundle = await processUserRequest({
      ...buildContext(),
      request: "Triage my inbox and prepare replies for important clients."
    });

    expect(bundle.goal.intent).toBe("communications-triage");
    expect(bundle.tasks.length).toBeGreaterThan(0);
    expect(bundle.approvals.length).toBeGreaterThan(0);
    expect(bundle.workflow.checkpoint).toBe("approval-gate");
  });

  it("registers watchers for travel preparation", async () => {
    const bundle = await processUserRequest({
      ...buildContext(),
      request: "Help me prepare for my upcoming travel itinerary."
    });

    expect(bundle.goal.intent).toBe("travel-readiness");
    expect(bundle.watchers.length).toBeGreaterThan(0);
  });

  it("updates task and workflow state after approval", async () => {
    const bundle = await processUserRequest({
      ...buildContext(),
      request: "Review my inbox and draft responses."
    });
    const approval = bundle.approvals[0];

    expect(approval).toBeDefined();

    const updated = respondToApproval({
      bundle,
      approvalId: approval.id,
      decision: "approved"
    });
    const updatedApproval = updated.approvals.find((candidate) => candidate.id === approval.id);
    const updatedTask = updated.tasks.find((task) => task.id === approval.taskId);

    expect(updatedApproval?.decision).toBe("approved");
    expect(updatedTask?.state).toBe("completed");
    expect(updated.actionLogs.at(-1)?.kind).toBe("approval.responded");
  });

  it("rejects oversized requests", async () => {
    await expect(
      processUserRequest({
        ...buildContext(),
        request: "x".repeat(2_001)
      })
    ).rejects.toThrow(/2000 character safety limit/);
  });

  it("only resolves relevant orchestrator-accessible memories into planning context", async () => {
    const bundle = await processUserRequest({
      userId: SYSTEM_USER_ID,
      request: "Help me prepare for travel with my passport checklist.",
      memories: [
        createMemoryRecord({
          userId: SYSTEM_USER_ID,
          category: "travel",
          memoryType: "confirmed",
          content: "Passport scans are stored in the secure notes vault.",
          confidence: 0.97,
          source: "test",
          permissions: ["orchestrator", "knowledge"]
        }),
        createMemoryRecord({
          userId: SYSTEM_USER_ID,
          category: "travel",
          memoryType: "confirmed",
          content: "This record is private to knowledge and should not affect orchestration.",
          confidence: 0.99,
          source: "test",
          permissions: ["knowledge"]
        }),
        createMemoryRecord({
          userId: SYSTEM_USER_ID,
          category: "travel",
          memoryType: "confirmed",
          content: "Expired travel memory.",
          confidence: 0.99,
          source: "test",
          permissions: ["orchestrator"],
          expiryAt: "2026-03-01T00:00:00.000Z"
        })
      ],
      integrations: buildDefaultIntegrationAccounts(SYSTEM_USER_ID)
    });
    const resolutionLog = bundle.actionLogs.find((log) => log.kind === "context.resolved");

    expect(bundle.goal.explanation).toContain("1 confirmed relevant memories");
    expect(resolutionLog?.details.resolvedMemoryCount).toBe(1);
    expect(Array.isArray(resolutionLog?.details.resolvedMemoryIds)).toBe(true);
    expect((resolutionLog?.details.resolvedMemoryIds as string[] | undefined)?.length).toBe(1);
  });
});
