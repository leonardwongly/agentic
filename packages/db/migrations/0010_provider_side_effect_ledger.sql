create table if not exists provider_side_effects (
  id text primary key,
  user_id text not null,
  workspace_id text,
  goal_id text not null,
  task_id text not null,
  adapter text not null,
  operation text not null,
  idempotency_key text not null,
  side_effect_target text not null,
  status text not null,
  provider_ref text,
  detail text,
  error text,
  attempt_count integer not null default 1,
  metadata jsonb not null default '{}'::jsonb,
  reserved_at timestamptz not null,
  last_attempt_at timestamptz not null,
  completed_at timestamptz,
  created_at timestamptz not null,
  updated_at timestamptz not null
);

create unique index if not exists provider_side_effects_user_idempotency_idx
  on provider_side_effects (user_id, idempotency_key);

create index if not exists provider_side_effects_user_updated_at_idx
  on provider_side_effects (user_id, updated_at);

create index if not exists provider_side_effects_goal_task_idx
  on provider_side_effects (goal_id, task_id);

create index if not exists provider_side_effects_status_idx
  on provider_side_effects (status);
