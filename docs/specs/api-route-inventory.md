# Agentic API Route Inventory

This inventory is the canonical map for `apps/web/app/api/**/route.ts`. Every route handler must either appear here or be removed. Stable public routes can be documented in user-facing guides, while authenticated UI/internal and preview routes are implementation contracts for the Agentic dashboard and worker loop.

## Classification Policy

| Classification | Meaning |
| --- | --- |
| Public operational | Unauthenticated liveness, readiness, or session bootstrap surface. |
| Public signed | Public only when the caller presents a bounded signed token or equivalent proof. |
| Authenticated UI/internal | Dashboard-owned JSON contract that requires an Agentic session or access key. |
| Admin/governance | Authenticated route that mutates policy, workspace, privacy, or recovery state. |
| Integration boundary | OAuth callback, provider webhook, notification, or external event ingestion route. |
| Worker/job | Poll, replay, or stream route for durable execution jobs. |
| Preview/internal | Experimental or dashboard-only surface that should not be treated as a stable public API. |

New route handlers must update this file in the same change unless they are deleted before merge. If a route is stable/public, also update `docs/specs/agentic.md` or the relevant runbook with status, auth, and failure behavior.

## Route Inventory

| Endpoint | Methods | Classification | Auth | Stability | Owner/module | Purpose |
| --- | --- | --- | --- | --- | --- | --- |
| `/api/agents` | `GET, POST` | Authenticated UI/internal | Session or access key | Preview | Agents | List and create custom agent definitions. |
| `/api/agents/:id` | `GET, PUT, DELETE` | Authenticated UI/internal | Session or access key | Preview | Agents | Inspect, update, or delete one custom agent. |
| `/api/agents/:id/clone` | `POST` | Authenticated UI/internal | Session or access key | Preview | Agents | Clone an agent definition for customization. |
| `/api/agents/:id/export` | `GET` | Authenticated UI/internal | Session or access key | Preview | Agents | Export one agent definition. |
| `/api/agents/:id/memories` | `GET, POST` | Authenticated UI/internal | Session or access key | Preview | Agents and memory | Inspect or add agent-scoped memory. |
| `/api/agents/:id/metrics` | `GET` | Authenticated UI/internal | Session or access key | Preview | Agents | Load agent performance and usage metrics. |
| `/api/agents/activity` | `GET` | Authenticated UI/internal | Session or access key | Preview | Agents | Load recent agent activity. |
| `/api/agents/import` | `POST` | Authenticated UI/internal | Session or access key | Preview | Agents | Import a custom agent definition. |
| `/api/approvals/:id/respond` | `POST` | Authenticated UI/internal | Session or access key | Stable | Approvals and policy | Record an approval or rejection for a gated action. |
| `/api/approvals/batch/preview` | `POST` | Authenticated UI/internal | Session or access key | Preview | Approvals | Preview a batch approval operation. |
| `/api/approvals/batch/respond` | `POST` | Authenticated UI/internal | Session or access key | Preview | Approvals | Apply a bounded batch approval decision. |
| `/api/approvals/jobs/:id` | `GET` | Worker/job | Session or access key | Stable | Worker runtime | Poll approval follow-up or notification job status. |
| `/api/autopilot/events` | `POST` | Admin/governance | Session or access key | Stable | Autopilot | Queue deduplicated watcher, template, briefing, or connector events. |
| `/api/autopilot/settings` | `GET, POST` | Admin/governance | Session or access key | Stable | Autopilot | Inspect or update autopilot mode and scheduling controls. |
| `/api/briefing` | `POST` | Authenticated UI/internal | Session or access key | Stable | Briefings | Enqueue a startup, midday, meeting, end-of-day, or next-day briefing. |
| `/api/briefing/jobs/:id` | `GET` | Worker/job | Session or access key | Stable | Worker runtime | Poll briefing job status. |
| `/api/briefing/schedule` | `GET, POST` | Authenticated UI/internal | Session or access key | Preview | Briefings | Inspect or update briefing cadence preferences. |
| `/api/calibration` | `GET` | Preview/internal | Session or access key | Preview | Calibration | Load calibration and evaluation summaries. |
| `/api/commitments` | `GET` | Authenticated UI/internal | Session or access key | Stable | Commitments | Page through the operator commitment inbox. |
| `/api/commitments/:id` | `PATCH` | Authenticated UI/internal | Session or access key | Stable | Commitments | Complete, dismiss, or reopen one commitment. |
| `/api/context/packets` | `GET, POST` | Authenticated UI/internal | Session or access key | Preview | Context packets | List or create bounded context packets. |
| `/api/dashboard/activity` | `GET` | Authenticated UI/internal | Session or access key | Preview | Dashboard | Load dashboard activity slices. |
| `/api/dashboard/approvals` | `GET` | Authenticated UI/internal | Session or access key | Preview | Dashboard | Load dashboard approval slices. |
| `/api/dashboard/artifacts` | `GET` | Authenticated UI/internal | Session or access key | Preview | Dashboard | Load dashboard artifact slices. |
| `/api/dashboard/commitments` | `GET` | Authenticated UI/internal | Session or access key | Preview | Dashboard | Load dashboard commitment slices. |
| `/api/dashboard/core-loop` | `POST` | Authenticated UI/internal | Session or access key | Preview | Dashboard | Load or refresh core-loop telemetry. |
| `/api/dashboard/events` | `GET` | Authenticated UI/internal | Session or access key | Preview | Dashboard | Stream dashboard event updates. |
| `/api/dashboard/jobs` | `GET` | Authenticated UI/internal | Session or access key | Preview | Dashboard | Load dashboard job slices. |
| `/api/dashboard/memories` | `GET` | Authenticated UI/internal | Session or access key | Preview | Dashboard | Load dashboard memory slices. |
| `/api/dashboard/recommendations` | `GET` | Authenticated UI/internal | Session or access key | Preview | Dashboard | Load workflow recommendation summaries. |
| `/api/dashboard/recommendations/feedback` | `POST` | Authenticated UI/internal | Session or access key | Preview | Dashboard | Record recommendation feedback from the dashboard. |
| `/api/dashboard/summary` | `GET` | Authenticated UI/internal | Session or access key | Preview | Dashboard | Load the primary dashboard snapshot summary. |
| `/api/docs/jobs/:id` | `GET` | Worker/job | Session or access key | Stable | Docs runtime | Poll document render job status. |
| `/api/docs/render` | `POST` | Authenticated UI/internal | Session or access key | Stable | Docs runtime | Enqueue reproducible document rendering. |
| `/api/github/issues/webhook` | `POST` | Integration boundary | GitHub webhook signature | Stable | GitHub issue intake | Accept signed GitHub issue events for governed sync. |
| `/api/goals` | `GET, POST` | Authenticated UI/internal | Session or access key | Stable | Goals and orchestration | Load dashboard data or enqueue goal creation. |
| `/api/goals/:id` | `GET` | Authenticated UI/internal | Session or access key | Stable | Goals and orchestration | Fetch one goal bundle with workflow state. |
| `/api/goals/:id/recommendations/feedback` | `POST` | Authenticated UI/internal | Session or access key | Preview | Learning flywheel | Record recommendation feedback for one goal. |
| `/api/goals/:id/refine` | `POST` | Authenticated UI/internal | Session or access key | Stable | Goals and worker runtime | Enqueue refinement for one goal. |
| `/api/goals/:id/share` | `POST, DELETE` | Authenticated UI/internal | Session or access key | Stable | Goal sharing | Create or revoke a bounded public share link. |
| `/api/goals/jobs/:id` | `GET` | Worker/job | Session or access key | Stable | Worker runtime | Poll goal creation or refinement job status. |
| `/api/governance` | `GET, POST` | Admin/governance | Session or access key | Stable | Governance | Inspect or update workspace governance policy. |
| `/api/governance/audit` | `GET` | Admin/governance | Session or access key | Stable | Governance | Export governance and audit evidence. |
| `/api/governance/privacy` | `GET, POST` | Admin/governance | Session or access key | Stable | Privacy operations | Inspect privacy controls or queue retention, export, and deletion work. |
| `/api/governance/simulate` | `POST` | Admin/governance | Session or access key | Stable | Governance | Run policy simulation against proposed governance settings. |
| `/api/health` | `GET` | Public operational | None | Stable | Operations | Return process liveness. |
| `/api/integrations` | `GET, POST` | Authenticated UI/internal | Session or access key | Stable | Integrations | Inspect or update adapter readiness and provider state. |
| `/api/integrations/google/callback` | `GET` | Integration boundary | OAuth state and provider response | Stable | Google integrations | Complete Google OAuth callback handling. |
| `/api/integrations/google/connect` | `GET` | Integration boundary | Session or access key | Stable | Google integrations | Start Google OAuth or return setup-required JSON. |
| `/api/integrations/local-notes` | `GET, POST` | Authenticated UI/internal | Session or access key | Stable | Local notes | Search or create local Markdown notes. |
| `/api/integrations/local-notes/:slug` | `GET, PUT` | Authenticated UI/internal | Session or access key | Stable | Local notes | Read or update one local Markdown note. |
| `/api/jobs/:id` | `GET` | Worker/job | Session or access key | Stable | Worker runtime | Poll a durable job through the generic job surface. |
| `/api/jobs/:id/events` | `GET` | Worker/job | Session or access key | Preview | Worker runtime | Stream one durable job event feed. |
| `/api/jobs/:id/replay` | `POST` | Admin/governance | Session or access key | Stable | Worker runtime | Replay a permitted dead-letter job. |
| `/api/memory` | `GET, POST` | Authenticated UI/internal | Session or access key | Stable | Memory | Review or add memory records. |
| `/api/memory/:id` | `PATCH` | Authenticated UI/internal | Session or access key | Stable | Memory | Review, confirm, or update one memory record. |
| `/api/memory/recommendations` | `GET` | Authenticated UI/internal | Session or access key | Preview | Learning flywheel | Load memory-backed workflow recommendations. |
| `/api/nl/intent` | `GET, POST` | Authenticated UI/internal | Session or access key | Preview | Natural language router | Inspect NL capability metadata or execute one bounded intent. |
| `/api/operations/recovery` | `POST` | Admin/governance | Session or access key | Preview | Operations tower | Run a bounded recovery or remediation action. |
| `/api/operator-products` | `GET, POST` | Authenticated UI/internal | Session or access key | Preview | Operator products | List or select an operator product pack. |
| `/api/provenance/graph` | `GET` | Authenticated UI/internal | Session or access key | Preview | Provenance | Load the provenance graph. |
| `/api/ready` | `GET` | Public operational | None | Stable | Operations | Return readiness across auth, storage, queue, and connectors. |
| `/api/session` | `POST, DELETE` | Public operational | Access key for POST; session for DELETE | Stable | Auth | Create or clear the dashboard session. |
| `/api/share/view` | `POST` | Public signed | Signed share token | Stable | Goal sharing | Read a public shared-goal projection. |
| `/api/slack/notify` | `POST` | Integration boundary | Session or access key | Preview | Slack | Send an approval-safe Slack notification. |
| `/api/slack/webhook` | `POST` | Integration boundary | Slack signature when configured | Preview | Slack | Accept Slack events for governed processing. |
| `/api/telegram/notify` | `POST` | Integration boundary | Session or access key | Preview | Telegram | Send an approval-safe Telegram notification. |
| `/api/telegram/webhook` | `POST` | Integration boundary | Telegram secret token when configured | Preview | Telegram | Accept Telegram events for governed processing. |
| `/api/templates` | `GET, POST` | Authenticated UI/internal | Session or access key | Stable | Templates | List or create reusable goal templates. |
| `/api/templates/:id` | `PATCH, DELETE` | Authenticated UI/internal | Session or access key | Stable | Templates | Update or delete one reusable goal template. |
| `/api/templates/:id/run` | `POST` | Authenticated UI/internal | Session or access key | Stable | Templates and worker runtime | Enqueue a template run. |
| `/api/templates/jobs/:id` | `GET` | Worker/job | Session or access key | Stable | Worker runtime | Poll template-run job status. |
| `/api/watchers` | `GET, POST` | Authenticated UI/internal | Session or access key | Stable | Watchers | List or create workflow watchers. |
| `/api/watchers/:id` | `PATCH` | Authenticated UI/internal | Session or access key | Stable | Watchers | Pause or resume a watcher. |
| `/api/workflow-templates` | `GET, POST` | Authenticated UI/internal | Session or access key | Preview | Workflow templates | List or create workflow templates. |
| `/api/workflow-templates/:id` | `GET, PUT, DELETE` | Authenticated UI/internal | Session or access key | Preview | Workflow templates | Inspect, update, or delete one workflow template. |
| `/api/workspaces` | `GET, POST` | Admin/governance | Session or access key | Stable | Workspaces | List, create, or select workspaces and members. |
