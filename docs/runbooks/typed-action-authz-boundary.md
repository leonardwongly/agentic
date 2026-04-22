# Typed Action Authorization Boundary

This runbook defines the approval, authorization, and capability checks that must hold before any typed action reaches a side-effecting adapter.

## Supported Action Families

The current minimum typed action families for the production wedges are:

| Action family | Contract schema | Adapter boundary | Minimum capabilities | Approval expectation | Current wedge use |
| --- | --- | --- | --- | --- | --- |
| `send_message` | [`SendMessageActionIntentSchema`](/Users/leonardwongly/.codex/worktrees/24f9/Agentic/packages/contracts/src/index.ts) | Gmail draft/send calls in [`executeApprovedTask(...)`](/Users/leonardwongly/.codex/worktrees/24f9/Agentic/packages/orchestrator/src/execution-dispatch.ts) | `draft` or `send` | approved typed approval required | communications follow-up and reply drafts |
| `schedule_event` | [`ScheduleEventActionIntentSchema`](/Users/leonardwongly/.codex/worktrees/24f9/Agentic/packages/contracts/src/index.ts) | Calendar event creation in [`executeApprovedTask(...)`](/Users/leonardwongly/.codex/worktrees/24f9/Agentic/packages/orchestrator/src/execution-dispatch.ts) | `schedule` | approved typed approval required | calendar commitments and handoff scheduling |
| `create_note` | [`CreateNoteActionIntentSchema`](/Users/leonardwongly/.codex/worktrees/24f9/Agentic/packages/contracts/src/index.ts) | Local notes creation in [`executeApprovedTask(...)`](/Users/leonardwongly/.codex/worktrees/24f9/Agentic/packages/orchestrator/src/execution-dispatch.ts) | `create` | approved typed approval required | workspace note creation and execution artifacts |
| `manual_review` | [`ManualReviewActionIntentSchema`](/Users/leonardwongly/.codex/worktrees/24f9/Agentic/packages/contracts/src/index.ts) | no side effect; dispatcher returns `execution.skipped` | none | used when typed payload is absent or not trusted | fail-closed fallback for untyped approvals |

Anything outside this set must be rejected by the action-intent contract rather than accepted as a free-form stringly typed payload.

## Purpose

Typed actions are the highest-risk execution path in Agentic because they can drive email, calendar, and workspace side effects. The boundary is intentionally fail-closed: if the system cannot prove ownership, approval state, and capability compatibility from trusted server-side state, the action must degrade to `manual_review` or `execution.skipped`.

## Contract Reference

The canonical enforcement code lives in:

- [`packages/orchestrator/src/execution-dispatch.ts`](/Users/leonardwongly/.codex/worktrees/24f9/Agentic/packages/orchestrator/src/execution-dispatch.ts)
- [`packages/repository/src/index.ts`](/Users/leonardwongly/.codex/worktrees/24f9/Agentic/packages/repository/src/index.ts)
- [`apps/web/app/api/approvals/[id]/respond/route.ts`](/Users/leonardwongly/.codex/worktrees/24f9/Agentic/apps/web/app/api/approvals/[id]/respond/route.ts)

The dispatcher owns the last side-effect boundary. Repository methods own user and workspace visibility. Request handlers only authenticate the caller, normalize input, and delegate to those trusted boundaries.

## Inputs, Outputs, and Trust Levels

Inputs:

- authenticated approval responses from HTTP routes
- persisted goal bundles, approvals, and task capability grants
- assigned agent definitions and allowlists
- typed action payloads attached to approved approvals

Outputs:

- adapter calls for Gmail, calendar, or workspace side effects
- `execution.completed` or `execution.skipped` worker results
- approval decision history and evidence records
- queued approval follow-up jobs

Trust levels:

- HTTP params and JSON bodies are untrusted until parsed
- client claims about ownership, permissions, or approval state are never trusted
- persisted repository state is trusted after user/workspace visibility checks
- typed execution payloads are only trusted when they come from an approved persisted approval

## Enforcement Rules

Every typed action must satisfy all of the following rules before adapter execution.

1. The caller must be authenticated at the route boundary.
   - [`requireApiSession(...)`](/Users/leonardwongly/.codex/worktrees/24f9/Agentic/apps/web/app/api/approvals/[id]/respond/route.ts) resolves the principal.
   - Request bodies are parsed through a strict schema. Unknown fields are rejected.

2. The approval must be visible to the authenticated user.
   - [`respondToApproval(...)`](/Users/leonardwongly/.codex/worktrees/24f9/Agentic/packages/repository/src/index.ts) scopes approvals through goal visibility for the acting user.
   - Hidden or foreign approvals fail as `not_found`, which the route maps to HTTP `404`.
   - Shared workspace approvals remain owner-controlled even when editors or viewers can inspect the queue. Non-owner responses fail as `forbidden`, which the route maps to HTTP `403`.

3. Only an approved approval may authorize typed execution.
   - [`findApprovedApproval(...)`](/Users/leonardwongly/.codex/worktrees/24f9/Agentic/packages/orchestrator/src/execution-dispatch.ts) ignores pending and rejected approvals.
   - If no approved typed approval exists, dispatch falls back to `manual_review` or returns `execution.skipped`.

4. The requested typed action must fit within the task capability grant.
   - [`requiredCapabilitiesForActionIntent(...)`](/Users/leonardwongly/.codex/worktrees/24f9/Agentic/packages/orchestrator/src/execution-dispatch.ts) derives the minimum capability set for each supported action family.
   - [`validateTypedActionBoundary(...)`](/Users/leonardwongly/.codex/worktrees/24f9/Agentic/packages/orchestrator/src/execution-dispatch.ts) rejects the action if the task grant does not cover those capabilities.

5. The assigned agent allowlist must still permit the granted capabilities.
   - The same boundary check re-validates the task grant against the assigned agent allowlist through the integrations capability guard.
   - This prevents confused-deputy execution when an upstream task record is broader than the agent that was actually selected to execute it.

6. Approvals without a typed payload must not trigger inferred side effects.
   - [`buildFallbackApprovalActionIntent(...)`](/Users/leonardwongly/.codex/worktrees/24f9/Agentic/packages/repository/src/index.ts) converts those approvals into explicit `manual_review`.
   - The reason text states that the action requires manual review before any side effect.

7. Built-in agents may only emit typed payloads from explicit validated execution cues.
   - [`runAgent(...)`](/Users/leonardwongly/.codex/worktrees/24f9/Agentic/packages/agents/src/index.ts) only synthesizes `send_message` and `schedule_event` intents when the normalized request contains explicit labeled fields that pass [`ActionIntentSchema`](/Users/leonardwongly/.codex/worktrees/24f9/Agentic/packages/contracts/src/index.ts) validation.
   - Communications and calendar scaffolds must stay on `manual_review` when the request is missing a complete, machine-validated recipient, subject, body, or schedule window.
   - [`processUserRequest(...)`](/Users/leonardwongly/.codex/worktrees/24f9/Agentic/packages/orchestrator/src/index.ts) passes the normalized request through to agent execution so this validation runs on the real user request, not only the catalog title.

## Decision Tree

Use this decision path whenever a typed action is about to execute:

1. Confirm the approval response request is authenticated and schema-valid.
2. Confirm the approval is visible to the acting user.
3. If the goal is workspace-scoped, confirm the acting user is the workspace owner before mutating the approval.
4. Confirm the persisted approval is `approved`.
5. Confirm the approval carries a typed `actionIntent`.
6. Derive the required capabilities for that action family.
7. Confirm the task capability grant covers the required capabilities.
8. Confirm the assigned agent allowlist also permits that grant.
9. Only then invoke the typed adapter.

If any step fails:

- do not attempt a side effect
- return `execution.skipped` or `manual_review`
- preserve the task and approval state for operator inspection

## Failure Handling Rules

The boundary is intentionally conservative:

- out-of-scope approvals fail as `404` rather than disclosing existence
- visible shared-team approvals still fail closed as `403` when a non-owner attempts to clear them
- duplicate approval responses fail as `409`
- missing approved typed approvals do not fall through into inferred adapter calls
- partially specified communications or calendar requests do not get upgraded into guessed typed payloads
- incompatible task grants and agent allowlists do not partially execute
- approvals without typed payloads degrade to `manual_review`

The correct fix for a violation is to harden the trusted boundary, not to add UI hints or client-side checks.

## Audit and Evidence

Approval responses write durable evidence records after a successful repository mutation:

- source kind: `approval_response`
- decision, scope, and rationale
- resulting task and goal states
- actor context

This evidence lives behind the same user visibility boundary as the goal and approval. Users without access to the underlying goal cannot read those records.

## Validation Evidence

The current regression coverage for this boundary lives in:

- [`tests/execution-dispatch.test.ts`](/Users/leonardwongly/.codex/worktrees/24f9/Agentic/tests/execution-dispatch.test.ts)
  - approved typed execution happy paths for `send_message`, `schedule_event`, and `create_note`
  - fallback to `manual_review` when no approved typed approval exists
  - skip when a typed action exceeds the task capability grant
  - skip when the task grant violates the assigned agent allowlist
- [`tests/action-intent-contract.test.ts`](/Users/leonardwongly/.codex/worktrees/24f9/Agentic/tests/action-intent-contract.test.ts)
  - accepts the four supported action families
  - rejects unknown action families
  - rejects malformed schedule windows
  - rejects extra fields and malformed recipient payloads
- [`tests/agents.test.ts`](/Users/leonardwongly/.codex/worktrees/24f9/Agentic/tests/agents.test.ts)
  - built-in communications and calendar agents stay scaffold-only when explicit execution cues are absent
  - built-in communications and calendar agents only emit typed payloads when labeled request fields validate
  - workflow scaffolds keep emitting typed note payloads only when the task already owns `create`
- [`tests/orchestrator.test.ts`](/Users/leonardwongly/.codex/worktrees/24f9/Agentic/tests/orchestrator.test.ts)
  - inbox triage stays fail-closed without explicit communications cues
  - explicit communications cues promote inbox triage approvals into typed `send_message` previews
  - explicit calendar cues promote weekly-planning approvals into typed `schedule_event` previews
- [`tests/repository.test.ts`](/Users/leonardwongly/.codex/worktrees/24f9/Agentic/tests/repository.test.ts)
  - durable approval evidence capture
  - fallback approval previews for `manual_review`
  - cross-user denial when responding to another user's approval
  - owner-only responses for shared workspace approvals while editors and viewers stay read-only
- [`tests/route-user-scope.test.ts`](/Users/leonardwongly/.codex/worktrees/24f9/Agentic/tests/route-user-scope.test.ts)
  - system-user attribution for approval responses
  - `404` mapping for out-of-scope approvals
  - `403` mapping for visible but owner-restricted shared approvals
  - `409` mapping for already-handled approvals
- [`tests/nl-intent-route.test.ts`](/Users/leonardwongly/.codex/worktrees/24f9/Agentic/tests/nl-intent-route.test.ts)
  - approval listing and action surfaces remain user-scoped

The focused validation command for this slice is:

```bash
npx vitest run tests/agents.test.ts tests/orchestrator.test.ts tests/action-intent-contract.test.ts tests/execution-dispatch.test.ts
npm run build -w @agentic/web
```

## Operator Guidance

When a typed action does not execute, inspect the approval and task state before retrying anything manually.

- If the approval is still pending or rejected, do not attempt the side effect.
- If the approval is approved but the action fell back to `manual_review`, inspect the missing typed payload or capability mismatch.
- If the task grant and agent allowlist disagree, fix the policy or task assignment first.
- If ownership or visibility is wrong, correct the workspace or goal access boundary instead of overriding the route.
