import { SYSTEM_USER_ID } from "@agentic/contracts";
import { processUserRequest } from "@agentic/orchestrator";
import { buildDefaultIntegrationAccounts } from "@agentic/integrations";
import { createMemoryRecord } from "@agentic/memory";
import {
  buildSharedGoalView,
  createGoalShareCreatedLog,
  createGoalShareToken,
  createGoalShareViewedLog,
  fingerprintGoalShareToken,
  verifyGoalShareToken
} from "../apps/web/lib/share";
import { getGoalShareSuccessMessage } from "../apps/web/lib/share-client";

async function buildBundle() {
  return processUserRequest({
    userId: SYSTEM_USER_ID,
    request: "Triage my inbox and prepare replies for important clients.",
    memories: [
      createMemoryRecord({
        userId: SYSTEM_USER_ID,
        category: "style",
        memoryType: "confirmed",
        content: "Use concise approval summaries.",
        confidence: 0.95,
        source: "test"
      })
    ],
    integrations: buildDefaultIntegrationAccounts(SYSTEM_USER_ID)
  });
}

describe("goal share helpers", () => {
  const originalAccessKey = process.env.AGENTIC_ACCESS_KEY;

  beforeEach(() => {
    process.env.AGENTIC_ACCESS_KEY = "test-access-key";
  });

  afterEach(() => {
    process.env.AGENTIC_ACCESS_KEY = originalAccessKey;
  });

  it("creates and verifies signed goal share tokens", () => {
    const token = createGoalShareToken("goal-123", "2026-04-09T00:00:00.000Z");

    expect(verifyGoalShareToken(token, Date.parse("2026-04-02T00:00:00.000Z"))).toMatchObject({
      goalId: "goal-123"
    });
  });

  it("rejects tampered or expired goal share tokens", () => {
    const token = createGoalShareToken("goal-123", "2026-04-03T00:00:00.000Z");
    const [encodedPayload, signature] = token.split(".");
    const tampered = `${encodedPayload}.${signature?.slice(0, -1)}x`;

    expect(verifyGoalShareToken(tampered, Date.parse("2026-04-02T00:00:00.000Z"))).toBeNull();
    expect(verifyGoalShareToken(token, Date.parse("2026-04-04T00:00:00.000Z"))).toBeNull();
  });

  it("rejects malformed and oversized goal share tokens", () => {
    expect(verifyGoalShareToken("not-a-token")).toBeNull();
    expect(verifyGoalShareToken("a.b.c")).toBeNull();
    expect(verifyGoalShareToken(`${"x".repeat(5000)}.${"y".repeat(50)}`)).toBeNull();
    expect(verifyGoalShareToken("bm90LWpzb24.signature")).toBeNull();
  });

  it("builds a public goal projection without leaking internal-only bundle data", async () => {
    const bundle = await buildBundle();
    const privateApprovals =
      bundle.approvals.length > 0
        ? bundle.approvals.map((approval) => ({
            ...approval,
            title: "PRIVATE-APPROVAL"
          }))
        : [
            {
              id: "approval-private",
              goalId: bundle.goal.id,
              taskId: bundle.tasks[0]?.id ?? "task-private",
              title: "PRIVATE-APPROVAL",
              rationale: "PRIVATE-RATIONALE",
              riskClass: "R2" as const,
              decision: "pending" as const,
              requestedAction: "Do not expose this approval",
              preview: {
                actionType: "artifact-only" as const,
                target: "Internal review artifact",
                summary: "Review the private approval artifact internally.",
                changes: [],
                impact: {
                  affectedPeople: [],
                  affectedSystems: ["workspace"],
                  permissions: [],
                  rollback: "supported"
                }
              },
              decisionScope: null,
              decisionRationale: null,
              history: [],
              createdAt: "2026-04-02T00:00:00.000Z",
              expiryAt: null,
              respondedAt: null
            }
          ];
    const sharedView = buildSharedGoalView({
      ...bundle,
      goal: {
        ...bundle.goal,
        request: "PRIVATE-REQUEST"
      },
      approvals: privateApprovals,
      actionLogs: [
        ...bundle.actionLogs,
        {
          id: "log-private",
          goalId: bundle.goal.id,
          taskId: null,
          workflowId: bundle.workflow.id,
          actor: "test",
          kind: "private.log",
          message: "PRIVATE-LOG",
          details: {
            secret: "PRIVATE-DETAIL"
          },
          createdAt: "2026-04-02T00:00:00.000Z"
        }
      ]
    });

    expect(sharedView).toMatchObject({
      title: bundle.goal.title,
      explanation: bundle.goal.explanation,
      intent: bundle.goal.intent,
      taskCount: bundle.tasks.length,
      artifactCount: bundle.artifacts.length,
      watcherCount: bundle.watchers.length
    });
    expect(sharedView).not.toHaveProperty("request");
    expect(sharedView).not.toHaveProperty("approvals");
    expect(sharedView).not.toHaveProperty("actionLogs");
    expect(sharedView.tasks[0]).not.toHaveProperty("id");
    expect(sharedView.artifacts[0]).not.toHaveProperty("id");
    expect(sharedView.watchers[0]).not.toHaveProperty("id");
  });

  it("deduplicates repeated public share views within the cooldown window", async () => {
    const bundle = await buildBundle();
    const token = createGoalShareToken(bundle.goal.id, "2026-04-09T00:00:00.000Z");
    const createdLog = createGoalShareCreatedLog(bundle, token, "2026-04-09T00:00:00.000Z");
    const firstViewLog = createGoalShareViewedLog(
      {
        ...bundle,
        actionLogs: [...bundle.actionLogs, createdLog]
      },
      token,
      Date.parse("2026-04-02T00:00:00.000Z")
    );

    expect(firstViewLog).not.toBeNull();

    const secondViewLog = createGoalShareViewedLog(
      {
        ...bundle,
        actionLogs: [...bundle.actionLogs, createdLog, firstViewLog!]
      },
      token,
      Date.parse("2026-04-02T00:05:00.000Z")
    );

    expect(secondViewLog).toBeNull();
  });

  it("allows another public view after the cooldown window", async () => {
    const bundle = await buildBundle();
    const token = createGoalShareToken(bundle.goal.id, "2026-04-09T00:00:00.000Z");
    const createdLog = createGoalShareCreatedLog(bundle, token, "2026-04-09T00:00:00.000Z");
    const earlierViewLog = {
      ...createGoalShareViewedLog(
        {
          ...bundle,
          actionLogs: [...bundle.actionLogs, createdLog]
        },
        token,
        Date.parse("2026-04-02T00:00:00.000Z")
      )!,
      createdAt: "2026-04-02T00:00:00.000Z"
    };

    const laterViewLog = createGoalShareViewedLog(
      {
        ...bundle,
        actionLogs: [...bundle.actionLogs, createdLog, earlierViewLog]
      },
      token,
      Date.parse("2026-04-02T00:20:00.000Z")
    );

    expect(laterViewLog).not.toBeNull();
    expect(laterViewLog?.details.tokenFingerprint).toBe(fingerprintGoalShareToken(token));
  });

  it("records token fingerprints without storing raw tokens in logs", async () => {
    const bundle = await buildBundle();
    const token = createGoalShareToken(bundle.goal.id, "2026-04-09T00:00:00.000Z");
    const createdLog = createGoalShareCreatedLog(bundle, token, "2026-04-09T00:00:00.000Z");
    const viewedLog = createGoalShareViewedLog(bundle, token, Date.parse("2026-04-02T00:00:00.000Z"));

    expect(createdLog.details.tokenFingerprint).toBe(fingerprintGoalShareToken(token));
    expect(viewedLog?.details.tokenFingerprint).toBe(fingerprintGoalShareToken(token));
    expect(JSON.stringify(createdLog.details)).not.toContain(token);
    expect(JSON.stringify(viewedLog?.details ?? {})).not.toContain(token);
  });

  it("projects large goal bundles without dropping shared content", async () => {
    const bundle = await buildBundle();
    const taskSeed = bundle.tasks[0]!;
    const artifactSeed = bundle.artifacts[0] ?? {
      id: "artifact-seed",
      goalId: bundle.goal.id,
      taskId: bundle.tasks[0]?.id,
      artifactType: "summary" as const,
      title: "Artifact seed",
      content: "Artifact seed content",
      metadata: {},
      createdAt: "2026-04-02T00:00:00.000Z"
    };
    const watcherSeed = bundle.watchers[0] ?? {
      id: "watcher-seed",
      goalId: bundle.goal.id,
      targetEntity: "Shared goal",
      condition: "Changes detected",
      frequency: "daily",
      triggerAction: "Send update",
      sourceSystems: [],
      status: "active" as const,
      expiryAt: null,
      createdAt: "2026-04-02T00:00:00.000Z",
      updatedAt: "2026-04-02T00:00:00.000Z"
    };
    const largeBundle = {
      ...bundle,
      tasks: Array.from({ length: 250 }, (_, index) => ({
        ...taskSeed,
        id: `task-${index}`,
        title: `Task ${index}`
      })),
      artifacts: Array.from({ length: 250 }, (_, index) => ({
        ...artifactSeed,
        id: `artifact-${index}`,
        title: `Artifact ${index}`
      })),
      watchers: Array.from({ length: 250 }, (_, index) => ({
        ...watcherSeed,
        id: `watcher-${index}`,
        targetEntity: `Watcher ${index}`
      }))
    };

    const sharedView = buildSharedGoalView(largeBundle);

    expect(sharedView.taskCount).toBe(250);
    expect(sharedView.artifactCount).toBe(250);
    expect(sharedView.watcherCount).toBe(250);
    expect(sharedView.tasks).toHaveLength(250);
    expect(sharedView.artifacts).toHaveLength(250);
    expect(sharedView.watchers).toHaveLength(250);
  });

  it("selects the correct share success message for clipboard and fallback flows", () => {
    expect(getGoalShareSuccessMessage("Goal title", true)).toBe('Copied a public share link for "Goal title".');
    expect(getGoalShareSuccessMessage("Goal title", false)).toBe('Created a public share link for "Goal title".');
  });
});
