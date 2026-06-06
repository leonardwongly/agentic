-- Shared worker runtime heartbeat for split web/worker deployments (for
-- example serverless web plus a scheduled run-once worker) where the web
-- process cannot read a worker-local heartbeat file. Both processes share this
-- table through DATABASE_URL. The DDL is additive and idempotent.

create table if not exists worker_runtime_health (
  runner_id text primary key,
  snapshot jsonb not null,
  updated_at timestamptz not null
);

create index if not exists worker_runtime_health_updated_at_idx
  on worker_runtime_health (updated_at);
