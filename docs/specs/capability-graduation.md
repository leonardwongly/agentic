# Capability graduation criteria and evidence checklist

This spec is the single reference an operator follows to graduate a **preview**
capability to **operational**. It is the criteria document: it does not assert
that any capability has graduated, and it does not change readiness. Readiness in
`apps/web/lib/feature-capabilities.ts` is only raised when the evidence below is
real and attached.

Source of truth: the `maturity` block of each capability in
`apps/web/lib/feature-capabilities.ts` (`ownerLane`, `targetReadiness`,
`blocker`, `requiredGates`, `nextValidationGate`, `rolloutNotes`,
`rollbackNotes`, `lastValidationEvidence`). Render the live board with
`npm run test:smoke:capabilities`.

## How graduation works

Readiness ranks: `prototype` (0) < `preview` (1) < `operational` (2) <
`production` (3).

`validateFeatureCapabilityMaturity` enforces the metadata floor for every
capability:

- a declared `ownerLane`;
- at least one `requiredGates` entry;
- a non-empty `nextValidationGate`;
- non-empty `rolloutNotes` and `rollbackNotes`;
- for any `preview` capability, an issue blocker with issue number + title + URL, or a no-op blocker with a reason;
- for any `production` claim, non-empty `productionEvidence`.

There are two graduation paths:

1. **Registry graduation (evidence-gated edit).** For `agent-memory`,
   `integrations-workspace`, and `workflow-templates`, graduation means raising
   `readiness` from `preview` to `operational` in the registry after the
   capability's evidence checklist is satisfied and its blocking issue is closed.
2. **Runtime graduation (telemetry-gated, fail-closed).** `watchers` and
   `autopilot-control` are additionally promoted at runtime by
   `resolveFeatureCapabilities` / `deriveFeatureCapabilityReadiness` when live
   reliability signals are healthy (active event-emitting watchers, non-critical
   async/connector status, operator override paths, and event budgets inside the
   bounded reliability controls). Runtime promotion is fail-closed: missing
   telemetry, critical queue/connector status, or breached budgets keep the
   surface in `preview`. The static registry readiness for these two stays
   `preview` until the #144 deployed-durability proof is attached.

## Global graduation rules

Applies to every capability below before any preview -> operational change:

- [ ] The capability's `requiredGates` run green locally and in CI (do not weaken a gate to pass it).
- [ ] `npm run test:smoke:capabilities` reports the capability with no maturity issues and `release blocked: no`.
- [ ] `tests/feature-capabilities.test.ts` passes (route contracts backed by files, method drift clean, maturity metadata valid).
- [ ] The blocking issue is resolved with linked evidence, or the blocker is converted to a justified no-op blocker.
- [ ] `nextValidationGate` has recorded evidence (test output, smoke artifact, or release closeout entry).
- [ ] `rolloutNotes` preconditions hold and `rollbackNotes` path is verified to disable the surface safely.
- [ ] Owner lane sign-off is recorded.

---

## agent-memory — Agent-scoped memory

| Field | Value |
| --- | --- |
| Surface / loop stage | advanced / improve |
| Current -> target | preview -> operational |
| Owner lane | agent-intelligence |
| Blocking issue | [#152](https://github.com/leonardwongly/agentic/issues/152) — plan(roadmap): close Agentic capability and operations gaps after production proof |
| Required gate | `npm exec -- vitest run tests/feature-capabilities.test.ts tests/route-user-scope.test.ts` |
| Next validation gate | Prove agent-scoped memory isolation and graduation evidence under #152. |
| Contracts | `/api/agents/[id]/memories` (GET, POST); `/api/memory/[id]` (PATCH) |
| Rollback | Remove the agent-scoped memory entry point while preserving shared memory routes. |

Evidence checklist:

- [ ] Required gate green: `npm exec -- vitest run tests/feature-capabilities.test.ts tests/route-user-scope.test.ts`.
- [ ] Agent-scoped memory reads/writes are isolated per agent and per user/workspace scope (route-user-scope evidence attached).
- [ ] Scoped provenance is captured for agent memory edits, with audit and rollback visible.
- [ ] Rollback rehearsed: agent-memory entry point can be removed while shared memory (`memories-workbench`) routes keep working.
- [ ] #152 records the agent-scoped memory isolation + graduation evidence.

## integrations-workspace — Integration and workspace setup

| Field | Value |
| --- | --- |
| Surface / loop stage | advanced / setup |
| Current -> target | preview -> operational |
| Owner lane | platform-security |
| Blocking issue | [#142](https://github.com/leonardwongly/agentic/issues/142) — sec(config): configure GitHub App sync runtime and repo settings |
| Required gate | `npm exec -- vitest run tests/integration-readiness.test.ts tests/google-provider-routes.test.ts` |
| Next validation gate | Prove connector configuration, scopes, and recovery state under #142. |
| Contracts | `/api/integrations` (GET, POST); `/api/workspaces` (GET, POST) |
| Rollback | Hide provider mutation controls and keep integration status read-only if configuration proof fails. |

Evidence checklist:

- [ ] Required gate green: `npm exec -- vitest run tests/integration-readiness.test.ts tests/google-provider-routes.test.ts`.
- [ ] Connector enablement logic proven (config presence, scope validation, recovery transitions) via `tests/connector-enablement.test.ts`.
- [ ] **OPERATOR-GATED:** at least one connector configured end to end with real secrets and verified through authenticated `/api/ready/details` connector health, following [`../runbooks/connector-enablement.md`](../runbooks/connector-enablement.md).
- [ ] Provider mutation controls and connector recovery remain owner-gated through the governed recovery API.
- [ ] Rollback rehearsed: provider mutation controls hide and integration status goes read-only.
- [ ] #142 records the live connector configuration, scopes, and recovery evidence.

## watchers — Watchers

| Field | Value |
| --- | --- |
| Surface / loop stage | advanced / observe |
| Current -> target | preview -> operational |
| Owner lane | runtime-platform |
| Blocking issue | [#144](https://github.com/leonardwongly/agentic/issues/144) — ops(worker): verify deployed worker durability and recovery behavior |
| Required gate | `npm exec -- vitest run tests/action-execution-idempotency.test.ts tests/runtime-readiness.test.ts` |
| Next validation gate | Verify deployed watcher durability, replay, and recovery behavior under #144. |
| Contracts | `/api/watchers` (GET, POST); `/api/watchers/[id]` (PATCH) |
| Rollback | Return watchers to dry-run or notification-only mode if queue durability evidence regresses. |

Graduation note: `watchers` is runtime-promotable. `resolveFeatureCapabilities`
reports it operational only when there is at least one active **event-emitting**
watcher and async/connector telemetry is non-critical; it stays preview when all
watchers are dry-run/notification-suppressed or telemetry is missing. The static
registry readiness stays preview until the #144 deployed-durability proof is
attached.

Evidence checklist:

- [ ] Required gate green: `npm exec -- vitest run tests/action-execution-idempotency.test.ts tests/runtime-readiness.test.ts`.
- [ ] At least one active watcher actually emits events into the durable queue (not dry-run/notification-suppressed).
- [ ] **OPERATOR-GATED:** deployed watcher durability, replay, and recovery verified after a worker restart/crash (queue recovery healthy).
- [ ] Operator remediation paths for watcher diagnostics are present in operations telemetry.
- [ ] Rollback rehearsed: watchers return to dry-run/notification-only mode.
- [ ] #144 records the deployed watcher durability and recovery evidence.

## workflow-templates — Workflow templates

| Field | Value |
| --- | --- |
| Surface / loop stage | advanced / improve |
| Current -> target | preview -> operational |
| Owner lane | product-platform |
| Blocking issue | [#152](https://github.com/leonardwongly/agentic/issues/152) — plan(roadmap): close Agentic capability and operations gaps after production proof |
| Required gate | `npm exec -- vitest run tests/feature-capabilities.test.ts tests/dashboard-advanced-operations-card.test.tsx` |
| Next validation gate | Attach template graduation scope and execution evidence under #152. |
| Contracts | `/api/workflow-templates` (GET, POST); `/api/workflow-templates/[id]` (GET, PUT, DELETE) |
| Rollback | Hide template mutation controls while preserving existing workflow execution paths. |

Evidence checklist:

- [ ] Required gate green: `npm exec -- vitest run tests/feature-capabilities.test.ts tests/dashboard-advanced-operations-card.test.tsx`.
- [ ] Template create/update/delete carry owner attribution and an execution path to a real workflow.
- [ ] Template execution evidence captured (a template drives a governed workflow end to end).
- [ ] Rollback rehearsed: template mutation controls hide while existing workflow execution keeps working.
- [ ] #152 records the template graduation scope and execution evidence.

## autopilot-control — Autopilot control

| Field | Value |
| --- | --- |
| Surface / loop stage | advanced / execute |
| Current -> target | preview -> operational |
| Owner lane | runtime-platform |
| Blocking issue | [#144](https://github.com/leonardwongly/agentic/issues/144) — ops(worker): verify deployed worker durability and recovery behavior |
| Required gate | `npm exec -- vitest run tests/policy.test.ts tests/runtime-readiness.test.ts` |
| Next validation gate | Prove deployed autopilot queue durability, event budgets, and override paths under #144. |
| Contracts | `/api/autopilot/settings` (GET, POST); `/api/autopilot/events` (POST) |
| Rollback | Force notify-only mode and suppress automation controls if event budgets or override paths regress. |

Graduation note: `autopilot-control` is runtime-promotable. It is reported
operational only when operator override paths exist and async/connector telemetry
is non-critical, with autopilot events inside the bounded reliability controls
(`maxPendingEvents`, `maxEventsPerWindow`, `maxConsecutiveFailures`). It is
fail-closed to preview without override paths or telemetry. The static registry
readiness stays preview until the #144 deployed-durability proof is attached.

Evidence checklist:

- [ ] Required gate green: `npm exec -- vitest run tests/policy.test.ts tests/runtime-readiness.test.ts`.
- [ ] Bounded reliability controls hold: pending events, event-window budget, and consecutive failures stay inside the configured thresholds.
- [ ] Operator override / recovery paths are available and exercised.
- [ ] **OPERATOR-GATED:** deployed autopilot queue durability and event budgets verified after a worker restart/crash.
- [ ] Rollback rehearsed: autopilot forced to notify-only mode and automation controls suppressed.
- [ ] #144 records the deployed autopilot durability, budget, and override evidence.

---

## Owner lane summary

| Capability | Owner lane | Blocking issue |
| --- | --- | --- |
| agent-memory | agent-intelligence | #152 |
| integrations-workspace | platform-security | #142 |
| watchers | runtime-platform | #144 |
| workflow-templates | product-platform | #152 |
| autopilot-control | runtime-platform | #144 |

## Do not bump readiness without evidence

These capabilities remain `preview` until their checklist is satisfied with real
evidence. Raising `readiness` in `apps/web/lib/feature-capabilities.ts` without
the listed (and where marked, operator-gated) evidence is a false production
claim and will be caught by `validateFeatureCapabilityMaturity` and
`npm run test:smoke:capabilities` only for structural gaps — the substantive
evidence is the operator's responsibility to attach under the blocking issue.
