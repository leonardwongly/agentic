# Agentic

## Purpose

Agentic is a trusted execution control plane for coordinating work across messages, calendars, tasks, notes, and generated artifacts. The first release prioritizes trustworthy execution over provider-specific depth, and keeps the daily operating loop centered on commitments, approvals, and evidence.

The product is intentionally designed as a modular monolith so the first milestone can stay fast to iterate, easy to test, and auditable from the first user request through every policy decision and resulting artifact.

## Product Principles

1. Prefer explicit approvals over unsafe autonomy.
2. Keep all external actions behind a policy gate.
3. Store durable state in a relational model with append-only audit history.
4. Make every agent output schema-validated JSON.
5. Treat integrations as provider-neutral capabilities, not vendor-specific APIs.
6. Make generated documents reproducible from version-controlled source.

## Architecture

The Phase 1 system runs as a TypeScript-first Node 20 application with a Next.js web surface, shared packages for orchestration logic, and a repository layer that can run against Postgres or a deterministic file-backed development store.

### Core Modules

| Module | Responsibility | Phase 1 expectation |
| --- | --- | --- |
| `orchestrator` | Intake, planning, routing, workflow assembly | Required |
| `memory` | Explicit and inferred memory records | Required |
| `policy` | Risk classification and approval gating | Required |
| `execution` | Task state and workflow transitions | Required |
| `agents` | Bounded specialist outputs as validated JSON | Required |
| `integrations` | Capability-normalized adapters | Required |
| `observability` | Append-only action logs and explanations | Required |
| `notifications` | Human-facing alerts and reminders | Required |

## Persistence Model

The canonical relational entities are:

- `users`
- `goals`
- `tasks`
- `workflows`
- `memory_records`
- `policy_rules`
- `approval_requests`
- `action_logs`
- `watchers`
- `integration_accounts`
- `artifacts`

All action history is append-only. Every plan, tool call, approval request, approval response, retry, watcher registration, and artifact generation must leave an auditable log entry.

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

The initial HTTP JSON API supports the UI and future external automation:

| Endpoint | Method | Responsibility |
| --- | --- | --- |
| `/api/goals` | `POST` | Create a structured goal from a user request |
| `/api/goals/:id` | `GET` | Fetch workflow, tasks, artifacts, and explanations |
| `/api/approvals/:id/respond` | `POST` | Approve or reject a gated action |
| `/api/memory` | `GET`, `POST` | Review and add memory records |
| `/api/watchers` | `GET`, `POST` | Register persistent monitors |
| `/api/integrations` | `GET`, `POST` | Inspect or update adapter state |
| `/api/docs/render` | `POST` | Rebuild and validate `agentic.docx` |

## Goal Lifecycle

1. Accept a user request.
2. Normalize and validate the request.
3. Detect the likely scenario.
4. Resolve relevant memory and available integrations.
5. Build a workflow and task graph.
6. Evaluate each task through policy.
7. Generate draft artifacts.
8. Request approval when a task crosses an external-action threshold.
9. Register watchers for ongoing coordination.
10. Persist the full bundle and action history.

## Policy Model

Risk classes are intentionally simple in the first milestone:

| Risk class | Meaning | Default behavior |
| --- | --- | --- |
| `R1` | Read-only or low-impact reasoning | Allow |
| `R2` | Internal draft, create, update, or monitor work | Allow |
| `R3` | External commitment such as sending or scheduling | Require approval |
| `R4` | Irreversible or highly sensitive action | Block by default |

Low-confidence tasks downgrade to draft behavior instead of acting autonomously.

## Memory Model

The first release uses three explicit memory types:

| Memory type | Meaning |
| --- | --- |
| `observed` | Captured behavior or preference that has not been confirmed |
| `inferred` | Model-derived interpretation that still needs review |
| `confirmed` | User-approved durable memory |

Memory ranking should prefer overlap with the active request, confirmed records, and non-expired items.

## Specialist Agents

Phase 2 introduces five bounded specialists:

| Agent | Role |
| --- | --- |
| `communications` | Inbox triage, reply drafting, escalation summaries |
| `calendar` | Calendar inspection, schedule shaping, meeting impact analysis |
| `workflow` | Goal decomposition, next-step planning, commitment tracking |
| `research` | Itinerary analysis, background synthesis, dependency discovery |
| `knowledge` | Memory retrieval, policy-aware context assembly, checklists |

Each agent must emit schema-validated JSON and stay inside an allowlisted capability envelope.

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

## Delivery Roadmap

| Phase | Outcome | Key additions |
| --- | --- | --- |
| 1 | Foundation | UI shell, orchestration, policy, memory, mock adapters, doc pipeline |
| 2 | Specialist quality | Five bounded agents, routing rules, evaluation metrics |
| 3 | Persistent execution | Delayed jobs, retries, resumable checkpoints, richer watcher behavior |
| 4 | Personalization | Memory ranking improvements, policy tuning, selective proactivity |
| 5 | Ecosystem expansion | Real provider adapters and later broader workspace growth |

## Security Requirements

- Validate input shapes and reject malformed payloads.
- Keep authorization checks at the API boundary.
- Avoid logging secrets, credentials, and unnecessary personal data.
- Use parameterized SQL for Postgres-backed persistence.
- Normalize and bound document-generation inputs.
- Keep irreversible actions blocked or approval-gated by default.

## Performance Requirements

- Prefer a single database round trip for bundle reads where possible.
- Avoid quadratic scans when ranking memory or assembling dashboards.
- Bound large list views with predictable ordering.
- Keep document rendering deterministic and suitable for CI.

## Testing Requirements

The baseline test suite must cover:

- policy classification and approval gating
- memory ranking behavior
- orchestration happy path and approval transitions
- repository persistence round-trips
- document render and validation checks

Abuse cases must include malformed payloads, oversized requests, capability misuse, and hostile content embedded in external documents.

## Document Source of Truth

This Markdown file is the canonical editable source for the product specification. The generated Word file at `build/agentic.docx` is an artifact, not an authoring surface.

Changes to the specification should be made here first and then rendered through the document pipeline so metadata, heading structure, and packaging stay normalized across builds.
