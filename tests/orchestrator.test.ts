import { SYSTEM_USER_ID } from "@agentic/contracts";
import { generateBriefing, generateMorningBriefing, respondToApproval, processUserRequest } from "@agentic/orchestrator";
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
    const approval = bundle.approvals[0];

    expect(bundle.goal.intent).toBe("communications-triage");
    expect(bundle.tasks.length).toBeGreaterThan(0);
    expect(bundle.approvals.length).toBeGreaterThan(0);
    expect(bundle.workflow.checkpoint).toBe("approval-gate");
    expect(approval?.preview.actionType).toBe("send");
    expect(approval?.preview.summary).toBeTruthy();
    expect(approval?.preview.changes).toHaveLength(1);
    expect(approval?.preview.target).toBe("External communication");
    expect(approval?.actionIntent).toMatchObject({
      type: "manual_review",
      actionType: "send"
    });
    expect(approval?.history).toEqual([]);
    expect(approval?.decisionScope).toBeNull();
    expect(approval?.decisionRationale).toBeNull();
  });

  it("registers watchers for travel preparation", async () => {
    const bundle = await processUserRequest({
      ...buildContext(),
      request: "Help me prepare for my upcoming travel itinerary."
    });

    expect(bundle.goal.intent).toBe("travel-readiness");
    expect(bundle.watchers.length).toBeGreaterThan(0);
  });

  it("queues approved tasks for execution after approval", async () => {
    const bundle = await processUserRequest({
      ...buildContext(),
      request: "Review my inbox and draft responses."
    });
    const approval = bundle.approvals[0];

    expect(approval).toBeDefined();

    const updated = respondToApproval({
      bundle,
      approvalId: approval.id,
      decision: "approved",
      scope: "similar_24h",
      rationale: "Safe for the next batch of comparable replies."
    });
    const updatedApproval = updated.approvals.find((candidate) => candidate.id === approval.id);
    const updatedTask = updated.tasks.find((task) => task.id === approval.taskId);
    const decisionRecord = updatedApproval?.history.at(-1);

    expect(updatedApproval?.decision).toBe("approved");
    expect(updatedApproval?.decisionScope).toBe("similar_24h");
    expect(updatedApproval?.decisionRationale).toBe("Safe for the next batch of comparable replies.");
    expect(updatedApproval?.history).toHaveLength(1);
    expect(decisionRecord).toMatchObject({
      decision: "approved",
      scope: "similar_24h",
      rationale: "Safe for the next batch of comparable replies."
    });
    expect(updatedTask?.state).toBe("queued");
    expect(
      updated.actionLogs.some(
        (log) =>
          log.kind === "task.state_changed" &&
          log.details?.scope === "similar_24h" &&
          log.details?.decision === "approved"
      )
    ).toBe(true);
    expect(updated.actionLogs.at(-1)).toMatchObject({
      kind: "approval.responded",
      details: {
        scope: "similar_24h",
        rationale: "Safe for the next batch of comparable replies."
      }
    });
  });

  it("rejects expired approvals before mutating workflow state", async () => {
    const bundle = await processUserRequest({
      ...buildContext(),
      request: "Review my inbox and draft responses."
    });
    const approval = bundle.approvals[0];

    expect(approval).toBeDefined();

    expect(() =>
      respondToApproval({
        bundle: {
          ...bundle,
          approvals: bundle.approvals.map((candidate) =>
            candidate.id === approval.id ? { ...candidate, expiryAt: "2026-01-01T00:00:00.000Z" } : candidate
          )
        },
        approvalId: approval.id,
        decision: "approved"
      })
    ).toThrow(/has expired/);
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

  it("generates typed briefing bundles using saved preferences", async () => {
    const context = buildContext();
    const bundle = await generateBriefing({
      type: "midday",
      userId: SYSTEM_USER_ID,
      memories: context.memories,
      integrations: context.integrations,
      pendingApprovals: [],
      activeWatchers: [],
      preferences: {
        timezone: "America/New_York",
        focus: "urgent"
      }
    });
    const resolutionLog = bundle.actionLogs.find((log) => log.kind === "context.resolved");

    expect(bundle.goal.intent).toBe("briefing:midday");
    expect(bundle.goal.title).toContain("Midday drift check");
    expect(bundle.goal.request).toContain("midday drift check");
    expect(bundle.goal.explanation).toContain("urgent");
    expect(bundle.tasks).toHaveLength(3);
    expect(bundle.workflow.checkpoint).toBe("done");
    expect(bundle.actionLogs.filter((log) => log.kind === "agent.completed")).toSatisfy((logs) =>
      logs.every((log) => typeof log.details?.executionMode === "string")
    );
    expect(resolutionLog?.details).toMatchObject({
      briefingType: "midday",
      briefingFocus: "urgent"
    });
  });

  it("keeps the morning briefing wrapper mapped to startup briefings", async () => {
    const context = buildContext();
    const bundle = await generateMorningBriefing({
      userId: SYSTEM_USER_ID,
      memories: context.memories,
      integrations: context.integrations,
      pendingApprovals: [],
      activeWatchers: []
    });

    expect(bundle.goal.intent).toBe("briefing:startup");
    expect(bundle.goal.title).toContain("Startup briefing");
    expect(bundle.tasks).toHaveLength(3);
  });
});
