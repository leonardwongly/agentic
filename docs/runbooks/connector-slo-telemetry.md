# Connector SLO Telemetry

Connector readiness is now reported as explicit SLO gates in dashboard
telemetry. The gates are derived from the same scoped dashboard connector health
summary that operators see in the control tower.

## Gates

`dashboard.health.connector_slo_gate` emits one histogram sample per gate:

| Gate | Value | Pass | Warn | Fail |
| --- | --- | --- | --- | --- |
| `credential_connected_ratio` | connected / visible credentials | all visible credentials connected, or no credentials configured | any visible credential is not connected | n/a |
| `refresh_failure_count` | credentials in refresh-failed state | `0` | `> 0` | n/a |
| `reconnect_required_count` | credentials requiring reconnect | `0` | n/a | `> 0` |
| `revoked_count` | revoked credentials | `0` | n/a | `> 0` |
| `expired_count` | expired credentials | `0` | n/a | `> 0` |
| `validation_stale_count` | stale validation evidence | `0` | `> 0` | n/a |

Every sample includes:

- `gate`
- `status`
- `threshold`
- `connectorStatus`

The aggregate dashboard log event `dashboard.health.metrics_recorded` also
includes connector totals, connected count, issue count, reconnect-required
count, refresh-failed count, revoked count, expired count, and stale-validation
count.

## Operations Use

Use these gates to alert before automation is widened:

1. Block provider-backed autonomy when any fail gate is non-zero.
2. Keep approval-grade execution available only when warn gates have an owner
   and recovery path.
3. Treat no configured credentials as pass for the connected-ratio gate but
   rely on readiness and feature capability checks before exposing provider
   actions.

## Security Notes

Connector SLO telemetry is aggregate only. Do not add credential IDs, account
emails, provider cursor values, OAuth state, refresh tokens, encrypted
ciphertext, or user-entered recovery reasons to telemetry attributes or logs.

## Validation

Run the dashboard telemetry test after changing connector SLO gates:

```bash
npm exec -- vitest run tests/dashboard-data.test.ts
```

Run the W03 gates before closing connector SLO work:

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

Rollback is a normal revert of the telemetry additions. If an alert is too
noisy, tune downstream alerting thresholds first; the emitted gate values should
remain conservative because they are derived from already-scoped dashboard
health.
