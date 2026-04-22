# Workflow Responsibility Model

`LEO-164` makes ownership, delegation, handoff, review, and escalation explicit on core workflow objects instead of leaving those semantics implicit in status strings.

## Boundary

Inputs:
- user goal requests
- workspace governance context
- planned task and approval metadata
- autopilot event requests
- approval responses

Outputs:
- explicit responsibility objects on goals, tasks, approvals, and autopilot events
- persisted handoff and escalation state in repository storage
- operator-visible responsibility state in workflow panels

Trust levels:
- user requests and route input are untrusted until validated at the API boundary
- stored workflow records are trusted only after schema validation
- system delegates such as workflow lanes and autopilot are trusted execution actors, not trust-boundary shortcuts

## Object Semantics

Goal:
- owner: requesting user
- reviewer: goal reviewer or workspace owner boundary
- escalation owner: explicit human fallback for unresolved exceptions
- meaning: the goal keeps top-level accountability even when child objects delegate work

Task:
- owner: goal owner
- delegate: assigned execution lane
- reviewer: set when policy requires approval
- meaning: task ownership stays human-accountable while active execution can be delegated safely

Approval:
- owner: goal owner
- delegate: preparing execution lane when present
- reviewer: explicit approval reviewer
- meaning: approval objects record who must decide before side effects can continue

Autopilot event:
- owner: autopilot owner
- delegate: autopilot processor
- reviewer: required for notify-only flows
- meaning: autopilot work still carries explicit fallback accountability

## Handoff States

- `owner_control`: the owner still holds direct control
- `delegated`: execution has been handed to a delegate
- `review_pending`: execution is blocked on reviewer action
- `escalated`: normal ownership has been superseded by an escalation path
- `returned_to_owner`: delegated or staged work has been rejected and handed back

## State Transitions

Creation:
- goals start in `owner_control`
- tasks start in `delegated` or `review_pending` based on approval requirements
- approvals start in `review_pending`
- autopilot events start in `delegated` or `review_pending` based on mode

Approval response:
- approved tasks and approvals move to `delegated`
- rejected tasks and approvals move to `returned_to_owner`
- the actor that changed the handoff is recorded in `lastChangedBy`

Escalation:
- escalations must set an explicit escalation owner
- escalation reasons must be captured when escalation occurs
- audit rules require actor context so the boundary decision is attributable

## Audit Requirements

Every responsibility record carries audit policy:
- required events: delegation change, handoff acceptance, review assignment, escalation trigger
- actor context required
- delegation reason required
- escalation reason required
- reviewer identity required

This keeps accountability machine-readable across persistence and UI surfaces.

## Validation

Run:

```bash
npx vitest run tests/repository.test.ts tests/goal-detail-panel.test.tsx tests/approval-detail-panel.test.tsx tests/execution.test.ts
```
