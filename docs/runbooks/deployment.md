# Deployment Runbook

## Purpose

This runbook defines the safe rollout path for Agentic production and staging environments. The deployment contract is explicit:

- migrations run before app startup
- readiness must pass before traffic is considered healthy
- smoke checks validate the live environment after rollout
- rollback returns traffic to the previous build without mutating schema backward in place

## Required Environment

Set these variables for every production deployment:

```bash
export NODE_ENV=production
export DATABASE_URL=postgres://user:password@db-host:5432/agentic
export AGENTIC_ACCESS_KEY=replace-this-with-a-long-random-secret
export AGENTIC_REQUIRE_SHARED_AUTH_STATE=true
```

Optional but commonly needed:

```bash
export AGENTIC_SMOKE_BASE_URL=https://agentic.example.com
export AGENTIC_SMOKE_ACCESS_KEY=replace-this-with-a-long-random-secret
export AGENTIC_TELEMETRY_RETENTION_DIR=.agentic/telemetry
export AGENTIC_TELEMETRY_EXPORT_URL=https://telemetry.example.com/ingest
export AGENTIC_TELEMETRY_EXPORT_TOKEN=replace-this-with-a-telemetry-ingest-token
```

## Pre-Deploy Checks

1. Install dependencies.

```bash
npm ci
```

2. Build the web and worker applications.

```bash
npm run build
```

3. Validate schema status against the target database.

```bash
npm run db:status -- --require-ready
```

4. If the status check reports pending migrations, apply them explicitly.

```bash
npm run db:migrate
npm run db:status -- --require-ready
```

5. Run the automated test suite before rollout.

```bash
npm test
npm run test:e2e
npm run test:smoke:observability-export
```

## Rollout Procedure

1. Build the container image.

```bash
docker build -t agentic:<tag> .
```

2. Deploy the image using your platform-specific release mechanism.

3. Start the web process with startup validation.

```bash
npm run start:web:prod -- --hostname 0.0.0.0 --port 3000
```

4. Start the worker process after the schema is confirmed ready.

```bash
npm run start:worker:prod
```

5. Verify liveness and readiness from outside the deployment boundary.

```bash
curl -fsS https://agentic.example.com/api/health
curl -fsS https://agentic.example.com/api/ready
```

6. Run the scripted smoke check.

```bash
npm run test:smoke:deployment
npm run telemetry:rollout-gate -- --dir "${AGENTIC_TELEMETRY_RETENTION_DIR:-.agentic/telemetry}"
```

## Smoke Validation Expectations

Successful smoke validation confirms:

- the container is live and serving `/api/health`
- readiness passes on `/api/ready`
- authenticated session bootstrap works when `AGENTIC_SMOKE_ACCESS_KEY` is provided
- telemetry export sanitizes secret-bearing payloads before retention or backend delivery
- rollout-gate metrics stay inside the thresholds defined in `config/observability/alerts.json`

Treat any readiness failure as a failed rollout. Do not continue shifting traffic while `/api/ready` returns `503`.
Treat any rollout-gate failure as a failed rollout, even when the deployment smoke request itself succeeds.

## Observability Rollout Artifacts

The rollout path is backed by checked-in observability config:

- `config/observability/alerts.json`: gate and advisory thresholds for HTTP, worker, and provider metrics
- `config/observability/dashboard.json`: dashboard panel definitions for the same metric families

Use the local export smoke harness when validating exporter wiring before a real backend is available:

```bash
npm run test:smoke:observability-export
```

It emits sanitized logs, metrics, and spans to a local capture server and writes retained JSON batches to `AGENTIC_TELEMETRY_RETENTION_DIR`. The rollout gate CLI reads those retained batches:

```bash
npm run telemetry:rollout-gate -- --dir "${AGENTIC_TELEMETRY_RETENTION_DIR:-.agentic/telemetry}"
```

If `AGENTIC_TELEMETRY_EXPORT_URL` is configured, retained batches are still written locally so operators have fallback evidence even when the backend is unavailable.

## Rollback

Use rollback when:

- `/api/ready` returns `503` after rollout
- smoke validation fails
- request or worker error rates spike beyond accepted thresholds

Rollback steps:

1. Stop routing new traffic to the current release.
2. Restore the previous known-good application image or release artifact.
3. Re-run:

```bash
curl -fsS https://agentic.example.com/api/health
curl -fsS https://agentic.example.com/api/ready
```

4. Re-run the smoke suite against the restored version.

```bash
npm run test:smoke:deployment
npm run telemetry:rollout-gate -- --dir "${AGENTIC_TELEMETRY_RETENTION_DIR:-.agentic/telemetry}"
```

5. Investigate the failed release before attempting another deploy.

Do not attempt to roll schema backward automatically during incident response unless you have a separately tested backward migration plan. Agentic rollbacks should restore the previous application version while keeping schema changes explicit and operator-reviewed.
