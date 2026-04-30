alter table watchers
  add column if not exists schedule jsonb not null default '{"enabled":true,"dryRun":true,"cursor":null,"lastRunAt":null,"nextRunAt":null,"lease":null}'::jsonb,
  add column if not exists last_evaluation jsonb,
  add column if not exists escalation_policy jsonb not null default '{"notify":true,"minSuppressionMs":900000,"maxTriggersPerHour":4}'::jsonb;

create index if not exists watchers_scheduler_due_idx
  on watchers (status, ((schedule->>'nextRunAt')));
