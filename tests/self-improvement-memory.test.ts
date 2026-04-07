import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  createSelfImprovementRepository,
  EpisodeRecordSchema,
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
