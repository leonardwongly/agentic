alter table workspace_governance
  add column if not exists shadow_replay_policy jsonb;
