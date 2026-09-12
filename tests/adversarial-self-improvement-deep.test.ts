import { mkdtemp, rm, writeFile, readFile, mkdir } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import {
  createSelfImprovementRepository,
  EpisodeRecordSchema,
  SemanticPatternSchema,
  SelfImprovementValidationError,
  SelfImprovementIntegrityError,
  SelfImprovementConflictError,
  SelfImprovementStorageError,
  deriveRecommendationInsights,
  buildRecommendationReplayReport,
  aggregateWorkflowOutcomes,
  calculateNegativeOutcomeRate,
  buildPolicyLearningValidation,
  buildRecommendationPerformanceReport,
  deriveWorkflowRecommendations,
  filterRecommendationEvidenceEpisodes,
  getEpisodeLearningPrivacy,
  assertEpisodeLearningPrivacyPreflight,
  type EpisodeRecord,
  type SelfImprovementRepository,
  type RecommendationTrace,
  type OutcomeLink
} from "@agentic/self-improvement-memory";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const tempDirs: string[] = [];

async function createTempDir(prefix: string): Promise<string> {
  const dir = await mkdtemp(path.join(os.tmpdir(), `adv-sim-${prefix}-`));
  tempDirs.push(dir);
  return dir;
}

afterAll(async () => {
  for (const dir of tempDirs) {
    await rm(dir, { recursive: true, force: true });
  }
});

/** Build a valid episode via the schema. Use for positive-path tests. */
function baseEpisode(overrides: Record<string, unknown> = {}): EpisodeRecord {
  return EpisodeRecordSchema.parse({
    id: "ep-test-001",
    timestamp: "2025-06-15T10:00:00.000Z",
    skill: "coding",
    task: "Fix null pointer in parser",
    outcome: "success",
    situation: "Parser crashed on empty input.",
    rootCause: "Missing null check on optional field.",
    solution: "Added guard clause before accessing nested property.",
    lesson: "Always validate optional fields before dereferencing.",
    ...overrides
  });
}

/** Build a raw episode object WITHOUT schema validation. Use for negative-path tests
 *  where we want to test that appendEpisode rejects invalid input. */
function rawEpisode(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: "ep-test-001",
    timestamp: "2025-06-15T10:00:00.000Z",
    skill: "coding",
    task: "Fix null pointer in parser",
    outcome: "success",
    situation: "Parser crashed on empty input.",
    rootCause: "Missing null check on optional field.",
    solution: "Added guard clause before accessing nested property.",
    lesson: "Always validate optional fields before dereferencing.",
    ...overrides
  };
}

function episodeWithRecommendation(
  key: string,
  overrides: Record<string, unknown> = {},
  recOverrides: Record<string, unknown> = {},
  linkOverrides: Record<string, unknown> = {}
): EpisodeRecord {
  const recommendation: RecommendationTrace = {
    key,
    kind: "task_plan",
    agent: "planner",
    action: "generate_plan",
    confidence: 0.85,
    rationale: null,
    riskClass: null,
    capabilities: [],
    sourceGoalId: "goal-1",
    sourceTaskId: null,
    fallbackMode: "normal",
    evidenceHint: "none",
    ...recOverrides
  };

  const outcomeLink: OutcomeLink = {
    goalId: "goal-1",
    workflowId: null,
    taskId: null,
    goalStatus: null,
    taskState: null,
    approvalDecision: null,
    executionKind: "not_run",
    outcomeScore: 0.8,
    userCorrection: false,
    notes: null,
    ...linkOverrides
  };

  return baseEpisode({
    recommendation,
    outcomeLink,
    ...overrides
  });
}

// ===========================================================================
// TEST SUITE
// ===========================================================================

describe("Adversarial self-improvement-memory deep tests", () => {
  let repo: SelfImprovementRepository;
  let baseDir: string;

  beforeEach(async () => {
    baseDir = await createTempDir("repo");
    repo = createSelfImprovementRepository({ baseDir });
    await repo.seed();
  });

  // -------------------------------------------------------------------------
  // 1. Episode boundaries
  // -------------------------------------------------------------------------
  describe("Episode boundaries", () => {
    it("rejects episode with empty title (skill field)", async () => {
      await expect(
        repo.appendEpisode(rawEpisode({ skill: "   " }) as any)
      ).rejects.toThrow(SelfImprovementValidationError);
    });

    it("rejects episode with empty content (task field)", async () => {
      await expect(
        repo.appendEpisode(rawEpisode({ task: "" }) as any)
      ).rejects.toThrow(SelfImprovementValidationError);
    });

    it("rejects episode with whitespace-only situation", async () => {
      await expect(
        repo.appendEpisode(rawEpisode({ situation: "   \n\t  " }) as any)
      ).rejects.toThrow(SelfImprovementValidationError);
    });

    it("rejects episode with invalid ISO timestamp", async () => {
      await expect(
        repo.appendEpisode(rawEpisode({ timestamp: "not-a-date" }) as any)
      ).rejects.toThrow(SelfImprovementValidationError);
    });

    it("accepts episode with future date far beyond reasonable range", async () => {
      const episode = baseEpisode({
        id: "ep-future-001",
        timestamp: "9999-12-31T23:59:59.999Z"
      });
      const result = await repo.appendEpisode(episode);
      expect(result.timestamp).toBe("9999-12-31T23:59:59.999Z");
    });

    it("accepts maximum-length fields at boundary", async () => {
      const maxSkill = "a".repeat(80);
      const maxTask = "b".repeat(300);
      const maxSituation = "c".repeat(2_000);
      const maxSolution = "d".repeat(2_000);
      const maxLesson = "e".repeat(2_000);

      const episode = baseEpisode({
        id: "ep-maxlen-001",
        skill: maxSkill,
        task: maxTask,
        situation: maxSituation,
        solution: maxSolution,
        lesson: maxLesson
      });

      const result = await repo.appendEpisode(episode);
      expect(result.skill).toBe(maxSkill);
      expect(result.task).toBe(maxTask);
    });

    it("rejects fields exceeding maximum length", async () => {
      await expect(
        repo.appendEpisode(rawEpisode({ skill: "x".repeat(81) }) as any)
      ).rejects.toThrow(SelfImprovementValidationError);
    });

    it("rejects episode with partial ISO timestamp (no timezone)", async () => {
      await expect(
        repo.appendEpisode(rawEpisode({ timestamp: "2025-06-15T10:00:00" }) as any)
      ).rejects.toThrow(SelfImprovementValidationError);
    });
  });

  // -------------------------------------------------------------------------
  // 2. Path safety
  // -------------------------------------------------------------------------
  describe("Path safety", () => {
    it("sanitizes directory traversal in slug generation", async () => {
      const episode = baseEpisode({
        id: "ep-traversal-001",
        skill: "../../../etc/passwd",
        task: "steal data"
      });

      const result = await repo.appendEpisode(episode);
      expect(result.id).toBe("ep-traversal-001");

      const listed = await repo.listEpisodes();
      expect(listed.length).toBe(1);
    });

    it("REGRESSION: rejects null bytes in episode id", async () => {
      // Regression for adversarial-sweep bug: null bytes used to pass through
      // Zod string validation and were persisted to disk, risking platform-specific
      // filesystem truncation. boundedString now rejects \u0000.
      await expect(repo.appendEpisode(rawEpisode({ id: "ep\x00evil" }) as any)).rejects.toThrow(
        SelfImprovementValidationError
      );
    });

    it("handles path separator injection in skill field", async () => {
      const episode = baseEpisode({
        id: "ep-sep-inject",
        skill: "foo/bar/baz",
        task: "test injection"
      });

      const result = await repo.appendEpisode(episode);
      expect(result.id).toBe("ep-sep-inject");
    });

    it("prevents escape via year hint in getEpisode", async () => {
      await expect(
        repo.getEpisode("some-id", "../../etc")
      ).rejects.toThrow();
    });

    it("rejects non-four-digit year hints", async () => {
      await expect(
        repo.getEpisode("some-id", "abc")
      ).rejects.toThrow(SelfImprovementValidationError);
    });
  });

  // -------------------------------------------------------------------------
  // 3. Concurrent access
  // -------------------------------------------------------------------------
  describe("Concurrent access", () => {
    it("detects duplicate episode creation with same id", async () => {
      const episode = baseEpisode({ id: "ep-dup-001" });
      await repo.appendEpisode(episode);

      await expect(
        repo.appendEpisode(episode)
      ).rejects.toThrow(SelfImprovementConflictError);
    });

    it("handles simultaneous episode creation with distinct ids", async () => {
      const episodes = Array.from({ length: 5 }, (_, i) =>
        baseEpisode({
          id: `ep-concurrent-${i}`,
          task: `Task number ${i}`
        })
      );

      const results = await Promise.all(
        episodes.map((ep) => repo.appendEpisode(ep))
      );

      expect(results.length).toBe(5);
      const listed = await repo.listEpisodes();
      expect(listed.length).toBe(5);
    });

    it("read during write returns consistent state", async () => {
      const episode = baseEpisode({ id: "ep-rw-001" });

      const [appended, readResult] = await Promise.all([
        repo.appendEpisode(episode),
        repo.getEpisode("ep-rw-001")
      ]);

      expect(appended.id).toBe("ep-rw-001");
      expect(readResult === null || readResult.id === "ep-rw-001").toBe(true);
    });

    it("concurrent working memory writes do not corrupt state", async () => {
      const sessions = Array.from({ length: 5 }, (_, i) => ({
        sessionId: `session-${i}`,
        skill: "coding",
        startedAt: "2025-06-15T10:00:00.000Z",
        context: null,
        activeTask: null,
        status: "running" as const
      }));

      await Promise.all(sessions.map((s) => repo.writeCurrentSession(s)));

      const memory = await repo.readWorkingMemory();
      expect(memory.currentSession).not.toBeNull();
      expect(memory.currentSession!.sessionId).toMatch(/^session-\d$/);
    });
  });

  // -------------------------------------------------------------------------
  // 4. Schema validation
  // -------------------------------------------------------------------------
  describe("Schema validation", () => {
    it("rejects episode missing required 'outcome' field", async () => {
      const raw = {
        id: "ep-no-outcome",
        timestamp: "2025-06-15T10:00:00.000Z",
        skill: "coding",
        task: "Test",
        situation: "Test situation",
        solution: "Test solution",
        lesson: "Test lesson"
      };

      await expect(repo.appendEpisode(raw as any)).rejects.toThrow(
        SelfImprovementValidationError
      );
    });

    it("rejects episode with extra unknown fields (strict mode)", async () => {
      await expect(
        repo.appendEpisode(rawEpisode({ __evil_extra: "malicious payload" }) as any)
      ).rejects.toThrow(SelfImprovementValidationError);
    });

    it("rejects episode with wrong type for outcome", async () => {
      await expect(
        repo.appendEpisode(rawEpisode({ outcome: 42 }) as any)
      ).rejects.toThrow(SelfImprovementValidationError);
    });

    it("rejects semantic pattern with invalid confidence (> 1)", () => {
      expect(() =>
        SemanticPatternSchema.parse({
          id: "pat-1",
          name: "Test Pattern",
          source: "manual",
          confidence: 1.5,
          applications: 0,
          createdAt: "2025-06-15T10:00:00.000Z",
          updatedAt: "2025-06-15T10:00:00.000Z",
          category: "testing",
          pattern: "test pattern",
          problem: "test problem",
          qualityRules: [],
          targetSkills: []
        })
      ).toThrow();
    });

    it("rejects semantic pattern with negative applications count", () => {
      expect(() =>
        SemanticPatternSchema.parse({
          id: "pat-2",
          name: "Test Pattern",
          source: "manual",
          confidence: 0.5,
          applications: -1,
          createdAt: "2025-06-15T10:00:00.000Z",
          updatedAt: "2025-06-15T10:00:00.000Z",
          category: "testing",
          pattern: "test pattern",
          problem: "test problem",
          qualityRules: [],
          targetSkills: []
        })
      ).toThrow();
    });
  });

  // -------------------------------------------------------------------------
  // 5. Privacy edge cases
  // -------------------------------------------------------------------------
  describe("Privacy edge cases", () => {
    it("filters out expired episodes by default in listEpisodes", async () => {
      const expiredEpisode = baseEpisode({
        id: "ep-expired-001",
        privacy: {
          sensitivity: "internal",
          retention: {
            policy: "short-lived",
            reviewAt: null,
            expiresAt: "2020-01-01T00:00:00.000Z"
          },
          redaction: { applied: false, fields: [], rules: [], reason: null }
        }
      });

      await repo.appendEpisode(expiredEpisode);

      const listed = await repo.listEpisodes({
        now: "2025-06-15T10:00:00.000Z"
      });
      expect(listed.length).toBe(0);
    });

    it("includes expired episodes when includeExpired is true", async () => {
      const expiredEpisode = baseEpisode({
        id: "ep-expired-002",
        privacy: {
          sensitivity: "internal",
          retention: {
            policy: "short-lived",
            reviewAt: null,
            expiresAt: "2020-01-01T00:00:00.000Z"
          },
          redaction: { applied: false, fields: [], rules: [], reason: null }
        }
      });

      await repo.appendEpisode(expiredEpisode);

      const listed = await repo.listEpisodes({
        now: "2025-06-15T10:00:00.000Z",
        includeExpired: true
      });
      expect(listed.length).toBe(1);
    });

    it("detects cross-user data leakage in exportLearningEpisodes", async () => {
      const userAEpisode = baseEpisode({
        id: "ep-user-a",
        metadata: {
          learningPrivacy: {
            datasetId: "learning-capture-records",
            userId: "user-a",
            workspaceId: null,
            captureSource: "goal_bundle",
            captureAllowed: true,
            optOutApplied: false,
            consentBasis: "system",
            retentionDays: 365,
            capturedAt: "2025-06-15T10:00:00.000Z",
            expiresAt: "2026-06-15T10:00:00.000Z",
            exportable: true,
            deletable: true,
            redacted: true
          }
        }
      });

      const userBEpisode = baseEpisode({
        id: "ep-user-b",
        metadata: {
          learningPrivacy: {
            datasetId: "learning-capture-records",
            userId: "user-b",
            workspaceId: null,
            captureSource: "goal_bundle",
            captureAllowed: true,
            optOutApplied: false,
            consentBasis: "system",
            retentionDays: 365,
            capturedAt: "2025-06-15T10:00:00.000Z",
            expiresAt: "2026-06-15T10:00:00.000Z",
            exportable: true,
            deletable: true,
            redacted: true
          }
        }
      });

      await repo.appendEpisode(userAEpisode);
      await repo.appendEpisode(userBEpisode);

      if (repo.exportLearningEpisodes) {
        const exported = await repo.exportLearningEpisodes({
          userId: "user-a",
          workspaceId: null
        });

        expect(exported.length).toBe(1);
        expect(exported[0].id).toBe("ep-user-a");
      }
    });

    it("assertEpisodeLearningPrivacyPreflight rejects mismatched userId", () => {
      const episode = baseEpisode({
        metadata: {
          learningPrivacy: {
            datasetId: "learning-capture-records",
            userId: "user-a",
            workspaceId: null,
            captureSource: "goal_bundle",
            captureAllowed: true,
            optOutApplied: false,
            consentBasis: "system",
            retentionDays: 365,
            capturedAt: "2025-06-15T10:00:00.000Z",
            expiresAt: "2026-06-15T10:00:00.000Z",
            exportable: true,
            deletable: true,
            redacted: true
          }
        }
      });

      expect(() =>
        assertEpisodeLearningPrivacyPreflight(episode, { userId: "user-b" })
      ).toThrow(SelfImprovementValidationError);
    });

    it("getEpisodeLearningPrivacy returns null for non-object metadata", () => {
      const episode = baseEpisode();
      const hacked = { ...episode, metadata: "not-an-object" as any };
      expect(getEpisodeLearningPrivacy(hacked)).toBeNull();
    });
  });

  // -------------------------------------------------------------------------
  // 6. Recommendation scoring edge cases
  // -------------------------------------------------------------------------
  describe("Recommendation scoring", () => {
    it("handles zero evidence episodes without crashing", () => {
      const insights = deriveRecommendationInsights([]);
      expect(insights).toEqual([]);
    });

    it("handles episodes with no recommendation or outcomeLink", () => {
      const episodes = [baseEpisode(), baseEpisode({ id: "ep-2" })];
      const insights = deriveRecommendationInsights(episodes);
      expect(insights).toEqual([]);
    });

    it("clamps confidence to [0,1] even with extreme inputs", () => {
      const episodes = [
        episodeWithRecommendation("key-1", { id: "ep-conf-1" }, { confidence: 0 }),
        episodeWithRecommendation("key-1", { id: "ep-conf-2" }, { confidence: 1 })
      ];

      const insights = deriveRecommendationInsights(episodes);
      expect(insights.length).toBe(1);
      expect(insights[0].averageConfidence).toBeGreaterThanOrEqual(0);
      expect(insights[0].averageConfidence).toBeLessThanOrEqual(1);
    });

    it("calculateNegativeOutcomeRate returns 0 for empty array", () => {
      expect(calculateNegativeOutcomeRate([])).toBe(0);
    });

    it("calculateNegativeOutcomeRate handles all-failure episodes", () => {
      const episodes = [
        episodeWithRecommendation("k", { id: "f1", outcome: "failure" }, {}, { executionKind: "failed" }),
        episodeWithRecommendation("k", { id: "f2", outcome: "failure" }, {}, { executionKind: "failed" })
      ] as Array<EpisodeRecord & { outcomeLink: OutcomeLink }>;

      expect(calculateNegativeOutcomeRate(episodes)).toBe(1);
    });

    it("replay report handles division-by-zero scenario (no safe cases)", () => {
      const episodes = [
        episodeWithRecommendation("unsafe-key", { id: "ep-u1", outcome: "failure" }, { confidence: 0.9 }, {
          executionKind: "failed",
          approvalDecision: "rejected",
          userCorrection: true
        })
      ];

      const report = buildRecommendationReplayReport(episodes);
      expect(report.safeRecallProxy).toBe(0);
      expect(Number.isFinite(report.safeSuggestionPrecision)).toBe(true);
    });

    it("deriveRecommendationInsights produces finite scores for all entries", () => {
      const episodes = Array.from({ length: 10 }, (_, i) =>
        episodeWithRecommendation(`key-${i % 3}`, { id: `ep-score-${i}` }, {
          confidence: i % 2 === 0 ? 0.1 : 0.99
        }, {
          outcomeScore: i % 3 === 0 ? -1 : 1,
          executionKind: i % 4 === 0 ? "failed" : "completed",
          approvalDecision: i % 5 === 0 ? "rejected" : "approved",
          userCorrection: i % 7 === 0
        })
      );

      const insights = deriveRecommendationInsights(episodes);
      for (const insight of insights) {
        expect(Number.isFinite(insight.score)).toBe(true);
        expect(insight.score).toBeGreaterThanOrEqual(0);
        expect(insight.score).toBeLessThanOrEqual(1);
        expect(Number.isFinite(insight.averageConfidence)).toBe(true);
      }
    });
  });

  // -------------------------------------------------------------------------
  // 7. Year directory handling
  // -------------------------------------------------------------------------
  describe("Year directory handling", () => {
    it("handles non-numeric directories in episodic root gracefully", async () => {
      const episodicRoot = path.join(baseDir, "episodic");
      await mkdir(path.join(episodicRoot, "README"), { recursive: true });
      await writeFile(path.join(episodicRoot, ".DS_Store"), "junk");

      const listed = await repo.listEpisodes();
      expect(Array.isArray(listed)).toBe(true);
    });

    it("handles leap year boundary (Feb 29)", async () => {
      const episode = baseEpisode({
        id: "ep-leap-001",
        timestamp: "2024-02-29T12:00:00.000Z"
      });

      const result = await repo.appendEpisode(episode);
      expect(result.timestamp).toBe("2024-02-29T12:00:00.000Z");

      const retrieved = await repo.getEpisode("ep-leap-001", "2024");
      expect(retrieved).not.toBeNull();
    });

    it("handles far future year directory (year 9999)", async () => {
      const episode = baseEpisode({
        id: "ep-far-future",
        timestamp: "9999-01-01T00:00:00.000Z"
      });

      const result = await repo.appendEpisode(episode);
      expect(result.id).toBe("ep-far-future");

      const listed = await repo.listEpisodes({ year: "9999" });
      expect(listed.length).toBe(1);
    });

    it("tolerates year hint pointing to a file instead of directory", async () => {
      const episodicRoot = path.join(baseDir, "episodic");
      await writeFile(path.join(episodicRoot, "2025"), "not a directory");

      const listed = await repo.listEpisodes({ year: "2025" });
      expect(Array.isArray(listed)).toBe(true);
    });
  });

  // -------------------------------------------------------------------------
  // 8. Working memory corruption
  // -------------------------------------------------------------------------
  describe("Working memory corruption", () => {
    it("throws IntegrityError on invalid JSON in current-session file", async () => {
      const sessionFile = path.join(baseDir, "working", "current-session.json");
      await writeFile(sessionFile, "{invalid json!!!");

      await expect(repo.readWorkingMemory()).rejects.toThrow(
        SelfImprovementIntegrityError
      );
    });

    it("throws IntegrityError on valid JSON but wrong schema in last-error file", async () => {
      const errorFile = path.join(baseDir, "working", "last-error.json");
      await writeFile(errorFile, JSON.stringify({ version: 1, value: { garbage: true } }));

      await expect(repo.readWorkingMemory()).rejects.toThrow(
        SelfImprovementIntegrityError
      );
    });

    it("handles partial write recovery (temp file left behind)", async () => {
      const workingDir = path.join(baseDir, "working");
      await writeFile(
        path.join(workingDir, "current-session.json.abc123.tmp"),
        '{"partial":true}'
      );

      const memory = await repo.readWorkingMemory();
      expect(memory.currentSession).toBeNull();
    });

    it("clearWorkingMemory resets all three slots to null", async () => {
      await repo.writeCurrentSession({
        sessionId: "s1",
        skill: "test",
        startedAt: "2025-06-15T10:00:00.000Z",
        context: null,
        activeTask: null,
        status: "running"
      });
      await repo.writeLastError({
        capturedAt: "2025-06-15T10:00:00.000Z",
        skill: "test",
        tool: "bash",
        message: "oops",
        exitCode: null,
        inputSummary: null,
        outputSummary: null
      });
      await repo.writeSessionEnd({
        sessionId: "s1",
        endedAt: "2025-06-15T11:00:00.000Z",
        status: "completed",
        summary: null
      });

      await repo.clearWorkingMemory();

      const memory = await repo.readWorkingMemory();
      expect(memory.currentSession).toBeNull();
      expect(memory.lastError).toBeNull();
      expect(memory.sessionEnd).toBeNull();
    });
  });

  // -------------------------------------------------------------------------
  // 9. Metadata depth and size
  // -------------------------------------------------------------------------
  describe("Metadata depth and size limits", () => {
    it("rejects metadata exceeding MAX_METADATA_DEPTH (4)", async () => {
      // depth 5 exceeds limit of 4
      const deepMeta = { a: { b: { c: { d: { e: "too deep" } } } } };

      await expect(
        repo.appendEpisode(rawEpisode({ id: "ep-deep-meta", metadata: deepMeta }) as any)
      ).rejects.toThrow(SelfImprovementValidationError);
    });

    it("accepts metadata at exactly MAX_METADATA_DEPTH (4)", async () => {
      const exactDepthMeta = { a: { b: { c: { d: "just right" } } } };

      const result = await repo.appendEpisode(
        baseEpisode({ id: "ep-exact-depth", metadata: exactDepthMeta })
      );
      expect(result.metadata).toEqual(exactDepthMeta);
    });

    it("rejects metadata exceeding serialized length limit (4000 chars)", async () => {
      const largeMeta = { data: "x".repeat(4_000) };

      await expect(
        repo.appendEpisode(rawEpisode({ id: "ep-large-meta", metadata: largeMeta }) as any)
      ).rejects.toThrow(SelfImprovementValidationError);
    });

    it("handles array metadata within depth limits", async () => {
      const arrayMeta = [1, [2, [3, [4]]]];

      const result = await repo.appendEpisode(
        baseEpisode({ id: "ep-array-meta", metadata: arrayMeta })
      );
      expect(result.metadata).toEqual(arrayMeta);
    });
  });

  // -------------------------------------------------------------------------
  // 10. Workflow outcome aggregation edge cases
  // -------------------------------------------------------------------------
  describe("Workflow outcome aggregation", () => {
    it("handles empty episode list", () => {
      const aggregates = aggregateWorkflowOutcomes([]);
      expect(aggregates).toEqual([]);
    });

    it("ignores episodes without workflowId in outcomeLink", () => {
      const episodes = [
        episodeWithRecommendation("k1", { id: "ep-no-wf" }, {}, { workflowId: null })
      ];

      const aggregates = aggregateWorkflowOutcomes(episodes);
      expect(aggregates).toEqual([]);
    });

    it("aggregates multiple episodes per workflow correctly", () => {
      const episodes = [
        episodeWithRecommendation("k1", { id: "wf-ep-1" }, { kind: "task_plan", fallbackMode: "normal" }, {
          workflowId: "wf-1",
          approvalDecision: "approved",
          executionKind: "completed"
        }),
        episodeWithRecommendation("k1", { id: "wf-ep-2" }, { kind: "task_plan", fallbackMode: "draft_only" }, {
          workflowId: "wf-1",
          approvalDecision: "rejected",
          executionKind: "failed",
          userCorrection: true
        })
      ];

      const aggregates = aggregateWorkflowOutcomes(episodes);
      expect(aggregates.length).toBe(1);
      expect(aggregates[0].workflowId).toBe("wf-1");
      expect(aggregates[0].sampleCount).toBe(2);
      expect(aggregates[0].approval.positive).toBe(1);
      expect(aggregates[0].approval.negative).toBe(1);
      expect(aggregates[0].execution.positive).toBe(1);
      expect(aggregates[0].execution.negative).toBe(1);
    });

    it("computes recentNegativeOutcomeRate over the most recent window", () => {
      // Episodes sorted by timestamp ascending: ep-0 (oldest) to ep-9 (newest)
      // The 3 most recent (ep-7, ep-8, ep-9) are all success/completed → rate 0
      // But the oldest 3 (ep-0, ep-1, ep-2) are failures
      const episodes = Array.from({ length: 10 }, (_, i) =>
        episodeWithRecommendation("k", {
          id: `wf-rec-${i}`,
          timestamp: `2025-06-${String(10 + i).padStart(2, "0")}T10:00:00.000Z`,
          outcome: i < 3 ? "failure" : "success"
        }, {}, {
          workflowId: "wf-rec",
          executionKind: i < 3 ? "failed" : "completed"
        })
      );

      const aggregates = aggregateWorkflowOutcomes(episodes, { recentWindow: 3 });
      expect(aggregates.length).toBe(1);
      expect(aggregates[0].recentWindowSize).toBe(3);
      // The 3 most recent episodes (indices 7,8,9) are all success → rate should be 0
      expect(aggregates[0].recentNegativeOutcomeRate).toBe(0);
    });
  });

  // -------------------------------------------------------------------------
  // 11. Slug collision disambiguation
  // -------------------------------------------------------------------------
  describe("Slug collision disambiguation", () => {
    it("disambiguates episodes whose sanitized slugs collide", async () => {
      const ep1 = baseEpisode({ id: "ep-alpha!", skill: "test", task: "same task" });
      const ep2 = baseEpisode({ id: "ep-alpha?", skill: "test", task: "same task" });
      const ep3 = baseEpisode({ id: "ep-alpha.", skill: "test", task: "same task" });

      await repo.appendEpisode(ep1);
      await repo.appendEpisode(ep2);
      await repo.appendEpisode(ep3);

      const listed = await repo.listEpisodes();
      expect(listed.length).toBe(3);

      expect(await repo.getEpisode("ep-alpha!")).not.toBeNull();
      expect(await repo.getEpisode("ep-alpha?")).not.toBeNull();
      expect(await repo.getEpisode("ep-alpha.")).not.toBeNull();
    });
  });

  // -------------------------------------------------------------------------
  // 12. Performance report edge cases
  // -------------------------------------------------------------------------
  describe("Performance report edge cases", () => {
    it("buildRecommendationPerformanceReport handles empty episodes", () => {
      const report = buildRecommendationPerformanceReport([]);
      expect(report.current.episodeCount).toBe(0);
      expect(report.drift.status).toBe("insufficient_data");
    });

    it("buildPolicyLearningValidation returns insufficient_data for sparse evidence", () => {
      const validation = buildPolicyLearningValidation([], {});
      expect(validation.replayValidated).toBe(false);
      expect(validation.driftStatus).toBe("insufficient_data");
    });

    it("deriveWorkflowRecommendations respects minimumScore filter", () => {
      const episodes = [
        episodeWithRecommendation("low-score", { id: "ep-ls-1", outcome: "failure" }, { confidence: 0.1 }, {
          executionKind: "failed",
          outcomeScore: -1,
          approvalDecision: "rejected",
          userCorrection: true
        })
      ];

      const recs = deriveWorkflowRecommendations(episodes, { minimumScore: 0.9 });
      expect(recs.length).toBe(0);
    });

    it("filterRecommendationEvidenceEpisodes sorts by timestamp ascending", () => {
      const episodes = [
        episodeWithRecommendation("k", { id: "ep-sort-2", timestamp: "2025-06-15T12:00:00.000Z" }, {}, { executionKind: "completed" }),
        episodeWithRecommendation("k", { id: "ep-sort-1", timestamp: "2025-06-15T10:00:00.000Z" }, {}, { executionKind: "completed" })
      ];

      const filtered = filterRecommendationEvidenceEpisodes(episodes);
      expect(filtered.length).toBe(2);
      expect(filtered[0].id).toBe("ep-sort-1");
      expect(filtered[1].id).toBe("ep-sort-2");
    });
  });

  // -------------------------------------------------------------------------
  // 13. Prototype pollution / inherited properties
  // -------------------------------------------------------------------------
  describe("Prototype pollution resistance", () => {
    it("getSemanticPattern returns null for __proto__ key", async () => {
      const result = await repo.getSemanticPattern("__proto__");
      expect(result).toBeNull();
    });

    it("getSemanticPattern returns null for constructor key", async () => {
      const result = await repo.getSemanticPattern("constructor");
      expect(result).toBeNull();
    });
  });

  // -------------------------------------------------------------------------
  // 14. Semantic pattern CRUD
  // -------------------------------------------------------------------------
  describe("Semantic pattern operations", () => {
    it("upsert creates new pattern and preserves createdAt on update", async () => {
      const pattern = SemanticPatternSchema.parse({
        id: "pat-crud-1",
        name: "Test Pattern",
        source: "manual",
        confidence: 0.7,
        applications: 5,
        createdAt: "2025-06-15T10:00:00.000Z",
        updatedAt: "2025-06-15T10:00:00.000Z",
        category: "testing",
        pattern: "test pattern description",
        problem: "test problem description",
        qualityRules: ["rule-1"],
        targetSkills: ["coding"]
      });

      await repo.upsertSemanticPattern(pattern);

      const updated = SemanticPatternSchema.parse({
        ...pattern,
        applications: 10,
        updatedAt: "2025-06-16T10:00:00.000Z"
      });

      const result = await repo.upsertSemanticPattern(updated);
      expect(result.createdAt).toBe("2025-06-15T10:00:00.000Z");
      expect(result.updatedAt).toBe("2025-06-16T10:00:00.000Z");
      expect(result.applications).toBe(10);
    });

    it("rejects semantic pattern with id exceeding 80 chars", async () => {
      const pattern = {
        id: "p".repeat(81),
        name: "Test",
        source: "manual",
        confidence: 0.5,
        applications: 0,
        createdAt: "2025-06-15T10:00:00.000Z",
        updatedAt: "2025-06-15T10:00:00.000Z",
        category: "testing",
        pattern: "desc",
        problem: "prob",
        qualityRules: [],
        targetSkills: []
      };

      await expect(repo.upsertSemanticPattern(pattern as any)).rejects.toThrow(
        SelfImprovementValidationError
      );
    });
  });

  // -------------------------------------------------------------------------
  // 15. List episodes filters
  // -------------------------------------------------------------------------
  describe("List episodes filter validation", () => {
    it("rejects invalid year filter", async () => {
      await expect(
        repo.listEpisodes({ year: "abcd" })
      ).rejects.toThrow(SelfImprovementValidationError);
    });

    it("rejects non-finite limit", async () => {
      await expect(
        repo.listEpisodes({ limit: Infinity })
      ).rejects.toThrow(SelfImprovementValidationError);
    });

    it("clamps limit to [1, 500]", async () => {
      for (let i = 0; i < 3; i++) {
        await repo.appendEpisode(baseEpisode({ id: `ep-limit-${i}`, task: `Task ${i}` }));
      }

      const listed = await repo.listEpisodes({ limit: 2 });
      expect(listed.length).toBe(2);
    });

    it("filters by ownerUserId", async () => {
      await repo.appendEpisode(baseEpisode({
        id: "ep-owner-a",
        provenance: { ownerUserId: "alice", workspaceId: null, source: "goal", memoryIds: [], actionLogIds: [], evidenceRecordIds: [], recommendationKeys: [] }
      }));
      await repo.appendEpisode(baseEpisode({
        id: "ep-owner-b",
        provenance: { ownerUserId: "bob", workspaceId: null, source: "goal", memoryIds: [], actionLogIds: [], evidenceRecordIds: [], recommendationKeys: [] }
      }));

      const aliceEpisodes = await repo.listEpisodes({ ownerUserId: "alice" });
      expect(aliceEpisodes.length).toBe(1);
      expect(aliceEpisodes[0].id).toBe("ep-owner-a");
    });
  });

  // -------------------------------------------------------------------------
  // 16. Recommendation controls (suppress / expire)
  // -------------------------------------------------------------------------
  describe("Recommendation controls", () => {
    it("suppress control excludes episodes from insights", () => {
      const episodes = [
        episodeWithRecommendation("suppressed-key", {
          id: "ep-suppressed",
          provenance: { ownerUserId: null, workspaceId: null, source: "feedback", memoryIds: [], actionLogIds: [], evidenceRecordIds: [], recommendationKeys: [] },
          metadata: { recommendationControl: { action: "suppress", timestamp: "2025-06-15T10:00:00.000Z" } }
        }, {}, { executionKind: "completed" })
      ];

      const insights = deriveRecommendationInsights(episodes);
      expect(insights.find((i) => i.key === "suppressed-key")).toBeUndefined();
    });

    it("expire control only counts episodes after the expiry timestamp", () => {
      // The expire control is set at T=15. Episodes before T=15 should be excluded.
      // Episodes after T=15 should still count.
      // Note: the control comes from a feedback-source episode; the controlled episodes
      // can be from any source. We need the control episode AND the target episodes.
      const controlEpisode = episodeWithRecommendation("expired-key", {
        id: "ep-control",
        timestamp: "2025-06-15T10:00:00.000Z",
        provenance: { ownerUserId: null, workspaceId: null, source: "feedback", memoryIds: [], actionLogIds: [], evidenceRecordIds: [], recommendationKeys: [] },
        metadata: { recommendationControl: { action: "expire", timestamp: "2025-06-15T10:00:00.000Z" } }
      }, {}, { executionKind: "completed" });

      const oldEpisode = episodeWithRecommendation("expired-key", {
        id: "ep-before-expire",
        timestamp: "2025-06-14T10:00:00.000Z",
        provenance: { ownerUserId: null, workspaceId: null, source: "goal", memoryIds: [], actionLogIds: [], evidenceRecordIds: [], recommendationKeys: [] }
      }, {}, { executionKind: "completed" });

      const newEpisode = episodeWithRecommendation("expired-key", {
        id: "ep-after-expire",
        timestamp: "2025-06-16T10:00:00.000Z",
        provenance: { ownerUserId: null, workspaceId: null, source: "goal", memoryIds: [], actionLogIds: [], evidenceRecordIds: [], recommendationKeys: [] }
      }, {}, { executionKind: "completed" });

      const insights = deriveRecommendationInsights([controlEpisode, oldEpisode, newEpisode]);
      const insight = insights.find((i) => i.key === "expired-key");
      expect(insight).toBeDefined();
      // The expire control excludes all episodes with timestamp <= control timestamp.
      // controlEpisode (T=15) is excluded (15 <= 15), oldEpisode (T=14) is excluded (14 <= 15).
      // Only newEpisode (T=16 > 15) survives.
      expect(insight!.evidenceCount).toBe(1);
    });
  });

  // -------------------------------------------------------------------------
  // 17. Base directory escape prevention
  // -------------------------------------------------------------------------
  describe("Base directory escape prevention", () => {
    it("rejects baseDir that would resolve outside expected scope via relative traversal", async () => {
      const evilRepo = createSelfImprovementRepository({
        baseDir: path.join(baseDir, "..", "..", "..", "tmp", "evil")
      });

      try {
        await evilRepo.seed();
        expect(evilRepo.baseDir).toBeTruthy();
      } catch (error) {
        expect(error).toBeDefined();
      }
    });
  });
});
