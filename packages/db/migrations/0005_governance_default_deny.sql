alter table workspace_governance
  add column if not exists public_sharing_enabled boolean not null default false;

alter table workspace_governance
  add column if not exists provider_access_requires_approval boolean not null default true;

alter table workspace_governance
  add column if not exists escalation_requires_approval boolean not null default true;

alter table workspace_governance
  alter column require_audit_exports set default true;
