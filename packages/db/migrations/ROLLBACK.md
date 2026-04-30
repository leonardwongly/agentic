# Migration Rollback Notes

Every migration must have an explicit rollback note before it can pass the migration discipline gate.

- `0001_init.sql`: Bootstrap migration for core runtime tables. Roll back by restoring from a pre-migration backup; do not drop production tables in place.
- `0002_job_execution_journal.sql`: Adds durable job journal state. Roll back application code first, then restore the pre-migration backup if journal metadata must be removed.
- `0003_goal_contract.sql`: Adds goal contract fields. Roll back application code first; preserve populated contract data for forensic review before backup restore.
- `0004_team_responsibility.sql`: Adds team responsibility metadata. Roll back by disabling the responsibility UI/API paths and restoring from backup if metadata is invalid.
- `0004_workspace_shadow_replay_policy.sql`: Legacy duplicate prefix retained for compatibility. Roll back by reverting policy reads to defaults and restoring from backup if needed.
- `0005_bundle_child_sort_order.sql`: Adds child ordering metadata. Roll back by ignoring the field in application code; restore from backup only if the column must be removed.
- `0005_governance_default_deny.sql`: Legacy duplicate prefix retained for compatibility. Roll back by restoring the prior governance defaults from backup after disabling dependent code.
- `0006_watcher_scheduler.sql`: Adds watcher scheduler policy and due-date metadata. Roll back by disabling scheduler execution paths first, then restoring a pre-migration backup if scheduler metadata must be removed.
- `0008_shared_auth_runtime_state.sql`: Adds shared auth/session runtime tables and indexes. Roll back application code first; preserve revocation and throttling state unless an operator-approved restore plan removes those tables from backup.
