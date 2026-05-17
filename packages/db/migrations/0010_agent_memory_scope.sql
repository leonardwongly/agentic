alter table memory_records
  add column if not exists agent_id text;

alter table memory_records
  add column if not exists agent_scope text not null default 'global';

create index if not exists memory_records_user_agent_created_at_id_idx
  on memory_records (user_id, agent_id, created_at desc, id desc)
  where agent_id is not null;
