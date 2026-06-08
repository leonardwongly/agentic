# Cloudflare Workers Deployment (OpenNext)

This guide deploys the Agentic web/API to **Cloudflare Workers** using the
[`@opennextjs/cloudflare`](https://opennext.js.org/cloudflare) adapter. It is an
alternative to the provider-neutral [self-hosted](./self-hosted.md) and
[free-tier serverless](./free-tier-serverless.md) shapes.

> Cloudflare **Pages** is not a supported target: the Pages Next.js adapter is
> deprecated and capped at Next.js 13/14, while this app is on Next.js 16. The
> Workers + OpenNext path uses the Node.js runtime and supports Next.js 16.

## Status and hard prerequisites

This target is **not yet production-ready out of the box**. Before a real deploy
can succeed you must resolve two runtime-only items that cannot be validated
without a live Cloudflare account:

1. **Worker bundle size.** The single OpenNext worker is currently ~20+ MiB
   gzipped, over the Workers limit (3 MiB free / 10 MiB paid). `npm run
   cf:check-size` fails until this is reduced (OpenNext
   [multi-worker split](https://opennext.js.org/cloudflare/howtos/multi-worker)
   or dependency reduction). `wrangler deploy` will reject an oversized script.
2. **Hyperdrive + Postgres.** Workers cannot reuse a pg connection across
   requests; the app resolves a per-request `maxUses:1` pool from a Hyperdrive
   binding. You must provision Hyperdrive over your Postgres.

## Runtime shape on Cloudflare

| Component | How it runs |
| --- | --- |
| Web/API | Next.js app as a Worker via `@opennextjs/cloudflare` (`apps/web/worker.ts`). |
| Database | Postgres behind **Hyperdrive** (`HYPERDRIVE` binding); per-request `maxUses:1` pool. |
| Worker (jobs) | **Cron Trigger** → `scheduled()` → `POST /api/worker/tick` (drains durable jobs + one watcher pass). No always-on process. |
| Readiness | `/api/ready` reads the **DB-backed** worker heartbeat (do not set `AGENTIC_WORKER_HEALTH_PATH`). |
| File-backed features | **Unsupported.** Local notes stay disabled; learned-execution (self-improvement) memory degrades to a no-op (not persisted). |

## 1. Install tooling and authenticate

```bash
npm ci
npx wrangler login            # or set CLOUDFLARE_API_TOKEN + CLOUDFLARE_ACCOUNT_ID
```

## 2. Provision Postgres + Hyperdrive

```bash
# Apply migrations out-of-band against your Postgres (Workers never migrate):
DATABASE_URL=postgres://USER:PASS@HOST:5432/agentic npm run db:migrate
DATABASE_URL=postgres://USER:PASS@HOST:5432/agentic npm run db:status -- --require-ready

# Create a Hyperdrive config over the same database:
npx wrangler hyperdrive create agentic-db \
  --connection-string="postgres://USER:PASS@HOST:5432/agentic"
```

Uncomment and set the `hyperdrive` binding `id` in `apps/web/wrangler.jsonc`.

## 3. Configure secrets and vars

Non-secret request-identity config is committed in `apps/web/wrangler.jsonc`
`vars` (`AGENTIC_TRUST_PROXY_HEADERS`, `AGENTIC_PROXY_HEADER_OVERWRITE_CONFIRMED`,
`AGENTIC_TRUSTED_CLIENT_IP_HEADER=cf-connecting-ip`). Cloudflare overwrites
`CF-Connecting-IP` at the edge, so it is the trusted client IP.

Set the deployed origin and secrets (from `apps/web/`):

```bash
# Public origin (var or secret):
npx wrangler secret put AGENTIC_PUBLIC_BASE_URL          # https://<your-worker-domain>

# Core secrets:
npx wrangler secret put AGENTIC_ACCESS_KEY
npx wrangler secret put AGENTIC_BOOTSTRAP_USER_ID
npx wrangler secret put AGENTIC_BOOTSTRAP_DISPLAY_NAME
npx wrangler secret put AGENTIC_SHARED_AUTH_STATE        # "true"
npx wrangler secret put AGENTIC_REQUIRE_SHARED_AUTH_STATE # "true"

# Cron worker tick (must match a worker:tick entry in AGENTIC_MACHINE_TOKENS_JSON):
npx wrangler secret put AGENTIC_WORKER_TICK_TOKEN
npx wrangler secret put AGENTIC_MACHINE_TOKENS_JSON

# Optional provider secrets (Google/Slack/Telegram/GitHub) as needed.
```

Mint the worker-tick machine token hash for `AGENTIC_MACHINE_TOKENS_JSON`:

```bash
node -e 'const c=require("node:crypto");console.log(`sha256:${c.createHash("sha256").update(process.argv[1].trim()).digest("hex")}`)' '<raw-token>'
```

Use the raw token for `AGENTIC_WORKER_TICK_TOKEN` and the hash in a
`scopes:["worker:tick"]`, `routeGroups:["worker"]` machine-token record.

## 4. Build, check size, deploy

```bash
npm run cf:build -w @agentic/web      # next build + OpenNext transform
npm run cf:check-size                 # fails until the bundle is under the limit
cd apps/web
npx wrangler versions upload          # preview a version without promoting
npx wrangler deploy                   # promote to production
```

The Cron Trigger (`apps/web/wrangler.jsonc` → `triggers.crons`, default every 5
minutes) drives `POST /api/worker/tick`. Tune cadence to your queue latency and
set `AGENTIC_READY_WORKER_HEARTBEAT_STALE_MS` to ~2–3× the interval.

CI: the manual **Cloudflare Deploy** workflow
(`.github/workflows/cloudflare-deploy.yml`) runs the same steps; it skips cleanly
unless `CLOUDFLARE_API_TOKEN` + `CLOUDFLARE_ACCOUNT_ID` are configured.

## 5. Verify

```bash
curl https://<your-worker-domain>/api/health
curl https://<your-worker-domain>/api/ready
```

After at least one cron run, authenticated `/api/ready/details` shows a fresh
`worker_heartbeat` with `details.source: "database"`.

## Rollback

Cloudflare keeps prior Worker versions:

```bash
cd apps/web
npx wrangler deployments list         # find the previous version id
npx wrangler rollback [<version-id>]  # roll back to it
```

Rollback restores only the Worker code. Migrations are additive; do not run a
destructive schema downgrade unless a maintainer rollback note says it is safe.
Capture the current version id and a database backup id before deploying.

## Limitations on Workers

- **Bundle size** must be under the Workers limit before deploy (see Status).
- **Local notes** and **file-backed self-improvement memory** require a
  filesystem and are unsupported; learned memory is not persisted (no-op).
- **Migrations** run out-of-band (CI/deploy pipeline), never on the Worker.
- The standalone `apps/worker` process is **not** deployed here; the Cron
  Trigger replaces it. The Docker/Render and free-tier serverless paths remain
  valid and unaffected.
