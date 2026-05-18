import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  assertEpisodeLearningPrivacyPreflight,
  buildPolicyLearningValidation,
  buildRecommendationPerformanceReport,
  buildRecommendationReplayReport,
  createSelfImprovementRepository,
  deriveRecommendationInsights,
  deriveWorkflowRecommendations,
  EpisodeRecordSchema,
  getEpisodeLearningPrivacy,
  SemanticPatternSchema,
  SelfImprovementConflictError,
  SelfImprovementIntegrityError,
  SelfImprovementValidationError
} from "@agentic/self-improvement-memory";

async function createTempRepository() {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "agentic-self-improvement-"));
  const baseDir = path.join(tempDir, ".agentic", "self-improvement");

  return {
    tempDir,
    baseDir,
    repository: createSelfImprovementRepository({
      baseDir
    })
  };
}

function buildEpisode(overrides: Partial<ReturnType<typeof EpisodeRecordSchema.parse>> = {}) {
  return EpisodeRecordSchema.parse({
    id: "ep-2026-04-02-001",
    timestamp: "2026-04-02T09:00:00.000Z",
    skill: "debugger",
    task: "Repair callback refresh flow",
    outcome: "success",
    situation: "The UI stopped refreshing after a user action.",
    rootCause: "An empty callback was passed into the refresh boundary.",
    solution: "Replace the empty callback with the real refresh handler and test the trigger path.",
    lesson: "Do not assume callback props are wired; confirm they execute meaningful state changes.",
    relatedPatternId: null,
    userFeedback: {
      rating: 8,
      comments: "This isolated the exact issue."
    },
    metadata: {
      source: "unit-test",
      flags: ["callback", "refresh"]
    },
    ...overrides
  });
}

function buildLearningPrivacy(overrides: Record<string, unknown> = {}) {
  return {
    datasetId: "learning-capture-records",
    userId: "user-1",
    workspaceId: "workspace-1",
    captureSource: "goal_bundle",
    captureAllowed: true,
    optOutApplied: false,
    consentBasis: "explicit",
    retentionDays: 30,
    capturedAt: "2026-04-02T09:00:00.000Z",
    expiresAt: "2026-05-02T09:00:00.000Z",
    exportable: true,
    deletable: true,
    redacted: true,
    ...overrides
  };
}

function buildSemanticPattern(overrides: Partial<ReturnType<typeof SemanticPatternSchema.parse>> = {}) {
  return SemanticPatternSchema.parse({
    id: "pattern-callback-verification",
    name: "Callback verification",
    source: "retrospective",
    confidence: 0.9,
    applications: 2,
    createdAt: "2026-04-02T09:00:00.000Z",
    updatedAt: "2026-04-02T09:00:00.000Z",
    category: "debugging",
    pattern: "Verify callback props execute real state transitions.",
    problem: "Placeholder callbacks can make a flow appear wired while no refresh work actually runs.",
    solution: {
      checklist: ["trace callback assignment", "assert side effect happens"]
    },
    qualityRules: ["Inspect callback bodies before blaming state propagation."],
    targetSkills: ["debugger"],
    relatedEpisodeIds: ["ep-2026-04-02-001"],
    ...overrides
  });
}

describe("self improvement memory repository", () => {
  const tempDirs: string[] = [];

  afterEach(async () => {
    await Promise.all(tempDirs.map((tempDir) => rm(tempDir, { recursive: true, force: true })));
    tempDirs.length = 0;
  });

  it("seeds the expected directory tree idempotently", async () => {
    const context = await createTempRepository();
    tempDirs.push(context.tempDir);

    await context.repository.seed();
    await context.repository.seed();

    await expect(readFile(path.join(context.baseDir, "semantic-patterns.json"), "utf8")).resolves.toContain(`"version": 1`);
    await expect(readFile(path.join(context.baseDir, "working", "current-session.json"), "utf8")).resolves.toContain(
      `"value": null`
    );
    await expect(readFile(path.join(context.baseDir, "working", "last-error.json"), "utf8")).resolves.toContain(
      `"value": null`
    );
    await expect(readFile(path.join(context.baseDir, "working", "session-end.json"), "utf8")).resolves.toContain(
      `"value": null`
    );

    const episodicEntries = await readdir(path.join(context.baseDir, "episodic"));
    expect(episodicEntries).toEqual([]);
  });

  it("persists, reloads, filters, and limits episode records", async () => {
    const context = await createTempRepository();
    tempDirs.push(context.tempDir);

    const firstEpisode = buildEpisode({
      id: "ep-2026-04-02-001",
      timestamp: "2026-04-02T09:00:00.000Z",
      outcome: "success"
    });
    const secondEpisode = buildEpisode({
      id: "ep-2026-04-02-002",
      timestamp: "2026-04-02T11:00:00.000Z",
      skill: "code-reviewer",
      task: "Review ../../weird path !!!",
      outcome: "partial"
    });

    await context.repository.appendEpisode(firstEpisode);
    await context.repository.appendEpisode(secondEpisode);

    await expect(context.repository.getEpisode(firstEpisode.id)).resolves.toEqual(firstEpisode);
    await expect(
      context.repository.listEpisodes({
        skill: "code-reviewer",
        outcome: "partial",
        limit: 10
      })
    ).resolves.toEqual([secondEpisode]);

    const limited = await context.repository.listEpisodes({ limit: 1 });
    expect(limited).toEqual([secondEpisode]);

    const yearEntries = await readdir(path.join(context.baseDir, "episodic", "2026"));
    expect(yearEntries).toEqual([
      "2026-04-02-code-reviewer-review-weird-path.json",
      "2026-04-02-debugger-repair-callback-refresh-flow.json"
    ]);
  });

  it("enforces owner and retention filters for learning episodes", async () => {
    const context = await createTempRepository();
    tempDirs.push(context.tempDir);

    const ownedEpisode = buildEpisode({
      id: "owned-episode",
      timestamp: "2026-04-02T09:00:00.000Z",
      provenance: {
        ownerUserId: "user-1",
        workspaceId: "workspace-1",
        source: "execution",
        memoryIds: ["memory-1"],
        actionLogIds: ["action-1"],
        evidenceRecordIds: [],
        recommendationKeys: ["execution_path:debugger:repair:R1:write"]
      },
      privacy: {
        sensitivity: "internal",
        retention: {
          policy: "learning-outcome-365d",
          reviewAt: "2026-07-01T00:00:00.000Z",
          expiresAt: "2027-04-02T00:00:00.000Z"
        },
        redaction: {
          applied: true,
          fields: ["execution.detail"],
          rules: ["email"],
          reason: "Boundary redaction applied before learning capture."
        }
      }
    });
    const foreignEpisode = buildEpisode({
      id: "foreign-episode",
      provenance: {
        ownerUserId: "user-2",
        workspaceId: "workspace-2",
        source: "execution",
        memoryIds: [],
        actionLogIds: [],
        evidenceRecordIds: [],
        recommendationKeys: []
      }
    });
    const expiredEpisode = buildEpisode({
      id: "expired-episode",
      timestamp: "2026-04-01T09:00:00.000Z",
      provenance: {
        ownerUserId: "user-1",
        workspaceId: "workspace-1",
        source: "execution",
        memoryIds: [],
        actionLogIds: [],
        evidenceRecordIds: [],
        recommendationKeys: []
      },
      privacy: {
        sensitivity: "internal",
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
    });

    await context.repository.appendEpisode(ownedEpisode);
    await context.repository.appendEpisode(foreignEpisode);
    await context.repository.appendEpisode(expiredEpisode);

    await expect(
      context.repository.listEpisodes({
        ownerUserId: "user-1",
        workspaceId: "workspace-1",
        now: "2026-04-03T00:00:00.000Z"
      })
    ).resolves.toEqual([ownedEpisode]);
    await expect(
      context.repository.listEpisodes({
        ownerUserId: "user-1",
        workspaceId: "workspace-1",
        includeExpired: true,
        now: "2026-04-03T00:00:00.000Z"
      })
    ).resolves.toEqual([ownedEpisode, expiredEpisode]);
  });

  it("trims trailing separators after truncating long episodic slugs", async () => {
    const context = await createTempRepository();
    tempDirs.push(context.tempDir);

    await context.repository.appendEpisode(
      buildEpisode({
        id: "ep-2026-04-02-003",
        task: "Capture learnings from the security remediation pass"
      })
    );

    const yearEntries = await readdir(path.join(context.baseDir, "episodic", "2026"));
    expect(yearEntries).toContain("2026-04-02-debugger-capture-learnings-from-the-security-rem.json");
    expect(yearEntries.some((entry) => entry.endsWith("-.json"))).toBe(false);
  });

  it("preserves createdAt while allowing semantic pattern updates", async () => {
    const context = await createTempRepository();
    tempDirs.push(context.tempDir);

    const original = buildSemanticPattern();
    const updated = buildSemanticPattern({
      confidence: 0.97,
      applications: 3,
      createdAt: "2030-01-01T00:00:00.000Z",
      updatedAt: "2026-04-02T12:30:00.000Z"
    });

    await context.repository.upsertSemanticPattern(original);
    const persisted = await context.repository.upsertSemanticPattern(updated);
    const reloaded = await context.repository.getSemanticPattern(original.id);

    expect(persisted.createdAt).toBe(original.createdAt);
    expect(persisted.updatedAt).toBe(updated.updatedAt);
    expect(reloaded).toEqual(persisted);
  });

  it("writes and clears working memory snapshots", async () => {
    const context = await createTempRepository();
    tempDirs.push(context.tempDir);

    await context.repository.writeCurrentSession({
      sessionId: "session-1",
      skill: "debugger",
      startedAt: "2026-04-02T08:00:00.000Z",
      context: "Investigating a failing callback chain.",
      activeTask: "Confirm the broken refresh trigger.",
      status: "running"
    });
    await context.repository.writeLastError({
      capturedAt: "2026-04-02T08:05:00.000Z",
      skill: "debugger",
      tool: "npm test",
      message: "Expected refresh to fire once.",
      exitCode: 1,
      inputSummary: "callback refresh test",
      outputSummary: "Assertion failed in refresh boundary spec"
    });
    await context.repository.writeSessionEnd({
      sessionId: "session-1",
      endedAt: "2026-04-02T08:45:00.000Z",
      status: "completed",
      summary: "Captured the callback defect and the repair pattern."
    });

    const written = await context.repository.readWorkingMemory();
    expect(written.currentSession?.sessionId).toBe("session-1");
    expect(written.lastError?.tool).toBe("npm test");
    expect(written.sessionEnd?.status).toBe("completed");

    await context.repository.clearWorkingMemory();

    await expect(context.repository.readWorkingMemory()).resolves.toEqual({
      currentSession: null,
      lastError: null,
      sessionEnd: null
    });
  });

  it("rejects duplicate episode ids", async () => {
    const context = await createTempRepository();
    tempDirs.push(context.tempDir);

    const episode = buildEpisode();
    await context.repository.appendEpisode(episode);

    await expect(context.repository.appendEpisode(episode)).rejects.toBeInstanceOf(SelfImprovementConflictError);
  });

  it("rejects invalid payloads and invalid list filters", async () => {
    const context = await createTempRepository();
    tempDirs.push(context.tempDir);

    await expect(
      context.repository.appendEpisode({
        ...buildEpisode(),
        metadata: {
          a: {
            b: {
              c: {
                d: {
                  e: "too deep"
                }
              }
            }
          }
        }
      })
    ).rejects.toBeInstanceOf(SelfImprovementValidationError);

    await expect(context.repository.listEpisodes({ year: "../2026" })).rejects.toBeInstanceOf(
      SelfImprovementValidationError
    );
  });

  it("validates learning privacy preflight metadata for auto-captured episodes", () => {
    const episode = buildEpisode({
      metadata: {
        source: "unit-test",
        learningPrivacy: buildLearningPrivacy()
      }
    });

    expect(getEpisodeLearningPrivacy(episode)).toMatchObject({
      datasetId: "learning-capture-records",
      userId: "user-1",
      workspaceId: "workspace-1",
      captureAllowed: true,
      exportable: true,
      deletable: true,
      redacted: true
    });
    expect(() =>
      assertEpisodeLearningPrivacyPreflight(episode, {
        userId: "user-1",
        workspaceId: "workspace-1"
      })
    ).not.toThrow();
    expect(() =>
      assertEpisodeLearningPrivacyPreflight(episode, {
        userId: "user-2",
        workspaceId: "workspace-1"
      })
    ).toThrow(SelfImprovementValidationError);
    expect(() => assertEpisodeLearningPrivacyPreflight(buildEpisode())).toThrow(SelfImprovementValidationError);
  });

  it("exports and deletes only scoped learning episodes for privacy lifecycle operations", async () => {
    const context = await createTempRepository();
    tempDirs.push(context.tempDir);

    const scopedEpisode = buildEpisode({
      id: "ep-learning-scoped",
      metadata: {
        learningPrivacy: buildLearningPrivacy()
      }
    });
    const otherWorkspaceEpisode = buildEpisode({
      id: "ep-learning-other-workspace",
      task: "Other workspace task",
      metadata: {
        learningPrivacy: buildLearningPrivacy({ workspaceId: "workspace-2" })
      }
    });
    const expiredEpisode = buildEpisode({
      id: "ep-learning-expired",
      task: "Expired workspace task",
      metadata: {
        learningPrivacy: buildLearningPrivacy({ expiresAt: "2026-04-01T00:00:00.000Z" })
      }
    });

    await context.repository.appendEpisode(scopedEpisode);
    await context.repository.appendEpisode(otherWorkspaceEpisode);
    await context.repository.appendEpisode(expiredEpisode);

    const exported = await context.repository.exportLearningEpisodes!({
      userId: "user-1",
      workspaceId: "workspace-1"
    });
    expect(exported.map((episode) => episode.id).sort()).toEqual(["ep-learning-expired", "ep-learning-scoped"]);

    await expect(
      context.repository.enforceLearningRetention!({
        userId: "user-1",
        workspaceId: "workspace-1",
        now: "2026-04-03T00:00:00.000Z"
      })
    ).resolves.toMatchObject({
      deletedEpisodeCount: 1
    });

    await expect(context.repository.getEpisode("ep-learning-expired", "2026")).resolves.toBeNull();
    await expect(context.repository.getEpisode("ep-learning-scoped", "2026")).resolves.toMatchObject({
      id: "ep-learning-scoped"
    });
    await expect(context.repository.getEpisode("ep-learning-other-workspace", "2026")).resolves.toMatchObject({
      id: "ep-learning-other-workspace"
    });

    await expect(
      context.repository.deleteLearningEpisodes!({
        userId: "user-1",
        workspaceId: "workspace-1"
      })
    ).resolves.toMatchObject({
      deletedEpisodeCount: 1
    });
    await expect(context.repository.getEpisode("ep-learning-scoped", "2026")).resolves.toBeNull();
    await expect(context.repository.getEpisode("ep-learning-other-workspace", "2026")).resolves.toMatchObject({
      id: "ep-learning-other-workspace"
    });
  });

  it("fails closed when persisted files are corrupt", async () => {
    const context = await createTempRepository();
    tempDirs.push(context.tempDir);

    await context.repository.seed();
    await writeFile(path.join(context.baseDir, "semantic-patterns.json"), "{not-json", "utf8");

    await expect(context.repository.readSemanticPatterns()).rejects.toBeInstanceOf(SelfImprovementIntegrityError);
  });

  it("keeps semantic storage readable under concurrent upserts", async () => {
    const context = await createTempRepository();
    tempDirs.push(context.tempDir);

    await Promise.all(
      Array.from({ length: 8 }, (_, index) =>
        context.repository.upsertSemanticPattern(
          buildSemanticPattern({
            id: `pattern-${index}`,
            name: `Pattern ${index}`,
            updatedAt: `2026-04-02T12:0${index}:00.000Z`
          })
        )
      )
    );

    const raw = await readFile(path.join(context.baseDir, "semantic-patterns.json"), "utf8");
    const parsed = JSON.parse(raw) as { version: number; patterns: Record<string, unknown> };

    expect(parsed.version).toBe(1);
    expect(Object.keys(parsed.patterns).length).toBeGreaterThanOrEqual(1);
    await expect(context.repository.readSemanticPatterns()).resolves.toMatchObject({
      version: 1
    });
  });
});

describe("recommendation replay analytics", () => {
  function buildReplayEpisode(
    id: string,
    overrides: Partial<ReturnType<typeof EpisodeRecordSchema.parse>> = {}
  ) {
    return buildEpisode({
      id,
      recommendation: {
        key: "execution_path:communications:send_message:R3:send",
        kind: "execution_path",
        agent: "communications",
        action: "send_message",
        confidence: 0.9,
        rationale: "Observed governed outbound send flow.",
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

  it("downgrades replay mode when negative outcomes and corrections accumulate", () => {
    const insights = deriveRecommendationInsights([
      buildReplayEpisode("safe-1"),
      buildReplayEpisode("safe-2"),
      buildReplayEpisode("unsafe-1", {
        outcome: "failure",
        recommendation: {
          key: "execution_path:communications:send_message:R3:send",
          kind: "execution_path",
          agent: "communications",
          action: "send_message",
          confidence: 0.62,
          rationale: "Observed governed outbound send flow.",
          riskClass: "R3",
          capabilities: ["send"],
          sourceGoalId: "goal-unsafe-1",
          sourceTaskId: "task-unsafe-1",
          fallbackMode: "review_required",
          evidenceHint: "sparse"
        },
        outcomeLink: {
          goalId: "goal-unsafe-1",
          workflowId: "workflow-unsafe-1",
          taskId: "task-unsafe-1",
          goalStatus: "blocked",
          taskState: "failed",
          approvalDecision: "rejected",
          executionKind: "failed",
          outcomeScore: -1,
          userCorrection: true,
          notes: "User corrected the send target after failure."
        }
      })
    ]);

    expect(insights).toHaveLength(1);
    expect(insights[0]).toMatchObject({
      evidenceCount: 3,
      failureCount: 1,
      rejectionCount: 1,
      userCorrectionCount: 1,
      replayMode: "review_required"
    });
    expect(insights[0]?.rationale).toContain("keep human review");
  });

  it("builds a replay report with safe suggestion precision from proven patterns", () => {
    const report = buildRecommendationReplayReport([
      buildReplayEpisode("suggest-1"),
      buildReplayEpisode("suggest-2"),
      buildReplayEpisode("suggest-3"),
      buildReplayEpisode("guarded-1", {
        recommendation: {
          key: "task_plan:workflow:create_record:R2:create,update",
          kind: "task_plan",
          agent: "workflow",
          action: "create_record",
          confidence: 0.75,
          rationale: "Observed internal drafting flow.",
          riskClass: "R2",
          capabilities: ["create", "update"],
          sourceGoalId: "goal-guarded-1",
          sourceTaskId: "task-guarded-1",
          fallbackMode: "normal",
          evidenceHint: "sparse"
        },
        outcomeLink: {
          goalId: "goal-guarded-1",
          workflowId: "workflow-guarded-1",
          taskId: "task-guarded-1",
          goalStatus: "active",
          taskState: "in_progress",
          approvalDecision: null,
          executionKind: "not_run",
          outcomeScore: 0.2,
          userCorrection: false,
          notes: "Draft-only path."
        },
        outcome: "partial"
      }),
      buildReplayEpisode("guarded-2", {
        recommendation: {
          key: "task_plan:workflow:create_record:R2:create,update",
          kind: "task_plan",
          agent: "workflow",
          action: "create_record",
          confidence: 0.76,
          rationale: "Observed internal drafting flow.",
          riskClass: "R2",
          capabilities: ["create", "update"],
          sourceGoalId: "goal-guarded-2",
          sourceTaskId: "task-guarded-2",
          fallbackMode: "normal",
          evidenceHint: "sparse"
        },
        outcomeLink: {
          goalId: "goal-guarded-2",
          workflowId: "workflow-guarded-2",
          taskId: "task-guarded-2",
          goalStatus: "completed",
          taskState: "completed",
          approvalDecision: null,
          executionKind: "completed",
          outcomeScore: 1,
          userCorrection: false,
          notes: "Completed after review."
        }
      }),
      buildReplayEpisode("guarded-3", {
        recommendation: {
          key: "task_plan:workflow:create_record:R2:create,update",
          kind: "task_plan",
          agent: "workflow",
          action: "create_record",
          confidence: 0.74,
          rationale: "Observed internal drafting flow.",
          riskClass: "R2",
          capabilities: ["create", "update"],
          sourceGoalId: "goal-guarded-3",
          sourceTaskId: "task-guarded-3",
          fallbackMode: "normal",
          evidenceHint: "sparse"
        },
        outcomeLink: {
          goalId: "goal-guarded-3",
          workflowId: "workflow-guarded-3",
          taskId: "task-guarded-3",
          goalStatus: "completed",
          taskState: "completed",
          approvalDecision: null,
          executionKind: "completed",
          outcomeScore: 1,
          userCorrection: false,
          notes: "Completed after review."
        }
      })
    ]);

    expect(report.consideredEpisodes).toBe(6);
    expect(report.suggestedPatterns).toBe(1);
    expect(report.guardedPatterns).toBe(1);
    expect(report.safeSuggestionPrecision).toBe(1);
    expect(report.safeRecallProxy).toBe(1);
    expect(report.cases).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          key: "execution_path:communications:send_message:R3:send",
          predictedMode: "suggest",
          observedRisk: "safe"
        }),
        expect.objectContaining({
          key: "task_plan:workflow:create_record:R2:create,update",
          predictedMode: "approval_required"
        })
      ])
    );
  });

  it("tracks a safe recall proxy for reusable patterns that stay guarded", () => {
    const report = buildRecommendationReplayReport([
      buildReplayEpisode("suggest-recall-1"),
      buildReplayEpisode("suggest-recall-2"),
      buildReplayEpisode("suggest-recall-3"),
      buildReplayEpisode("guarded-safe-1", {
        recommendation: {
          key: "execution_path:calendar:schedule_event:R2:schedule",
          kind: "execution_path",
          agent: "calendar",
          action: "schedule_event",
          confidence: 0.86,
          rationale: "Observed reviewed scheduling flow.",
          riskClass: "R2",
          capabilities: ["schedule"],
          sourceGoalId: "goal-guarded-safe-1",
          sourceTaskId: "task-guarded-safe-1",
          fallbackMode: "normal",
          evidenceHint: "sparse"
        },
        outcomeLink: {
          goalId: "goal-guarded-safe-1",
          workflowId: "workflow-guarded-safe-1",
          taskId: "task-guarded-safe-1",
          goalStatus: "completed",
          taskState: "completed",
          approvalDecision: "approved",
          executionKind: "completed",
          outcomeScore: 1,
          userCorrection: false,
          notes: "Safe but still sparse."
        }
      }),
      buildReplayEpisode("guarded-safe-2", {
        recommendation: {
          key: "execution_path:calendar:schedule_event:R2:schedule",
          kind: "execution_path",
          agent: "calendar",
          action: "schedule_event",
          confidence: 0.85,
          rationale: "Observed reviewed scheduling flow.",
          riskClass: "R2",
          capabilities: ["schedule"],
          sourceGoalId: "goal-guarded-safe-2",
          sourceTaskId: "task-guarded-safe-2",
          fallbackMode: "normal",
          evidenceHint: "sparse"
        },
        outcomeLink: {
          goalId: "goal-guarded-safe-2",
          workflowId: "workflow-guarded-safe-2",
          taskId: "task-guarded-safe-2",
          goalStatus: "completed",
          taskState: "completed",
          approvalDecision: "approved",
          executionKind: "completed",
          outcomeScore: 1,
          userCorrection: false,
          notes: "Safe but below the evidence bar."
        }
      })
    ]);

    expect(report.safeSuggestionPrecision).toBe(1);
    expect(report.safeRecallProxy).toBe(0.5);
    expect(report.cases).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          key: "execution_path:calendar:schedule_event:R2:schedule",
          predictedMode: "draft_only",
          observedRisk: "safe"
        })
      ])
    );
  });

  it("tracks recommendation drift and failure cost across replay windows", () => {
    const report = buildRecommendationPerformanceReport([
      buildReplayEpisode("stable-1", {
        timestamp: "2026-04-01T09:00:00.000Z"
      }),
      buildReplayEpisode("stable-2", {
        timestamp: "2026-04-02T09:00:00.000Z"
      }),
      buildReplayEpisode("stable-3", {
        timestamp: "2026-04-03T09:00:00.000Z"
      }),
      buildReplayEpisode("regress-1", {
        timestamp: "2026-04-10T09:00:00.000Z",
        outcome: "failure",
        recommendation: {
          key: "execution_path:communications:send_message:R3:send",
          kind: "execution_path",
          agent: "communications",
          action: "send_message",
          confidence: 0.58,
          rationale: "Observed governed outbound send flow.",
          riskClass: "R3",
          capabilities: ["send"],
          sourceGoalId: "goal-regress-1",
          sourceTaskId: "task-regress-1",
          fallbackMode: "review_required",
          evidenceHint: "sparse"
        },
        outcomeLink: {
          goalId: "goal-regress-1",
          workflowId: "workflow-regress-1",
          taskId: "task-regress-1",
          goalStatus: "blocked",
          taskState: "failed",
          approvalDecision: "rejected",
          executionKind: "failed",
          outcomeScore: -1,
          userCorrection: true,
          notes: "Recent outbound flow needed manual correction."
        }
      }),
      buildReplayEpisode("regress-2", {
        timestamp: "2026-04-11T09:00:00.000Z",
        outcome: "partial",
        recommendation: {
          key: "execution_path:communications:send_message:R3:send",
          kind: "execution_path",
          agent: "communications",
          action: "send_message",
          confidence: 0.61,
          rationale: "Observed governed outbound send flow.",
          riskClass: "R3",
          capabilities: ["send"],
          sourceGoalId: "goal-regress-2",
          sourceTaskId: "task-regress-2",
          fallbackMode: "review_required",
          evidenceHint: "sparse"
        },
        outcomeLink: {
          goalId: "goal-regress-2",
          workflowId: "workflow-regress-2",
          taskId: "task-regress-2",
          goalStatus: "running",
          taskState: "completed",
          approvalDecision: null,
          executionKind: "completed",
          outcomeScore: 0.2,
          userCorrection: true,
          notes: "Operator intervened before final delivery."
        }
      }),
      buildReplayEpisode("regress-3", {
        timestamp: "2026-04-12T09:00:00.000Z",
        outcome: "failure",
        recommendation: {
          key: "execution_path:communications:send_message:R3:send",
          kind: "execution_path",
          agent: "communications",
          action: "send_message",
          confidence: 0.55,
          rationale: "Observed governed outbound send flow.",
          riskClass: "R3",
          capabilities: ["send"],
          sourceGoalId: "goal-regress-3",
          sourceTaskId: "task-regress-3",
          fallbackMode: "review_required",
          evidenceHint: "sparse"
        },
        outcomeLink: {
          goalId: "goal-regress-3",
          workflowId: "workflow-regress-3",
          taskId: "task-regress-3",
          goalStatus: "blocked",
          taskState: "failed",
          approvalDecision: "rejected",
          executionKind: "failed",
          outcomeScore: -1,
          userCorrection: false,
          notes: "Recent replay evidence regressed."
        }
      })
    ], {
      bucketDays: 7,
      bucketCount: 2,
      minimumEvidence: 1,
      lowConfidenceThreshold: 0.7,
      automationThreshold: 0.8
    });

    expect(report.timeline).toHaveLength(2);
    expect(report.previous).toMatchObject({
      episodeCount: 3,
      safeSuggestionPrecision: 1,
      safeRecallProxy: 1,
      negativeOutcomeRate: 0,
      failureCostRate: 0
    });
    expect(report.current).toMatchObject({
      episodeCount: 3,
      safeSuggestionPrecision: 0,
      safeRecallProxy: 0,
      negativeOutcomeRate: 1
    });
    expect(report.current.failureCostRate).toBeGreaterThan(0.5);
    expect(report.drift).toMatchObject({
      status: "regressing",
      safeRecallProxyDelta: -1
    });
  });

  it("replay-validates only stable recommendation evidence before autonomy promotion", () => {
    const episodes = [
      buildReplayEpisode("valid-1", {
        timestamp: "2026-04-08T09:00:00.000Z"
      }),
      buildReplayEpisode("valid-2", {
        timestamp: "2026-04-10T09:00:00.000Z"
      }),
      buildReplayEpisode("valid-3", {
        timestamp: "2026-04-12T09:00:00.000Z"
      })
    ];

    const validation = buildPolicyLearningValidation(episodes, {
      kind: "execution_path",
      agent: "communications",
      riskClass: "R3",
      capabilities: ["send"],
      minimumEvidence: 3
    });

    expect(validation).toMatchObject({
      replayValidated: true,
      matchedEpisodes: 3,
      matchedPatterns: 1,
      suggestedPatterns: 1,
      driftStatus: "insufficient_data"
    });
    expect(validation.rationale).toContain("Replay validation passed");
  });

  it("fails replay validation when negative outcomes regress recent evidence", () => {
    const validation = buildPolicyLearningValidation([
      buildReplayEpisode("baseline-1", {
        timestamp: "2026-04-01T09:00:00.000Z"
      }),
      buildReplayEpisode("baseline-2", {
        timestamp: "2026-04-02T09:00:00.000Z"
      }),
      buildReplayEpisode("baseline-3", {
        timestamp: "2026-04-03T09:00:00.000Z"
      }),
      buildReplayEpisode("failure-1", {
        timestamp: "2026-04-10T09:00:00.000Z",
        outcome: "failure",
        recommendation: {
          key: "execution_path:communications:send_message:R3:send",
          kind: "execution_path",
          agent: "communications",
          action: "send_message",
          confidence: 0.6,
          rationale: "Observed governed outbound send flow.",
          riskClass: "R3",
          capabilities: ["send"],
          sourceGoalId: "goal-failure-1",
          sourceTaskId: "task-failure-1",
          fallbackMode: "review_required",
          evidenceHint: "sparse"
        },
        outcomeLink: {
          goalId: "goal-failure-1",
          workflowId: "workflow-failure-1",
          taskId: "task-failure-1",
          goalStatus: "blocked",
          taskState: "failed",
          approvalDecision: "rejected",
          executionKind: "failed",
          outcomeScore: -1,
          userCorrection: true,
          notes: "Recent send path regressed."
        }
      }),
      buildReplayEpisode("failure-2", {
        timestamp: "2026-04-11T09:00:00.000Z",
        outcome: "failure",
        recommendation: {
          key: "execution_path:communications:send_message:R3:send",
          kind: "execution_path",
          agent: "communications",
          action: "send_message",
          confidence: 0.59,
          rationale: "Observed governed outbound send flow.",
          riskClass: "R3",
          capabilities: ["send"],
          sourceGoalId: "goal-failure-2",
          sourceTaskId: "task-failure-2",
          fallbackMode: "review_required",
          evidenceHint: "sparse"
        },
        outcomeLink: {
          goalId: "goal-failure-2",
          workflowId: "workflow-failure-2",
          taskId: "task-failure-2",
          goalStatus: "blocked",
          taskState: "failed",
          approvalDecision: "rejected",
          executionKind: "failed",
          outcomeScore: -1,
          userCorrection: false,
          notes: "Recent send path regressed again."
        }
      }),
      buildReplayEpisode("failure-3", {
        timestamp: "2026-04-12T09:00:00.000Z",
        outcome: "partial",
        recommendation: {
          key: "execution_path:communications:send_message:R3:send",
          kind: "execution_path",
          agent: "communications",
          action: "send_message",
          confidence: 0.62,
          rationale: "Observed governed outbound send flow.",
          riskClass: "R3",
          capabilities: ["send"],
          sourceGoalId: "goal-failure-3",
          sourceTaskId: "task-failure-3",
          fallbackMode: "review_required",
          evidenceHint: "sparse"
        },
        outcomeLink: {
          goalId: "goal-failure-3",
          workflowId: "workflow-failure-3",
          taskId: "task-failure-3",
          goalStatus: "running",
          taskState: "completed",
          approvalDecision: null,
          executionKind: "completed",
          outcomeScore: 0.2,
          userCorrection: true,
          notes: "Recent send path needed correction."
        }
      })
    ], {
      kind: "execution_path",
      agent: "communications",
      riskClass: "R3",
      capabilities: ["send"],
      minimumEvidence: 3
    });

    expect(validation.replayValidated).toBe(false);
    expect(validation.driftStatus).toBe("regressing");
    expect(validation.negativeOutcomeRate).toBeGreaterThan(0.5);
    expect(validation.failureCostRate).toBeGreaterThan(0.3);
    expect(validation.rationale).toContain("Replay evidence is regressing");
  });
});

describe("workflow recommendations", () => {
  function buildWorkflowEpisode(
    id: string,
    overrides: Partial<ReturnType<typeof EpisodeRecordSchema.parse>> = {}
  ) {
    return buildEpisode({
      id,
      recommendation: {
        key: "execution_path:communications:send_message:R3:send",
        kind: "execution_path",
        agent: "communications",
        action: "send_message",
        confidence: 0.91,
        rationale: "Observed governed outbound send flow.",
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

  it("derives ranked reusable workflow recommendations with capability and agent filters", () => {
    const recommendations = deriveWorkflowRecommendations(
      [
        buildWorkflowEpisode("wf-1"),
        buildWorkflowEpisode("wf-2", {
          timestamp: "2026-04-20T09:05:00.000Z"
        }),
        buildWorkflowEpisode("wf-3", {
          recommendation: {
            key: "execution_path:calendar:schedule_event:R2:schedule",
            kind: "execution_path",
            agent: "calendar",
            action: "schedule_event",
            confidence: 0.86,
            rationale: "Observed calendar scheduling flow.",
            riskClass: "R2",
            capabilities: ["schedule"],
            sourceGoalId: "goal-wf-3",
            sourceTaskId: "task-wf-3",
            fallbackMode: "normal",
            evidenceHint: "established"
          }
        })
      ],
      {
        agent: "communications",
        capabilities: ["send"],
        minimumEvidence: 2
      }
    );

    expect(recommendations).toEqual([
      expect.objectContaining({
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
          approvalCount: 2
        })
      })
    ]);
  });

  it("honors explicit recommendation suppression controls", () => {
    const recommendationKey = "execution_path:communications:send_message:R3:send";
    const suppression = buildWorkflowEpisode("wf-suppress-control", {
      timestamp: "2026-04-20T10:00:00.000Z",
      outcome: "failure",
      outcomeLink: {
        goalId: "goal-wf-suppress-control",
        workflowId: "workflow-wf-suppress-control",
        taskId: "task-wf-suppress-control",
        goalStatus: "running",
        taskState: "blocked",
        approvalDecision: null,
        executionKind: "not_run",
        outcomeScore: -1,
        userCorrection: true,
        notes: "Operator suppressed stale learned guidance."
      },
      provenance: {
        ownerUserId: "user-1",
        workspaceId: "workspace-1",
        source: "feedback",
        memoryIds: [],
        actionLogIds: ["action-suppress"],
        evidenceRecordIds: [],
        recommendationKeys: [recommendationKey]
      },
      metadata: {
        recommendationControl: {
          action: "suppress",
          recommendationKey,
          appliedAt: "2026-04-20T10:00:00.000Z",
          reasonProvided: true
        }
      }
    });

    expect(
      deriveWorkflowRecommendations(
        [
          buildWorkflowEpisode("wf-suppress-1"),
          buildWorkflowEpisode("wf-suppress-2", { timestamp: "2026-04-20T09:05:00.000Z" }),
          suppression
        ],
        {
          includeDraftOnly: true,
          minimumEvidence: 1,
          minimumScore: 0
        }
      )
    ).toEqual([]);
  });

  it("expires old recommendation evidence while allowing fresh outcomes to rebuild guidance", () => {
    const recommendationKey = "execution_path:communications:send_message:R3:send";
    const expiry = buildWorkflowEpisode("wf-expire-control", {
      timestamp: "2026-04-20T10:00:00.000Z",
      outcome: "failure",
      outcomeLink: {
        goalId: "goal-wf-expire-control",
        workflowId: "workflow-wf-expire-control",
        taskId: "task-wf-expire-control",
        goalStatus: "running",
        taskState: "blocked",
        approvalDecision: null,
        executionKind: "not_run",
        outcomeScore: -1,
        userCorrection: true,
        notes: "Operator expired stale learned guidance."
      },
      provenance: {
        ownerUserId: "user-1",
        workspaceId: "workspace-1",
        source: "feedback",
        memoryIds: [],
        actionLogIds: ["action-expire"],
        evidenceRecordIds: [],
        recommendationKeys: [recommendationKey]
      },
      metadata: {
        recommendationControl: {
          action: "expire",
          recommendationKey,
          appliedAt: "2026-04-20T10:00:00.000Z",
          reasonProvided: true
        }
      }
    });
    const recommendations = deriveWorkflowRecommendations(
      [
        buildWorkflowEpisode("wf-expire-old-1", { timestamp: "2026-04-20T09:00:00.000Z" }),
        buildWorkflowEpisode("wf-expire-old-2", { timestamp: "2026-04-20T09:05:00.000Z" }),
        expiry,
        buildWorkflowEpisode("wf-expire-new-1", { timestamp: "2026-04-20T10:05:00.000Z" }),
        buildWorkflowEpisode("wf-expire-new-2", { timestamp: "2026-04-20T10:10:00.000Z" })
      ],
      {
        minimumEvidence: 2,
        minimumScore: 0
      }
    );

    expect(recommendations).toEqual([
      expect.objectContaining({
        evidence: expect.objectContaining({
          count: 2
        }),
        provenance: expect.objectContaining({
          episodeIds: expect.arrayContaining(["wf-expire-new-1", "wf-expire-new-2"])
        })
      })
    ]);
    expect(recommendations[0]?.provenance.episodeIds).not.toEqual(expect.arrayContaining(["wf-expire-old-1", "wf-expire-old-2"]));
  });

  it("excludes draft-only recommendations by default but includes them when requested", () => {
    const draftOnlyEpisode = buildWorkflowEpisode("wf-draft-1", {
      recommendation: {
        key: "task_plan:workflow:create_record:R2:create",
        kind: "task_plan",
        agent: "workflow",
        action: "create_record",
        confidence: 0.32,
        rationale: "Observed early drafting flow.",
        riskClass: "R2",
        capabilities: ["create"],
        sourceGoalId: "goal-wf-draft-1",
        sourceTaskId: "task-wf-draft-1",
        fallbackMode: "review_required",
        evidenceHint: "sparse"
      },
      outcomeLink: {
        goalId: "goal-wf-draft-1",
        workflowId: "workflow-wf-draft-1",
        taskId: "task-wf-draft-1",
        goalStatus: "active",
        taskState: "in_progress",
        approvalDecision: null,
        executionKind: "not_run",
        outcomeScore: 0,
        userCorrection: false,
        notes: "Draft-only evidence."
      },
      outcome: "partial"
    });

    expect(deriveWorkflowRecommendations([draftOnlyEpisode], { minimumScore: 0 })).toEqual([]);
    expect(
      deriveWorkflowRecommendations([draftOnlyEpisode], {
        includeDraftOnly: true,
        minimumScore: 0
      })
    ).toEqual([
      expect.objectContaining({
        reuse: expect.objectContaining({
          replayMode: "draft_only",
          operatorAction: "keep_draft_only"
        })
      })
    ]);
  });

  it("rejects invalid workflow recommendation filters", () => {
    expect(() =>
      deriveWorkflowRecommendations([], {
        capabilities: Array.from({ length: 11 }, (_, index) => `capability-${index}`)
      })
    ).toThrow(SelfImprovementValidationError);
  });
});
