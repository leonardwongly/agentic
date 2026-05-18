# Connector credential lifecycle

Agentic treats provider credentials as part of the operator safety boundary. Managed Google connectors must expose an explicit lifecycle state before the dashboard or runtime can treat provider automation as trusted.

## Lifecycle states

- `missing`: a managed Google integration is ready or references a provider credential, but no visible credential exists in the active dashboard scope.
- `healthy`: the credential is connected, has the required scopes, has an encrypted refresh-token secret, is not expired, and has fresh enough validation evidence.
- `degraded`: the credential exists but has a refresh, secret, or validation problem that requires operator attention before widening automation.
- `expired`: the credential has an expiry timestamp in the past and must be reconnected before provider actions resume.
- `revoked`: the provider credential was revoked and must be converted into a reconnect-required state.
- `scope_mismatch`: the credential is missing one or more scopes required by a linked managed integration.

## Repair states

- `setup_required`: start the provider setup flow and create the missing credential.
- `reconnect_required`: complete provider re-authentication before provider actions resume.
- `scope_repair_required`: reconnect with the required OAuth scopes.
- `refresh_repair_required`: repair the refresh-token path and revalidate the credential.
- `validation_required`: rerun connector validation before trusting automation decisions.
- `none`: no operator repair is required.

## Operator behavior

The operations tower surfaces lifecycle state, repair state, missing-scope count, and aggregate counts for healthy, missing, degraded, and scope-mismatched connectors. Missing managed credentials and scope mismatches are critical because they can otherwise make a connector appear configured while provider actions would fail or run with insufficient authority.

Default manual Google adapters are not treated as missing production credentials until the integration is marked `ready` or already references a provider credential. This keeps optional first-run setup from becoming a false production blocker.

## Security notes

- OAuth callback state remains bound to the authenticated user and workspace.
- Refresh tokens are stored through encrypted provider credential secrets and are never returned to the dashboard.
- Scope mismatch checks use allowlisted integration scope requirements.
- Recovery actions remain owner-only for workspace credentials.
- The dashboard surfaces only credential references, lifecycle classes, and scope counts, not provider tokens or raw provider responses.

## Validation

Run the focused W03 gate after changing connector lifecycle behavior:

```bash
npm exec -- vitest run tests/integration-readiness.test.ts tests/google-provider-adapters.test.ts tests/google-provider-routes.test.ts tests/dashboard-operations.test.ts tests/dashboard-operations-tower-card.test.tsx
npm run typecheck
npm run lint
npm run format:check
npm run test:security:regression
npm run test:performance:fitness
npm run build
```

## Rollback

Rollback is safe by reverting the dashboard operations contract, the operations tower display changes, and the associated tests. No migrations, provider writes, secret rotation, or external side effects are introduced by this lifecycle visibility change.
