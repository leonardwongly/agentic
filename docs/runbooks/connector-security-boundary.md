# Connector Security Boundary

Connector credentials sit on a high-risk boundary: OAuth state, provider scopes,
workspace ownership, encrypted refresh tokens, and provider-side reconciliation
state all meet at this layer. Treat every connector identifier and provider
response as untrusted until it has passed the route, repository, and secret-store
checks.

## Boundary Rules

- Provider OAuth state must be signed and bound to the authenticated user and
  active workspace.
- Provider credentials are scoped by user and workspace; cross-user reads should
  return no credential or no secret.
- Managed Google integrations must reference the provider credential id through
  bounded metadata, not duplicated secret material.
- Refresh-token storage must use encrypted envelopes only.
- Secret envelopes must be bound to credential id, user id, and secret kind.
- Legacy unbound envelopes may only be read when a migration or rotation path
  explicitly opts into legacy fallback.
- Key rotation must use an explicit key version and keyring; malformed keyrings
  fail closed.
- Client responses, logs, telemetry, and issue comments must not contain refresh
  tokens, encrypted ciphertext, OAuth state, raw provider cursors, or account
  secrets.

## Required Coverage

Keep regression coverage for:

- valid encrypted refresh-token round trip
- empty and oversized secret rejection
- missing master key rejection
- tampered envelope rejection
- user, credential id, and secret-kind context mismatch denial
- legacy fallback opt-in only
- key-version rotation and missing-key fail-closed behavior
- malformed keyring rejection
- repository-level user isolation for credentials and secrets
- Google route behavior that returns readiness without stored secret material

## Validation

Run the focused security boundary checks after changing connector credential
handling:

```bash
npm exec -- vitest run tests/provider-credential-secrets.test.ts tests/repository.test.ts tests/google-provider-routes.test.ts
```

Run the W03 gates before closing connector security work:

```bash
npm exec -- vitest run tests/integration-readiness.test.ts tests/google-provider-adapters.test.ts tests/google-provider-routes.test.ts
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

Rollback is a normal revert of the connector security boundary change. Do not
roll back secret context binding or cross-user isolation in production unless a
temporary compatibility flag is explicitly documented and paired with a rotation
plan.
