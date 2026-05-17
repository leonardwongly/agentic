import {
  ActionIntentSchema,
  ProviderSideEffectRecordSchema,
  TaskSchema,
  nowIso,
  type Capability,
  type ProviderSideEffectRecord
} from "@agentic/contracts";
import { executeTypedAction, planActionExecution, type ActionExecutionSideEffectLedger } from "@agentic/integrations";
import { vi } from "vitest";

function buildTask(capabilities: Capability[] = ["read", "send"]) {
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

function buildLedger() {
  const records = new Map<string, ProviderSideEffectRecord>();
  const calls: string[] = [];
  const ledger: ActionExecutionSideEffectLedger = {
    async reserve({ plan, task }) {
      calls.push("reserve");
      const key = plan.idempotencyKey ?? "";
      const existing = records.get(key);

      if (existing) {
        const next = ProviderSideEffectRecordSchema.parse({
          ...existing,
          attemptCount: Math.min(existing.attemptCount + 1, 25),
          lastAttemptAt: nowIso(),
          updatedAt: nowIso()
        });
        records.set(key, next);
        return next;
      }

      const now = nowIso();
      const record = ProviderSideEffectRecordSchema.parse({
        id: `side-effect-${records.size + 1}`,
        userId: "user-1",
        workspaceId: null,
        goalId: task.goalId,
        taskId: task.id,
        adapter: plan.adapter,
        operation: plan.operation,
        idempotencyKey: key,
        sideEffectTarget: plan.sideEffectTarget ?? "",
        status: "reserved",
        providerRef: null,
        detail: null,
        error: null,
        attemptCount: 1,
        metadata: {},
        reservedAt: now,
        lastAttemptAt: now,
        completedAt: null,
        createdAt: now,
        updatedAt: now
      });
      records.set(key, record);
      return record;
    },
    async update({ record, status, providerRef, detail, error, metadata }) {
      calls.push(`update:${status}`);
      const next = ProviderSideEffectRecordSchema.parse({
        ...record,
        status,
        providerRef: providerRef === undefined ? record.providerRef : providerRef,
        detail: detail === undefined ? record.detail : detail,
        error: error === undefined ? record.error : error,
        metadata: {
          ...record.metadata,
          ...(metadata ?? {})
        },
        completedAt: status === "completed" ? nowIso() : record.completedAt,
        updatedAt: nowIso()
      });
      records.set(record.idempotencyKey, next);
      return next;
    }
  };

  return { ledger, calls, records };
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

  it("records provider side effects before Gmail mutation and suppresses duplicate drafts", async () => {
    const task = buildTask(["read", "draft", "send"]);
    const actionIntent = ActionIntentSchema.parse({
      type: "send_message",
      to: "client@example.com",
      subject: "Follow-up",
      body: "Approved response body.",
      mode: "draft"
    });
    const createDraft = vi.fn().mockResolvedValue({ id: "draft-ledger-1" });
    const { ledger, calls } = buildLedger();

    const first = await executeTypedAction({
      task,
      actionIntent,
      adapters: {
        gmail: {
          createDraft,
          sendDraft: vi.fn(),
          listRecentEmails: vi.fn()
        }
      },
      sideEffectLedger: ledger
    });
    const second = await executeTypedAction({
      task,
      actionIntent,
      adapters: {
        gmail: {
          createDraft,
          sendDraft: vi.fn(),
          listRecentEmails: vi.fn()
        }
      },
      sideEffectLedger: ledger
    });

    expect(createDraft).toHaveBeenCalledTimes(1);
    expect(calls.slice(0, 2)).toEqual(["reserve", "update:completed"]);
    expect(first.outcome.providerRef).toBe("draft-ledger-1");
    expect(second.outcome).toMatchObject({
      status: "completed",
      providerRef: "draft-ledger-1",
      retryable: false
    });
  });

  it("resumes Gmail send from a partial ledger record without creating another draft", async () => {
    const task = buildTask(["read", "send"]);
    const actionIntent = ActionIntentSchema.parse({
      type: "send_message",
      to: "client@example.com",
      subject: "Follow-up",
      body: "Approved response body.",
      mode: "send"
    });
    const sendTimeout = new Error("gmail send timed out");
    sendTimeout.name = "TimeoutError";
    const createDraft = vi.fn().mockResolvedValue({ id: "draft-resume-1" });
    const sendDraft = vi.fn().mockRejectedValueOnce(sendTimeout).mockResolvedValueOnce({ messageId: "message-resume-1" });
    const { ledger, records } = buildLedger();

    const first = await executeTypedAction({
      task,
      actionIntent,
      adapters: {
        gmail: {
          createDraft,
          sendDraft,
          listRecentEmails: vi.fn()
        }
      },
      sideEffectLedger: ledger
    });
    const second = await executeTypedAction({
      task,
      actionIntent,
      adapters: {
        gmail: {
          createDraft,
          sendDraft,
          listRecentEmails: vi.fn()
        }
      },
      sideEffectLedger: ledger
    });

    expect(first.outcome).toMatchObject({
      status: "partial_success",
      providerRef: "draft-resume-1",
      retryable: true
    });
    expect(second.outcome).toMatchObject({
      status: "completed",
      providerRef: "message-resume-1"
    });
    expect(createDraft).toHaveBeenCalledTimes(1);
    expect(sendDraft).toHaveBeenNthCalledWith(1, "draft-resume-1");
    expect(sendDraft).toHaveBeenNthCalledWith(2, "draft-resume-1");
    expect([...records.values()][0]).toMatchObject({
      status: "completed",
      providerRef: "message-resume-1"
    });
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

  it("plans expanded typed intents but rejects unsupported drivers explicitly", async () => {
    const task = buildTask(["read", "update"]);
    const actionIntent = ActionIntentSchema.parse({
      type: "update_record",
      targetType: "goal",
      targetId: "goal-action",
      patch: { status: "running" },
      reason: "Planner normalized a state update request."
    });

    const { plan, outcome } = await executeTypedAction({
      task,
      actionIntent,
      adapters: {}
    });

    expect(plan).toMatchObject({
      actionType: "update_record",
      adapter: "workspace",
      operation: "update_record",
      sideEffectTarget: "workspace:update:goal:goal-action:409443a6ee5aa296"
    });
    expect(outcome).toMatchObject({
      status: "skipped",
      retryable: false,
      recovery: {
        strategy: "manual_review"
      }
    });
    expect(outcome.detail).toContain("no enforcing driver is registered");
  });

  it("uses stable key ordering for update intent idempotency and side-effect targets", () => {
    const task = buildTask(["read", "update"]);
    const firstIntent = ActionIntentSchema.parse({
      type: "update_record",
      targetType: "goal",
      targetId: "goal-action",
      patch: { status: "running", priority: "high" },
      reason: "Planner normalized a state update request."
    });
    const secondIntent = ActionIntentSchema.parse({
      type: "update_record",
      targetType: "goal",
      targetId: "goal-action",
      patch: { priority: "high", status: "running" },
      reason: "Planner normalized a state update request."
    });

    const firstPlan = planActionExecution({ task, actionIntent: firstIntent });
    const secondPlan = planActionExecution({ task, actionIntent: secondIntent });

    expect(firstPlan.idempotencyKey).toBe(secondPlan.idempotencyKey);
    expect(firstPlan.sideEffectTarget).toBe(secondPlan.sideEffectTarget);
  });
});
