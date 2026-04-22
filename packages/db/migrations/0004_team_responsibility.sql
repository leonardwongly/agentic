alter table tasks
  add column if not exists team_responsibility jsonb;

alter table approval_requests
  add column if not exists team_responsibility jsonb;

alter table autopilot_events
  add column if not exists team_responsibility jsonb;

alter table watchers
  add column if not exists team_responsibility jsonb;
