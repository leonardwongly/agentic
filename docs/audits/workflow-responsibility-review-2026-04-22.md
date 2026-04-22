# Workflow Responsibility Review

Date: 2026-04-22

Scope:
- `packages/contracts/src/index.ts`
- `packages/orchestrator/src/index.ts`
- `packages/orchestrator/src/morning-briefing.ts`
- `packages/orchestrator/src/goal-refinement.ts`
- `packages/repository/src/index.ts`
- `apps/web/components/panels/goal-detail-panel.tsx`
- `apps/web/components/panels/approval-detail-panel.tsx`

## Review Notes

Security:
- responsibility data is schema-validated before persistence and again on read
- approval-response handoff changes record the acting party instead of trusting client-provided ownership claims
- audit requirements remain explicit so later route surfaces can fail closed on missing actor context or reason fields

Correctness:
- responsibility defaults are derived deterministically for legacy and newly created records
- task and approval handoff status changes now track approval outcomes directly
- repository round-trips responsibility JSON for file-backed and Postgres-backed stores

Maintainability:
- the implementation is additive and keeps responsibility semantics in a single shared contract
- orchestrator call sites pass explicit derived responsibility instead of duplicating ad hoc role assignment logic
- UI surfaces use small formatting helpers rather than bespoke responsibility components

Performance:
- responsibility is stored as bounded JSONB without extra joins
- render cost is linear in existing task and approval lists
- audit formatting is derived in-memory from already loaded bundle data

Residual risk:
- older deployed databases need migrations `0003_goal_contract.sql` and `0004_team_responsibility.sql` applied before Postgres-backed writes can succeed
- escalation-trigger transitions beyond approval response still depend on future workflow actions adopting the shared responsibility model consistently
