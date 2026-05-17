# Selected Production Wedge Quality Gates

`LEO-137` closes the gap between "selected production wedge" branding and an actual release-quality evaluation suite. The gate in [`packages/observability/src/wedge-quality-gates.ts`](https://github.com/leonardwongly/agentic/blob/main/packages/observability/src/wedge-quality-gates.ts) evaluates only the two selected Phase 3 wedges:

- `communications_execution`
- `scheduling_execution`

Everything else stays out of scope on purpose. Supporting wedges can still exist, but they do not count as evidence that the selected production wedges are healthy.

## Inputs and trust boundaries

- Trusted after validation:
  - persisted [`GoalBundle`](https://github.com/leonardwongly/agentic/blob/main/packages/contracts/src/index.ts) state
  - persisted approval [`EvidenceRecord`](https://github.com/leonardwongly/agentic/blob/main/packages/contracts/src/index.ts) state
  - artifact `metadata.executionMode` written by the runtime
- Untrusted:
  - operator assumptions about wedge readiness
  - client-side claims about success, coverage, or correction quality

The gate is intentionally server-derived and fail-closed. If the selected wedges do not have enough samples, they are not treated as production-ready.

## Metrics

Each selected wedge is evaluated on five metrics:

1. `workflow_completion_rate`
2. `governed_specialist_coverage_rate`
3. `approval_to_success_rate`
4. `correction_rate`
5. `post_approval_failure_rate`

The evaluator derives them from persisted bundles and approval evidence:

- workflow completion comes from `goal.status`
- governed-specialist coverage comes from persisted artifact `executionMode`
- approval-to-success comes from approved evidence whose resulting task state is `completed`
- correction rate comes from rejected approval evidence
- post-approval failure rate comes from approved evidence whose resulting task state is `failed` or `blocked`

## Release thresholds

The default manifest is `defaultSelectedProductionWedgeQualityManifest`.

Blocking thresholds:

- workflow completion rate `>= 0.80` with at least `3` wedge bundles
- governed-specialist coverage rate `>= 1.00` with at least `3` wedge bundles
- approval-to-success rate `>= 0.75` with at least `2` approved decisions
- correction rate `<= 0.25` with at least `2` feedback records
- post-approval failure rate `<= 0.15` with at least `2` approved decisions

Why these thresholds:

- completion makes sure the wedge actually finishes workflows
- governed-specialist coverage prevents silent regression back to scaffolds
- approval-to-success and post-approval failure protect the side-effect boundary
- correction rate measures operator pain rather than only raw task completion

## Fail-closed behavior

Insufficient samples are treated as a failed gate, not a pass with missing data. This is deliberate:

- a wedge with only one good run is not a production wedge
- a wedge with no approval evidence cannot claim safe end-to-end execution
- supporting wedges do not backfill the selected production wedge thresholds

## Correction actions

Every threshold carries an explicit correction action. Use them as the first response playbook when a gate fails:

- low completion: inspect blocked or failed bundles and simplify decomposition
- low governed-specialist coverage: trace scaffold/manual-review artifacts back to the runner
- low approval-to-success: inspect approved executions that did not complete and repair adapter or recovery semantics
- high correction rate: sample rejected approvals and improve planning/preview quality
- high post-approval failure rate: treat the failures as rollout blockers and repair the recovery path before replaying

## Validation

Focused regression coverage for the evaluator lives in:

- [`tests/wedge-quality-gates.test.ts`](https://github.com/leonardwongly/agentic/blob/main/tests/wedge-quality-gates.test.ts)
- [`tests/agent-metrics.test.ts`](https://github.com/leonardwongly/agentic/blob/main/tests/agent-metrics.test.ts)
- [`tests/orchestrator.test.ts`](https://github.com/leonardwongly/agentic/blob/main/tests/orchestrator.test.ts)

Recommended validation commands:

```bash
npx vitest run tests/wedge-quality-gates.test.ts tests/agent-metrics.test.ts tests/orchestrator.test.ts
npm run build -w @agentic/web
```
