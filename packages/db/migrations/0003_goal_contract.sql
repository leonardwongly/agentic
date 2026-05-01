alter table goals
  add column if not exists goal_contract jsonb;
