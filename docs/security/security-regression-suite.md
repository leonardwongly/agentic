# Security Regression Suite

The security regression suite provides a narrow, deterministic gate for the
abuse paths that must stay fail-closed as Agentic grows. It is designed to
catch the highest-signal regressions before the broader test suite runs.

## Scope

The suite groups tests by failure mode instead of by feature area so the release
owner can quickly answer which defensive boundary regressed:

- `malformed-input-and-size-limits`
  Reject malformed JSON, unknown fields, oversized payloads, and ambiguous input
  before work reaches durable or privileged code paths.
- `auth-session-and-provider-callbacks`
  Keep session bootstrap, callback state validation, and provider auth flows
  fail-closed.
- `authorization-governance-and-tenant-isolation`
  Prevent cross-user and cross-workspace data access, and preserve governed
  route behavior.
- `idempotency-replay-and-duplicate-submission`
  Stop retried submissions and duplicate event delivery from creating duplicate
  state transitions.
- `privacy-and-anonymous-surfaces`
  Protect public and privacy-sensitive paths from inline writes, over-broad
  disclosure, and anonymous abuse.
- `durable-execution-and-recovery`
  Verify retry, dead-letter, and worker recovery behavior remain bounded and
  sanitized.

## Coverage Notes

High-signal files in the suite include:

- `tests/api-validation.test.ts`
- `tests/governed-route.test.ts`
- `tests/auth.test.ts`
- `tests/google-provider-routes.test.ts`
- `tests/route-user-scope.test.ts`
- `tests/governance-privacy-route.test.ts`
- `tests/goal-route.test.ts`
- `tests/briefing-route.test.ts`
- `tests/docs-render-route.test.ts`
- `tests/autopilot-route.test.ts`
- `tests/worker-runtime.test.ts`
- `tests/repository.test.ts`

The suite intentionally overlaps some files across categories. That overlap is
useful because a single route often defends multiple boundaries, such as
idempotency and authorization.

## Run

```bash
npm run test:security:regression
```

The command prints a concise inventory summary before running the curated Vitest
files. CI runs the suite ahead of the full test pass so abuse regressions fail
quickly with a narrower signal.

## Release Relationship

Use this suite together with the risk-classed validation matrix in
[`docs/security/validation-matrix.md`](./validation-matrix.md). The regression
suite is the executable gate; the matrix explains which surfaces are blocked by
which failures and what extra rollout evidence is required for `P0` and `P1`
surfaces.
