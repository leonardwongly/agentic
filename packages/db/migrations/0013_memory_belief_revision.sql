-- AOS-24: memory belief-revision metadata.
-- Adds versioning + supersession + effective-from columns so corrections can
-- supersede prior records (instead of creating conflicting peers) and so the
-- stored `contradicted`/`expired` assertion states are durable.
alter table memory_records
  add column if not exists version integer not null default 1,
  add column if not exists supersedes text,
  add column if not exists valid_from timestamptz;
