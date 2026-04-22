"use client";

import {
  deriveAgentImplementationTier,
  type AgentExecutionMode,
  type ApprovalRequest,
  type Artifact,
  type GoalBundle,
  type Task
} from "@agentic/contracts";
import { Badge, type BadgeVariant } from "./badge";

type ArtifactWithMetadata = Pick<Artifact, "id" | "taskId" | "metadata">;
type TaskWithArtifacts = Pick<Task, "id" | "artifactIds">;
type GoalBundleWithExecutionMetadata = Pick<GoalBundle, "goal" | "tasks" | "artifacts">;
type ApprovalWithExecutionMetadata = Pick<ApprovalRequest, "goalId" | "taskId">;

type ExecutionModePresentation = {
  label: string;
  variant: BadgeVariant;
  description: string;
};

type ImplementationTierPresentation = {
  label: string;
  variant: BadgeVariant;
  description: string;
};

export type ExecutionModeFilterValue = "all" | AgentExecutionMode | "unavailable";

type ExecutionModeFilterOption = {
  value: ExecutionModeFilterValue;
  label: string;
  description: string;
};

const executionModePresentations: Record<AgentExecutionMode, ExecutionModePresentation> = {
  governed_specialist: {
    label: "Governed specialist",
    variant: "success",
    description: "Produced by a selected production wedge with real specialist logic, while any side effect still respects approval and policy gates."
  },
  deterministic_scaffold: {
    label: "Deterministic scaffold",
    variant: "info",
    description: "Produced by a bounded deterministic playbook rather than a production specialist runner."
  },
  custom_prompt_scaffold: {
    label: "Custom prompt scaffold",
    variant: "warning",
    description: "Produced from a saved prompt configuration, but still scaffolded rather than production-run."
  },
  manual_review_required: {
    label: "Manual review required",
    variant: "error",
    description: "The system could not safely execute this result and requires operator review."
  }
};

const unavailableExecutionModePresentation: ExecutionModePresentation = {
  label: "Mode unavailable",
  variant: "muted",
  description: "This surface does not have persisted execution-mode metadata for the artifact yet."
};

const implementationTierPresentations = {
  production: {
    label: "Production",
    variant: "success",
    description: "This result comes from a selected production wedge with a real governed specialist path."
  },
  experimental: {
    label: "Experimental",
    variant: "muted",
    description: "This result is not yet a production specialist path and should be treated as scaffolded or review-first."
  }
} satisfies Record<ReturnType<typeof deriveAgentImplementationTier>, ImplementationTierPresentation>;

const unavailableImplementationTierPresentation: ImplementationTierPresentation = {
  label: "Tier unavailable",
  variant: "muted",
  description: "This surface does not have enough execution metadata to classify the implementation tier."
};

export const executionModeFilterOptions: ExecutionModeFilterOption[] = [
  {
    value: "all",
    label: "All execution modes",
    description: "Show operator records regardless of how the result was produced."
  },
  {
    value: "governed_specialist",
    label: "Governed specialist",
    description: executionModePresentations.governed_specialist.description
  },
  {
    value: "deterministic_scaffold",
    label: "Deterministic scaffold",
    description: executionModePresentations.deterministic_scaffold.description
  },
  {
    value: "custom_prompt_scaffold",
    label: "Custom prompt scaffold",
    description: executionModePresentations.custom_prompt_scaffold.description
  },
  {
    value: "manual_review_required",
    label: "Manual review required",
    description: executionModePresentations.manual_review_required.description
  },
  {
    value: "unavailable",
    label: "Mode unavailable",
    description: unavailableExecutionModePresentation.description
  }
];

function isAgentExecutionMode(value: unknown): value is AgentExecutionMode {
  return typeof value === "string" && value in executionModePresentations;
}

export function extractArtifactExecutionMode(artifact?: Pick<Artifact, "metadata"> | null): AgentExecutionMode | null {
  const candidate = artifact?.metadata?.executionMode;
  return isAgentExecutionMode(candidate) ? candidate : null;
}

export function findTaskExecutionMode(
  task: TaskWithArtifacts,
  artifacts: readonly ArtifactWithMetadata[]
): AgentExecutionMode | null {
  const linkedArtifact =
    artifacts.find((artifact) => artifact.taskId === task.id) ??
    artifacts.find((artifact) => task.artifactIds.includes(artifact.id));

  return extractArtifactExecutionMode(linkedArtifact ?? null);
}

export function getExecutionModePresentation(mode?: AgentExecutionMode | null): ExecutionModePresentation {
  if (!mode) {
    return unavailableExecutionModePresentation;
  }

  return executionModePresentations[mode];
}

export function getImplementationTierPresentation(mode?: AgentExecutionMode | null): ImplementationTierPresentation {
  if (!mode) {
    return unavailableImplementationTierPresentation;
  }

  return implementationTierPresentations[deriveAgentImplementationTier(mode)];
}

export function getExecutionModeFilterOption(filter: ExecutionModeFilterValue): ExecutionModeFilterOption {
  return executionModeFilterOptions.find((option) => option.value === filter) ?? executionModeFilterOptions[0];
}

export function matchesExecutionModeFilter(
  mode: AgentExecutionMode | null | undefined,
  filter: ExecutionModeFilterValue
): boolean {
  if (filter === "all") {
    return true;
  }

  if (filter === "unavailable") {
    return !mode;
  }

  return mode === filter;
}

export function bundleMatchesExecutionModeFilter(
  bundle: GoalBundleWithExecutionMetadata,
  filter: ExecutionModeFilterValue
): boolean {
  if (filter === "all") {
    return true;
  }

  return (
    bundle.tasks.some((task) => matchesExecutionModeFilter(findTaskExecutionMode(task, bundle.artifacts), filter)) ||
    bundle.artifacts.some((artifact) => matchesExecutionModeFilter(extractArtifactExecutionMode(artifact), filter))
  );
}

export function approvalMatchesExecutionModeFilter(
  approval: ApprovalWithExecutionMetadata,
  bundle: GoalBundleWithExecutionMetadata | null | undefined,
  filter: ExecutionModeFilterValue
): boolean {
  if (filter === "all") {
    return true;
  }

  if (!bundle) {
    return matchesExecutionModeFilter(null, filter);
  }

  const task = bundle.tasks.find((candidate) => candidate.id === approval.taskId);
  return matchesExecutionModeFilter(task ? findTaskExecutionMode(task, bundle.artifacts) : null, filter);
}

export function formatConfidencePercentage(confidence: number): string {
  return `${Math.round(confidence * 100)}%`;
}

export function ExecutionModeBadge({ mode }: { mode?: AgentExecutionMode | null }) {
  const presentation = getExecutionModePresentation(mode);

  return (
    <Badge variant={presentation.variant} title={presentation.description}>
      {presentation.label}
    </Badge>
  );
}

export function ImplementationTierBadge({ mode }: { mode?: AgentExecutionMode | null }) {
  const presentation = getImplementationTierPresentation(mode);

  return (
    <Badge variant={presentation.variant} title={presentation.description}>
      {presentation.label}
    </Badge>
  );
}
