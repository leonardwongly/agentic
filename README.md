# Agentic

Agentic is a trusted execution control plane for goals, commitments, approvals, automations, memories, documents, and integrations. It is built as a TypeScript-first modular monolith with a Next.js web surface, a durable worker-backed execution loop, tenant-scoped provider credentials, governance and privacy controls, and a reproducible `agentic.docx` pipeline.

## What It Does

Agentic keeps work inside a bounded operating loop:

1. capture goals, commitments, and workspace signals
2. classify risk and apply governance
3. decide whether to draft, request approval, or execute
4. run through provider-neutral integrations and worker jobs
5. persist outcomes, evidence, audit history, and learned context

The current product surface includes:

- a commitment-first dashboard and core-loop API
- async goal creation and briefing generation with durable job polling
- GitHub issue automation that enqueues governed Agentic worker jobs from issue opens, labels, and authorized comments
- agents, templates, workflow templates, watchers, and operator products
- approvals, autopilot events, and governance-aware execution paths
- memories and self-improving outcome capture
- tenant-scoped Google integrations with readiness-aware activation
- local-notes, Slack, and Telegram integration surfaces
- privacy lifecycle operations for retention, export, and workspace deletion
- document rendering and validation for the checked-in `agentic.docx` pipeline
- observability rollout gates, compliance evidence collection, and security regression tooling

## Architecture At A Glance

- `apps/web`: Next.js UI, JSON API routes, session handling, readiness endpoints, and dashboard surfaces
- `apps/worker`: durable worker process for queued goal, briefing, template, docs, autopilot, GitHub issue intake, and privacy jobs
- `packages/contracts`: shared schemas and runtime contracts
- `packages/db`: Postgres schema, migrations, and schema-readiness checks
- `packages/orchestrator`: workflow assembly, routing, approvals, and execution coordination
- `packages/policy`: governance rules, conformance checks, and simulation logic
- `packages/repository`: persistence access for dashboards, goals, commitments, templates, integrations, and audits
- `packages/integrations`: provider-neutral adapter contracts, connector readiness, and managed Google credential logic
- `packages/memory`: memory records, ranking, and retrieval behavior
- `packages/self-improvement-memory`: outcome capture, recommendation replay, and learned execution intelligence
- `packages/execution`: task and workflow execution state
- `packages/worker-runtime`: durable queue contracts, claiming, retries, leases, and dead-letter handling
- `packages/docs-runtime`: document rendering helpers and output contracts
- `packages/notifications`: Slack and Telegram notification delivery
- `packages/observability`: telemetry capture, execution evidence, and rollout-gate inputs
- `packages/agents`: bounded specialist outputs used by higher-level workflows
- `docs/specs/agentic.md`: deeper product and architecture specification
- `docs/templates/reference.docx`: Word template/reference for document rendering
- `scripts`: deployment, docs, observability, security, and worktree automation helpers

## Connector Readiness

Integrations are described by operational readiness rather than connection state alone:

- `experimental`: visible but not ready for trustworthy draft or live execution
- `draft-grade`: safe for draft-only assistance
- `approval-grade`: live actions are available, but still require operator approval
- `autonomous-grade`: approved for higher-trust autonomous execution paths

This keeps the dashboard, NL surface, and API contract aligned with what the system can safely execute.

## Prerequisites

- Node.js `20.x` or `22.x`; the repo pins local version hints in `.nvmrc` and `.node-version`
- npm
- PostgreSQL, if you want shared-state local parity or any production-like run
- `pandoc`, required for `npm run docs:render` and `npm run docs:build`
- LibreOffice `soffice`, optional but recommended for PDF smoke rendering during `npm run docs:validate`

## Getting Started

Agentic supports two useful local setups:

- a minimal local run with the file-backed runtime store
- a Postgres-backed local run that more closely matches production behavior

### First-Run Checklist

Use this checklist when setting up a fresh checkout:

1. Confirm Node.js is a supported LTS release:

```bash
node --version
```

2. Install workspace dependencies:

```bash
npm install
```

3. Run the local first-run readiness check:

```bash
npm run setup:check
```

This check is read-only. It validates the supported Node range and required repo files, then warns when dependencies, `AGENTIC_ACCESS_KEY`, or Postgres parity configuration are missing.

4. Choose a persistence mode:

- file-backed development: leave `DATABASE_URL` unset
- Postgres parity: set `DATABASE_URL`, run migrations, and use `npm run db:status`

| Setup mode | Required env | Supported commands | Notes |
| --- | --- | --- | --- |
| File-backed development | `AGENTIC_ACCESS_KEY`; optional `AGENTIC_RUNTIME_STORE_PATH` | `npm run dev`, `npm run worker:start`, `npm test`, `/api/ready` | Fast local path. Database commands that require `DATABASE_URL` are expected to fail. |
| Postgres parity | `DATABASE_URL`, `AGENTIC_ACCESS_KEY` | File-backed commands plus `npm run db:migrate` and `npm run db:status -- --require-ready` | Use this for shared-state validation and production-like readiness. |

5. Set a dashboard/API access key before sharing the environment:

```bash
export AGENTIC_ACCESS_KEY=replace-this-with-a-long-random-secret
```

6. Start the web app and, for queued work, the worker in separate terminals:

```bash
npm run dev
```

```bash
npm run worker:start
```

7. Validate the setup:

```bash
npm run lint
npm run typecheck
npm run format:check
npm run release:check-context
npm test
npm run test:security:regression
```

8. Unlock the dashboard and use the in-app first-run checklist. It follows the same order as this section: access key, web runtime, storage readiness, worker/queue readiness, first request, approval path, local notes, optional integrations, and repeatable workflows.

### Path 1: Minimal local run

This is the fastest way to boot the app locally. It uses the file-backed runtime store at `.agentic/runtime-store.json`.

1. Install dependencies:

```bash
npm install
```

2. Set an access key for the dashboard and API:

```bash
export AGENTIC_ACCESS_KEY=replace-this-with-a-long-random-secret
```

If you do not set `AGENTIC_ACCESS_KEY`, local development falls back to `agentic-local-dev-key`. That fallback is for local use only; do not rely on it in shared or production environments.

3. Start the web app:

```bash
npm run dev
```

The app runs at [http://localhost:3000](http://localhost:3000).

4. Start the worker in a second terminal when you want queued work to complete:

```bash
npm run worker:start
```

Run the worker for:

- async goal creation
- briefing jobs
- template runs
- docs render jobs
- autopilot events
- GitHub issue intake jobs
- privacy retention, export, and deletion jobs

Without the worker, those job APIs will enqueue work but it will remain pending.

The file-backed repository is development-only. Production refuses to start without `DATABASE_URL`, and production-like local validation should use the Postgres path below.

### Path 2: Postgres-backed local parity

Use this path when you want shared persistence, migration validation, or behavior closer to production.

1. Install dependencies:

```bash
npm install
```

2. Configure Postgres and the dashboard access key:

```bash
export DATABASE_URL=postgres://user:password@localhost:5432/agentic
export AGENTIC_ACCESS_KEY=replace-this-with-a-long-random-secret
```

3. Apply checked-in migrations:

```bash
npm run db:migrate
```

4. Optional: opt development into shared auth-state behavior:

```bash
export AGENTIC_SHARED_AUTH_STATE=true
```

This lets development use the same shared auth-state backend that production expects when `DATABASE_URL` is present.
Shared auth state depends on the checked-in auth runtime schema objects in `packages/db/migrations`; runtime request handling verifies those tables and indexes but does not create them.

If you want development or test to fail closed the same way production does, also set:

```bash
export AGENTIC_REQUIRE_SHARED_AUTH_STATE=true
```

5. Start the web app and worker:

```bash
npm run dev
npm run worker:start
```

### Sign In And Create A Session

You can sign in through the dashboard UI, or create a session directly:

```bash
curl -i \
  -X POST http://localhost:3000/api/session \
  -H 'content-type: application/json' \
  -d '{"accessKey":"replace-this-with-a-long-random-secret"}'
```

The server will issue the `agentic_session` cookie used by authenticated routes.

For access-key authenticated automation paths, the request header is:

```text
x-agentic-access-key
```

### Quick Health And Readiness Checks

```bash
curl http://localhost:3000/api/health
curl http://localhost:3000/api/ready
```

`/api/ready` validates more than process liveness. It checks:

- access-key configuration
- database reachability and migration readiness
- auth runtime-state safety
- request identity trust configuration
- async execution readiness
- connector health

## Async Execution Model

Agentic intentionally moves high-cost and stateful work off the request path.

- `POST /api/goals` enqueues goal creation and returns `202 Accepted` with a pollable job status URL
- `POST /api/briefing` enqueues briefing generation and returns `202 Accepted` with a pollable job status URL
- template, docs, autopilot, and privacy flows follow the same durable worker-backed pattern where appropriate
- retries, leases, and dead-letter handling preserve operator-visible recovery state without exposing raw backend failure details

For realistic local validation of the product, run both the web app and the worker.

The canonical API route inventory lives in [`docs/specs/api-route-inventory.md`](docs/specs/api-route-inventory.md). Update it in the same change as any new `apps/web/app/api/**/route.ts` handler.

## Environment And Runtime Configuration

### Required For Production

```bash
export NODE_ENV=production
export DATABASE_URL=postgres://user:password@db-host:5432/agentic
export AGENTIC_ACCESS_KEY=replace-this-with-a-long-random-secret
```

Production also expects:

- trusted proxy headers only when the app is deployed behind a proxy that overwrites them:

```bash
export AGENTIC_TRUST_PROXY_HEADERS=true
```

- shared auth-state backing instead of process-local auth state

Production fails closed when session revocation, unlock throttling, or rate limiting are still process-local. The only escape hatch is:

```bash
export AGENTIC_ALLOW_PROCESS_LOCAL_AUTH_STATE=true
```

Use that only for explicitly accepted single-instance deployments.

### Useful Local Overrides

```bash
export AGENTIC_RUNTIME_STORE_PATH=/tmp/agentic-runtime-store.json
export AGENTIC_NOTES_PATH=/tmp/agentic-notes
```

- `AGENTIC_RUNTIME_STORE_PATH` overrides the default file-backed runtime store path
- `AGENTIC_NOTES_PATH` overrides the filesystem-backed local notes directory

The default filesystem-backed notes adapter reads and writes Markdown under `.agentic/notes`.

### Worker Tuning

```bash
export AGENTIC_WORKER_RUNNER_ID=local-worker-1
export AGENTIC_WORKER_POLL_INTERVAL_MS=1000
export AGENTIC_WORKER_LEASE_MS=30000
```

These are optional and mainly useful when running multiple workers or tuning claim/lease behavior.

## Optional Integrations

### Google OAuth And Managed Credentials

Use these when you want Google connect/callback flows and tenant-scoped managed credentials:

```bash
export GOOGLE_CLIENT_ID=replace-with-your-client-id
export GOOGLE_CLIENT_SECRET=replace-with-your-client-secret
```

When either value is missing, Google-managed integrations remain visible as manual/setup-required adapters. The dashboard stays in context and reports that OAuth is not configured instead of sending the browser to the raw connect endpoint response.

The repo also still supports a direct refresh-token path for legacy/local use:

```bash
export GOOGLE_REFRESH_TOKEN=replace-with-your-refresh-token
```

When storing tenant-scoped provider credentials, configure the encrypted secret wrapper:

```bash
export AGENTIC_PROVIDER_SECRET_KEY=replace-with-a-strong-secret
export AGENTIC_PROVIDER_SECRET_KEY_VERSION=2026-04-18
```

### Slack

```bash
export SLACK_BOT_TOKEN=xoxb-...
export SLACK_SIGNING_SECRET=replace-with-a-long-random-secret
export SLACK_DEFAULT_CHANNEL=C0123456789
export SLACK_USER_MAP=U0123456789:user-id
```

### Telegram

```bash
export TELEGRAM_BOT_TOKEN=123456:replace-with-your-bot-token
export TELEGRAM_WEBHOOK_SECRET=replace-with-a-long-random-webhook-secret
export TELEGRAM_DEFAULT_CHAT_ID=-1001234567890
export TELEGRAM_USER_MAP=123456789:user-id,-1001234567890/123456789:user-id
```

Telegram approval actions use short server-stored action IDs so they fit Telegram `callback_data` limits. The webhook requires the `x-telegram-bot-api-secret-token` header to match `TELEGRAM_WEBHOOK_SECRET`.

### GitHub Issue Autopilot

Use these when you want GitHub issue activity to create governed Agentic worker jobs:

```bash
export AGENTIC_GITHUB_WEBHOOK_SECRET=replace-with-a-long-random-webhook-secret
export AGENTIC_GITHUB_ISSUE_ALLOWED_REPOSITORIES=owner/repo
```

In GitHub, configure the matching `AGENTIC_GITHUB_WEBHOOK_SECRET` repository secret and set the `AGENTIC_GITHUB_ISSUE_WEBHOOK_URL` repository variable to `https://<agentic-host>/api/github/issues/webhook`.

By default, `issues.opened` and `issues.reopened` enqueue intake work, `agentic:plan` enqueues plan-only work, `agentic:work` enqueues implementation work, and exact `/agentic plan` or `/agentic work` issue comments are accepted from `OWNER`, `MEMBER`, or `COLLABORATOR` commenters. See [docs/runbooks/github-issue-autopilot.md](docs/runbooks/github-issue-autopilot.md) for label, command, allowlist, and authorization knobs.

To have Agentic also poll currently open issues through a GitHub App installation, create a GitHub App with read-only metadata and issues permissions and configure:

```bash
export AGENTIC_GITHUB_APP_ID=12345
export AGENTIC_GITHUB_APP_INSTALLATION_ID=98765
export AGENTIC_GITHUB_APP_PRIVATE_KEY='-----BEGIN PRIVATE KEY-----...'
export AGENTIC_GITHUB_APP_SYNC_SECRET=replace-with-a-long-random-sync-secret
```

Set the GitHub repository secret `AGENTIC_GITHUB_APP_SYNC_SECRET` and variable `AGENTIC_GITHUB_APP_ISSUE_SYNC_URL` to `https://<agentic-host>/api/github/issues/app/sync`. The URL must target that exact path without embedded credentials, query strings, or fragments. The scheduled/manual GitHub App issue sync workflow calls Agentic, Agentic authenticates as the installation, lists allowlisted open issues, skips pull requests, and queues the existing governed `github_issue_intake` jobs in `work` mode by default. Scheduled runs require a durable HTTPS host; temporary tunnel URLs are skipped on schedules and require `allow_temporary_url=true` for manual validation.

## Validation And Quality Gates

Run the core validation suite:

```bash
npm test
npm run test:architecture:fitness
npm run test:performance:fitness
npm run test:security:regression
npm run build
```

Additional useful validation commands:

```bash
npx playwright install chromium
npm run test:e2e

npm run test:smoke:capabilities
npm run test:smoke:observability
npm run test:smoke:observability-export
npm run test:smoke:deployment
npm run test:smoke:deployment-async

npm run security:audit-runtime
npm run security:sbom
npm run security:collect-evidence
```

`npm run test:e2e` starts an isolated web app and worker stack on port `3201` by default. Stop a manually running `npm run dev` server before running E2E; Next.js protects a checkout with a dev-server lock, and the Playwright helper will now fail early with the detected lock path instead of surfacing a raw framework startup error. To use another isolated port, set `PLAYWRIGHT_E2E_PORT=3202` or another unused port.

## Observability Rollout Gates

The observability package can retain sanitized telemetry locally and optionally export the same batches to a collector.

Optional exporter configuration:

```bash
export AGENTIC_TELEMETRY_RETENTION_DIR=.agentic/telemetry
export AGENTIC_TELEMETRY_EXPORT_URL=https://telemetry.example.com/ingest
export AGENTIC_TELEMETRY_EXPORT_TOKEN=replace-with-a-telemetry-ingest-token
```

Useful observability checks:

```bash
npm run test:smoke:observability
npm run test:smoke:observability-export
npm run telemetry:rollout-gate -- --dir "${AGENTIC_TELEMETRY_RETENTION_DIR:-.agentic/telemetry}"
```

The checked-in alert and dashboard manifests live in:

- `config/observability/alerts.json`
- `config/observability/dashboard.json`

## Document Pipeline

The editable product spec lives in [`docs/specs/agentic.md`](docs/specs/agentic.md). The checked-in root `agentic.docx` is migration input only; the supported generated artifact is `build/agentic.docx`.

Render and validate the document pipeline with:

```bash
npm run docs:render
npm run docs:validate
npm run docs:build
```

`npm run docs:build` requires `pandoc`. PDF smoke rendering inside validation uses LibreOffice when available and skips that portion gracefully when it is not.

## Command Reference

These commands are the current repo-level entry points:

| Command | Purpose |
| --- | --- |
| `npm run dev` | Start the Next.js web app in development mode. |
| `npm run worker:start` | Start the worker package against the configured repository backend. |
| `npm run setup:check` | Check fresh-checkout readiness for Node, required files, dependencies, access key, and database mode. |
| `npm run lint` | Validate repo-owned hygiene contracts, CI gate wiring, and W10 issue evidence references. |
| `npm run typecheck` | Run TypeScript validation for production app and package surfaces with `tsconfig.typecheck.json`. |
| `npm run format:check` | Check changed text files for LF endings, final newline, and trailing whitespace. |
| `npm run release:check-context` | Reject local artifacts, environment files, logs, packaged outputs, and secret-like filenames from release context. |
| `npm run build` | Build the web app and run the worker TypeScript check. |
| `npm test` | Run the full Vitest suite. |
| `npm run test:security:regression` | Run the categorized security regression suite. |
| `npm run test:architecture:fitness` | Check architecture constraints. |
| `npm run test:parallel-worktree:fitness` | Check parallel-worktree ownership constraints. |
| `npm run test:performance:fitness` | Run performance fitness checks and the performance test file. |
| `npm run deploy:ingress:check` | Validate stable HTTPS ingress, proxy trust posture, smoke auth, and provider deploy wiring. |
| `npm run remediation:dashboard` | Render the checked-in AOS remediation tracker with a git snapshot. |
| `npm run remediation:verify` | Verify live AOS tracker issue coverage and render the remediation dashboard. |
| `npm run db:status -- --require-ready` | Verify database reachability and migration readiness; requires `DATABASE_URL` and is not part of the file-backed minimal path. |
| `npm run db:migrate` | Apply checked-in database migrations. |
| `npm run docs:build` | Render and validate the generated `build/agentic.docx` artifact. |
| `npm run security:audit-runtime` | Enforce runtime dependency vulnerability policy. |
| `npm run security:sbom` | Generate the software bill of materials. |
| `npm run hygiene:repo` | Report stale branches, stale PRs, and dirty worktrees without mutating GitHub or local worktrees. |

Dependency Review in GitHub Actions requires repository support for GitHub's dependency graph / Advanced Security. The runtime dependency gate remains `npm run security:audit-runtime`, which is the repo-owned check to run locally and in CI.

## Production Bootstrap

Production startup is intentionally split into explicit migration, readiness, and process-launch steps so request handling does not mutate schema state implicitly.

1. Configure required production environment:

```bash
export NODE_ENV=production
export DATABASE_URL=postgres://user:password@db-host:5432/agentic
export AGENTIC_ACCESS_KEY=replace-this-with-a-long-random-secret
```

2. Check schema status before rollout:

```bash
npm run db:status -- --require-ready
```

3. Apply checked-in migrations from `packages/db/migrations` when needed:

```bash
npm run db:migrate
```

4. Build and start the web app through the readiness wrapper:

```bash
npm run build
npm run start:web:prod -- --hostname 0.0.0.0 --port 3000
```

5. Start the worker through the schema-readiness wrapper:

```bash
npm run start:worker:prod
```

The web startup wrapper fails closed if required production configuration is missing, if the database is unreachable, or if checked-in migrations have not been applied. The worker startup wrapper refuses to start until the schema is ready.
Schema readiness also checks the shared auth runtime tables and indexes (`auth_session_rate_limits`, `auth_revoked_sessions`, and `session_unlock_attempts`). If an existing database has migration metadata but is missing those objects, run `npm run db:migrate` before starting the web or worker processes; do not rely on request traffic to bootstrap auth/session tables.

## Operational Endpoints

Agentic exposes two unauthenticated operational endpoints for orchestration and deployment validation:

- `GET /api/health`: liveness probe with uptime and timestamp
- `GET /api/ready`: readiness probe covering configuration, storage, auth runtime state, request identity, async execution, and connector health

Both routes return `Cache-Control: no-store` and are safe for container probes and deployment smoke tests.

The deployment smoke helper exercises those endpoints against a live environment:

```bash
export AGENTIC_SMOKE_BASE_URL=https://agentic.example.com
export AGENTIC_SMOKE_ACCESS_KEY=replace-this-with-a-long-random-secret
export AGENTIC_TRUST_PROXY_HEADERS=true
npm run test:smoke:deployment
```

Before running a provider-backed staging or production-like deploy, validate that the smoke target is a stable HTTPS ingress and not a temporary tunnel or local address:

```bash
export NODE_ENV=production
export AGENTIC_SMOKE_BASE_URL=https://agentic.example.com
export AGENTIC_SMOKE_ACCESS_KEY=replace-this-with-a-long-random-secret
export AGENTIC_TRUST_PROXY_HEADERS=true
export AGENTIC_STAGING_DEPLOY_BIN=./scripts/provider-deploy.sh
export AGENTIC_STAGING_DEPLOY_ARGS_JSON='["--environment","staging"]'
npm run deploy:ingress:check
```

Only set `AGENTIC_TRUST_PROXY_HEADERS=true` after confirming the ingress proxy overwrites forwarded client-IP headers at the edge.

## Parallel Delivery

Agentic supports a checked-in parallel worktree model for roadmap slices that need multiple low-conflict streams at once.

- `npm run worktree:setup -- --print-only`: preview the standard stream layout
- `npm run worktree:setup`: create sibling worktrees for the standard streams
- `npm run worktree:status`: inspect branch, head, and dirty-state across planned worktrees
- `npm run worktree:cleanup -- --print-only`: preview which completed stream worktrees and merged branches are safe to remove
- `npm run worktree:cleanup`: remove clean worktrees and delete fully merged stream branches
- `npm run hygiene:repo -- --max-age-days 21`: report stale branches, stale PRs, and dirty worktrees before cleanup decisions

CI enforces the ownership model as part of `npm run test:architecture:fitness`: shared protected files are spine-only, and stream-protected files must be changed from their owning stream branch or from the integrated base branch.

See [`docs/runbooks/parallel-worktrees.md`](docs/runbooks/parallel-worktrees.md) for ownership rules, merge order, validation requirements, and cleanup flow.

## Persistence, Security, And Privacy

- If `DATABASE_URL` is set, the app uses the Postgres-backed repository
- otherwise it falls back to a file-backed runtime store at `.agentic/runtime-store.json`
- production requires `DATABASE_URL`
- authenticated API routes are scoped to the signed-in principal instead of a global fallback user
- session-authenticated and access-key-authenticated writes carry explicit actor context into approval and audit records
- login throttling and unlock throttling ignore forwarded client-IP headers by default
- connector readiness controls what the UI and API are allowed to advertise and execute
- approval and execution evidence is persisted so operator-visible state matches what actually ran
- privacy lifecycle operations run through worker-backed retention, export, and deletion paths with sanitized failure state

Security and compliance supporting material lives in:

- [`docs/security/compliance-evidence.md`](docs/security/compliance-evidence.md)
- [`docs/security/security-regression-suite.md`](docs/security/security-regression-suite.md)
- [`docs/security/supply-chain-controls.md`](docs/security/supply-chain-controls.md)
- [`docs/runbooks/security-incident-response.md`](docs/runbooks/security-incident-response.md)
- [`docs/runbooks/security-disclosure.md`](docs/runbooks/security-disclosure.md)
- [`docs/runbooks/vulnerability-management.md`](docs/runbooks/vulnerability-management.md)

## Additional References

- [`docs/specs/agentic.md`](docs/specs/agentic.md)
- [`docs/runbooks/deployment.md`](docs/runbooks/deployment.md)
- [`docs/runbooks/github-issue-autopilot.md`](docs/runbooks/github-issue-autopilot.md)
- [`docs/templates/reference.docx`](docs/templates/reference.docx)
