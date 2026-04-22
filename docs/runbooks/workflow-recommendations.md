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
- `replayMode`
- `minimumEvidence`
- `lowConfidenceThreshold`
- `automationThreshold`
- `minimumScore`
- `limit`
- `includeDraftOnly`

Example:

```text
/api/memory/recommendations?agent=communications&capability=send&minimumEvidence=3
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
