import { randomUUID } from "node:crypto";
import { mkdir, readFile, readdir, rename, stat, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";

const MAX_METADATA_DEPTH = 4;
const MAX_METADATA_SERIALIZED_LENGTH = 4_000;

const boundedString = (max: number) => z.string().trim().min(1).max(max);
const IsoDateTimeSchema = z.string().datetime();

const JsonPrimitiveSchema = z.union([z.string(), z.number(), z.boolean(), z.null()]);
type JsonValue = string | number | boolean | null | JsonValue[] | { [key: string]: JsonValue };
const JsonValueSchema: z.ZodType<JsonValue> = z.lazy(() =>
  z.union([JsonPrimitiveSchema, z.array(JsonValueSchema), z.record(z.string(), JsonValueSchema)])
);
const YearSchema = z.string().regex(/^\d{4}$/, "Year must be a four-digit UTC year.");

function valueDepth(value: JsonValue, currentDepth = 0): number {
  if (value === null || typeof value !== "object") {
    return currentDepth;
  }

  if (Array.isArray(value)) {
    return value.reduce<number>((maxDepth, item) => Math.max(maxDepth, valueDepth(item, currentDepth + 1)), currentDepth + 1);
  }

  return Object.values(value).reduce<number>(
    (maxDepth, item) => Math.max(maxDepth, valueDepth(item, currentDepth + 1)),
    currentDepth + 1
  );
}

const MetadataSchema = JsonValueSchema.superRefine((value, context) => {
  if (valueDepth(value) > MAX_METADATA_DEPTH) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      message: `Metadata depth must not exceed ${MAX_METADATA_DEPTH}.`
    });
  }

  const serialized = JSON.stringify(value);

  if (serialized.length > MAX_METADATA_SERIALIZED_LENGTH) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      message: `Metadata must not exceed ${MAX_METADATA_SERIALIZED_LENGTH} serialized characters.`
    });
  }
});

export const EpisodeOutcomeSchema = z.enum(["success", "partial", "failure"]);
export const RecommendationFallbackModeSchema = z.enum(["normal", "review_required", "draft_only"]);
export const RecommendationEvidenceHintSchema = z.enum(["none", "sparse", "established"]);
export const RecommendationTraceSchema = z
  .object({
    key: boundedString(160),
    kind: z.enum(["task_plan", "approval_path", "execution_path"]),
    agent: boundedString(80),
    action: boundedString(120),
    confidence: z.number().min(0).max(1),
    rationale: z.string().trim().max(500).nullable().default(null),
    riskClass: z.string().trim().max(16).nullable().default(null),
    capabilities: z.array(boundedString(40)).max(20).default([]),
    sourceGoalId: boundedString(80),
    sourceTaskId: z.string().trim().max(80).nullable().default(null),
    fallbackMode: RecommendationFallbackModeSchema,
    evidenceHint: RecommendationEvidenceHintSchema.default("none")
  })
  .strict();
export const OutcomeExecutionKindSchema = z.enum(["not_run", "completed", "failed"]);
export const OutcomeLinkSchema = z
  .object({
    goalId: boundedString(80),
    workflowId: z.string().trim().max(80).nullable().default(null),
    taskId: z.string().trim().max(80).nullable().default(null),
    goalStatus: z.string().trim().max(80).nullable().default(null),
    taskState: z.string().trim().max(80).nullable().default(null),
    approvalDecision: z.enum(["approved", "rejected"]).nullable().default(null),
    executionKind: OutcomeExecutionKindSchema.default("not_run"),
    outcomeScore: z.number().min(-1).max(1),
    userCorrection: z.boolean().default(false),
    notes: z.string().trim().max(500).nullable().default(null)
  })
  .strict();
export const SemanticPatternSchema = z
  .object({
    id: boundedString(80),
    name: boundedString(120),
    source: boundedString(80),
    confidence: z.number().min(0).max(1),
    applications: z.number().int().min(0).max(10_000),
    createdAt: IsoDateTimeSchema,
    updatedAt: IsoDateTimeSchema,
    category: boundedString(64),
    pattern: boundedString(300),
    problem: boundedString(1_000),
    solution: z.record(z.string(), MetadataSchema).default({}),
    qualityRules: z.array(boundedString(200)).max(20),
    targetSkills: z.array(boundedString(80)).max(20),
    relatedEpisodeIds: z.array(boundedString(80)).max(50).default([])
  })
  .strict();

export const SemanticPatternsFileSchema = z
  .object({
    version: z.literal(1),
    patterns: z.record(z.string(), SemanticPatternSchema)
  })
  .strict();

export const UserFeedbackSchema = z
  .object({
    rating: z.number().int().min(1).max(10),
    comments: z.string().trim().max(1_000).optional()
  })
  .strict();

export const EpisodeRecordSchema = z
  .object({
    id: boundedString(80),
    timestamp: IsoDateTimeSchema,
    skill: boundedString(80),
    task: boundedString(300),
    outcome: EpisodeOutcomeSchema,
    situation: boundedString(2_000),
    rootCause: z.string().trim().max(2_000).nullable().default(null),
    solution: boundedString(2_000),
    lesson: boundedString(2_000),
    recommendation: RecommendationTraceSchema.nullable().optional().default(null),
    outcomeLink: OutcomeLinkSchema.nullable().optional().default(null),
    relatedPatternId: z.string().trim().max(80).nullable().default(null),
    userFeedback: UserFeedbackSchema.nullable().optional().default(null),
    metadata: MetadataSchema.default({})
  })
  .strict();

export const SessionStatusSchema = z.enum(["running", "completed", "failed", "cancelled"]);

export const CurrentSessionSchema = z
  .object({
    sessionId: boundedString(80),
    skill: boundedString(80),
    startedAt: IsoDateTimeSchema,
    context: z.string().trim().max(1_000).nullable().default(null),
    activeTask: z.string().trim().max(300).nullable().default(null),
    status: SessionStatusSchema
  })
  .strict();

export const LastErrorSchema = z
  .object({
    capturedAt: IsoDateTimeSchema,
    skill: boundedString(80),
    tool: boundedString(80),
    message: boundedString(1_000),
    exitCode: z.number().int().min(-1_000_000).max(1_000_000).nullable().default(null),
    inputSummary: z.string().trim().max(1_000).nullable().default(null),
    outputSummary: z.string().trim().max(2_000).nullable().default(null)
  })
  .strict();

export const SessionEndSchema = z
  .object({
    sessionId: boundedString(80),
    endedAt: IsoDateTimeSchema,
    status: SessionStatusSchema,
    summary: z.string().trim().max(1_000).nullable().default(null)
  })
  .strict();

function createVersionedValueFileSchema<T extends z.ZodTypeAny>(valueSchema: T) {
  return z
    .object({
      version: z.literal(1),
      value: valueSchema.nullable()
    })
    .strict();
}

export const CurrentSessionFileSchema = createVersionedValueFileSchema(CurrentSessionSchema);
export const LastErrorFileSchema = createVersionedValueFileSchema(LastErrorSchema);
export const SessionEndFileSchema = createVersionedValueFileSchema(SessionEndSchema);

export type SemanticPattern = z.infer<typeof SemanticPatternSchema>;
export type SemanticPatternsFile = z.infer<typeof SemanticPatternsFileSchema>;
export type UserFeedback = z.infer<typeof UserFeedbackSchema>;
export type EpisodeOutcome = z.infer<typeof EpisodeOutcomeSchema>;
export type RecommendationFallbackMode = z.infer<typeof RecommendationFallbackModeSchema>;
export type RecommendationEvidenceHint = z.infer<typeof RecommendationEvidenceHintSchema>;
export type RecommendationTrace = z.infer<typeof RecommendationTraceSchema>;
export type OutcomeExecutionKind = z.infer<typeof OutcomeExecutionKindSchema>;
export type OutcomeLink = z.infer<typeof OutcomeLinkSchema>;
export type EpisodeRecord = z.infer<typeof EpisodeRecordSchema>;
export type CurrentSession = z.infer<typeof CurrentSessionSchema>;
export type LastError = z.infer<typeof LastErrorSchema>;
export type SessionEnd = z.infer<typeof SessionEndSchema>;
export type CurrentSessionFile = z.infer<typeof CurrentSessionFileSchema>;
export type LastErrorFile = z.infer<typeof LastErrorFileSchema>;
export type SessionEndFile = z.infer<typeof SessionEndFileSchema>;

export type WorkingMemoryState = {
  currentSession: CurrentSession | null;
  lastError: LastError | null;
  sessionEnd: SessionEnd | null;
};

export class SelfImprovementValidationError extends Error {
  constructor(message: string, readonly causeValue?: unknown) {
    super(message);
    this.name = "SelfImprovementValidationError";
  }
}

export class SelfImprovementIntegrityError extends Error {
  constructor(message: string, readonly filePath: string) {
    super(message);
    this.name = "SelfImprovementIntegrityError";
  }
}

export class SelfImprovementConflictError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SelfImprovementConflictError";
  }
}

export class SelfImprovementStorageError extends Error {
  constructor(message: string, readonly causeValue?: unknown) {
    super(message);
    this.name = "SelfImprovementStorageError";
  }
}

export type RecommendationReplayMode = "draft_only" | "review_required" | "approval_required" | "suggest";

export type RecommendationInsight = {
  key: string;
  kind: RecommendationTrace["kind"];
  agent: string;
  action: string;
  riskClass: string | null;
  capabilities: string[];
  evidenceCount: number;
  averageConfidence: number;
  successCount: number;
  partialCount: number;
  failureCount: number;
  rejectionCount: number;
  userCorrectionCount: number;
  approvalCount: number;
  lastSeenAt: string;
  score: number;
  replayMode: RecommendationReplayMode;
  rationale: string;
};

export type RecommendationReplayCase = {
  key: string;
  predictedMode: RecommendationReplayMode;
  observedRisk: "safe" | "caution" | "unsafe";
  score: number;
  evidenceCount: number;
  averageConfidence: number;
};

export type RecommendationReplayReport = {
  totalEpisodes: number;
  consideredEpisodes: number;
  sparsePatterns: number;
  suggestedPatterns: number;
  guardedPatterns: number;
  safeSuggestionPrecision: number;
  cases: RecommendationReplayCase[];
  insights: RecommendationInsight[];
};

function validateInput<T>(schema: z.ZodType<T>, value: unknown, message: string): T {
  const result = schema.safeParse(value);

  if (!result.success) {
    throw new SelfImprovementValidationError(message, result.error.flatten());
  }

  return result.data;
}

function normalizeOptionalTrimmedString(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value));
}

function buildRecommendationRationale(params: {
  evidenceCount: number;
  successCount: number;
  partialCount: number;
  failureCount: number;
  rejectionCount: number;
  userCorrectionCount: number;
  averageConfidence: number;
  replayMode: RecommendationReplayMode;
}): string {
  const fragments = [
    `${params.evidenceCount} observed outcome${params.evidenceCount === 1 ? "" : "s"}`,
    `${params.successCount} success`,
    `${params.failureCount} failure`,
    `${params.rejectionCount} rejection`,
    `${params.userCorrectionCount} correction`
  ];

  if (params.partialCount > 0) {
    fragments.push(`${params.partialCount} partial`);
  }

  const confidenceLabel = params.averageConfidence >= 0.78 ? "strong" : params.averageConfidence >= 0.6 ? "mixed" : "low";
  fragments.push(`${confidenceLabel} confidence`);

  if (params.replayMode === "draft_only") {
    fragments.push("keep to draft-only fallback until more evidence exists");
  } else if (params.replayMode === "review_required") {
    fragments.push("keep human review because negative outcomes were observed");
  } else if (params.replayMode === "approval_required") {
    fragments.push("approval remains the safe operating mode");
  } else {
    fragments.push("eligible for suggestion-first reuse");
  }

  return fragments.join("; ");
}

export function deriveRecommendationInsights(
  episodes: EpisodeRecord[],
  options?: {
    minimumEvidence?: number;
    lowConfidenceThreshold?: number;
    automationThreshold?: number;
  }
): RecommendationInsight[] {
  const minimumEvidence = Math.max(1, Math.trunc(options?.minimumEvidence ?? 3));
  const lowConfidenceThreshold = clamp(options?.lowConfidenceThreshold ?? 0.58, 0, 1);
  const automationThreshold = clamp(options?.automationThreshold ?? 0.78, 0, 1);
  const grouped = new Map<
    string,
    {
      recommendation: RecommendationTrace;
      evidenceCount: number;
      confidenceTotal: number;
      successCount: number;
      partialCount: number;
      failureCount: number;
      rejectionCount: number;
      userCorrectionCount: number;
      approvalCount: number;
      outcomeScoreTotal: number;
      lastSeenAt: string;
    }
  >();

  for (const episode of episodes) {
    if (!episode.recommendation || !episode.outcomeLink) {
      continue;
    }

    const existing = grouped.get(episode.recommendation.key) ?? {
      recommendation: episode.recommendation,
      evidenceCount: 0,
      confidenceTotal: 0,
      successCount: 0,
      partialCount: 0,
      failureCount: 0,
      rejectionCount: 0,
      userCorrectionCount: 0,
      approvalCount: 0,
      outcomeScoreTotal: 0,
      lastSeenAt: episode.timestamp
    };

    existing.evidenceCount += 1;
    existing.confidenceTotal += episode.recommendation.confidence;
    existing.outcomeScoreTotal += episode.outcomeLink.outcomeScore;
    existing.lastSeenAt = existing.lastSeenAt.localeCompare(episode.timestamp) >= 0 ? existing.lastSeenAt : episode.timestamp;

    if (episode.outcome === "success") {
      existing.successCount += 1;
    } else if (episode.outcome === "partial") {
      existing.partialCount += 1;
    } else {
      existing.failureCount += 1;
    }

    if (episode.outcomeLink.approvalDecision === "approved") {
      existing.approvalCount += 1;
    }

    if (episode.outcomeLink.approvalDecision === "rejected") {
      existing.rejectionCount += 1;
    }

    if (episode.outcomeLink.userCorrection) {
      existing.userCorrectionCount += 1;
    }

    grouped.set(episode.recommendation.key, existing);
  }

  return [...grouped.values()]
    .map((entry) => {
      const averageConfidence = clamp(entry.confidenceTotal / entry.evidenceCount, 0, 1);
      const normalizedOutcomeScore = clamp((entry.outcomeScoreTotal / entry.evidenceCount + 1) / 2, 0, 1);
      const successWeight = (entry.successCount + entry.partialCount * 0.5) / entry.evidenceCount;
      const negativeWeight = (entry.failureCount + entry.rejectionCount + entry.userCorrectionCount) / entry.evidenceCount;
      const evidenceBonus = Math.min(0.12, Math.log2(entry.evidenceCount + 1) * 0.04);
      const score = clamp(
        normalizedOutcomeScore * 0.55 + successWeight * 0.35 + evidenceBonus - negativeWeight * 0.3,
        0,
        1
      );

      let replayMode: RecommendationReplayMode;
      if (entry.evidenceCount < minimumEvidence || averageConfidence < lowConfidenceThreshold) {
        replayMode = "draft_only";
      } else if (entry.rejectionCount > 0 || entry.userCorrectionCount > 0 || negativeWeight >= 0.45 || score < 0.45) {
        replayMode = "review_required";
      } else if (entry.failureCount > 0 || entry.partialCount > 0 || score < automationThreshold) {
        replayMode = "approval_required";
      } else {
        replayMode = "suggest";
      }

      return {
        key: entry.recommendation.key,
        kind: entry.recommendation.kind,
        agent: entry.recommendation.agent,
        action: entry.recommendation.action,
        riskClass: entry.recommendation.riskClass,
        capabilities: [...entry.recommendation.capabilities],
        evidenceCount: entry.evidenceCount,
        averageConfidence,
        successCount: entry.successCount,
        partialCount: entry.partialCount,
        failureCount: entry.failureCount,
        rejectionCount: entry.rejectionCount,
        userCorrectionCount: entry.userCorrectionCount,
        approvalCount: entry.approvalCount,
        lastSeenAt: entry.lastSeenAt,
        score,
        replayMode,
        rationale: buildRecommendationRationale({
          evidenceCount: entry.evidenceCount,
          successCount: entry.successCount,
          partialCount: entry.partialCount,
          failureCount: entry.failureCount,
          rejectionCount: entry.rejectionCount,
          userCorrectionCount: entry.userCorrectionCount,
          averageConfidence,
          replayMode
        })
      } satisfies RecommendationInsight;
    })
    .sort((left, right) => {
      if (right.score !== left.score) {
        return right.score - left.score;
      }

      if (right.evidenceCount !== left.evidenceCount) {
        return right.evidenceCount - left.evidenceCount;
      }

      return right.lastSeenAt.localeCompare(left.lastSeenAt);
    });
}

export function buildRecommendationReplayReport(
  episodes: EpisodeRecord[],
  options?: {
    minimumEvidence?: number;
    lowConfidenceThreshold?: number;
    automationThreshold?: number;
  }
): RecommendationReplayReport {
  const insights = deriveRecommendationInsights(episodes, options);
  const cases = insights.map((insight) => {
    const observedRisk =
      insight.rejectionCount > 0 || insight.userCorrectionCount > 0 || insight.failureCount >= Math.ceil(insight.evidenceCount / 2)
        ? "unsafe"
        : insight.failureCount > 0 || insight.partialCount > 0
          ? "caution"
          : "safe";

    return {
      key: insight.key,
      predictedMode: insight.replayMode,
      observedRisk,
      score: insight.score,
      evidenceCount: insight.evidenceCount,
      averageConfidence: insight.averageConfidence
    } satisfies RecommendationReplayCase;
  });

  const suggestedCases = cases.filter((item) => item.predictedMode === "suggest");
  const safeSuggestionPrecision =
    suggestedCases.length === 0
      ? 0
      : suggestedCases.filter((item) => item.observedRisk === "safe").length / suggestedCases.length;

  return {
    totalEpisodes: episodes.length,
    consideredEpisodes: episodes.filter((episode) => episode.recommendation && episode.outcomeLink).length,
    sparsePatterns: insights.filter((insight) => insight.replayMode === "draft_only").length,
    suggestedPatterns: suggestedCases.length,
    guardedPatterns: insights.filter((insight) => insight.replayMode !== "suggest").length,
    safeSuggestionPrecision,
    cases,
    insights
  };
}

export type ListEpisodesFilters = {
  year?: string;
  skill?: string;
  outcome?: EpisodeOutcome;
  limit?: number;
};

export type SelfImprovementRepository = {
  readonly baseDir: string;
  seed(): Promise<void>;
  readSemanticPatterns(): Promise<SemanticPatternsFile>;
  getSemanticPattern(id: string): Promise<SemanticPattern | null>;
  upsertSemanticPattern(pattern: SemanticPattern): Promise<SemanticPattern>;
  appendEpisode(episode: EpisodeRecord): Promise<EpisodeRecord>;
  getEpisode(id: string, yearHint?: string): Promise<EpisodeRecord | null>;
  listEpisodes(filters?: ListEpisodesFilters): Promise<EpisodeRecord[]>;
  readWorkingMemory(): Promise<WorkingMemoryState>;
  writeCurrentSession(session: CurrentSession | null): Promise<CurrentSession | null>;
  writeLastError(error: LastError | null): Promise<LastError | null>;
  writeSessionEnd(snapshot: SessionEnd | null): Promise<SessionEnd | null>;
  clearWorkingMemory(): Promise<void>;
};

export function createSelfImprovementRepository(options?: { baseDir?: string }): SelfImprovementRepository {
  const configuredDir = options?.baseDir?.trim();
  const baseDir = configuredDir
    ? path.resolve(configuredDir)
    : path.resolve(/* turbopackIgnore: true */ process.cwd(), ".agentic", "self-improvement");

  function resolveWithinBase(...segments: string[]): string {
    const resolved = path.resolve(baseDir, ...segments);
    const relative = path.relative(baseDir, resolved);

    if (relative.startsWith("..") || path.isAbsolute(relative)) {
      throw new SelfImprovementStorageError(`Resolved path escaped the self-improvement base directory: ${resolved}`);
    }

    return resolved;
  }

  function semanticFilePath() {
    return resolveWithinBase("semantic-patterns.json");
  }

  function episodicRootPath() {
    return resolveWithinBase("episodic");
  }

  function episodicYearPath(year: string) {
    return resolveWithinBase("episodic", year);
  }

  function workingRootPath() {
    return resolveWithinBase("working");
  }

  function currentSessionPath() {
    return resolveWithinBase("working", "current-session.json");
  }

  function lastErrorPath() {
    return resolveWithinBase("working", "last-error.json");
  }

  function sessionEndPath() {
    return resolveWithinBase("working", "session-end.json");
  }

  async function pathExists(targetPath: string): Promise<boolean> {
    try {
      await stat(targetPath);
      return true;
    } catch (error) {
      if (error instanceof Error && "code" in error && error.code === "ENOENT") {
        return false;
      }

      throw new SelfImprovementStorageError(`Failed to inspect path ${targetPath}.`, error);
    }
  }

  async function ensureParentDirectory(targetPath: string): Promise<void> {
    await mkdir(path.dirname(targetPath), { recursive: true });
  }

  async function writeJsonFile<T>(targetPath: string, value: T): Promise<void> {
    const tempPath = `${targetPath}.${randomUUID()}.tmp`;

    try {
      await ensureParentDirectory(targetPath);
      await writeFile(tempPath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
      await rename(tempPath, targetPath);
    } catch (error) {
      await unlink(tempPath).catch(() => undefined);
      throw new SelfImprovementStorageError(`Failed to write self-improvement file ${targetPath}.`, error);
    }
  }

  async function readJsonFile<T>(targetPath: string, schema: z.ZodSchema<T>): Promise<T> {
    let raw: string;

    try {
      raw = await readFile(targetPath, "utf8");
    } catch (error) {
      if (error instanceof Error && "code" in error && error.code === "ENOENT") {
        throw error;
      }

      throw new SelfImprovementStorageError(`Failed to read self-improvement file ${targetPath}.`, error);
    }

    try {
      return schema.parse(JSON.parse(raw) as unknown);
    } catch (error) {
      throw new SelfImprovementIntegrityError(`Self-improvement file is corrupt or invalid: ${targetPath}.`, targetPath);
    }
  }

  function sanitizeSlug(input: string): string {
    const normalized = input
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 48)
      .replace(/^-+|-+$/g, "");

    return normalized || "entry";
  }

  function defaultSemanticPatternsFile(): SemanticPatternsFile {
    return SemanticPatternsFileSchema.parse({
      version: 1,
      patterns: {}
    });
  }

  function defaultCurrentSessionFile(): CurrentSessionFile {
    return CurrentSessionFileSchema.parse({
      version: 1,
      value: null
    });
  }

  function defaultLastErrorFile(): LastErrorFile {
    return LastErrorFileSchema.parse({
      version: 1,
      value: null
    });
  }

  function defaultSessionEndFile(): SessionEndFile {
    return SessionEndFileSchema.parse({
      version: 1,
      value: null
    });
  }

  async function ensureStoreSeeded(): Promise<void> {
    await mkdir(baseDir, { recursive: true });
    await mkdir(episodicRootPath(), { recursive: true });
    await mkdir(workingRootPath(), { recursive: true });

    if (!(await pathExists(semanticFilePath()))) {
      await writeJsonFile(semanticFilePath(), defaultSemanticPatternsFile());
    }

    if (!(await pathExists(currentSessionPath()))) {
      await writeJsonFile(currentSessionPath(), defaultCurrentSessionFile());
    }

    if (!(await pathExists(lastErrorPath()))) {
      await writeJsonFile(lastErrorPath(), defaultLastErrorFile());
    }

    if (!(await pathExists(sessionEndPath()))) {
      await writeJsonFile(sessionEndPath(), defaultSessionEndFile());
    }
  }

  async function readSemanticFile(): Promise<SemanticPatternsFile> {
    await ensureStoreSeeded();
    return readJsonFile(semanticFilePath(), SemanticPatternsFileSchema);
  }

  async function readWorkingFiles(): Promise<{
    currentSession: CurrentSessionFile;
    lastError: LastErrorFile;
    sessionEnd: SessionEndFile;
  }> {
    await ensureStoreSeeded();

    const [currentSession, lastError, sessionEnd] = await Promise.all([
      readJsonFile(currentSessionPath(), CurrentSessionFileSchema),
      readJsonFile(lastErrorPath(), LastErrorFileSchema),
      readJsonFile(sessionEndPath(), SessionEndFileSchema)
    ]);

    return { currentSession, lastError, sessionEnd };
  }

  async function writeWorkingValue<T>(
    targetPath: string,
    schema: z.ZodSchema<{ version: 1; value: T | null }>,
    value: T | null
  ): Promise<T | null> {
    await ensureStoreSeeded();
    const validated = schema.parse({
      version: 1,
      value
    });
    await writeJsonFile(targetPath, validated);
    return validated.value;
  }

  async function listEpisodeFiles(yearHint?: string): Promise<string[]> {
    await ensureStoreSeeded();
    const years = yearHint ? [yearHint] : await readdir(episodicRootPath());
    const files: string[] = [];

    for (const year of years) {
      const yearDirectory = episodicYearPath(year);
      if (!(await pathExists(yearDirectory))) {
        continue;
      }

      const entries = await readdir(yearDirectory);

      for (const entry of entries) {
        if (entry.endsWith(".json")) {
          files.push(resolveWithinBase("episodic", year, entry));
        }
      }
    }

    return files;
  }

  async function readEpisodeFile(filePath: string): Promise<EpisodeRecord> {
    return readJsonFile(filePath, EpisodeRecordSchema);
  }

  function normalizeFilters(filters?: ListEpisodesFilters): ListEpisodesFilters {
    if (!filters) {
      return {};
    }

    const year = normalizeOptionalTrimmedString(filters.year);
    const skill = normalizeOptionalTrimmedString(filters.skill);

    return {
      year: year ? validateInput(YearSchema, year, "Episode year filter is invalid.") : undefined,
      skill,
      outcome: filters.outcome,
      limit:
        filters.limit === undefined
          ? undefined
          : Math.max(1, Math.min(500, Math.trunc(validateInput(z.number().finite(), filters.limit, "Episode limit is invalid."))))
    };
  }

  return {
    baseDir,

    async seed() {
      await ensureStoreSeeded();
    },

    async readSemanticPatterns() {
      return readSemanticFile();
    },

    async getSemanticPattern(id: string) {
      const validatedId = validateInput(boundedString(80), id, "Semantic pattern id is invalid.");
      const semanticFile = await readSemanticFile();
      return semanticFile.patterns[validatedId] ?? null;
    },

    async upsertSemanticPattern(pattern: SemanticPattern) {
      const validated = validateInput(SemanticPatternSchema, pattern, "Semantic pattern payload is invalid.");
      const semanticFile = await readSemanticFile();
      const existing = semanticFile.patterns[validated.id];
      const normalizedPattern = validateInput(SemanticPatternSchema, {
        ...validated,
        createdAt: existing?.createdAt ?? validated.createdAt,
        updatedAt: validated.updatedAt
      }, "Normalized semantic pattern payload is invalid.");
      const nextFile = validateInput(SemanticPatternsFileSchema, {
        version: 1,
        patterns: {
          ...semanticFile.patterns,
          [normalizedPattern.id]: normalizedPattern
        }
      }, "Semantic patterns file payload is invalid.");

      await writeJsonFile(semanticFilePath(), nextFile);

      return normalizedPattern;
    },

    async appendEpisode(episode: EpisodeRecord) {
      const validated = validateInput(EpisodeRecordSchema, episode, "Episode payload is invalid.");
      const year = new Date(validated.timestamp).getUTCFullYear().toString();
      const existing = await this.getEpisode(validated.id, year);

      if (existing) {
        throw new SelfImprovementConflictError(`Episode ${validated.id} already exists.`);
      }

      const slug = sanitizeSlug(`${validated.skill}-${validated.task}`);
      const datePrefix = validated.timestamp.slice(0, 10);
      const filePath = resolveWithinBase("episodic", year, `${datePrefix}-${slug}.json`);

      await mkdir(episodicYearPath(year), { recursive: true });
      await writeJsonFile(filePath, validated);

      return validated;
    },

    async getEpisode(id: string, yearHint?: string) {
      const validatedId = validateInput(boundedString(80), id, "Episode id is invalid.");
      const normalizedYearHint = normalizeOptionalTrimmedString(yearHint);
      const candidateFiles = await listEpisodeFiles(
        normalizedYearHint ? validateInput(YearSchema, normalizedYearHint, "Episode year hint is invalid.") : undefined
      );

      for (const filePath of candidateFiles) {
        const episode = await readEpisodeFile(filePath);

        if (episode.id === validatedId) {
          return episode;
        }
      }

      return null;
    },

    async listEpisodes(filters) {
      const normalizedFilters = normalizeFilters(filters);
      const candidateFiles = await listEpisodeFiles(normalizedFilters.year);
      const episodes: EpisodeRecord[] = [];

      for (const filePath of candidateFiles) {
        const episode = await readEpisodeFile(filePath);

        if (normalizedFilters.skill && episode.skill !== normalizedFilters.skill) {
          continue;
        }

        if (normalizedFilters.outcome && episode.outcome !== normalizedFilters.outcome) {
          continue;
        }

        episodes.push(episode);
      }

      const sorted = episodes.sort((left, right) => right.timestamp.localeCompare(left.timestamp));

      return normalizedFilters.limit ? sorted.slice(0, normalizedFilters.limit) : sorted;
    },

    async readWorkingMemory() {
      const { currentSession, lastError, sessionEnd } = await readWorkingFiles();

      return {
        currentSession: currentSession.value,
        lastError: lastError.value,
        sessionEnd: sessionEnd.value
      };
    },

    async writeCurrentSession(session) {
      const validated =
        session === null ? null : validateInput(CurrentSessionSchema, session, "Current session payload is invalid.");
      return writeWorkingValue(currentSessionPath(), CurrentSessionFileSchema, validated);
    },

    async writeLastError(error) {
      const validated = error === null ? null : validateInput(LastErrorSchema, error, "Last error payload is invalid.");
      return writeWorkingValue(lastErrorPath(), LastErrorFileSchema, validated);
    },

    async writeSessionEnd(snapshot) {
      const validated =
        snapshot === null ? null : validateInput(SessionEndSchema, snapshot, "Session end payload is invalid.");
      return writeWorkingValue(sessionEndPath(), SessionEndFileSchema, validated);
    },

    async clearWorkingMemory() {
      await Promise.all([
        writeWorkingValue(currentSessionPath(), CurrentSessionFileSchema, null),
        writeWorkingValue(lastErrorPath(), LastErrorFileSchema, null),
        writeWorkingValue(sessionEndPath(), SessionEndFileSchema, null)
      ]);
    }
  };
}
