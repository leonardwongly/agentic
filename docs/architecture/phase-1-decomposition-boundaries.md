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
- dashboard snapshot state lives in `apps/web/components/dashboard-hooks.ts`
- dashboard action/data state hooks for goals, approvals, commitments, briefings, templates, workspaces, and notes live in `apps/web/components/dashboard-hooks.ts`
- dashboard providers, shell chrome, stats, NL bar, command palette, quick actions, and toasts live in `apps/web/components/dashboard-shell.tsx`
- exception-first cockpit lanes and the canonical detail drawer live in `apps/web/components/dashboard-cockpit.tsx`
- first-viewport operating cards live in `apps/web/components/dashboard-primary-sections.tsx`
- bounded first-paint and collection API helpers live outside the dashboard component
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
- named repository ports for queue, dashboard read, dashboard collection read, dashboard event stream read, governance, governance route, governance simulation, governance audit, credential, memory, watcher, privacy, privacy route, share/audit, template, agent catalog, product, readiness, and worker-runtime consumers

### Repository Port Rules

The full `AgenticRepository` remains the backing implementation contract for storage parity. New consumers should depend on the narrowest named port in `repository-types.ts` instead of receiving the full repository surface by default.

Worker/runtime modules must not import `AgenticRepository` directly once a named port exists for their access pattern. Queue dispatchers use `QueueRepositoryPort`, approval response dispatch uses `ApprovalQueueRepositoryPort`, watcher scheduling uses `WatcherRepositoryPort`, credential adapters use `CredentialRepositoryPort`, memory capture uses `MemoryRepositoryPort`, privacy/share executors use their privacy and share/audit ports, and top-level worker orchestration uses `WorkerRuntimeRepositoryPort`.

Dashboard-only reads must not leak into worker ports unless the worker path is explicitly assembling runtime context that cannot be sourced from a narrower contract yet. If that happens, the method belongs in `WorkerRuntimeRepositoryPort` and needs a contract test in `tests/repository-ports.test.ts`. Dashboard collection API routes use `DashboardCollectionRepositoryPort` through `getSeededDashboardCollectionRepository()` so paged dashboard readers do not receive the full repository surface by default. Dashboard event streams use `DashboardEventStreamRepositoryPort` through `getSeededDashboardEventStreamRepository()` for dashboard snapshot plus job event reads. Readiness probes use `ReadinessRepositoryPort` for queue and connector-health checks instead of taking the full repository contract.

Web API routes should request the narrowest seeded accessor from `apps/web/lib/server.ts` that matches their method set. `getSeededRepository()` remains as the backing compatibility accessor during migration, but new route work should prefer the named accessors for dashboard read, governance, credential, memory, watcher, privacy, share/audit, template, agent catalog, product, queue, and approval queue ports. When a route genuinely crosses port boundaries, add a named composite route port such as `GovernanceRouteRepositoryPort`, `GovernanceSimulationRepositoryPort`, `GovernanceAuditRepositoryPort`, or `PrivacyRouteRepositoryPort` and cover it in `tests/repository-ports.test.ts` before migrating the route.

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
- own every first-viewport card and cockpit lane implementation inline
- own provider wiring, shell chrome, stats, command palette, NL bar, quick actions, or toasts

`apps/web/components/dashboard-async.ts` owns:

- response parsing
- idempotency-key generation
- snapshot refresh calls
- bounded polling with timeout behavior

`apps/web/components/dashboard-hooks.ts` owns:

- dashboard snapshot state
- dashboard snapshot refresh hook wiring
- grouped goal, approval, commitment, briefing, template, workspace, and note action state

`apps/web/components/dashboard-cockpit.tsx` owns:

- Operate, Approve, Recover, Govern, Build, and Learn lane rendering
- high-severity diagnostic surfacing for the first viewport
- the canonical dashboard detail drawer

`apps/web/components/dashboard-shell.tsx` owns:

- dashboard providers and keyboard shortcut wiring
- command palette, NL floating bar, favicon badge, stats bar, toasts, and quick actions
- focus-mode approval overlay
- the dashboard `<main>` shell and detail drawer placement

`apps/web/components/dashboard-primary-sections.tsx` owns:

- hero panel composition
- reliability card rendering
- now queue card rendering
- artifacts and activity timeline sections

`packages/repository/src/dashboard-summary.ts` owns:

- the compact `DashboardSummary` contract for first-paint and route consumers
- lane, count, freshness, and top-diagnostic summaries derived from `DashboardData`
- no full collection payloads

`apps/web/lib/dashboard-collection.ts` owns:

- strict dashboard collection query parsing
- shared page-size, cursor, sort, filter, and search behavior
- bounded page response construction for dashboard collection routes

`packages/repository/src/dashboard-collection-page.ts` owns:

- repository-backed dashboard collection page assembly
- capped scans through paged repository APIs before applying dashboard search/sort/cursor contracts
- regression coverage that prevents collection routes from reintroducing unbounded `listGoals`, `listApprovals`, or `listMemory` reads

`apps/web/app/api/dashboard/*/route.ts` collection routes own:

- principal-scoped repository reads
- route-specific filters for approvals, commitments, jobs, activity, memories, and artifacts
- no unbounded collection responses
- no direct full-collection repository reads for dashboard collection pages

## Line Budgets

The current hotspot budgets are intentionally strict enough to stop obvious backsliding while still leaving room for small edits:

- `packages/repository/src/index.ts`: `<= 7900` lines
- `packages/worker-runtime/src/index.ts`: `<= 1650` lines
- `apps/web/components/dashboard.tsx`: `<= 3150` lines
- `apps/web/components/dashboard-cockpit.tsx`: `<= 450` lines
- `apps/web/components/dashboard-hooks.ts`: `<= 280` lines
- `apps/web/components/dashboard-shell.tsx`: `<= 180` lines
- `apps/web/components/dashboard-primary-sections.tsx`: `<= 500` lines
- `apps/web/lib/dashboard-collection.ts`: `<= 230` lines

If one of these files needs to grow beyond its budget, the change must also move the displaced concern behind a smaller helper or facade in the same patch.

## Validation

Run these checks before merging:

```bash
npm run test:architecture:fitness
npm exec -- vitest run tests/repository.test.ts tests/worker-runtime.test.ts tests/dashboard-async.test.ts tests/dashboard-collections-route.test.ts tests/nl-intent-route.test.ts
```

If a hotspot budget or seam check fails, the fix is to re-extract the concern instead of raising the budget by default.
