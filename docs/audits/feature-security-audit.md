# Feature And Security Audit

Date: 2026-04-02

Scope:
- `apps/web` request-facing pages and API routes
- `packages/integrations/src/local-notes.ts`
- `packages/repository/src/index.ts`
- `apps/web/lib/server.ts`

Remediation policy:
- Fix all issues found that can be addressed safely without changing the single-user product model.

## Findings

### High

1. Missing baseline browser security headers on application pages
- Evidence: `/` did not return `X-Content-Type-Options`, `Referrer-Policy`, `X-Frame-Options`, or cross-origin isolation headers during runtime checks.
- Impact: weaker browser-side hardening against MIME sniffing, framing, and accidental capability exposure.
- Fix: added shared response headers in [`apps/web/next.config.ts`](/Users/leonardwongly/Developer/Agentic/apps/web/next.config.ts) using [`apps/web/lib/security-headers.ts`](/Users/leonardwongly/Developer/Agentic/apps/web/lib/security-headers.ts), plus a nonce-backed CSP in [`apps/web/proxy.ts`](/Users/leonardwongly/Developer/Agentic/apps/web/proxy.ts) using [`apps/web/lib/csp.ts`](/Users/leonardwongly/Developer/Agentic/apps/web/lib/csp.ts).
- Residual risk: nonce-based CSP forces dynamic rendering on covered HTML pages, so future static rendering work must account for that constraint.

2. Authenticated JSON APIs did not explicitly opt out of caching
- Evidence: authenticated API responses lacked explicit `Cache-Control: no-store`.
- Impact: intermediaries or browser caches could retain sensitive single-user dashboard data longer than intended.
- Fix: added centralized authenticated JSON helpers in [`apps/web/lib/api-response.ts`](/Users/leonardwongly/Developer/Agentic/apps/web/lib/api-response.ts) and moved authenticated routes onto them.
- Residual risk: page-level caching still depends on route behavior. The home page now calls `noStore()`, but future authenticated pages need the same discipline.

### Medium

3. Route error handling was inconsistent and leaked internal failures
- Evidence: several routes returned raw `error.message` values and mixed `400`/`500` behavior for internal failures.
- Impact: internal exception details could be exposed to clients and failure semantics were hard to reason about.
- Fix: centralized JSON body parsing, auth handling, validation formatting, and safe internal-failure fallbacks in [`apps/web/lib/api-response.ts`](/Users/leonardwongly/Developer/Agentic/apps/web/lib/api-response.ts).
- Residual risk: server-side logs still contain generic error objects for debugging; avoid adding sensitive data to future thrown errors.

4. JSON endpoints accepted malformed bodies without consistent content-type enforcement
- Evidence: routes called `request.json()` directly and relied on incidental failures.
- Impact: invalid JSON and incorrect media types produced inconsistent responses and made abuse cases harder to test.
- Fix: added strict `application/json` enforcement and malformed-body handling in [`apps/web/lib/api-response.ts`](/Users/leonardwongly/Developer/Agentic/apps/web/lib/api-response.ts).
- Residual risk: `GET` routes still validate query parameters independently and need the same discipline if new query surfaces are added.

5. Local note writes were not atomic and direct adapter calls trusted oversized payloads
- Evidence: note creation and updates wrote directly to target paths with `writeFile`.
- Impact: interrupted writes could leave partial files; oversized direct library calls bypassed route-level limits.
- Fix: added atomic temp-write-plus-rename behavior and adapter-level input validation in [`packages/integrations/src/local-notes.ts`](/Users/leonardwongly/Developer/Agentic/packages/integrations/src/local-notes.ts).
- Residual risk: concurrent edits still last-write-win because the product has no optimistic concurrency or file locks.

6. Docs rendering allowed overlapping builds and surfaced raw execution failures to routes
- Evidence: every request spawned a fresh docs build; failures could bubble up as low-level execution errors.
- Impact: concurrent render requests could multiply expensive work, and raw process failures were harder to normalize.
- Fix: added in-flight build deduplication, timeout/max-buffer normalization, and safer failure messages in [`apps/web/lib/server.ts`](/Users/leonardwongly/Developer/Agentic/apps/web/lib/server.ts).
- Residual risk: docs rendering is still process-based and synchronous from the request path; a queued background workflow would be safer if demand increases.

7. File-backed runtime store corruption failed without a targeted operator message
- Evidence: malformed runtime-store JSON raised raw parser or schema exceptions.
- Impact: recovery instructions were unclear and route-level errors could become opaque.
- Fix: corrupted-store detection now throws a targeted recovery message in [`packages/repository/src/index.ts`](/Users/leonardwongly/Developer/Agentic/packages/repository/src/index.ts).
- Residual risk: no automated backup or repair path exists.

## Feature Surface Matrix

| Surface | Inputs | Outputs | Trust boundary | Stateful side effects | Coverage after pass | Remaining gaps |
| --- | --- | --- | --- | --- | --- | --- |
| Session unlock/logout | JSON body, cookie jar, env access key | session cookie, JSON status | untrusted browser to auth boundary | sets or clears session cookie | unit + route + e2e | throttle is process-local rather than shared across instances |
| Approvals respond | path param, JSON body | updated bundle | authenticated API caller | persists approval decision | route tests | no approval history endpoint yet |
| Memory list/create | JSON body | memory list/record | authenticated API caller | persists memory record | route validation + header tests | no edit/delete flow |
| Integrations list/update | JSON body | integration list/record | authenticated API caller | updates integration state | route scoping + validation tests | no audit trail beyond runtime store |
| Local notes list/create/read/update | query, path param, JSON body | note documents | authenticated API caller to local filesystem | creates or updates markdown files | unit + route + e2e | concurrent edits remain last-write-win |
| Docs render | authenticated POST | docs build result | authenticated API caller to child process boundary | runs render/validate scripts | route tests | request-path build still expensive |
| Goal create/read/share | JSON body, path params | goal bundle, share URL | authenticated browser/API caller | saves goal bundles and share logs | unit + route + e2e | no rate limiting |
| Public share page | signed token path param | read-only shared view | anonymous internet to signed-token boundary | logs deduped page views | helper + route + e2e | page-view logging is still request-path persistence |
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

## Deferred Follow-Up

1. The unlock throttle is process-local, so multi-instance deployments should move it to a shared store if cross-instance enforcement matters.
2. Add optimistic concurrency or version checks for local note edits if concurrent writers become common.
3. Move share-page view logging off the request path if public traffic grows enough to make synchronous persistence noticeable.
