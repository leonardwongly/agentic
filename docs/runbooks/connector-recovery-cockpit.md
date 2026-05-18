# Connector Recovery Cockpit

The connector recovery cockpit lives in the operations control tower. It turns
provider credential health into an operator-facing setup and repair path without
bypassing the governed recovery APIs.

## Contract

Each degraded connector issue should expose:

- the affected provider credential and linked integration targets
- expected readiness tier and supported execution modes
- whether the credential is below its readiness target
- one bounded remediation action
- concrete operator steps for setup, reconnect, validation, or escalation

The cockpit is advisory and action-triggering only. It does not perform direct
credential writes in the client. Revalidation and reconnect-state changes still
go through `POST /api/operations/recovery`, which owns authentication,
authorization, rate limiting, schema validation, and audit evidence.

## Operator Flow

1. Open the operations control tower.
2. Review the connector health summary and affected connector item.
3. Read the linked integrations, expected readiness tier, and operator steps.
4. Use the bounded remediation button:
   - `Reconnect` opens the integration setup target.
   - `Require reconnect` marks revoked or expired credentials as requiring
     provider re-authorization through the recovery API.
   - `Revalidate` refreshes connector validation evidence through the recovery
     API.
5. Refresh the dashboard and confirm connector health returns to healthy before
   widening automation or relying on provider-backed actions.

## Security Notes

Connector IDs, credential IDs, integration names, and recovery reasons are
untrusted display and request inputs. The cockpit must not expose refresh tokens,
encrypted ciphertext, OAuth state, or reconciliation cursors. The recovery API
must remain the only write path for credential repair from the dashboard.

Workspace-scoped connector recovery remains owner-gated. Viewers and editors may
inspect degraded connector state through the dashboard, but privileged repair
actions still need the route and repository authorization checks.

## Validation

Run the focused cockpit and readiness checks after changing this surface:

```bash
npm exec -- vitest run tests/dashboard-operations-tower-card.test.tsx tests/repository.test.ts tests/integration-readiness.test.ts tests/google-provider-adapters.test.ts tests/google-provider-routes.test.ts
```

Run the security and build gates before closing W03-T02:

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

Rollback is a normal revert of the cockpit data-shape or UI change. If the
recovery buttons behave unexpectedly, remove the remediation button rendering or
disable the affected action at `OperationsRecoveryRequestSchema`. There is no
schema migration.
