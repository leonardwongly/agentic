import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createSystemActorContext, DEFAULT_OWNER_USER_ID } from "@agentic/contracts";
import { getTelemetrySnapshot, resetTelemetrySnapshot } from "@agentic/observability";
import { createRepository } from "@agentic/repository";
import { processUserRequest } from "@agentic/orchestrator";
import { createSelfImprovementRepository, type SelfImprovementRepository } from "@agentic/self-improvement-memory";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { POST as recommendationFeedbackRoute } from "../apps/web/app/api/goals/[id]/recommendations/feedback/route";
import { buildAuthorizedJsonRequest, expectNoStoreHeaders } from "./route-test-helpers";

async function createGoalForUser(
  repository: ReturnType<typeof createRepository>,
  userId: string,
  request: string,
  workspaceId: string | null = null
) {
  const bundle = await processUserRequest({
    userId,
    workspaceId,
    request,
    memories: await repository.listMemory(userId),
    integrations: await repository.listIntegrations(userId)
  });

  await repository.saveGoalBundle(bundle);
  return bundle;
}

function buildRecommendation() {
  return {
    key: "execution_path:communications:send_message:R3:send",
    source: "outcome_trace" as const,
    workflow: {
      kind: "execution_path" as const,
      agent: "communications",
      action: "send_message",
      riskClass: "R3",
      capabilities: ["draft", "send"]
    },
    reuse: {
      replayMode: "approval_required" as const,
      operatorAction: "require_approval" as const,
      rationale: "Reviewed outbound messages succeed when communications preserves the send path."
    },
    evidence: {
      count: 6,
      approvalCount: 6,
      successCount: 5,
      partialCount: 1,
      failureCount: 0,
      rejectionCount: 0,
      userCorrectionCount: 1,
      averageConfidence: 0.79,
      approvalRate: 1,
      successRate: 0.91,
      negativeRate: 0.16,
      score: 0.8,
      lastSeenAt: "2026-04-20T00:00:00.000Z"
    }
  };
}

describe("recommendation feedback route", () => {
  const originalAccessKey = process.env.AGENTIC_ACCESS_KEY;
  const originalRuntimeStorePath = process.env.AGENTIC_RUNTIME_STORE_PATH;
  const tempDirs: string[] = [];
  let selfImprovementRepository: SelfImprovementRepository;

  beforeEach(async () => {
    resetTelemetrySnapshot();
    process.env.AGENTIC_ACCESS_KEY = "test-access-key";
    const runtimeTempDir = await mkdtemp(path.join(os.tmpdir(), "agentic-recommendation-feedback-"));
    const learningTempDir = await mkdtemp(path.join(os.tmpdir(), "agentic-recommendation-feedback-learning-"));
    tempDirs.push(runtimeTempDir, learningTempDir);
    process.env.AGENTIC_RUNTIME_STORE_PATH = path.join(runtimeTempDir, "runtime-store.json");
    selfImprovementRepository = createSelfImprovementRepository({
      baseDir: path.join(learningTempDir, ".agentic", "self-improvement")
    });
    await selfImprovementRepository.seed();
    Reflect.set(globalThis, "__agenticRepository", undefined);
    Reflect.set(globalThis, "__agenticSelfImprovementRepository", selfImprovementRepository);
  });

  afterEach(async () => {
    process.env.AGENTIC_ACCESS_KEY = originalAccessKey;
    process.env.AGENTIC_RUNTIME_STORE_PATH = originalRuntimeStorePath;
    Reflect.set(globalThis, "__agenticRepository", undefined);
    Reflect.set(globalThis, "__agenticSelfImprovementRepository", undefined);
    resetTelemetrySnapshot();
    await Promise.all(tempDirs.map((tempDir) => rm(tempDir, { recursive: true, force: true })));
    tempDirs.length = 0;
  });

  it("persists recommendation feedback as a goal-scoped action log and returns the dashboard snapshot", async () => {
    const repository = createRepository({
      storePath: process.env.AGENTIC_RUNTIME_STORE_PATH
    });
    await repository.seedDefaults(DEFAULT_OWNER_USER_ID);
    const bundle = await createGoalForUser(repository, DEFAULT_OWNER_USER_ID, "Prepare a reviewed outbound reply for a customer.");
    Reflect.set(globalThis, "__agenticRepository", repository);

    const response = await recommendationFeedbackRoute(
      buildAuthorizedJsonRequest(`http://localhost/api/goals/${bundle.goal.id}/recommendations/feedback`, {
        decision: "accepted",
        recommendation: buildRecommendation()
      }),
      {
        params: Promise.resolve({ id: bundle.goal.id })
      }
    );
    const payload = (await response.json()) as {
      goalId: string;
      message: string;
      dashboard: {
        goals: Array<{ goal: { id: string } }>;
      };
    };
    const reloaded = await repository.getGoalBundle(bundle.goal.id);
    const feedbackLog = reloaded?.actionLogs.find((log) => log.kind === "goal.recommendation_feedback");
    const episodes = await selfImprovementRepository.listEpisodes({ ownerUserId: DEFAULT_OWNER_USER_ID });
    const snapshot = getTelemetrySnapshot();
    const feedbackCountMetric = snapshot.metrics.find(
      (entry) =>
        entry.name === "product.learning.recommendation.feedback.total" &&
        entry.attributes.agent === "communications" &&
        entry.attributes.operatorOutcome === "accepted"
    );
    const feedbackScoreMetric = snapshot.metrics.find(
      (entry) =>
        entry.name === "product.learning.recommendation.feedback.score" &&
        entry.attributes.agent === "communications" &&
        entry.attributes.operatorOutcome === "accepted"
    );

    expect(response.status).toBe(200);
    expectNoStoreHeaders(response);
    expect(payload.goalId).toBe(bundle.goal.id);
    expect(payload.message).toContain("Recorded accepted recommendation feedback");
    expect(payload.dashboard.goals.some((goalBundle) => goalBundle.goal.id === bundle.goal.id)).toBe(true);
    expect(feedbackLog).toBeDefined();
    expect(feedbackLog?.message).toContain("communications send_message");
    expect(feedbackLog?.details).toMatchObject({
      decision: "accepted",
      source: "goal_card",
      recommendation: buildRecommendation()
    });
    expect(episodes).toHaveLength(1);
    expect(episodes[0]).toMatchObject({
      skill: "communications",
      outcome: "success",
      provenance: {
        ownerUserId: DEFAULT_OWNER_USER_ID,
        source: "feedback",
        recommendationKeys: [buildRecommendation().key]
      },
      outcomeLink: {
        goalId: bundle.goal.id,
        outcomeScore: 1,
        userCorrection: false
      }
    });
    expect(episodes[0].metadata?.learningPrivacy).toMatchObject({
      datasetId: "learning-capture-records",
      userId: DEFAULT_OWNER_USER_ID,
      workspaceId: bundle.goal.workspaceId ?? null,
      captureSource: "recommendation_feedback",
      captureAllowed: true,
      optOutApplied: false,
      exportable: true,
      deletable: true,
      redacted: true
    });
    expect(episodes[0].privacy.retention).toMatchObject({
      policy: "learning-feedback-90d",
      expiresAt: episodes[0].metadata?.learningPrivacy?.expiresAt
    });
    await expect(
      selfImprovementRepository.exportLearningEpisodes!({
        userId: DEFAULT_OWNER_USER_ID,
        workspaceId: bundle.goal.workspaceId ?? null
      })
    ).resolves.toEqual(expect.arrayContaining([expect.objectContaining({ id: episodes[0].id })]));
    await expect(
      selfImprovementRepository.deleteLearningEpisodes!({
        userId: DEFAULT_OWNER_USER_ID,
        workspaceId: bundle.goal.workspaceId ?? null
      })
    ).resolves.toMatchObject({
      deletedEpisodeCount: 1
    });
    expect(feedbackCountMetric).toMatchObject({
      kind: "counter",
      value: 1,
      attributes: expect.objectContaining({
        decision: "accepted",
        operatorOutcome: "accepted",
        replayMode: "approval_required"
      })
    });
    expect(feedbackScoreMetric).toMatchObject({
      kind: "histogram",
      value: 0.8,
      attributes: expect.objectContaining({
        decision: "accepted",
        operatorOutcome: "accepted"
      })
    });
  });

  it("redacts sensitive rationale and free-form notes before appending feedback learning", async () => {
    const repository = createRepository({
      storePath: process.env.AGENTIC_RUNTIME_STORE_PATH
    });
    await repository.seedDefaults(DEFAULT_OWNER_USER_ID);
    const bundle = await createGoalForUser(repository, DEFAULT_OWNER_USER_ID, "Prepare a reviewed outbound reply for a customer.");
    Reflect.set(globalThis, "__agenticRepository", repository);
    const recommendation = buildRecommendation();

    const response = await recommendationFeedbackRoute(
      buildAuthorizedJsonRequest(`http://localhost/api/goals/${bundle.goal.id}/recommendations/feedback`, {
        decision: "edited",
        recommendation: {
          ...recommendation,
          reuse: {
            ...recommendation.reuse,
            rationale:
              "Email alice@example.com after setting token=super-secret-value and Bearer abcdefghijklmnop."
          }
        },
        notes: "Customer bob@example.com requested password=hunter2 before reuse."
      }),
      {
        params: Promise.resolve({ id: bundle.goal.id })
      }
    );
    const episodes = await selfImprovementRepository.listEpisodes({ ownerUserId: DEFAULT_OWNER_USER_ID });
    const serializedEpisode = JSON.stringify(episodes[0]);

    expect(response.status).toBe(200);
    expect(episodes).toHaveLength(1);
    expect(episodes[0].recommendation?.rationale).toContain("[redacted-email]");
    expect(episodes[0].recommendation?.rationale).toContain("[redacted-secret]");
    expect(episodes[0].recommendation?.rationale).toContain("Bearer [redacted-token]");
    expect(episodes[0].outcomeLink?.notes).toContain("[redacted-email]");
    expect(episodes[0].outcomeLink?.notes).toContain("[redacted-secret]");
    expect(episodes[0].userFeedback?.comments).toBe(episodes[0].outcomeLink?.notes);
    expect(episodes[0].privacy.redaction).toMatchObject({
      applied: true,
      fields: expect.arrayContaining([
        "recommendation.rationale",
        "outcomeLink.notes",
        "userFeedback.comments"
      ])
    });
    expect(serializedEpisode).not.toContain("alice@example.com");
    expect(serializedEpisode).not.toContain("bob@example.com");
    expect(serializedEpisode).not.toContain("super-secret-value");
    expect(serializedEpisode).not.toContain("hunter2");
  });

  it("records feedback but skips feedback learning append when workspace learning capture is opted out", async () => {
    const repository = createRepository({
      storePath: process.env.AGENTIC_RUNTIME_STORE_PATH
    });
    await repository.seedDefaults(DEFAULT_OWNER_USER_ID);
    const dashboard = await repository.getDashboardData(DEFAULT_OWNER_USER_ID);
    const workspaceId = dashboard.activeWorkspace?.id;
    expect(workspaceId).toBeTruthy();
    const governance = await repository.getWorkspaceGovernance(workspaceId!, DEFAULT_OWNER_USER_ID);
    expect(governance).toBeTruthy();
    await repository.saveWorkspaceGovernance(
      {
        ...governance!,
        shadowReplayPolicy: {
          ...governance!.shadowReplayPolicy,
          enabled: false
        },
        updatedAt: "2026-04-20T00:00:00.000Z"
      },
      createSystemActorContext(DEFAULT_OWNER_USER_ID)
    );
    const bundle = await createGoalForUser(
      repository,
      DEFAULT_OWNER_USER_ID,
      "Prepare a reviewed outbound reply for a customer.",
      workspaceId!
    );
    Reflect.set(globalThis, "__agenticRepository", repository);

    const response = await recommendationFeedbackRoute(
      buildAuthorizedJsonRequest(`http://localhost/api/goals/${bundle.goal.id}/recommendations/feedback`, {
        decision: "accepted",
        recommendation: buildRecommendation()
      }),
      {
        params: Promise.resolve({ id: bundle.goal.id })
      }
    );
    const reloaded = await repository.getGoalBundle(bundle.goal.id);
    const episodes = await selfImprovementRepository.listEpisodes({ includeExpired: true });

    expect(response.status).toBe(200);
    expect(reloaded?.actionLogs.some((log) => log.kind === "goal.recommendation_feedback")).toBe(true);
    expect(episodes).toHaveLength(0);
  });

  it("returns 404 when the system principal tries to record feedback for another user's goal", async () => {
    const repository = createRepository({
      storePath: process.env.AGENTIC_RUNTIME_STORE_PATH
    });
    await repository.seedDefaults(DEFAULT_OWNER_USER_ID);
    const bundle = await createGoalForUser(repository, "another-user", "Prepare a reviewed outbound reply for a customer.");
    Reflect.set(globalThis, "__agenticRepository", repository);

    const response = await recommendationFeedbackRoute(
      buildAuthorizedJsonRequest(`http://localhost/api/goals/${bundle.goal.id}/recommendations/feedback`, {
        decision: "ignored",
        recommendation: buildRecommendation()
      }),
      {
        params: Promise.resolve({ id: bundle.goal.id })
      }
    );
    const payload = (await response.json()) as { error: string };
    const reloaded = await repository.getGoalBundle(bundle.goal.id);
    const episodes = await selfImprovementRepository.listEpisodes({ includeExpired: true });

    expect(response.status).toBe(404);
    expect(payload.error).toContain(`Goal ${bundle.goal.id} was not found.`);
    expect(reloaded?.actionLogs.some((log) => log.kind === "goal.recommendation_feedback")).toBe(false);
    expect(episodes).toHaveLength(0);
  });

  it("rejects invalid bodies and unknown fields", async () => {
    const repository = createRepository({
      storePath: process.env.AGENTIC_RUNTIME_STORE_PATH
    });
    await repository.seedDefaults(DEFAULT_OWNER_USER_ID);
    const bundle = await createGoalForUser(repository, DEFAULT_OWNER_USER_ID, "Prepare a reviewed outbound reply for a customer.");
    Reflect.set(globalThis, "__agenticRepository", repository);

    const response = await recommendationFeedbackRoute(
      buildAuthorizedJsonRequest(`http://localhost/api/goals/${bundle.goal.id}/recommendations/feedback`, {
        decision: "accepted",
        recommendation: buildRecommendation(),
        extra: "forbidden"
      }),
      {
        params: Promise.resolve({ id: bundle.goal.id })
      }
    );
    const payload = (await response.json()) as { error: string };
    const episodes = await selfImprovementRepository.listEpisodes({ includeExpired: true });

    expect(response.status).toBe(400);
    expect(payload.error).toContain('Unrecognized key: "extra"');
    expect(episodes).toHaveLength(0);
  });

  it("labels edited feedback as overridden in telemetry so drift dashboards can track operator corrections", async () => {
    const repository = createRepository({
      storePath: process.env.AGENTIC_RUNTIME_STORE_PATH
    });
    await repository.seedDefaults(DEFAULT_OWNER_USER_ID);
    const bundle = await createGoalForUser(repository, DEFAULT_OWNER_USER_ID, "Prepare a reviewed outbound reply for a customer.");
    Reflect.set(globalThis, "__agenticRepository", repository);

    const response = await recommendationFeedbackRoute(
      buildAuthorizedJsonRequest(`http://localhost/api/goals/${bundle.goal.id}/recommendations/feedback`, {
        decision: "edited",
        recommendation: buildRecommendation(),
        notes: "Adjusted the recommendation before reuse."
      }),
      {
        params: Promise.resolve({ id: bundle.goal.id })
      }
    );
    const episodes = await selfImprovementRepository.listEpisodes({ ownerUserId: DEFAULT_OWNER_USER_ID });
    const snapshot = getTelemetrySnapshot();
    const feedbackCountMetric = snapshot.metrics.find(
      (entry) =>
        entry.name === "product.learning.recommendation.feedback.total" &&
        entry.attributes.decision === "edited"
    );

    expect(response.status).toBe(200);
    expect(episodes[0]).toMatchObject({
      outcome: "failure",
      outcomeLink: expect.objectContaining({
        userCorrection: true,
        outcomeScore: -0.4
      }),
      userFeedback: expect.objectContaining({
        rating: 4,
        comments: "Adjusted the recommendation before reuse."
      })
    });
    expect(feedbackCountMetric).toMatchObject({
      kind: "counter",
      value: 1,
      attributes: expect.objectContaining({
        decision: "edited",
        operatorOutcome: "overridden",
        action: "send_message"
      })
    });
  });

  it("records explicit suppress and expire controls for learned recommendations", async () => {
    const repository = createRepository({
      storePath: process.env.AGENTIC_RUNTIME_STORE_PATH
    });
    await repository.seedDefaults(DEFAULT_OWNER_USER_ID);
    const bundle = await createGoalForUser(repository, DEFAULT_OWNER_USER_ID, "Prepare a reviewed outbound reply for a customer.");
    Reflect.set(globalThis, "__agenticRepository", repository);

    for (const decision of ["suppressed", "expired"] as const) {
      const response = await recommendationFeedbackRoute(
        buildAuthorizedJsonRequest(`http://localhost/api/goals/${bundle.goal.id}/recommendations/feedback`, {
          decision,
          recommendation: buildRecommendation(),
          notes: `Operator marked recommendation as ${decision}.`
        }),
        {
          params: Promise.resolve({ id: bundle.goal.id })
        }
      );

      expect(response.status).toBe(200);
    }

    const episodes = await selfImprovementRepository.listEpisodes({ ownerUserId: DEFAULT_OWNER_USER_ID });
    const suppressedEpisode = episodes.find((episode) => episode.metadata?.decision === "suppressed");
    const expiredEpisode = episodes.find((episode) => episode.metadata?.decision === "expired");
    const snapshot = getTelemetrySnapshot();
    const suppressedMetric = snapshot.metrics.find(
      (entry) =>
        entry.name === "product.learning.recommendation.feedback.total" &&
        entry.attributes.decision === "suppressed"
    );
    const expiredMetric = snapshot.metrics.find(
      (entry) =>
        entry.name === "product.learning.recommendation.feedback.total" &&
        entry.attributes.decision === "expired"
    );

    expect(episodes).toHaveLength(2);
    expect(suppressedEpisode?.outcome).toBe("failure");
    expect(suppressedEpisode?.outcomeLink).toMatchObject({
      userCorrection: true,
      outcomeScore: -1
    });
    expect(suppressedEpisode?.metadata?.recommendationControl).toMatchObject({
      action: "suppress",
      recommendationKey: buildRecommendation().key,
      reasonProvided: true
    });
    expect(expiredEpisode?.outcome).toBe("failure");
    expect(expiredEpisode?.outcomeLink).toMatchObject({
      userCorrection: true,
      outcomeScore: -1
    });
    expect(expiredEpisode?.metadata?.recommendationControl).toMatchObject({
      action: "expire",
      recommendationKey: buildRecommendation().key,
      reasonProvided: true
    });
    expect(suppressedMetric).toMatchObject({
      attributes: expect.objectContaining({
        operatorOutcome: "suppressed"
      })
    });
    expect(expiredMetric).toMatchObject({
      attributes: expect.objectContaining({
        operatorOutcome: "expired"
      })
    });
  });
});
