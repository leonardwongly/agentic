# Model Enablement

This runbook defines how an operator safely enables the model-backed planner and agent
runners, validates them against a live provider, accepts the results, graduates the
decide-loop off the deterministic catalog fallback, and rolls back.

## Purpose

The orchestrator's decide-loop ships with a deterministic, model-free default: the
`general-coordination` lane plans from a static scenario catalog, and agent runners
return deterministic baselines. A model-backed path exists behind a flag
(`packages/orchestrator/src/model-planner.ts` and the runners in
`packages/agents/src/index.ts`). When enabled and a provider key is configured, the
model may produce the task plan and enrich agent envelopes.

Model output is treated as untrusted. Every model-produced plan is JSON-parsed,
schema-validated, gated through the per-agent capability allowlist, and validated as a
workflow DAG before use. Any failure — unconfigured, disabled, malformed, oversized,
prompt-injection, capability escalation, or invalid DAG — falls back to the
deterministic catalog. This fallback is proven without a live key by
`tests/model-enablement-stub.test.ts`, which injects a deterministic fake model into the
enabled planner and runner and asserts the governance gates hold end-to-end.

This runbook covers the operator-gated step that a stub cannot cover: confirming that a
*real* model produces governed, policy-equivalent output in your environment.

## Safety Model

| Gate | Where | Behaviour on violation |
| --- | --- | --- |
| Feature flag | `AGENTIC_MODEL_PLANNER` + `NODE_ENV` | Disabled path returns the deterministic catalog. |
| Provider configured | `ANTHROPIC_API_KEY` or `OPENAI_API_KEY` | Unconfigured returns the deterministic catalog/baseline. |
| JSON + size limits | model-planner / runners | Malformed or oversized output is rejected; fall back. |
| Plan schema | `ModelPlanSchema` (strict) | Extra keys, bad shapes, unknown agents/capabilities rejected; fall back. |
| Capability allowlist | `assertCapabilitiesWithinAllowlist` | Capability escalation beyond the agent allowlist rejected; fall back. |
| Workflow DAG | `validateWorkflowDag` | A plan that is not a valid DAG is rejected; fall back. |
| Envelope enrichment | strict enrichment schema | The model may only augment assumptions/riskFlags; it cannot change status, confidence, proposed actions, execution mode, or risk gating. |

The model can never escalate capability, escalate risk, or bypass approval. Every
outward side effect still requires explicit human approval downstream.

## Prerequisites

- A provider API key for a model you are authorized to use:
  `ANTHROPIC_API_KEY` (Anthropic, preferred when both are set) or `OPENAI_API_KEY` (OpenAI).
- Optional model id overrides: `ANTHROPIC_MODEL` / `OPENAI_MODEL`. Defaults are real,
  current model identifiers; set these to the model deployed in your environment.
- A non-production environment. Do not enable the model planner directly in production
  before it passes the live eval and the acceptance criteria below.

## Enable In A Non-Production Environment

Set the provider key and turn the flag on. The planner flag is intentionally inert
under `NODE_ENV=test`, so use a non-test runtime (for example `development`).

```bash
export ANTHROPIC_API_KEY=sk-ant-...        # or: export OPENAI_API_KEY=sk-...
export AGENTIC_MODEL_PLANNER=true
export NODE_ENV=development
# Optional: pin the model deployed in your environment.
# export ANTHROPIC_MODEL=claude-3-5-sonnet-latest
# export OPENAI_MODEL=gpt-4o
```

With the flag off (or the key unset), the system runs the deterministic catalog/baseline
path unchanged.

## Run The Live Eval

The opt-in harness scores the enabled planner and the agent runners against the live
provider and asserts policy-equivalence to the deterministic scenario baselines.

```bash
npm run test:eval:model
```

This requires a real provider key. It does not mock the model — it sends prompts to the
configured provider and may incur provider cost.

Without a key it is a safe no-op:

```text
model-eval: skipped — set ANTHROPIC_API_KEY or OPENAI_API_KEY to run live scoring.
```

The harness exits `0` on skip so it can sit in pipelines that lack a key. It is honest
about this: a green run without a key proves nothing about the live model — it only
proves the harness skipped. Live confidence requires a configured key.

## Interpret The Results

The harness prints one line per evaluation.

- `- planner: PASS {…}` — the live model produced a plan that passed schema, the
  per-agent capability allowlist, and DAG validation, and stayed within the allowlist
  (policy-equivalent to the catalog baseline).
- `- planner: FALLBACK — model plan rejected by governance gates; catalog fallback engaged (safe).`
  — the model's plan failed a gate and the planner returned the deterministic catalog.
  This is a safe outcome, not a harness failure, but it means the model did not produce a
  usable governed plan this run. Investigate the prompt/model before graduating.
- `- <case>: PASS {…}` — for each runner golden case: the model engaged (non-empty,
  changed body) while `executionMode`, `confidence`, and capability/risk gating were
  preserved and no capability was escalated.
- `- <case>: FAIL {…}` — the printed check object shows which invariant failed.

A non-zero exit means at least one evaluation failed:

```text
model-eval: N/M evaluations failed
```

A fully green run prints:

```text
model-eval: all M evaluations passed (planner + K runner tasks)
```

## Acceptance Criteria To Graduate Off The Catalog Fallback

Graduate the decide-loop to rely on the model path (rather than treating it as an
opportunistic enhancement over the catalog) only when all of the following hold:

1. `tests/model-enablement-stub.test.ts`, `tests/model-planner.test.ts`, and
   `tests/agent-envelope-runner.test.ts` are green (stub-level governance proof).
2. `npm run test:eval:model` returns `all M evaluations passed` against your configured
   provider — not skipped and not a planner `FALLBACK` — across at least three
   consecutive runs, demonstrating the live model produces governed, policy-equivalent
   output repeatably.
3. No run produces a capability escalation, risk escalation, or approval bypass (the
   harness asserts this; confirm the printed check objects).
4. Provider cost and latency for the planner and runner prompts are within your
   operational budget.
5. A rollback path (below) is configured and verified in the same environment.

Graduation is operator-gated under issue #1006. Until criteria 1–5 are met, leave the
catalog fallback as the safety net: it is the default behaviour whenever the model path
is disabled, unconfigured, or rejected by a gate.

## Rollback

The model path has no destructive footprint, so rollback is immediate and total: turn
the flag off (or remove the provider key). The next request uses the deterministic
catalog/baseline path.

```bash
unset AGENTIC_MODEL_PLANNER        # or: export AGENTIC_MODEL_PLANNER=false
# Optionally also remove the provider key to disable runner enrichment:
# unset ANTHROPIC_API_KEY
# unset OPENAI_API_KEY
```

No data migration, cleanup, or replay is required. In-flight governed tasks already
carry their own schema-validated plans and approval state and are unaffected by toggling
the flag.

## References

- `packages/orchestrator/src/model-planner.ts` — model-backed planner and governance gates.
- `packages/agents/src/index.ts` — `runAgentWithModel` and `enrichAgentResultEnvelopeWithModel`.
- `packages/agents/src/model-runner.ts` — provider-neutral model client and configuration.
- `scripts/model-eval.ts` — the opt-in live eval harness (`npm run test:eval:model`).
- `tests/model-enablement-stub.test.ts` — stub-model end-to-end governance proof (no live key).
