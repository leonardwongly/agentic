# Agentic

## Purpose

Agentic is a trusted execution control plane for coordinating work across commitments, approvals, automations, memories, integrations, and generated artifacts. The current system prioritizes trustworthy execution over provider-specific breadth and keeps the daily operating loop centered on commitments, approvals, evidence, and recoverable automation.

The product is intentionally designed as a TypeScript-first modular monolith so the system stays fast to iterate, easy to test, and auditable from the first user request through every policy decision, queued job, integration action, and resulting artifact.

## Product Principles

1. Prefer explicit approvals over unsafe autonomy.
2. Keep all external actions behind a policy gate.
3. Store durable state in a relational model with append-only audit history.
4. Make every agent output schema-validated JSON.
5. Treat integrations as provider-neutral capabilities, not vendor-specific APIs.
6. Make generated documents reproducible from version-controlled source.

## Architecture

The current system runs as a TypeScript-first Node 20 application with a Next.js web surface, a dedicated worker process for durable execution, shared packages for orchestration and policy logic, and a repository layer that can run against Postgres or a deterministic file-backed development store outside production.

### Core Modules

| Module | Responsibility | Current expectation |
| --- | --- | --- |
| `apps/web` | Next.js UI, session handling, API routes, health and readiness endpoints | Required |
| `apps/worker` | Dedicated process for durable goal, autopilot, and privacy-operation execution | Required |
| `contracts` | Shared schemas, runtime contracts, and validation rules | Required |
| `db` | Migrations, schema-readiness checks, and Postgres access | Required |
| `orchestrator` | Intake, planning, routing, workflow assembly, and artifact generation | Required |
| `memory` | Explicit and inferred memory records plus capture from completed work | Required |
| `policy` | Risk classification, governance, and approval gating | Required |
| `execution` | Durable queue contracts, retries, dead-letter handling, and job claiming | Required |
| `worker-runtime` | Typed worker dispatch for goal, autopilot, and privacy jobs | Required |
| `agents` | Bounded specialist outputs as validated JSON | Required |
| `integrations` | Capability-normalized adapters plus provider credential resolution | Required |
| `observability` | Structured logs, counters, histograms, spans, retention, and rollout gates | Required |
| `notifications` | Human-facing alerts and reminders | Required |

## Persistence Model

The canonical relational entities are:

- `users`
- `goals`
- `tasks`
- `workflows`
- `jobs`
- `memory_records`
- `policy_rules`
- `approval_requests`
- `action_logs`
- `watchers`
- `integration_accounts`
- `provider_credentials`
- `privacy_operations`
- `autopilot_events`
- `artifacts`

All action history is append-only. Every plan, tool call, approval request, approval response, retry, watcher registration, queued privacy action, autopilot event, and artifact generation must leave an auditable log entry.

## Capability Model

Integrations expose a normalized capability vocabulary:

- `read`
- `search`
- `create`
- `update`
- `draft`
- `send`
- `schedule`
- `monitor`
- `approve`
- `delete`

The orchestrator routes against capabilities only. Provider-specific method names stay inside adapter implementations.

## Trust Boundaries

### Trusted

- Server-side configuration
- Repository persistence layer
- Policy rules defined by the owner

### Untrusted

- User requests
- Imported email, note, and document content
- Integration payloads
- Agent draft outputs until validated
- Any external content retrieved by adapters

## API Surface

The canonical route inventory lives in [`docs/specs/api-route-inventory.md`](api-route-inventory.md) and is validated against `apps/web/app/api/**/route.ts`. New route handlers must update that inventory in the same change or stay out of the merge.

Stable public and core automation endpoints are:

| Endpoint | Method | Responsibility |
| --- | --- | --- |
| `/api/health` | `GET` | Return unauthenticated liveness state for orchestration and probes |
| `/api/ready` | `GET` | Return unauthenticated public-safe readiness summary and the detailed readiness endpoint path |
| `/api/ready/details` | `GET` | Return authenticated detailed readiness state for access key, storage, auth runtime state, request identity, async execution, and connector health |
| `/api/session` | `POST`, `DELETE` | Create or clear an authenticated dashboard session from the access key |
| `/api/goals` | `GET`, `POST` | Load the goals dashboard and enqueue goal creation |
| `/api/goals/jobs/:id` | `GET` | Poll queued goal status and final result summary |
| `/api/goals/:id` | `GET` | Fetch workflow, tasks, artifacts, and explanations |
| `/api/goals/:id/refine` | `POST` | Enqueue bounded refinement for an existing goal |
| `/api/approvals/:id/respond` | `POST` | Approve or reject a gated action |
| `/api/memory` | `GET`, `POST` | Review and add memory records |
| `/api/watchers` | `GET`, `POST` | Register persistent monitors |
| `/api/autopilot/settings` | `GET`, `POST` | Inspect or update autopilot mode and scheduling controls |
| `/api/autopilot/events` | `POST` | Queue deduplicated autopilot work from watcher, template, briefing, approval, connector, or dormant-workflow triggers |
| `/api/integrations` | `GET`, `POST` | Inspect or update adapter state and readiness |
| `/api/governance` | `GET`, `POST` | Inspect or update workspace governance policy |
| `/api/governance/privacy` | `GET`, `POST` | Inspect or queue retention, export, and deletion operations |
| `/api/governance/audit` | `GET` | Review governance and audit outputs |
| `/api/docs/render` | `POST` | Rebuild and validate `agentic.docx` |

Preview, dashboard-slice, integration callback, webhook, and worker event-stream endpoints are supported implementation contracts but are not promised as stable public API unless the route inventory marks them `Stable`.

## Goal Lifecycle

1. Accept a user request.
2. Normalize and validate the request.
3. Resolve the active workspace, relevant memory, and available integrations.
4. Enqueue a durable goal-creation job and return a pollable status handle.
5. Process the goal inside the worker runtime with typed orchestration and policy evaluation.
6. Build the workflow and task graph.
7. Evaluate tasks through governance and approval rules.
8. Generate draft artifacts and capture structured evidence.
9. Request approval when a task crosses an external-action threshold.
10. Register watchers for ongoing coordination.
11. Persist the full bundle, action history, and resulting job state.

## Durable Execution Model

The system intentionally moves long-running or failure-prone work out of request handlers.

- goal creation is queued and processed by the worker runtime
- autopilot events are deduplicated, claimed, and retried through durable jobs
- privacy retention, workspace export, and workspace deletion are worker-backed operations
- retries use bounded policies and dead-letter state rather than unbounded in-request loops
- operator-visible status is sanitized so backend failures do not leak raw secrets or provider internals

## Policy Model

Risk classes remain intentionally simple:

| Risk class | Meaning | Default behavior |
| --- | --- | --- |
| `R1` | Read-only or low-impact reasoning | Allow |
| `R2` | Internal draft, create, update, or monitor work | Allow |
| `R3` | External commitment such as sending or scheduling | Require approval |
| `R4` | Irreversible or highly sensitive action | Block by default |

Low-confidence tasks downgrade to draft behavior instead of acting autonomously. Connector readiness additionally constrains whether a provider can draft, require approval, or participate in higher-trust autonomous execution.

## Memory Model

The first release uses three explicit memory types:

| Memory type | Meaning |
| --- | --- |
| `observed` | Captured behavior or preference that has not been confirmed |
| `inferred` | Model-derived interpretation that still needs review |
| `confirmed` | User-approved durable memory |

Memory ranking should prefer overlap with the active request, confirmed records, and non-expired items.

## Specialist Agents

The system uses bounded specialists for different work shapes:

| Agent | Role |
| --- | --- |
| `communications` | Inbox triage, reply drafting, escalation summaries |
| `calendar` | Calendar inspection, schedule shaping, meeting impact analysis |
| `workflow` | Goal decomposition, next-step planning, commitment tracking |
| `research` | Itinerary analysis, background synthesis, dependency discovery |
| `knowledge` | Memory retrieval, policy-aware context assembly, checklists |

Each agent must emit schema-validated JSON and stay inside an allowlisted capability envelope.

### Sub-Agent Coordination

Complex delegation requests use the orchestrator as the parent coordinator. The orchestrator creates a schema-validated sub-agent operating plan artifact, then expands the plan into normal workflow tasks so every spawned role still passes through policy evaluation, capability allowlists, dependency tracking, artifact generation, approval handling, and append-only action logs.

Each sub-agent role must define:

- role name and assigned specialist agent
- responsibilities
- allowed capabilities
- input contracts
- expected outputs
- dependency role IDs
- risk class
- handoff criteria
- guardrails

The default complex-delegation lane uses recon/scoping, core implementation, test/hardening, and handoff coordination roles. These are coordination primitives, not hidden side effects: any external send, scheduling change, deletion, or sensitive update remains gated by the existing approval workflow.

## Provider Credential Model

Provider connectivity is tenant-scoped rather than process-global.

- provider credentials are stored per tenant
- refresh tokens and similar secrets are stored through an encrypted secret abstraction
- Gmail and Google Calendar resolve credentials through that tenant-scoped repository path
- connector readiness remains the outer contract for which actions are safe to advertise or execute

## Privacy Lifecycle

Privacy controls are first-class durable workflows rather than ad hoc administrative actions.

- retention enforcement applies workspace retention settings and can revoke expired shares
- workspace export produces audit-friendly metadata and artifact packaging
- workspace deletion runs through the same durable execution path with audit visibility
- persisted failures are sanitized before being shown back to operators

## Example Workflow: Inbox Triage

1. Read and rank inbound messages.
2. Surface urgent threads and missing context.
3. Draft reply options.
4. Convert follow-up promises into tasks or reminders.
5. Require approval before any outward send.

## Example Workflow: Weekly Planning

1. Gather calendar, deadlines, and known priorities.
2. Retrieve standing preferences from memory.
3. Draft focus blocks and highlight overload windows.
4. Flag any suggested schedule changes for approval.
5. Register a watcher for later calendar collisions.

## Example Workflow: Travel Preparation

1. Assemble an itinerary brief.
2. Build a readiness checklist.
3. Track missing dependencies such as bookings or documents.
4. Draft schedule updates without committing them.
5. Re-open the checklist as the travel date approaches.

## Operations And Observability

The production contract is explicit:

- production requires `DATABASE_URL`
- migrations run before process startup rather than during request handling
- the web process exposes liveness and readiness endpoints
- the worker process starts only after schema readiness succeeds
- telemetry is retained locally, optionally exported, and evaluated against checked-in rollout gates
- logs, metrics, and spans use shared correlation context across web requests, worker jobs, and provider calls

## Delivery Roadmap

| Phase | Outcome | Key additions |
| --- | --- | --- |
| 1 | Foundation hardening | Web auth boundary, browser security headers, cache-control discipline, deterministic doc pipeline, repository safety fixes |
| 2 | Durable execution | Job contracts, worker runtime, async goal creation, autopilot queueing, privacy-operation jobs, retry and dead-letter handling |
| 3 | Production readiness | Shared-auth-state support, health/readiness probes, migration bootstrap, tenant-scoped provider credentials, observability and rollout gates |
| 4 | Operational rollout | Telemetry backend hookup, dashboard and alert tuning, staged environment validation, production rollout playbooks |

## Security Requirements

- Validate input shapes and reject malformed payloads.
- Keep authorization checks at the API boundary.
- Avoid logging secrets, credentials, and unnecessary personal data.
- Use parameterized SQL for Postgres-backed persistence.
- Normalize and bound document-generation inputs.
- Keep irreversible actions blocked or approval-gated by default.
- Fail closed in production when required access-key, DB, or shared auth-state infrastructure is missing.
- Keep provider credentials tenant-scoped and stored through encrypted secret handling.
- Sanitize persisted worker, autopilot, and privacy-operation failures before surfacing them to operators.

## Performance Requirements

- Prefer a single database round trip for bundle reads where possible.
- Avoid quadratic scans when ranking memory or assembling dashboards.
- Bound large list views with predictable ordering.
- Keep document rendering deterministic and suitable for CI.
- Keep request handlers short by moving long-running work onto the durable worker runtime.
- Bound queue retries, telemetry retention, and in-memory buffers to avoid unbounded resource growth.

## Testing Requirements

The baseline test suite must cover:

- policy classification and approval gating
- memory ranking behavior
- orchestration happy path and approval transitions
- durable goal creation, job polling, and dead-letter handling
- autopilot enqueue, retry, deduplication, and recovery state
- privacy retention, export, and deletion operations
- provider credential isolation and secret handling
- repository persistence round-trips
- document render and validation checks
- deployment smoke and observability rollout-gate validation

Abuse cases must include malformed payloads, oversized requests, capability misuse, and hostile content embedded in external documents.

## Document Source of Truth

This Markdown file is the canonical editable source for the product specification. The generated Word file at `build/agentic.docx` is an artifact, not an authoring surface.

Changes to the specification should be made here first and then rendered through the document pipeline so metadata, heading structure, and packaging stay normalized across builds.
