# Agentic

Agentic is a trusted execution control plane for commitments, approvals, automations, memories, and integrations. It is built as a TypeScript-first modular monolith with a Next.js web surface, a governed execution loop, and a reproducible `agentic.docx` pipeline.

## What It Does

Agentic keeps day-to-day work inside a bounded operating loop:

1. capture goals, commitments, and signals
2. classify risk and apply governance
3. draft work or request approval when needed
4. execute through provider-neutral integrations
5. persist evidence, outcomes, and audit history

The current product surface is centered on:

- a commitment-first dashboard for the next actions that matter
- approvals and autopilot events with explicit evidence and recovery state
- policy-aware memories, goals, workflows, and watchers
- connector readiness reporting so the UI only advertises what an integration can safely do

## Architecture At A Glance

- `apps/web`: Next.js UI, JSON API routes, session handling, and dashboard surfaces
- `packages/orchestrator`: workflow assembly, routing, approvals, and execution coordination
- `packages/policy`: governance, risk classification, and approval gating
- `packages/repository`: persistence access for dashboards, goals, approvals, and integrations
- `packages/integrations`: provider-neutral adapter contracts and readiness classification
- `packages/memory`: memory records and ranking behavior
- `packages/execution`: task and workflow execution state
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

Optional production hardening:

```bash
export AGENTIC_REQUIRE_SHARED_AUTH_STATE=true
```

When enabled in production, Agentic fails closed if session revocation, session rate limiting, and unlock throttling are still backed by process-local memory. This is the recommended mode for multi-instance deployments.

Optional development or test opt-in for the shared auth-state backend:

```bash
export AGENTIC_SHARED_AUTH_STATE=true
```

With `DATABASE_URL` configured, production automatically uses the Postgres-backed auth-state tables. Development and test stay on bounded in-memory auth state unless you opt in explicitly with `AGENTIC_SHARED_AUTH_STATE=true`.

4. Start the web app:

```bash
npm run dev
```

The app runs at `http://localhost:3000`.

5. Create a session:

- Use the dashboard sign-in flow, or
- POST the access key to `/api/session` and let the app issue the session cookie used by authenticated API routes

6. Render and validate the document:

```bash
npm run docs:build
```

7. Run tests:

```bash
npm test
```

8. Run browser E2E coverage:

```bash
npx playwright install chromium
npm run test:e2e
```

9. Build the production web app:

```bash
npm run build
```

## Persistence And Local Storage

- If `DATABASE_URL` is set, the app uses the Postgres-backed repository.
- Otherwise it falls back to a file-backed runtime store at `.agentic/runtime-store.json` so the app stays runnable before the database is provisioned outside production. Production requires `DATABASE_URL`.
- In production, `DATABASE_URL` also enables Postgres-backed auth session rate limiting, session revocation, and session unlock throttling.
- In development and test, those auth-state controls stay in-memory by default so local runs do not silently depend on Postgres. Set `AGENTIC_SHARED_AUTH_STATE=true` when you want to exercise the shared backend outside production.
- `AGENTIC_RUNTIME_STORE_PATH` overrides the file-backed store path when you need isolated local or test storage.
- `AGENTIC_NOTES_PATH` overrides the local notes directory used by the filesystem-backed notes adapter.

The first concrete local adapter is a notes provider that reads and writes Markdown files under `.agentic/notes`.

## Security And Access

- API routes are protected by a session cookie created through `/api/session`.
- Authenticated route handlers are scoped to the signed-in principal rather than a global user fallback.
- Session revocation, login throttling, and unlock throttling default to bounded in-memory stores for local development and tests.
- Production automatically upgrades those controls to shared Postgres-backed state when `DATABASE_URL` is configured.
- `AGENTIC_SHARED_AUTH_STATE=true` opts development and test into the shared Postgres-backed auth-state path.
- `AGENTIC_REQUIRE_SHARED_AUTH_STATE=true` makes production fail closed if shared auth-state infrastructure is still unavailable.
- External actions stay behind governance and approval checks unless a connector has earned a higher readiness tier.
- Approval and execution evidence is persisted so operator-visible state matches what actually ran.

## Documents And Specs

- The root `agentic.docx` is treated as migration input only.
- The supported generated artifact is `build/agentic.docx`.
- The canonical editable product spec is [`docs/specs/agentic.md`](docs/specs/agentic.md).
