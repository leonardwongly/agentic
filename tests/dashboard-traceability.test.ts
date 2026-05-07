import { createMemoryRecord } from "@agentic/memory";
import { createActionLog } from "@agentic/observability";
import { processUserRequest } from "@agentic/orchestrator";
import { buildDashboardTraceability } from "@agentic/repository";
import { describe, expect, it } from "vitest";

describe("dashboard traceability", () => {
  it("scopes memory provenance to active workflow evidence and labels inferred memories as advisory", async () => {
    const userId = "trace-user";
    const confirmedMemory = createMemoryRecord({
      id: "memory-confirmed",
      userId,
      category: "preferences",
      memoryType: "confirmed",
      content: "User approved send actions for customer follow-up.",
      confidence: 0.95,
      source: "auto-capture"
    });
    const inferredMemory = createMemoryRecord({
      id: "memory-inferred",
      userId,
      category: "preferences",
      memoryType: "inferred",
      content: "User may prefer short follow-up notes.",
      confidence: 0.55,
      source: "auto-capture"
    });
    const staleMemory = createMemoryRecord({
      id: "memory-stale",
      userId,
      category: "preferences",
      memoryType: "observed",
      content: "Old preference that requires review.",
      confidence: 0.7,
      source: "auto-capture",
      reviewAt: "2024-01-01T00:00:00.000Z"
    });
    const unreferencedMemory = createMemoryRecord({
      id: "memory-other-workspace",
      userId,
      category: "private-other-workspace",
      memoryType: "confirmed",
      content: "This memory must not leak into active workspace provenance.",
      confidence: 0.9,
      source: "auto-capture"
    });
    const bundle = await processUserRequest({
      userId,
      request: "Send the customer a short follow-up that needs review.",
      memories: [confirmedMemory, inferredMemory, staleMemory],
      integrations: []
    });
    const task = bundle.tasks[0]!;
    const actionLog = createActionLog({
      goalId: bundle.goal.id,
      taskId: bundle.tasks[0]?.id,
      workflowId: bundle.workflow.id,
      actor: "test",
      kind: "context.resolved",
      message: "Resolved scoped context for workflow execution.",
      details: {
        contextPack: {
          selectedMemoryIds: [confirmedMemory.id, inferredMemory.id, staleMemory.id],
          staleMemoryIds: [staleMemory.id],
          reviewRequiredMemoryIds: [staleMemory.id],
          conflictingMemoryIds: [],
          evidenceSummary: {
            selectedCount: 3,
            confirmedCount: 1,
            observedCount: 1,
            inferredCount: 1,
            freshCount: 2,
            reviewDueCount: 1,
            lowConfidenceCount: 0,
            expiredCount: 0,
            reviewRequiredCount: 1,
            conflictCount: 0
          }
        }
      },
      prevLog: bundle.actionLogs.at(-1) ?? null
    });
    const traceability = buildDashboardTraceability({
      userId,
      activeWorkspaceId: "workspace-1",
      goals: [
        {
          ...bundle,
          goal: {
            ...bundle.goal,
            workspaceId: "workspace-1"
          },
          actionLogs: [...bundle.actionLogs, actionLog]
        }
      ],
      approvals: [],
      evidenceRecords: [
        {
          id: "evidence-1",
          userId,
          goalId: bundle.goal.id,
          taskId: task.id,
          approvalId: "approval-1",
          sourceKind: "approval_response",
          sourceId: "approval-1",
          sourceSummary: "Approved follow-up.",
          riskClass: task.riskClass,
          requestedAction: task.title,
          requestRationale: task.summary,
          requiresApproval: true,
          decision: "approved",
          decisionScope: "once",
          decisionRationale: "Approved for this test.",
          respondedAt: "2026-01-01T00:05:00.000Z",
          resultingTaskState: "completed",
          resultingGoalStatus: "completed",
          actionLogIds: [actionLog.id],
          artifactIds: bundle.artifacts.map((artifact) => artifact.id),
          memoryIds: [confirmedMemory.id],
          actorContext: null,
          createdAt: "2026-01-01T00:05:00.000Z",
          updatedAt: "2026-01-01T00:06:00.000Z"
        }
      ],
      memories: [confirmedMemory, inferredMemory, staleMemory, unreferencedMemory],
      generatedAt: "2026-01-01T00:00:00.000Z",
      now: Date.parse("2026-01-01T00:00:00.000Z")
    });

    expect(traceability.memoryProvenance.map((memory) => memory.id).sort()).toEqual([
      "memory-confirmed",
      "memory-inferred",
      "memory-stale"
    ]);
    expect(traceability.memoryProvenance.find((memory) => memory.id === "memory-inferred")).toMatchObject({
      advisoryOnly: true,
      autonomyEligible: false,
      memoryType: "inferred"
    });
    expect(traceability.trustLane).toMatchObject({
      scopedMemoryCount: 3,
      advisoryInferredMemoryCount: 1,
      blockedUnscopedMemoryCount: 1
    });
    expect(traceability.workflowTraces[0]).toMatchObject({
      goalId: bundle.goal.id,
      approvalCount: 0,
      taskCount: bundle.tasks.length,
      staleMemoryIds: ["memory-inferred", "memory-stale"],
      inferredMemoryIds: ["memory-inferred"]
    });
  });
});
