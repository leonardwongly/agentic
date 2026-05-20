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
export AGENTIC_INGRESS_PROVIDER=render
export AGENTIC_INGRESS_ENVIRONMENT=production-like
export AGENTIC_INGRESS_ROLLOUT_MODE=manual-only
export AGENTIC_INGRESS_ROLLBACK_AUTHORITY=platform-operator
export AGENTIC_TRUST_PROXY_HEADERS=true
export AGENTIC_PROXY_HEADER_OVERWRITE_CONFIRMED=true
export AGENTIC_TRUSTED_CLIENT_IP_HEADER=x-forwarded-for
export AGENTIC_STAGING_DEPLOY_BIN=./scripts/provider-deploy.sh
export AGENTIC_STAGING_DEPLOY_ARGS_JSON='["--environment","staging"]'
export AGENTIC_STAGING_IMAGE_TAG=agentic:<tag>
export AGENTIC_TELEMETRY_RETENTION_DIR=.agentic/telemetry
export AGENTIC_TELEMETRY_EXPORT_URL=https://telemetry.example.com/ingest
export AGENTIC_TELEMETRY_EXPORT_TOKEN=replace-this-with-a-telemetry-ingest-token
export AGENTIC_DASHBOARD_COCKPIT=legacy
```

`AGENTIC_STAGING_DEPLOY_BIN` and `AGENTIC_STAGING_DEPLOY_ARGS_JSON` are the CI contract for the provider-backed staging release step. The command is executed without a shell, so pass structured arguments instead of a shell pipeline.

## Stable Ingress Contract

External staging and production-like rollout evidence must come from a stable HTTPS origin. Temporary tunnel domains, localhost or private-network addresses, URL credentials, URL paths, URL query strings, and URL fragments are not accepted as the deployment smoke target.

The stable ingress gate also requires the target identity and rollback contract
to be encoded in environment, not just mentioned in prose. Set
`AGENTIC_INGRESS_PROVIDER`, `AGENTIC_INGRESS_ENVIRONMENT`,
`AGENTIC_INGRESS_ROLLOUT_MODE`, and
`AGENTIC_INGRESS_ROLLBACK_AUTHORITY` before running the gate. Keep
`AGENTIC_PROXY_HEADER_OVERWRITE_CONFIRMED=false` or unset until the provider has
been verified to overwrite the configured client-IP header at the edge.

## First Container Target Candidate

The lowest-friction full Node/container target currently supported by the repository is a Render Blueprint deployment using the checked-in Dockerfile. Render's Blueprint model supports the three resources Agentic needs for the first production-like target: a Docker web service for the Next.js web/API process, a Docker background worker service for the durable worker loop, and managed Postgres shared by both processes.

The prepared Blueprint template lives at `deploy/render/render.yaml` instead of the repository root. This is deliberate: Render's default Blueprint path is `render.yaml`, so keeping the template under `deploy/render/` prevents accidental provider sync before #141 has an approved provider, owner, hostname, and rollback authority.

The candidate target shape is:

| Resource | Runtime | Command | Purpose |
| --- | --- | --- | --- |
| `agentic-web` | Docker from `./Dockerfile` | `npm run start:web:prod -- --hostname 0.0.0.0 --port $PORT` | Runs `npm run db:migrate` as the pre-deploy command, then serves Next.js web/API, `/api/health`, `/api/ready`, and GitHub App sync ingress. |
| `agentic-worker` | Docker from `./Dockerfile` | `npm run start:worker:prod` | Processes durable worker jobs against the same Postgres database after startup schema-readiness validation. |
| `agentic-postgres` | Render Postgres | Managed by provider | Stores application state, shared auth runtime state, queues, leases, and worker recovery data. |

Both Render services set `autoDeployTrigger: off` for first setup. Keep this
manual posture until the target environment, rollout owner, rollback path, and
health/readiness gates have been proven. The web service owns the migration
pre-deploy command so migrations run once before the web deploy is promoted; the
worker validates the schema at startup and fails closed instead of racing the
migration step.

Current provider blocker:

- `render blueprints validate deploy/render/render.yaml --output json` reaches
  Render but currently returns `need_payment_info` for `agentic-postgres`,
  `agentic-web`, and `agentic-worker`.
- No Render services or datastores have been created yet. Add payment info to
  the `leonardwongly` Render workspace before the first Blueprint sync.

Required confirmation before provider setup:

- target workspace/account owner
- target environment name, initially `staging` or `production-like`
- stable HTTPS hostname, either provider-assigned or custom DNS
- rollback authority and previous-image restore path
- confirmation that the provider overwrites the configured canonical client-IP header before `AGENTIC_TRUST_PROXY_HEADERS=true` and `AGENTIC_TRUSTED_CLIENT_IP_HEADER=<header>` are accepted

After billing is available, run the first provider sync manually:

```bash
render workspace current --output json
render blueprints validate deploy/render/render.yaml --output json
```

Then create or sync the Blueprint from the Render dashboard using
`deploy/render/render.yaml` as the Blueprint path. Keep Auto Sync disabled on
the Blueprint until the first rollout and rollback path are captured.

After the sync, verify Render created the expected resources:

```bash
render services --output json
```

Capture the generated `agentic-web` stable HTTPS URL before configuring GitHub
Actions or the GitHub App issue sync URL.

After the target is approved and created, configure GitHub Actions for provider-backed staging with the stable base origin and provider deploy command:

```bash
gh secret set STAGING_BASE_URL --repo leonardwongly/agentic --body "https://agentic.example.com"
gh secret set STAGING_SMOKE_ACCESS_KEY --repo leonardwongly/agentic --body "<same class of value as AGENTIC_ACCESS_KEY>"
gh variable set STAGING_INGRESS_PROVIDER --repo leonardwongly/agentic --body "render"
gh variable set STAGING_INGRESS_ENVIRONMENT --repo leonardwongly/agentic --body "production-like"
gh variable set STAGING_INGRESS_ROLLOUT_MODE --repo leonardwongly/agentic --body "manual-only"
gh variable set STAGING_INGRESS_ROLLBACK_AUTHORITY --repo leonardwongly/agentic --body "<operator-or-team>"
gh variable set STAGING_TRUST_PROXY_HEADERS --repo leonardwongly/agentic --body "true"
gh variable set STAGING_PROXY_HEADER_OVERWRITE_CONFIRMED --repo leonardwongly/agentic --body "true"
gh variable set STAGING_TRUSTED_CLIENT_IP_HEADER --repo leonardwongly/agentic --body "x-forwarded-for"
gh variable set STAGING_DEPLOY_BIN --repo leonardwongly/agentic --body "<provider deploy executable>"
gh secret set STAGING_DEPLOY_ARGS_JSON --repo leonardwongly/agentic --body '["<provider>","<args>"]'
```

Do not set `AGENTIC_GITHUB_APP_ISSUE_SYNC_URL` until the deployed stable URL passes `/api/health`, `/api/ready`, and the deployment smoke checks.

Use the stable ingress preflight before a provider-backed deployment:

```bash
export NODE_ENV=production
export AGENTIC_INGRESS_PROVIDER=render
export AGENTIC_INGRESS_ENVIRONMENT=production-like
export AGENTIC_INGRESS_ROLLOUT_MODE=manual-only
export AGENTIC_INGRESS_ROLLBACK_AUTHORITY=platform-operator
export AGENTIC_SMOKE_BASE_URL=https://agentic.example.com
export AGENTIC_SMOKE_ACCESS_KEY=replace-this-with-a-long-random-secret
export AGENTIC_TRUST_PROXY_HEADERS=true
export AGENTIC_PROXY_HEADER_OVERWRITE_CONFIRMED=true
export AGENTIC_TRUSTED_CLIENT_IP_HEADER=x-forwarded-for
export AGENTIC_WORKER_HEALTH_PATH=/var/lib/agentic/worker-health.json
export AGENTIC_STAGING_DEPLOY_BIN=./scripts/provider-deploy.sh
export AGENTIC_STAGING_DEPLOY_ARGS_JSON='["--environment","staging"]'
npm run deploy:ingress:check
```

`AGENTIC_TRUST_PROXY_HEADERS=true` is only safe after confirming the ingress provider overwrites the single header named by `AGENTIC_TRUSTED_CLIENT_IP_HEADER` at the edge. Supported values are `x-forwarded-for`, `x-real-ip`, and `cf-connecting-ip`. Do not enable proxy trust behind an ingress that forwards that configured header from users unchanged.
`AGENTIC_WORKER_HEALTH_PATH` must point to a small JSON heartbeat file that the worker can write and the web process can read. In production, `/api/ready` fails closed when this value is absent, unreadable, stale, or reports an error state. On multi-container providers, mount this path on a shared volume or use an equivalent provider-supported shared filesystem path before treating readiness as authoritative.

For GitHub Actions, configure these repository secrets and variables before expecting `.github/workflows/staging-manual-deploy.yml` to run in external mode:

| GitHub setting | Maps to | Purpose |
| --- | --- | --- |
| `STAGING_BASE_URL` secret | `AGENTIC_SMOKE_BASE_URL` | Stable HTTPS origin used by ingress preflight and deployment smoke tests. |
| `STAGING_SMOKE_ACCESS_KEY` secret | `AGENTIC_SMOKE_ACCESS_KEY` | Allows the smoke suite to verify authenticated session bootstrap. |
| `STAGING_INGRESS_PROVIDER` variable | `AGENTIC_INGRESS_PROVIDER` | Names the approved provider, currently `render` for the first target. |
| `STAGING_INGRESS_ENVIRONMENT` variable | `AGENTIC_INGRESS_ENVIRONMENT` | Must be `staging`, `production-like`, or `production`. |
| `STAGING_INGRESS_ROLLOUT_MODE` variable | `AGENTIC_INGRESS_ROLLOUT_MODE` | Must be `manual-only`, `scheduled-disabled`, or `scheduled-enabled`. |
| `STAGING_INGRESS_ROLLBACK_AUTHORITY` variable | `AGENTIC_INGRESS_ROLLBACK_AUTHORITY` | Names the operator or team allowed to roll back or disable the target. |
| `STAGING_TRUST_PROXY_HEADERS` variable | `AGENTIC_TRUST_PROXY_HEADERS` | Must be `true` after proxy overwrite behavior is confirmed. |
| `STAGING_PROXY_HEADER_OVERWRITE_CONFIRMED` variable | `AGENTIC_PROXY_HEADER_OVERWRITE_CONFIRMED` | Must be `true` only after the provider overwrites the configured client-IP header at the edge. |
| `STAGING_TRUSTED_CLIENT_IP_HEADER` variable | `AGENTIC_TRUSTED_CLIENT_IP_HEADER` | Names the one ingress-overwritten client-IP header to trust. |
| `STAGING_DEPLOY_BIN` variable | `AGENTIC_STAGING_DEPLOY_BIN` | Provider deploy executable. |
| `STAGING_DEPLOY_ARGS_JSON` secret | `AGENTIC_STAGING_DEPLOY_ARGS_JSON` | Provider deploy arguments as a JSON string array. |

When any external staging setting is missing, the workflow falls back to the runner-local self-test path and does not deploy to a provider-backed ingress.

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

5. Validate the full production bootstrap contract.

```bash
npm run production:bootstrap:check
```

This check combines production runtime mode, Postgres configuration, schema readiness, shared-auth enforcement, access-key presence, trusted proxy header configuration, and worker heartbeat configuration into one redacted evidence report. Use `npm run production:bootstrap:check -- --static-only` only as a local preflight when the real provider database is unavailable; it does not replace target database proof. See [Postgres Shared Auth Bootstrap](./postgres-shared-auth-bootstrap.md) for the operator runbook.

6. Run the automated test suite before rollout.

```bash
npm test
npm run test:e2e
npm run test:smoke:observability-export
```

The E2E suite should be treated as the pre-rollout check that exercises worker-backed goal flows from the user surface. The deployment smoke suite validates the deployed web boundary and rollout-gate telemetry after release.

7. Validate the stable ingress contract before invoking a provider deploy.

```bash
npm run deploy:ingress:check
```

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
export AGENTIC_WORKER_HEALTH_PATH=/var/lib/agentic/worker-health.json
npm run start:worker:prod
```

Do not skip the worker rollout. Goal creation, autopilot execution, and privacy lifecycle operations depend on the worker runtime and will remain queued if only the web process is healthy. The worker writes heartbeat snapshots to `AGENTIC_WORKER_HEALTH_PATH`; readiness treats a missing or stale heartbeat as failed production startup even when queue depth and dead-letter counts are otherwise clean.

5. Verify liveness and readiness from outside the deployment boundary.

```bash
curl -fsS https://agentic.example.com/api/health
curl -fsS https://agentic.example.com/api/ready
```

6. Run the scripted smoke check.

```bash
npm run test:smoke:deployment
npm run test:smoke:deployment-async
npm run test:smoke:github-app-sync
npm run telemetry:rollout-gate -- --dir "${AGENTIC_TELEMETRY_RETENTION_DIR:-.agentic/telemetry}"
```

The GitHub App sync smoke first sends an invalid bearer token to the deployed
sync route and requires `401`, then performs the valid sync and worker polling.
This proves fail-closed route authentication before any live intake job is
accepted.

7. Review queue-behavior sanity signals before traffic is considered healthy.

Minimum rollout expectations:

- enqueue latency remains within the checked-in sanity budget
- a small staged backlog drains promptly
- retry churn stays bounded to the expected transient-retry budget
- duplicate execution remains absent when competing workers poll the same queue

## Smoke Validation Expectations

Successful smoke validation confirms:

- the container is live and serving `/api/health`
- readiness passes on `/api/ready`, including async execution backlog health and a fresh worker heartbeat
- authenticated session bootstrap works when `AGENTIC_SMOKE_ACCESS_KEY` is provided
- a deployed goal request can be enqueued and completed through the live worker path
- GitHub App issue sync can enqueue `github_issue_intake` jobs and the deployed worker can drain the returned job status URLs to completion
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
npm run test:smoke:github-app-sync
npm run telemetry:rollout-gate -- --dir "${AGENTIC_TELEMETRY_RETENTION_DIR:-.agentic/telemetry}"
```

The GitHub App sync smoke output includes `negativeAuthStatus: 401`; treat any
other status as a release blocker because the sync route did not reject an
invalid bearer token before the valid request.

Capture:

- release artifact or image tag
- deployment timestamp
- health/readiness results
- async canary result
- rollout-gate summary
- any residual risk or operator follow-up

Before closing production-readiness work, package the evidence with the
release-closeout validator:

```bash
npm run release:closeout:evidence
```

The closeout package must link PRs, local CI, live validation, rollback,
disablement, secret rotation, and residual risks without copying secret values.
If a live gate cannot run, keep it marked blocked with the linked blocker issue
instead of treating local validation as live proof.

## Observability Rollout Artifacts

The rollout path is backed by checked-in observability config:

- `config/observability/alerts.json`: gate and advisory thresholds for HTTP, worker, and provider metrics
- `config/observability/dashboard.json`: dashboard panel definitions for the same metric families
- `docs/runbooks/dashboard-cockpit-rollout.md`: feature flag, telemetry thresholds, privacy rules, and rollback for the dashboard cockpit

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
