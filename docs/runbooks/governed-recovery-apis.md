# Governed Recovery APIs

The operations recovery API is the privileged operator lane for bounded worker
and connector remediation. Keep this lane narrow: it can repair stalled durable
work, cancel queued work, replay dead-lettered work through the existing replay
route, and move connector credentials between recoverable states. It must not
become a generic admin mutation endpoint.

## Route Contract

`POST /api/operations/recovery` is implemented with
`createGovernedMutationRoute` and inherits the common authenticated mutation
controls:

- session or access-key authentication before body parsing or mutation
- actor attribution through `createActorContextFromPrincipal`
- strict discriminated-union request validation
- route-scoped abuse limiting with the `operations-recovery` namespace
- optional `x-idempotency-key` parsing for client-side correlation
- authenticated no-store and security headers on success and failure paths
- safe error conversion without exposing stored connector secrets

Domain authorization remains route-specific. Job recovery first resolves the job
for the authenticated user, then requires workspace ownership when the job is
workspace scoped. Connector recovery resolves the credential for the
authenticated user and requires workspace ownership for workspace credentials.

## Supported Actions

| Action | Target | Preconditions | Audit evidence |
| --- | --- | --- | --- |
| `retry_dead_letter_job` | Dead-letter job | Target job is visible to the caller and workspace recovery is owner-scoped | Reuses the governed job replay route and its journal evidence |
| `cancel_job` | Queued or retrying job | `confirm: true`; job is visible to the caller; workspace recovery is owner-scoped | Appends a `dead_letter` journal entry with `recoveryAction` and `actorUserId` |
| `release_expired_lease` | Running job | Lease is expired and still held by the recorded worker | Uses repository retry evidence and clears the stale claim |
| `revalidate_connector_credential` | Recoverable credential | Credential is not revoked; workspace credential recovery is owner-scoped | Appends `metadata.recoveryAudit` with action, actor, timestamp, and reason |
| `mark_connector_reconnect_required` | Connector credential | `confirm: true`; workspace credential recovery is owner-scoped | Appends `metadata.recoveryAudit` with action, actor, timestamp, and reason |

## Failure Handling

The API must fail closed:

- missing or invalid authentication returns `401` before mutation
- invalid action bodies, unknown fields, and missing confirmation flags return
  `400`
- resource ownership failures return `403` or `404` without leaking another
  user's job or credential details
- unrecoverable state transitions return `409`
- route abuse limiting returns `429` with `retry-after`
- connector responses are redacted and never include encrypted or plaintext
  secret material

## Validation

Run the focused recovery route checks after changing this lane:

```bash
npm exec -- vitest run tests/operations-recovery-route.test.ts tests/governed-route.test.ts
```

Run the W05 durable runtime gate before closing recovery API issues:

```bash
npm exec -- vitest run tests/worker-runtime.test.ts tests/execution*.test.ts tests/repository.test.ts
npm run test:architecture:fitness
npm run test:performance:fitness
```

For release readiness, also run:

```bash
npm run typecheck
npm run lint
npm run format:check
git diff --check
```

## Rollback

Rollback is a normal revert of the recovery route or helper change. There is no
schema migration. If a recovery action behaves incorrectly during rollout,
disable operator usage of `POST /api/operations/recovery` at the ingress layer
or remove the action from `OperationsRecoveryRequestSchema`, then redeploy.

## Security Review Notes

Treat job IDs, credential IDs, reasons, idempotency keys, and session headers as
untrusted input. Do not add actions that execute arbitrary provider calls,
fetch user-provided URLs, run shell commands, or mutate resources outside the
authenticated user's ownership boundary. Any new action needs strict schema
validation, explicit authorization, bounded side effects, audit evidence, and
negative coverage for malformed, not-owned, and rate-limited requests.
