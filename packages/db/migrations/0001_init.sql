create table if not exists users (
  id text primary key,
  name text not null,
  created_at timestamptz not null
);

create table if not exists workflows (
  id text primary key,
  goal_id text not null,
  status text not null,
  current_step text not null,
  checkpoint text,
  created_at timestamptz not null,
  updated_at timestamptz not null
);

create table if not exists goals (
  id text primary key,
  user_id text not null,
  workflow_id text not null,
  title text not null,
  request text not null,
  intent text not null,
  status text not null,
  confidence real not null,
  explanation text not null,
  created_at timestamptz not null,
  updated_at timestamptz not null
);

create table if not exists tasks (
  id text primary key,
  goal_id text not null,
  workflow_id text not null,
  title text not null,
  summary text not null,
  assigned_agent text not null,
  state text not null,
  risk_class text not null,
  requires_approval boolean not null,
  depends_on jsonb not null default '[]'::jsonb,
  tool_capabilities jsonb not null default '[]'::jsonb,
  artifact_ids jsonb not null default '[]'::jsonb,
  created_at timestamptz not null,
  updated_at timestamptz not null
);

create table if not exists memory_records (
  id text primary key,
  user_id text not null,
  category text not null,
  memory_type text not null,
  content text not null,
  confidence real not null,
  source text not null,
  sensitivity text not null,
  permissions jsonb not null default '[]'::jsonb,
  review_at timestamptz,
  expiry_at timestamptz,
  created_at timestamptz not null,
  updated_at timestamptz not null
);

create table if not exists policy_rules (
  id text primary key,
  user_id text not null,
  name text not null,
  description text not null,
  active boolean not null default true,
  created_at timestamptz not null,
  updated_at timestamptz not null
);

create table if not exists approval_requests (
  id text primary key,
  goal_id text not null,
  task_id text not null,
  title text not null,
  rationale text not null,
  risk_class text not null,
  decision text not null,
  requested_action text not null,
  created_at timestamptz not null,
  responded_at timestamptz
);

create table if not exists action_logs (
  id text primary key,
  goal_id text not null,
  task_id text,
  workflow_id text,
  actor text not null,
  kind text not null,
  message text not null,
  details jsonb not null default '{}'::jsonb,
  created_at timestamptz not null
);

create table if not exists watchers (
  id text primary key,
  goal_id text not null,
  target_entity text not null,
  condition text not null,
  frequency text not null,
  trigger_action text not null,
  source_systems jsonb not null default '[]'::jsonb,
  status text not null,
  expiry_at timestamptz,
  created_at timestamptz not null,
  updated_at timestamptz not null
);

create table if not exists integration_accounts (
  id text primary key,
  user_id text not null,
  name text not null,
  system text not null,
  status text not null,
  scopes jsonb not null default '[]'::jsonb,
  capabilities jsonb not null default '[]'::jsonb,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null,
  updated_at timestamptz not null
);

create table if not exists artifacts (
  id text primary key,
  goal_id text not null,
  task_id text,
  artifact_type text not null,
  title text not null,
  content text not null,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null
);

