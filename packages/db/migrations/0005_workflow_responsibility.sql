alter table goals
  add column if not exists responsibility jsonb not null default '{}'::jsonb;

alter table tasks
  add column if not exists responsibility jsonb not null default '{}'::jsonb;

alter table approval_requests
  add column if not exists responsibility jsonb not null default '{}'::jsonb;

alter table autopilot_events
  add column if not exists responsibility jsonb not null default '{}'::jsonb;
