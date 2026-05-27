import { mkdtemp } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { ProviderCredentialSchema, DEFAULT_OWNER_USER_ID, createSystemActorContext } from "@agentic/contracts";
import { createMemoryRecord } from "@agentic/memory";
import { getTelemetrySnapshot, resetTelemetrySnapshot } from "@agentic/observability";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  buildDashboardIntelligenceReport,
  getDashboardKpiDictionary
} from "../apps/web/lib/dashboard-intelligence";
import { GET as dashboardRecommendationsRoute } from "../apps/web/app/api/dashboard/recommendations/route";
import { POST as dashboardRecommendationFeedbackRoute } from "../apps/web/app/api/dashboard/recommendations/feedback/route";
import {
  buildAuthorizedGetRequest,
  buildAuthorizedJsonRequest,
  createRouteTestRepository,
  expectNoStoreHeaders
} from "./route-test-helpers";

describe("dashboard intelligence", () => {
  const originalAccessKey = process.env.AGENTIC_ACCESS_KEY;
  const originalRuntimeStorePath = process.env.AGENTIC_RUNTIME_STORE_PATH;

  beforeEach(async () => {
    resetTelemetrySnapshot();
    process.env.AGENTIC_ACCESS_KEY = "test-access-key";
    process.env.AGENTIC_RUNTIME_STORE_PATH = path.join(
      await mkdtemp(path.join(os.tmpdir(), "agentic-dashboard-intelligence-")),
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

  it("publishes a governed KPI dictionary with formulas, owners, thresholds, and source fields", () => {
    const dictionary = getDashboardKpiDictionary();

    expect(dictionary.map((definition) => definition.id)).toEqual([
      "approval_debt",
      "high_risk_approval_ratio",
      "connector_readiness",
      "recovery_debt",
      "memory_freshness_debt",
      "post_approval_failure_count"
    ]);
    expect(dictionary.every((definition) => definition.formula.length > 0)).toBe(true);
    expect(dictionary.every((definition) => definition.sourceFields.length > 0)).toBe(true);
    expect(dictionary.every((definition) => definition.thresholds.healthy.length > 0)).toBe(true);
    expect(dictionary.find((definition) => definition.id === "memory_freshness_debt")?.sourceFields).toContain(
      "memories.expiryAt"
    );
  });

  it("keeps automation advisory when stale memory or connector degradation blocks promotion", async () => {
    const repository = createRouteTestRepository();
    const actor = createSystemActorContext(DEFAULT_OWNER_USER_ID);
    await repository.seedDefaults(DEFAULT_OWNER_USER_ID);
    await repository.saveMemory(
      createMemoryRecord({
        id: "confirmed-stale-memory",
        userId: DEFAULT_OWNER_USER_ID,
        category: "operating-context",
        memoryType: "confirmed",
        content: "Use this connector for customer follow-up.",
        confidence: 0.94,
        source: "test-suite",
        createdAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-01T00:00:00.000Z",
        expiryAt: "2026-01-15T00:00:00.000Z"
      })
    );
    await repository.saveProviderCredential(
      ProviderCredentialSchema.parse({
        id: "google:global:dashboard-intelligence",
        userId: DEFAULT_OWNER_USER_ID,
        workspaceId: null,
        provider: "google",
        accountId: "dashboard-intelligence",
        accountEmail: "intel@example.com",
        displayName: "Dashboard Intelligence",
        status: "refresh_failed",
        scopes: ["https://www.googleapis.com/auth/gmail.modify"],
        lastValidatedAt: "2026-05-01T00:00:00.000Z",
        lastRefreshFailureAt: "2026-05-02T00:00:00.000Z",
        metadata: {},
        actorContext: actor,
        createdAt: "2026-05-01T00:00:00.000Z",
        updatedAt: "2026-05-02T00:00:00.000Z"
      })
    );

    const report = buildDashboardIntelligenceReport(
      await repository.getDashboardData(DEFAULT_OWNER_USER_ID),
      Date.parse("2026-05-06T00:00:00.000Z")
    );

    expect(report.advisory).toBe(true);
    expect(report.kpis.find((kpi) => kpi.id === "connector_readiness")?.status).toBe("critical");
    expect(report.kpis.find((kpi) => kpi.id === "memory_freshness_debt")?.status).toBe("critical");
    expect(report.recommendations.map((recommendation) => recommendation.category)).toEqual(
      expect.arrayContaining(["repair_connector", "review_stale_memory", "keep_manual"])
    );
    expect(report.recommendations.every((recommendation) => recommendation.advisory)).toBe(true);
    expect(report.recommendations.find((recommendation) => recommendation.category === "keep_manual")?.blockers).toEqual(
      expect.arrayContaining(["Connector degradation can turn safe plans into failed side effects."])
    );
  });

  it("returns authenticated recommendation reports and records operator feedback telemetry", async () => {
    const repository = createRouteTestRepository();
    await repository.seedDefaults(DEFAULT_OWNER_USER_ID);
    Reflect.set(globalThis, "__agenticRepository", repository);

    const reportResponse = await dashboardRecommendationsRoute(
      buildAuthorizedGetRequest("http://localhost/api/dashboard/recommendations")
    );
    const reportPayload = (await reportResponse.json()) as {
      intelligence: {
        advisory: boolean;
        kpis: Array<{ id: string }>;
        recommendations: Array<{ id: string; advisory: boolean }>;
      };
    };

    expect(reportResponse.status).toBe(200);
    expectNoStoreHeaders(reportResponse);
    expect(reportPayload.intelligence.advisory).toBe(true);
    expect(reportPayload.intelligence.kpis.some((kpi) => kpi.id === "approval_debt")).toBe(true);
    expect(reportPayload.intelligence.recommendations.every((recommendation) => recommendation.advisory)).toBe(true);

    const feedbackResponse = await dashboardRecommendationFeedbackRoute(
      buildAuthorizedJsonRequest("http://localhost/api/dashboard/recommendations/feedback", {
        recommendationId: reportPayload.intelligence.recommendations[0]!.id,
        decision: "accepted",
        notes: "Operator agrees with the advisory action."
      })
    );
    const feedbackPayload = (await feedbackResponse.json()) as {
      feedback: { recommendationId: string; decision: string };
    };
    const telemetry = getTelemetrySnapshot();

    expect(feedbackResponse.status).toBe(200);
    expectNoStoreHeaders(feedbackResponse);
    expect(feedbackPayload.feedback.decision).toBe("accepted");
    expect(
      telemetry.metrics.some(
        (metric) =>
          metric.name === "product.dashboard.recommendation.feedback.total" &&
          metric.attributes.decision === "accepted"
      )
    ).toBe(true);
  });

  it("rejects unauthenticated recommendation report access", async () => {
    const response = await dashboardRecommendationsRoute(new Request("http://localhost/api/dashboard/recommendations"));
    const payload = (await response.json()) as { error: string };

    expect(response.status).toBe(401);
    expect(payload.error).toBe("Unauthorized. Create a session before calling the Agentic API.");
  });
});
