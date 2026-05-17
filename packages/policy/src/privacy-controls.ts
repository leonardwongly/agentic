import {
  enterpriseWorkspaceGovernanceDefaults,
  privacyOperationKindValues,
  type ActorContext,
  type GoalBundle,
  type MemoryRecord,
  type PrivacyOperationKind,
  type WorkspaceGovernance
} from "@agentic/contracts";
import { z } from "zod";
import privacyControlRegistrySource from "../../../config/privacy/data-controls.json";

const TokenizationStrategySchema = z.enum(["opaque_identifier", "redacted_reference", "not_applicable"]);

const PrivacyClassificationSchema = z
  .object({
    id: z.string().min(1),
    label: z.string().min(1),
    summary: z.string().min(1)
  })
  .strict();

const PrivacyDatasetSchema = z
  .object({
    id: z.string().min(1),
    title: z.string().min(1),
    classificationId: z.string().min(1),
    productSurfaces: z.array(z.string().min(1)).min(1),
    recordExamples: z.array(z.string().min(1)).min(1),
    codePaths: z.array(z.string().min(1)).min(1),
    minimizationRules: z.array(z.string().min(1)).min(1),
    maskingRules: z.array(z.string().min(1)).min(1),
    tokenizationStrategy: TokenizationStrategySchema,
    retention: z
      .object({
        mode: z.enum(["workspace_governance", "fixed"]),
        defaultDays: z.number().int().min(1).max(3650),
        deletionFlow: z.string().min(1)
      })
      .strict(),
    accessRules: z.array(z.string().min(1)).min(1),
    lifecycleOperations: z.array(z.enum(privacyOperationKindValues)).min(1)
  })
  .strict();

const PrivacyControlRegistrySchema = z
  .object({
    version: z.literal(1),
    reviewedAt: z.string().datetime(),
    owners: z.array(z.string().min(1)).min(1),
    classifications: z.array(PrivacyClassificationSchema).min(1),
    datasets: z.array(PrivacyDatasetSchema).min(1)
  })
  .strict();

export type PrivacyClassification = z.infer<typeof PrivacyClassificationSchema>;
export type PrivacyDataset = z.infer<typeof PrivacyDatasetSchema>;
export type PrivacyControlRegistry = z.infer<typeof PrivacyControlRegistrySchema>;
export type PrivacyTokenizationStrategy = z.infer<typeof TokenizationStrategySchema>;

export const LEARNING_CAPTURE_DATASET_ID = "learning-capture-records" as const;

export type LearningCaptureSource = "goal_bundle" | "execution_outcome";

export type LearningPrivacyMetadata = {
  datasetId: typeof LEARNING_CAPTURE_DATASET_ID;
  userId: string;
  workspaceId: string | null;
  captureSource: LearningCaptureSource;
  captureAllowed: true;
  optOutApplied: false;
  consentBasis: "system" | "derived" | "explicit";
  retentionDays: number;
  capturedAt: string;
  expiresAt: string;
  exportable: true;
  deletable: true;
  redacted: true;
};

export type LearningPrivacyPreflight =
  | {
      allowed: true;
      metadata: LearningPrivacyMetadata;
      memoryRetention: {
        reviewAt: string;
        expiryAt: string;
      };
    }
  | {
      allowed: false;
      reason: string;
      metadata: {
        datasetId: typeof LEARNING_CAPTURE_DATASET_ID;
        userId: string;
        workspaceId: string | null;
        captureSource: LearningCaptureSource;
        captureAllowed: false;
        optOutApplied: true;
        evaluatedAt: string;
      };
    };

type LearningCaptureBoundaryParams = {
  bundle: GoalBundle;
  userId: string;
  actorContext: ActorContext | null;
  executionResultTaskIds?: string[];
};

const SECRET_ASSIGNMENT_PATTERN =
  /\b(api[_-]?key|authorization|bearer|cookie|password|secret|session[_-]?id|token)\b\s*[:=]\s*([^\s,;"')\]}]+)/giu;
const BEARER_TOKEN_PATTERN = /\bBearer\s+[A-Za-z0-9._~+/=-]{12,}/gu;
const EMAIL_PATTERN = /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/giu;
const PRIVATE_KEY_PATTERN = /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/gu;
const SENSITIVE_METADATA_KEY_PATTERN = /\b(api[_-]?key|authorization|cookie|password|secret|session[_-]?id|token)\b/iu;

function addDays(isoTimestamp: string, days: number): string {
  const timestampMs = Date.parse(isoTimestamp);
  const safeTimestampMs = Number.isFinite(timestampMs) ? timestampMs : Date.now();

  return new Date(safeTimestampMs + days * 24 * 60 * 60 * 1000).toISOString();
}

function earliestIso(left: string | null | undefined, right: string): string {
  if (!left) {
    return right;
  }

  const leftMs = Date.parse(left);
  const rightMs = Date.parse(right);

  if (!Number.isFinite(leftMs)) {
    return right;
  }

  if (!Number.isFinite(rightMs)) {
    return left;
  }

  return leftMs <= rightMs ? left : right;
}

function resolveLearningRetentionDays(governance: WorkspaceGovernance | null | undefined): number {
  return Math.max(7, Math.min(3650, governance?.retentionDays ?? enterpriseWorkspaceGovernanceDefaults.retentionDays));
}

function resolveLearningConsentBasis(actorContext: ActorContext | null): LearningPrivacyMetadata["consentBasis"] {
  if (actorContext?.initiator.kind === "human") {
    return "explicit";
  }

  return actorContext ? "derived" : "system";
}

function isLearningCaptureOptedOut(governance: WorkspaceGovernance | null | undefined): boolean {
  const shadowReplayPolicy = governance?.shadowReplayPolicy ?? enterpriseWorkspaceGovernanceDefaults.shadowReplayPolicy;

  return !shadowReplayPolicy.enabled || shadowReplayPolicy.promotionMode === "disabled";
}

function validateLearningCaptureBoundary(params: LearningCaptureBoundaryParams): string | null {
  const { bundle, userId, actorContext } = params;

  if (bundle.goal.userId !== userId) {
    return `Goal ${bundle.goal.id} belongs to a different user.`;
  }

  if (bundle.workflow.goalId !== bundle.goal.id) {
    return `Workflow ${bundle.workflow.id} is not scoped to goal ${bundle.goal.id}.`;
  }

  if ((bundle.workflow.workspaceId ?? null) !== (bundle.goal.workspaceId ?? null)) {
    return `Workflow ${bundle.workflow.id} crosses workspace boundaries.`;
  }

  if (actorContext && actorContext.subjectUserId !== userId) {
    return `Actor context subject ${actorContext.subjectUserId} does not match capture user ${userId}.`;
  }

  const taskIds = new Set(bundle.tasks.map((task) => task.id));
  for (const task of bundle.tasks) {
    if (task.goalId !== bundle.goal.id || task.workflowId !== bundle.workflow.id) {
      return `Task ${task.id} crosses goal or workflow boundaries.`;
    }
  }

  for (const approval of bundle.approvals) {
    if (approval.goalId !== bundle.goal.id || !taskIds.has(approval.taskId)) {
      return `Approval ${approval.id} is not scoped to this goal bundle.`;
    }
  }

  for (const artifact of bundle.artifacts) {
    if (artifact.goalId !== bundle.goal.id || (artifact.taskId && !taskIds.has(artifact.taskId))) {
      return `Artifact ${artifact.id} is not scoped to this goal bundle.`;
    }
  }

  for (const log of bundle.actionLogs) {
    if (log.goalId !== bundle.goal.id || (log.workflowId && log.workflowId !== bundle.workflow.id)) {
      return `Action log ${log.id} is not scoped to this goal bundle.`;
    }
  }

  for (const taskId of params.executionResultTaskIds ?? []) {
    if (!taskIds.has(taskId)) {
      return `Execution result task ${taskId} is not scoped to this goal bundle.`;
    }
  }

  return null;
}

export function redactLearningCaptureText(value: string): string {
  return value
    .replace(PRIVATE_KEY_PATTERN, "[redacted-private-key]")
    .replace(BEARER_TOKEN_PATTERN, "Bearer [redacted-token]")
    .replace(SECRET_ASSIGNMENT_PATTERN, "$1=[redacted-secret]")
    .replace(EMAIL_PATTERN, "[redacted-email]");
}

export function redactLearningCaptureJson(value: unknown, depth = 0): unknown {
  if (depth > 4) {
    return "[redacted-depth-limit]";
  }

  if (typeof value === "string") {
    return redactLearningCaptureText(value);
  }

  if (value === null || typeof value !== "object") {
    return value;
  }

  if (Array.isArray(value)) {
    return value.map((item) => redactLearningCaptureJson(item, depth + 1));
  }

  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>).map(([key, entry]) => [
      key,
      SENSITIVE_METADATA_KEY_PATTERN.test(key) ? "[redacted-secret]" : redactLearningCaptureJson(entry, depth + 1)
    ])
  );
}

export function evaluateLearningPrivacyPreflight(params: {
  bundle: GoalBundle;
  userId: string;
  actorContext: ActorContext | null;
  governance?: WorkspaceGovernance | null;
  source: LearningCaptureSource;
  now?: string;
  executionResultTaskIds?: string[];
}): LearningPrivacyPreflight {
  const evaluatedAt = params.now ?? new Date().toISOString();
  const workspaceId = params.bundle.goal.workspaceId ?? null;
  const boundaryError = validateLearningCaptureBoundary({
    bundle: params.bundle,
    userId: params.userId,
    actorContext: params.actorContext,
    executionResultTaskIds: params.executionResultTaskIds
  });

  if (boundaryError) {
    return {
      allowed: false,
      reason: boundaryError,
      metadata: {
        datasetId: LEARNING_CAPTURE_DATASET_ID,
        userId: params.userId,
        workspaceId,
        captureSource: params.source,
        captureAllowed: false,
        optOutApplied: true,
        evaluatedAt
      }
    };
  }

  if (isLearningCaptureOptedOut(params.governance)) {
    return {
      allowed: false,
      reason: "Workspace learning capture is disabled by shadow replay governance.",
      metadata: {
        datasetId: LEARNING_CAPTURE_DATASET_ID,
        userId: params.userId,
        workspaceId,
        captureSource: params.source,
        captureAllowed: false,
        optOutApplied: true,
        evaluatedAt
      }
    };
  }

  const retentionDays = resolveLearningRetentionDays(params.governance);
  const expiresAt = addDays(evaluatedAt, retentionDays);
  const reviewAt = addDays(evaluatedAt, Math.max(1, Math.floor(retentionDays / 2)));

  return {
    allowed: true,
    metadata: {
      datasetId: LEARNING_CAPTURE_DATASET_ID,
      userId: params.userId,
      workspaceId,
      captureSource: params.source,
      captureAllowed: true,
      optOutApplied: false,
      consentBasis: resolveLearningConsentBasis(params.actorContext),
      retentionDays,
      capturedAt: evaluatedAt,
      expiresAt,
      exportable: true,
      deletable: true,
      redacted: true
    },
    memoryRetention: {
      reviewAt,
      expiryAt: expiresAt
    }
  };
}

export function applyLearningPrivacyToMemoryRecord(
  record: MemoryRecord,
  preflight: Extract<LearningPrivacyPreflight, { allowed: true }>
): MemoryRecord {
  return {
    ...record,
    sensitivity: "learning-redacted",
    content: redactLearningCaptureText(record.content),
    reviewAt: earliestIso(record.reviewAt, preflight.memoryRetention.reviewAt),
    expiryAt: earliestIso(record.expiryAt, preflight.memoryRetention.expiryAt),
    contextPacketConsent: record.contextPacketConsent ?? {
      basis: preflight.metadata.consentBasis,
      grantedBy: record.actorContext?.initiator.userId ?? record.userId,
      grantedAt: preflight.metadata.capturedAt
    }
  };
}

export type PrivacyControlSummary = {
  registryVersion: number;
  reviewedAt: string;
  owners: string[];
  totalDatasets: number;
  classifications: Array<
    PrivacyClassification & {
      datasetCount: number;
    }
  >;
  lifecycleOperations: PrivacyOperationKind[];
  datasets: Array<{
    id: string;
    title: string;
    classificationId: string;
    classificationLabel: string;
    retentionLabel: string;
    tokenizationStrategy: PrivacyTokenizationStrategy;
    productSurfaceCount: number;
    minimizationRuleCount: number;
    maskingRuleCount: number;
    lifecycleOperations: PrivacyOperationKind[];
  }>;
};

function assertUniqueIds(kind: string, values: string[]) {
  const seen = new Set<string>();

  for (const value of values) {
    if (seen.has(value)) {
      throw new Error(`Duplicate privacy ${kind} id: ${value}`);
    }

    seen.add(value);
  }
}

function formatRetentionLabel(dataset: PrivacyDataset): string {
  if (dataset.retention.mode === "workspace_governance") {
    return `${dataset.retention.defaultDays} days default via workspace governance`;
  }

  return `${dataset.retention.defaultDays} days fixed retention`;
}

export function parsePrivacyControlRegistry(raw: unknown): PrivacyControlRegistry {
  const registry = PrivacyControlRegistrySchema.parse(raw);

  assertUniqueIds(
    "classification",
    registry.classifications.map((classification) => classification.id)
  );
  assertUniqueIds(
    "dataset",
    registry.datasets.map((dataset) => dataset.id)
  );

  const classificationIds = new Set(registry.classifications.map((classification) => classification.id));
  for (const dataset of registry.datasets) {
    if (!classificationIds.has(dataset.classificationId)) {
      throw new Error(`Privacy dataset ${dataset.id} references unknown classification ${dataset.classificationId}.`);
    }
  }

  return registry;
}

export function loadPrivacyControlRegistry(): PrivacyControlRegistry {
  return parsePrivacyControlRegistry(privacyControlRegistrySource);
}

export function buildPrivacyControlSummary(registry = loadPrivacyControlRegistry()): PrivacyControlSummary {
  const classificationMap = new Map(registry.classifications.map((classification) => [classification.id, classification]));
  const lifecycleOperations = Array.from(
    new Set(registry.datasets.flatMap((dataset) => dataset.lifecycleOperations))
  ).sort((left, right) => privacyOperationKindValues.indexOf(left) - privacyOperationKindValues.indexOf(right));

  return {
    registryVersion: registry.version,
    reviewedAt: registry.reviewedAt,
    owners: registry.owners,
    totalDatasets: registry.datasets.length,
    classifications: registry.classifications.map((classification) => ({
      ...classification,
      datasetCount: registry.datasets.filter((dataset) => dataset.classificationId === classification.id).length
    })),
    lifecycleOperations,
    datasets: registry.datasets.map((dataset) => ({
      id: dataset.id,
      title: dataset.title,
      classificationId: dataset.classificationId,
      classificationLabel: classificationMap.get(dataset.classificationId)?.label ?? dataset.classificationId,
      retentionLabel: formatRetentionLabel(dataset),
      tokenizationStrategy: dataset.tokenizationStrategy,
      productSurfaceCount: dataset.productSurfaces.length,
      minimizationRuleCount: dataset.minimizationRules.length,
      maskingRuleCount: dataset.maskingRules.length,
      lifecycleOperations: dataset.lifecycleOperations
    }))
  };
}
