import { ActionIntentSchema, TaskSchema, nowIso } from "@agentic/contracts";
import { executeTypedAction, planActionExecution } from "@agentic/integrations";
import { vi } from "vitest";

function buildTask(capabilities: Array<"read" | "send" | "schedule" | "create" | "draft"> = ["read", "send"]) {
  return TaskSchema.parse({
    id: "task-action",
    goalId: "goal-action",
    workflowId: "workflow-action",
    title: "Action task",
    summary: "Execute the typed action.",
    assignedAgent: "communications",
    state: "queued",
    riskClass: "R3",
    requiresApproval: true,
    toolCapabilities: capabilities,
    artifactIds: [],
    createdAt: nowIso(),
    updatedAt: nowIso()
  });
}

describe("action execution contract", () => {
  it("builds a stable preview, idempotency key, and side-effect target for duplicate invocations", () => {
    const task = buildTask(["read", "send"]);
    const actionIntent = ActionIntentSchema.parse({
      type: "send_message",
      to: "client@example.com",
      subject: "Follow-up",
      body: "Approved response body.",
      mode: "send"
    });

    const firstPlan = planActionExecution({ task, actionIntent });
    const secondPlan = planActionExecution({ task, actionIntent });

    expect(firstPlan.preview).toMatchObject({
      actionType: "send",
      target: "client@example.com"
    });
    expect(firstPlan.dryRunSummary).toContain("Follow-up");
    expect(firstPlan.idempotencyKey).toBe(secondPlan.idempotencyKey);
    expect(firstPlan.sideEffectTarget).toBe(secondPlan.sideEffectTarget);
  });

  it("executes typed draft creation with normalized completion metadata", async () => {
    const task = buildTask(["read", "draft", "send"]);
    const actionIntent = ActionIntentSchema.parse({
      type: "send_message",
      to: "client@example.com",
      subject: "Follow-up",
      body: "Approved response body.",
      mode: "draft"
    });

    const createDraft = vi.fn().mockResolvedValue({ id: "draft-123" });
    const { plan, outcome } = await executeTypedAction({
      task,
      actionIntent,
      adapters: {
        gmail: {
          createDraft,
          sendDraft: vi.fn(),
          listRecentEmails: vi.fn()
        }
      }
    });

    expect(plan.adapter).toBe("gmail");
    expect(plan.operation).toBe("create_draft");
    expect(outcome).toMatchObject({
      status: "completed",
      retryable: false,
      providerRef: "draft-123",
      idempotencyKey: plan.idempotencyKey,
      sideEffectTarget: plan.sideEffectTarget,
      recovery: {
        strategy: "none"
      }
    });
    expect(createDraft).toHaveBeenCalledTimes(1);
  });

  it("marks draft-send split failures as partial success with recovery hints", async () => {
    const task = buildTask(["read", "send"]);
    const actionIntent = ActionIntentSchema.parse({
      type: "send_message",
      to: "client@example.com",
      subject: "Follow-up",
      body: "Approved response body.",
      mode: "send"
    });
    const timeoutError = new Error("gmail send timed out");
    timeoutError.name = "TimeoutError";

    const { outcome } = await executeTypedAction({
      task,
      actionIntent,
      adapters: {
        gmail: {
          createDraft: vi.fn().mockResolvedValue({ id: "draft-456" }),
          sendDraft: vi.fn().mockRejectedValue(timeoutError),
          listRecentEmails: vi.fn()
        }
      }
    });

    expect(outcome).toMatchObject({
      status: "partial_success",
      retryable: true,
      providerRef: "draft-456",
      recovery: {
        strategy: "retry"
      }
    });
    expect(outcome.detail).toContain("Draft draft-456 was created but delivery failed");
    expect(outcome.recovery.compensationHints).toContain("Review draft draft-456 before retrying delivery.");
  });

  it("classifies connector timeouts as retryable failures", async () => {
    const task = TaskSchema.parse({
      ...buildTask(["read", "schedule"]),
      assignedAgent: "calendar"
    });
    const actionIntent = ActionIntentSchema.parse({
      type: "schedule_event",
      summary: "Customer handoff",
      start: "2026-04-20T09:00:00.000Z",
      end: "2026-04-20T09:30:00.000Z",
      attendees: ["owner@example.com"]
    });
    const timeoutError = new Error("calendar timeout");
    timeoutError.name = "TimeoutError";

    const { outcome } = await executeTypedAction({
      task,
      actionIntent,
      adapters: {
        calendar: {
          createEvent: vi.fn().mockRejectedValue(timeoutError),
          updateEvent: vi.fn(),
          listUpcomingEvents: vi.fn()
        }
      }
    });

    expect(outcome).toMatchObject({
      status: "failed",
      retryable: true,
      recovery: {
        strategy: "retry"
      }
    });
    expect(outcome.detail).toContain("Calendar event creation failed");
  });

  it("keeps local note failures in manual review instead of blind retries", async () => {
    const task = buildTask(["read", "create"]);
    const actionIntent = ActionIntentSchema.parse({
      type: "create_note",
      title: "Weekly plan",
      content: "Focus blocks and follow-up items."
    });

    const { outcome } = await executeTypedAction({
      task,
      actionIntent,
      adapters: {
        notes: {
          createLocalNote: vi.fn().mockRejectedValue(new Error("disk full"))
        }
      }
    });

    expect(outcome).toMatchObject({
      status: "failed",
      retryable: false,
      recovery: {
        strategy: "manual_review"
      }
    });
    expect(outcome.detail).toContain("disk full");
  });
});
