# Adapter Conformance Checklist

This runbook defines the minimum conformance bar for typed-action adapters that execute Phase 3 governed side effects.

## Boundary

Inputs:
- `Task` records from the repository
- validated `ActionIntent` payloads from approved approvals
- adapter implementations passed into the execution runtime

Outputs:
- an `ActionExecutionPlan` with preview, dry-run, idempotency, and recovery metadata
- an `ActionExecutionOutcome` with normalized completion or failure semantics
- execution logs emitted by the orchestrator

Trust levels:
- approval payloads are only trusted after contract validation and approval-state checks
- adapter implementations are trusted code, but their network and filesystem effects are failure-prone
- connector responses and thrown errors are untrusted and must be normalized before the runtime acts on them

## Required Contract

Every typed-action adapter path must satisfy the shared contract exported from [`packages/contracts/src/index.ts`](https://github.com/leonardwongly/agentic/blob/main/packages/contracts/src/index.ts) and implemented through [`packages/integrations/src/action-execution.ts`](https://github.com/leonardwongly/agentic/blob/main/packages/integrations/src/action-execution.ts).

Required plan fields:
- `adapter`
- `operation`
- `preview`
- `dryRunSummary`
- `idempotencyKey` for real side effects
- `sideEffectTarget` for real side effects
- `recovery`

Required outcome fields:
- `status`
- `detail`
- `retryable`
- `idempotencyKey`
- `sideEffectTarget`
- `providerRef` when the provider returns a durable identifier
- `recovery`

## Idempotency Rules

- Real side effects must reuse the same `idempotencyKey` for identical `Task` + `ActionIntent` inputs.
- `sideEffectTarget` must identify the external or local resource that the adapter will mutate.
- `manual_review` intents must not fabricate an idempotency key.
- New adapters must avoid keys derived from timestamps, random UUIDs, or mutable ambient state.

## Dry-Run Rules

- Approval preview and execution dry-run text must come from the same shared planning path.
- A preview must describe the exact typed side effect that execution will attempt.
- Adapters must not maintain a second preview formatter that can drift from the execution contract.

## Retry And Recovery Rules

- Connector timeouts, rate limits, and equivalent transport failures should normalize to `retryable: true` with `recovery.strategy = "retry"`.
- Missing adapters or explicit `manual_review` intents should normalize to `status = "skipped"`.
- Local or non-idempotent failures that need human inspection should normalize to `recovery.strategy = "manual_review"`.
- Partial success must be explicit. If a provider-side precursor succeeds but the terminal side effect fails, return `status = "partial_success"` with:
  - the provider reference for the created resource
  - operator-facing compensation hints
  - a recovery strategy that matches the remaining safe action

## Current Canonical Semantics

- `send_message`
  - draft mode: `create_draft`
  - send mode: draft first, then delivery
  - delivery failure after draft creation: `partial_success`, retryable, with a review-the-draft compensation hint
- `schedule_event`
  - connector failures are retryable when normalized as transport or provider throttling failures
- `create_note`
  - local write failures stay in `manual_review` rather than blind retry
- `manual_review`
  - no adapter side effect, always `skipped`

## Acceptance Checklist For New Adapters

- Add or update the typed `ActionIntent` contract.
- Implement the adapter through the shared execution seam instead of a one-off call path.
- Emit stable idempotency and side-effect metadata.
- Reuse the shared preview path for approval and execution dry-run copy.
- Normalize connector failures through shared connector error handling when network I/O is involved.
- Add contract tests for:
  - happy path
  - duplicate invocation stability
  - connector timeout or throttling
  - invalid or missing adapter path
  - partial success if the adapter has a multi-step side effect

## Validation Commands

Run the focused contract and orchestration regressions from the repo root:

```bash
npx vitest run tests/action-execution-contract.test.ts tests/execution-dispatch.test.ts tests/orchestrator.test.ts tests/connector-failure-semantics.test.ts
npm run build -w @agentic/web
```
