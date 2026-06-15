# Worker Durability And Recovery

This runbook defines the durability and recovery contract for the durable job
worker, the in-repo evidence that proves it, the deployed-worker verification
checklist, and the graduation criteria for the watcher and autopilot-control
surfaces that depend on it.

## Purpose

Watchers and autopilot-control graduate from preview only when the worker that
runs their jobs is provably durable: a transient failure must retry and recover,
a permanently failing job must dead-letter instead of looping, a worker that
stalls must release its work to a healthy worker, and an operator cancellation
must stop in-flight work promptly without corrupting the queue. This runbook
makes those guarantees explicit and gives operators a repeatable way to verify
them before and after a deployment.

## Durability Model

The durable job lifecycle is owned by `@agentic/execution` (`createDurableJobQueue`,
`processNextDurableJob`) over a `JobQueueStore` (the Postgres or file-backed
repository). The legal job transitions are:

- `queued -> running -> completed`
- `running -> retrying -> running` (bounded by `maxAttempts`)
- `running -> dead_letter` (retry budget exhausted, or no idempotency key when
  `requireIdempotencyForRetry` is set)
- `queued | running | retrying | paused -> cancelled` (operator control)

Recovery properties:

- **Retry with backoff.** A failed attempt is rescheduled with exponential
  backoff (`computeJobRetryDelayMs`) and optional jitter for idempotent jobs.
- **Dead-letter.** Once `attemptCount >= maxAttempts` the job is dead-lettered
  with its last error and is never re-claimed.
- **Lease expiry and reclaim.** A claim grants a lease for `leaseMs`. A running
  job whose lease has expired is reclaimable by any worker; active leases are not
  stealable, so duplicate side effects are avoided while stalled work still
  recovers.
- **Replay.** A dead-lettered job is recovered by enqueuing a fresh job whose
  payload `metadata.replayedFromJobId` references the original; the new job's
  journal records the replay provenance.
- **In-attempt cancellation (AOS-25).** A job claimed as `running` is re-read on
  an interval while its handler runs. If it is cancelled by operator control
  (`status -> cancelled`) or its lease is taken over (`claimedBy` changes), the
  handler's `AbortSignal` is aborted and the attempt is abandoned **without**
  calling `completeJob`/`retryJob`/`deadLetterJob`, which would otherwise throw
  `not_running` and could destabilize the loop.

## In-Attempt Cancellation Configuration

In-attempt cancellation is enabled by default in `runWorkerRuntime`. The worker
re-reads each running job through `repository.getJob` on an interval and aborts
the in-flight `AbortSignal` when ownership is lost.

- `cancellationPollIntervalMs` (runtime option) controls how often a running job
  is re-read. Default `1000`ms.
- Set `cancellationPollIntervalMs: 0` to disable in-attempt cancellation polling
  (the worker still cancels queued/retrying/paused jobs at claim time; only the
  mid-attempt abort is disabled).

Handlers receive the abort via `JobHandlerContext.signal`. Connector mutations
(Gmail, Calendar, Slack, Telegram, local notes) already thread this signal into
their network calls, so a cancelled job stops before its next external side
effect. Cooperative handlers should check `signal.throwIfAborted()` before
irreversible work; non-cooperative handlers are still abandoned safely after a
short settlement grace.

## In-Repo Durability Evidence (Automated)

These suites are the automated, always-on proof of the recovery properties and
run without a deployment or `DATABASE_URL`:

- `tests/worker-runtime-durability.test.ts`
  - transient failure -> retry -> clean recovery
  - retry-budget exhaustion -> dead-letter (and not re-claimed)
  - expired-lease reclaim by a healthy worker -> completion
  - dead-letter -> replay enqueue with recorded provenance -> completion
  - operator cancellation aborts the in-flight signal and abandons the attempt
    (cooperative and non-cooperative handlers)
  - lease takeover aborts the in-flight attempt without clobbering the new owner
  - end-to-end operator cancel via `cancelJobsForGoal` leaves the job `cancelled`
- `tests/worker-runtime.test.ts` — worker loop, timeout settlement, health.
- `tests/execution.test.ts` — transition legality, retry/dead-letter contract.
- `tests/repository.test.ts` — file-backed and Postgres claim/lease semantics.

Run them with:

```bash
npm exec -- vitest run tests/worker-runtime-durability.test.ts tests/worker-runtime.test.ts tests/execution.test.ts
```

The repository suite additionally exercises the Postgres claim/lease branch when
`DATABASE_URL` is configured.

## Deployed-Worker Verification Checklist (Operator-Gated)

The items below require a running deployment (web + at least one worker, Postgres,
and a shared worker heartbeat path). They cannot be proven by CI alone and must be
recorded as deployment evidence before graduating watchers or autopilot-control.

1. **Heartbeat liveness.** With the worker running, `GET /api/ready/details`
   reports a healthy `worker` heartbeat (fresh `lastProcessedAt`, no stale lease
   age). Stop the worker and confirm the heartbeat goes stale and `/api/ready`
   degrades; restart and confirm recovery.
2. **Retry recovery.** Inject a transiently failing job (e.g. a provider returning
   a retryable error once). Confirm it transitions `running -> retrying -> running
   -> completed` and that `durable_job.retry.total` increments without dead-letter.
3. **Dead-letter.** Force a permanently failing job. Confirm it dead-letters at
   `maxAttempts`, surfaces in the operations/recovery surface, and emits
   `durable_job.dead_letter.total`.
4. **Lease reclaim.** Kill the worker mid-attempt (or expire its lease). Confirm a
   second worker reclaims the expired-lease job after `leaseMs` and completes it
   exactly once (no duplicate external side effect, verified via the action ledger
   / idempotency key).
5. **Replay.** Replay a dead-lettered job from the recovery surface and confirm the
   replacement completes and records `replayedFromJobId` provenance in its journal.
6. **In-attempt cancellation.** Start a long-running job, cancel its goal via
   workflow control, and confirm: the in-flight attempt aborts before its next
   external side effect, the job ends `cancelled` (not `completed`/`dead_letter`),
   the worker loop keeps processing subsequent jobs, and `durable_job.cancelled.total`
   increments.
7. **Multi-worker safety.** With `maxRunningPerConcurrencyKey=1` and 2+ workers,
   confirm no duplicate side-effect job runs concurrently and that cancellation /
   reclaim behave correctly under contention.

Record the date, commit SHA, deployment target, and the observed metric/heartbeat
values for each item as graduation evidence.

## Observability Signals

- `durable_job.claim.total` (`claimResult`, `concurrencyLimited`) — backpressure.
- `durable_job.retry.total` / `durable_job.dead_letter.total` — failure handling.
- `durable_job.completed.total` — successful settlement.
- `durable_job.cancelled.total` — in-attempt cancellations / lease takeovers.
- `worker.loop.processed.total`, `worker.job.{succeeded,failed}.total` — throughput.
- Worker heartbeat file (`AGENTIC_WORKER_HEALTH_PATH`) and the `worker` check in
  `/api/ready/details` — liveness and lease age.

Alert on rising `durable_job.dead_letter.total`, stale heartbeats, or expired-lease
counts that do not recover.

## Graduation Criteria

### Watchers

Graduate watcher execution from preview when:

- The in-repo durability suite (above) is green in CI.
- Deployed-worker checklist items 1-5 are recorded against the target deployment.
- Watcher-triggered jobs are observed retrying and recovering, and a watcher whose
  worker stalls is reclaimed and completed by a healthy worker.
- Watcher scheduling honors lease expiry and does not double-fire on reclaim
  (verified via the action ledger / idempotency keys).

### Autopilot-Control

Graduate autopilot-control (operator pause/resume/cancel) from preview when:

- All watcher criteria are met.
- Deployed-worker checklist item 6 (in-attempt cancellation) is recorded: an
  operator cancel stops in-flight autopilot work before its next external side
  effect and leaves the job `cancelled`.
- A paused/cancelled workflow stays paused/cancelled across worker restarts
  (control state is persisted, not clobbered by the next recompute).
- The worker loop is observed staying healthy across repeated cancellations
  (no crash, no stuck `running` jobs).

## Validation

```bash
npm exec -- vitest run tests/worker-runtime-durability.test.ts tests/worker-runtime.test.ts tests/execution.test.ts
npm run typecheck
npm run lint
npm run test:security:regression
```

`DATABASE_URL` is not required for the in-repo evidence. Configure it to also
exercise the Postgres-backed claim/lease branch in `tests/repository.test.ts`.

## Rollback

In-attempt cancellation is additive and backward-compatible. To disable only the
mid-attempt abort while keeping all other durability behavior, pass
`cancellationPollIntervalMs: 0` to the worker runtime and restart the worker. To
roll back the behavior entirely, revert the worker-durability PR; no data
migration is required because the change introduces no new persisted state.
