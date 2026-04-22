# Phase 1 Decomposition Boundaries

## Purpose

Phase 1 reduces three recurring hotspot files into smaller, testable seams without breaking the stable public contracts that the rest of the system already depends on.

The boundaries in this document are release guardrails, not loose guidance. `npm run test:architecture:fitness` enforces them.

## Inputs, Outputs, and Trust Levels

Inputs:

- dashboard operator actions from browser clients
- API route payloads that enqueue worker jobs
- repository reads and writes across runtime-store and Postgres backends
- worker job payloads recovered from the durable queue

Outputs:

- stable `@agentic/repository` exports consumed by routes and UI
- queued job payloads and idempotency keys consumed by the worker runtime
- dashboard polling and snapshot fetches consumed by the client shell
- operator-visible action logs for public share views

Trust levels:

- browser and API payloads are untrusted
- durable queue payloads are trusted only after schema parsing
- repository helper modules are trusted implementation details behind stable facades
- docs and fitness checks are trusted only when they match the checked-in code

## Success Criteria

Phase 1 is complete only when all of the following stay true:

- `packages/repository/src/index.ts` remains the stable repository facade, not the storage place for every exported type
- repository dashboard/supporting types live in `packages/repository/src/repository-types.ts`
- worker payload builders and idempotency-key derivation live in `packages/worker-runtime/src/job-payloads.ts`
- public share view action-log construction lives in `packages/worker-runtime/src/public-share-log.ts`
- dashboard client polling and fetch helpers live in `apps/web/components/dashboard-async.ts`
- hotspot files stay under their agreed line budgets

## Repository Boundary

`packages/repository/src/index.ts` is allowed to:

- expose the public repository API
- compose storage, pagination, and dashboard assembly modules
- re-export stable types and mutation error classes

`packages/repository/src/index.ts` is not allowed to:

- become the canonical home for dashboard facade types
- pull helpers back in from UI code
- absorb more type-only surface area that belongs in `repository-types.ts`

`packages/repository/src/repository-types.ts` owns:

- dashboard data and diagnostics types
- collection/filter/page parameter types
- workspace audit export types
- mutation error classes and the `AgenticRepository` public contract

## Worker Runtime Boundary

`packages/worker-runtime/src/index.ts` is allowed to:

- own job orchestration and handler wiring
- call orchestrator/runtime integrations
- coordinate retries, telemetry, and result summaries

`packages/worker-runtime/src/index.ts` is not allowed to:

- inline every payload builder and idempotency-key derivation
- inline public share action-log shaping

Dedicated helper ownership:

- `job-payloads.ts`
  - payload construction
  - deterministic idempotency-key derivation
  - autopilot workflow and goal ID derivation
- `public-share-log.ts`
  - public share view action-log normalization

## Dashboard Boundary

`apps/web/components/dashboard.tsx` is allowed to:

- orchestrate UI state and view composition
- invoke dashboard polling/fetch helpers
- translate async results into user-facing toasts and state transitions

`apps/web/components/dashboard.tsx` is not allowed to:

- keep accumulating generic API response types
- own reusable JSON parsing, polling, or snapshot-fetch utilities

`apps/web/components/dashboard-async.ts` owns:

- response parsing
- idempotency-key generation
- snapshot refresh calls
- bounded polling with timeout behavior

## Line Budgets

The current hotspot budgets are intentionally strict enough to stop obvious backsliding while still leaving room for small edits:

- `packages/repository/src/index.ts`: `<= 7900` lines
- `packages/worker-runtime/src/index.ts`: `<= 1650` lines
- `apps/web/components/dashboard.tsx`: `<= 3400` lines

If one of these files needs to grow beyond its budget, the change must also move the displaced concern behind a smaller helper or facade in the same patch.

## Validation

Run these checks before merging:

```bash
npm run test:architecture:fitness
npm exec -- vitest run tests/repository.test.ts tests/worker-runtime.test.ts tests/dashboard-async.test.ts tests/nl-intent-route.test.ts
```

If a hotspot budget or seam check fails, the fix is to re-extract the concern instead of raising the budget by default.
