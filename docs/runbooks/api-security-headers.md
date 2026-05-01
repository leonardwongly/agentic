# API Security Headers

All JSON and file-style API responses must be returned through the helpers in
`apps/web/lib/api-response.ts`. The helpers apply:

- base browser security headers from `apps/web/lib/security-headers.ts`
- request correlation headers
- no-store cache headers appropriate to authenticated or operational surfaces

## Required Helpers

- `authenticatedJson` for session or access-key authenticated JSON responses
- `authenticatedResponse` for authenticated file/export responses
- `authenticatedRedirect` for authenticated redirects
- `operationalJson` for unauthenticated operational acknowledgements such as signed webhooks
- `operationalResponse` for unauthenticated non-JSON operational responses
- `handleApiError` and `handleOperationalApiError` for error normalization

Do not construct `NextResponse.json`, `Response.json`, or ordinary API `new Response`
responses directly inside `apps/web/app/api/**/route.ts` unless the response has a
documented exception.

## Documented Exceptions

- `apps/web/app/api/agents/activity/route.ts` constructs a raw `Response` for
  server-sent events because it must preserve a live `ReadableStream` body plus
  `text/event-stream`, `Connection`, and buffering headers. The route is wrapped in
  `withApiTelemetry`, which applies the base API security headers before returning.

## Validation

Run the focused AOS-07 guard with:

```bash
npm exec -- vitest run tests/api-security-headers.test.ts
```

Run the broader regression suite with:

```bash
npm run test:security:regression
```
