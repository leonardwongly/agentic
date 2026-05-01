alter table tasks
  add column if not exists sort_order integer not null default 0;

alter table artifacts
  add column if not exists sort_order integer not null default 0;

alter table approval_requests
  add column if not exists sort_order integer not null default 0;

alter table watchers
  add column if not exists sort_order integer not null default 0;

alter table action_logs
  add column if not exists sort_order integer not null default 0;

alter table evidence_records
  add column if not exists actor_context jsonb;

create index if not exists tasks_goal_sort_order_created_at_id_idx
  on tasks (goal_id, sort_order asc, created_at asc, id asc);

create index if not exists artifacts_goal_sort_order_created_at_id_idx
  on artifacts (goal_id, sort_order asc, created_at asc, id asc);

create index if not exists approval_requests_goal_sort_order_created_at_id_idx
  on approval_requests (goal_id, sort_order asc, created_at asc, id asc);

create index if not exists watchers_goal_sort_order_created_at_id_idx
  on watchers (goal_id, sort_order asc, created_at asc, id asc);

create index if not exists action_logs_goal_sort_order_created_at_id_idx
  on action_logs (goal_id, sort_order asc, created_at asc, id asc);
