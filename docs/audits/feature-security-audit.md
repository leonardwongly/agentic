# Feature And Security Audit

Original audit date: 2026-04-02

Current-state refresh: 2026-04-17

Scope:
- Original pass:
  - `apps/web` request-facing pages and API routes
  - `packages/integrations/src/local-notes.ts`
  - `packages/repository/src/index.ts`
  - `apps/web/lib/server.ts`
- Current-state refresh:
  - `apps/web/lib/runtime-readiness.ts`
  - `apps/web/lib/auth.ts`
  - `apps/web/lib/auth-runtime-state.ts`
  - `apps/web/app/api/governance/privacy/route.ts`
  - `apps/web/app/api/integrations/google/connect/route.ts`
  - `apps/web/app/api/integrations/google/callback/route.ts`
  - `packages/worker-runtime/src/index.ts`
  - `packages/observability/src/index.ts`

Remediation policy:
- Fix all issues found that can be addressed safely without changing the single-user product model.

Document note:
- This file started as a point-in-time route and storage audit.
- The original findings remain below because they are still useful as the baseline hardening record.
- The matrix and summaries have been refreshed so the document reflects the shipped worker-backed, tenant-scoped, production-readiness architecture.

## Findings

### High

1. Missing baseline browser security headers on application pages
- Evidence: `/` did not return `X-Content-Type-Options`, `Referrer-Policy`, `X-Frame-Options`, or cross-origin isolation headers during runtime checks.
- Impact: weaker browser-side hardening against MIME sniffing, framing, and accidental capability exposure.
- Fix: added shared response headers in [`apps/web/next.config.ts`](https://github.com/leonardwongly/agentic/blob/main/apps/web/next.config.ts) using [`apps/web/lib/security-headers.ts`](https://github.com/leonardwongly/agentic/blob/main/apps/web/lib/security-headers.ts), plus a nonce-backed CSP in [`apps/web/proxy.ts`](https://github.com/leonardwongly/agentic/blob/main/apps/web/proxy.ts) using [`apps/web/lib/csp.ts`](https://github.com/leonardwongly/agentic/blob/main/apps/web/lib/csp.ts).
- Residual risk: nonce-based CSP forces dynamic rendering on covered HTML pages, so future static rendering work must account for that constraint.

2. Authenticated JSON APIs did not explicitly opt out of caching
- Evidence: authenticated API responses lacked explicit `Cache-Control: no-store`.
- Impact: intermediaries or browser caches could retain sensitive single-user dashboard data longer than intended.
- Fix: added centralized authenticated JSON helpers in [`apps/web/lib/api-response.ts`](https://github.com/leonardwongly/agentic/blob/main/apps/web/lib/api-response.ts) and moved authenticated routes onto them.
- Residual risk: page-level caching still depends on route behavior. The home page now calls `noStore()`, but future authenticated pages need the same discipline.

### Medium

3. Route error handling was inconsistent and leaked internal failures
- Evidence: several routes returned raw `error.message` values and mixed `400`/`500` behavior for internal failures.
- Impact: internal exception details could be exposed to clients and failure semantics were hard to reason about.
- Fix: centralized JSON body parsing, auth handling, validation formatting, and safe internal-failure fallbacks in [`apps/web/lib/api-response.ts`](https://github.com/leonardwongly/agentic/blob/main/apps/web/lib/api-response.ts).
- Residual risk: server-side logs still contain generic error objects for debugging; avoid adding sensitive data to future thrown errors.

4. JSON endpoints accepted malformed bodies without consistent content-type enforcement
- Evidence: routes called `request.json()` directly and relied on incidental failures.
- Impact: invalid JSON and incorrect media types produced inconsistent responses and made abuse cases harder to test.
- Fix: added strict `application/json` enforcement and malformed-body handling in [`apps/web/lib/api-response.ts`](https://github.com/leonardwongly/agentic/blob/main/apps/web/lib/api-response.ts).
- Residual risk: `GET` routes still validate query parameters independently and need the same discipline if new query surfaces are added.

5. Local note writes were not atomic and direct adapter calls trusted oversized payloads
- Evidence: note creation and updates wrote directly to target paths with `writeFile`.
- Impact: interrupted writes could leave partial files; oversized direct library calls bypassed route-level limits.
- Fix: added atomic temp-write-plus-rename behavior and adapter-level input validation in [`packages/integrations/src/local-notes.ts`](https://github.com/leonardwongly/agentic/blob/main/packages/integrations/src/local-notes.ts).
- Follow-up hardening: production local notes now fail closed unless `AGENTIC_LOCAL_NOTES_ENABLED=true`, `AGENTIC_NOTES_PATH`, and `AGENTIC_LOCAL_NOTES_ALLOWED_ROOT` are configured with the notes path under the allowed root. Public note responses and integration metadata no longer expose absolute filesystem paths.
- Residual risk: concurrent edits still last-write-win because the product has no optimistic concurrency or file locks.

6. Docs rendering allowed overlapping builds and surfaced raw execution failures to routes
- Evidence: every request spawned a fresh docs build; failures could bubble up as low-level execution errors.
- Impact: concurrent render requests could multiply expensive work, and raw process failures were harder to normalize.
- Fix: added in-flight build deduplication, timeout/max-buffer normalization, and safer failure messages in [`apps/web/lib/server.ts`](https://github.com/leonardwongly/agentic/blob/main/apps/web/lib/server.ts).
- Residual risk: docs rendering is still process-based and synchronous from the request path; a queued background workflow would be safer if demand increases.

7. File-backed runtime store corruption failed without a targeted operator message
- Evidence: malformed runtime-store JSON raised raw parser or schema exceptions.
- Impact: recovery instructions were unclear and route-level errors could become opaque.
- Fix: corrupted-store detection now throws a targeted recovery message in [`packages/repository/src/index.ts`](https://github.com/leonardwongly/agentic/blob/main/packages/repository/src/index.ts).
- Residual risk: no automated backup or repair path exists.

## Current-State Feature Surface Matrix

| Surface | Inputs | Outputs | Trust boundary | Stateful side effects | Coverage after pass | Remaining gaps |
| --- | --- | --- | --- | --- | --- | --- |
| Session unlock/logout | JSON body, cookie jar, env access key, shared-state env | session cookie, JSON status | untrusted browser to auth boundary | sets, clears, and revokes session state plus unlock-throttle state | unit + route + e2e + readiness coverage | non-production still stays process-local by default unless `AGENTIC_SHARED_AUTH_STATE=true` selects the shared store; `AGENTIC_REQUIRE_SHARED_AUTH_STATE=true` makes readiness report the requirement |
| Approvals respond | path param, JSON body | updated bundle | authenticated API caller | persists approval decision | route tests | no approval history endpoint yet |
| Memory list/create | JSON body | memory list/record | authenticated API caller | persists memory record | route validation + header tests | no edit/delete flow |
| Integrations list/update | JSON body | integration list/record | authenticated API caller | updates integration state | route scoping + validation tests | non-Google providers still rely on future provider-specific credential work |
| Google OAuth connect/callback | signed OAuth state, query params, provider redirect | authenticated redirect, dashboard integration state | authenticated browser plus Google OAuth boundary | persists tenant-scoped credential metadata and encrypted refresh-token secret | route + repository coverage | provider availability and token rotation still depend on Google uptime and operator configuration |
| Local notes list/create/read/update | query, path param, JSON body | note documents | authenticated API caller to local filesystem | creates or updates markdown files | unit + route + e2e | concurrent edits remain last-write-win |
| Docs render | authenticated POST | docs build result | authenticated API caller to child process boundary | runs render/validate scripts | route tests | request-path build still expensive |
| Goal create/read/share/status | JSON body, path params | `202` job acknowledgement, job status, goal bundle, share URL | authenticated browser/API caller, plus signed public-token boundary for share pages | saves goal bundles, durable jobs, and share logs | unit + route + e2e + worker coverage | share-page view tracking is now best-effort and still relies on repository write consistency under concurrent public traffic |
| Autopilot event queueing | JSON body, idempotency key, actor context | deduplicated event status | authenticated API caller to durable-job boundary | persists autopilot event plus queued work | route + worker tests | event volume still depends on queue sizing and rollout alerting rather than per-route rate limits |
| Privacy operations | JSON body, active-workspace ownership, actor context | operation list, accepted queued operation | workspace owner to governance boundary | persists privacy operation records, queued jobs, audit metadata, export/delete status | route + worker tests | destructive delete semantics remain asynchronous and require operators to wait for completion state |
| Health and readiness probes | probe request, env, DB connectivity, auth runtime state | operational JSON report | infrastructure to runtime boundary | no user-data mutation | unit + smoke deployment coverage | these checks only protect production when wired into deployment gates and alerting |
| Observability export and rollout gates | env config, retained telemetry files, backend URL/token | redacted logs, metrics, spans, gate results | internal runtime to telemetry backend/filesystem boundary | retains bounded telemetry batches and rollout validation artifacts | unit + smoke + failure-injection + load coverage | backend access control, retention policy enforcement, and live threshold tuning remain external-operational work |
| Public share page | signed token path param | read-only shared view | anonymous internet to signed-token boundary | emits best-effort view-tracking POST plus deduped page-view logs | helper + route + e2e | public-share tracking is asynchronous and still depends on repository durability |
| Repository persistence | filesystem path or `DATABASE_URL` | domain models | process to filesystem/Postgres | creates and updates runtime data | repository tests | no automatic corruption repair |

## Implemented Remediation Summary

- Added centralized authenticated JSON helpers with consistent `no-store` headers and safe error normalization.
- Added baseline browser security headers across the web app.
- Added a nonce-backed CSP for HTML routes through `proxy.ts`.
- Added a bounded in-memory throttle for repeated failed session unlock attempts, including `429` + `Retry-After` responses.
- Marked the authenticated home page as non-cacheable with `noStore()`.
- Enforced `application/json` for JSON mutation endpoints and normalized malformed-body failures.
- Hardened local note writes with atomic rename semantics plus adapter-level input validation.
- Deduplicated concurrent docs builds and normalized child-process failure messages.
- Improved corrupted runtime-store recovery messaging.
- Expanded unit, route, and end-to-end coverage for headers, malformed input, cookie flags, share flows, and storage corruption.

## Current-State Remediation Summary

- Added readiness and startup enforcement for:
  - configured access-key signing secret in production
  - database connectivity and migration health
  - shared auth runtime state when production is configured to fail closed
- Replaced process-global provider secret assumptions with tenant-scoped provider credentials and encrypted refresh-token storage, including signed OAuth state for Google connect/callback.
- Moved goal creation, autopilot processing, and privacy lifecycle work onto durable jobs with idempotency keys, atomic claim semantics, retries, dead-letter handling, and sanitized client-visible failure states.
- Added privacy operation ownership checks so only the active workspace owner can queue retention, export, or deletion flows.
- Added structured logs, metrics, and spans with request/job correlation IDs plus secret redaction before telemetry is retained or exported.
- Added bounded telemetry export, retention, and rollout-gate evaluation so deployment validation can fail on observable correctness regressions rather than only synthetic health checks.
- Added explicit health and readiness endpoints so production rollouts can fail closed before traffic shifts onto a misconfigured web runtime.

## Deferred Follow-Up

1. Shared auth state is only guaranteed cross-instance when shared session and unlock stores are configured; production now fails closed by default, and non-production can select the same backing store with `AGENTIC_SHARED_AUTH_STATE=true` when `DATABASE_URL` is configured.
2. Add optimistic concurrency or version checks for local note edits if concurrent writers become common.
3. Public-share view tracking is now off the render path, but repository updates are still best-effort and last-write-win; add stronger concurrency control if public traffic grows.
4. Docs rendering is still request-path process execution; if demand rises, move it behind the durable worker path instead of allowing user traffic to trigger build work directly.
5. The telemetry pipeline is redacted and bounded in-process, but real retention, access control, and alert-threshold governance still depend on the external observability backend configuration.
