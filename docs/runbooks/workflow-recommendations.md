# Workflow Recommendations

`LEO-167` materializes reusable workflow recommendations from persisted self-improvement outcome traces without exposing raw episode provenance to callers.

## Boundary

Inputs:
- persisted self-improvement episodes
- normalized recommendation traces
- normalized outcome-link evidence
- authenticated query parameters

Outputs:
- aggregated reusable workflow recommendations
- replay-safety summary metrics
- strict authenticated JSON with no-store cache headers

Trust levels:
- HTTP query input is untrusted and validated at the route boundary
- persisted self-improvement state is trusted only after schema validation
- raw episode provenance is internal-only and must not be returned to callers

## How Recommendations Are Derived

1. The orchestrator captures recommendation traces and outcome links into self-improvement episodes.
2. `deriveRecommendationInsights(...)` groups those episodes by recommendation key and scores them using:
   - evidence count
   - approval outcomes
   - execution outcomes
   - rejections
   - user corrections
   - average confidence
3. `deriveWorkflowRecommendations(...)` converts those insights into reusable operator-facing guidance:
   - `suggest_reuse`
   - `require_approval`
   - `require_review`
   - `keep_draft_only`
4. `/api/memory/recommendations` exposes only aggregated evidence plus route-level summary data.

## Route

Authenticated endpoint:

`GET /api/memory/recommendations`

Supported query parameters:
- `kind`
- `agent`
- `action`
- `riskClass`
- repeated `capability`
- `goalTitle` with `goalConfidence`
- `replayMode`
- `minimumEvidence`
- `lowConfidenceThreshold`
- `automationThreshold`
- `minimumScore`
- `limit`
- `includeDraftOnly`

Example:

```text
/api/memory/recommendations?agent=communications&capability=send&minimumEvidence=3&goalTitle=Ship%20a%20reviewed%20response&goalConfidence=0.81
```

## Operator Suggestions

`LEO-168` surfaces recommendation-backed suggestions directly inside the live dashboard goal cards before any broader reuse or auto-application happens.

Operator surface:
- `apps/web/components/dashboard.tsx`
- goal cards in the `Request work` section

Goal-card behavior:
1. The dashboard derives a recommendation query from the first eligible task with explicit tool capabilities.
2. Specialist-owned tasks are preferred over the generic `workflow` agent.
3. The client fetches `/api/memory/recommendations` with:
   - `kind=execution_path`
   - `agent`
   - repeated `capability`
   - optional `riskClass`
   - `minimumEvidence=3`
   - `limit=3`
4. Each eligible active goal shows:
   - recommendation reuse posture
   - agent/action/capability summary
   - rationale
   - evidence count, success rate, and score
   - replay-comparison evidence showing:
     - promotion mode
     - rollback mode
     - replay readiness
     - baseline policy decision vs learning-influenced policy decision
5. Operators can record one of four outcomes:
   - `accepted`
   - `edited`
   - `ignored`
   - `rejected`

Feedback route:

`POST /api/goals/[id]/recommendations/feedback`

Route guarantees:
- requires an authenticated API session
- checks goal ownership at the boundary via `getGoalBundleForUser(...)`
- validates the recommendation snapshot and decision strictly
- records a goal-scoped `goal.recommendation_feedback` action log
- returns a fresh dashboard snapshot so the operator shell stays in sync

`edited` behavior:
- records the feedback event first
- seeds the goal refinement input with a recommendation-aware refinement prompt
- still requires an explicit operator refinement submit before the goal changes

## Safety Rules

- The route requires a valid API session before reading self-improvement state.
- Query parameters are strictly validated and fail closed on invalid values.
- Returned payloads omit `sourceGoalId`, `sourceTaskId`, raw episode text, and any unbounded metadata.
- Draft-only patterns stay hidden unless the caller explicitly opts into `includeDraftOnly=true`.

## Learning Promotion Rules

`LEO-169` adds an explicit promotion boundary between recommendation evidence and live autonomy.

Workspace governance controls live under `shadowReplayPolicy`:
- `promotionMode=validated_autonomy`
- `promotionMode=shadow_only`
- `promotionMode=disabled`
- `rollbackOutcome=allowed_with_confirmation`
- `rollbackOutcome=downgrade_to_draft`

Promotion rules:
1. Replay-derived learning never widens live autonomy until the relevant path has replay validation attached.
2. R3 learning promotion requires:
   - strong approval-history trust
   - a strong execution scorecard
   - replay validation present
   - replay validation passing
   - workspace shadow replay thresholds passing when the workspace widens autonomy to R3
3. `shadow_only` keeps collecting evidence, but the policy engine will not widen live autonomy.
4. `disabled` is the hard kill switch. It blocks learning-backed widening immediately without deleting the underlying evidence.
5. If promotion is blocked, the policy engine falls back according to `rollbackOutcome`:
   - `allowed_with_confirmation` keeps the task on the approval path
   - `downgrade_to_draft` forces draft-only execution

Comparison workflow:
1. Use `comparePolicyWithAndWithoutLearning(...)` to compare the baseline decision against the learning-influenced decision.
2. Treat any promotion without replay validation as a defect.
3. Treat any rollback triggered by drift, failure cost, or the kill switch as expected defensive behavior.
4. The dashboard recommendation panel now surfaces the same comparison packet returned by `GET /api/memory/recommendations`, so operators can inspect promotion state before accepting reuse guidance.

## Quality Metrics And Review Cadence

`LEO-170` tracks recommendation quality in two layers.

Replay analytics from `GET /api/memory/recommendations` emit:
- `product.learning.recommendation.safe_precision`
- `product.learning.recommendation.safe_recall_proxy`
- `product.learning.recommendation.negative_outcome_rate`
- `product.learning.recommendation.failure_cost_rate`

Operator feedback from `POST /api/goals/[id]/recommendations/feedback` emit:
- `product.learning.recommendation.feedback.total`
- `product.learning.recommendation.feedback.evidence_count`
- `product.learning.recommendation.feedback.score`
- `product.learning.recommendation.feedback.negative_rate`

Operational review cadence:
1. Review the learning-flywheel dashboard at least once every 14 days.
2. Review immediately if rejected or overridden recommendation feedback spikes.
3. Investigate safe-recall-proxy decay even when precision remains high; this usually means the system is getting too conservative or the safe pattern inventory is drifting out of scope.
4. Pause promotion by switching `promotionMode` to `shadow_only` or `disabled` when precision decays or failure cost rises materially.
5. Only restore `validated_autonomy` after replay validation returns to threshold and the degraded slice has been inspected.

Remediation playbook:
1. Identify the affected agent, action, and risk class from the dashboard panels.
2. Compare the policy decision with and without learning influence to confirm whether learning is widening the path incorrectly.
3. Check whether safe recall proxy has collapsed; if so, inspect whether safe patterns are being over-guarded rather than misclassified as unsafe.
4. Move governance to `shadow_only` or `disabled` if live widening is unsafe.
5. Re-sample the underlying outcome traces, looking for drift, false positives, corrections, post-approval failures, and safe patterns that are no longer being surfaced.
6. Tighten thresholds or prune the noisy recommendation slice before re-enabling validated autonomy.

## Validation

Run:

```bash
npx vitest run tests/self-improvement-memory.test.ts tests/recommendations-route.test.ts tests/recommendation-feedback-route.test.ts tests/workflow-recommendations-ui.test.ts tests/dashboard-execution-mode-filter.test.tsx
npm run build -w @agentic/web
```

This covers:
- happy-path recommendation derivation
- capability and agent filtering
- draft-only fail-closed behavior
- invalid query rejection
- authenticated route behavior
- goal-scoped operator feedback persistence
- fail-closed dashboard rendering for eligible goals before fetch completion
