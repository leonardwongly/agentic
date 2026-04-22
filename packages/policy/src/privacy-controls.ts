import { privacyOperationKindValues, type PrivacyOperationKind } from "@agentic/contracts";
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
