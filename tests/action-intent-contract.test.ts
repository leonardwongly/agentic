import { ActionIntentSchema } from "@agentic/contracts";

describe("action intent contract", () => {
  it("accepts the minimum typed action families used by the current production wedges", () => {
    expect(
      ActionIntentSchema.parse({
        type: "send_message",
        to: "client@example.com",
        subject: "Follow-up",
        body: "Approved response body.",
        mode: "send"
      })
    ).toMatchObject({
      type: "send_message",
      adapter: "gmail"
    });

    expect(
      ActionIntentSchema.parse({
        type: "schedule_event",
        summary: "Customer handoff",
        start: "2026-04-20T09:00:00.000Z",
        end: "2026-04-20T09:30:00.000Z",
        attendees: ["owner@example.com", "client@example.com"]
      })
    ).toMatchObject({
      type: "schedule_event",
      adapter: "calendar"
    });

    expect(
      ActionIntentSchema.parse({
        type: "create_note",
        title: "Weekly plan",
        content: "Focus blocks and follow-up items."
      })
    ).toMatchObject({
      type: "create_note",
      adapter: "notes"
    });

    expect(
      ActionIntentSchema.parse({
        type: "manual_review",
        actionType: "send",
        summary: "Review the outbound message manually.",
        reason: "No typed payload is available yet.",
        artifactIds: ["artifact-1"]
      })
    ).toMatchObject({
      type: "manual_review"
    });
  });

  it("rejects unknown action families instead of accepting stringly typed payloads", () => {
    expect(() =>
      ActionIntentSchema.parse({
        type: "delete_record",
        recordId: "record-1"
      })
    ).toThrow(/no matching discriminator|invalid input/i);
  });

  it("rejects malformed schedule windows", () => {
    expect(() =>
      ActionIntentSchema.parse({
        type: "schedule_event",
        summary: "Reverse time meeting",
        start: "2026-04-20T10:00:00.000Z",
        end: "2026-04-20T09:30:00.000Z"
      })
    ).toThrow(/end time after the start time/i);
  });

  it("rejects unknown fields on typed actions", () => {
    expect(() =>
      ActionIntentSchema.parse({
        type: "send_message",
        to: "client@example.com",
        subject: "Follow-up",
        body: "Approved response body.",
        unexpected: "field"
      })
    ).toThrow(/unrecognized key/i);
  });

  it("rejects malformed recipients", () => {
    expect(() =>
      ActionIntentSchema.parse({
        type: "send_message",
        to: "not-an-email",
        subject: "Follow-up",
        body: "Approved response body."
      })
    ).toThrow(/email/i);
  });
});
