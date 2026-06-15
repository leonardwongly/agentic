import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { DEFAULT_OWNER_USER_ID, WorkspaceGovernanceSchema } from "@agentic/contracts";
import { createSelfImprovementRepository, EpisodeRecordSchema } from "@agentic/self-improvement-memory";
import { GET as recommendationsRoute } from "../apps/web/app/api/memory/recommendations/route";
import { expectNoStoreHeaders, buildAuthorizedGetRequest } from "./route-test-helpers";

function buildReplayEpisode(
  id: string,
  overrides: Partial<ReturnType<typeof EpisodeRecordSchema.parse>> = {}
) {
  return EpisodeRecordSchema.parse({
    id,
    timestamp: "2026-04-20T06:00:00.000Z",
    skill: "self-improvement",
    task: "Materialize reusable workflow recommendations",
    outcome: "success",
    situation: "A reusable communications workflow completed successfully.",
    rootCause: null,
    solution: "Link the observed outcome trace into a reusable recommendation surface.",
    lesson: "Only suggest reuse once governed outcomes show stable success.",
    relatedPatternId: null,
    userFeedback: null,
    provenance: {
      ownerUserId: DEFAULT_OWNER_USER_ID,
      workspaceId: "workspace-1",
      source: "execution",
      memoryIds: [`memory-${id}`],
      actionLogIds: [`action-${id}`],
      evidenceRecordIds: [`evidence-${id}`],
      recommendationKeys: ["execution_path:communications:send_message:R3:send"]
    },
    privacy: {
      sensitivity: "R3",
      retention: {
        policy: "learning-outcome-365d",
        reviewAt: "2026-07-20T06:00:00.000Z",
        expiresAt: "2027-04-20T06:00:00.000Z"
      },
      redaction: {
        applied: false,
        fields: [],
        rules: [],
        reason: null
      }
    },
    metadata: {
      source: "unit-test"
    },
    recommendation: {
      key: "execution_path:communications:send_message:R3:send",
      kind: "execution_path",
      agent: "communications",
      action: "send_message",
      confidence: 0.92,
      rationale: "Observed governed outbound communications flow.",
      riskClass: "R3",
      capabilities: ["send"],
      sourceGoalId: `goal-${id}`,
      sourceTaskId: `task-${id}`,
      fallbackMode: "normal",
      evidenceHint: "established"
    },
    outcomeLink: {
      goalId: `goal-${id}`,
      workflowId: `workflow-${id}`,
      taskId: `task-${id}`,
      goalStatus: "completed",
      taskState: "completed",
      approvalDecision: "approved",
      executionKind: "completed",
      outcomeScore: 1,
      userCorrection: false,
      notes: "Validated outbound send."
    },
    ...overrides
  });
}

describe("workflow recommendations route", () => {
  const originalAccessKey = process.env.AGENTIC_ACCESS_KEY;
  const tempDirs: string[] = [];

  beforeEach(() => {
    process.env.AGENTIC_ACCESS_KEY = "test-access-key";
    Reflect.set(globalThis, "__agenticRepository", undefined);
    Reflect.set(globalThis, "__agenticSelfImprovementRepository", undefined);
  });

  afterEach(async () => {
    process.env.AGENTIC_ACCESS_KEY = originalAccessKey;
    Reflect.set(globalThis, "__agenticRepository", undefined);
    Reflect.set(globalThis, "__agenticSelfImprovementRepository", undefined);
    await Promise.all(tempDirs.map((tempDir) => rm(tempDir, { recursive: true, force: true })));
    tempDirs.length = 0;
  });

  it("returns sanitized reusable workflow recommendations from persisted outcome traces", async () => {
    const tempDir = await mkdtemp(path.join(os.tmpdir(), "agentic-recommendations-route-"));
    tempDirs.push(tempDir);
    const repository = createSelfImprovementRepository({
      baseDir: path.join(tempDir, ".agentic", "self-improvement")
    });

    await repository.seed();
    await repository.appendEpisode(buildReplayEpisode("rec-1"));
    await repository.appendEpisode(
      buildReplayEpisode("rec-2", {
        timestamp: "2026-04-21T07:00:00.000Z"
      })
    );
    Reflect.set(globalThis, "__agenticSelfImprovementRepository", repository);

    const response = await recommendationsRoute(
      buildAuthorizedGetRequest(
        "http://localhost/api/memory/recommendations?agent=communications&capability=send&minimumEvidence=2&limit=5"
      )
    );
    const payload = (await response.json()) as {
      recommendations: Array<{
        key: string;
        source: string;
        workflow: { agent: string; action: string; capabilities: string[] };
        reuse: { replayMode: string; operatorAction: string; rationale: string };
        evidence: { count: number; successCount: number; score: number };
        provenance: { episodeIds: string[]; graphRootIds: string[] };
      }>;
      summary: {
        totalEpisodes: number;
        matchedEpisodes: number;
        consideredEpisodes: number;
        safeSuggestionPrecision: number;
        currentSafeRecallProxy: number;
        currentNegativeOutcomeRate: number;
        currentFailureCostRate: number;
        driftStatus: string;
        returnedCount: number;
      };
      analytics: {
        current: {
          episodeCount: number;
          safeSuggestionPrecision: number;
          safeRecallProxy: number;
        };
        timeline: Array<{ key: string }>;
      };
      filters: {
        agent: string;
        capabilities: string[];
        minimumEvidence: number;
        limit: number;
      };
    };

    expect(response.status).toBe(200);
    expectNoStoreHeaders(response);
    expect(payload.summary.totalEpisodes).toBe(2);
    expect(payload.summary.matchedEpisodes).toBe(2);
    expect(payload.summary.consideredEpisodes).toBe(2);
    expect(payload.summary.safeSuggestionPrecision).toBe(1);
    expect(payload.summary.currentSafeRecallProxy).toBe(1);
    expect(payload.summary.currentNegativeOutcomeRate).toBe(0);
    expect(payload.summary.currentFailureCostRate).toBe(0);
    expect(payload.summary.driftStatus).toBe("insufficient_data");
    expect(payload.summary.returnedCount).toBe(1);
    expect(payload.analytics.current).toMatchObject({
      episodeCount: 2,
      safeSuggestionPrecision: 1,
      safeRecallProxy: 1
    });
    expect(payload.analytics.timeline.length).toBeGreaterThan(0);
    expect(payload.filters).toEqual(
      expect.objectContaining({
        agent: "communications",
        capabilities: ["send"],
        minimumEvidence: 2,
        limit: 5
      })
    );
    expect(payload.recommendations).toEqual([
      expect.objectContaining({
        key: "execution_path:communications:send_message:R3:send",
        source: "outcome_trace",
        workflow: expect.objectContaining({
          agent: "communications",
          action: "send_message",
          capabilities: ["send"]
        }),
        reuse: expect.objectContaining({
          replayMode: "suggest",
          operatorAction: "suggest_reuse"
        }),
        evidence: expect.objectContaining({
          count: 2,
          successCount: 2
        }),
        provenance: expect.objectContaining({
          episodeIds: expect.arrayContaining(["rec-1", "rec-2"]),
          graphRootIds: expect.arrayContaining(["goal:goal-rec-1", "memory:memory-rec-1"])
        })
      })
    ]);
    expect(JSON.stringify(payload)).not.toContain("sourceGoalId");
    expect(JSON.stringify(payload)).not.toContain("sourceTaskId");
  });

  it("requires authentication at the route boundary", async () => {
    const response = await recommendationsRoute(new Request("http://localhost/api/memory/recommendations", { method: "GET" }));
    const payload = (await response.json()) as { error?: string };

    expect(response.status).toBe(401);
    expectNoStoreHeaders(response);
    expect(payload.error).toMatch(/access key|session/i);
  });

  it("excludes expired and cross-owner learning traces from recommendations", async () => {
    const tempDir = await mkdtemp(path.join(os.tmpdir(), "agentic-recommendations-route-scope-"));
    tempDirs.push(tempDir);
    const repository = createSelfImprovementRepository({
      baseDir: path.join(tempDir, ".agentic", "self-improvement")
    });

    await repository.seed();
    await repository.appendEpisode(buildReplayEpisode("visible-1"));
    await repository.appendEpisode(
      buildReplayEpisode("foreign-1", {
        provenance: {
          ownerUserId: "other-user",
          workspaceId: "workspace-2",
          source: "execution",
          memoryIds: [],
          actionLogIds: [],
          evidenceRecordIds: [],
          recommendationKeys: ["execution_path:communications:send_message:R3:send"]
        }
      })
    );
    await repository.appendEpisode(
      buildReplayEpisode("expired-1", {
        privacy: {
          sensitivity: "R3",
          retention: {
            policy: "learning-outcome-365d",
            reviewAt: "2026-01-01T00:00:00.000Z",
            expiresAt: "2026-01-02T00:00:00.000Z"
          },
          redaction: {
            applied: false,
            fields: [],
            rules: [],
            reason: null
          }
        }
      })
    );
    Reflect.set(globalThis, "__agenticSelfImprovementRepository", repository);

    const response = await recommendationsRoute(
      buildAuthorizedGetRequest("http://localhost/api/memory/recommendations?includeDraftOnly=true&minimumScore=0&minimumEvidence=1")
    );
    const payload = (await response.json()) as {
      summary: { totalEpisodes: number; matchedEpisodes: number };
      recommendations: Array<{ evidence: { count: number } }>;
    };

    expect(response.status).toBe(200);
    expect(payload.summary.totalEpisodes).toBe(1);
    expect(payload.summary.matchedEpisodes).toBe(1);
    expect(payload.recommendations[0]?.evidence.count).toBe(1);
  });

  it("rejects invalid query parameters instead of widening the recommendation surface", async () => {
    const response = await recommendationsRoute(
      buildAuthorizedGetRequest("http://localhost/api/memory/recommendations?minimumScore=2&limit=0")
    );
    const payload = (await response.json()) as { error?: string };

    expect(response.status).toBe(400);
    expectNoStoreHeaders(response);
    expect(payload.error).toMatch(/too big|too small/i);
  });

  it("keeps draft-only traces hidden unless explicitly requested", async () => {
    const tempDir = await mkdtemp(path.join(os.tmpdir(), "agentic-recommendations-route-draft-"));
    tempDirs.push(tempDir);
    const repository = createSelfImprovementRepository({
      baseDir: path.join(tempDir, ".agentic", "self-improvement")
    });

    await repository.seed();
    await repository.appendEpisode(
      buildReplayEpisode("draft-1", {
        recommendation: {
          key: "task_plan:workflow:create_record:R2:create",
          kind: "task_plan",
          agent: "workflow",
          action: "create_record",
          confidence: 0.41,
          rationale: "Observed early drafting path.",
          riskClass: "R2",
          capabilities: ["create"],
          sourceGoalId: "goal-draft-1",
          sourceTaskId: "task-draft-1",
          fallbackMode: "review_required",
          evidenceHint: "sparse"
        },
        outcomeLink: {
          goalId: "goal-draft-1",
          workflowId: "workflow-draft-1",
          taskId: "task-draft-1",
          goalStatus: "active",
          taskState: "in_progress",
          approvalDecision: null,
          executionKind: "not_run",
          outcomeScore: 0.1,
          userCorrection: false,
          notes: "Insufficient evidence for autonomous reuse."
        },
        outcome: "partial"
      })
    );
    Reflect.set(globalThis, "__agenticSelfImprovementRepository", repository);

    const hiddenResponse = await recommendationsRoute(buildAuthorizedGetRequest("http://localhost/api/memory/recommendations"));
    const hiddenPayload = (await hiddenResponse.json()) as { recommendations: unknown[] };
    const visibleResponse = await recommendationsRoute(
      buildAuthorizedGetRequest("http://localhost/api/memory/recommendations?includeDraftOnly=true&minimumScore=0")
    );
    const visiblePayload = (await visibleResponse.json()) as { recommendations: Array<{ reuse: { replayMode: string } }> };

    expect(hiddenResponse.status).toBe(200);
    expect(hiddenPayload.recommendations).toEqual([]);
    expect(visibleResponse.status).toBe(200);
    expect(visiblePayload.recommendations).toEqual([
      expect.objectContaining({
        reuse: expect.objectContaining({
          replayMode: "draft_only"
        })
      })
    ]);
  });

  it("returns a replay comparison report for policy promotion when goal context is provided", async () => {
    const tempDir = await mkdtemp(path.join(os.tmpdir(), "agentic-recommendations-route-policy-"));
    tempDirs.push(tempDir);
    const repository = createSelfImprovementRepository({
      baseDir: path.join(tempDir, ".agentic", "self-improvement")
    });

    await repository.seed();
    await repository.appendEpisode(buildReplayEpisode("policy-1"));
    await repository.appendEpisode(
      buildReplayEpisode("policy-2", {
        timestamp: "2026-04-21T07:00:00.000Z"
      })
    );
    await repository.appendEpisode(
      buildReplayEpisode("policy-3", {
        timestamp: "2026-04-22T07:00:00.000Z"
      })
    );
    Reflect.set(globalThis, "__agenticSelfImprovementRepository", repository);
    Reflect.set(globalThis, "__agenticRepository", {
      seedDefaults: async () => undefined,
      getDashboardData: async () => ({
        activeWorkspace: {
          id: "workspace-1",
          userId: "user-1",
          name: "Primary workspace",
          description: "",
          createdAt: "2026-04-20T00:00:00.000Z",
          updatedAt: "2026-04-20T00:00:00.000Z"
        },
        workspaceGovernance: WorkspaceGovernanceSchema.parse({
          workspaceId: "workspace-1",
          approvalMode: "risk_based",
          requireAuditExports: false,
          maxAutoRunRiskClass: "R1",
          externalSendRequiresApproval: true,
          calendarWriteRequiresApproval: true,
          shadowReplayPolicy: {
            enabled: true,
            promotionMode: "validated_autonomy",
            rollbackOutcome: "allowed_with_confirmation",
            minimumMatchedEpisodes: 3,
            minimumPrecision: 0.8,
            maximumNegativeOutcomeRate: 0.15,
            maximumFailureCostRate: 0.2
          },
          retentionDays: 365,
          updatedBy: "user-1",
          createdAt: "2026-04-20T00:00:00.000Z",
          updatedAt: "2026-04-20T00:00:00.000Z"
        })
      }),
      getWorkspaceGovernance: async () => null
    });

    const response = await recommendationsRoute(
      buildAuthorizedGetRequest(
        "http://localhost/api/memory/recommendations?agent=communications&capability=send&minimumEvidence=3&goalTitle=Ship%20a%20reviewed%20response&goalConfidence=0.91"
      )
    );
    const payload = (await response.json()) as {
      policyPromotion: {
        workspaceId: string;
        safeRecallProxy: number;
        learningValidation: {
          replayValidated: boolean;
          matchedEpisodes: number;
        };
        shadowReplayReadiness: {
          status: string;
          thresholdSummary: string[];
        };
        comparison: {
          changed: boolean;
          summary: string;
        };
      } | null;
    };

    expect(response.status).toBe(200);
    expect(payload.policyPromotion).toMatchObject({
      workspaceId: "workspace-1",
      safeRecallProxy: 1,
      learningValidation: {
        replayValidated: true,
        matchedEpisodes: 3
      },
      shadowReplayReadiness: {
        status: "ready"
      }
    });
    expect(payload.policyPromotion?.shadowReplayReadiness.thresholdSummary.length).toBeGreaterThan(0);
    expect(payload.policyPromotion?.comparison.summary).toMatch(/learning/i);
  });

  it("surfaces a guarded per-workflow promotion recommendation from accumulated outcomes", async () => {
    const tempDir = await mkdtemp(path.join(os.tmpdir(), "agentic-recommendations-route-trust-"));
    tempDirs.push(tempDir);
    const repository = createSelfImprovementRepository({
      baseDir: path.join(tempDir, ".agentic", "self-improvement")
    });

    await repository.seed();
    // Six governed, low-risk (R2) outcomes for one workflow clear every guardrail.
    for (let index = 1; index <= 6; index += 1) {
      await repository.appendEpisode(
        buildReplayEpisode(`trust-${index}`, {
          timestamp: `2026-04-${String(20 + index).padStart(2, "0")}T07:00:00.000Z`,
          recommendation: {
            key: "execution_path:communications:send_message:R2:send",
            kind: "execution_path",
            agent: "communications",
            action: "send_message",
            confidence: 0.9,
            rationale: "Observed governed outbound communications flow.",
            riskClass: "R2",
            capabilities: ["send"],
            sourceGoalId: `goal-trust-${index}`,
            sourceTaskId: `task-trust-${index}`,
            fallbackMode: "normal",
            evidenceHint: "established"
          },
          outcomeLink: {
            goalId: `goal-trust-${index}`,
            workflowId: "workflow-promote",
            taskId: `task-trust-${index}`,
            goalStatus: "completed",
            taskState: "completed",
            approvalDecision: "approved",
            executionKind: "completed",
            outcomeScore: 1,
            userCorrection: false,
            notes: "Validated outbound send."
          }
        })
      );
    }
    Reflect.set(globalThis, "__agenticSelfImprovementRepository", repository);

    const response = await recommendationsRoute(
      buildAuthorizedGetRequest("http://localhost/api/memory/recommendations?minimumEvidence=1&minimumScore=0")
    );
    const payload = (await response.json()) as {
      workflowTrust: Array<{
        workflowId: string;
        trust: { trustScore: number; stageCoverage: number };
        promotion: { recommendation: string; guardrailsTripped: string[]; reasons: string[] };
      }>;
      summary: { promotionCandidates: number };
    };

    expect(response.status).toBe(200);
    expectNoStoreHeaders(response);

    const promoteEntry = payload.workflowTrust.find((entry) => entry.workflowId === "workflow-promote");
    expect(promoteEntry).toBeDefined();
    expect(promoteEntry?.trust.trustScore).toBe(1);
    expect(promoteEntry?.promotion.recommendation).toBe("promote");
    expect(promoteEntry?.promotion.guardrailsTripped).toEqual([]);
    expect(payload.summary.promotionCandidates).toBeGreaterThanOrEqual(1);
    // The promotion surface must not leak source provenance identifiers.
    expect(JSON.stringify(payload)).not.toContain("sourceGoalId");
    expect(JSON.stringify(payload)).not.toContain("sourceTaskId");
  });
});
