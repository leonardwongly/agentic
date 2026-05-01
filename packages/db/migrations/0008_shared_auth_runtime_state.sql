-- Backfill migration for environments that applied an older 0001_init.sql
-- before the shared auth runtime tables were migration-managed. These DDL
-- statements remain intentionally idempotent because fresh databases may
-- already create the same objects through the current initial migration.

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

create index if not exists auth_session_rate_limits_updated_at_idx
  on auth_session_rate_limits (updated_at);

create index if not exists auth_revoked_sessions_expires_at_idx
  on auth_revoked_sessions (expires_at);

create index if not exists session_unlock_attempts_last_seen_at_idx
  on session_unlock_attempts (last_seen_at);
