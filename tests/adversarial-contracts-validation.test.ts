import {
  ActionIntentSchema,
  ApprovalNotificationJobPayloadSchema,
  BriefingPreferencesSchema,
  BriefingScheduleEntrySchema,
  CreateNoteActionIntentSchema,
  DeleteRecordActionIntentSchema,
  JobRecordSchema,
  SendMessageActionIntentSchema,
  UpdateRecordActionIntentSchema,
  WorkflowScheduleSchema,
  appendJobExecutionJournalEntry,
  buildApprovalNotificationDeliveryTarget,
  createJobExecutionJournal,
  createUserResponsibilityAssignee,
  createSystemResponsibilityAssignee,
  deriveGoalContract,
  deriveGoalResponsibility,
  deriveJobRecoveryState
} from "@agentic/contracts";

/**
 * Adversarial sweep over `@agentic/contracts` validation + derivation helpers.
 *
 * Every case here feeds hostile or boundary input (blank-but-present ids,
 * invisible Unicode, prototype-pollution shaped records, colon-bearing composite
 * keys, over-long derived strings) into exported contract surface only. No
 * network, no database, no clock: all timestamps below are literal fixtures.
 */

function baseJobRecord(overrides: Record<string, unknown>) {
  return {
    id: "job-adversarial-1",
    userId: "owner",
    status: "completed",
    maxAttempts: 3,
    attemptCount: 1,
    availableAt: "2026-06-09T12:00:00.000Z",
    completedAt: "2026-06-09T12:00:05.000Z",
    createdAt: "2026-06-09T12:00:00.000Z",
    updatedAt: "2026-06-09T12:00:05.000Z",
    ...overrides
  };
}

describe("adversarial contract validation: derived job side-effect targets", () => {
  it("guards that goal-scoped payloads collapse to a goal: target while id-less payloads fall back to null", () => {
    const docsJob = JobRecordSchema.parse(
      baseJobRecord({
        kind: "docs_render",
        payload: {
          type: "docs_render",
          metadata: {}
        }
      })
    );
    const autopilotJob = JobRecordSchema.parse(
      baseJobRecord({
        kind: "autopilot_process",
        payload: {
          type: "autopilot_process",
          autopilotEventId: "evt-1",
          kind: "watcher_triggered",
          sourceId: "watcher-1",
          mode: "notify_only",
          metadata: {}
        }
      })
    );

    expect(docsJob.journal.sideEffectTarget).toBeNull();
    expect(autopilotJob.journal.sideEffectTarget).toBe("autopilot-event:evt-1");
  });

  it("resolves public_share_view jobs to their per-share target, not to the shared goal target", () => {
    const buildShareJob = (shareId: string, jobId: string) =>
      JobRecordSchema.parse(
        baseJobRecord({
          id: jobId,
          kind: "public_share_view",
          payload: {
            type: "public_share_view",
            shareId,
            goalId: "goal-shared",
            tokenFingerprint: "a1b2c3d4e5f6",
            viewedAt: "2026-06-09T12:00:00.000Z",
            metadata: {}
          }
        })
      );

    const first = buildShareJob("share-alpha", "job-share-alpha");
    const second = buildShareJob("share-beta", "job-share-beta");
    const firstPayload = first.payload;
    const secondPayload = second.payload;

    if (firstPayload.type !== "public_share_view" || secondPayload.type !== "public_share_view") {
      throw new Error("Public-share-view jobs must carry a public_share_view payload.");
    }

    // Regression: `deriveJobExecutionSideEffectTarget()` used to test the generic
    // `"goalId" in payload` branch before the `public_share_view` branch, so the documented
    // `share:${shareId}` target was dead code and two unrelated shares of one goal collapsed
    // onto `goal:goal-shared` (which also feeds concurrency/ledger keys). The type-specific
    // branches (privacy_operation, public_share_view, deployment_canary) now resolve before
    // the generic goal fallback.
    expect(first.journal.sideEffectTarget).toBe("share:share-alpha");
    expect(second.journal.sideEffectTarget).toBe("share:share-beta");
    expect(first.journal.sideEffectTarget).not.toBe("goal:goal-shared");
    expect(first.journal.sideEffectTarget).not.toBe(second.journal.sideEffectTarget);
    expect(firstPayload.shareId).not.toBe(secondPayload.shareId);
  });

  it("caps replayedFromJobId at the journal bound so a stored approval job stays parseable", () => {
    const longReplayRef = "j".repeat(240);
    const boundaryReplayRef = "j".repeat(200);
    const buildPayload = (replayedFromJobId: string) => ({
      type: "approval_notification",
      channel: "slack",
      approvalId: "approval-1",
      goalId: "goal-1",
      taskId: "task-1",
      decision: "approved",
      metadata: { replayedFromJobId }
    });

    // Regression: `ApprovalNotificationMetadataSchema` allowed an unbounded
    // `replayedFromJobId`, while `createJobExecutionJournal()` pipes it into
    // `JobExecutionJournalSchema.replayedFromJobId` (max 200) and into the queued-state
    // summary (max 280). A stored row like this parsed fine as a payload and then threw
    // inside the JobRecordSchema transform, so the record could never be read back.
    expect(ApprovalNotificationJobPayloadSchema.safeParse(buildPayload(longReplayRef)).success).toBe(false);

    const payload = ApprovalNotificationJobPayloadSchema.parse(buildPayload(boundaryReplayRef));
    expect(payload.metadata.replayedFromJobId).toBe(boundaryReplayRef);

    const record = JobRecordSchema.parse(
      baseJobRecord({
        kind: "approval_notification",
        status: "queued",
        completedAt: null,
        payload
      })
    );

    expect(record.journal.replayedFromJobId).toHaveLength(200);
    expect(record.journal.entries[0]?.summary).toBe(`Replay queued from job ${boundaryReplayRef}.`);
    expect((record.journal.entries[0]?.summary ?? "").length).toBeLessThanOrEqual(280);

    // Defensive half of the fix: a legacy row that already carries an over-long reference
    // (approval_follow_up metadata is still permissive) is truncated by the derivation
    // instead of throwing inside `JobRecordSchema.parse`.
    const legacyRecovery = deriveJobRecoveryState({
      jobId: "job-legacy-replay",
      status: "retrying",
      payload: {
        type: "approval_follow_up",
        approvalId: "approval-1",
        goalId: "goal-1",
        taskId: "task-1",
        decision: "approved",
        workspaceId: null,
        metadata: { replayedFromJobId: longReplayRef, actionId: null }
      }
    });

    expect(legacyRecovery?.replayedFromJobId).toBe(boundaryReplayRef);
  });

  it("refuses separator-bearing notification segments so delivery targets cannot collide", () => {
    const parsePayload = (input: Record<string, unknown>) =>
      ApprovalNotificationJobPayloadSchema.parse({
        type: "approval_notification",
        goalId: "goal-1",
        taskId: "task-1",
        decision: "approved",
        ...input
      });

    // Regression: `buildApprovalNotificationDeliveryTarget()` joins attacker-influenced
    // segments with `:` while `approvalId` (min 1, no charset) and `slackChannelId`
    // (min 1/max 80, no charset) accepted colons. Two different approvals/threads then
    // produced one identical idempotency target and a legitimate second receipt could be
    // treated as an already-delivered side effect. Every segment is now charset-validated,
    // which makes the composed target injective.
    expect(() =>
      parsePayload({
        channel: "slack_receipt",
        approvalId: "ap",
        slackChannelId: "b:slack_receipt:c",
        slackMessageTs: "1710000000.000100"
      })
    ).toThrow(/slackChannelId/iu);
    expect(() =>
      parsePayload({
        channel: "slack_receipt",
        approvalId: "ap:slack_receipt:b",
        slackChannelId: "c",
        slackMessageTs: "1710000000.000100"
      })
    ).toThrow(/approvalId/iu);
    expect(() =>
      parsePayload({
        channel: "telegram_receipt",
        approvalId: "ap",
        telegramChatId: "-100:123",
        telegramMessageId: 7
      })
    ).toThrow(/telegramChatId/iu);

    const receipt = parsePayload({
      channel: "slack_receipt",
      approvalId: "ap",
      slackChannelId: "C123",
      slackMessageTs: "1710000000.000100"
    });
    const otherApproval = parsePayload({
      channel: "slack_receipt",
      approvalId: "ap-2",
      slackChannelId: "C123",
      slackMessageTs: "1710000000.000100"
    });
    const otherThread = parsePayload({
      channel: "slack_receipt",
      approvalId: "ap",
      slackChannelId: "C456",
      slackMessageTs: "1710000000.000100"
    });

    expect(buildApprovalNotificationDeliveryTarget(receipt)).toBe(
      "approval-notification:ap:slack_receipt:C123:1710000000.000100"
    );
    expect(
      new Set([receipt, otherApproval, otherThread].map((payload) => buildApprovalNotificationDeliveryTarget(payload)))
        .size
    ).toBe(3);

    // Surrounding blanks are normalised away, so one logical thread cannot be split in two,
    // while an invisible character smuggled inside a segment is refused outright.
    expect(
      buildApprovalNotificationDeliveryTarget(parsePayload({ channel: "slack", approvalId: "  ap  " }))
    ).toBe(buildApprovalNotificationDeliveryTarget(parsePayload({ channel: "slack", approvalId: "ap" })));
    expect(() => parsePayload({ channel: "slack", approvalId: "ap\u200b" })).toThrow(/approvalId/iu);
  });
});

describe("adversarial contract validation: blank and invisible identity fields", () => {
  it("rejects blank and invisible-only responsibility assignee ids like every other contract id", () => {
    // Regression: `WorkflowResponsibilityAssigneeSchema.userId` (and `systemActor`) used
    // `z.string().min(1)` with no `.trim()`, unlike action-intent ids which are
    // `.trim().min(1)`. A whitespace-only or zero-width user id was stored as a real
    // accountable owner, so ownership/handoff audits could point at an invisible actor.
    // Both identity fields are now trimmed, non-blank, and require a visible code point.
    expect(() => createUserResponsibilityAssignee("\u00a0\u00a0", "Goal owner")).toThrow(/userId/iu);
    expect(() => createUserResponsibilityAssignee("\u200b", "Goal owner")).toThrow(/userId/iu);
    expect(() => createSystemResponsibilityAssignee("\u200b\u200e", "Nightly reconciler")).toThrow(/systemActor/iu);
    expect(() => deriveGoalResponsibility({ userId: "\u200b" })).toThrow(/userId/iu);
    expect(() => deriveGoalResponsibility({ userId: "\u00a0\u00a0" })).toThrow(/userId/iu);

    // Real actors keep working, and surrounding blanks are normalised instead of stored.
    expect(createUserResponsibilityAssignee("  owner  ", "Goal owner").userId).toBe("owner");
    expect(deriveGoalResponsibility({ userId: "owner" }).escalationOwner?.userId).toBe("owner");

    // Contrast: the typed-action boundary rejects the same shape.
    expect(() =>
      ActionIntentSchema.parse({
        type: "delete_record",
        targetType: "goal",
        targetId: "\u00a0\u00a0",
        reason: "Cleanup"
      })
    ).toThrow(/targetId|too_small|at least/iu);
  });

  it("rejects required user-facing text that contains only invisible Unicode characters", () => {
    const zeroWidthSubject = SendMessageActionIntentSchema.safeParse({
      type: "send_message",
      to: "client@example.com",
      subject: "\u200b\u200e\u2060",
      body: "Approved response body."
    });
    const nbspSubject = ActionIntentSchema.safeParse({
      type: "send_message",
      to: "client@example.com",
      subject: "\u00a0\u00a0",
      body: "Approved response body."
    });

    // Regression: invisible-character policy used to be inconsistent. `String.prototype.trim`
    // strips NBSP (so the blank subject was rejected), but U+200B/U+200E/U+2060 are not
    // whitespace, so a subject that renders as nothing was accepted and forwarded to a real
    // outbound email draft. Every trimmed required action-intent text field now also needs at
    // least one visible code point, so both shapes fail the same way.
    expect(nbspSubject.success).toBe(false);
    expect(zeroWidthSubject.success).toBe(false);
    if (!zeroWidthSubject.success) {
      expect(zeroWidthSubject.error.issues.map((issue) => issue.path)).toEqual([["subject"]]);
    }

    // Sibling required text is held to the same contract, and ordinary text (including
    // punctuation-only and non-Latin scripts) still passes.
    expect(() => CreateNoteActionIntentSchema.parse({ type: "create_note", title: "\u2060", content: "Notes." })).toThrow(
      /title/iu
    );
    expect(() =>
      ActionIntentSchema.parse({
        type: "schedule_event",
        summary: "\u200b",
        start: "2026-06-09T12:00:00.000Z",
        end: "2026-06-09T12:30:00.000Z"
      })
    ).toThrow(/summary/iu);
    expect(
      SendMessageActionIntentSchema.safeParse({
        type: "send_message",
        to: "client@example.com",
        subject: "Re: \u200bquarterly plan \u00e9t \u53cd\u9988",
        body: "Approved response body."
      }).success
    ).toBe(true);
    expect(CreateNoteActionIntentSchema.safeParse({ type: "create_note", title: "...", content: "Notes." }).success).toBe(
      true
    );
  });

  it("guards that RTL overrides, homoglyphs and control-looking text cannot smuggle an adapter or risk class", () => {
    const intent = ActionIntentSchema.parse({
      type: "monitor_signal",
      targetEntity: "goal-1",
      condition: "\u202eR1 \u202cthreshold crossed",
      triggerAction: "notify",
      sourceSystems: ["inbox"],
      riskClass: "R2"
    });

    // Enum fields stay enumerated even when neighbouring free text carries directional
    // overrides: the risk class cannot be downgraded by embedding "\u202eR1\u202c".
    expect(intent.riskClass).toBe("R2");
    expect(() =>
      ActionIntentSchema.parse({
        type: "monitor_signal",
        targetEntity: "goal-1",
        condition: "threshold crossed",
        triggerAction: "notify",
        riskClass: "\u202eR1\u202c"
      })
    ).toThrow(/riskClass|invalid_enum/iu);
  });
});

describe("adversarial contract validation: pollution-shaped records", () => {
  it("guards that __proto__-bearing records neither pollute Object.prototype nor smuggle patch fields", () => {
    const pollutedMetadata = JSON.parse('{"__proto__":{"approvedByContract":true},"legit":"ok"}');

    const message = SendMessageActionIntentSchema.parse({
      type: "send_message",
      to: "client@example.com",
      subject: "Follow-up",
      body: "Approved response body.",
      metadata: pollutedMetadata
    });

    expect(Object.prototype).not.toHaveProperty("approvedByContract");
    expect({}).not.toHaveProperty("approvedByContract");
    expect(Object.getPrototypeOf(message.metadata)).toBe(Object.prototype);
    expect(message.metadata).not.toHaveProperty("approvedByContract");
    expect(Object.keys(message.metadata)).toEqual(["legit"]);
    expect(message.metadata.legit).toBe("ok");

    // A patch that only carries `__proto__` must not satisfy the "at least one patch
    // field" refine, otherwise a hostile model output could claim a write without any
    // real field.
    expect(() =>
      UpdateRecordActionIntentSchema.parse({
        type: "update_record",
        targetType: "goal",
        targetId: "goal-1",
        reason: "Rename",
        patch: JSON.parse('{"__proto__":{"role":"owner"}}')
      })
    ).toThrow(/patch|at least one patch field/iu);

    expect(() =>
      UpdateRecordActionIntentSchema.parse({
        type: "update_record",
        targetType: "goal",
        targetId: "goal-1",
        reason: "Rename",
        patch: JSON.parse('{"__proto__":{"role":"owner"},"title":"Quarterly plan"}')
      })
    ).not.toThrow();
  });

  it("guards that constructor/prototype keys on hostile payloads stay scalar data, never resolved helpers", () => {
    const hostile = JSON.parse(
      '{"constructor":"[circumvented]","toString":"[circumvented]","hasOwnProperty":"no"}'
    );

    const parsed = UpdateRecordActionIntentSchema.parse({
      type: "update_record",
      targetType: "goal",
      targetId: "goal-1",
      reason: "Rename",
      patch: hostile
    });

    // Dangerous global names are treated as ordinary data keys and the record helpers
    // stay intact for every downstream consumer.
    expect(parsed.patch.constructor).toBe("[circumvented]");
    expect(typeof Object.prototype.toString).toBe("function");
    expect(typeof ({}).hasOwnProperty).toBe("function");

    // Nested objects under those keys must be rejected by the scalar union instead of
    // being merged into a prototype-looking structure.
    expect(
      UpdateRecordActionIntentSchema.safeParse({
        type: "update_record",
        targetType: "goal",
        targetId: "goal-1",
        reason: "Rename",
        patch: JSON.parse('{"constructor":{"prototype":{"role":"owner"}}}')
      }).success
    ).toBe(false);
  });
});

describe("adversarial contract validation: goal contract derivation", () => {
  it("guards that hostile or look-alike intent strings fall back to the bounded general profile instead of throwing", () => {
    const hostileIntents = [
      "__proto__",
      "constructor",
      "toString",
      "hasOwnProperty",
      "BRIEFING:startup",
      "ｂriefing:startup",
      "briefing\uff1astartup",
      " briefing:startup",
      "",
      "communications-triage\u200b"
    ];

    for (const intent of hostileIntents) {
      const contract = deriveGoalContract(intent);

      expect(contract.wedge.key).toBe("general_coordination");
      expect(contract.wedge.selection).toBe("supporting");
      expect(contract.completionContract.id).toBe("general-coordination-v1");
    }

    // Exact-prefix routing is code-unit based and untrimmed: a trailing space still
    // resolves to the briefing wedge, while a leading space or a fullwidth colon does
    // not. Guarding this keeps a hostile/loose intent from silently picking a
    // production wedge.
    expect(deriveGoalContract("briefing:startup").completionContract.id).toBe("briefing-v1");
    expect(deriveGoalContract("briefing:").completionContract.id).toBe("briefing-v1");
    expect(deriveGoalContract("briefing:startup ").completionContract.id).toBe("briefing-v1");
    expect(deriveGoalContract("communications-triage").wedge.selection).toBe("selected_production");
  });

  it("guards that hostile recipient shapes cannot smuggle look-alike or directional addresses into an outbound action", () => {
    const sendTo = (to: string) =>
      ActionIntentSchema.safeParse({
        type: "send_message",
        to,
        subject: "Boundary check",
        body: "Approved response body."
      });
    const inviteAttendees = (attendees: string[]) =>
      ActionIntentSchema.safeParse({
        type: "schedule_event",
        summary: "Boundary check",
        start: "2026-06-09T12:00:00.000Z",
        end: "2026-06-09T12:30:00.000Z",
        attendees
      });

    // Cyrillic homoglyphs and directional overrides inside an address are refused, so a
    // model-produced payload cannot quietly re-route a mail to a look-alike domain.
    expect(sendTo("\u0430@example.com").success).toBe(false);
    expect(sendTo("client@ex\u0430mple.com").success).toBe(false);
    expect(sendTo("a\u202eb@example.com").success).toBe(false);
    expect(sendTo("client@example.com\u200b").success).toBe(false);

    // Punycode IDNs stay valid because they are pure ASCII on the wire.
    expect(sendTo("client@xn--exmple-cua.com").success).toBe(true);

    // The 320-char ceiling is measured after trimming, so padding cannot inflate it.
    expect(sendTo(`${" ".repeat(400)}client@example.com${" ".repeat(400)}`).success).toBe(true);

    // Attendees share the same address contract, but duplicates are not normalised away
    // here, so fan-out limits must also be enforced by the adapter layer.
    expect(inviteAttendees(["client@example.com", "client@example.com"]).success).toBe(true);
    expect(inviteAttendees(["\u0430@example.com"]).success).toBe(false);
    expect(
      inviteAttendees(Array.from({ length: 51 }, () => "client@example.com")).success
    ).toBe(false);
  });

  it("guards that each derivation returns a fresh object graph so one caller cannot poison the shared profile", () => {
    const first = deriveGoalContract("weekly-planning");
    first.wedge.label = "Mutated by an untrusted caller";
    first.completionContract.successCriteria.push("Injected criterion");
    first.completionContract.approvalExpectations.push("Injected expectation");

    const second = deriveGoalContract("weekly-planning");

    expect(second.wedge.label).toBe("Scheduling execution");
    expect(second.completionContract.successCriteria).toHaveLength(3);
    expect(second.completionContract.approvalExpectations).toHaveLength(1);
  });
});

describe("adversarial contract validation: time, timezone and numeric boundaries", () => {
  it("guards that HH:MM scheduling input rejects every out-of-range and non-ASCII-digit shape", () => {
    expect(BriefingScheduleEntrySchema.parse({ type: "startup", enabled: true, time: "23:59" }).time).toBe("23:59");
    expect(BriefingScheduleEntrySchema.parse({ type: "startup", enabled: true, time: "00:00" }).time).toBe("00:00");

    const rejected = ["24:00", "23:60", "7:30", "12:30:00", "12:3", "\u0663\u0661:\u0663:\u0660", "12：30", "12:30\n", " 12:30"];

    for (const time of rejected) {
      expect(BriefingScheduleEntrySchema.safeParse({ type: "startup", enabled: true, time }).success).toBe(false);
    }
  });

  it("refuses briefing and workflow timezones that the scheduler cannot resolve", () => {
    const scheduleTypes = ["startup", "midday", "pre_meeting", "end_of_day", "next_day"] as const;
    const buildPreferences = (timezone: string) => ({
      userId: "owner",
      timezone,
      focus: "balanced",
      schedules: scheduleTypes.map((type) => ({ type, enabled: true, time: "08:30" })),
      createdAt: "2026-06-09T12:00:00.000Z",
      updatedAt: "2026-06-09T12:00:00.000Z"
    });

    // Regression: `BriefingPreferencesSchema.timezone` was `z.string().min(1)` (and the
    // workflow/template schedule timezones were unvalidated strings), so a typo'd or
    // whitespace-only zone was persisted and only exploded at briefing generation time as a
    // RangeError inside `Intl.DateTimeFormat`. The contract now trims the value and probes it
    // with the same `Intl.DateTimeFormat` call its consumers make.
    expect(() => BriefingPreferencesSchema.parse(buildPreferences("Mars/Olympus_Mons"))).toThrow(/timezone/iu);
    expect(BriefingPreferencesSchema.safeParse(buildPreferences("\u00a0")).success).toBe(false);
    expect(BriefingPreferencesSchema.safeParse(buildPreferences("\u200b")).success).toBe(false);
    expect(BriefingPreferencesSchema.safeParse(buildPreferences("America/New_York")).success).toBe(true);

    // The stored value is the trimmed identifier the formatter can actually use.
    expect(BriefingPreferencesSchema.parse(buildPreferences("  Asia/Singapore  ")).timezone).toBe("Asia/Singapore");

    // Workflow schedule timezones are held to the identical contract.
    expect(() => WorkflowScheduleSchema.parse({ timezone: "Mars/Olympus_Mons" })).toThrow(/timezone/iu);
    expect(() => WorkflowScheduleSchema.parse({ timezone: "\u00a0\u00a0" })).toThrow(/timezone/iu);
    expect(WorkflowScheduleSchema.parse({}).timezone).toBe("UTC");
    expect(WorkflowScheduleSchema.parse({ timezone: "  Europe/London  " }).timezone).toBe("Europe/London");
  });

  it("guards the datetime contract at epoch, leap-day and non-UTC edges before the start/end ordering refine", () => {
    const schedule = (start: string, end: string) =>
      ActionIntentSchema.safeParse({
        type: "schedule_event",
        summary: "Boundary window",
        start,
        end
      });

    expect(schedule("1970-01-01T00:00:00.000Z", "1970-01-01T00:00:00.001Z").success).toBe(true);
    expect(schedule("2024-02-29T23:59:59Z", "2024-03-01T00:00:00Z").success).toBe(true);
    expect(schedule("1969-12-31T23:59:59Z", "1970-01-01T00:00:00Z").success).toBe(true);

    // Pre-epoch and leap-day edges parse; impossible calendar days and leap seconds do not.
    expect(schedule("2023-02-29T00:00:00Z", "2023-03-01T00:00:00Z").success).toBe(false);
    expect(schedule("2016-12-31T23:59:59Z", "2016-12-31T23:59:60Z").success).toBe(false);
    expect(schedule("2026-02-30T00:00:00Z", "2026-03-01T00:00:00Z").success).toBe(false);

    // Contract is Z-only: an offset-bearing timestamp from an external scheduler is
    // rejected rather than silently re-interpreted in local time.
    expect(schedule("2026-06-09T12:00:00+08:00", "2026-06-09T13:00:00+08:00").success).toBe(false);
    // Zero-length windows are rejected, not treated as instant events.
    expect(schedule("2026-06-09T12:00:00Z", "2026-06-09T12:00:00Z").success).toBe(false);
  });

  it("guards that non-finite and float numbers cannot enter confidence, budget or attempt counters", () => {
    const confidence = (value: unknown) =>
      ActionIntentSchema.safeParse({
        type: "manual_review",
        actionType: "draft",
        summary: "Review",
        reason: "Needs a human",
        metadata: { confidence: value }
      });

    expect(confidence(0.5).success).toBe(true);
    // `z.number()` in this zod major rejects NaN/Infinity outright.
    expect(confidence(Number.NaN).success).toBe(false);
    expect(confidence(Number.POSITIVE_INFINITY).success).toBe(false);
    // Beyond 2^53 the value is still accepted as a number, so metadata cannot carry an
    // exact integer counter; treat large metadata numbers as floats downstream.
    expect(confidence(Number.MAX_SAFE_INTEGER + 1).success).toBe(true);

    const journal = createJobExecutionJournal({
      at: "2026-06-09T12:00:00.000Z",
      status: "queued",
      attemptCount: 0,
      summary: "Job queued for worker execution."
    });

    expect(journal.retryCount).toBe(0);
    expect(() =>
      appendJobExecutionJournalEntry({
        journal,
        at: "2026-06-09T12:00:01.000Z",
        status: "running",
        attemptCount: 1.5,
        summary: "Attempt 1.5"
      })
    ).toThrow(/attempt|invalid_type|too_small|integer/iu);
    expect(() =>
      appendJobExecutionJournalEntry({
        journal,
        at: "2026-06-09T12:00:01.000Z",
        status: "running",
        attemptCount: 26,
        summary: "Beyond the bounded retry window"
      })
    ).toThrow(/attempt|too_big|maximum/iu);
  });

  it("guards that the bounded execution journal drops the oldest entries instead of overflowing the contract", () => {
    let journal = createJobExecutionJournal({
      at: "2026-06-09T12:00:00.000Z",
      status: "queued",
      attemptCount: 0,
      summary: "Job queued for worker execution."
    });

    for (let attempt = 1; attempt <= 40; attempt += 1) {
      journal = appendJobExecutionJournalEntry({
        journal,
        at: `2026-06-09T12:${String(attempt % 60).padStart(2, "0")}:00.000Z`,
        status: "running",
        attemptCount: attempt % 25,
        summary: `Attempt ${attempt} claimed by worker-1.`,
        providerRef: `prov-${attempt}`
      });
    }

    expect(journal.entries).toHaveLength(25);
    expect(journal.entries.at(-1)?.summary).toBe("Attempt 40 claimed by worker-1.");
    expect(journal.entries[0]?.summary).toBe("Attempt 16 claimed by worker-1.");
    expect(journal.providerRef).toBe("prov-40");
    expect(journal.lastUpdatedAt).toBe("2026-06-09T12:40:00.000Z");
  });

  it("guards that delete-record confirmation tokens are trimmed before their minimum length is enforced", () => {
    const padded = DeleteRecordActionIntentSchema.safeParse({
      type: "delete_record",
      targetType: "goal",
      targetId: "goal-1",
      reason: "Remove duplicate",
      confirmationToken: "   short  "
    });
    const blank = DeleteRecordActionIntentSchema.safeParse({
      type: "delete_record",
      targetType: "goal",
      targetId: "goal-1",
      reason: "Remove duplicate",
      confirmationToken: "        "
    });
    const valid = DeleteRecordActionIntentSchema.safeParse({
      type: "delete_record",
      targetType: "goal",
      targetId: "goal-1",
      reason: "Remove duplicate",
      confirmationToken: "confirm-123"
    });

    expect(padded.success).toBe(false);
    expect(blank.success).toBe(false);
    expect(valid.success).toBe(true);
    if (valid.success) {
      expect(valid.data.confirmationToken).toBe("confirm-123");
    }
  });
});
