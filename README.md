# Agentic

Agentic is a trusted execution control plane for governed goals, approvals, automations, memories, documents, and integrations. It is a private TypeScript monorepo with a Next.js dashboard/API surface, a dedicated worker runtime, shared packages for policy and orchestration, and production gates for persistence, readiness, security, and deployment evidence.

The project is not just a chat UI. It keeps work inside an auditable loop:

1. capture an operator request, commitment, watcher event, or integration signal
2. validate the input and resolve workspace/user context
3. classify risk through governance and connector readiness
4. enqueue long-running work into durable worker jobs
5. request approval before higher-risk external action
6. persist evidence, artifacts, audit records, and learned context

## Table Of Contents

- [Current State](#current-state)
- [Features](#features)
- [Architecture](#architecture)
- [Requirements](#requirements)
- [Quick Start](#quick-start)
- [Local Development Modes](#local-development-modes)
- [Configuration](#configuration)
- [Running And Using Agentic](#running-and-using-agentic)
- [Testing And Validation](#testing-and-validation)
- [Deployment Notes](#deployment-notes)
- [Troubleshooting](#troubleshooting)
- [Contributing](#contributing)
- [Reference Docs](#reference-docs)

## Current State

Agentic is implemented as a modular monolith. The current application surface includes a commitment-first dashboard, authenticated JSON APIs, a worker-backed execution loop, readiness endpoints, governance and privacy controls, a document rendering pipeline, GitHub issue intake, optional Google/Slack/Telegram/local-notes integrations, and a large local validation suite.

Capability readiness is explicit in `apps/web/lib/feature-capabilities.ts`:

| Surface | Current readiness |
| --- | --- |
| Request work intake | Operational |
| Commitments inbox | Operational |
| Approvals queue | Operational |
| Startup briefing | Operational |
| Shared memory workbench | Operational |
| Custom agents catalog | Operational |
| Agent-scoped memory | Preview |
| Integration and workspace setup | Preview |
| Watchers | Preview until event-emitting watchers and recovery signals are healthy |
| Workflow templates | Preview |
| Autopilot control | Preview until runtime reliability controls stay within budget |

The repository currently tracks 11 capability definitions and 22 route contracts. None are marked `production` in the capability registry yet, so the safest wording is: production-shaped infrastructure and gates exist, but runtime capability readiness is still reported as operational or preview rather than production-ready.

## Features

- **Dashboard and command loop**: Next.js dashboard for goals, commitments, approvals, memory, jobs, agents, integrations, recovery, and operating telemetry.
- **Durable async execution**: goal creation, refinement, briefings, template runs, document renders, privacy operations, autopilot events, and GitHub issue intake run through worker jobs instead of long request handlers.
- **Governance and approval gates**: policy classes keep external commitments and sensitive actions behind approval or block behavior.
- **Workspace and actor context**: authenticated writes carry user/workspace actor context into persisted approvals, audits, jobs, and mutations.
- **Connector readiness model**: integrations advertise readiness tiers before the UI/API treats them as safe to draft, approve, or execute.
- **Provider credentials**: Google-managed credentials can be tenant-scoped and wrapped with versioned AES-GCM secret envelopes.
- **Local notes adapter**: development-friendly Markdown notes under a configured notes directory, with stricter production enablement.
- **GitHub issue automation**: signed webhooks and GitHub App pull sync can enqueue governed issue-intake jobs for allowlisted repositories.
- **Notifications**: Slack and Telegram notification/approval surfaces are available when configured.
- **Privacy lifecycle**: retention, export, and deletion requests are represented as governed worker-backed operations.
- **Document pipeline**: `docs/specs/agentic.md` can render to `build/agentic.docx` through the checked-in document tooling.
- **Operational gates**: health/readiness probes, migration checks, production bootstrap validation, security regression tests, SBOM generation, observability smoke tests, and deployment smoke checks are part of the repo.

## Architecture

| Path | Responsibility |
| --- | --- |
| `apps/web` | Next.js UI, app routes, JSON APIs, auth/session handling, health/readiness endpoints, dashboard components, security headers, request identity, and public share views. |
| `apps/worker` | Long-running worker process for durable jobs, watcher scheduling, retries, leases, health heartbeat, and worker telemetry. |
| `packages/contracts` | Shared types, schemas, defaults, and runtime contracts. |
| `packages/db` | Postgres migrations, schema status checks, auth runtime schema, and migration discipline helpers. |
| `packages/repository` | Persistence abstraction for file-backed development state and Postgres-backed production/parity state. |
| `packages/orchestrator` | Goal refinement, execution dispatch, memory capture, briefing generation, and workflow assembly. |
| `packages/policy` | Governance rules, privacy controls, risk/conformance checks, and simulation logic. |
| `packages/integrations` | Provider-neutral adapter contracts plus Google, Gmail, Calendar, Slack, Telegram, and local-notes adapters. |
| `packages/worker-runtime` | Durable job payloads, dispatch, executors, leases, retries, dead-letter/replay support, and worker health. |
| `packages/memory` | Memory records, ranking, retrieval, and review flows. |
| `packages/self-improvement-memory` | Outcome capture, recommendation replay, and learned execution signals. |
| `packages/observability` | Structured telemetry, rollout gates, evidence capture, and smoke/load/failure tooling. |
| `packages/agents` | Bounded specialist agent outputs used by higher-level workflows. |
| `packages/docs-runtime` | Document rendering helper contracts. |
| `packages/notifications` | Notification delivery abstractions. |
| `packages/execution` | Task/workflow execution state helpers. |
| `docs` | Specs, runbooks, security evidence, architecture notes, remediation plans, and templates. |
| `scripts` | Local setup checks, CI gates, DB tools, deployment smoke checks, docs tooling, security tooling, and worktree automation. |

The canonical API route inventory is [`docs/specs/api-route-inventory.md`](docs/specs/api-route-inventory.md). Add or update that inventory whenever a route under `apps/web/app/api/**/route.ts` changes.

## Requirements

- Node.js `>=20 <26`; `.nvmrc` and `.node-version` currently pin `20`
- npm with the checked-in `package-lock.json`
- PostgreSQL for production-like local runs and production
- `pandoc` for `npm run docs:render` / `npm run docs:build`
- LibreOffice `soffice` is optional; docs validation uses it for PDF smoke rendering when available
- Chromium browsers for Playwright E2E tests, installed with `npx playwright install chromium`

Major runtime dependencies from `package.json` include Next.js 16, React 19, TypeScript, Vitest, Playwright, Drizzle ORM, `pg`, `zod`, `googleapis`, OpenAI, Anthropic, and `jszip`.

## Quick Start

Use this path for the fastest local dashboard and API run. It uses the file-backed development store and does not require Postgres.

1. Clone the repository.

```bash
git clone https://github.com/leonardwongly/agentic.git
cd agentic
```

2. Select Node 20 if you use `nvm`.

```bash
nvm use
node --version
```

3. Install dependencies.

```bash
npm install
```

4. Create a local environment template and set an access key.

```bash
cp .env.example .env.local
export AGENTIC_ACCESS_KEY=replace-this-with-a-long-random-secret
```

Next.js reads `.env.local` for the web app. Shell-export variables that must be visible to non-Next scripts or the worker process.

5. Run the first-run check.

```bash
npm run setup:check
```

6. Start the web app.

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

7. Start the worker in a second terminal when you want queued jobs to complete.

```bash
export AGENTIC_ACCESS_KEY=replace-this-with-a-long-random-secret
npm run worker:start
```

8. Create a session through the dashboard, or with curl.

```bash
curl -i \
  -X POST http://localhost:3000/api/session \
  -H 'content-type: application/json' \
  -d '{"accessKey":"replace-this-with-a-long-random-secret"}'
```

The response sets the `agentic_session` cookie used by authenticated dashboard/API routes.

## Local Development Modes

### File-Backed Development

Use this for fast local exploration and most UI/API development.

```bash
export AGENTIC_ACCESS_KEY=replace-this-with-a-long-random-secret
npm run dev
```

Optional overrides:

```bash
export AGENTIC_RUNTIME_STORE_PATH=.agentic/runtime-store.json
export AGENTIC_NOTES_PATH=.agentic/notes
```

Behavior:

- `DATABASE_URL` is unset.
- Runtime state is stored in `.agentic/runtime-store.json` by default.
- Production-only checks that require Postgres are expected to warn or fail.
- Queued work remains pending unless `npm run worker:start` is also running.

For a disposable local-only environment, you can set:

```bash
export AGENTIC_ENABLE_LOCAL_DEV_KEY=true
```

That enables the fallback key `agentic-local-dev-key`. Do not use this in shared, internet-visible, staging, or production environments.

### Postgres Parity

Use this when you need migration validation, shared auth state, queue/replay parity, or production-like readiness behavior.

```bash
export DATABASE_URL=postgres://user:password@localhost:5432/agentic
export AGENTIC_ACCESS_KEY=replace-this-with-a-long-random-secret
npm run db:migrate
npm run db:status -- --require-ready
```

Then start the web and worker processes:

```bash
npm run dev
```

```bash
npm run worker:start
```

Optional stricter auth-state parity:

```bash
export AGENTIC_SHARED_AUTH_STATE=true
export AGENTIC_REQUIRE_SHARED_AUTH_STATE=true
```

Production requires `DATABASE_URL`; the file-backed store is a development fallback only.

## Configuration

Start from `.env.example`. The most important settings are:

| Variable | Required | Purpose |
| --- | --- | --- |
| `AGENTIC_ACCESS_KEY` | Required outside disposable local mode | Access key for session bootstrap and access-key authenticated automation. |
| `AGENTIC_ENABLE_LOCAL_DEV_KEY` | Optional local only | Enables the fallback key `agentic-local-dev-key`. |
| `DATABASE_URL` | Required for production and Postgres parity | Selects the Postgres repository backend and enables DB schema checks. |
| `AGENTIC_PUBLIC_BASE_URL` | Required in production | External origin for OAuth redirects, share links, and absolute public URLs. |
| `AGENTIC_RUNTIME_STORE_PATH` | Optional local | File-backed runtime store path when `DATABASE_URL` is unset. |
| `AGENTIC_NOTES_PATH` | Optional | Local Markdown notes path. |
| `AGENTIC_LOCAL_NOTES_ENABLED` | Production local-notes only | Must be `true` in production before local notes can read/write. |
| `AGENTIC_LOCAL_NOTES_ALLOWED_ROOT` | Production local-notes only | Allowed filesystem root for production local notes. |
| `AGENTIC_SHARED_AUTH_STATE` | Optional | Uses shared auth runtime state when Postgres is configured. |
| `AGENTIC_REQUIRE_SHARED_AUTH_STATE` | Production bootstrap | Fails closed if shared auth runtime state is unavailable. |
| `AGENTIC_ALLOW_PROCESS_LOCAL_AUTH_STATE` | Exceptional production only | Allows audited single-instance production runs without shared auth state. |
| `AGENTIC_TRUST_PROXY_HEADERS` | Production behind trusted proxy | Enables canonical client-IP extraction from a trusted edge-overwritten header. |
| `AGENTIC_TRUSTED_CLIENT_IP_HEADER` | With proxy trust | One of `x-forwarded-for`, `x-real-ip`, or `cf-connecting-ip`. |
| `AGENTIC_WORKER_HEALTH_PATH` | Production readiness | Shared heartbeat JSON path written by the worker and read by web readiness. |
| `AGENTIC_WORKER_*` | Optional | Worker runner id, polling, lease, heartbeat, scheduler, retry, and concurrency tuning. |

### Optional Integrations

Google OAuth and managed credentials:

```bash
export GOOGLE_CLIENT_ID=replace-with-google-client-id
export GOOGLE_CLIENT_SECRET=replace-with-google-client-secret
export AGENTIC_PROVIDER_SECRET_KEY=replace-with-at-least-32-random-characters
export AGENTIC_PROVIDER_SECRET_KEY_VERSION=2026-05-19
```

Legacy/local Google refresh-token mode:

```bash
export GOOGLE_REFRESH_TOKEN=replace-with-google-refresh-token
```

Provider key rotation can use:

```bash
export AGENTIC_PROVIDER_SECRET_KEYRING='{"2026-05-01":"previous-secret"}'
```

Slack:

```bash
export SLACK_BOT_TOKEN=xoxb-...
export SLACK_SIGNING_SECRET=replace-with-a-long-random-secret
export SLACK_DEFAULT_CHANNEL=C0123456789
export SLACK_USER_MAP=U0123456789:user-id
```

Telegram:

```bash
export TELEGRAM_BOT_TOKEN=123456:replace-with-your-bot-token
export TELEGRAM_WEBHOOK_SECRET=replace-with-a-long-random-webhook-secret
export TELEGRAM_DEFAULT_CHAT_ID=-1001234567890
export TELEGRAM_USER_MAP=123456789:user-id,-1001234567890/123456789:user-id
```

GitHub issue webhook intake:

```bash
export AGENTIC_GITHUB_WEBHOOK_SECRET=replace-with-a-long-random-webhook-secret
export AGENTIC_GITHUB_ISSUE_ALLOWED_REPOSITORIES=owner/repo
```

GitHub App issue pull sync:

```bash
export AGENTIC_GITHUB_APP_ID=12345
export AGENTIC_GITHUB_APP_INSTALLATION_ID=98765
export AGENTIC_GITHUB_APP_PRIVATE_KEY='-----BEGIN PRIVATE KEY-----...'
export AGENTIC_GITHUB_APP_SYNC_SECRET=replace-with-a-long-random-sync-secret
export AGENTIC_GITHUB_ISSUE_ALLOWED_REPOSITORIES=owner/repo
```

See [`docs/runbooks/github-issue-autopilot.md`](docs/runbooks/github-issue-autopilot.md) for webhook labels, comment commands, allowlists, GitHub Actions variables, and scheduled sync behavior.

## Running And Using Agentic

### Health And Readiness

Public operational probes:

```bash
curl http://localhost:3000/api/health
curl http://localhost:3000/api/ready
```

`/api/ready` returns a public-safe summary and a pointer to `/api/ready/details`. The detailed report requires a session or access key and covers access-key configuration, database/schema status, auth runtime state, request identity, async execution, worker heartbeat, and connector health.

### Access-Key Authenticated Requests

Most authenticated API routes accept either the session cookie or this header:

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

The route returns `202 Accepted` with a `statusUrl`, usually `/api/goals/jobs/<job-id>`. Poll that URL while the worker is running:

```bash
curl -s \
  -H 'x-agentic-access-key: replace-this-with-a-long-random-secret' \
  http://localhost:3000/api/goals/jobs/<job-id>
```

### Worker-Backed Flows

Run the worker for:

- goal creation and refinement
- startup/midday/end-of-day briefings
- template runs
- document render jobs
- autopilot and watcher events
- GitHub issue intake jobs
- privacy retention/export/deletion jobs
- approval follow-up notifications

Without the worker, APIs can enqueue jobs, but those jobs will remain pending.

## Testing And Validation

Use targeted checks while working, then run broader gates before review.

Core local checks:

```bash
npm run setup:check
npm run lint
npm run typecheck
npm run format:check
npm test
npm run build
```

Security and architecture gates:

```bash
npm run test:security:regression
npm run test:architecture:fitness
npm run test:parallel-worktree:fitness
npm run test:performance:fitness
npm run security:audit-runtime
npm run security:sbom
```

Browser/E2E checks:

```bash
npx playwright install chromium
npm run test:e2e
```

Smoke and operational checks:

```bash
npm run test:smoke:capabilities
npm run test:smoke:observability
npm run test:smoke:observability-export
npm run test:smoke:deployment
npm run test:smoke:deployment-async
npm run test:smoke:github-app-sync
```

Docs pipeline:

```bash
npm run docs:render
npm run docs:validate
npm run docs:build
```

Database checks:

```bash
npm run db:check-migrations
npm run db:status -- --require-ready
npm run db:migrate
```

Release context and local CI:

```bash
npm run release:check-context
npm run ci:local
```

## Deployment Notes

Production startup is intentionally explicit:

1. configure production environment
2. run migrations
3. verify schema readiness
4. build web and worker
5. start web through the startup wrapper
6. start worker through the startup wrapper
7. verify `/api/health`, `/api/ready`, deployment smoke checks, and worker heartbeat

Minimal production-shaped command sequence:

```bash
export NODE_ENV=production
export DATABASE_URL=postgres://user:password@db-host:5432/agentic
export AGENTIC_ACCESS_KEY=replace-this-with-a-long-random-secret
export AGENTIC_PUBLIC_BASE_URL=https://agentic.example.com
export AGENTIC_REQUIRE_SHARED_AUTH_STATE=true
export AGENTIC_TRUST_PROXY_HEADERS=true
export AGENTIC_TRUSTED_CLIENT_IP_HEADER=x-forwarded-for
export AGENTIC_WORKER_HEALTH_PATH=/var/lib/agentic/worker-health.json

npm ci
npm run db:migrate
npm run db:status -- --require-ready
npm run production:bootstrap:check
npm run build
npm run start:web:prod -- --hostname 0.0.0.0 --port 3000
```

Start the worker in a separate process:

```bash
npm run start:worker:prod
```

Only set `AGENTIC_TRUST_PROXY_HEADERS=true` after confirming the ingress provider overwrites the configured client-IP header at the edge. Do not trust user-forwarded client-IP headers directly.

The first documented container target is the Render Blueprint under [`deploy/render/render.yaml`](deploy/render/render.yaml). The full deployment and stable-ingress contract is in [`docs/runbooks/deployment.md`](docs/runbooks/deployment.md).

## Troubleshooting

| Symptom | Likely cause | Fix |
| --- | --- | --- |
| `npm run setup:check` reports missing dependencies | `npm install` has not run or `node_modules` is absent | Run `npm install`. |
| Dashboard rejects sign-in | `AGENTIC_ACCESS_KEY` in the request does not match the web process environment | Re-export the same key in the terminal running `npm run dev`, then retry. |
| Jobs stay pending | Worker is not running | Start `npm run worker:start` in a second terminal. |
| DB commands fail locally | `DATABASE_URL` is unset or Postgres is unreachable | Use file-backed mode for quick local work, or set `DATABASE_URL` and run migrations. |
| Production startup fails on database readiness | Migrations are missing or schema drift is detected | Run `npm run db:migrate`, then `npm run db:status -- --require-ready`. |
| `/api/ready` fails in production | Missing DB, shared auth state, trusted request identity, worker heartbeat, or connector readiness | Inspect authenticated `/api/ready/details` and fix the failing check. |
| E2E startup fails with a Next.js lock error | A manual `npm run dev` is already running in the checkout | Stop the dev server or set `PLAYWRIGHT_E2E_PORT` for an isolated run. |
| `npm run docs:build` fails on missing `pandoc` | Document rendering dependency is not installed | Install `pandoc`; install LibreOffice if you need PDF smoke rendering too. |
| Local notes are disabled in production | Production local-notes writes require explicit filesystem boundaries | Set `AGENTIC_LOCAL_NOTES_ENABLED=true`, `AGENTIC_NOTES_PATH`, and `AGENTIC_LOCAL_NOTES_ALLOWED_ROOT` with the notes path under the allowed root. |
| GitHub App sync refuses the URL | Sync URL is temporary, has credentials/query/fragment, or does not end at the exact sync path | Use `https://<agentic-host>/api/github/issues/app/sync` on a stable HTTPS host. |

## Contributing

See [`CONTRIBUTING.md`](CONTRIBUTING.md) for setup, validation, commit style, review expectations, and security reporting boundaries.

Short version:

- keep changes focused and reversible
- follow existing module boundaries before adding abstractions
- update tests with behavior changes and bug fixes
- update specs/runbooks/README when contracts or setup change
- do not commit secrets, `.env.local`, local runtime stores, build output, logs, or machine-local paths
- run the narrowest relevant checks while developing and broader gates before review

Security issues should use the private reporting flow in [`SECURITY.md`](SECURITY.md), not public issues.

## Reference Docs

- [`docs/specs/agentic.md`](docs/specs/agentic.md): product and architecture specification
- [`docs/specs/api-route-inventory.md`](docs/specs/api-route-inventory.md): canonical route inventory and mutation governance matrix
- [`docs/runbooks/deployment.md`](docs/runbooks/deployment.md): production/staging rollout contract
- [`docs/runbooks/github-issue-autopilot.md`](docs/runbooks/github-issue-autopilot.md): GitHub webhook and GitHub App issue intake
- [`docs/runbooks/postgres-shared-auth-bootstrap.md`](docs/runbooks/postgres-shared-auth-bootstrap.md): production auth-state bootstrap
- [`docs/runbooks/worker-concurrency-controls.md`](docs/runbooks/worker-concurrency-controls.md): worker concurrency and retry controls
- [`docs/runbooks/parallel-worktrees.md`](docs/runbooks/parallel-worktrees.md): parallel delivery model
- [`docs/security/security-regression-suite.md`](docs/security/security-regression-suite.md): security regression coverage
- [`docs/security/supply-chain-controls.md`](docs/security/supply-chain-controls.md): supply-chain validation
- [`docs/security/compliance-evidence.md`](docs/security/compliance-evidence.md): compliance evidence registry
- [`docs/templates/reference.docx`](docs/templates/reference.docx): document rendering reference template
