# Validation Matrix

## Purpose

This matrix defines the minimum validation evidence required to release Agentic
surfaces by risk class. The objective is to keep high-risk paths fail-closed,
make release evidence explicit, and stop rollouts when runtime signals suggest
durability or abuse regressions.

## Risk Classes

| Risk class | Definition | Examples | Release posture |
| --- | --- | --- | --- |
| `P0` | Directly mutates user state, crosses trust boundaries, or handles anonymous/public traffic. | Goal creation/refinement, briefing creation, template execution, docs render, autopilot events, privacy operations, public share view, auth callback flows | Must block release on any failed validation gate. |
| `P1` | Operational and monitoring surfaces whose failure can hide or amplify a production incident. | `/api/ready`, deployment smoke/canary, rollout telemetry, queue health summaries, dashboard operations tower | Must block release on any failed critical gate and require explicit sign-off on warnings. |
| `P2` | Read-mostly or advisory surfaces with low blast radius. | Non-mutating dashboard summaries, internal docs, descriptive reports | Warnings may ship if captured in release notes with owner and follow-up date. |

## Surface Matrix

| Surface | Risk class | Required validation | Automated evidence | Manual/operator evidence | Release stop conditions |
| --- | --- | --- | --- | --- | --- |
| Goal create/refine routes | `P0` | Schema validation, abuse rate limiting, idempotency, queued job completion, dead-letter sanitization | `tests/api-validation.test.ts`, `tests/goal-route.test.ts`, `tests/worker-runtime.test.ts`, `npm run test:security:regression` | Verify staged canary goal completes through live worker path | Any non-`202` enqueue regression, ownership leak, duplicate mutation, or unsanitized failure |
| Briefing, template run, docs render routes | `P0` | Schema validation, abuse controls, durable queue behavior, retry safety | `tests/briefing-route.test.ts`, `tests/templates-route.test.ts`, `tests/docs-render-route.test.ts`, `tests/worker-runtime.test.ts`, `npm run test:performance:fitness` | Verify a live queued job reaches `completed` and returns expected status payload | Queue backlog does not drain, retry churn exceeds budget, or dead letters appear during rollout |
| Autopilot events and privacy workflows | `P0` | Duplicate-event suppression, stale event handling, sanitized recovery state, governed execution | `tests/autopilot-route.test.ts`, `tests/governance-privacy-route.test.ts`, `tests/repository.test.ts`, `tests/worker-runtime.test.ts` | Confirm rollout dashboard shows zero new critical execution diagnostics | Duplicate execution, privacy boundary leak, or unsanitized recovery payload |
| Auth/session and provider callbacks | `P0` | Callback state integrity, least-privilege access, session fail-closed behavior | `tests/auth.test.ts`, `tests/google-provider-routes.test.ts`, `tests/api-validation.test.ts` | Confirm production auth state is shared and access-key bootstrap is configured | Process-local fallback in production, callback abuse acceptance, or token state tampering regression |
| Anonymous/public share surfaces | `P0` | Request size limits, anonymous rate limiting, no inline state mutation on request path | `tests/public-share-view-route.test.ts`, `tests/share-route.test.ts`, `tests/governance-privacy-route.test.ts` | Verify public share telemetry is recorded asynchronously and deduplicated | Anonymous write path reintroduced, oversized payload accepted, or privacy metadata leaked |
| Runtime readiness and rollout telemetry | `P1` | Database/schema readiness, connector health, aggregate queue health, cached public readiness p95 under 50 ms, alert manifest evaluation | `tests/runtime-readiness.test.ts`, `tests/runtime-readiness-repository-cache.test.ts`, `tests/observability-rollout-gate.test.ts`, `npm run test:performance:fitness`, `npm run telemetry:rollout-gate -- --dir <retention-dir>` | Review rollout dashboard for HTTP, worker, provider, and queue signals; use `/api/ready/details` for fresh diagnostics | `/api/ready` returns `503`, public readiness p95 exceeds budget, rollout gate fails, or critical alerts fire |
| Deployment async canary and smoke harness | `P1` | Valid enqueue response, pollable status URL, bounded timeout, malformed response rejection | `tests/deployment-async-canary.test.ts`, `npm run test:smoke:deployment`, `npm run test:smoke:deployment-async` | Canary completes in staging before traffic shift and again after production shift | Async canary timeout, malformed response, dead letter, or missing result payload |
| GitHub App issue sync canary | `P1` | Stable sync URL, fail-closed bearer auth, allowlisted issue intake, pull-request skip behavior, same-origin job polling, worker settlement | `tests/deployment-github-app-sync-canary.test.ts`, `tests/github-app-sync-live-preflight.test.ts`, `npm run github:app-sync:preflight:collect`, `npm run test:smoke:github-app-sync` | Manual workflow dispatch and live canary evidence are captured before enabling scheduled sync | Temporary tunnel URL, disabled workflow, invalid auth not returning `401`, missing worker settlement, duplicate unsafe work, or secret leakage |
| Dashboard operational surfaces | `P2` | Surface decomposition, explicit role gating, no direct request-path execution | `npm run test:architecture:fitness`, dashboard component tests, targeted Vitest suites after edits | Spot-check operations tower, advanced ops sections, and detail panes in staging | Critical operator panel missing or role surface regression blocks incident response |

## Release Evidence By Phase

### Pre-deploy

Run all of the following before a staged rollout:

```bash
npm ci
npm run lint
npm run typecheck
npm run format:check
npm run release:check-context
npm run build
npm test
npm run test:security:regression
npm run test:performance:fitness
npm run test:architecture:fitness
npm run test:smoke:observability-export
```

### Staging

Required evidence:

- `npm run test:smoke:deployment`
- `npm run test:smoke:deployment-async`
- `npm run test:smoke:github-app-sync`
- `npm run telemetry:rollout-gate -- --dir "${AGENTIC_TELEMETRY_RETENTION_DIR:-.agentic/telemetry}"`
- No new `dead_letter`, `expired_leases`, or `stale_pending_jobs` readiness failures

### Production

Required evidence after traffic shift:

- `/api/health` returns success
- `/api/ready` returns success
- staged async canary and post-shift async canary both complete
- GitHub App issue sync canary completes against the stable deployed route
- rollout-gate manifest passes on retained telemetry
- on-call operator records residual risks or confirms none remain

## Queue and Performance Sanity Budgets

These budgets are intentionally small-sample sanity gates, not load-test
substitutes:

| Signal | Budget | Why it matters |
| --- | --- | --- |
| Enqueue route latency p95 surrogate | `< 250ms` | Protects the request path from accidental synchronous work |
| Small docs-worker backlog drain | `< 2000ms` | Confirms a small queued batch clears promptly in release gating |
| Retry churn for a transient failure | `<= 1 retry per job in the sanity suite` | Catches runaway retry loops before rollout |
| Duplicate execution under competing workers | `0 duplicate side-effect executions` | Prevents queue races from mutating state twice |

Exceeding any `P0` or `P1` budget is a release blocker until the failure is
understood and rerun evidence is collected.

## Sign-off

The release owner must capture:

- commit or image tag
- environment
- exact commands run
- test and smoke outcomes
- rollout gate summary
- residual risks, if any

Do not promote a release on memory or verbal confirmation alone. The evidence
must be reproducible from the repository and runtime artifacts.
