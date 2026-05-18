# Connector Reconciliation Replay

Managed connector recovery needs a bounded replay path for provider sync and
webhook drift. The Google readiness contract now exposes replay readiness from
credential metadata without returning raw provider cursors.

## Contract

Provider credentials may carry these bounded metadata fields:

- `reconciliationCursor`: opaque provider cursor used only as a source for a
  redacted `cursorRef`
- `reconciliationCursorUpdatedAt`: ISO timestamp for cursor freshness
- `lastReplayJobId`: last durable replay job recorded for operator evidence

`describeIntegrationReadiness` projects those fields into
`managedProvider.reconciliation`:

- `cursorPresent`
- `cursorRef`
- `cursorUpdatedAt`
- `cursorAgeSeconds`
- `cursorStale`
- `lastReplayJobId`
- `replayAvailable`
- `replayJobKind`
- `idempotencyKey`

The raw cursor must never be returned to clients, logs, telemetry, or issue
comments. Operators should use the redacted cursor reference and idempotency key
when queuing a replay.

## Replay Semantics

When a credential has a cursor and a credential id, readiness includes a
`replay_reconciliation` recovery action with operation
`enqueue_connector_reconciliation_replay`.

The replay action means:

1. Resume from the stored cursor reference instead of running an unbounded full
   provider scan.
2. Use the readiness-provided idempotency key so duplicate operator clicks,
   webhook retries, and scheduled sync retries collapse to the same replay
   intent.
3. Record the resulting job id back to `lastReplayJobId` before retrying the
   next provider sync or webhook recovery step.

The readiness contract does not execute provider I/O. Runtime enqueueing still
belongs behind a governed recovery or connector route with authentication,
authorization, rate limiting, and audit evidence.

## Security Notes

Treat provider cursors as secret-adjacent opaque state. They can encode mailbox,
calendar, tenant, or provider-side synchronization position. The public contract
uses `sha256(cursor).slice(0, 16)` as `cursorRef` and never exposes the cursor
itself.

Reject or ignore malformed cursor metadata rather than guessing. Cursor strings
are bounded to 500 characters, replay job ids to 200 characters, and cursor
timestamps must parse as dates before age or staleness are reported.

## Validation

Run the connector readiness and provider adapter checks after changing this
contract:

```bash
npm exec -- vitest run tests/integration-readiness.test.ts tests/google-provider-adapters.test.ts tests/google-provider-routes.test.ts
```

Run the W03 security and build gates before closing reconciliation replay work:

```bash
npm run test:security:regression
npm run build
```

For release readiness, also run:

```bash
npm run typecheck
npm run lint
npm run format:check
git diff --check
```

## Rollback

Rollback is a normal revert of the readiness contract change. If replay
contracts need to be disabled while keeping cursor redaction, keep
`managedProvider.reconciliation.cursorRef` but stop emitting
`replay_reconciliation` actions until the governed enqueue route is available.
