import { describe, expect, it } from "vitest";
import {
  DEFAULT_OWNER_USER_ID,
  GoalBundleSchema,
  GoalSchema,
  WorkflowStateSchema,
  TaskSchema,
  ApprovalRequestSchema,
  createHumanActorContext,
  nowIso
} from "@agentic/contracts";
import { respondToApproval } from "@agentic/orchestrator";

const actor = createHumanActorContext(DEFAULT_OWNER_USER_ID);

function buildBundleWithApproval(params: {
  decision: "pending" | "approved" | "rejected";
  expiryOffsetMs?: number;
}) {
  const timestamp = nowIso();
  const expiryMs = params.expiryOffsetMs ?? 600_000;
  const task = TaskSchema.parse({
    id: "task-approval-edge",
    goalId: "goal-approval-edge",
    workflowId: "workflow-approval-edge",
    title: "Approval edge task",
    summary: "Test approval edge cases.",
    assignedAgent: "workflow",
    state: "waiting",
    riskClass: "R2",
    requiresApproval: true,
    toolCapabilities: ["draft"],
    artifactIds: [],
    createdAt: timestamp,
    updatedAt: timestamp
  });

  return GoalBundleSchema.parse({
    goal: GoalSchema.parse({
      id: "goal-approval-edge",
      userId: DEFAULT_OWNER_USER_ID,
      workflowId: "workflow-approval-edge",
      title: "Approval edge goal",
      request: "Test.",
      intent: "general-coordination",
      status: "waiting",
      confidence: 0.8,
      explanation: "Test.",
      createdAt: timestamp,
      updatedAt: timestamp
    }),
    workflow: WorkflowStateSchema.parse({
      id: "workflow-approval-edge",
      goalId: "goal-approval-edge",
      status: "waiting",
      currentStep: "approval-gate",
      checkpoint: "approval-gate",
      createdAt: timestamp,
      updatedAt: timestamp
    }),
    tasks: [task],
    artifacts: [],
    approvals: [
      ApprovalRequestSchema.parse({
        id: "approval-edge",
        goalId: "goal-approval-edge",
        taskId: "task-approval-edge",
        title: "Edge case approval",
        rationale: "Testing edge cases.",
        riskClass: "R2",
        decision: params.decision,
        requestedAction: "Test action.",
        createdAt: timestamp,
        expiryAt: new Date(Date.now() + expiryMs).toISOString(),
        respondedAt: params.decision === "pending" ? null : timestamp
      })
    ],
    watchers: [],
    actionLogs: []
  });
}

describe("adversarial respondToApproval edge cases", () => {
  it("rejects responding to a non-existent approval ID", () => {
    const bundle = buildBundleWithApproval({ decision: "pending" });
    expect(() =>
      respondToApproval({ bundle, approvalId: "approval-that-does-not-exist", decision: "approved", actor })
    ).toThrow(/was not found/i);
  });

  it("rejects responding to an already-approved approval", () => {
    const bundle = buildBundleWithApproval({ decision: "approved" });
    expect(() =>
      respondToApproval({ bundle, approvalId: "approval-edge", decision: "approved", actor })
    ).toThrow(/already been handled/i);
  });

  it("rejects responding to an already-rejected approval", () => {
    const bundle = buildBundleWithApproval({ decision: "rejected" });
    expect(() =>
      respondToApproval({ bundle, approvalId: "approval-edge", decision: "rejected", actor })
    ).toThrow(/already been handled/i);
  });

  it("rejects responding to an expired approval", () => {
    const bundle = buildBundleWithApproval({ decision: "pending", expiryOffsetMs: -1_000 });
    expect(() =>
      respondToApproval({ bundle, approvalId: "approval-edge", decision: "approved", actor })
    ).toThrow(/expired/i);
  });

  it("trims and truncates overly long rationale strings to 1000 chars", () => {
    const bundle = buildBundleWithApproval({ decision: "pending" });
    const longRationale = "  " + "x".repeat(2_000) + "  ";
    const result = respondToApproval({
      bundle,
      approvalId: "approval-edge",
      decision: "approved",
      actor,
      rationale: longRationale
    });
    const updatedApproval = result.approvals.find((a) => a.id === "approval-edge");
    expect(updatedApproval?.decisionRationale).toHaveLength(1000);
  });

  it("normalizes a blank rationale to null", () => {
    const bundle = buildBundleWithApproval({ decision: "pending" });
    const result = respondToApproval({
      bundle,
      approvalId: "approval-edge",
      decision: "approved",
      actor,
      rationale: "   "
    });
    const updatedApproval = result.approvals.find((a) => a.id === "approval-edge");
    expect(updatedApproval?.decisionRationale).toBeNull();
  });
});
