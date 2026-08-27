import {
  ActionIntentSchema,
  ApprovalNotificationJobPayloadSchema,
  BriefingPreferencesSchema,
  BriefingScheduleEntrySchema,
  DeleteRecordActionIntentSchema,
  JobRecordSchema,
  SendMessageActionIntentSchema,
  UpdateRecordActionIntentSchema,
  appendJobExecutionJournalEntry,
  buildApprovalNotificationDeliveryTarget,
  createJobExecutionJournal,
  createUserResponsibilityAssignee,
  deriveGoalContract,
  deriveGoalResponsibility
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

  it("exposes a real defect: public_share_view jobs never reach the `share:` branch, so all views of one goal share a single target", () => {
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

    // DEFECT: packages/contracts/src/index.ts `deriveJobExecutionSideEffectTarget()`
    // tests the generic `"goalId" in payload` branch before the `public_share_view`
    // branch, so the documented `share:${shareId}` target is dead code. Two unrelated
    // shares of the same goal collapse onto `goal:goal-shared`, which is also fed into
    // concurrency/ledger keys (the same ordering exists in packages/execution).
    // Suggested fix: move the type-specific branches (privacy_operation,
    // public_share_view, deployment_canary) above the generic goalId fallback.
    expect(first.journal.sideEffectTarget).toBe("goal:goal-shared");
    expect(second.journal.sideEffectTarget).toBe("goal:goal-shared");
    expect(first.journal.sideEffectTarget).not.toBe("share:share-alpha");
    expect(first.payload.shareId).not.toBe(second.payload.shareId);
  });

  it("exposes a real defect: a payload-valid replayedFromJobId longer than the journal cap makes the whole job record unparseable", () => {
    const longReplayRef = "j".repeat(240);
    const payload = ApprovalNotificationJobPayloadSchema.parse({
      type: "approval_notification",
      channel: "slack",
      approvalId: "approval-1",
      goalId: "goal-1",
      taskId: "task-1",
      decision: "approved",
      metadata: { replayedFromJobId: longReplayRef }
    });

    // The payload contract itself accepts the value (no max on replayedFromJobId).
    expect(payload.metadata.replayedFromJobId).toBe(longReplayRef);

    // DEFECT: packages/contracts/src/index.ts `ApprovalNotificationMetadataSchema`
    // allows an unbounded `replayedFromJobId`, but `createJobExecutionJournal()` pipes
    // it into `JobExecutionJournalSchema.replayedFromJobId` (max 200) and into the
    // queued-state summary (max 280). A stored row like this parses fine as a payload
    // and then throws inside the JobRecordSchema transform, so the record can never be
    // read back: the API/worker fails hard instead of degrading.
    // Suggested fix: cap `replayedFromJobId` at 200 in the payload schema (or truncate
    // defensively in deriveReplayedFromJobId) so validation and derivation agree.
    expect(() =>
      JobRecordSchema.parse(
        baseJobRecord({
          kind: "approval_notification",
          status: "queued",
          completedAt: null,
          payload
        })
      )
    ).toThrow(/too_big|at most|maximum|replayedFromJobId|summary/iu);
  });

  it("exposes a real defect: colon-bearing ids make approval-notification delivery targets collide across different approvals", () => {
    const parsePayload = (input: Record<string, unknown>) =>
      ApprovalNotificationJobPayloadSchema.parse({
        type: "approval_notification",
        goalId: "goal-1",
        taskId: "task-1",
        decision: "approved",
        ...input
      });

    const nestedApproval = parsePayload({
      channel: "slack_receipt",
      approvalId: "ap",
      slackChannelId: "b:slack_receipt:c",
      slackMessageTs: "1710000000.000100"
    });
    const flatApproval = parsePayload({
      channel: "slack_receipt",
      approvalId: "ap:slack_receipt:b",
      slackChannelId: "c",
      slackMessageTs: "1710000000.000100"
    });

    // DEFECT: `buildApprovalNotificationDeliveryTarget()` joins attacker-influenced
    // segments with `:` while `approvalId` (min 1, no charset) and `slackChannelId`
    // (min 1/max 80, no charset) accept colons. Two different approvals/threads produce
    // one identical idempotency target, so a legitimate second receipt can be treated as
    // an already-delivered side effect.
    // Suggested fix: validate `approvalId`/`slackChannelId` against a colon-free charset
    // (or hash the segments) before composing the delivery target.
    expect(flatApproval.approvalId).not.toBe(nestedApproval.approvalId);
    expect(flatApproval.slackChannelId).not.toBe(nestedApproval.slackChannelId);
    expect(buildApprovalNotificationDeliveryTarget(nestedApproval)).toBe(
      buildApprovalNotificationDeliveryTarget(flatApproval)
    );
    expect(buildApprovalNotificationDeliveryTarget(flatApproval)).toBe(
      "approval-notification:ap:slack_receipt:b:slack_receipt:c:1710000000.000100"
    );
  });
});

describe("adversarial contract validation: blank and invisible identity fields", () => {
  it("exposes a real defect: responsibility assignees accept blank ids that every other contract id trims away", () => {
    const nbspUserId = createUserResponsibilityAssignee("\u00a0\u00a0", "Goal owner");
    const zwspResponsibility = deriveGoalResponsibility({ userId: "\u200b" });

    // DEFECT: packages/contracts/src/index.ts `WorkflowResponsibilityAssigneeSchema.userId`
    // (and `systemActor`) use `z.string().min(1)` with no `.trim()`, unlike action-intent
    // ids which are `.trim().min(1)`. A whitespace-only or zero-width user id is stored as
    // a real accountable owner, so ownership/handoff audits can point at an invisible actor.
    // Suggested fix: `.trim().min(1)` (plus a non-blank guard for format-only input) on
    // identity fields that are rendered or compared downstream.
    expect(nbspUserId.userId).toBe("\u00a0\u00a0");
    expect(zwspResponsibility.owner.userId).toBe("\u200b");
    expect(zwspResponsibility.escalationOwner?.userId).toBe("\u200b");

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

  it("exposes a real defect: required user-facing text passes when it contains only invisible Unicode format characters", () => {
    const zeroWidthSubject = SendMessageActionIntentSchema.parse({
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

    // Invisible-character policy is inconsistent: `String.prototype.trim` strips NBSP
    // (so the blank subject below is rejected), but U+200B/U+200E/U+2060 are not
    // whitespace, so a subject that renders as nothing is accepted and forwarded to a
    // real outbound email draft.
    // DEFECT: add a shared "must contain at least one visible code point" guard
    // (e.g. /\p{L}|\p{N}|\p{Pp}/u) to trimmed min(1) text fields in the action intents.
    expect(nbspSubject.success).toBe(false);
    expect(zeroWidthSubject.subject).toBe("\u200b\u200e\u2060");
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

  it("exposes a real defect: briefing preferences accept any non-blank timezone string that the scheduler cannot resolve", () => {
    const scheduleTypes = ["startup", "midday", "pre_meeting", "end_of_day", "next_day"] as const;
    const prefs = BriefingPreferencesSchema.parse({
      userId: "owner",
      timezone: "Mars/Olympus_Mons",
      focus: "balanced",
      schedules: scheduleTypes.map((type) => ({ type, enabled: true, time: "08:30" })),
      createdAt: "2026-06-09T12:00:00.000Z",
      updatedAt: "2026-06-09T12:00:00.000Z"
    });
    const blankPrefs = BriefingPreferencesSchema.safeParse({
      userId: "owner",
      timezone: "\u00a0",
      focus: "balanced",
      schedules: scheduleTypes.map((type) => ({ type, enabled: true, time: "08:30" })),
      createdAt: "2026-06-09T12:00:00.000Z",
      updatedAt: "2026-06-09T12:00:00.000Z"
    });

    expect(prefs.timezone).toBe("Mars/Olympus_Mons");
    expect(blankPrefs.success).toBe(true);

    // Harm proof: the accepted value is unusable downstream
    // (packages/orchestrator/src/morning-briefing.ts builds an Intl formatter with it).
    expect(() =>
      new Intl.DateTimeFormat("en-US", { timeZone: prefs.timezone, hour: "2-digit" })
    ).toThrow(RangeError);

    // DEFECT: packages/contracts/src/index.ts `BriefingPreferencesSchema.timezone` is
    // `z.string().min(1)` (and WorkflowSchedule timezone/cron are unbounded-ish strings
    // too), so a typo'd or whitespace-only zone is persisted and only explodes at
    // briefing generation time as a RangeError.
    // Suggested fix: validate against `Intl.supportedValuesOf("timeZone")` (or a
    // try/catch Intl.DateTimeFormat probe) in a schema refine, and `.trim()` the value.
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
