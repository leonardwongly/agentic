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

    expect(
      ActionIntentSchema.parse({
        type: "update_record",
        targetType: "goal",
        targetId: "goal-1",
        patch: { status: "running" },
        reason: "Planner requested a governed state update."
      })
    ).toMatchObject({
      schemaVersion: "v1",
      type: "update_record",
      adapter: "workspace",
      riskClass: "R3"
    });

    expect(
      ActionIntentSchema.parse({
        type: "monitor_signal",
        targetEntity: "VIP inbox",
        condition: "High-priority sender arrives.",
        triggerAction: "Draft an operator escalation.",
        sourceSystems: ["gmail"]
      })
    ).toMatchObject({
      schemaVersion: "v1",
      type: "monitor_signal",
      adapter: "watcher",
      riskClass: "R2"
    });
  });

  it("rejects unknown action families instead of accepting stringly typed payloads", () => {
    expect(() =>
      ActionIntentSchema.parse({
        type: "invoke_shell",
        recordId: "record-1"
      })
    ).toThrow(/no matching discriminator|invalid input/i);
  });

  it("rejects structurally invalid expanded intents before dispatch", () => {
    expect(() =>
      ActionIntentSchema.parse({
        type: "update_record",
        targetType: "goal",
        targetId: "goal-1",
        patch: {},
        reason: "Empty patches must not reach a driver."
      })
    ).toThrow(/at least one patch field/i);

    expect(() =>
      ActionIntentSchema.parse({
        type: "delete_record",
        targetType: "goal",
        targetId: "goal-1",
        reason: "No confirmation token is required by schema, but unknown fields are rejected.",
        unexpected: "field"
      })
    ).toThrow(/unrecognized key/i);
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
