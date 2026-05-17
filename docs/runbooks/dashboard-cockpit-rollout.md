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

## Exception-First Operator Loop

The cockpit renders a bounded operator priority queue before lower-priority dashboard sections. The model is deterministic and capped so the first viewport cannot grow without review:

- Maximum visible priorities: 8.
- Maximum recovery actions: 12.
- Maximum evidence strings per priority: 4.
- Maximum display text per priority field: 220 characters.

Triage in this order:

1. Recover async execution when dead letters, expired leases, stale queue items, or retry loops are present.
2. Resolve pending approvals, with R4 and R3 decisions first.
3. Repair degraded connectors before widening automation or trusting provider-backed actions.
4. Keep autonomy held behind governance controls while runtime health, connector health, or approval debt is degraded.
5. Clear blocked and overdue commitments before inspecting decorative dashboard data.
6. Review remaining diagnostics only after the higher-priority operating lanes are clear.

Recovery actions remain governed. Connector revalidation, reconnect marking, expired-lease release, queued-job cancellation, and dead-letter replay still run through the operations recovery or job replay boundaries; the cockpit only exposes the next safe target and does not bypass owner permissions, confirmation prompts, idempotency, or audit logging.

Rollback is simple because the priority model is read-only and derives from the existing dashboard payload. Disable the cockpit flag or revert this runbook/component change; no data migration is required.

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
