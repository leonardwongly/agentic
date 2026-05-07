# Dashboard Cockpit Rollout Runbook

## Purpose

This runbook controls rollout and rollback for the dashboard cockpit surfaces that expose traceability, memory provenance, accessibility gates, and cockpit telemetry. The rollout is intentionally fail-closed: an unset or invalid flag keeps the legacy cockpit variant active.

## Feature Flag

Use `AGENTIC_DASHBOARD_COCKPIT` to select the cockpit variant.

```bash
export AGENTIC_DASHBOARD_COCKPIT=redesigned
```

Accepted enabled values are `1`, `true`, `enabled`, `on`, and `redesigned`.
Accepted disabled values are `0`, `false`, `disabled`, `off`, `legacy`, and the empty string.
Any other value is treated as invalid and falls back to `legacy`.

## Canary Validation

Before shifting production traffic, run:

```bash
npm test -- tests/dashboard-traceability.test.ts tests/cockpit-rollout.test.ts tests/core-loop-route.test.ts tests/observability-rollout-gate.test.ts
npm run docs:validate
npm run test:e2e -- tests/e2e/dashboard-cockpit-accessibility-responsive.spec.ts
npm run telemetry:rollout-gate -- --dir "${AGENTIC_TELEMETRY_RETENTION_DIR:-.agentic/telemetry}"
```

The canary must keep these critical gates green:

- `product.dashboard.first_meaningful_render_ms` p95 at or below 2500 ms.
- `product.dashboard.summary_latency_ms` p95 at or below 1000 ms.
- `product.dashboard.table_endpoint_latency_ms` p95 at or below 750 ms.
- `product.dashboard.event_reconnect.total` sum at or below 2.
- `product.dashboard.approval_latency_ms` p95 at or below 600000 ms.
- `product.dashboard.dead_letter_recovery_ms` p95 at or below 900000 ms.

## Privacy Rules

Cockpit telemetry must stay categorical. Do not emit command-palette query text, free-form recommendation notes, user ids, workspace ids, raw payloads, provider headers, tokens, cookies, or URLs with query strings. Recommendation feedback may record whether notes were supplied and the note length, but not the note body in telemetry or action-log feedback metadata.

## Rollback

Rollback does not require schema changes.

```bash
export AGENTIC_DASHBOARD_COCKPIT=legacy
npm run start:web:prod -- --hostname 0.0.0.0 --port 3000
```

After rollback, verify:

```bash
curl -fsS https://agentic.example.com/api/health
curl -fsS https://agentic.example.com/api/ready
npm run telemetry:rollout-gate -- --dir "${AGENTIC_TELEMETRY_RETENTION_DIR:-.agentic/telemetry}"
```

Keep the worker runtime unchanged unless the rollout also introduced worker changes. The cockpit flag only gates the dashboard variant and telemetry attributes.
