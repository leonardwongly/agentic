# Self-Hosted Deployment

This guide is the provider-neutral path for running Agentic outside any
maintainer-owned infrastructure. Render, Railway, Fly.io, a VPS, Kubernetes, or
Docker Compose can all work when they provide the same basic shape:

- one web/API process
- one worker process
- one Postgres database shared by both processes
- stable HTTPS ingress for the web/API process
- installer-owned secrets and rollback authority

The upstream repository metadata identifies the canonical source project, but a
running installation is owned by the operator who controls its environment
variables, database, GitHub App, provider account, and access key.

## Minimum Runtime Shape

| Component | Requirement |
| --- | --- |
| Web/API | Runs `npm run start:web:prod -- --hostname 0.0.0.0 --port <port>` after migrations. |
| Worker | Runs `npm run start:worker:prod` against the same `DATABASE_URL`. |
| Database | Postgres with migrations applied before traffic is served. |
| Auth state | Shared auth state required for production or multi-instance installs. |
| Worker heartbeat | A small JSON heartbeat path readable by web and writable by worker. |
| Ingress | Stable HTTPS origin that overwrites the trusted client-IP header at the edge. |

Do not use the file-backed runtime store for shared, staging, or production
installs. It is a development-only mode.

## Required Environment

Set these for both web and worker unless noted otherwise:

```bash
export NODE_ENV=production
export DATABASE_URL=postgres://agentic:agentic@postgres:5432/agentic
export AGENTIC_ACCESS_KEY=replace-this-with-a-long-random-secret
export AGENTIC_BOOTSTRAP_USER_ID=owner
export AGENTIC_BOOTSTRAP_DISPLAY_NAME="Instance Owner"
export AGENTIC_DEFAULT_TIMEZONE=UTC
export AGENTIC_PUBLIC_BASE_URL=https://agentic.example.com
export AGENTIC_REQUIRE_SHARED_AUTH_STATE=true
export AGENTIC_SHARED_AUTH_STATE=true
export AGENTIC_WORKER_HEALTH_PATH=/var/lib/agentic/worker-health.json
```

Keep `AGENTIC_ACCESS_KEY` as the installer bootstrap and break-glass secret.
Routine automation that only needs to enqueue durable jobs should use scoped
machine tokens instead. Machine tokens are configured as hashed JSON records so
the raw token is never stored in the environment:

```bash
node -e 'const crypto = require("node:crypto"); const token = process.argv[1]; console.log(`sha256:${crypto.createHash("sha256").update(token.trim()).digest("hex")}`)' '<raw-machine-token>'

export AGENTIC_MACHINE_TOKENS_JSON='[
  {
    "id": "ci-goal-enqueue",
    "subject": "CI routine job enqueue",
    "userId": "owner",
    "tokenHash": "sha256:<64-hex-digest>",
    "scopes": ["jobs:create"],
    "routeGroups": ["automation"],
    "workspaceIds": null,
    "expiresAt": "2026-12-31T23:59:59.000Z",
    "revoked": false
  }
]'
```

Call opted-in automation routes with `x-agentic-machine-token:
<raw-machine-token>` or `Authorization: Bearer <raw-machine-token>`. A token is
accepted only on routes that explicitly allow its route group and scope; an
invalid, expired, or revoked machine token fails closed even if another
credential is also present.

Set proxy trust only after confirming your ingress overwrites the configured
header and never forwards a user-supplied value unchanged:

```bash
export AGENTIC_TRUST_PROXY_HEADERS=true
export AGENTIC_PROXY_HEADER_OVERWRITE_CONFIRMED=true
export AGENTIC_TRUSTED_CLIENT_IP_HEADER=x-forwarded-for
```

Optional GitHub issue intake values should use the installer's repository and
GitHub App, not the upstream maintainer's app:

```bash
export AGENTIC_GITHUB_ISSUE_ALLOWED_REPOSITORIES=<your-org>/<your-repo>
export AGENTIC_GITHUB_ISSUE_INTAKE_USER_ID=owner
export AGENTIC_GITHUB_WEBHOOK_SECRET=replace-this-with-a-long-random-secret
export AGENTIC_GITHUB_APP_ID=replace-with-your-github-app-id
export AGENTIC_GITHUB_APP_INSTALLATION_ID=replace-with-your-installation-id
export AGENTIC_GITHUB_APP_PRIVATE_KEY=replace-with-your-private-key
export AGENTIC_GITHUB_APP_SYNC_SECRET=replace-this-with-a-long-random-secret
```

## Docker Compose Example

The example in [`deploy/self-hosted/docker-compose.yml`](../../deploy/self-hosted/docker-compose.yml)
builds the checked-in Dockerfile and starts web, worker, and Postgres locally.
Create a local `.env.self-hosted` file from the variables above, then run:

```bash
docker compose -f deploy/self-hosted/docker-compose.yml --env-file .env.self-hosted up --build
```

The web process runs migrations before starting. The worker starts after
Postgres is healthy and writes the heartbeat file into a shared volume.

Validate:

```bash
curl http://localhost:3000/api/health
curl http://localhost:3000/api/ready
```

For a real public deployment, place the web service behind HTTPS and set
`AGENTIC_PUBLIC_BASE_URL` to that origin.

## Plain Node Process Layout

If you are not using containers, use this startup order:

1. Provision Postgres and create the database.
2. Install dependencies with `npm ci`.
3. Export the required environment variables.
4. Run `npm run db:migrate`.
5. Run `npm run db:status -- --require-ready`.
6. Run `npm run production:bootstrap:check`.
7. Build with `npm run build`.
8. Start web with `npm run start:web:prod -- --hostname 0.0.0.0 --port 3000`.
9. Start worker with `npm run start:worker:prod`.
10. Confirm `/api/health` and `/api/ready` from the public HTTPS origin.

## Backup And Rollback

Before upgrading:

- capture the current Git SHA, image tag, and database backup identifier
- run `npm run db:status -- --require-ready`
- keep the previous image or checkout available for rollback
- document who can roll back the deployment

Rollback should restore the previous web and worker build. Do not run a
destructive schema downgrade unless a maintainer-provided rollback note
explicitly says it is safe. The current migrations are intended to be additive.

## Validation Checklist

Run these before publishing an installation as ready:

```bash
npm run setup:check
npm run lint
npm run typecheck
npm run format:check
npm run test:oss:ownership
npm test
npm run test:security:regression
npm run test:architecture:fitness
npm run build
npm run release:check-context
```

Production-like validation should also include:

```bash
npm run db:migrate
npm run db:status -- --require-ready
npm run production:bootstrap:check
npm run deploy:ingress:check
```

Run the smoke commands only after stable HTTPS ingress and runtime secrets are
configured:

```bash
npm run test:smoke:deployment
npm run test:smoke:deployment-async
npm run test:smoke:github-app-sync
```

## Provider Examples

`deploy/render/render.yaml` is an optional Render Blueprint example. It is not
the canonical deployment path, and it should be copied and reviewed in the
installer's provider account before use.

For a completely-free deployment that replaces the always-on worker with a
bounded run-once worker on a free scheduler (for example Vercel + Neon + GitHub
Actions cron), see [`free-tier-serverless.md`](./free-tier-serverless.md).

For Cloudflare Workers via the OpenNext adapter (Hyperdrive-backed Postgres and a
Cron Trigger replacing the worker process), see
[`cloudflare-workers.md`](./cloudflare-workers.md).

Fork maintainers can add provider-specific examples as long as they preserve
the same safety properties: Postgres-backed state, separate worker process,
stable HTTPS ingress, installer-owned secrets, and a clear rollback path.
