# Postgres Shared Auth Bootstrap

This runbook proves the production runtime is using Postgres-backed application state and shared auth runtime state before rollout. It is intentionally separate from generic `db:status` output so reviewers can see the full bootstrap contract without exposing database URLs, access keys, or provider secrets.

## Contract

Production bootstrap evidence is valid only when all of these are true:

- `NODE_ENV=production`.
- `DATABASE_URL` is configured for the selected target database.
- `npm run db:migrate` has been run against that target database.
- `npm run db:status -- --require-ready` passes against that target database.
- `AGENTIC_REQUIRE_SHARED_AUTH_STATE=true`.
- `AGENTIC_ALLOW_PROCESS_LOCAL_AUTH_STATE` is unset or not `true`.
- `AGENTIC_ACCESS_KEY` is configured in the runtime secret store.
- `AGENTIC_TRUST_PROXY_HEADERS=true` is enabled only after confirming the ingress overwrites the configured client-IP header.
- `AGENTIC_TRUSTED_CLIENT_IP_HEADER` is one of `x-forwarded-for`, `x-real-ip`, or `cf-connecting-ip`.
- `AGENTIC_WORKER_HEALTH_PATH` is an absolute path that the web runtime can read and the worker runtime can write.

Do not treat file-backed storage, process-local auth state, or a local tunnel as production proof.

## Local Static Preflight

Use static preflight when the real provider database is blocked but the repository-side contract still needs review. This validates production configuration shape and makes the skipped database proof explicit.

```bash
NODE_ENV=production \
DATABASE_URL=postgres://example.invalid/agentic \
AGENTIC_ACCESS_KEY=replace-with-secret-from-runtime-store \
AGENTIC_REQUIRE_SHARED_AUTH_STATE=true \
AGENTIC_TRUST_PROXY_HEADERS=true \
AGENTIC_TRUSTED_CLIENT_IP_HEADER=x-forwarded-for \
AGENTIC_WORKER_HEALTH_PATH=/var/lib/agentic/worker-health.json \
npm run production:bootstrap:check -- --static-only
```

Expected result: all static checks pass and `database_schema` is reported as a warning because no live target database was checked.

## Target Database Proof

Run these commands from a trusted operator shell where `DATABASE_URL` points at the selected production-like Postgres instance.

```bash
export NODE_ENV=production
export DATABASE_URL=postgres://user:password@host:5432/agentic
export AGENTIC_ACCESS_KEY=replace-with-secret-from-runtime-store
export AGENTIC_REQUIRE_SHARED_AUTH_STATE=true
export AGENTIC_TRUST_PROXY_HEADERS=true
export AGENTIC_TRUSTED_CLIENT_IP_HEADER=x-forwarded-for
export AGENTIC_WORKER_HEALTH_PATH=/var/lib/agentic/worker-health.json

npm run db:migrate
npm run db:status -- --require-ready
npm run production:bootstrap:check
```

The bootstrap report is safe to attach to issue or PR evidence because it redacts secrets by omission. It includes counts, migration names, readiness state, and missing required objects, but never prints `DATABASE_URL` or `AGENTIC_ACCESS_KEY`.

## Readiness Follow-Up

After the web and worker services are deployed:

```bash
npm run test:smoke:deployment
npm run test:smoke:deployment-async
```

Then verify `/api/ready` reports:

- `storageBackend: "postgres"`.
- `database` check passing.
- `auth_runtime_state` check passing.
- `worker_heartbeat` check passing.
- no process-local auth warnings.

If `worker_heartbeat` fails on a multi-container provider, do not override the check. Configure a provider-supported shared filesystem path or equivalent worker-readiness channel before treating production readiness as complete.

## Rollback

The shared auth runtime migration is additive. If application rollout fails after migrations:

1. Roll back the application image or service revision.
2. Keep the shared auth runtime tables and indexes in place.
3. Re-run `npm run db:status -- --require-ready` before retrying rollout.

Dropping auth runtime tables can erase revocation, rate-limit, and unlock-throttle state. Treat destructive schema rollback as a separate operator-approved data plan.

## Current Blocker

As of 2026-05-18, target-provider proof remains blocked until the stable ingress and managed Postgres environment are provisioned. The latest Render Blueprint validation reached Render and returned `need_payment_info` for the target resources, so this runbook can validate the repository-side contract locally but cannot replace real target database evidence.
