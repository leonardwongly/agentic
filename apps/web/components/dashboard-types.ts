import type {
  AgentDefinition,
  AutonomyBudget,
  GoalTemplate,
  OperatorProduct,
  OperatorProductSelection,
  PolicyReplayValidation
} from "@agentic/contracts";
import type {
  PolicyLearningInfluenceComparison,
  PolicyShadowReplayReadiness,
  PrivacyControlSummary
} from "@agentic/policy";
import type { DashboardData } from "@agentic/repository";
import type { WorkflowRecommendation } from "@agentic/self-improvement-memory";

export type { PrivacyControlSummary };

export type RequestState = {
  kind: "idle" | "success" | "error";
  message: string;
};

export type PrivacyControlsApiResponse = {
  controls: PrivacyControlSummary;
};

export type OperatorProductPayload = {
  products: OperatorProduct[];
  selection: OperatorProductSelection | null;
  agents: AgentDefinition[];
  templates: GoalTemplate[];
};

export type GoalRecommendationsApiResponse = {
  recommendations: WorkflowRecommendation[];
  summary: {
    totalEpisodes: number;
    matchedEpisodes: number;
    consideredEpisodes: number;
    suggestedPatterns: number;
    guardedPatterns: number;
    sparsePatterns: number;
    safeSuggestionPrecision: number;
    currentSafeRecallProxy: number;
    currentNegativeOutcomeRate: number;
    currentFailureCostRate: number;
    driftStatus: "improving" | "stable" | "regressing" | "insufficient_data";
    returnedCount: number;
  };
  analytics: {
    current: {
      episodeCount: number;
      consideredEpisodes: number;
      suggestedPatterns: number;
      safeSuggestionPrecision: number;
      safeRecallProxy: number;
      negativeOutcomeRate: number;
      failureCostRate: number;
    };
    timeline: Array<{ key: string }>;
  };
  policyPromotion: {
    workspaceId: string;
    autonomyBudget: AutonomyBudget | null;
    safeRecallProxy: number;
    learningValidation: PolicyReplayValidation;
    shadowReplayReadiness: PolicyShadowReplayReadiness;
    comparison: PolicyLearningInfluenceComparison;
  } | null;
  filters: Record<string, unknown>;
};

export type RecommendationFeedbackApiResponse = {
  goalId: string;
  message: string;
  dashboard: DashboardData;
};
