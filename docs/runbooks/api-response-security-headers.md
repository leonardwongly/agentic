# API response security headers

Agentic API routes must return the baseline security headers on every success,
validation failure, auth failure, rate-limit response, and internal-error path.

The supported builders are:

- `authenticatedJson(...)` for authenticated JSON API responses.
- `authenticatedResponse(...)` for authenticated non-JSON downloads.
- `authenticatedRedirect(...)` for authenticated redirects.
- `operationalJson(...)` for unauthenticated operational or webhook JSON.
- `operationalResponse(...)` for unauthenticated operational non-JSON responses.
- `withApiTelemetry(...)` for routes that need request telemetry; it finalizes
  raw or streaming responses with correlation and baseline security headers.

Do not call `NextResponse.json(...)` directly from `apps/web/app/api/**/route.ts`.
Do not call `new Response(...)` directly from API routes unless the route is a
documented streaming exception. The current documented exception is
`/api/agents/activity`, where the route returns a server-sent event stream and
`withApiTelemetry(...)` applies the response headers at finalization.

The regression test `tests/api-security-headers.test.ts` enforces both runtime
header behavior and the static direct-response guard.

Rollback is straightforward: revert the route migration and helper changes
together. Do not remove the static guard unless an explicit exception is added
to this runbook and the test allowlist.
