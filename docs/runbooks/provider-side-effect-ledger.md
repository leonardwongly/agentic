# Provider Side-Effect Ledger

The provider side-effect ledger records externally visible Gmail and Calendar mutations before the adapter call is made. It is keyed by `(userId, idempotencyKey)` so retries, worker replays, and duplicate approval follow-up jobs can find the prior attempt before creating another provider object.

## Contract

- Reserve a ledger row before calling a provider mutation.
- Prove approval-grade connector readiness before reserving the ledger row or calling the provider adapter.
- Reuse the same idempotency key and side-effect target for every retry of the same typed action.
- Suppress adapter execution when the ledger already completed with a provider reference.
- Resume Gmail send retries from a recorded draft reference instead of creating another draft.
- Mark provider failures with retryable/manual-review outcome metadata from the connector error classifier.

## Persistence

- File-backed runtime stores ledger rows in `providerSideEffects`.
- Postgres runtime stores ledger rows in `provider_side_effects`.
- The unique `(user_id, idempotency_key)` index is the durable duplicate-submission guard.

## Rollback

Disable ledger-aware provider execution before rolling back the `0011_provider_side_effect_ledger.sql` migration. Preserve ledger rows for duplicate-delivery forensics unless an operator-approved restore plan removes the table from backup.
