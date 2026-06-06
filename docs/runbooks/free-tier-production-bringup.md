# Free-Tier Production Bring-Up

A turnkey checklist for standing up a **completely-free** Agentic deployment
(Neon + Vercel + GitHub Actions cron) and capturing the proof that closes the
production-readiness issues #141–#145 and the #152 roadmap.

This is the operational companion to
[`docs/deployment/free-tier-serverless.md`](../deployment/free-tier-serverless.md)
(architecture and options) and
[`docs/runbooks/github-issue-autopilot.md`](./github-issue-autopilot.md)
(GitHub App setup). Placeholders are written as `<…>`.

## Stack and issue mapping

| Component | Free service | Proves |
| --- | --- | --- |
| Web/API | Vercel Hobby | #141 stable HTTPS ingress + health/readiness |
| Database | Neon (free Postgres) | #143 Postgres + shared-auth bootstrap |
| Worker | GitHub Actions cron (run-once) | #144 worker durability + recovery |
| GitHub App issue sync | GitHub App + workflow | #142 runtime config / fail-closed auth, #145 live e2e |

The original issues assumed a Render web+worker+Postgres shape. This path proves
the same properties differently — worker durability comes from the scheduled
run-once worker plus the database-backed heartbeat rather than an always-on
service. Note that equivalence in each issue comment so the proof is unambiguous.

## Phase 0 — Prerequisites (one-time)

- Accounts: a Neon project, a Vercel account, GitHub admin on your fork.
- Local tools: Node 22, `gh` (authenticated), optionally the Vercel CLI.
- Generate the runtime access key once and keep it safe:

  ```bash
  export AGENTIC_ACCESS_KEY="$(openssl rand -hex 32)"
  echo "$AGENTIC_ACCESS_KEY"
  ```

## Phase 1 — Database (Neon) → #143 groundwork

Create a Neon project and copy two connection strings: the **pooled**
(`...-pooler...`) string for the serverless web app, and the **direct** string
for migrations. Apply migrations and prove readiness from your machine:

```bash
export DATABASE_URL="<neon-direct-url>"
export AGENTIC_ACCESS_KEY="<from Phase 0>"
npm ci
npm run db:migrate
npm run db:status -- --require-ready
npm run production:bootstrap:check
```

## Phase 2 — Web/API on Vercel → #141

1. Import the repo in Vercel. Set **Root Directory = `apps/web`**, framework
   Next.js (install runs from the monorepo root so the `@agentic/*` workspaces
   resolve).
2. Add Production environment variables:

   ```
   NODE_ENV=production
   DATABASE_URL=<neon-POOLED-url>
   AGENTIC_ACCESS_KEY=<from Phase 0>
   AGENTIC_BOOTSTRAP_USER_ID=owner
   AGENTIC_BOOTSTRAP_DISPLAY_NAME=Instance Owner
   AGENTIC_DEFAULT_TIMEZONE=UTC
   AGENTIC_PUBLIC_BASE_URL=https://<your-app>.vercel.app
   AGENTIC_REQUIRE_SHARED_AUTH_STATE=true
   AGENTIC_READY_WORKER_HEARTBEAT_STALE_MS=1800000
   ```

   Leave `AGENTIC_WORKER_HEALTH_PATH` unset so readiness uses the database-backed
   worker heartbeat.
3. Deploy, then capture ingress/health proof for #141:

   ```bash
   curl -i https://<your-app>.vercel.app/api/health
   curl -i https://<your-app>.vercel.app/api/ready
   ```

## Phase 3 — Scheduled worker (GitHub Actions) → #144

1. Add repository **secrets** `AGENTIC_DATABASE_URL` (a Neon URL) and
   `AGENTIC_ACCESS_KEY`. Optionally add repository **variables**
   `AGENTIC_BOOTSTRAP_USER_ID`, `AGENTIC_BOOTSTRAP_DISPLAY_NAME`,
   `AGENTIC_DEFAULT_TIMEZONE`.
2. Run the **Scheduled Worker** workflow once (Actions → Run workflow). It
   executes `npm run worker:once`.
3. Prove worker durability for #144 — the heartbeat should be fresh and
   database-sourced:

   ```bash
   curl -s -H "x-agentic-access-key: $AGENTIC_ACCESS_KEY" \
     https://<your-app>.vercel.app/api/ready/details \
     | jq '.checks[] | select(.name=="worker_heartbeat")'
   # expect status "pass", details.source "database"
   ```

## Phase 4 — Deployment proof → #141 / #143

```bash
export AGENTIC_SMOKE_BASE_URL=https://<your-app>.vercel.app
export AGENTIC_SMOKE_ACCESS_KEY="$AGENTIC_ACCESS_KEY"
npm run test:smoke:deployment
npm run test:smoke:deployment-async
```

## Phase 5 — GitHub App issue sync → #142 / #145

Create and install the GitHub App per
[`github-issue-autopilot.md`](./github-issue-autopilot.md), then:

1. Set on Vercel: `AGENTIC_GITHUB_APP_ID`, `AGENTIC_GITHUB_APP_INSTALLATION_ID`,
   `AGENTIC_GITHUB_APP_PRIVATE_KEY`, `AGENTIC_GITHUB_APP_SYNC_SECRET`,
   `AGENTIC_GITHUB_ISSUE_ALLOWED_REPOSITORIES=<your-org>/<your-repo>`.
2. Set repository variable
   `AGENTIC_GITHUB_APP_ISSUE_SYNC_URL=https://<your-app>.vercel.app/api/github/issues/app/sync`
   and secret `AGENTIC_GITHUB_APP_SYNC_SECRET`, then enable the
   `github-app-issue-sync.yml` workflow.
3. Prove fail-closed auth (#142) and live e2e (#145):

   ```bash
   npm run github:app-sync:preflight:collect
   npm run test:smoke:github-app-sync
   ```

## Phase 6 — Close the issues → #152

```bash
npm run release:closeout:evidence
```

Paste the relevant command outputs (health/readiness, smoke results, preflight
pass) into #141, #143, #144, then #142/#145, and update the #152 roadmap. Do not
hand-edit evidence JSON to bypass live proof.

## Notes and caveats

- Use Neon's **pooled** connection string for the Vercel serverless web app to
  avoid connection exhaustion; the **direct** string is fine for migrations.
- Set `AGENTIC_READY_WORKER_HEARTBEAT_STALE_MS` to roughly 2–3x the scheduled
  worker interval so a between-run heartbeat is not flagged stale.
- Migrations are applied out of band (Phase 1); the scheduled worker fails fast
  if the schema is not ready.
- Keep the raw machine-token/secret values out of the repository; only sha256
  hashes belong in `AGENTIC_MACHINE_TOKENS_JSON`.
