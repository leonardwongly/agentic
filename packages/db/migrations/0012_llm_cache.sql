create table if not exists llm_cache (
  key text primary key,
  value text not null,
  expires_at timestamptz not null,
  created_at timestamptz not null
);

create index if not exists llm_cache_expires_at_idx
  on llm_cache (expires_at);
