# Governed API Route Checklist

Use this checklist when adding or migrating mutating API routes. The governed
route wrapper is a boundary helper, not a replacement for route-specific domain
authorization.

## Wrapper Contract

`apps/web/lib/governed-route.ts` composes the common controls expected on
authenticated mutating API routes:

- telemetry and request correlation through `withApiTelemetry`
- principal resolution through `requireApiSession`
- actor attribution through `createActorContextFromPrincipal`
- optional route-scoped abuse rate limiting
- strict JSON body validation through `parseJsonBody`
- optional `x-idempotency-key` parsing and validation
- safe error conversion through `handleApiError`

Handlers still own resource authorization and invariants. Keep user and
workspace checks in the route or repository call that has the necessary domain
context. Do not trust client-supplied user, workspace, tenant, role, or owner
claims.

## Migration Checklist

Before migrating a route:

- classify the mutation side effect: internal state, durable job, external
  send, public disclosure, provider credential, or webhook callback
- confirm the route has a strict Zod schema for every JSON body it accepts
- identify the user-scoped or workspace-scoped repository call that enforces
  ownership
- decide whether a route-specific abuse rate limit is needed
- decide whether `x-idempotency-key` is optional, required, or unsupported
- confirm whether the route has durable replay protection before documenting it
  as idempotent
- preserve existing status codes and error messages unless the change is an
  intentional hardening fix
- preserve authenticated no-store headers on every success and error path

After migrating a route:

- add or update tests for missing auth, invalid JSON, unknown fields, invalid
  idempotency key, and not-owned resources
- add rate-limit tests when a namespace is configured
- add duplicate/retry tests only when durable idempotency semantics exist
- run the route-specific test file plus `tests/api-validation.test.ts`
- run `npm run test:security:regression` for externally reachable or
  privileged routes

## Current Pilot Coverage

The first AOS-01 migration applies the wrapper to:

- `POST /api/approvals/[id]/respond`
- `POST /api/goals/[id]/share`
- `DELETE /api/goals/[id]/share`
- `POST /api/governance`

The wrapper now validates optional `x-idempotency-key` headers for these
mutations and applies route-scoped abuse limits. It does not make governance
updates or share creation response-replay idempotent; those routes still rely on
their existing domain behavior.

The W05 recovery API hardening applies the wrapper to:

- `POST /api/operations/recovery`

This route uses the `operations-recovery` abuse namespace and keeps domain
authorization in `apps/web/lib/operations-recovery.ts`. Job recovery remains
user and workspace-owner scoped, connector recovery redacts stored secrets, and
manual connector remediation records bounded `metadata.recoveryAudit` entries.

## Follow-up Candidates

Prioritize these surfaces next:

- Slack and Telegram webhooks, because they are externally reachable and mutate
  approval state
- async job enqueue routes that already support durable idempotency
- external notification routes that send through third-party providers
- workflow-template and agent editor routes that need consistent mutation
  preconditions
