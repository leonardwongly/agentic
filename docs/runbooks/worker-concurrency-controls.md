# Worker Concurrency Controls

This runbook defines the worker queue priority, backpressure, and concurrency contract for durable jobs.

## Purpose

Worker concurrency controls keep bursts or slow providers from letting one job family, user, or side-effect target monopolize execution. The controls are enforced at claim time, before a worker receives a lease, so blocked work stays queued rather than starting another external mutation.

## Claim Contract

Durable job claims use these controls:

- Priority order is `critical`, `high`, `normal`, `low`, then `maintenance`.
- Jobs with the same priority are claimed by `availableAt`, then `createdAt`.
- `queue` restricts claims to one named queue when set.
- `kinds` restricts claims to an allowlisted job-kind set when set.
- `maxRunningPerKind` limits active, non-expired running jobs for the candidate job kind.
- `maxRunningPerUser` limits active, non-expired running jobs for the candidate job user.
- `maxRunningPerConcurrencyKey` limits active, non-expired running jobs for the candidate concurrency key.
- Expired leases do not count against concurrency limits and may be reclaimed by a later claim.

When a high-priority candidate is blocked by a concurrency limit, claim logic skips that candidate and can claim the next eligible job. This preserves backpressure without freezing unrelated work.

## Runtime Configuration

The standalone worker reads these optional positive-integer environment variables:

- `AGENTIC_WORKER_MAX_RUNNING_PER_KIND`
- `AGENTIC_WORKER_MAX_RUNNING_PER_USER`
- `AGENTIC_WORKER_MAX_RUNNING_PER_CONCURRENCY_KEY`

In production, the worker is constrained even when none of these variables are set. The production-safe defaults are:

- `maxRunningPerKind=1`
- `maxRunningPerUser=2`
- `maxRunningPerConcurrencyKey=1`

Production env overrides merge with these defaults, so a partial configuration cannot accidentally remove the remaining caps. For example, setting only `AGENTIC_WORKER_MAX_RUNNING_PER_USER=5` keeps the per-kind and per-concurrency-key defaults in place.

In non-production runtimes, the worker remains unconstrained when none of the variables are set. Configure the variables locally when reproducing production backpressure or testing provider-specific tuning.

Set `AGENTIC_WORKER_MAX_RUNNING_PER_CONCURRENCY_KEY=1` for the safest external side-effect posture in multi-worker deployments. Add per-kind or per-user caps when provider rate limits or fairness requirements demand stricter backpressure.

## Observability

Every durable claim emits `durable_job.claim.total` with:

- `runnerId`
- `claimResult`
- `jobKind`
- `queue`
- `concurrencyLimited`

Use `claimResult=miss` with `concurrencyLimited=true` as a backpressure signal. Pair it with queue depth, lease age, and provider telemetry before increasing limits.

Web readiness includes a `worker_concurrency` check with the active policy source, whether limits were explicitly configured, and the effective per-kind, per-user, and per-concurrency-key caps. Production bootstrap evidence also includes this check so a rollout cannot silently prove readiness while the worker would start unconstrained.

## Security And Reliability Notes

- Treat queue payloads and concurrency keys as partially trusted durable state; do not use client claims to bypass ownership or side-effect idempotency checks.
- Prefer per-concurrency-key caps for side-effect targets because they prevent duplicate provider mutations while allowing unrelated work to continue.
- Keep lease durations shorter than provider or handler timeouts where practical so stalled work can be reclaimed.
- Do not raise concurrency caps to hide slow providers; first inspect provider latency, retry behavior, and ledger duplicate suppression.

## Validation

Run the focused worker-concurrency gate:

```bash
npm exec -- vitest run tests/repository.test.ts tests/execution.test.ts tests/worker-runtime.test.ts
npm exec -- vitest run tests/worker-concurrency-policy.test.ts tests/runtime-readiness.test.ts tests/production-bootstrap-check.test.ts
npm run test:architecture:fitness
npm run test:performance:fitness
npm run typecheck
npm run lint
npm run format:check
```

The repository tests cover both file-backed and Postgres-backed claim semantics when `DATABASE_URL` is configured. Local runs without `DATABASE_URL` skip the Postgres-specific branch and still exercise the file-backed claim contract.

## Rollback

To reduce backpressure without changing code, raise the relevant `AGENTIC_WORKER_MAX_RUNNING_*` variables and restart workers. Unsetting the variables restores the production defaults rather than disabling caps in production. To roll back this contract completely, revert the code and test changes in the worker-concurrency PR; no data migration is required.
