create table if not exists users (
  id text primary key,
  name text not null,
  created_at timestamptz not null
);

create table if not exists auth_session_rate_limits (
  key text primary key,
  attempts integer not null,
  window_start timestamptz not null,
  locked_until timestamptz,
  updated_at timestamptz not null
);

create table if not exists auth_revoked_sessions (
  session_id text primary key,
  expires_at timestamptz not null,
  revoked_at timestamptz not null
);

create table if not exists session_unlock_attempts (
  key text primary key,
  failures integer not null,
  first_failure_at timestamptz not null,
  last_seen_at timestamptz not null,
  blocked_until timestamptz not null
);

create index if not exists auth_revoked_sessions_expires_at_idx
  on auth_revoked_sessions (expires_at);

create index if not exists auth_session_rate_limits_updated_at_idx
  on auth_session_rate_limits (updated_at);

create index if not exists session_unlock_attempts_last_seen_at_idx
  on session_unlock_attempts (last_seen_at);

create table if not exists telegram_approval_actions (
  action_id text primary key,
  approval_id text not null,
  goal_id text not null,
  workspace_id text,
  decision text not null,
  expires_at timestamptz not null,
  consumed_at timestamptz,
  created_at timestamptz not null
);

create index if not exists telegram_approval_actions_approval_id_idx
  on telegram_approval_actions (approval_id);

create index if not exists telegram_approval_actions_expires_at_idx
  on telegram_approval_actions (expires_at);

create table if not exists workflows (
  id text primary key,
  goal_id text not null,
  workspace_id text,
  status text not null,
  current_step text not null,
  checkpoint text,
  created_at timestamptz not null,
  updated_at timestamptz not null
);

create table if not exists goals (
  id text primary key,
  user_id text not null,
  workspace_id text,
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

alter table workflows add column if not exists workspace_id text;
alter table goals add column if not exists workspace_id text;

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
  team_responsibility jsonb,
  created_at timestamptz not null,
  updated_at timestamptz not null
);

alter table tasks add column if not exists team_responsibility jsonb;

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
  actor_context jsonb,
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
  action_intent jsonb,
  preview jsonb not null default '{}'::jsonb,
  decision_scope text,
  decision_rationale text,
  history jsonb not null default '[]'::jsonb,
  team_responsibility jsonb,
  created_at timestamptz not null,
  expiry_at timestamptz not null,
  responded_at timestamptz
);

alter table approval_requests add column if not exists action_intent jsonb;
alter table approval_requests add column if not exists preview jsonb not null default '{}'::jsonb;
alter table approval_requests add column if not exists decision_scope text;
alter table approval_requests add column if not exists decision_rationale text;
alter table approval_requests add column if not exists history jsonb not null default '[]'::jsonb;
alter table approval_requests add column if not exists team_responsibility jsonb;

create table if not exists commitments (
  id text primary key,
  user_id text not null,
  title text not null,
  summary text not null,
  status text not null,
  source_kind text not null,
  source_id text not null,
  goal_id text,
  approval_id text,
  due_at timestamptz,
  actor_context jsonb,
  confidence real not null,
  evidence jsonb not null default '[]'::jsonb,
  created_at timestamptz not null,
  updated_at timestamptz not null
);

create table if not exists workspaces (
  id text primary key,
  owner_user_id text not null,
  slug text not null,
  name text not null,
  description text not null default '',
  is_personal boolean not null default false,
  created_at timestamptz not null,
  updated_at timestamptz not null
);

create unique index if not exists workspaces_slug_idx
  on workspaces (slug);

create table if not exists workspace_members (
  id text primary key,
  workspace_id text not null,
  user_id text not null,
  role text not null,
  joined_at timestamptz not null,
  updated_at timestamptz not null
);

create unique index if not exists workspace_members_workspace_user_idx
  on workspace_members (workspace_id, user_id);

create table if not exists workspace_selections (
  user_id text primary key,
  workspace_id text not null,
  actor_context jsonb,
  selected_at timestamptz not null,
  updated_at timestamptz not null
);

create table if not exists workspace_governance (
  workspace_id text primary key,
  approval_mode text not null,
  require_audit_exports boolean not null default true,
  max_auto_run_risk_class text not null,
  public_sharing_enabled boolean not null default false,
  provider_access_requires_approval boolean not null default true,
  escalation_requires_approval boolean not null default true,
  external_send_requires_approval boolean not null default true,
  calendar_write_requires_approval boolean not null default true,
  retention_days integer not null,
  updated_by text not null,
  created_at timestamptz not null,
  updated_at timestamptz not null
);

create table if not exists goal_shares (
  id text primary key,
  goal_id text not null,
  user_id text not null,
  workspace_id text,
  token_fingerprint text not null,
  status text not null,
  actor_context jsonb,
  expires_at timestamptz not null,
  last_viewed_at timestamptz,
  revoked_at timestamptz,
  created_at timestamptz not null,
  updated_at timestamptz not null
);

create unique index if not exists goal_shares_token_fingerprint_idx
  on goal_shares (token_fingerprint);

create index if not exists goal_shares_goal_id_idx
  on goal_shares (goal_id);

create index if not exists goal_shares_workspace_id_idx
  on goal_shares (workspace_id);

create index if not exists goal_shares_user_updated_at_idx
  on goal_shares (user_id, updated_at);

create table if not exists privacy_operations (
  id text primary key,
  workspace_id text not null,
  user_id text not null,
  kind text not null,
  status text not null,
  requested_by text not null,
  actor_context jsonb,
  job_id text,
  details jsonb not null default '{}'::jsonb,
  result jsonb not null default '{}'::jsonb,
  started_at timestamptz,
  completed_at timestamptz,
  error text,
  created_at timestamptz not null,
  updated_at timestamptz not null
);

create index if not exists privacy_operations_workspace_created_at_idx
  on privacy_operations (workspace_id, created_at);

create index if not exists privacy_operations_user_created_at_idx
  on privacy_operations (user_id, created_at);

create index if not exists privacy_operations_status_created_at_idx
  on privacy_operations (status, created_at);

create index if not exists privacy_operations_job_id_idx
  on privacy_operations (job_id);

create table if not exists briefing_preferences (
  user_id text primary key,
  timezone text not null,
  focus text not null,
  schedules jsonb not null default '[]'::jsonb,
  actor_context jsonb,
  created_at timestamptz not null,
  updated_at timestamptz not null
);

create table if not exists goal_templates (
  id text primary key,
  user_id text not null,
  name text not null,
  description text not null,
  request text not null,
  parameters jsonb not null default '{}'::jsonb,
  schedule jsonb not null default '{}'::jsonb,
  actor_context jsonb,
  created_at timestamptz not null,
  updated_at timestamptz not null
);

create table if not exists workflow_templates (
  id text primary key,
  user_id text not null,
  name text not null,
  description text not null,
  nodes jsonb not null default '[]'::jsonb,
  edges jsonb not null default '[]'::jsonb,
  triggers jsonb not null default '[]'::jsonb,
  actor_context jsonb,
  created_at timestamptz not null,
  updated_at timestamptz not null
);

create table if not exists autopilot_settings (
  user_id text primary key,
  mode text not null,
  debounce_minutes integer not null,
  actor_context jsonb,
  created_at timestamptz not null,
  updated_at timestamptz not null
);

create table if not exists autopilot_events (
  id text primary key,
  user_id text not null,
  kind text not null,
  source_id text not null,
  idempotency_key text,
  mode text not null,
  summary text not null,
  status text not null,
  details jsonb not null default '{}'::jsonb,
  actor_context jsonb,
  team_responsibility jsonb,
  created_at timestamptz not null,
  processed_at timestamptz,
  result_goal_id text,
  error text
);

create unique index if not exists autopilot_events_user_idempotency_idx
  on autopilot_events (user_id, idempotency_key)
  where idempotency_key is not null;

create table if not exists jobs (
  id text primary key,
  user_id text not null,
  kind text not null,
  status text not null,
  idempotency_key text,
  payload jsonb not null default '{}'::jsonb,
  actor_context jsonb,
  max_attempts integer not null,
  attempt_count integer not null default 0,
  claimed_by text,
  last_attempt_at timestamptz,
  claimed_at timestamptz,
  lease_expires_at timestamptz,
  available_at timestamptz not null,
  completed_at timestamptz,
  dead_lettered_at timestamptz,
  last_error text,
  created_at timestamptz not null,
  updated_at timestamptz not null
);

create unique index if not exists jobs_user_idempotency_idx
  on jobs (user_id, idempotency_key)
  where idempotency_key is not null;

create index if not exists jobs_user_status_available_at_idx
  on jobs (user_id, status, available_at);

create index if not exists jobs_kind_status_available_at_idx
  on jobs (kind, status, available_at);

create index if not exists jobs_lease_expires_at_idx
  on jobs (lease_expires_at);

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

create table if not exists evidence_records (
  id text primary key,
  user_id text not null,
  goal_id text not null,
  task_id text not null,
  approval_id text not null,
  source_kind text not null,
  source_id text not null,
  source_summary text not null,
  risk_class text not null,
  requested_action text not null,
  request_rationale text not null,
  requires_approval boolean not null,
  decision text not null,
  decision_scope text not null,
  decision_rationale text,
  responded_at timestamptz not null,
  resulting_task_state text not null,
  resulting_goal_status text not null,
  action_log_ids jsonb not null default '[]'::jsonb,
  artifact_ids jsonb not null default '[]'::jsonb,
  memory_ids jsonb not null default '[]'::jsonb,
  created_at timestamptz not null,
  updated_at timestamptz not null
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
  actor_context jsonb,
  team_responsibility jsonb,
  created_at timestamptz not null,
  updated_at timestamptz not null
);

alter table goal_templates add column if not exists actor_context jsonb;
alter table workflow_templates add column if not exists actor_context jsonb;
alter table autopilot_settings add column if not exists actor_context jsonb;
alter table autopilot_events add column if not exists actor_context jsonb;
alter table autopilot_events add column if not exists team_responsibility jsonb;
alter table watchers add column if not exists actor_context jsonb;
alter table watchers add column if not exists team_responsibility jsonb;
alter table workspace_selections add column if not exists actor_context jsonb;
alter table memory_records add column if not exists actor_context jsonb;
alter table commitments add column if not exists actor_context jsonb;
alter table briefing_preferences add column if not exists actor_context jsonb;
alter table agent_definitions add column if not exists actor_context jsonb;

create table if not exists integration_accounts (
  id text not null,
  user_id text not null,
  name text not null,
  system text not null,
  status text not null,
  scopes jsonb not null default '[]'::jsonb,
  capabilities jsonb not null default '[]'::jsonb,
  metadata jsonb not null default '{}'::jsonb,
  actor_context jsonb,
  created_at timestamptz not null,
  updated_at timestamptz not null,
  primary key (user_id, id)
);
alter table integration_accounts add column if not exists actor_context jsonb;
create index if not exists integration_accounts_user_system_idx on integration_accounts (user_id, system);

do $$
begin
  if exists (
    select 1
    from information_schema.table_constraints
    where table_name = 'integration_accounts'
      and constraint_type = 'PRIMARY KEY'
      and constraint_name = 'integration_accounts_pkey'
  ) then
    alter table integration_accounts drop constraint integration_accounts_pkey;
  end if;
exception
  when undefined_table then
    null;
end $$;

do $$
begin
  if not exists (
    select 1
    from information_schema.table_constraints
    where table_name = 'integration_accounts'
      and constraint_type = 'PRIMARY KEY'
  ) then
    alter table integration_accounts add primary key (user_id, id);
  end if;
exception
  when undefined_table then
    null;
end $$;

create table if not exists provider_credentials (
  id text not null,
  user_id text not null,
  workspace_id text,
  provider text not null,
  account_id text,
  account_email text,
  display_name text not null,
  status text not null,
  scopes jsonb not null default '[]'::jsonb,
  last_validated_at timestamptz,
  last_rotated_at timestamptz,
  last_refresh_at timestamptz,
  last_refresh_failure_at timestamptz,
  reconnect_required_at timestamptz,
  revoked_at timestamptz,
  expires_at timestamptz,
  metadata jsonb not null default '{}'::jsonb,
  actor_context jsonb,
  created_at timestamptz not null,
  updated_at timestamptz not null,
  primary key (user_id, id)
);
alter table provider_credentials add column if not exists actor_context jsonb;
create index if not exists provider_credentials_user_provider_idx on provider_credentials (user_id, provider);
create index if not exists provider_credentials_workspace_idx on provider_credentials (user_id, workspace_id);

create table if not exists provider_credential_secrets (
  credential_id text not null,
  user_id text not null,
  kind text not null,
  secret jsonb not null,
  created_at timestamptz not null,
  updated_at timestamptz not null,
  primary key (user_id, credential_id, kind)
);
create index if not exists provider_credential_secrets_user_credential_idx
  on provider_credential_secrets (user_id, credential_id);

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

create table if not exists agent_definitions (
  id text primary key,
  user_id text not null,
  name text not null,
  display_name text not null,
  description text not null,
  icon text not null,
  category text not null,
  tags jsonb not null default '[]'::jsonb,
  system_prompt text not null,
  prompt_variables jsonb not null default '[]'::jsonb,
  artifact_type text not null,
  behavior_config jsonb not null default '{}'::jsonb,
  allowed_capabilities jsonb not null default '[]'::jsonb,
  blocked_capabilities jsonb not null default '[]'::jsonb,
  max_risk_class text not null,
  integration_permissions jsonb not null default '[]'::jsonb,
  memory_permissions jsonb not null default '[]'::jsonb,
  actor_context jsonb,
  is_built_in boolean not null default false,
  parent_agent_id text,
  version integer not null,
  status text not null,
  created_at timestamptz not null,
  updated_at timestamptz not null
);

create unique index if not exists agent_definitions_user_name_idx
  on agent_definitions (user_id, name);

create table if not exists agent_metrics (
  agent_id text not null,
  period text not null,
  period_start timestamptz not null,
  period_end timestamptz not null,
  tasks_total integer not null,
  tasks_completed integer not null,
  tasks_failed integer not null,
  tasks_blocked integer not null,
  approvals_requested integer not null,
  approvals_approved integer not null,
  approvals_rejected integer not null,
  average_confidence real,
  average_execution_time_ms integer,
  artifacts_produced integer not null,
  artifacts_by_type jsonb not null default '{}'::jsonb,
  error_count integer not null,
  last_error_at timestamptz,
  last_error_message text,
  feedback_count integer not null,
  user_correction_count integer not null default 0,
  post_approval_failure_count integer not null default 0,
  average_rating real,
  success_rate real,
  approval_rate real,
  correction_rate real,
  post_approval_failure_rate real,
  updated_at timestamptz not null,
  primary key (agent_id, period)
);

create table if not exists operator_products (
  id text primary key,
  user_id text not null,
  slug text not null,
  name text not null,
  tagline text not null,
  description text not null,
  icon text not null,
  recommended_agent_ids jsonb not null default '[]'::jsonb,
  recommended_template_ids jsonb not null default '[]'::jsonb,
  recommended_integrations jsonb not null default '[]'::jsonb,
  kpis jsonb not null default '[]'::jsonb,
  onboarding_steps jsonb not null default '[]'::jsonb,
  is_built_in boolean not null default false,
  status text not null,
  created_at timestamptz not null,
  updated_at timestamptz not null
);

create unique index if not exists operator_products_user_slug_idx
  on operator_products (user_id, slug);

create index if not exists goals_user_created_at_id_idx
  on goals (user_id, created_at desc, id desc);

create index if not exists goals_workspace_created_at_id_idx
  on goals (workspace_id, created_at desc, id desc);

create index if not exists workflows_goal_id_idx
  on workflows (goal_id);

create index if not exists tasks_goal_created_at_id_idx
  on tasks (goal_id, created_at asc, id asc);

create index if not exists artifacts_goal_created_at_id_idx
  on artifacts (goal_id, created_at asc, id asc);

create index if not exists approval_requests_goal_created_at_id_idx
  on approval_requests (goal_id, created_at asc, id asc);

create index if not exists watchers_goal_created_at_id_idx
  on watchers (goal_id, created_at asc, id asc);

create index if not exists action_logs_goal_created_at_id_idx
  on action_logs (goal_id, created_at asc, id asc);

create index if not exists memory_records_user_created_at_id_idx
  on memory_records (user_id, created_at desc, id desc);

create index if not exists autopilot_events_user_created_at_id_idx
  on autopilot_events (user_id, created_at desc, id desc);

create index if not exists integration_accounts_user_created_at_id_idx
  on integration_accounts (user_id, created_at desc, id desc);

create index if not exists evidence_records_user_goal_created_at_idx
  on evidence_records (user_id, goal_id, created_at desc, id desc);

create table if not exists operator_product_selections (
  user_id text primary key,
  operator_product_id text not null,
  actor_context jsonb,
  selected_at timestamptz not null,
  updated_at timestamptz not null
);
alter table operator_product_selections add column if not exists actor_context jsonb;
