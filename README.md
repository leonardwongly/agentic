# Agentic

Agentic is a TypeScript control plane for governed work: goals, commitments, approvals, automations, memories, documents, and integrations. It runs as a Next.js dashboard/API plus a separate worker process, with Postgres-backed production state and a file-backed local development mode.

The system is built around a bounded execution loop:

1. capture a request, commitment, watcher event, or integration signal
2. validate input and resolve user/workspace context
3. classify risk through governance and connector readiness
4. enqueue long-running work into durable worker jobs
5. require approval for higher-risk external action
6. persist evidence, audit state, artifacts, and learned context

## Current State

Agentic is implemented as a modular monorepo. The current product surface includes:

- a commitment-first dashboard
- authenticated JSON APIs and operational health/readiness endpoints
- worker-backed goal, briefing, template, document, privacy, autopilot, and GitHub issue jobs
- governance, approvals, memory, custom agents, workspaces, and recovery surfaces
- optional Google, Slack, Telegram, local-notes, and GitHub issue integrations
- migration, security, observability, deployment, and release-context gates

Capability readiness is tracked in `apps/web/lib/feature-capabilities.ts`. The core dashboard loop is operational; agent memory, integration setup, watchers, workflow templates, and autopilot control are still preview surfaces until their runtime readiness conditions are met.

## Repository Layout

| Path | Purpose |
| --- | --- |
| `apps/web` | Next.js dashboard, API routes, auth/session handling, readiness, security headers, and public share views. |
| `apps/worker` | Long-running worker process for durable jobs, watcher scheduling, retries, leases, and heartbeat state. |
| `packages/contracts` | Shared types, schemas, defaults, and runtime contracts. |
| `packages/db` | Postgres migrations, schema status, auth runtime schema, and migration helpers. |
| `packages/repository` | Persistence layer for Postgres and file-backed development state. |
| `packages/orchestrator` | Goal refinement, dispatch, memory capture, briefings, and workflow assembly. |
| `packages/policy` | Governance, privacy, risk, conformance, and simulation logic. |
| `packages/integrations` | Provider adapters for Google, Gmail, Calendar, Slack, Telegram, and local notes. |
| `packages/worker-runtime` | Durable job contracts, dispatch, executors, replay, leases, and health. |
| `packages/memory`, `packages/self-improvement-memory` | Memory records, review, ranking, outcome capture, and learned execution signals. |
| `packages/observability` | Telemetry, rollout gates, evidence capture, and smoke/load tooling. |
| `docs` | Specs, runbooks, security evidence, architecture notes, and templates. |
| `scripts` | Setup, CI, DB, deployment, docs, security, and worktree tooling. |

The canonical API inventory is [`docs/specs/api-route-inventory.md`](docs/specs/api-route-inventory.md).

## Requirements

- Node.js `>=20 <26`; `.nvmrc` and `.node-version` currently pin Node `20`
- npm with the checked-in `package-lock.json`
- PostgreSQL for production or production-like local validation
- `pandoc` for `npm run docs:build`
- Chromium for Playwright E2E tests via `npx playwright install chromium`

## Quick Start

```bash
git clone <your-agentic-repository-url>
cd agentic
nvm use
npm install
cp .env.example .env.local
export AGENTIC_ACCESS_KEY=replace-this-with-a-long-random-secret
export AGENTIC_BOOTSTRAP_USER_ID=owner
export AGENTIC_BOOTSTRAP_DISPLAY_NAME="Instance Owner"
export AGENTIC_DEFAULT_TIMEZONE=UTC
npm run setup:check
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

Run the worker in a second terminal when you want queued jobs to complete:

```bash
export AGENTIC_ACCESS_KEY=replace-this-with-a-long-random-secret
npm run worker:start
```

Create a session through the dashboard, or directly:

```bash
curl -i \
  -X POST http://localhost:3000/api/session \
  -H 'content-type: application/json' \
  -d '{"accessKey":"replace-this-with-a-long-random-secret"}'
```

## Local Modes

### File-Backed Development

Leave `DATABASE_URL` unset for the fastest local path. The app uses `.agentic/runtime-store.json` by default.

```bash
export AGENTIC_ACCESS_KEY=replace-this-with-a-long-random-secret
npm run dev
```

Optional:

```bash
export AGENTIC_RUNTIME_STORE_PATH=.agentic/runtime-store.json
export AGENTIC_NOTES_PATH=.agentic/notes
```

For disposable local-only runs, `AGENTIC_ENABLE_LOCAL_DEV_KEY=true` enables the fallback key `agentic-local-dev-key`. Do not use that fallback in shared, staging, or production environments.

### Postgres Parity

Use Postgres when validating migrations, shared auth state, queue behavior, or production readiness:

```bash
export DATABASE_URL=postgres://user:password@localhost:5432/agentic
export AGENTIC_ACCESS_KEY=replace-this-with-a-long-random-secret
npm run db:migrate
npm run db:status -- --require-ready
npm run dev
```

Worker:

```bash
export DATABASE_URL=postgres://user:password@localhost:5432/agentic
export AGENTIC_ACCESS_KEY=replace-this-with-a-long-random-secret
npm run worker:start
```

## Configuration

Start from `.env.example`. Common variables:

| Variable | Purpose |
| --- | --- |
| `AGENTIC_ACCESS_KEY` | Access key for dashboard session bootstrap and API automation. |
| `AGENTIC_BOOTSTRAP_USER_ID` | Install-local owner/admin user id. Required for production owner resolution. |
| `AGENTIC_BOOTSTRAP_DISPLAY_NAME` | Display name for the install-local owner seeded into new stores. |
| `AGENTIC_DEFAULT_TIMEZONE` | Default timezone for seeded briefing/user preferences. Defaults to `UTC` when unset. |
| `DATABASE_URL` | Enables the Postgres repository backend. Required in production. |
| `AGENTIC_PUBLIC_BASE_URL` | Required in production for OAuth redirects, share links, and public URLs. |
| `AGENTIC_RUNTIME_STORE_PATH` | Optional file-backed local store path. |
| `AGENTIC_NOTES_PATH` | Optional local Markdown notes path. |
| `AGENTIC_SHARED_AUTH_STATE` / `AGENTIC_REQUIRE_SHARED_AUTH_STATE` | Shared auth runtime state for Postgres-backed environments. |
| `AGENTIC_TRUST_PROXY_HEADERS` / `AGENTIC_PROXY_HEADER_OVERWRITE_CONFIRMED` / `AGENTIC_TRUSTED_CLIENT_IP_HEADER` | Production request identity configuration behind a trusted proxy that overwrites client-IP headers. |
| `AGENTIC_TELEMETRY_EXPORT_URL` / `AGENTIC_TELEMETRY_ALLOWED_HOSTS` | Optional telemetry export endpoint and production host allowlist. |
| `AGENTIC_WORKER_HEALTH_PATH` | Shared worker heartbeat file for production readiness. |
| `AGENTIC_WORKER_*` | Worker polling, lease, retry, scheduler, and concurrency tuning. |

Optional integrations:

- Google OAuth: `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`
- Google legacy/local refresh token: `GOOGLE_REFRESH_TOKEN`
- provider credential encryption: `AGENTIC_PROVIDER_SECRET_KEY`, `AGENTIC_PROVIDER_SECRET_KEY_VERSION`
- Slack: `SLACK_BOT_TOKEN`, `SLACK_SIGNING_SECRET`, `SLACK_DEFAULT_CHANNEL`
- Telegram: `TELEGRAM_BOT_TOKEN`, `TELEGRAM_WEBHOOK_SECRET`, `TELEGRAM_DEFAULT_CHAT_ID`
- GitHub issue intake: `AGENTIC_GITHUB_WEBHOOK_SECRET`, `AGENTIC_GITHUB_ISSUE_ALLOWED_REPOSITORIES`, optional `AGENTIC_GITHUB_ISSUE_INTAKE_USER_ID`; `/agentic work` comments should also set `AGENTIC_GITHUB_ISSUE_COMMAND_ALLOWED_LOGINS`
- GitHub App sync: `AGENTIC_GITHUB_APP_ID`, `AGENTIC_GITHUB_APP_INSTALLATION_ID`, `AGENTIC_GITHUB_APP_PRIVATE_KEY`, `AGENTIC_GITHUB_APP_SYNC_SECRET`; GitHub Enterprise API hosts require `AGENTIC_GITHUB_APP_ALLOW_ENTERPRISE_HOSTS=true` and `AGENTIC_GITHUB_APP_ALLOWED_API_HOSTS`

See [`docs/runbooks/github-issue-autopilot.md`](docs/runbooks/github-issue-autopilot.md) for GitHub webhook and GitHub App setup.

## Usage

Health and readiness:

```bash
curl http://localhost:3000/api/health
curl http://localhost:3000/api/ready
```

Most authenticated API routes accept a session cookie or:

```text
x-agentic-access-key: replace-this-with-a-long-random-secret
```

Example goal enqueue:

```bash
curl -s \
  -X POST http://localhost:3000/api/goals \
  -H 'content-type: application/json' \
  -H 'x-agentic-access-key: replace-this-with-a-long-random-secret' \
  -H 'x-idempotency-key: local-demo-goal-001' \
  -d '{"request":"Create a concise plan for validating the local Agentic setup."}'
```

The response includes a `statusUrl`, usually `/api/goals/jobs/<job-id>`. Keep the worker running for queued work to progress.

## Validation

Core checks:

```bash
npm run setup:check
npm run lint
npm run typecheck
npm run format:check
npm test
npm run build
```

Security and architecture:

```bash
npm run test:security:regression
npm run test:architecture:fitness
npm run test:parallel-worktree:fitness
npm run test:performance:fitness
npm run security:audit-runtime
```

Optional broader checks:

```bash
npx playwright install chromium
npm run test:e2e
npm run test:smoke:capabilities
npm run test:smoke:observability
npm run test:smoke:deployment
npm run docs:build
npm run release:check-context
```

## Production Notes

Production requires Postgres, explicit migrations, production-safe auth state, request identity configuration, and a running worker.

```bash
export NODE_ENV=production
export DATABASE_URL=postgres://user:password@db-host:5432/agentic
export AGENTIC_ACCESS_KEY=replace-this-with-a-long-random-secret
export AGENTIC_BOOTSTRAP_USER_ID=owner
export AGENTIC_BOOTSTRAP_DISPLAY_NAME="Instance Owner"
export AGENTIC_DEFAULT_TIMEZONE=UTC
export AGENTIC_PUBLIC_BASE_URL=https://agentic.example.com
export AGENTIC_REQUIRE_SHARED_AUTH_STATE=true
export AGENTIC_TRUST_PROXY_HEADERS=true
export AGENTIC_PROXY_HEADER_OVERWRITE_CONFIRMED=true
export AGENTIC_TRUSTED_CLIENT_IP_HEADER=x-forwarded-for
export AGENTIC_WORKER_HEALTH_PATH=/var/lib/agentic/worker-health.json

npm ci
npm run db:migrate
npm run db:status -- --require-ready
npm run production:bootstrap:check
npm run build
npm run start:web:prod -- --hostname 0.0.0.0 --port 3000
```

Worker process:

```bash
npm run start:worker:prod
```

Only trust proxy headers after confirming the ingress overwrites the configured client-IP header at the edge. The deployment runbook is [`docs/runbooks/deployment.md`](docs/runbooks/deployment.md); the current Render Blueprint candidate is [`deploy/render/render.yaml`](deploy/render/render.yaml).

## Troubleshooting

| Symptom | Fix |
| --- | --- |
| `setup:check` warns about `AGENTIC_ACCESS_KEY` | Export `AGENTIC_ACCESS_KEY`, or use `AGENTIC_ENABLE_LOCAL_DEV_KEY=true` for disposable local-only runs. |
| Jobs stay pending | Start `npm run worker:start`. |
| DB commands fail locally | Set `DATABASE_URL`, ensure Postgres is reachable, then run `npm run db:migrate`. |
| `/api/ready` fails in production | Check authenticated `/api/ready/details` for DB, shared auth state, request identity, worker heartbeat, or connector failures. |
| E2E startup reports a Next.js lock | Stop the manual dev server or set another `PLAYWRIGHT_E2E_PORT`. |
| `docs:build` fails | Install `pandoc`; LibreOffice is optional for PDF smoke rendering. |

## Contributing

See [`CONTRIBUTING.md`](CONTRIBUTING.md). Keep changes focused, follow existing module boundaries, add tests for behavior changes, update docs when contracts change, and do not commit secrets, local stores, generated build output, logs, or machine-local paths.

Report vulnerabilities through the private flow in [`SECURITY.md`](SECURITY.md), not public issues.

## References

- [`docs/specs/agentic.md`](docs/specs/agentic.md): product and architecture spec
- [`docs/specs/api-route-inventory.md`](docs/specs/api-route-inventory.md): API route inventory
- [`docs/runbooks/deployment.md`](docs/runbooks/deployment.md): deployment and stable ingress
- [`docs/runbooks/github-issue-autopilot.md`](docs/runbooks/github-issue-autopilot.md): GitHub issue automation
- [`docs/runbooks/postgres-shared-auth-bootstrap.md`](docs/runbooks/postgres-shared-auth-bootstrap.md): production shared auth state
- [`docs/runbooks/worker-concurrency-controls.md`](docs/runbooks/worker-concurrency-controls.md): worker concurrency controls
- [`docs/security/security-regression-suite.md`](docs/security/security-regression-suite.md): security regression coverage
- [`docs/security/supply-chain-controls.md`](docs/security/supply-chain-controls.md): supply-chain controls
