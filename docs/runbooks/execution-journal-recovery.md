# Execution Journal Recovery

This runbook defines the durable execution journal contract for replayable worker jobs and the operator recovery decision tree for dead-lettered or partially completed work.

## Purpose

The execution journal exists so Agentic can recover failed external side effects without manual database edits or ambiguous operator guesswork. The contract is shared across worker runtime code, API polling routes, dashboard remediation surfaces, and replay tooling.

## Contract Reference

The canonical schema and derivation helpers live in:

- [`packages/contracts/src/index.ts`](https://github.com/leonardwongly/agentic/blob/main/packages/contracts/src/index.ts)

Key exports:

- `JobExecutionJournalEntrySchema`
- `JobExecutionJournalSchema`
- `buildApprovalNotificationDeliveryTarget(...)`
- `deriveJobRecoveryState(...)`
- `createJobExecutionJournal(...)`
- `appendJobExecutionJournalEntry(...)`

The journal is persisted on every durable job record and derives operator-facing recovery state from trusted server-side job state instead of client hints.

## Journal Fields

Each job journal tracks:

- `lifecycleState`: normalized worker state such as `queued`, `running`, `retrying`, `completed`, or `dead_letter`
- `retryCount`: how many retry transitions have already been consumed
- `sideEffectTarget`: the normalized external side effect target used for idempotency, auditability, and operator context
- `providerRef`: optional provider-specific reference when the worker has a stable downstream identifier
- `replayedFromJobId`: ancestry pointer when a dead-lettered job is requeued for recovery
- `lastUpdatedAt`: trusted server timestamp for the latest journal mutation
- `recovery`: derived operator recovery metadata, including strategy, note, operator action label, and status URL
- `entries`: bounded append-only transition history for the latest worker lifecycle mutations

Approval follow-up jobs also carry `payload.approvalId` and `payload.metadata.actionId`. The approval id ties the job to the decision record, while the action id is a stable hash of the approval/task/action intent. The follow-up job idempotency key includes both values, so duplicate callbacks and safe replays dedupe the same governed action without conflating a later approval/action shape.

## Lifecycle States

The journal lifecycle is intentionally small and explicit:

- `queued`: job accepted and waiting for claim
- `running`: worker lease acquired and execution in progress
- `retrying`: previous attempt failed but the failure was classified as retryable
- `completed`: worker finished without further operator intervention
- `dead_letter`: bounded retries were exhausted or the failure was intentionally classified as unrecoverable by normal retries

State transitions are appended through [`appendJobExecutionJournalEntry(...)`](https://github.com/leonardwongly/agentic/blob/main/packages/contracts/src/index.ts), and repository persistence updates the durable journal whenever a worker claims, retries, dead-letters, or completes a job.

## Recovery Strategies

The recovery strategy is derived through [`deriveJobRecoveryState(...)`](https://github.com/leonardwongly/agentic/blob/main/packages/contracts/src/index.ts). Current operator-facing strategies are:

- `retry_job`: the worker can safely retry through the normal queue policy
- `replay_job`: the job must be explicitly requeued after dead-letter recovery
- `manual_review`: an operator must inspect the failure before any further execution

These strategies are derived from trusted job kind, status, and payload shape. The client never chooses the recovery strategy.

## Decision Tree

Use this recovery path for any durable job surfaced in the operator shell.

1. Poll the job state through the canonical API.
   - Approval follow-up jobs: [`/api/approvals/jobs/[id]`](https://github.com/leonardwongly/agentic/blob/main/apps/web/app/api/approvals/jobs/[id]/route.ts)
   - Generic durable jobs: [`/api/jobs/[id]`](https://github.com/leonardwongly/agentic/blob/main/apps/web/app/api/jobs/[id]/route.ts)
2. Inspect `journal.lifecycleState`.
   - If `queued`, `running`, or `retrying`, wait for the worker or queue policy to finish.
   - If `completed`, stop. No operator recovery is required.
   - If `dead_letter`, continue to the next step.
3. Inspect `journal.recovery.strategy`.
   - If `retry_job`, allow the queue policy to retry or use the worker-owned retry path when exposed.
   - If `replay_job`, use the replay endpoint because bounded retries are exhausted but the side effect is safe to requeue.
   - If `manual_review`, do not trigger another side effect automatically.
4. For `replay_job`, choose the replay surface based on job family.
   - `approval_follow_up`: replay through [`/api/jobs/[id]/replay`](https://github.com/leonardwongly/agentic/blob/main/apps/web/app/api/jobs/[id]/replay/route.ts), then continue polling through `/api/approvals/jobs/[replayedId]`
   - `approval_notification`: replay through `/api/jobs/[id]/replay`, then poll through `/api/jobs/[replayedId]`
   - `autopilot_process`: replay through `/api/jobs/[id]/replay`, then poll through `/api/jobs/[replayedId]`
5. Confirm the replayed job journal.
   - `replayedFromJobId` must point to the dead-lettered source job
   - `entries` must include a new `queued` replay transition
   - `recovery.statusUrl` must point to the correct polling endpoint for the replayed job
6. Confirm the audit trail.
   - Replay actions must write a recovery action log to the goal bundle or autopilot event context
   - Dashboard remediation should now point at the replayed job instead of the dead-lettered source once the new job is surfaced

## Operator Surfaces

Operator-facing recovery state is exposed in four places:

- Approval follow-up polling route:
  - [`apps/web/app/api/approvals/jobs/[id]/route.ts`](https://github.com/leonardwongly/agentic/blob/main/apps/web/app/api/approvals/jobs/[id]/route.ts)
  - Returns `lifecycleState`, `retryCount`, `sideEffectTarget`, `providerRef`, `replayedFromJobId`, `recovery`, and `entries`
- Generic durable-job polling route:
  - [`apps/web/app/api/jobs/[id]/route.ts`](https://github.com/leonardwongly/agentic/blob/main/apps/web/app/api/jobs/[id]/route.ts)
  - Returns the same journal projection for approval notification and autopilot jobs
- Generic replay route:
  - [`apps/web/app/api/jobs/[id]/replay/route.ts`](https://github.com/leonardwongly/agentic/blob/main/apps/web/app/api/jobs/[id]/replay/route.ts)
  - Requeues dead-lettered replayable jobs and persists replay recovery logs
- Dashboard remediation mapping:
  - [`packages/repository/src/dashboard-operations.ts`](https://github.com/leonardwongly/agentic/blob/main/packages/repository/src/dashboard-operations.ts)
  - Derives replay actions from `job.journal.recovery` instead of ad hoc UI heuristics
- Operations recovery lane:
  - [`apps/web/app/api/operations/recovery/route.ts`](https://github.com/leonardwongly/agentic/blob/main/apps/web/app/api/operations/recovery/route.ts)
  - Accepts strict, discriminated recovery actions for `retry_dead_letter_job`, `release_expired_lease`, and `cancel_job`
  - Delegates dead-letter replay to `/api/jobs/[id]/replay` after resolving the authenticated job and workspace permission boundary
  - Releases only running jobs with an expired worker lease, never active leases
  - Cancels only queued or retrying jobs, and writes an audit journal entry rather than deleting the job

## Failure Handling Rules

The execution journal is designed around a few invariants:

- request handlers do not repeat worker-owned side effects inline
- approval follow-up job idempotency is keyed by approval id plus stable action id
- replay eligibility is derived from persisted job state, not client claims
- dead-letter visibility is sanitized before being returned to operators
- replay preserves ancestry through `replayedFromJobId`
- side-effect targets distinguish governed task execution from connector receipt or notification delivery
- stale lease recovery is fail-closed: an operator can release only a running job whose persisted `leaseExpiresAt` is at or before the server evaluation time
- queue cancellation is reversible only by replaying or re-enqueueing a new job from trusted context; the cancelled job remains dead-lettered with operator audit metadata

When these invariants are violated, the correct fix is to harden the worker or contract boundary, not to patch the operator UI.

## Validation Evidence

The current regression coverage for this recovery contract lives in:

- [`tests/execution.test.ts`](https://github.com/leonardwongly/agentic/blob/main/tests/execution.test.ts)
  - initial journal creation
  - retry transition handling
  - dead-letter transition handling
- [`tests/repository.test.ts`](https://github.com/leonardwongly/agentic/blob/main/tests/repository.test.ts)
  - file-backed persistence of retry and dead-letter transitions
  - dashboard remediation derivation for replayable approval and autopilot jobs
- [`tests/approval-job-route.test.ts`](https://github.com/leonardwongly/agentic/blob/main/tests/approval-job-route.test.ts)
  - approval follow-up job polling with journal projection
  - dead-letter replay for approval follow-up jobs
  - dead-letter replay for approval notification jobs
  - dead-letter replay for autopilot jobs
  - cross-user denial for polling and replay
- [`tests/operations-recovery-route.test.ts`](https://github.com/leonardwongly/agentic/blob/main/tests/operations-recovery-route.test.ts)
  - expired worker lease release through the operations recovery lane
  - active lease release denial
  - dead-letter approval follow-up replay delegation through the operations recovery lane
  - queued-job cancellation with audit journal metadata
  - malformed recovery-action rejection before mutation
  - cross-user and workspace-owner permission denial
- [`tests/worker-runtime.test.ts`](https://github.com/leonardwongly/agentic/blob/main/tests/worker-runtime.test.ts)
  - notification job execution
  - worker-owned side-effect failure dead-letter handling
  - sanitized autopilot dead-letter recovery details

The focused validation command for this slice is:

```bash
npm exec -- vitest run tests/worker-runtime.test.ts tests/execution.test.ts tests/approval-job-route.test.ts tests/operations-recovery-route.test.ts tests/repository.test.ts
npm run test:architecture:fitness
npm run test:performance:fitness
npm run typecheck
npm run lint
npm run format:check
```

## When To Escalate To Manual Review

Choose `manual_review` rather than replay when any of the following are true:

- the downstream side effect cannot be proven idempotent
- the worker cannot identify the external target precisely enough to avoid duplicate side effects
- the failure mode implies data drift or missing approval context rather than a transient transport or runtime fault
- the persisted job record is missing the metadata needed to reconstruct a safe replay

That default keeps recovery fail-closed when the system cannot safely prove replay correctness.
