# Agentic Findings Implementation Plan

Date: 2026-04-13
Status: In progress
Source analysis: [.claude/docs/ai/agentic/10x/session-10.md](https://github.com/leonardwongly/agentic/blob/main/.claude/docs/ai/agentic/10x/session-10.md)

## Quick Understanding

The current findings point to a product that has strong governance and control-plane foundations but still needs focused execution depth, production-hardening, clearer approval explainability, deeper multi-tenant boundaries, and more reliable workflow infrastructure. This plan converts those findings into phased, executable work so the team can improve user trust and delivery quality immediately while moving toward secure large-scale operation.

## Boundaries

### Inputs

- user requests and approvals
- connector events and provider sync state
- repository records and workflow logs
- runtime configuration and deployment environment
- operator actions and governance settings

### Outputs

- repository writes and workflow transitions
- approval decisions and external side effects
- dashboard and detail-panel UI
- audit/evidence records
- metrics, alerts, and deployment behavior

### Trust levels

- untrusted: HTTP input, connector payloads, user text, environment omissions, provider failures
- semi-trusted: previously stored operational data
- trusted: internal code paths after validation, signed session state, policy evaluation results

## Success Criteria

1. Production deployments fail closed when required shared infrastructure is missing.
2. Approval flows explain exactly why intervention is required and what the blast radius is.
3. The next implementation phases are decomposed into bounded, testable workstreams.
4. Every phase has explicit validation criteria so quality improves continuously instead of by intuition.

---

## Phase 1: Immediate Trust and Safety

Priority: P0
Status: Implemented
Goal: remove the most dangerous “looks fine locally, breaks at scale” paths and improve approval clarity.

### Finding 1.1: Production runtime can silently fall back to a local file store

**Issue**
`createRepository()` falls back to the file-backed repository when `DATABASE_URL` is missing, even though that behavior is only safe for development.

**Root cause**
Development convenience was left available as a universal default.

**Impact**
- production correctness
- horizontal scaling
- restart durability
- operational safety

**Actions**
1. Fail closed in production when `DATABASE_URL` is missing.
2. Preserve the file-backed repository only for non-production environments.
3. Add dedicated regression tests for both production and non-production behavior.

**Testing and validation**
- production mode without `DATABASE_URL` throws
- test mode without `DATABASE_URL` still works
- existing repository tests continue to pass

**Implementation status**
- Done in code

### Finding 1.2: Approval detail view does not fully explain why the system is asking for a human decision

**Issue**
The approval panel shows rationale and summary information, but it does not present a clear operational breakdown of policy rationale, review trigger, impact scope, rollback mode, and confidence context in one place.

**Root cause**
Approval data is present in the schema, but the UI only exposes a subset of it.

**Impact**
- user trust
- approval latency
- policy usability
- maintainability of human-in-the-loop workflows

**Actions**
1. Surface policy rationale explicitly in the approval panel.
2. Show review trigger, impact summary, decision guidance, and goal confidence.
3. Expose impact scope:
   - permissions
   - affected people
   - affected systems
   - rollback mode
4. Add a rendering test that locks the explainability contract.

**Testing and validation**
- server-rendered panel includes all explainability fields
- empty optional fields remain omitted cleanly
- existing approval interactions remain unchanged

**Implementation status**
- Done in code

### Finding 1.3: Process-local auth state and unlock throttling still need shared-state replacement

**Issue**
Session revocation and unlock throttling are still process-local.

**Root cause**
Security controls were implemented early with in-memory defaults.

**Impact**
- inconsistent revocation across instances
- weak scaling semantics
- operational ambiguity under load balancers or rolling deploys

**Actions**
1. Introduce a shared-state interface contract for revocation and unlock throttling.
2. Implement a shared backend adapter with atomic updates for revocation, login throttling, and unlock throttling.
3. Keep the in-memory version for test and local development only.
4. Add production diagnostics so deployments can flag process-local mode immediately and optionally fail closed.

**Testing and validation**
- adapter contract tests
- TTL expiry behavior
- concurrency tests across simulated nodes
- fallback remains available in test mode only

**Implementation status**
- Shared-state boundaries for auth rate limiting, session revocation, and unlock throttling are done in code.
- Postgres-backed shared auth-state storage is done in code.
- Production diagnostics and strict fail-closed configuration are done in code.
- Development and test remain process-local by default unless `AGENTIC_SHARED_AUTH_STATE=true`.
- Multi-node concurrency and TTL-focused contract tests are now covered in the auth regression suite for Postgres-backed shared state when `DATABASE_URL` is configured.
- Trusted client identity for login throttling and unlock throttling is now centralized behind a default-deny proxy-header policy.
- Deployments that rely on trusted reverse proxies must opt in with `AGENTIC_TRUST_PROXY_HEADERS=true` so canonical forwarded client IPs are used consistently.

---

## Phase 2: Tenant-Safe Boundaries

Priority: P0
Status: Implemented
Goal: remove hidden single-user assumptions from core execution paths.

### Finding 2.1: User-facing flows still depend on implicit `SYSTEM_USER_ID` defaults

**Issue**
Some lower-level paths continue to rely on a single-user default even though the product now exposes workspaces and governance semantics.

**Root cause**
The codebase evolved from a single-user MVP.

**Impact**
- authorization clarity
- audit accuracy
- multi-user correctness
- enterprise readiness

**Actions**
1. Define a shared `ActorContext` shape.
2. Thread `ActorContext` through routes, repository, orchestrator, approvals, and execution.
3. Remove implicit human-facing defaults from authenticated code paths.
4. Distinguish system actors from human actors in audit records.

**Dependencies**
- none beyond schema and interface work

**Testing and validation**
- route scope tests
- cross-workspace denial tests
- audit attribution regression checks

**Implementation status**
- Shared `ActorContext` schemas and helpers are done in code.
- Authenticated write routes for approvals, workspaces, and governance now derive actor context at the boundary.
- Approval history and evidence records now persist structured actor context alongside the legacy actor label.
- Repository approval responses and workspace mutations now accept explicit actor context instead of implicit authenticated user defaults.
- Watcher mutations and autopilot settings/events now persist structured actor context end to end across both the file-backed and Postgres-backed repositories.
- Route-level regression coverage now verifies actor attribution for watcher writes and autopilot-triggered execution, including access-key, session, failure, and debounce paths.
- Goal-template and workflow-template create/update/run flows now persist structured actor context end to end across contracts, routes, scheduled execution, and both repository backends.
- Route-level regression coverage now verifies actor attribution for template CRUD/run surfaces and workflow-template create/update flows for both access-key and session principals.
- Agent definition CRUD/import/export/metrics flows now enforce explicit user scoping and persist structured actor context across contracts, routes, and both repository backends.
- Route-level and repository regression coverage now verify agent actor attribution, user-scoped fetch/delete semantics, and metrics resolution under both access-key and session principals.
- Operator-product selection now persists structured actor context across the authenticated route boundary, contracts, seeded defaults, and both repository backends.
- Route-level and repository regression coverage now verify operator-product selection attribution for authenticated writes.
- Integration status updates now persist structured actor context across contracts, authenticated route boundaries, seeded defaults, and both repository backends.
- Route-level and repository regression coverage now verify integration actor attribution for seeded defaults and authenticated writes.
- Goal-share creation and goal-refinement action logs now persist structured actor context for both access-key and session principals.
- Workspace selection now persists structured actor context across contracts, authenticated route boundaries, seeded defaults, migrations, and both repository backends.
- Route-level and repository regression coverage now verify workspace-selection attribution and cross-user denial for goal share/refine mutations.
- Remaining follow-up:
  - add broader cross-workspace denial and audit-attribution regression coverage as new authenticated execution surfaces are introduced
  - revisit non-repository side-effect paths if they later need tenant-scoped audit persistence

---

## Phase 3: Async Workflow Hardening

Priority: P1
Status: In progress
Goal: move external side effects and long-running work out of request-path logic.

### Finding 3.1: Workflow execution is too synchronous for internet-scale reliability

**Issue**
Several workflows are still implemented as direct application logic rather than durable queued jobs.

**Root cause**
Early implementation favored directness over distributed runtime guarantees.

**Impact**
- request latency
- duplicate side-effect risk
- incident recovery difficulty
- weak backpressure control

**Actions**
1. Introduce a workflow/job abstraction for long-running and side-effectful actions.
2. Add idempotency keys for external actions and approval responses.
3. Add outbox-style delivery for connector writes.
4. Add dead-letter and replay tooling.

**Dependencies**
- shared infrastructure from Phase 1
- actor context from Phase 2

**Testing and validation**
- retry-safe execution tests
- duplicate-submit negative tests
- queue lag and replay simulations
- regression coverage for approval response flows

**Implementation update**
- Durable job contracts now define explicit job kinds, payload schemas, lifecycle states, lease metadata, retry metadata, and validation guards for running/completed/dead-letter invariants.
- File-backed and Postgres repositories now persist durable jobs with user-scoped idempotency keys, atomic claim semantics, worker ownership enforcement, lease expiry reclaim, retry scheduling, and dead-letter transitions.
- The database schema now includes a `jobs` table and supporting indexes for claim scans, lease recovery, and user-scoped idempotency enforcement.
- Execution utilities now expose a reusable durable queue abstraction with bounded exponential backoff and a normalized retry/dead-letter contract for worker runtimes.
- Repository and execution regression coverage now verifies duplicate-submit denial, lease expiry reclaim ordering, worker ownership checks, retry scheduling, and dead-letter persistence across both repository backends.
- A dedicated `apps/worker` process now runs the durable queue independently from the web server, with typed dispatch for goal and autopilot job families plus graceful shutdown semantics.
- `POST /api/goals` now validates and enqueues goal-create work, returns `202 Accepted` with stable job metadata, and removes inline orchestration from the request path.
- Goal polling now flows through `/api/goals/jobs/[id]`, which exposes queued/running/retrying/completed/dead-letter states with sanitized failure output and a client-safe result summary.
- Goal orchestration, goal-bundle persistence, and worker-owned side effects now execute from `@agentic/worker-runtime`, keeping tenant/actor context explicit and server-derived through the job boundary.
- Goal-create retries now reuse persisted goal IDs plus deterministic memory/episode IDs so duplicate worker execution stays bounded and side-effect failures surface through retry/dead-letter job state instead of being silently swallowed.
- Dashboard goal submission now follows the async contract by polling job status and refreshing from persisted state instead of depending on an inline request-path rebuild.
- Regression coverage now exercises async enqueue/execution/completion, duplicate-submit reuse, cross-user access denial, sanitized dead-letter responses, deterministic side-effect idempotency, and visible worker failure handling after core persistence.

**Remaining follow-up**
- move autopilot execution off request paths and onto worker handlers
- add replay/outbox tooling and deeper recovery workflows for external connector side effects

---

## Phase 4: Execution Depth in the Core Wedge

Priority: P1
Status: Planned
Goal: make a small number of workflows truly excellent before expanding breadth.

### Finding 4.1: Execution outcomes are still shallower than the control plane

**Issue**
The product is better at routing and gating work than it is at finishing the most valuable workflows end to end.

**Root cause**
Execution-grade specialists have not yet caught up with the architecture.

**Impact**
- retention
- daily utility
- automation ROI
- competitive differentiation

**Actions**
1. Choose the primary wedge:
   - commitments and approvals
   - communications execution
   - scheduling execution
2. Replace scaffold-style flows with eval-backed specialist implementations.
3. Add workflow completion metrics and edit-distance tracking.
4. Mark incomplete agents as experimental.

**Dependencies**
- evaluation instrumentation
- deeper integration support

**Testing and validation**
- happy path completion tests
- human-review downgrade tests
- failure-mode tests for connector outages
- regression tests around approval gating

---

## Phase 5: Connector Depth and Shared-State Security

Priority: P1
Status: Planned
Goal: turn integrations into reliable action paths instead of shallow adapters.

### Finding 5.1: Integration quality is uneven and not yet sufficient for strong workflow lock-in

**Issue**
Connectors are directionally useful, but many are partial, conditional, or mock-backed.

**Root cause**
Adapter breadth outpaced production-depth investment.

**Impact**
- workflow closure
- trust in delegated execution
- product stickiness

**Actions**
1. Add connector lifecycle management:
   - token refresh
   - sync cursor storage
   - webhook replay handling
   - reconciliation jobs
2. Define connector readiness tiers in code and UI.
3. Add per-connector SLOs and failure reporting.

**Dependencies**
- async workflow layer
- shared state and observability

**Testing and validation**
- connector contract tests
- webhook replay tests
- write-back failure recovery tests

---

## Phase 6: Decision Intelligence and Evaluation

Priority: P2
Status: Planned
Goal: turn approval history, edits, and outcomes into compounding product value.

### Finding 6.1: Memory exists, but decision quality does not yet compound fast enough

**Issue**
The system stores memory and evidence, but feedback is not yet fully converted into workflow-specific trust and quality improvements.

**Root cause**
Instrumentation and structured outcome modeling are still early.

**Impact**
- personalization
- automation confidence
- approval burden
- strategic defensibility

**Actions**
1. Record structured workflow outcomes for draft, approval, execution, rollback, and correction.
2. Build per-workflow trust metrics.
3. Add an evaluation control tower with quality, cost, and reliability metrics.
4. Use those metrics to suggest promotion from manual flow to automation.

**Dependencies**
- workflow runtime
- wedge-level execution metrics

**Testing and validation**
- instrumentation coverage checks
- trust-score regression tests
- false-positive automation guardrails

---

## Priority Order

### Execute first

1. Phase 1 immediate trust and safety
2. Phase 2 tenant-safe boundaries

### Execute second

1. Phase 3 async workflow hardening
2. Phase 4 execution depth in the core wedge

### Execute third

1. Phase 5 connector depth and shared-state security
2. Phase 6 decision intelligence and evaluation

---

## Iterative Workflow

For each phase:

1. implement the smallest complete slice
2. run targeted tests
3. run the relevant regression suite
4. review logs and edge cases
5. refine before expanding scope

No phase is considered complete until:

1. the code path is covered by automated tests
2. the main failure modes are exercised
3. the user-facing behavior is observable and explainable
4. the change does not silently weaken security or scalability guarantees

---

## Tracking Notes

- Phase 1.1 complete
- Phase 1.2 complete
- Phase 1.3 complete for the shared-state implementation milestone; multi-node concurrency and TTL-focused tests remain follow-up hardening
- Phase 2 is now in progress
- Current Phase 2 slice complete:
  - actor context schema/helpers
  - actor propagation for approval responses
  - actor propagation for workspace and governance mutations
  - structured actor attribution in approval history and evidence records
