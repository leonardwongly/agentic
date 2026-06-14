import { mkdtemp } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  DEFAULT_OWNER_USER_ID,
  WatcherSchema,
  createSystemActorContext,
  nowIso,
  type Commitment
} from "@agentic/contracts";
import { processUserRequest } from "@agentic/orchestrator";
import { createRepository } from "@agentic/repository";
import { createDeadlineWatcherSignalEvaluator, runWatcherSchedulerOnce } from "@agentic/worker-runtime";
import { afterEach, describe, expect, it, vi } from "vitest";

const NOW = "2026-04-20T00:00:00.000Z";
const NOW_MS = Date.parse(NOW);
const GOAL_ID = "aos19-goal";

function buildWatcher(overrides: Record<string, unknown> = {}) {
  const timestamp = nowIso();
  return WatcherSchema.parse({
    id: "watcher-deadline-1",
    goalId: GOAL_ID,
    targetEntity: "commitment deadlines",
    condition: "An open commitment is overdue or due soon.",
    frequency: "5min",
    triggerAction: "Surface the approaching deadline for operator review.",
    status: "active",
    actorContext: createSystemActorContext(DEFAULT_OWNER_USER_ID),
    createdAt: timestamp,
    updatedAt: timestamp,
    ...overrides
  });
}

function commitment(overrides: Partial<Commitment> & Pick<Commitment, "id">): Commitment {
  return {
    userId: DEFAULT_OWNER_USER_ID,
    title: "Reply to the client",
    summary: "A tracked commitment.",
    status: "pending",
    sourceKind: "goal",
    sourceId: "src-1",
    goalId: GOAL_ID,
    approvalId: null,
    dueAt: null,
    actorContext: null,
    urgency: "later",
    riskClass: null,
    confidence: 0.8,
    provenanceSummary: "Captured commitment.",
    suggestedNextAction: null,
    evidence: [{ section: "goals", itemId: "src-1", label: "Reply to the client" }],
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides
  } as unknown as Commitment;
}

function fakeRepository(commitments: Commitment[]) {
  return {
    listCommitments: async () => commitments
  };
}

describe("deadline watcher signal evaluator", () => {
  const evaluatorOptions = { leadWindowMs: 24 * 60 * 60 * 1000, now: () => NOW_MS };

  it("fires on an overdue open commitment and returns a dedupe cursor", async () => {
    const evaluate = createDeadlineWatcherSignalEvaluator({
      repository: fakeRepository([commitment({ id: "c-overdue", dueAt: "2026-04-19T00:00:00.000Z" })]),
      ...evaluatorOptions
    });

    const result = await evaluate(buildWatcher());

    expect(result.wouldTrigger).toBe(true);
    expect(result.reason).toContain("overdue");
    expect(result.cursor).toBe("c-overdue:2026-04-19T00:00:00.000Z");
  });

  it("fires on a commitment due within the lead window", async () => {
    const evaluate = createDeadlineWatcherSignalEvaluator({
      repository: fakeRepository([commitment({ id: "c-soon", dueAt: "2026-04-20T06:00:00.000Z" })]),
      ...evaluatorOptions
    });

    const result = await evaluate(buildWatcher());

    expect(result.wouldTrigger).toBe(true);
    expect(result.reason).toContain("due soon");
  });

  it("does not fire when the due date is beyond the lead window", async () => {
    const evaluate = createDeadlineWatcherSignalEvaluator({
      repository: fakeRepository([commitment({ id: "c-far", dueAt: "2026-04-25T00:00:00.000Z" })]),
      ...evaluatorOptions
    });

    expect((await evaluate(buildWatcher())).wouldTrigger).toBe(false);
  });

  it("ignores resolved commitments", async () => {
    const evaluate = createDeadlineWatcherSignalEvaluator({
      repository: fakeRepository([
        commitment({ id: "c-done", dueAt: "2026-04-19T00:00:00.000Z", status: "completed" }),
        commitment({ id: "c-dismissed", dueAt: "2026-04-19T00:00:00.000Z", status: "dismissed" })
      ]),
      ...evaluatorOptions
    });

    expect((await evaluate(buildWatcher())).wouldTrigger).toBe(false);
  });

  it("ignores commitments linked to a different goal", async () => {
    const evaluate = createDeadlineWatcherSignalEvaluator({
      repository: fakeRepository([
        commitment({ id: "c-other", dueAt: "2026-04-19T00:00:00.000Z", goalId: "another-goal" })
      ]),
      ...evaluatorOptions
    });

    expect((await evaluate(buildWatcher())).wouldTrigger).toBe(false);
  });

  it("selects the earliest due commitment", async () => {
    const evaluate = createDeadlineWatcherSignalEvaluator({
      repository: fakeRepository([
        commitment({ id: "c-late", dueAt: "2026-04-20T08:00:00.000Z" }),
        commitment({ id: "c-early", dueAt: "2026-04-20T02:00:00.000Z" })
      ]),
      ...evaluatorOptions
    });

    expect((await evaluate(buildWatcher())).cursor).toBe("c-early:2026-04-20T02:00:00.000Z");
  });

  it("does not re-signal a deadline already recorded in the cursor", async () => {
    const evaluate = createDeadlineWatcherSignalEvaluator({
      repository: fakeRepository([commitment({ id: "c-soon", dueAt: "2026-04-20T06:00:00.000Z" })]),
      ...evaluatorOptions
    });
    const watcher = buildWatcher({
      schedule: { enabled: true, dryRun: true, cursor: "c-soon:2026-04-20T06:00:00.000Z", lastRunAt: null, nextRunAt: null, lease: null }
    });

    const result = await evaluate(watcher);

    expect(result.wouldTrigger).toBe(false);
    expect(result.reason).toContain("already signaled");
  });

  it("does not fire without a subject user", async () => {
    const evaluate = createDeadlineWatcherSignalEvaluator({
      repository: fakeRepository([commitment({ id: "c-soon", dueAt: "2026-04-20T06:00:00.000Z" })]),
      ...evaluatorOptions
    });

    expect((await evaluate(buildWatcher({ actorContext: null }))).wouldTrigger).toBe(false);
  });
});

describe("deadline watcher evaluator wired into the scheduler", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  async function createFixture() {
    const tempDir = await mkdtemp(path.join(os.tmpdir(), "agentic-watcher-signal-"));
    const repository = createRepository({ storePath: path.join(tempDir, "runtime-store.json") });
    await repository.seedDefaults(DEFAULT_OWNER_USER_ID);
    const bundle = await processUserRequest({
      userId: DEFAULT_OWNER_USER_ID,
      request: "Track the contract renewal and prepare a safe follow-up.",
      memories: await repository.listMemory(DEFAULT_OWNER_USER_ID),
      integrations: await repository.listIntegrations(DEFAULT_OWNER_USER_ID)
    });
    await repository.saveGoalBundle(bundle);
    await repository.saveCommitment(
      commitment({ id: "c-renewal", goalId: bundle.goal.id, dueAt: "2026-04-20T06:00:00.000Z", status: "pending" })
    );
    return { repository, goalId: bundle.goal.id };
  }

  it("records a dry-run deadline signal without claiming an autopilot event", async () => {
    const { repository, goalId } = await createFixture();
    const watcher = await repository.saveWatcher(buildWatcher({ goalId }));
    const claimSpy = vi.spyOn(repository, "claimAutopilotEvent");

    const result = await runWatcherSchedulerOnce({
      repository,
      runnerId: "scheduler-aos19",
      userId: DEFAULT_OWNER_USER_ID,
      now: NOW,
      evaluator: createDeadlineWatcherSignalEvaluator({ repository, now: () => NOW_MS })
    });

    const decision = result.decisions.find((entry) => entry.watcherId === watcher.id);
    expect(decision?.action).toBe("dry_run_recorded");
    expect(claimSpy).not.toHaveBeenCalled();
    const persisted = (await repository.listWatchers({ userId: DEFAULT_OWNER_USER_ID })).find((w) => w.id === watcher.id);
    expect(persisted?.lastEvaluation?.wouldTrigger).toBe(true);
    expect(persisted?.lastEvaluation?.sideEffectsSuppressed).toBe(true);
  });

  it("claims one autopilot event for an active watcher and dedupes repeat passes", async () => {
    const { repository, goalId } = await createFixture();
    const watcher = await repository.saveWatcher(
      buildWatcher({
        goalId,
        schedule: { enabled: true, dryRun: false, cursor: null, lastRunAt: null, nextRunAt: null, lease: null }
      })
    );
    const evaluator = createDeadlineWatcherSignalEvaluator({ repository, now: () => NOW_MS });

    const first = await runWatcherSchedulerOnce({
      repository,
      runnerId: "scheduler-aos19",
      userId: DEFAULT_OWNER_USER_ID,
      now: NOW,
      evaluator
    });
    const firstDecision = first.decisions.find((entry) => entry.watcherId === watcher.id);
    expect(firstDecision?.action).toBe("trigger_claimed");

    const eventsAfterFirst = (await repository.listAutopilotEvents(DEFAULT_OWNER_USER_ID)).filter(
      (event) => event.sourceId === watcher.id
    );
    expect(eventsAfterFirst).toHaveLength(1);

    // A later pass (so the watcher is due again) must not re-signal the same deadline.
    const second = await runWatcherSchedulerOnce({
      repository,
      runnerId: "scheduler-aos19",
      userId: DEFAULT_OWNER_USER_ID,
      now: "2026-04-20T01:00:00.000Z",
      evaluator
    });
    const secondDecision = second.decisions.find((entry) => entry.watcherId === watcher.id);
    expect(secondDecision?.action).toBe("skipped");
    expect(secondDecision?.reason).toContain("already signaled");

    const eventsAfterSecond = (await repository.listAutopilotEvents(DEFAULT_OWNER_USER_ID)).filter(
      (event) => event.sourceId === watcher.id
    );
    expect(eventsAfterSecond).toHaveLength(1);
  });
});
