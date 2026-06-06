# Free-Tier Serverless Deployment

This guide runs Agentic on completely-free infrastructure by replacing the
always-on worker process with a **bounded run-once worker** driven by a free
scheduler. A typical free stack is:

- **Web/API**: a free serverless host (for example Vercel Hobby)
- **Database**: a free managed Postgres (for example Neon)
- **Worker**: the run-once worker, driven by **GitHub Actions cron** (free for
  public repositories) or an authenticated **HTTP tick** trigger

The trade-off versus the always-on [self-hosted](./self-hosted.md) shape: queued
work is processed in scheduled batches, so job latency is bounded by the
scheduler interval rather than near-real-time.

## Why this needs a different worker shape

The default deployment runs a long-lived worker that polls the queue forever.
Free serverless hosts do not run always-on background processes, and they do not
share a filesystem with the web process. Two capabilities make a free split
deployment work:

1. **Run-once worker mode** — drain a bounded batch of jobs and exit, so a
   scheduler can invoke it.
2. **Database-backed worker heartbeat** — the worker records its heartbeat to
   the shared `DATABASE_URL`, and the web `/api/ready` probe reads it from there
   instead of a shared file.

## 1. Provision free Postgres

Create a free Postgres database and copy its connection string into
`DATABASE_URL`. Apply migrations once (and again after each upgrade):

```bash
export DATABASE_URL=postgres://user:password@host/db
npm ci
npm run db:migrate
npm run db:status -- --require-ready
```

The scheduled worker does **not** run migrations; apply them from your deploy
pipeline or manually.

## 2. Deploy the web/API to a free serverless host

Set at least these environment variables on the web host:

```bash
NODE_ENV=production
DATABASE_URL=postgres://user:password@host/db
AGENTIC_ACCESS_KEY=replace-with-a-long-random-secret
AGENTIC_BOOTSTRAP_USER_ID=owner
AGENTIC_BOOTSTRAP_DISPLAY_NAME=Instance Owner
AGENTIC_DEFAULT_TIMEZONE=UTC
AGENTIC_PUBLIC_BASE_URL=https://<your-app>.vercel.app
# Heartbeat readiness window: ~2-3x your scheduler interval (10 min -> 30 min).
AGENTIC_READY_WORKER_HEARTBEAT_STALE_MS=1800000
```

Do **not** set `AGENTIC_WORKER_HEALTH_PATH` in a split deployment. With it unset
and `DATABASE_URL` set, readiness reads the worker heartbeat from the database
(`details.source` is `database`).

## 3. Drive the worker on a free schedule

### Option A (recommended): GitHub Actions cron

`.github/workflows/scheduled-worker.yml` runs the run-once worker on a schedule.
For public repositories this is free. Configure repository **secrets**:

- `AGENTIC_DATABASE_URL` — the same Postgres connection string
- `AGENTIC_ACCESS_KEY` — the runtime access key

Optionally set repository **variables** `AGENTIC_BOOTSTRAP_USER_ID`,
`AGENTIC_BOOTSTRAP_DISPLAY_NAME`, and `AGENTIC_DEFAULT_TIMEZONE`.

The workflow runs `npm run worker:once`, which drains up to
`AGENTIC_WORKER_MAX_JOBS` jobs (and exits early when the queue is empty), runs
one watcher-scheduler pass, records the DB heartbeat, and exits. Tune the `cron`
expression to your workload (minimum interval is 5 minutes). It skips cleanly
when the secrets are absent, so forks are unaffected.

You can also run the bounded worker from any environment with database access:

```bash
DATABASE_URL=... AGENTIC_ACCESS_KEY=... npm run worker:once
# or, with explicit bounds:
AGENTIC_WORKER_MAX_JOBS=25 AGENTIC_WORKER_MAX_DURATION_MS=60000 npm run worker:once
```

### Option B: authenticated HTTP tick

For schedulers that can only make an HTTP request (Vercel Cron, cron-job.org),
call `POST /api/worker/tick`. It drains a bounded batch in the web runtime and
is gated by a **scoped machine token** (it rejects the global access key).

1. Mint a long random token and store its sha256 hash:

   ```bash
   node -e 'const c=require("node:crypto");const t=process.argv[1];console.log(`sha256:${c.createHash("sha256").update(t.trim()).digest("hex")}`)' '<raw-token>'
   ```

2. Configure the token on the web host (raw token is never stored):

   ```bash
   AGENTIC_MACHINE_TOKENS_JSON='[{"id":"worker-tick","subject":"scheduled worker tick","userId":"owner","tokenHash":"sha256:<64-hex>","scopes":["worker:tick"],"routeGroups":["worker"],"workspaceIds":null,"expiresAt":null,"revoked":false}]'
   ```

3. Schedule the call (bounded by `maxJobs` and `maxDurationMs`, capped at 50 and
   60s so it stays within serverless execution limits):

   ```bash
   curl -fsS -X POST https://<your-app>.vercel.app/api/worker/tick \
     -H 'content-type: application/json' \
     -H 'x-agentic-machine-token: <raw-token>' \
     -d '{"maxJobs":10,"maxDurationMs":10000}'
   ```

**Security:** `/api/worker/tick` executes already-enqueued durable jobs. Those
jobs remain individually governed (high-risk external actions still require
approval), the endpoint requires a scoped machine token or an owner session, the
global bootstrap access key is rejected, and the route is rate-limited and time
bounded. Prefer Option A when you can, since it keeps job execution off the
public web runtime.

## Verifying

```bash
curl https://<your-app>.vercel.app/api/health
curl https://<your-app>.vercel.app/api/ready
```

After at least one worker run, authenticated `/api/ready/details` reports a
`worker_heartbeat` check with `details.source: "database"` and a fresh
`updatedAt`. If it reports stale between runs, raise
`AGENTIC_READY_WORKER_HEARTBEAT_STALE_MS` relative to your scheduler interval.

## Limits and caveats

- **Batched latency**: jobs wait up to one scheduler interval before running.
- **Scheduler minimums**: GitHub Actions cron runs no more often than every 5
  minutes and may be delayed under load.
- **Serverless execution limits**: keep the HTTP tick's `maxDurationMs` under the
  host's function timeout; long jobs are better drained by Option A.
- **Concurrency**: with `NODE_ENV=production` the worker applies conservative
  side-effect concurrency defaults; the durable queue's per-job leases keep
  overlapping runs safe.
- **Migrations**: apply them out of band; the scheduled worker fails fast if the
  schema is not ready.
