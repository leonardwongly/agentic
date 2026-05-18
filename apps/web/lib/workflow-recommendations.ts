import type { GoalBundle } from "@agentic/contracts";
import type { WorkflowRecommendation, WorkflowRecommendationOperatorAction } from "@agentic/self-improvement-memory";

export type RecommendationFeedbackDecision = "accepted" | "edited" | "rejected" | "ignored" | "suppressed" | "expired";

export type GoalRecommendationContext = {
  agent: string;
  riskClass: string | null;
  capabilities: string[];
  goalTitle: string;
  goalConfidence: number;
};

export type RecommendationRefinementSource = {
  key: string;
  source: "outcome_trace";
  suggestedMessage: string;
};

const RECOMMENDATION_KIND = "execution_path";
const DEFAULT_MINIMUM_EVIDENCE = 3;
const DEFAULT_RECOMMENDATION_LIMIT = 3;
const MAX_CAPABILITIES = 10;

function normalizeCapabilities(capabilities: string[]): string[] {
  const seen = new Set<string>();
  const normalized: string[] = [];

  for (const capability of capabilities) {
    const candidate = capability.trim();

    if (!candidate || seen.has(candidate)) {
      continue;
    }

    seen.add(candidate);
    normalized.push(candidate);

    if (normalized.length >= MAX_CAPABILITIES) {
      break;
    }
  }

  return normalized;
}

function pickRecommendationTask(bundle: GoalBundle) {
  const eligibleTasks = bundle.tasks.filter((task) => normalizeCapabilities(task.toolCapabilities).length > 0);

  return eligibleTasks.find((task) => task.assignedAgent !== "workflow") ?? eligibleTasks[0] ?? null;
}

export function getGoalRecommendationContext(bundle: GoalBundle): GoalRecommendationContext | null {
  const task = pickRecommendationTask(bundle);

  if (!task) {
    return null;
  }

  const capabilities = normalizeCapabilities(task.toolCapabilities);

  if (capabilities.length === 0) {
    return null;
  }

  return {
    agent: task.assignedAgent,
    riskClass: task.riskClass ?? null,
    capabilities,
    goalTitle: bundle.goal.title.trim(),
    goalConfidence: bundle.goal.confidence
  };
}

export function isGoalRecommendationEligible(bundle: GoalBundle): boolean {
  return getGoalRecommendationContext(bundle) !== null;
}

export function buildGoalRecommendationQuery(bundle: GoalBundle): URLSearchParams | null {
  const context = getGoalRecommendationContext(bundle);

  if (!context) {
    return null;
  }

  const query = new URLSearchParams();
  query.set("kind", RECOMMENDATION_KIND);
  query.set("agent", context.agent);
  query.set("minimumEvidence", String(DEFAULT_MINIMUM_EVIDENCE));
  query.set("limit", String(DEFAULT_RECOMMENDATION_LIMIT));
  query.set("goalTitle", context.goalTitle);
  query.set("goalConfidence", String(context.goalConfidence));

  if (context.riskClass) {
    query.set("riskClass", context.riskClass);
  }

  for (const capability of context.capabilities) {
    query.append("capability", capability);
  }

  return query;
}

export function formatRecommendationOperatorActionLabel(action: WorkflowRecommendationOperatorAction): string {
  switch (action) {
    case "suggest_reuse":
      return "Suggest reuse";
    case "require_approval":
      return "Require approval";
    case "require_review":
      return "Require review";
    case "keep_draft_only":
      return "Keep draft only";
  }
}

export function buildRecommendationRefinementInput(
  recommendation: WorkflowRecommendation,
  goalTitle?: string | null
): string {
  const goalLabel = goalTitle?.trim() ? `"${goalTitle.trim()}"` : "this goal";
  const capabilities = recommendation.workflow.capabilities.join(", ");
  const rationale = recommendation.reuse.rationale.trim();

  return [
    `Refine ${goalLabel} to follow the ${recommendation.workflow.agent} ${recommendation.workflow.action} recommendation.`,
    capabilities ? `Preserve the ${capabilities} capability path.` : null,
    rationale ? `Keep this intent in scope: ${rationale}` : null
  ]
    .filter((segment): segment is string => Boolean(segment))
    .join(" ");
}

export function buildRecommendationRefinementSource(
  recommendation: WorkflowRecommendation,
  goalTitle?: string | null
): RecommendationRefinementSource {
  return {
    key: recommendation.key,
    source: recommendation.source,
    suggestedMessage: buildRecommendationRefinementInput(recommendation, goalTitle)
  };
}

export function buildRecommendationFeedbackPayload(
  recommendation: WorkflowRecommendation,
  decision: RecommendationFeedbackDecision,
  notes?: string | null
) {
  const payload: {
    decision: RecommendationFeedbackDecision;
    recommendation: WorkflowRecommendation;
    notes?: string;
  } = {
    decision,
    recommendation
  };
  const normalizedNotes = notes?.trim();

  if (normalizedNotes) {
    payload.notes = normalizedNotes;
  }

  return payload;
}
