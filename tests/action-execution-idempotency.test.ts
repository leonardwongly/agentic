import { executeTypedAction } from "@agentic/integrations";
import { createTask } from "@agentic/execution";

describe("action execution idempotency propagation", () => {
  it("passes idempotency key to gmail draft creation and send", async () => {
    const task = createTask({
      goalId: "goal-1",
      workflowId: "workflow-1",
      title: "Send update",
      summary: "Send email update",
      assignedAgent: "communications",
      riskClass: "R3",
      requiresApproval: true,
      toolCapabilities: ["send"],
      state: "queued"
    });

    const createDraft = vi.fn(async () => ({ id: "draft-1" }));
    const sendDraft = vi.fn(async () => ({ messageId: "msg-1" }));

    const result = await executeTypedAction({
      task,
      actionIntent: {
        type: "send_message",
        mode: "send",
        to: "person@example.com",
        subject: "Hello",
        body: "Body"
      },
      adapters: {
        gmail: {
          createDraft,
          sendDraft,
          listRecentEmails: async () => []
        }
      }
    });

    expect(createDraft).toHaveBeenCalledWith(
      expect.objectContaining({ idempotencyKey: result.plan.idempotencyKey })
    );
    expect(sendDraft).toHaveBeenCalledWith("draft-1", {
      idempotencyKey: result.plan.idempotencyKey
    });
  });

  it("passes idempotency key to calendar event creation", async () => {
    const task = createTask({
      goalId: "goal-1",
      workflowId: "workflow-1",
      title: "Schedule meeting",
      summary: "Book time",
      assignedAgent: "calendar",
      riskClass: "R3",
      requiresApproval: true,
      toolCapabilities: ["schedule"],
      state: "queued"
    });

    const createEvent = vi.fn(async () => ({ id: "event-1", htmlLink: "https://calendar.google.com/event" }));

    const result = await executeTypedAction({
      task,
      actionIntent: {
        type: "schedule_event",
        summary: "Standup",
        start: "2026-05-16T09:00:00Z",
        end: "2026-05-16T09:30:00Z",
        attendees: ["person@example.com"]
      },
      adapters: {
        calendar: {
          createEvent,
          updateEvent: async () => ({ id: "event-1" }),
          listUpcomingEvents: async () => []
        }
      }
    });

    expect(createEvent).toHaveBeenCalledWith(
      expect.objectContaining({ idempotencyKey: result.plan.idempotencyKey })
    );
  });
});
