# Observability Confidence Runbook

This runbook covers the W09 observability performance and deployment confidence gates for cross-service correlation, retained telemetry, dashboard health metrics, load sanity, and staging smoke/canary validation.

## Correlation Contract

- API routes accept `x-request-id`, `x-trace-id`, and `x-parent-span-id`.
- API responses return the active `x-request-id` and `x-trace-id`.
- Logs, metrics, and spans carry the active request, trace, route, job, provider, workflow, and artifact context when that context is available.
- Action-log telemetry records workflow and artifact identifiers as bounded IDs only. Do not place secrets, raw provider payloads, message bodies, cookies, access keys, or bearer tokens in telemetry attributes.

Rollback: remove externally supplied trace headers at the ingress proxy if a caller sends malformed or high-cardinality IDs. The app normalizes IDs to a bounded allowlist, then falls back to generated IDs when normalization would produce an empty value.

## Telemetry Export And Retention

Configure retention and export with:

```sh
AGENTIC_TELEMETRY_RETENTION_DIR=/var/lib/agentic/telemetry
AGENTIC_TELEMETRY_RETENTION_MAX_FILES=512
AGENTIC_TELEMETRY_EXPORT_URL=https://telemetry.example.com/ingest
AGENTIC_TELEMETRY_EXPORT_TOKEN=...
AGENTIC_TELEMETRY_EXPORT_BATCH_SIZE=64
AGENTIC_TELEMETRY_EXPORT_QUEUE_LIMIT=5000
```

Retention is bounded by file count and export is bounded by queue length, batch size, and request timeout. Retained batches are rollout evidence; they should be copied to incident or release evidence storage before the retention window overwrites them.

Validate retained batches against checked-in rollout gates:

```sh
npm run telemetry:rollout-gate -- --dir /var/lib/agentic/telemetry
```

Rollback: unset `AGENTIC_TELEMETRY_EXPORT_URL` to stop backend export while keeping local retention, or unset both export URL and retention dir to disable the exporter entirely.

## Dashboard Health Metrics

Dashboard assembly records:

- `product.dashboard.summary_latency_ms`
- `dashboard.health.payload_items`
- `dashboard.health.queue_depth`
- `dashboard.health.queue_lag_seconds`
- `dashboard.health.connector_count`
- `dashboard.health.operations_status.total`

These metrics are derived from already scoped dashboard payload inputs. They do not add extra database reads or connector calls.

## Load And Performance Sanity

Run the focused observability load suite:

```sh
npm run test:load:observability
npm run test:performance:fitness
```

The load suite exercises enqueue and worker processing with local durable storage and verifies that expected worker metrics are emitted. The performance fitness gate checks representative request, dashboard, worker, and retry workloads without production side effects.

## Staging Smoke And Canary

Run health, readiness, session, and async queue canary validation with one command:

```sh
AGENTIC_SMOKE_BASE_URL=https://staging.example.com \
AGENTIC_SMOKE_ACCESS_KEY=... \
AGENTIC_TELEMETRY_RETENTION_DIR=/var/lib/agentic/telemetry \
npm run test:smoke:deployment-confidence
```

The confidence command reuses one request/trace pair across health, readiness, session login, and async goal canary checks, then evaluates retained telemetry when a retention directory is configured.

Rollback: keep `test:smoke:deployment` available for liveness/readiness-only validation, and use `test:smoke:deployment-async` when only the durable queue path needs to be rechecked.

## Security Notes

- Access keys are sent only in authenticated smoke/canary requests and are not returned in output.
- Telemetry sanitization redacts secret-bearing keys and secret-like values before logs, retention, or export.
- Retained telemetry is operational evidence and may still include non-secret IDs. Store it with the same access controls as deployment logs.
