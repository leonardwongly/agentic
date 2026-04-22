# Learning Flywheel Closeout

Date: 2026-04-22

Scope:
- `LEO-169` `F13-T3 Feed proven learning signals into autonomy policy only after replay validation`
- `LEO-170` `F13-T4 Track recommendation precision, drift, and failure cost over time`
- `LEO-118` `F13 Turn outcome traces into a compounding learning flywheel`

## Summary

The remaining `lane:learning-flywheel` gaps are now closed in the repo. The policy path consumes learning only after replay validation, operators can inspect a replay comparison report before widening autonomy, rollback and kill-switch controls are verified, and recommendation quality is now tracked through precision, recall proxy, negative outcome rate, and failure cost metrics with dashboards, alerts, and regression coverage.

## LEO-169 Evidence

### Threshold Definitions

The learning-to-policy promotion boundary is now defined by workspace governance and enforced by the policy engine:

- `shadowReplayPolicy.minimumMatchedEpisodes`
- `shadowReplayPolicy.minimumPrecision`
- `shadowReplayPolicy.maximumNegativeOutcomeRate`
- `shadowReplayPolicy.maximumFailureCostRate`
- `shadowReplayPolicy.promotionMode`
- `shadowReplayPolicy.rollbackOutcome`

Relevant implementation:

- `packages/contracts/src/index.ts`
- `packages/policy/src/index.ts`
- `apps/web/app/api/memory/recommendations/route.ts`
- `docs/runbooks/workflow-recommendations.md`

Enforcement behavior:

- replay validation must exist before learned `R3` autonomy can widen
- replay evidence must satisfy matched-episode, precision, negative-outcome, and failure-cost thresholds
- `promotionMode=shadow_only` keeps the path approval-gated
- `promotionMode=disabled` activates the learning kill switch
- `rollbackOutcome` determines whether the fallback becomes `allowed_with_confirmation` or `downgrade_to_draft`

### Replay Comparison Report

The recommendations API now returns a promotion-evidence packet when the request includes goal context:

- `workspaceId`
- `autonomyBudget`
- `safeRecallProxy`
- `learningValidation`
- `shadowReplayReadiness`
- `comparison`

This powers the dashboard evidence block that shows:

- promotion mode
- rollback mode
- replay readiness
- baseline decision without learning
- influenced decision with learning
- replay threshold summary

Relevant implementation:

- `apps/web/app/api/memory/recommendations/route.ts`
- `apps/web/lib/workflow-recommendations.ts`
- `apps/web/components/dashboard.tsx`

Validation command:

```bash
npx vitest run tests/recommendations-route.test.ts -t "returns a replay comparison report for policy promotion when goal context is provided" --reporter=verbose
```

Observed output:

```text
✓ tests/recommendations-route.test.ts > workflow recommendations route > returns a replay comparison report for policy promotion when goal context is provided
Test Files  1 passed (1)
Tests       1 passed | 4 skipped (5)
```

### Rollback Control Verification

Shadow-only hold behavior and kill-switch rollback behavior are both covered by policy regression tests.

Validation command:

```bash
npx vitest run tests/policy.test.ts -t "keeps approval required when governance holds learning promotion in shadow-only mode|downgrades to draft when the learning kill switch is active and rollback is configured to draft" --reporter=verbose
```

Observed output:

```text
✓ tests/policy.test.ts > policy > keeps approval required when governance holds learning promotion in shadow-only mode
✓ tests/policy.test.ts > policy > downgrades to draft when the learning kill switch is active and rollback is configured to draft
Test Files  1 passed (1)
Tests       2 passed | 26 skipped (28)
```

## LEO-170 Evidence

### KPI Definitions

The recommendation quality KPIs now tracked in code and observability config are:

- `product.learning.recommendation.safe_precision`
- `product.learning.recommendation.safe_recall_proxy`
- `product.learning.recommendation.negative_outcome_rate`
- `product.learning.recommendation.failure_cost_rate`
- `product.learning.recommendation.feedback.total`
- `product.learning.recommendation.feedback.score`

Recall proxy is computed as:

- safe reusable patterns surfaced as suggestions divided by all safe reusable patterns observed in replay

Relevant implementation:

- `packages/self-improvement-memory/src/index.ts`
- `apps/web/app/api/memory/recommendations/route.ts`
- `apps/web/app/api/goals/[id]/recommendations/feedback/route.ts`

### Dashboard Report

The rollout dashboard now contains a dedicated `learning-flywheel` section with panels for:

- recommendation safe precision p95
- recommendation safe recall proxy p95
- recommendation negative outcome rate p95
- recommendation failure cost rate p95
- recommendation feedback outcomes
- recommendation feedback score p95

Alert thresholds now include:

- safe precision floor `>= 0.75`
- safe recall proxy floor `>= 0.5`
- negative outcome ceiling `<= 0.2`
- failure cost ceiling `<= 0.15`
- rejected or overridden recommendation spike ceiling `<= 5`

Relevant implementation:

- `config/observability/dashboard.json`
- `config/observability/alerts.json`
- `docs/runbooks/workflow-recommendations.md`

This document serves as the required dashboard report artifact for `LEO-170`.

### Synthetic Drift Test Output

The replay analytics suite now explicitly covers both recall-proxy degradation and autonomy-promotion replay validation.

Validation command:

```bash
npx vitest run tests/self-improvement-memory.test.ts -t "tracks a safe recall proxy for reusable patterns that stay guarded|replay-validates only stable recommendation evidence before autonomy promotion" --reporter=verbose
```

Observed output:

```text
✓ tests/self-improvement-memory.test.ts > recommendation replay analytics > tracks a safe recall proxy for reusable patterns that stay guarded
✓ tests/self-improvement-memory.test.ts > recommendation replay analytics > replay-validates only stable recommendation evidence before autonomy promotion
Test Files  1 passed (1)
Tests       2 passed | 16 skipped (18)
```

## LEO-118 Parent Closeout

Child task status after this pass:

- `LEO-167` done already
- `LEO-168` done already
- `LEO-169` repo implementation and closeout evidence complete
- `LEO-170` repo implementation and closeout evidence complete

Definition-of-done coverage:

- selected workflows can retrieve precedent-backed recommendations
- operators can review and provide feedback on recommendation-backed suggestions
- learning signals only influence autonomy after replay validation and kill-switch support
- recommendation quality is measurable and reviewed as an operational metric

## Full Verification

Focused verification:

```bash
npx vitest run tests/self-improvement-memory.test.ts tests/recommendations-route.test.ts tests/workflow-recommendations-ui.test.ts
```

Observed result:

```text
Test Files  3 passed (3)
Tests       26 passed (26)
```

Broader regression verification:

```bash
npx vitest run tests/policy.test.ts tests/governance-route.test.ts tests/governance-simulate-route.test.ts tests/recommendation-feedback-route.test.ts tests/dashboard-operations.test.ts tests/dashboard-operations-sections.test.tsx tests/goal-detail-panel.test.tsx tests/repository.test.ts tests/route-user-scope.test.ts tests/orchestrator.test.ts tests/recommendations-route.test.ts tests/self-improvement-memory.test.ts tests/workflow-recommendations-ui.test.ts
```

Observed result:

```text
Test Files  13 passed (13)
Tests       143 passed | 8 skipped (151)
```

Build verification:

```bash
npm run build
```

Observed result:

```text
Next.js production build completed successfully
worker TypeScript build completed successfully
```
