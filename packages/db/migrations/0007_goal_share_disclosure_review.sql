alter table goal_shares
  add column if not exists disclosure_review jsonb;
