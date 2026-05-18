"use client";

import type { Dispatch, SetStateAction } from "react";
import type {
  AutonomyBudget,
  PolicyDecision,
  PolicyReplayValidation
} from "@agentic/contracts";
import type { PolicyLearningInfluenceComparison, PolicyShadowReplayReadiness } from "@agentic/policy";
import type { DashboardData } from "@agentic/repository";
import type { WorkflowRecommendation } from "@agentic/self-improvement-memory";
import type { GoalShareDisclosureReview } from "../lib/share-disclosure";
import {
  formatRecommendationOperatorActionLabel,
  isGoalRecommendationEligible,
  type RecommendationFeedbackDecision
} from "../lib/workflow-recommendations";
import {
  AgentOverride,
  ContextualSuggestion,
  CopyButton,
  CopyableText,
  GoalPreview,
  NoGoalsEmpty,
  RelativeTime,
  StatusBadge,
  formatConfidencePercentage
} from "./ui";

type RequestState = {
  kind: "idle" | "success" | "error";
  message: string;
};

type GoalRecommendationsPolicyPromotion = {
  workspaceId: string;
  autonomyBudget: AutonomyBudget | null;
  safeRecallProxy: number;
  learningValidation: PolicyReplayValidation;
  shadowReplayReadiness: PolicyShadowReplayReadiness;
  comparison: PolicyLearningInfluenceComparison;
} | null;

export type RecommendationLoadState = {
  status: "idle" | "loading" | "ready" | "error";
  query: string | null;
  recommendations: WorkflowRecommendation[];
  policyPromotion: GoalRecommendationsPolicyPromotion;
  error: string | null;
};

type DashboardGoalsCardProps = {
  filteredGoalBundles: DashboardData["goals"];
  totalGoalCount: number;
  request: string;
  setRequest: Dispatch<SetStateAction<string>>;
  selectedAgentId: string | undefined;
  setSelectedAgentId: Dispatch<SetStateAction<string | undefined>>;
  createGoal: () => void;
  generateStartupBriefing: () => Promise<void>;
  isPending: boolean;
  submitState: RequestState;
  shareState: RequestState;
  refinementState: RequestState;
  recommendationState: RequestState;
  lastShareUrl: string | null;
  focusRequestComposer: () => void;
  canManageGoalShares: boolean;
  goalSharePermissionReason: string;
  pendingShareReview: {
    goalId: string;
    goalTitle: string;
    review: GoalShareDisclosureReview;
  } | null;
  shareGoal: (goalId: string, goalTitle: string) => void;
  confirmGoalShare: () => Promise<void>;
  cancelGoalShareReview: () => void;
  saveAsTemplate: (name: string, request: string) => void;
  openGoalDetails?: (goalId: string) => void;
  shareStatsByGoal: Map<string, { total: number; active: number; viewed: number }>;
  highlightedItemId: string | null;
  getItemAnchorId: (itemId: string) => string;
  refinementInputs: Record<string, string>;
  setRefinementInputs: Dispatch<SetStateAction<Record<string, string>>>;
  refineGoal: (goalId: string) => void;
  goalRefinementStateById: Map<string, { allowed: boolean; reason: string | null }>;
  recommendationResultsByGoal: Record<string, RecommendationLoadState>;
  recommendationPendingByGoal: Record<string, boolean>;
  submitRecommendationFeedback: (
    goalId: string,
    recommendation: WorkflowRecommendation,
    decision: RecommendationFeedbackDecision,
    goalTitle: string
  ) => Promise<void>;
};

function formatLearningPromotionMode(mode: NonNullable<AutonomyBudget>["shadowReplay"]["promotionMode"]): string {
  switch (mode) {
    case "validated_autonomy":
      return "Validated autonomy";
    case "shadow_only":
      return "Shadow only";
    case "disabled":
      return "Disabled";
  }
}

function formatLearningRollbackOutcome(
  outcome: NonNullable<AutonomyBudget>["shadowReplay"]["rollbackOutcome"]
): string {
  switch (outcome) {
    case "allowed_with_confirmation":
      return "Approval fallback";
    case "downgrade_to_draft":
      return "Draft fallback";
  }
}

function formatShadowReplayReadinessLabel(status: PolicyShadowReplayReadiness["status"]): string {
  switch (status) {
    case "ready":
      return "Ready";
    case "missing":
      return "Missing validation";
    case "insufficient":
      return "Below threshold";
    case "disabled":
      return "Disabled";
    case "shadow_only":
      return "Shadow only";
    case "not_required":
      return "Not required";
  }
}

function getShadowReplayReadinessTone(
  status: PolicyShadowReplayReadiness["status"]
): "success" | "error" | "warn" | "idle" {
  switch (status) {
    case "ready":
      return "success";
    case "missing":
    case "insufficient":
      return "warn";
    case "disabled":
      return "error";
    case "shadow_only":
    case "not_required":
      return "idle";
  }
}

function formatPolicyDecisionSummary(decision: PolicyDecision): string {
  const approvalLabel = decision.requiresApproval ? "approval required" : "no approval";
  return `${decision.outcome.replaceAll("_", " ")} · ${decision.riskClass} · ${approvalLabel}`;
}

export function DashboardGoalsCard({
  filteredGoalBundles,
  totalGoalCount,
  request,
  setRequest,
  selectedAgentId,
  setSelectedAgentId,
  createGoal,
  generateStartupBriefing,
  isPending,
  submitState,
  shareState,
  refinementState,
  recommendationState,
  lastShareUrl,
  focusRequestComposer,
  canManageGoalShares,
  goalSharePermissionReason,
  pendingShareReview,
  shareGoal,
  confirmGoalShare,
  cancelGoalShareReview,
  saveAsTemplate,
  openGoalDetails,
  shareStatsByGoal,
  highlightedItemId,
  getItemAnchorId,
  refinementInputs,
  setRefinementInputs,
  refineGoal,
  goalRefinementStateById,
  recommendationResultsByGoal,
  recommendationPendingByGoal,
  submitRecommendationFeedback
}: DashboardGoalsCardProps) {
  return (
    <article className="card request-card" id="section-goals">
      <div className="card-header">
        <h2>Request work</h2>
        <span>{filteredGoalBundles.length} / {totalGoalCount} goals</span>
      </div>
      <ContextualSuggestion
        type="goal"
        currentValue={request}
        onApply={(suggestion) => setRequest(suggestion)}
      />
      <textarea
        value={request}
        onChange={(event) => setRequest(event.target.value)}
        placeholder="Example: Clear today’s approvals, surface blocked commitments, and draft replies for anything urgent."
        rows={6}
      />
      <AgentOverride
        value={selectedAgentId}
        onChange={setSelectedAgentId}
        disabled={isPending}
      />
      <div className="hero-button-row">
        <button type="button" className="primary-button" onClick={createGoal} disabled={isPending}>
          Submit request
        </button>
        <button
          type="button"
          className="secondary-button"
          onClick={() => void generateStartupBriefing()}
          disabled={isPending}
        >
          Startup Briefing
        </button>
      </div>
      <p className={`status-chip ${submitState.kind}`}>
        {submitState.message || "Requests are validated, policy checked, and converted into bounded execution bundles before anything runs."}
      </p>
      {shareState.message ? (
        <div className="share-status-row">
          <p className={`status-chip ${shareState.kind}`}>{shareState.message}</p>
          {lastShareUrl ? (
            <>
              <CopyButton value={lastShareUrl} label="Copy" />
              <a className="inline-link" href={lastShareUrl}>
                Open public share page
              </a>
            </>
          ) : null}
        </div>
      ) : null}
      {pendingShareReview ? (
        <section
          className="share-disclosure-review"
          aria-labelledby="share-disclosure-review-title"
          aria-describedby="share-disclosure-review-summary"
        >
          <div className="card-header">
            <div>
              <h3 id="share-disclosure-review-title">Public Share Review</h3>
              <p id="share-disclosure-review-summary">{pendingShareReview.review.summary}</p>
            </div>
            <span className="pill">Expires in {pendingShareReview.review.expiryDays} days</span>
          </div>
          <div className="share-disclosure-grid">
            <div className="list-item vertical">
              <strong>Reviewed goal</strong>
              <p>{pendingShareReview.goalTitle}</p>
            </div>
            <div className="list-item vertical">
              <strong>Hidden fields</strong>
              <p>{pendingShareReview.review.redactedFields.join(", ")}</p>
            </div>
          </div>
          {pendingShareReview.review.sensitiveFindings.length > 0 ? (
            <div className="list-stack">
              {pendingShareReview.review.sensitiveFindings.map((finding) => (
                <div className="list-item vertical" key={`${finding.fieldPath}-${finding.detector}`}>
                  <strong>{finding.label}</strong>
                  <p>{finding.fieldPath} was flagged for operator review before creating an external link.</p>
                  <span className="pill">{finding.severity}</span>
                </div>
              ))}
            </div>
          ) : (
            <p className="status-chip success">No sensitive public fields were detected in the reviewed projection.</p>
          )}
          <div className="list-stack">
            {pendingShareReview.review.dataClasses.map((dataClass) => (
              <div className="list-item vertical" key={dataClass.id}>
                <div>
                  <strong>{dataClass.label}</strong>
                  <p>{dataClass.reason}</p>
                </div>
                <div className="share-tag-row">
                  <span className="pill">{dataClass.disposition.replaceAll("_", " ")}</span>
                  <small>{dataClass.fields.join(", ")}</small>
                </div>
              </div>
            ))}
          </div>
          <div className="hero-button-row">
            <button type="button" className="primary-button" onClick={() => void confirmGoalShare()} disabled={isPending}>
              Create public link
            </button>
            <button type="button" className="secondary-button" onClick={cancelGoalShareReview} disabled={isPending}>
              Cancel
            </button>
          </div>
        </section>
      ) : null}
      {refinementState.message ? (
        <p className={`status-chip ${refinementState.kind}`}>{refinementState.message}</p>
      ) : null}
      {recommendationState.message ? (
        <p className={`status-chip ${recommendationState.kind}`}>{recommendationState.message}</p>
      ) : null}
      <div className="list-stack">
        {filteredGoalBundles.length === 0 ? (
          totalGoalCount === 0 ? (
            <NoGoalsEmpty onCreate={focusRequestComposer} />
          ) : (
            <p className="status-chip idle">No goals match the current execution-mode filter.</p>
          )
        ) : null}
        {filteredGoalBundles.slice(0, 4).map((bundle) => {
          const refinementLogs = bundle.actionLogs.filter((log) => log.kind === "goal.refined");
          const isActive = bundle.goal.status !== "completed";
          const refinementPermission = goalRefinementStateById.get(bundle.goal.id) ?? {
            allowed: true,
            reason: null
          };
          const recommendationStateForGoal = recommendationResultsByGoal[bundle.goal.id];
          const recommendationEligible = isActive && isGoalRecommendationEligible(bundle);
          const recommendationPending = recommendationPendingByGoal[bundle.goal.id] ?? false;

          return (
            <div
              className={`list-item vertical ${highlightedItemId === bundle.goal.id ? "selection-highlight" : ""}`}
              id={getItemAnchorId(bundle.goal.id)}
              key={bundle.goal.id}
            >
              <div>
                <GoalPreview goal={bundle.goal}>
                  <strong>{bundle.goal.title}</strong>
                </GoalPreview>
                <p>{bundle.goal.explanation}</p>
              </div>
              <div className="goal-item-actions">
                <StatusBadge status={bundle.goal.status} />
                <CopyableText value={bundle.goal.id} />
                {openGoalDetails ? (
                  <button
                    type="button"
                    className="secondary-button"
                    onClick={() => openGoalDetails(bundle.goal.id)}
                    disabled={isPending}
                  >
                    Open details
                  </button>
                ) : null}
                <button
                  type="button"
                  className="secondary-button"
                  onClick={() => shareGoal(bundle.goal.id, bundle.goal.title)}
                  disabled={isPending || !canManageGoalShares}
                  title={!canManageGoalShares ? goalSharePermissionReason : undefined}
                >
                  Review share
                </button>
                {bundle.goal.status === "completed" ? (
                  <button
                    type="button"
                    className="secondary-button"
                    onClick={() => saveAsTemplate(bundle.goal.title, bundle.goal.request)}
                    disabled={isPending}
                  >
                    Save as template
                  </button>
                ) : null}
                <small className="share-metric">
                  {shareStatsByGoal.get(bundle.goal.id)?.active ?? 0} active · {shareStatsByGoal.get(bundle.goal.id)?.viewed ?? 0} viewed
                </small>
              </div>
              {refinementLogs.length > 0 ? (
                <div className="refinement-history">
                  {refinementLogs.map((log) => (
                    <small key={log.id} className="refinement-log">{log.message}</small>
                  ))}
                </div>
              ) : null}
              {isActive ? (
                <div className="refinement-row">
                  <input
                    value={refinementInputs[bundle.goal.id] ?? ""}
                    onChange={(event) =>
                      setRefinementInputs((prev) => ({ ...prev, [bundle.goal.id]: event.target.value }))
                    }
                    placeholder="Refine this goal..."
                    maxLength={2000}
                    disabled={isPending || !refinementPermission.allowed}
                    title={!refinementPermission.allowed ? refinementPermission.reason ?? undefined : undefined}
                  />
                  <button
                    type="button"
                    className="secondary-button"
                    onClick={() => refineGoal(bundle.goal.id)}
                    disabled={
                      isPending ||
                      !refinementPermission.allowed ||
                      !(refinementInputs[bundle.goal.id] ?? "").trim()
                    }
                    title={!refinementPermission.allowed ? refinementPermission.reason ?? undefined : undefined}
                  >
                    Refine
                  </button>
                </div>
              ) : null}
              {isActive && !refinementPermission.allowed && refinementPermission.reason ? (
                <small className="operator-product-subtitle">{refinementPermission.reason}</small>
              ) : null}
              {recommendationEligible ? (
                <div className="refinement-history">
                  <strong>Recommendation-backed suggestions</strong>
                  <small className="refinement-log">
                    Outcome traces stay operator-visible before any wider reuse or auto-application.
                  </small>
                  {recommendationStateForGoal?.status === "ready" && recommendationStateForGoal.policyPromotion ? (
                    <div className="list-item vertical">
                      <div className="goal-item-actions">
                        <span
                          className={`status-chip ${getShadowReplayReadinessTone(
                            recommendationStateForGoal.policyPromotion.shadowReplayReadiness.status
                          )}`}
                        >
                          {formatShadowReplayReadinessLabel(
                            recommendationStateForGoal.policyPromotion.shadowReplayReadiness.status
                          )}
                        </span>
                        <span className="status-chip idle">
                          {formatLearningPromotionMode(
                            recommendationStateForGoal.policyPromotion.autonomyBudget?.shadowReplay.promotionMode ??
                              "validated_autonomy"
                          )}
                        </span>
                        <span className="status-chip idle">
                          {formatLearningRollbackOutcome(
                            recommendationStateForGoal.policyPromotion.autonomyBudget?.shadowReplay.rollbackOutcome ??
                              "allowed_with_confirmation"
                          )}
                        </span>
                      </div>
                      <p>{recommendationStateForGoal.policyPromotion.comparison.summary}</p>
                      <small className="refinement-log">
                        Replay precision {formatConfidencePercentage(recommendationStateForGoal.policyPromotion.learningValidation.safeSuggestionPrecision)} ·
                        Recall proxy {formatConfidencePercentage(recommendationStateForGoal.policyPromotion.safeRecallProxy)}
                      </small>
                      <small className="refinement-log">
                        Negative rate {formatConfidencePercentage(recommendationStateForGoal.policyPromotion.learningValidation.negativeOutcomeRate)} ·
                        Failure cost {formatConfidencePercentage(recommendationStateForGoal.policyPromotion.learningValidation.failureCostRate)} ·
                        Drift {recommendationStateForGoal.policyPromotion.learningValidation.driftStatus.replaceAll("_", " ")}
                      </small>
                      <small className="refinement-log">
                        Without learning: {formatPolicyDecisionSummary(recommendationStateForGoal.policyPromotion.comparison.baseline)}
                      </small>
                      <small className="refinement-log">
                        With learning: {formatPolicyDecisionSummary(recommendationStateForGoal.policyPromotion.comparison.influenced)}
                      </small>
                      <small className="refinement-log">
                        {recommendationStateForGoal.policyPromotion.shadowReplayReadiness.summary}
                      </small>
                      {recommendationStateForGoal.policyPromotion.shadowReplayReadiness.thresholdSummary.length > 0 ? (
                        <small className="refinement-log">
                          Thresholds: {recommendationStateForGoal.policyPromotion.shadowReplayReadiness.thresholdSummary.join(" · ")}
                        </small>
                      ) : null}
                    </div>
                  ) : null}
                  {recommendationStateForGoal?.status === "error" ? (
                    <small className="status-chip error">
                      {recommendationStateForGoal.error ?? "Failed to load recommendation history."}
                    </small>
                  ) : null}
                  {recommendationStateForGoal?.status === "ready" &&
                  recommendationStateForGoal.recommendations.length === 0 ? (
                    <small className="refinement-log">No recommendation-backed suggestions yet.</small>
                  ) : null}
                  {recommendationStateForGoal?.status === "ready" &&
                  recommendationStateForGoal.recommendations.length > 0 ? (
                    <div className="list-stack">
                      {recommendationStateForGoal.recommendations.map((recommendation) => (
                        <div key={recommendation.key} className="list-item vertical">
                          <div className="goal-item-actions">
                            <span className="status-chip idle">
                              {formatRecommendationOperatorActionLabel(recommendation.reuse.operatorAction)}
                            </span>
                            <small className="share-metric">
                              {recommendation.workflow.agent} · {recommendation.workflow.action}
                            </small>
                            <RelativeTime date={recommendation.evidence.lastSeenAt} />
                          </div>
                          <p>{recommendation.reuse.rationale}</p>
                          <small className="refinement-log">
                            Capabilities: {recommendation.workflow.capabilities.join(", ")} · Evidence {recommendation.evidence.count} · Success{" "}
                            {formatConfidencePercentage(recommendation.evidence.successRate)} · Score{" "}
                            {formatConfidencePercentage(recommendation.evidence.score)}
                          </small>
                          <div className="goal-item-actions">
                            <button
                              type="button"
                              className="secondary-button"
                              onClick={() =>
                                void submitRecommendationFeedback(bundle.goal.id, recommendation, "accepted", bundle.goal.title)
                              }
                              disabled={isPending || recommendationPending}
                            >
                              Accept
                            </button>
                            <button
                              type="button"
                              className="secondary-button"
                              onClick={() =>
                                void submitRecommendationFeedback(bundle.goal.id, recommendation, "edited", bundle.goal.title)
                              }
                              disabled={isPending || recommendationPending}
                            >
                              Edit
                            </button>
                            <button
                              type="button"
                              className="secondary-button"
                              onClick={() =>
                                void submitRecommendationFeedback(bundle.goal.id, recommendation, "ignored", bundle.goal.title)
                              }
                              disabled={isPending || recommendationPending}
                            >
                              Ignore
                            </button>
                            <button
                              type="button"
                              className="secondary-button"
                              onClick={() =>
                                void submitRecommendationFeedback(bundle.goal.id, recommendation, "rejected", bundle.goal.title)
                              }
                              disabled={isPending || recommendationPending}
                            >
                              Reject
                            </button>
                            <button
                              type="button"
                              className="secondary-button"
                              onClick={() =>
                                void submitRecommendationFeedback(bundle.goal.id, recommendation, "suppressed", bundle.goal.title)
                              }
                              disabled={isPending || recommendationPending}
                            >
                              Suppress
                            </button>
                            <button
                              type="button"
                              className="secondary-button"
                              onClick={() =>
                                void submitRecommendationFeedback(bundle.goal.id, recommendation, "expired", bundle.goal.title)
                              }
                              disabled={isPending || recommendationPending}
                            >
                              Expire
                            </button>
                          </div>
                        </div>
                      ))}
                    </div>
                  ) : null}
                  {!recommendationStateForGoal ||
                  recommendationStateForGoal.status === "idle" ||
                  recommendationStateForGoal.status === "loading" ? (
                    <small className="refinement-log">Loading suggestion history…</small>
                  ) : null}
                </div>
              ) : null}
            </div>
          );
        })}
      </div>
    </article>
  );
}
