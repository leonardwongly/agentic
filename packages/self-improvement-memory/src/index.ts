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
export const EpisodeProvenanceSchema = z
  .object({
    ownerUserId: z.string().trim().min(1).max(120).nullable().default(null),
    workspaceId: z.string().trim().min(1).max(120).nullable().default(null),
    source: z.enum(["goal", "approval", "execution", "feedback", "replay"]).default("goal"),
    memoryIds: z.array(boundedString(160)).max(50).default([]),
    actionLogIds: z.array(boundedString(160)).max(50).default([]),
    evidenceRecordIds: z.array(boundedString(160)).max(50).default([]),
    recommendationKeys: z.array(boundedString(200)).max(20).default([])
  })
  .strict();
export const EpisodePrivacySchema = z
  .object({
    sensitivity: z.string().trim().min(1).max(80).default("internal"),
    retention: z
      .object({
        policy: z.string().trim().min(1).max(120).default("learning-outcome-365d"),
        reviewAt: IsoDateTimeSchema.nullable().default(null),
        expiresAt: IsoDateTimeSchema.nullable().default(null)
      })
      .strict()
      .default({
        policy: "learning-outcome-365d",
        reviewAt: null,
        expiresAt: null
      }),
    redaction: z
      .object({
        applied: z.boolean().default(false),
        fields: z.array(boundedString(120)).max(50).default([]),
        rules: z.array(boundedString(120)).max(20).default([]),
        reason: z.string().trim().max(300).nullable().default(null)
      })
      .strict()
      .default({
        applied: false,
        fields: [],
        rules: [],
        reason: null
      })
  })
  .strict()
  .default({
    sensitivity: "internal",
    retention: {
      policy: "learning-outcome-365d",
      reviewAt: null,
      expiresAt: null
    },
    redaction: {
      applied: false,
      fields: [],
      rules: [],
      reason: null
    }
  });
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
    provenance: EpisodeProvenanceSchema.default({
      ownerUserId: null,
      workspaceId: null,
      source: "goal",
      memoryIds: [],
      actionLogIds: [],
      evidenceRecordIds: [],
      recommendationKeys: []
    }),
    privacy: EpisodePrivacySchema,
    metadata: MetadataSchema.default({})
  })
  .strict();

export const LearningEpisodePrivacySchema = z
  .object({
    datasetId: z.literal("learning-capture-records"),
    userId: boundedString(120),
    workspaceId: z.string().trim().min(1).max(120).nullable().default(null),
    captureSource: z.enum(["goal_bundle", "execution_outcome"]),
    captureAllowed: z.literal(true),
    optOutApplied: z.literal(false),
    consentBasis: z.enum(["system", "derived", "explicit"]),
    retentionDays: z.number().int().min(7).max(3650),
    capturedAt: IsoDateTimeSchema,
    expiresAt: IsoDateTimeSchema,
    exportable: z.literal(true),
    deletable: z.literal(true),
    redacted: z.literal(true)
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
export type EpisodeProvenance = z.infer<typeof EpisodeProvenanceSchema>;
export type EpisodePrivacy = z.infer<typeof EpisodePrivacySchema>;
export type EpisodeRecord = z.infer<typeof EpisodeRecordSchema>;
export type LearningEpisodePrivacy = z.infer<typeof LearningEpisodePrivacySchema>;
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

export function getEpisodeLearningPrivacy(episode: EpisodeRecord): LearningEpisodePrivacy | null {
  if (!episode.metadata || typeof episode.metadata !== "object" || Array.isArray(episode.metadata)) {
    return null;
  }

  const raw = (episode.metadata as Record<string, JsonValue>).learningPrivacy;
  const parsed = LearningEpisodePrivacySchema.safeParse(raw);

  return parsed.success ? parsed.data : null;
}

export function assertEpisodeLearningPrivacyPreflight(
  episode: EpisodeRecord,
  expected?: {
    userId?: string;
    workspaceId?: string | null;
  }
): LearningEpisodePrivacy {
  const privacy = getEpisodeLearningPrivacy(episode);

  if (!privacy) {
    throw new SelfImprovementValidationError(`Episode ${episode.id} is missing learning privacy preflight metadata.`);
  }

  if (expected?.userId && privacy.userId !== expected.userId) {
    throw new SelfImprovementValidationError(`Episode ${episode.id} crosses the expected user boundary.`);
  }

  if ("workspaceId" in (expected ?? {}) && privacy.workspaceId !== (expected?.workspaceId ?? null)) {
    throw new SelfImprovementValidationError(`Episode ${episode.id} crosses the expected workspace boundary.`);
  }

  return privacy;
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
  provenance: {
    episodeIds: string[];
    goalIds: string[];
    taskIds: string[];
    memoryIds: string[];
    actionLogIds: string[];
    evidenceRecordIds: string[];
    graphRootIds: string[];
  };
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
  safeRecallProxy: number;
  cases: RecommendationReplayCase[];
  insights: RecommendationInsight[];
};

export type RecommendationEvidenceFilters = {
  kind?: RecommendationTrace["kind"];
  agent?: string;
  action?: string;
  riskClass?: string;
  capabilities?: string[];
};

export type RecommendationPerformanceWindow = {
  startedAt: string | null;
  endedAt: string | null;
  episodeCount: number;
  consideredEpisodes: number;
  suggestedPatterns: number;
  safeSuggestionPrecision: number;
  safeRecallProxy: number;
  negativeOutcomeRate: number;
  failureCostRate: number;
};

export type RecommendationPerformanceBucket = RecommendationPerformanceWindow & {
  key: string;
  label: string;
};

export type RecommendationPerformanceDrift = {
  status: "improving" | "stable" | "regressing" | "insufficient_data";
  safeSuggestionPrecisionDelta: number;
  safeRecallProxyDelta: number;
  negativeOutcomeRateDelta: number;
  failureCostRateDelta: number;
};

export type RecommendationPerformanceReport = {
  current: RecommendationPerformanceWindow;
  previous: RecommendationPerformanceWindow;
  timeline: RecommendationPerformanceBucket[];
  drift: RecommendationPerformanceDrift;
};

export type PolicyLearningValidation = {
  replayValidated: boolean;
  matchedPatterns: number;
  matchedEpisodes: number;
  suggestedPatterns: number;
  safeSuggestionPrecision: number;
  negativeOutcomeRate: number;
  failureCostRate: number;
  driftStatus: RecommendationPerformanceDrift["status"];
  rationale: string;
};

export type WorkflowRecommendationOperatorAction =
  | "suggest_reuse"
  | "require_approval"
  | "require_review"
  | "keep_draft_only";

export type WorkflowRecommendation = {
  key: string;
  source: "outcome_trace";
  workflow: {
    kind: RecommendationTrace["kind"];
    agent: string;
    action: string;
    riskClass: string | null;
    capabilities: string[];
  };
  reuse: {
    replayMode: RecommendationReplayMode;
    operatorAction: WorkflowRecommendationOperatorAction;
    rationale: string;
  };
  evidence: {
    count: number;
    approvalCount: number;
    successCount: number;
    partialCount: number;
    failureCount: number;
    rejectionCount: number;
    userCorrectionCount: number;
    averageConfidence: number;
    approvalRate: number;
    successRate: number;
    negativeRate: number;
    score: number;
    lastSeenAt: string;
  };
  provenance: RecommendationInsight["provenance"];
};

export type WorkflowRecommendationFilters = {
  kind?: RecommendationTrace["kind"];
  agent?: string;
  action?: string;
  riskClass?: string;
  capabilities?: string[];
  replayMode?: RecommendationReplayMode;
  minimumEvidence?: number;
  lowConfidenceThreshold?: number;
  automationThreshold?: number;
  minimumScore?: number;
  limit?: number;
  includeDraftOnly?: boolean;
};

const WorkflowRecommendationFiltersSchema: z.ZodType<WorkflowRecommendationFilters> = z
  .object({
    kind: RecommendationTraceSchema.shape.kind.optional(),
    agent: boundedString(80).optional(),
    action: boundedString(120).optional(),
    riskClass: z.string().trim().min(1).max(16).optional(),
    capabilities: z.array(boundedString(40)).max(10).optional(),
    replayMode: z.enum(["draft_only", "review_required", "approval_required", "suggest"]).optional(),
    minimumEvidence: z.number().int().min(1).max(100).optional(),
    lowConfidenceThreshold: z.number().min(0).max(1).optional(),
    automationThreshold: z.number().min(0).max(1).optional(),
    minimumScore: z.number().min(0).max(1).optional(),
    limit: z.number().int().min(1).max(50).optional(),
    includeDraftOnly: z.boolean().optional()
  })
  .strict();

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

function normalizeRecommendationCapabilities(capabilities?: string[]): string[] {
  if (!capabilities || capabilities.length === 0) {
    return [];
  }

  return [...new Set(capabilities)].sort((left, right) => left.localeCompare(right));
}

function appendUnique(target: string[], values: Array<string | null | undefined>, limit = 20): void {
  for (const value of values) {
    if (!value || target.includes(value)) {
      continue;
    }

    target.push(value);

    if (target.length >= limit) {
      return;
    }
  }
}

function buildGraphRootIds(params: {
  goalIds: string[];
  taskIds: string[];
  memoryIds: string[];
  actionLogIds: string[];
}): string[] {
  const roots: string[] = [];
  appendUnique(roots, params.goalIds.map((id) => `goal:${id}`), 10);
  appendUnique(roots, params.taskIds.map((id) => `task:${id}`), 10);
  appendUnique(roots, params.memoryIds.map((id) => `memory:${id}`), 10);
  appendUnique(roots, params.actionLogIds.map((id) => `action:${id}`), 10);
  return roots;
}

function matchesRecommendationEvidenceFilters(
  episode: EpisodeRecord,
  filters?: RecommendationEvidenceFilters
): episode is EpisodeRecord & {
  recommendation: RecommendationTrace;
  outcomeLink: OutcomeLink;
} {
  if (!episode.recommendation || !episode.outcomeLink) {
    return false;
  }

  if (!filters) {
    return true;
  }

  if (filters.kind && episode.recommendation.kind !== filters.kind) {
    return false;
  }

  if (filters.agent && episode.recommendation.agent !== filters.agent) {
    return false;
  }

  if (filters.action && episode.recommendation.action !== filters.action) {
    return false;
  }

  if (filters.riskClass && episode.recommendation.riskClass !== filters.riskClass) {
    return false;
  }

  const requiredCapabilities = normalizeRecommendationCapabilities(filters.capabilities);

  if (requiredCapabilities.length > 0) {
    const availableCapabilities = normalizeRecommendationCapabilities(episode.recommendation.capabilities);

    if (!requiredCapabilities.every((capability) => availableCapabilities.includes(capability))) {
      return false;
    }
  }

  return true;
}

function calculateEpisodeFailureCost(episode: EpisodeRecord & { outcomeLink: OutcomeLink }): number {
  let cost = 0;

  if (episode.outcome === "failure" || episode.outcomeLink.executionKind === "failed") {
    cost += 1;
  } else if (episode.outcome === "partial") {
    cost += 0.35;
  }

  if (episode.outcomeLink.approvalDecision === "rejected") {
    cost += 0.35;
  }

  if (episode.outcomeLink.userCorrection) {
    cost += 0.25;
  }

  return clamp(cost, 0, 1);
}

function calculateNegativeOutcomeRate(
  episodes: Array<EpisodeRecord & { outcomeLink: OutcomeLink }>
): number {
  if (episodes.length === 0) {
    return 0;
  }

  const negativeCount = episodes.filter(
    (episode) =>
      episode.outcome === "failure" ||
      episode.outcomeLink.executionKind === "failed" ||
      episode.outcomeLink.approvalDecision === "rejected" ||
      episode.outcomeLink.userCorrection
  ).length;

  return clamp(negativeCount / episodes.length, 0, 1);
}

function calculateSafeRecallProxy(cases: RecommendationReplayCase[]): number {
  const safeCases = cases.filter((item) => item.observedRisk === "safe");

  if (safeCases.length === 0) {
    return 0;
  }

  const suggestedSafeCases = safeCases.filter((item) => item.predictedMode === "suggest").length;
  return clamp(suggestedSafeCases / safeCases.length, 0, 1);
}

function summarizeRecommendationPerformanceWindow(
  episodes: Array<EpisodeRecord & { recommendation: RecommendationTrace; outcomeLink: OutcomeLink }>,
  options?: {
    minimumEvidence?: number;
    lowConfidenceThreshold?: number;
    automationThreshold?: number;
  }
): RecommendationPerformanceWindow {
  if (episodes.length === 0) {
    return {
      startedAt: null,
      endedAt: null,
      episodeCount: 0,
      consideredEpisodes: 0,
      suggestedPatterns: 0,
      safeSuggestionPrecision: 0,
      safeRecallProxy: 0,
      negativeOutcomeRate: 0,
      failureCostRate: 0
    };
  }

  const report = buildRecommendationReplayReport(episodes, options);
  const failureCostRate = clamp(
    episodes.reduce((total, episode) => total + calculateEpisodeFailureCost(episode), 0) / episodes.length,
    0,
    1
  );

  return {
    startedAt: episodes[0]?.timestamp ?? null,
    endedAt: episodes.at(-1)?.timestamp ?? null,
    episodeCount: episodes.length,
    consideredEpisodes: report.consideredEpisodes,
    suggestedPatterns: report.suggestedPatterns,
    safeSuggestionPrecision: report.safeSuggestionPrecision,
    safeRecallProxy: report.safeRecallProxy,
    negativeOutcomeRate: calculateNegativeOutcomeRate(episodes),
    failureCostRate
  };
}

function buildWindowTimestamp(timestampMs: number): string {
  return new Date(timestampMs).toISOString();
}

function classifyRecommendationPerformanceDrift(params: {
  current: RecommendationPerformanceWindow;
  previous: RecommendationPerformanceWindow;
  regressionThreshold: number;
}): RecommendationPerformanceDrift {
  const safeSuggestionPrecisionDelta = clamp(
    params.current.safeSuggestionPrecision - params.previous.safeSuggestionPrecision,
    -1,
    1
  );
  const safeRecallProxyDelta = clamp(params.current.safeRecallProxy - params.previous.safeRecallProxy, -1, 1);
  const negativeOutcomeRateDelta = clamp(params.current.negativeOutcomeRate - params.previous.negativeOutcomeRate, -1, 1);
  const failureCostRateDelta = clamp(params.current.failureCostRate - params.previous.failureCostRate, -1, 1);

  if (params.current.consideredEpisodes === 0 || params.previous.consideredEpisodes === 0) {
    return {
      status: "insufficient_data",
      safeSuggestionPrecisionDelta,
      safeRecallProxyDelta,
      negativeOutcomeRateDelta,
      failureCostRateDelta
    };
  }

  if (
    safeSuggestionPrecisionDelta <= -params.regressionThreshold ||
    safeRecallProxyDelta <= -params.regressionThreshold ||
    negativeOutcomeRateDelta >= params.regressionThreshold ||
    failureCostRateDelta >= params.regressionThreshold
  ) {
    return {
      status: "regressing",
      safeSuggestionPrecisionDelta,
      safeRecallProxyDelta,
      negativeOutcomeRateDelta,
      failureCostRateDelta
    };
  }

  if (
    safeSuggestionPrecisionDelta >= params.regressionThreshold / 2 &&
    safeRecallProxyDelta >= params.regressionThreshold / 2 &&
    negativeOutcomeRateDelta <= -params.regressionThreshold / 2 &&
    failureCostRateDelta <= -params.regressionThreshold / 2
  ) {
    return {
      status: "improving",
      safeSuggestionPrecisionDelta,
      safeRecallProxyDelta,
      negativeOutcomeRateDelta,
      failureCostRateDelta
    };
  }

  return {
    status: "stable",
    safeSuggestionPrecisionDelta,
    safeRecallProxyDelta,
    negativeOutcomeRateDelta,
    failureCostRateDelta
  };
}

function mapReplayModeToOperatorAction(replayMode: RecommendationReplayMode): WorkflowRecommendationOperatorAction {
  switch (replayMode) {
    case "suggest":
      return "suggest_reuse";
    case "approval_required":
      return "require_approval";
    case "review_required":
      return "require_review";
    case "draft_only":
      return "keep_draft_only";
  }
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
      provenance: RecommendationInsight["provenance"];
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
      lastSeenAt: episode.timestamp,
      provenance: {
        episodeIds: [],
        goalIds: [],
        taskIds: [],
        memoryIds: [],
        actionLogIds: [],
        evidenceRecordIds: [],
        graphRootIds: []
      }
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

    appendUnique(existing.provenance.episodeIds, [episode.id], 20);
    appendUnique(existing.provenance.goalIds, [episode.outcomeLink.goalId, episode.recommendation.sourceGoalId], 20);
    appendUnique(existing.provenance.taskIds, [episode.outcomeLink.taskId, episode.recommendation.sourceTaskId], 20);
    appendUnique(existing.provenance.memoryIds, episode.provenance.memoryIds, 20);
    appendUnique(existing.provenance.actionLogIds, episode.provenance.actionLogIds, 20);
    appendUnique(existing.provenance.evidenceRecordIds, episode.provenance.evidenceRecordIds, 20);
    existing.provenance.graphRootIds = buildGraphRootIds(existing.provenance);

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
        }),
        provenance: {
          episodeIds: [...entry.provenance.episodeIds],
          goalIds: [...entry.provenance.goalIds],
          taskIds: [...entry.provenance.taskIds],
          memoryIds: [...entry.provenance.memoryIds],
          actionLogIds: [...entry.provenance.actionLogIds],
          evidenceRecordIds: [...entry.provenance.evidenceRecordIds],
          graphRootIds: [...entry.provenance.graphRootIds]
        }
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
  const safeRecallProxy = calculateSafeRecallProxy(cases);

  return {
    totalEpisodes: episodes.length,
    consideredEpisodes: episodes.filter((episode) => episode.recommendation && episode.outcomeLink).length,
    sparsePatterns: insights.filter((insight) => insight.replayMode === "draft_only").length,
    suggestedPatterns: suggestedCases.length,
    guardedPatterns: insights.filter((insight) => insight.replayMode !== "suggest").length,
    safeSuggestionPrecision,
    safeRecallProxy,
    cases,
    insights
  };
}

export function filterRecommendationEvidenceEpisodes(
  episodes: EpisodeRecord[],
  filters?: RecommendationEvidenceFilters
): Array<EpisodeRecord & { recommendation: RecommendationTrace; outcomeLink: OutcomeLink }> {
  return episodes
    .filter((episode): episode is EpisodeRecord & { recommendation: RecommendationTrace; outcomeLink: OutcomeLink } =>
      matchesRecommendationEvidenceFilters(episode, filters)
    )
    .sort((left, right) => left.timestamp.localeCompare(right.timestamp));
}

export function buildRecommendationPerformanceReport(
  episodes: EpisodeRecord[],
  params?: RecommendationEvidenceFilters & {
    bucketDays?: number;
    bucketCount?: number;
    minimumEvidence?: number;
    lowConfidenceThreshold?: number;
    automationThreshold?: number;
    regressionThreshold?: number;
  }
): RecommendationPerformanceReport {
  const bucketDays = Math.max(1, Math.trunc(params?.bucketDays ?? 7));
  const bucketCount = Math.max(2, Math.trunc(params?.bucketCount ?? 4));
  const regressionThreshold = clamp(params?.regressionThreshold ?? 0.12, 0.01, 1);
  const filteredEpisodes = filterRecommendationEvidenceEpisodes(episodes, params);
  const anchorTimestampMs =
    filteredEpisodes.length > 0 ? Date.parse(filteredEpisodes.at(-1)?.timestamp ?? "") : Date.now();
  const bucketWindowMs = bucketDays * 24 * 60 * 60 * 1000;
  const timeline: RecommendationPerformanceBucket[] = [];

  for (let offset = bucketCount - 1; offset >= 0; offset -= 1) {
    const bucketEndMs = anchorTimestampMs - offset * bucketWindowMs;
    const bucketStartMs = bucketEndMs - bucketWindowMs;
    const windowEpisodes = filteredEpisodes.filter((episode) => {
      const timestampMs = Date.parse(episode.timestamp);
      return Number.isFinite(timestampMs) && timestampMs > bucketStartMs && timestampMs <= bucketEndMs;
    });
    const summary = summarizeRecommendationPerformanceWindow(windowEpisodes, params);

    timeline.push({
      ...summary,
      key: buildWindowTimestamp(bucketEndMs),
      label: `${buildWindowTimestamp(bucketStartMs).slice(0, 10)}..${buildWindowTimestamp(bucketEndMs).slice(5, 10)}`
    });
  }

  const current = timeline.at(-1) ?? summarizeRecommendationPerformanceWindow([], params);
  const previous = timeline.at(-2) ?? summarizeRecommendationPerformanceWindow([], params);

  return {
    current,
    previous,
    timeline,
    drift: classifyRecommendationPerformanceDrift({
      current,
      previous,
      regressionThreshold
    })
  };
}

export function buildPolicyLearningValidation(
  episodes: EpisodeRecord[],
  filters: RecommendationEvidenceFilters,
  options?: {
    bucketDays?: number;
    bucketCount?: number;
    minimumEvidence?: number;
    lowConfidenceThreshold?: number;
    automationThreshold?: number;
    regressionThreshold?: number;
    minimumSafeSuggestionPrecision?: number;
    maximumNegativeOutcomeRate?: number;
    maximumFailureCostRate?: number;
  }
): PolicyLearningValidation {
  const minimumEvidence = Math.max(1, Math.trunc(options?.minimumEvidence ?? 3));
  const minimumSafeSuggestionPrecision = clamp(options?.minimumSafeSuggestionPrecision ?? 0.85, 0, 1);
  const maximumNegativeOutcomeRate = clamp(options?.maximumNegativeOutcomeRate ?? 0.25, 0, 1);
  const maximumFailureCostRate = clamp(options?.maximumFailureCostRate ?? 0.35, 0, 1);
  const filteredEpisodes = filterRecommendationEvidenceEpisodes(episodes, filters);
  const matchedPatterns = new Set(filteredEpisodes.map((episode) => episode.recommendation.key)).size;
  const performance = buildRecommendationPerformanceReport(filteredEpisodes, options);
  const currentWindow = performance.current;

  if (currentWindow.consideredEpisodes < minimumEvidence) {
    return {
      replayValidated: false,
      matchedPatterns,
      matchedEpisodes: filteredEpisodes.length,
      suggestedPatterns: currentWindow.suggestedPatterns,
      safeSuggestionPrecision: currentWindow.safeSuggestionPrecision,
      negativeOutcomeRate: currentWindow.negativeOutcomeRate,
      failureCostRate: currentWindow.failureCostRate,
      driftStatus: performance.drift.status,
      rationale: `Replay validation is still sparse (${currentWindow.consideredEpisodes}/${minimumEvidence} matched episodes).`
    };
  }

  if (performance.drift.status === "regressing") {
    return {
      replayValidated: false,
      matchedPatterns,
      matchedEpisodes: filteredEpisodes.length,
      suggestedPatterns: currentWindow.suggestedPatterns,
      safeSuggestionPrecision: currentWindow.safeSuggestionPrecision,
      negativeOutcomeRate: currentWindow.negativeOutcomeRate,
      failureCostRate: currentWindow.failureCostRate,
      driftStatus: performance.drift.status,
      rationale: "Replay evidence is regressing, so the learning signal stays out of the autonomy policy."
    };
  }

  if (currentWindow.suggestedPatterns === 0) {
    return {
      replayValidated: false,
      matchedPatterns,
      matchedEpisodes: filteredEpisodes.length,
      suggestedPatterns: currentWindow.suggestedPatterns,
      safeSuggestionPrecision: currentWindow.safeSuggestionPrecision,
      negativeOutcomeRate: currentWindow.negativeOutcomeRate,
      failureCostRate: currentWindow.failureCostRate,
      driftStatus: performance.drift.status,
      rationale: "Matched outcome traces have not yet cleared the suggestable replay threshold."
    };
  }

  if (currentWindow.safeSuggestionPrecision < minimumSafeSuggestionPrecision) {
    return {
      replayValidated: false,
      matchedPatterns,
      matchedEpisodes: filteredEpisodes.length,
      suggestedPatterns: currentWindow.suggestedPatterns,
      safeSuggestionPrecision: currentWindow.safeSuggestionPrecision,
      negativeOutcomeRate: currentWindow.negativeOutcomeRate,
      failureCostRate: currentWindow.failureCostRate,
      driftStatus: performance.drift.status,
      rationale: `Replay precision ${currentWindow.safeSuggestionPrecision.toFixed(2)} is below the ${minimumSafeSuggestionPrecision.toFixed(2)} promotion threshold.`
    };
  }

  if (currentWindow.negativeOutcomeRate > maximumNegativeOutcomeRate) {
    return {
      replayValidated: false,
      matchedPatterns,
      matchedEpisodes: filteredEpisodes.length,
      suggestedPatterns: currentWindow.suggestedPatterns,
      safeSuggestionPrecision: currentWindow.safeSuggestionPrecision,
      negativeOutcomeRate: currentWindow.negativeOutcomeRate,
      failureCostRate: currentWindow.failureCostRate,
      driftStatus: performance.drift.status,
      rationale: `Negative outcome rate ${currentWindow.negativeOutcomeRate.toFixed(2)} exceeds the ${maximumNegativeOutcomeRate.toFixed(2)} safety limit.`
    };
  }

  if (currentWindow.failureCostRate > maximumFailureCostRate) {
    return {
      replayValidated: false,
      matchedPatterns,
      matchedEpisodes: filteredEpisodes.length,
      suggestedPatterns: currentWindow.suggestedPatterns,
      safeSuggestionPrecision: currentWindow.safeSuggestionPrecision,
      negativeOutcomeRate: currentWindow.negativeOutcomeRate,
      failureCostRate: currentWindow.failureCostRate,
      driftStatus: performance.drift.status,
      rationale: `Failure cost rate ${currentWindow.failureCostRate.toFixed(2)} exceeds the ${maximumFailureCostRate.toFixed(2)} safety limit.`
    };
  }

  return {
    replayValidated: true,
    matchedPatterns,
    matchedEpisodes: filteredEpisodes.length,
    suggestedPatterns: currentWindow.suggestedPatterns,
    safeSuggestionPrecision: currentWindow.safeSuggestionPrecision,
    negativeOutcomeRate: currentWindow.negativeOutcomeRate,
    failureCostRate: currentWindow.failureCostRate,
    driftStatus: performance.drift.status,
    rationale: `Replay validation passed with precision ${currentWindow.safeSuggestionPrecision.toFixed(2)}, negative rate ${currentWindow.negativeOutcomeRate.toFixed(2)}, and failure cost ${currentWindow.failureCostRate.toFixed(2)}.`
  };
}

export function deriveWorkflowRecommendations(
  episodes: EpisodeRecord[],
  filters?: WorkflowRecommendationFilters
): WorkflowRecommendation[] {
  const normalizedFilters = validateInput(
    WorkflowRecommendationFiltersSchema,
    filters ?? {},
    "Workflow recommendation filters are invalid."
  );
  const requiredCapabilities = normalizeRecommendationCapabilities(normalizedFilters.capabilities);
  const minimumScore = normalizedFilters.minimumScore ?? 0.45;
  const includeDraftOnly = normalizedFilters.includeDraftOnly ?? false;
  const limit = normalizedFilters.limit ?? 10;
  const insights = deriveRecommendationInsights(episodes, {
    minimumEvidence: normalizedFilters.minimumEvidence,
    lowConfidenceThreshold: normalizedFilters.lowConfidenceThreshold,
    automationThreshold: normalizedFilters.automationThreshold
  });

  return insights
    .filter((insight) => {
      if (!includeDraftOnly && insight.replayMode === "draft_only") {
        return false;
      }

      if (normalizedFilters.kind && insight.kind !== normalizedFilters.kind) {
        return false;
      }

      if (normalizedFilters.agent && insight.agent !== normalizedFilters.agent) {
        return false;
      }

      if (normalizedFilters.action && insight.action !== normalizedFilters.action) {
        return false;
      }

      if (normalizedFilters.riskClass && insight.riskClass !== normalizedFilters.riskClass) {
        return false;
      }

      if (normalizedFilters.replayMode && insight.replayMode !== normalizedFilters.replayMode) {
        return false;
      }

      if (requiredCapabilities.length > 0 && !requiredCapabilities.every((capability) => insight.capabilities.includes(capability))) {
        return false;
      }

      if (insight.score < minimumScore) {
        return false;
      }

      return true;
    })
    .slice(0, limit)
    .map((insight) => {
      const successRate = clamp((insight.successCount + insight.partialCount * 0.5) / insight.evidenceCount, 0, 1);
      const approvalRate = clamp(insight.approvalCount / insight.evidenceCount, 0, 1);
      const negativeRate = clamp(
        (insight.failureCount + insight.rejectionCount + insight.userCorrectionCount) / insight.evidenceCount,
        0,
        1
      );

      return {
        key: insight.key,
        source: "outcome_trace",
        workflow: {
          kind: insight.kind,
          agent: insight.agent,
          action: insight.action,
          riskClass: insight.riskClass,
          capabilities: [...insight.capabilities]
        },
        reuse: {
          replayMode: insight.replayMode,
          operatorAction: mapReplayModeToOperatorAction(insight.replayMode),
          rationale: insight.rationale
        },
        evidence: {
          count: insight.evidenceCount,
          approvalCount: insight.approvalCount,
          successCount: insight.successCount,
          partialCount: insight.partialCount,
          failureCount: insight.failureCount,
          rejectionCount: insight.rejectionCount,
          userCorrectionCount: insight.userCorrectionCount,
          averageConfidence: insight.averageConfidence,
          approvalRate,
          successRate,
          negativeRate,
          score: insight.score,
          lastSeenAt: insight.lastSeenAt
        },
        provenance: {
          episodeIds: [...insight.provenance.episodeIds],
          goalIds: [...insight.provenance.goalIds],
          taskIds: [...insight.provenance.taskIds],
          memoryIds: [...insight.provenance.memoryIds],
          actionLogIds: [...insight.provenance.actionLogIds],
          evidenceRecordIds: [...insight.provenance.evidenceRecordIds],
          graphRootIds: [...insight.provenance.graphRootIds]
        }
      } satisfies WorkflowRecommendation;
    });
}

export type ListEpisodesFilters = {
  year?: string;
  skill?: string;
  outcome?: EpisodeOutcome;
  ownerUserId?: string;
  workspaceId?: string;
  includeExpired?: boolean;
  now?: string;
  limit?: number;
};

export type LearningEpisodeScope = {
  userId: string;
  workspaceId: string | null;
};

export type LearningEpisodeRetentionParams = LearningEpisodeScope & {
  now?: string;
};

export type LearningEpisodeDeleteParams = LearningEpisodeScope & {
  now?: string;
  expiredOnly?: boolean;
};

export type LearningEpisodeDeleteResult = {
  userId: string;
  workspaceId: string | null;
  evaluatedAt: string;
  deletedEpisodeCount: number;
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
  exportLearningEpisodes?(scope: LearningEpisodeScope): Promise<EpisodeRecord[]>;
  deleteLearningEpisodes?(params: LearningEpisodeDeleteParams): Promise<LearningEpisodeDeleteResult>;
  enforceLearningRetention?(params: LearningEpisodeRetentionParams): Promise<LearningEpisodeDeleteResult>;
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
    const ownerUserId = normalizeOptionalTrimmedString(filters.ownerUserId);
    const workspaceId = normalizeOptionalTrimmedString(filters.workspaceId);
    const now = normalizeOptionalTrimmedString(filters.now);

    return {
      year: year ? validateInput(YearSchema, year, "Episode year filter is invalid.") : undefined,
      skill,
      outcome: filters.outcome,
      ownerUserId: ownerUserId ? validateInput(boundedString(120), ownerUserId, "Episode owner filter is invalid.") : undefined,
      workspaceId: workspaceId ? validateInput(boundedString(120), workspaceId, "Episode workspace filter is invalid.") : undefined,
      includeExpired: filters.includeExpired ?? false,
      now: now ? validateInput(IsoDateTimeSchema, now, "Episode now filter is invalid.") : undefined,
      limit:
        filters.limit === undefined
          ? undefined
          : Math.max(1, Math.min(500, Math.trunc(validateInput(z.number().finite(), filters.limit, "Episode limit is invalid."))))
    };
  }

  function learningPrivacyMatchesScope(
    privacy: LearningEpisodePrivacy | null,
    scope: LearningEpisodeScope
  ): privacy is LearningEpisodePrivacy {
    return privacy?.userId === scope.userId && privacy.workspaceId === scope.workspaceId;
  }

  function isLearningPrivacyExpired(privacy: LearningEpisodePrivacy, now: string): boolean {
    const expiresAtMs = Date.parse(privacy.expiresAt);
    const nowMs = Date.parse(now);

    return Number.isFinite(expiresAtMs) && Number.isFinite(nowMs) && expiresAtMs <= nowMs;
  }

  async function deleteLearningEpisodes(params: LearningEpisodeDeleteParams): Promise<LearningEpisodeDeleteResult> {
    const normalizedScope = {
      userId: validateInput(boundedString(120), params.userId, "Learning delete user id is invalid."),
      workspaceId: params.workspaceId ? validateInput(boundedString(120), params.workspaceId, "Learning delete workspace id is invalid.") : null
    };
    const evaluatedAt = params.now ?? new Date().toISOString();
    const candidateFiles = await listEpisodeFiles();
    let deletedEpisodeCount = 0;

    for (const filePath of candidateFiles) {
      const episode = await readEpisodeFile(filePath);
      const privacy = getEpisodeLearningPrivacy(episode);

      if (!learningPrivacyMatchesScope(privacy, normalizedScope)) {
        continue;
      }

      assertEpisodeLearningPrivacyPreflight(episode, normalizedScope);

      if (params.expiredOnly && !isLearningPrivacyExpired(privacy, evaluatedAt)) {
        continue;
      }

      await unlink(filePath);
      deletedEpisodeCount += 1;
    }

    return {
      ...normalizedScope,
      evaluatedAt,
      deletedEpisodeCount
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
      let filePath = resolveWithinBase("episodic", year, `${datePrefix}-${slug}.json`);

      if (await pathExists(filePath)) {
        const existingEpisodeAtPath = await readEpisodeFile(filePath);
        if (existingEpisodeAtPath.id !== validated.id) {
          filePath = resolveWithinBase("episodic", year, `${datePrefix}-${slug}-${sanitizeSlug(validated.id)}.json`);
        }
      }

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

        if (normalizedFilters.ownerUserId && episode.provenance.ownerUserId !== normalizedFilters.ownerUserId) {
          continue;
        }

        if (normalizedFilters.workspaceId && episode.provenance.workspaceId !== normalizedFilters.workspaceId) {
          continue;
        }

        if (!normalizedFilters.includeExpired && episode.privacy.retention.expiresAt) {
          const nowMs = Date.parse(normalizedFilters.now ?? new Date().toISOString());
          const expiresAtMs = Date.parse(episode.privacy.retention.expiresAt);

          if (Number.isFinite(nowMs) && Number.isFinite(expiresAtMs) && expiresAtMs <= nowMs) {
            continue;
          }
        }

        episodes.push(episode);
      }

      const sorted = episodes.sort((left, right) => right.timestamp.localeCompare(left.timestamp));

      return normalizedFilters.limit ? sorted.slice(0, normalizedFilters.limit) : sorted;
    },

    async exportLearningEpisodes(scope) {
      const normalizedScope = {
        userId: validateInput(boundedString(120), scope.userId, "Learning export user id is invalid."),
        workspaceId: scope.workspaceId ? validateInput(boundedString(120), scope.workspaceId, "Learning export workspace id is invalid.") : null
      };
      const candidateFiles = await listEpisodeFiles();
      const episodes: EpisodeRecord[] = [];

      for (const filePath of candidateFiles) {
        const episode = await readEpisodeFile(filePath);
        const privacy = getEpisodeLearningPrivacy(episode);

        if (!learningPrivacyMatchesScope(privacy, normalizedScope)) {
          continue;
        }

        assertEpisodeLearningPrivacyPreflight(episode, normalizedScope);
        episodes.push(episode);
      }

      return episodes.sort((left, right) => right.timestamp.localeCompare(left.timestamp));
    },

    async deleteLearningEpisodes(params) {
      return deleteLearningEpisodes(params);
    },

    async enforceLearningRetention(params) {
      return deleteLearningEpisodes({
        ...params,
        expiredOnly: true
      });
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
