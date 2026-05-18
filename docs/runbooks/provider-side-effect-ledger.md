# Provider Side-Effect Ledger

The provider side-effect ledger is Agentic's durable outbox reservation model for externally visible Gmail and Calendar mutations. It records the intended provider side effect before the adapter call is made, then updates the same row with the provider reference or failure outcome. It is keyed by `(userId, idempotencyKey)` so retries, worker replays, and duplicate approval follow-up jobs can find the prior attempt before creating another provider object.

The ledger is intentionally not a separate dispatcher queue. Durable jobs own scheduling, claiming, retry, and dead-letter state; the provider side-effect ledger owns duplicate suppression and recovery evidence for the external mutation attempted by that job.

## Contract

- Reserve a ledger row before calling a provider mutation.
- Prove approval-grade connector readiness before reserving the ledger row or calling the provider adapter.
- Reuse the same idempotency key and side-effect target for every retry of the same typed action.
- Suppress adapter execution when the ledger already completed with a provider reference.
- Resume Gmail send retries from a recorded draft reference instead of creating another draft.
- Suppress duplicate Calendar event creation after the first completed event reference is recorded.
- Mark provider failures with retryable/manual-review outcome metadata from the connector error classifier.
- Keep provider payloads, tokens, headers, and message bodies out of ledger metadata.

## Persistence

- File-backed runtime stores ledger rows in `providerSideEffects`.
- Postgres runtime stores ledger rows in `provider_side_effects`.
- The unique `(user_id, idempotency_key)` index is the durable duplicate-submission guard.

## Validation

Run the focused outbox/idempotency gate after changing provider side-effect behavior:

```bash
npm exec -- vitest run tests/action-execution-contract.test.ts tests/action-execution-idempotency.test.ts tests/repository.test.ts
npm run test:architecture:fitness
npm run test:performance:fitness
```

## Rollback

Disable ledger-aware provider execution before rolling back the `0011_provider_side_effect_ledger.sql` migration. Preserve ledger rows for duplicate-delivery forensics unless an operator-approved restore plan removes the table from backup.
