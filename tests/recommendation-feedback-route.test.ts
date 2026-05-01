import { mkdtemp } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { SYSTEM_USER_ID } from "@agentic/contracts";
import { getTelemetrySnapshot, resetTelemetrySnapshot } from "@agentic/observability";
import { createRepository } from "@agentic/repository";
import { processUserRequest } from "@agentic/orchestrator";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { POST as recommendationFeedbackRoute } from "../apps/web/app/api/goals/[id]/recommendations/feedback/route";
import { buildAuthorizedJsonRequest, expectNoStoreHeaders } from "./route-test-helpers";

async function createGoalForUser(
  repository: ReturnType<typeof createRepository>,
  userId: string,
  request: string
) {
  const bundle = await processUserRequest({
    userId,
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

  beforeEach(async () => {
    resetTelemetrySnapshot();
    process.env.AGENTIC_ACCESS_KEY = "test-access-key";
    process.env.AGENTIC_RUNTIME_STORE_PATH = path.join(
      await mkdtemp(path.join(os.tmpdir(), "agentic-recommendation-feedback-")),
      "runtime-store.json"
    );
    Reflect.set(globalThis, "__agenticRepository", undefined);
  });

  afterEach(() => {
    process.env.AGENTIC_ACCESS_KEY = originalAccessKey;
    process.env.AGENTIC_RUNTIME_STORE_PATH = originalRuntimeStorePath;
    Reflect.set(globalThis, "__agenticRepository", undefined);
    resetTelemetrySnapshot();
  });

  it("persists recommendation feedback as a goal-scoped action log and returns the dashboard snapshot", async () => {
    const repository = createRepository({
      storePath: process.env.AGENTIC_RUNTIME_STORE_PATH
    });
    await repository.seedDefaults(SYSTEM_USER_ID);
    const bundle = await createGoalForUser(repository, SYSTEM_USER_ID, "Prepare a reviewed outbound reply for a customer.");
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

  it("returns 404 when the system principal tries to record feedback for another user's goal", async () => {
    const repository = createRepository({
      storePath: process.env.AGENTIC_RUNTIME_STORE_PATH
    });
    await repository.seedDefaults(SYSTEM_USER_ID);
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

    expect(response.status).toBe(404);
    expect(payload.error).toContain(`Goal ${bundle.goal.id} was not found.`);
    expect(reloaded?.actionLogs.some((log) => log.kind === "goal.recommendation_feedback")).toBe(false);
  });

  it("rejects invalid bodies and unknown fields", async () => {
    const repository = createRepository({
      storePath: process.env.AGENTIC_RUNTIME_STORE_PATH
    });
    await repository.seedDefaults(SYSTEM_USER_ID);
    const bundle = await createGoalForUser(repository, SYSTEM_USER_ID, "Prepare a reviewed outbound reply for a customer.");
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

    expect(response.status).toBe(400);
    expect(payload.error).toContain('Unrecognized key: "extra"');
  });

  it("labels edited feedback as overridden in telemetry so drift dashboards can track operator corrections", async () => {
    const repository = createRepository({
      storePath: process.env.AGENTIC_RUNTIME_STORE_PATH
    });
    await repository.seedDefaults(SYSTEM_USER_ID);
    const bundle = await createGoalForUser(repository, SYSTEM_USER_ID, "Prepare a reviewed outbound reply for a customer.");
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
    const snapshot = getTelemetrySnapshot();
    const feedbackCountMetric = snapshot.metrics.find(
      (entry) =>
        entry.name === "product.learning.recommendation.feedback.total" &&
        entry.attributes.decision === "edited"
    );

    expect(response.status).toBe(200);
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
});
