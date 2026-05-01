# Deployment Runbook

## Purpose

This runbook defines the safe rollout path for Agentic production and staging environments. The deployment contract is explicit:

- migrations run before app startup
- the web and worker processes roll independently but against the same checked-in schema contract
- readiness must pass before traffic is considered healthy
- smoke checks validate the live environment after rollout
- rollback returns traffic to the previous build without mutating schema backward in place

## Required Environment

Set these variables for every production deployment:

```bash
export NODE_ENV=production
export DATABASE_URL=postgres://user:password@db-host:5432/agentic
export AGENTIC_ACCESS_KEY=replace-this-with-a-long-random-secret
```

Only set `AGENTIC_ALLOW_PROCESS_LOCAL_AUTH_STATE=true` when production is intentionally single-instance and that tradeoff has been approved.

Optional but commonly needed:

```bash
export AGENTIC_SMOKE_BASE_URL=https://agentic.example.com
export AGENTIC_SMOKE_ACCESS_KEY=replace-this-with-a-long-random-secret
export AGENTIC_STAGING_DEPLOY_BIN=./scripts/provider-deploy.sh
export AGENTIC_STAGING_DEPLOY_ARGS_JSON='["--environment","staging"]'
export AGENTIC_STAGING_IMAGE_TAG=agentic:<tag>
export AGENTIC_TELEMETRY_RETENTION_DIR=.agentic/telemetry
export AGENTIC_TELEMETRY_EXPORT_URL=https://telemetry.example.com/ingest
export AGENTIC_TELEMETRY_EXPORT_TOKEN=replace-this-with-a-telemetry-ingest-token
```

`AGENTIC_STAGING_DEPLOY_BIN` and `AGENTIC_STAGING_DEPLOY_ARGS_JSON` are the CI contract for the provider-backed staging release step. The command is executed without a shell, so pass structured arguments instead of a shell pipeline.

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

`db:status` also verifies the shared auth runtime tables and indexes required by session rate limiting, session revocation, and unlock throttling. A `required_schema_missing` status means the database has migration metadata but is missing one or more required auth runtime objects; treat it as a release blocker and run the additive migrations before process startup.

5. Run the automated test suite before rollout.

```bash
npm test
npm run test:e2e
npm run test:smoke:observability-export
```

The E2E suite should be treated as the pre-rollout check that exercises worker-backed goal flows from the user surface. The deployment smoke suite validates the deployed web boundary and rollout-gate telemetry after release.

## Rollout Stages By Risk Class

### `P0` mutation and public surfaces

These surfaces change state, cross trust boundaries, or accept anonymous input.
Examples include goal creation/refinement, briefing creation, template
execution, docs rendering, autopilot events, privacy operations, and public
share traffic.

Required release evidence:

- `npm run test:security:regression`
- `npm run test:performance:fitness`
- `npm run test:smoke:deployment-async`
- live `/api/ready` confirmation after deploy
- live telemetry rollout gate pass

Do not shift production traffic for a `P0` release until the async canary has
completed against the deployed worker path.

### `P1` readiness and rollout-control surfaces

These surfaces determine whether operators can trust the deployment state. They
include `/api/ready`, rollout telemetry, queue health summaries, and the
deployment smoke/canary harnesses.

Required release evidence:

- `npm run test:smoke:deployment`
- `npm run telemetry:rollout-gate -- --dir "${AGENTIC_TELEMETRY_RETENTION_DIR:-.agentic/telemetry}"`
- explicit operator review of retained telemetry and queue health

Warnings on `P1` surfaces require documented owner sign-off before proceeding.
Critical failures are release blockers.

### `P2` advisory and low-blast-radius surfaces

These surfaces are descriptive, read-mostly, or operationally convenient but do
not directly mutate customer state. They can ship with warnings only when the
risk is recorded in the release notes together with an owner and follow-up date.

## Rollout Procedure

1. Build the container image.

```bash
docker build -t agentic:<tag> .
```

2. Deploy the image using the provider command contract.

```bash
export AGENTIC_STAGING_IMAGE_TAG=agentic:<tag>
npm run deploy:staging:provider
```

The provider deploy command must roll both the web and worker runtimes to the same image or release artifact. Do not continue if the provider step exits non-zero.

3. Start the web process with startup validation.

```bash
npm run start:web:prod -- --hostname 0.0.0.0 --port 3000
```

4. Start the worker process after the schema is confirmed ready.

```bash
npm run start:worker:prod
```

Do not skip the worker rollout. Goal creation, autopilot execution, and privacy lifecycle operations depend on the worker runtime and will remain queued if only the web process is healthy.

5. Verify liveness and readiness from outside the deployment boundary.

```bash
curl -fsS https://agentic.example.com/api/health
curl -fsS https://agentic.example.com/api/ready
```

6. Run the scripted smoke check.

```bash
npm run test:smoke:deployment
npm run test:smoke:deployment-async
npm run telemetry:rollout-gate -- --dir "${AGENTIC_TELEMETRY_RETENTION_DIR:-.agentic/telemetry}"
```

7. Review queue-behavior sanity signals before traffic is considered healthy.

Minimum rollout expectations:

- enqueue latency remains within the checked-in sanity budget
- a small staged backlog drains promptly
- retry churn stays bounded to the expected transient-retry budget
- duplicate execution remains absent when competing workers poll the same queue

## Smoke Validation Expectations

Successful smoke validation confirms:

- the container is live and serving `/api/health`
- readiness passes on `/api/ready`, including async execution backlog health
- authenticated session bootstrap works when `AGENTIC_SMOKE_ACCESS_KEY` is provided
- a deployed goal request can be enqueued and completed through the live worker path
- telemetry export sanitizes secret-bearing payloads before retention or backend delivery
- rollout-gate metrics stay inside the thresholds defined in `config/observability/alerts.json`
- retry churn does not exceed the bounded sanity expectations for transient failures
- duplicate execution evidence remains absent across worker telemetry and retained logs

Treat any readiness failure as a failed rollout. Do not continue shifting traffic while `/api/ready` returns `503`.
Treat any rollout-gate failure as a failed rollout, even when the deployment smoke request itself succeeds.

## Post-Release Verification

After production traffic is shifted, re-run:

```bash
curl -fsS https://agentic.example.com/api/health
curl -fsS https://agentic.example.com/api/ready
npm run test:smoke:deployment
npm run test:smoke:deployment-async
npm run telemetry:rollout-gate -- --dir "${AGENTIC_TELEMETRY_RETENTION_DIR:-.agentic/telemetry}"
```

Capture:

- release artifact or image tag
- deployment timestamp
- health/readiness results
- async canary result
- rollout-gate summary
- any residual risk or operator follow-up

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

## Rollback Triggers

Use rollback when:

- `/api/ready` returns `503` after rollout
- smoke validation fails
- request or worker error rates spike beyond accepted thresholds
- retry churn rises above the bounded release sanity budget
- duplicate execution appears in worker telemetry, action logs, or queue state
- dead letters or stale queued work increase during the post-release verification window

## Rollback

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
npm run test:smoke:deployment-async
npm run telemetry:rollout-gate -- --dir "${AGENTIC_TELEMETRY_RETENTION_DIR:-.agentic/telemetry}"
```

5. Investigate the failed release before attempting another deploy.

Do not attempt to roll schema backward automatically during incident response unless you have a separately tested backward migration plan. Agentic rollbacks should restore the previous application version while keeping schema changes explicit and operator-reviewed.

The shared auth runtime migration is additive and idempotent. Roll back a failed application release by restoring the previous application image while keeping those auth/session tables and indexes in place; dropping them can clear revocation and throttling state and should require a separate operator-approved data plan.
