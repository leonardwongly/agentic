alter table jobs
  add column if not exists execution_journal jsonb;
