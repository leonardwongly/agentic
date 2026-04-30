alter table jobs
  add column if not exists priority text not null default 'normal',
  add column if not exists queue_name text not null default 'default',
  add column if not exists concurrency_key text,
  add column if not exists timeout_ms integer;

create index if not exists jobs_queue_status_priority_available_at_idx
  on jobs (queue_name, status, priority, available_at);

create index if not exists jobs_concurrency_key_status_idx
  on jobs (concurrency_key, status)
  where concurrency_key is not null;
