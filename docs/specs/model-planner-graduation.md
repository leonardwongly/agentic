# Model Planner Graduation Criteria

This document defines the thresholds and process for graduating the model-backed planner from feature-flagged to default-enabled.

## Current State

The model planner is gated behind `AGENTIC_MODEL_PLANNER=true`. When disabled (default), the orchestrator uses deterministic scenario matching via `detectScenarioRegex()`.

## Graduation Thresholds

Before enabling the model planner by default, the following criteria must be met:

### Quality Metrics

| Metric | Threshold | Measurement |
|--------|-----------|-------------|
| Planner success rate | ≥95% | `scripts/model-eval.ts` passes all cases |
| Capability compliance | 100% | All tasks stay within agent allowlist |
| Fallback safety | 100% | Failed plans fall back to deterministic catalog |
| Schema validity | 100% | All model outputs parse as valid Task arrays |

### Performance Metrics

| Metric | Threshold | Notes |
|--------|-----------|-------|
| P95 latency | ≤5s | Model call + parsing time |
| Token usage | ≤2000 tokens/plan | Input + output combined |
| Error rate | ≤5% | Transient failures that trigger fallback |

### Safety Metrics

| Metric | Threshold | Notes |
|--------|-----------|-------|
| Escalation attempts | 0 | Model never requests capabilities beyond task allowlist |
| Policy violations | 0 | All plans pass governance gates |
| Hallucination rate | ≤1% | Tasks reference non-existent agents/capabilities |

## Evaluation Process

### Staging Validation

1. Deploy to staging with `AGENTIC_MODEL_PLANNER=true`
2. Run `scripts/model-eval.ts` against live provider
3. Collect metrics over 7-day observation window
4. Verify all thresholds met

### Production Rollout

1. Enable via `AGENTIC_MODEL_PLANNER=true` in production
2. Monitor telemetry for `planner.model.*` events
3. Track fallback rate (should be <5%)
4. Review any policy violations in audit log

### Kill Switch

If issues arise, disable immediately:

```bash
wrangler secret put AGENTIC_MODEL_PLANNER false
```

Or via environment variable:

```bash
export AGENTIC_MODEL_PLANNER=false
```

The deterministic catalog remains available as fallback at all times.

## Evidence Requirements

Before graduation, capture:

- [ ] `model-eval.ts` output showing all checks pass
- [ ] 7-day telemetry summary with latency/error distributions
- [ ] Audit log review confirming no policy violations
- [ ] Cost analysis showing token usage within budget

## Related Issues

- [#1006](https://github.com/leonardwongly/agentic/issues/1006) — Parent tracking issue
- [#1011](https://github.com/leonardwongly/agentic/issues/1011) — Tier tracking roadmap

## Revision History

| Date | Version | Notes |
|------|---------|-------|
| 2026-09-05 | 1.0 | Initial graduation criteria defined |
