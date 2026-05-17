import { SYSTEM_USER_ID } from "@agentic/contracts";
import { processUserRequest } from "@agentic/orchestrator";
import { buildDefaultIntegrationAccounts } from "@agentic/integrations";
import { createMemoryRecord } from "@agentic/memory";
import {
  buildSharedGoalView,
  buildGoalShareUrl,
  createGoalShareCreatedLog,
  createGoalShareExpiredLog,
  createGoalShareFailedAccessLog,
  createGoalShareToken,
  createGoalShareViewedLog,
  fingerprintGoalShareToken,
  inspectGoalShareToken,
  verifyGoalShareToken
} from "../apps/web/lib/share";
import { buildGoalShareDisclosureReview } from "../apps/web/lib/share-disclosure";
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
  const originalPublicBaseUrl = process.env.AGENTIC_PUBLIC_BASE_URL;
  const originalNodeEnv = process.env.NODE_ENV;

  beforeEach(() => {
    process.env.AGENTIC_ACCESS_KEY = "test-access-key";
    delete process.env.AGENTIC_PUBLIC_BASE_URL;
    process.env.NODE_ENV = "test";
  });

  afterEach(() => {
    process.env.AGENTIC_ACCESS_KEY = originalAccessKey;
    if (originalPublicBaseUrl === undefined) {
      delete process.env.AGENTIC_PUBLIC_BASE_URL;
    } else {
      process.env.AGENTIC_PUBLIC_BASE_URL = originalPublicBaseUrl;
    }
    process.env.NODE_ENV = originalNodeEnv;
  });

  it("creates and verifies signed goal share tokens", () => {
    const token = createGoalShareToken("share-123", "goal-123", "2026-04-09T00:00:00.000Z");

    expect(verifyGoalShareToken(token, Date.parse("2026-04-02T00:00:00.000Z"))).toMatchObject({
      shareId: "share-123",
      goalId: "goal-123"
    });
  });

  it("rejects tampered or expired goal share tokens", () => {
    const token = createGoalShareToken("share-123", "goal-123", "2026-04-03T00:00:00.000Z");
    const [encodedPayload, signature] = token.split(".");
    const tampered = `${encodedPayload}.${signature?.slice(0, -1)}x`;

    expect(verifyGoalShareToken(tampered, Date.parse("2026-04-02T00:00:00.000Z"))).toBeNull();
    expect(verifyGoalShareToken(token, Date.parse("2026-04-04T00:00:00.000Z"))).toBeNull();
  });

  it("inspects signed expired tokens without accepting them for public access", () => {
    const token = createGoalShareToken("share-123", "goal-123", "2026-04-03T00:00:00.000Z");
    const inspection = inspectGoalShareToken(token, Date.parse("2026-04-04T00:00:00.000Z"));

    expect(inspection).toMatchObject({
      valid: true,
      expired: true,
      payload: {
        shareId: "share-123",
        goalId: "goal-123"
      }
    });
    expect(verifyGoalShareToken(token, Date.parse("2026-04-04T00:00:00.000Z"))).toBeNull();
  });

  it("rejects malformed and oversized goal share tokens", () => {
    expect(verifyGoalShareToken("not-a-token")).toBeNull();
    expect(verifyGoalShareToken("a.b.c")).toBeNull();
    expect(verifyGoalShareToken(`${"x".repeat(5000)}.${"y".repeat(50)}`)).toBeNull();
    expect(verifyGoalShareToken("bm90LWpzb24.signature")).toBeNull();
  });

  it("builds share links from the configured public base URL in production", () => {
    process.env.NODE_ENV = "production";
    process.env.AGENTIC_PUBLIC_BASE_URL = "https://agentic.example.com";

    expect(buildGoalShareUrl("http://internal-service.local/api/goals/goal-1/share", "token/with spaces")).toBe(
      "https://agentic.example.com/share/token%2Fwith%20spaces"
    );
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
    expect(sharedView).not.toHaveProperty("watchers");
    expect(sharedView.tasks[0]).not.toHaveProperty("id");
    expect(sharedView.artifacts[0]).not.toHaveProperty("id");
  });

  it("builds a disclosure review with sensitive field detection and explicit redaction classes", async () => {
    const bundle = await buildBundle();
    const review = buildGoalShareDisclosureReview(
      {
        ...bundle,
        goal: {
          ...bundle.goal,
          explanation: "Share this with reviewer@example.com after removing API token details."
        },
        tasks: [
          {
            ...bundle.tasks[0]!,
            summary: "Call +65 6123 4567 only after the public share is checked."
          }
        ]
      },
      {
        expiresAt: "2026-04-09T00:00:00.000Z",
        expiryDays: 7
      }
    );

    expect(review.confirmationRequired).toBe(true);
    expect(review.redactedFields).toEqual(
      expect.arrayContaining(["goal.request", "approvals", "actionLogs", "artifacts.content", "workflow.checkpoint"])
    );
    expect(review.dataClasses).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "operator_context",
          disposition: "redacted"
        }),
        expect.objectContaining({
          id: "artifact_metadata",
          disposition: "included",
          fields: ["artifacts.title", "artifacts.artifactType", "artifacts.createdAt"]
        }),
        expect.objectContaining({
          id: "goal_summary",
          disposition: "requires_confirmation"
        })
      ])
    );
    expect(review.sensitiveFindings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          fieldPath: "goal.explanation",
          detector: "email_address"
        }),
        expect.objectContaining({
          fieldPath: "goal.explanation",
          detector: "secret_keyword"
        }),
        expect.objectContaining({
          fieldPath: "tasks.0.summary",
          detector: "phone_number"
        })
      ])
    );
    expect(JSON.stringify(review)).not.toContain(bundle.goal.request);
  });

  it("does not flag ISO-style dates as phone numbers in disclosure review", async () => {
    const bundle = await buildBundle();
    const review = buildGoalShareDisclosureReview(
      {
        ...bundle,
        goal: {
          ...bundle.goal,
          explanation: "Review the timeline on 2026-04-30 before publishing the update."
        }
      },
      {
        expiresAt: "2026-05-07T00:00:00.000Z",
        expiryDays: 7
      }
    );

    expect(review.sensitiveFindings).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          detector: "phone_number"
        })
      ])
    );
  });

  it("deduplicates repeated public share views within the cooldown window", async () => {
    const bundle = await buildBundle();
    const shareId = "share-dedupe";
    const token = createGoalShareToken(shareId, bundle.goal.id, "2026-04-09T00:00:00.000Z");
    const createdLog = createGoalShareCreatedLog(bundle, shareId, token, "2026-04-09T00:00:00.000Z");
    const firstViewLog = createGoalShareViewedLog(
      {
        ...bundle,
        actionLogs: [...bundle.actionLogs, createdLog]
      },
      shareId,
      token,
      Date.parse("2026-04-02T00:00:00.000Z")
    );

    expect(firstViewLog).not.toBeNull();

    const secondViewLog = createGoalShareViewedLog(
      {
        ...bundle,
        actionLogs: [...bundle.actionLogs, createdLog, firstViewLog!]
      },
      shareId,
      token,
      Date.parse("2026-04-02T00:05:00.000Z")
    );

    expect(secondViewLog).toBeNull();
  });

  it("allows another public view after the cooldown window", async () => {
    const bundle = await buildBundle();
    const shareId = "share-later-view";
    const token = createGoalShareToken(shareId, bundle.goal.id, "2026-04-09T00:00:00.000Z");
    const createdLog = createGoalShareCreatedLog(bundle, shareId, token, "2026-04-09T00:00:00.000Z");
    const earlierViewLog = {
      ...createGoalShareViewedLog(
        {
          ...bundle,
          actionLogs: [...bundle.actionLogs, createdLog]
        },
        shareId,
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
      shareId,
      token,
      Date.parse("2026-04-02T00:20:00.000Z")
    );

    expect(laterViewLog).not.toBeNull();
    expect(laterViewLog?.details.shareId).toBe(shareId);
    expect(laterViewLog?.details.tokenFingerprint).toBe(fingerprintGoalShareToken(token));
  });

  it("records token fingerprints without storing raw tokens in logs", async () => {
    const bundle = await buildBundle();
    const shareId = "share-fingerprint";
    const token = createGoalShareToken(shareId, bundle.goal.id, "2026-04-09T00:00:00.000Z");
    const createdLog = createGoalShareCreatedLog(bundle, shareId, token, "2026-04-09T00:00:00.000Z");
    const viewedLog = createGoalShareViewedLog(bundle, shareId, token, Date.parse("2026-04-02T00:00:00.000Z"));

    expect(createdLog.details.shareId).toBe(shareId);
    expect(createdLog.details.tokenFingerprint).toBe(fingerprintGoalShareToken(token));
    expect(viewedLog?.details.shareId).toBe(shareId);
    expect(viewedLog?.details.tokenFingerprint).toBe(fingerprintGoalShareToken(token));
    expect(JSON.stringify(createdLog.details)).not.toContain(token);
    expect(JSON.stringify(viewedLog?.details ?? {})).not.toContain(token);
  });

  it("builds deduplicated expired and failed-access audit logs without raw tokens", async () => {
    const bundle = await buildBundle();
    const shareId = "share-audit";
    const token = createGoalShareToken(shareId, bundle.goal.id, "2026-04-09T00:00:00.000Z");
    const tokenFingerprint = fingerprintGoalShareToken(token);
    const expiredLog = createGoalShareExpiredLog(bundle, shareId, tokenFingerprint, Date.parse("2026-04-10T00:00:00.000Z"));
    const duplicateExpiredLog = createGoalShareExpiredLog(
      {
        ...bundle,
        actionLogs: [...bundle.actionLogs, expiredLog!]
      },
      shareId,
      tokenFingerprint,
      Date.parse("2026-04-10T00:00:01.000Z")
    );
    const failedLog = createGoalShareFailedAccessLog(
      {
        ...bundle,
        actionLogs: [...bundle.actionLogs, expiredLog!]
      },
      shareId,
      tokenFingerprint,
      "expired",
      Date.parse("2026-04-10T00:00:01.000Z")
    );
    const duplicateFailedLog = createGoalShareFailedAccessLog(
      {
        ...bundle,
        actionLogs: [...bundle.actionLogs, expiredLog!, failedLog!]
      },
      shareId,
      tokenFingerprint,
      "expired",
      Date.parse("2026-04-10T00:05:00.000Z")
    );

    expect(expiredLog?.kind).toBe("share.link_expired");
    expect(duplicateExpiredLog).toBeNull();
    expect(failedLog?.kind).toBe("share.access_failed");
    expect(failedLog?.details.reason).toBe("expired");
    expect(duplicateFailedLog).toBeNull();
    expect(JSON.stringify([expiredLog, failedLog])).not.toContain(token);
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
    expect(sharedView).not.toHaveProperty("watchers");
  });

  it("selects the correct share success message for clipboard and fallback flows", () => {
    expect(getGoalShareSuccessMessage("Goal title", true)).toBe('Copied a public share link for "Goal title".');
    expect(getGoalShareSuccessMessage("Goal title", false)).toBe('Created a public share link for "Goal title".');
  });
});
