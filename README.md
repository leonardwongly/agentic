# Agentic

Agentic is a trusted execution control plane for commitments, approvals, automations, memories, and integrations. It is built as a TypeScript-first modular monolith with a Next.js web surface, a durable worker-backed execution loop, tenant-scoped provider credentials, privacy lifecycle controls, and a reproducible `agentic.docx` pipeline.

## What It Does

Agentic keeps day-to-day work inside a bounded operating loop:

1. capture goals, commitments, and signals
2. classify risk and apply governance
3. draft work or request approval when needed
4. execute through provider-neutral integrations
5. persist evidence, outcomes, and audit history

The current product surface is centered on:

- a commitment-first dashboard for the next actions that matter
- async goal creation with job polling, idempotency keys, and worker execution
- approvals and autopilot events with explicit evidence, retry behavior, and recovery state
- policy-aware memories, goals, workflows, and watchers
- tenant-scoped Google provider credentials with encrypted secret storage
- privacy lifecycle operations for retention enforcement, workspace export, and workspace deletion
- connector readiness reporting so the UI only advertises what an integration can safely do
- observability rollout gates backed by retained telemetry, checked-in alert thresholds, and dashboard manifests

## Architecture At A Glance

- `apps/web`: Next.js UI, JSON API routes, session handling, and dashboard surfaces
- `apps/worker`: worker process for durable goal, autopilot, and privacy-operation execution
- `packages/contracts`: shared schemas and runtime contracts
- `packages/db`: database access, migrations, and schema-readiness checks
- `packages/orchestrator`: workflow assembly, routing, approvals, and execution coordination
- `packages/policy`: governance, risk classification, and approval gating
- `packages/repository`: persistence access for dashboards, goals, approvals, and integrations
- `packages/integrations`: provider-neutral adapter contracts and readiness classification
- `packages/memory`: memory records and ranking behavior
- `packages/execution`: task and workflow execution state
- `packages/worker-runtime`: durable queue contracts, retries, dead-letter handling, and worker dispatch
- `packages/observability`: action logs, explanations, and execution evidence
- `packages/agents`: bounded specialist outputs
- `docs/specs/agentic.md`: deeper product and architecture specification
- `docs/templates/reference.docx`: Word template/reference for document rendering
- `scripts`: document rendering and validation helpers

## Connector Readiness

Integrations are intentionally described by operational readiness, not just connection state:

- `experimental`: visible but not ready for trustworthy draft or live execution
- `draft-grade`: safe for draft-only assistance
- `approval-grade`: live actions are available, but still require operator approval
- `autonomous-grade`: approved for higher-trust autonomous execution paths

This keeps the UI, NL surface, and API contract aligned with what the system can actually execute.

## Quick Start

1. Install dependencies:

```bash
npm install
```

2. Optional: point the app at Postgres:

```bash
export DATABASE_URL=postgres://user:password@localhost:5432/agentic
```

3. Configure the dashboard access key:

```bash
export AGENTIC_ACCESS_KEY=replace-this-with-a-long-random-secret
```

In local development only, the app falls back to `agentic-local-dev-key` if `AGENTIC_ACCESS_KEY` is not set. Production should always use an explicit secret.

Optional production exception for audited single-instance deployments:

```bash
export AGENTIC_ALLOW_PROCESS_LOCAL_AUTH_STATE=true
```

By default, production now fails closed if session revocation, session rate limiting, and unlock throttling are still backed by process-local memory. Only set `AGENTIC_ALLOW_PROCESS_LOCAL_AUTH_STATE=true` when you have explicitly accepted a single-instance deployment model.

Optional development or test opt-in for the shared auth-state backend:

```bash
export AGENTIC_SHARED_AUTH_STATE=true
```

With `DATABASE_URL` configured, production automatically uses the Postgres-backed auth-state tables. Development and test stay on bounded in-memory auth state unless you opt in explicitly with `AGENTIC_SHARED_AUTH_STATE=true`.

Optional Telegram approval integration:

```bash
export TELEGRAM_BOT_TOKEN=123456:replace-with-your-bot-token
export TELEGRAM_WEBHOOK_SECRET=replace-with-a-long-random-webhook-secret
export TELEGRAM_DEFAULT_CHAT_ID=-1001234567890
export TELEGRAM_USER_MAP=123456789:user-id,-1001234567890/123456789:user-id
```

Telegram approval buttons use short server-stored action IDs rather than signed inline payloads so they fit the Telegram `callback_data` size limit. In production, those action records are stored in Postgres when `DATABASE_URL` is configured. `TELEGRAM_USER_MAP` supports either a global mapping of `telegramUserId:userId` or a chat-scoped mapping of `chatId/telegramUserId:userId`.

4. Start the web app:

```bash
npm run dev
```

The app runs at `http://localhost:3000`.

5. Start the worker when you want async goals, autopilot processing, retention jobs, export jobs, or deletion jobs to complete locally:

```bash
npm run worker:start
```

6. Create a session:

- Use the dashboard sign-in flow, or
- POST the access key to `/api/session` and let the app issue the session cookie used by authenticated API routes

7. Render and validate the document:

```bash
npm run docs:build
```

8. Run tests:

```bash
npm test
```

9. Run browser E2E coverage:

```bash
npx playwright install chromium
npm run test:e2e
```

10. Build the production web app and worker:

```bash
npm run build
```

## Async Execution Model

Goal creation, autopilot processing, and privacy lifecycle operations are durable job flows rather than best-effort request-time side effects.

- `POST /api/goals` enqueues goal creation and returns `202 Accepted` with a pollable status URL
- autopilot events are claimed, deduplicated, and processed through the worker runtime
- privacy retention, workspace export, and workspace deletion run as worker jobs with sanitized failure state
- retries and dead-letter handling preserve operator-visible recovery details without exposing raw backend secrets

For realistic local validation of these flows, run both `npm run dev` and `npm run worker:start`.

## Parallel Delivery

Agentic supports a checked-in parallel worktree model for roadmap slices that need multiple low-conflict streams at once.

- `npm run worktree:setup -- --print-only`: preview the standard stream layout
- `npm run worktree:setup`: create sibling worktrees for the standard streams
- `npm run worktree:status`: inspect branch, head, and dirty-state across planned worktrees

See [docs/runbooks/parallel-worktrees.md](/Users/leonardwongly/Developer/Agentic/docs/runbooks/parallel-worktrees.md) for ownership rules, merge order, and validation requirements.

## Production Bootstrap

Production startup is intentionally split into explicit migration, readiness, and process-launch steps so the app does not silently mutate schema state during request handling.

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

4. Build and start the web app through the startup validation wrapper:

```bash
npm run build
npm run start:web:prod -- --hostname 0.0.0.0 --port 3000
```

5. Start the worker through the schema-readiness wrapper:

```bash
npm run start:worker:prod
```

The web startup wrapper fails closed if required production configuration is missing, if the database is unreachable, or if checked-in migrations have not been applied. The worker startup wrapper refuses to start until the schema is ready.

## Operational Endpoints

Agentic exposes two unauthenticated operational endpoints for orchestration and deployment validation:

- `GET /api/health`: liveness probe that reports process uptime and current timestamp
- `GET /api/ready`: readiness probe that validates access-key configuration, database reachability and migration status, auth runtime-state requirements, and async execution backlog health

Both routes return `Cache-Control: no-store` and are safe for container probes and deployment smoke tests.

The deployment smoke helper exercises those endpoints against a live environment:

```bash
export AGENTIC_SMOKE_BASE_URL=https://agentic.example.com
export AGENTIC_SMOKE_ACCESS_KEY=replace-this-with-a-long-random-secret
npm run test:smoke:deployment
```

## Observability Rollout Gates

The observability package can retain sanitized telemetry batches locally and optionally forward those same batches to a backend collector.

Optional exporter configuration:

```bash
export AGENTIC_TELEMETRY_RETENTION_DIR=.agentic/telemetry
export AGENTIC_TELEMETRY_EXPORT_URL=https://telemetry.example.com/ingest
export AGENTIC_TELEMETRY_EXPORT_TOKEN=replace-this-with-a-telemetry-ingest-token
```

Validate the exporter path without external infrastructure:

```bash
npm run test:smoke:observability-export
```

Evaluate retained telemetry against the checked-in rollout gate thresholds:

```bash
npm run telemetry:rollout-gate -- --dir "${AGENTIC_TELEMETRY_RETENTION_DIR:-.agentic/telemetry}"
```

The threshold and dashboard manifests live in:

- `config/observability/alerts.json`
- `config/observability/dashboard.json`

## Provider Credentials And Integration Safety

- Google provider credentials are stored per tenant rather than as a single shared global integration secret.
- Refresh tokens and other provider secrets are stored through the encrypted provider-credential secret abstraction.
- Gmail and Google Calendar operations resolve credentials through that tenant-scoped repository path.
- Connector readiness remains the outer safety contract: the UI and API advertise draft, approval, or autonomous execution only when an integration is configured and safe enough for that mode.

## Persistence And Local Storage

- If `DATABASE_URL` is set, the app uses the Postgres-backed repository.
- Otherwise it falls back to a file-backed runtime store at `.agentic/runtime-store.json` so the app stays runnable before the database is provisioned outside production. Production requires `DATABASE_URL`.
- The Postgres repository no longer auto-applies migrations during normal startup in production. Use `npm run db:migrate` as an explicit deployment step instead.
- In production, `DATABASE_URL` also enables Postgres-backed auth session rate limiting, session revocation, and session unlock throttling.
- In development and test, those auth-state controls stay in-memory by default so local runs do not silently depend on Postgres. Set `AGENTIC_SHARED_AUTH_STATE=true` when you want to exercise the shared backend outside production.
- `AGENTIC_RUNTIME_STORE_PATH` overrides the file-backed store path when you need isolated local or test storage.
- `AGENTIC_NOTES_PATH` overrides the local notes directory used by the filesystem-backed notes adapter.

The first concrete local adapter is a notes provider that reads and writes Markdown files under `.agentic/notes`.

## Security And Access

- API routes are protected by a session cookie created through `/api/session`.
- Authenticated route handlers are scoped to the signed-in principal rather than a global user fallback.
- Authenticated write routes now derive an explicit actor context:
  - session-authenticated requests are recorded as human-initiated and human-executed
  - access-key automation paths are recorded as system-initiated and system-executed
  - approval history and evidence records persist that actor context for downstream audit and governance flows
- Session revocation, login throttling, and unlock throttling default to bounded in-memory stores for local development and tests.
- Production automatically upgrades those controls to shared Postgres-backed state when `DATABASE_URL` is configured.
- `AGENTIC_SHARED_AUTH_STATE=true` opts development and test into the shared Postgres-backed auth-state path.
- `AGENTIC_REQUIRE_SHARED_AUTH_STATE=true` enables the same fail-closed shared auth-state requirement outside production when you want development or test to match the production contract.
- Login throttling and unlock throttling ignore forwarded client-IP headers by default; set `AGENTIC_TRUST_PROXY_HEADERS=true` only when the app is deployed behind a trusted proxy that overwrites those headers.
- External actions stay behind governance and approval checks unless a connector has earned a higher readiness tier.
- Approval and execution evidence is persisted so operator-visible state matches what actually ran.
- Telegram approval callbacks require the `x-telegram-bot-api-secret-token` header to match `TELEGRAM_WEBHOOK_SECRET`.
- Telegram approval actions are one-time, expiry-bound, and actor-mapped before they can mutate approval state.
- Provider credential flows use tenant-scoped records and encrypted secret storage instead of process-global provider tokens.

## Privacy Lifecycle

Agentic includes worker-backed privacy operations so governance controls do not depend on synchronous request handlers.

- retention enforcement can revoke expired shares and apply workspace retention policy
- workspace export jobs produce metadata-only completion state suitable for audit review
- workspace deletion jobs run through the same durable execution path with audit visibility
- privacy-operation failures are sanitized before they are persisted back into operator-visible state

## Documents And Specs

- The root `agentic.docx` is treated as migration input only.
- The supported generated artifact is `build/agentic.docx`.
- The canonical editable product spec is [`docs/specs/agentic.md`](docs/specs/agentic.md).
