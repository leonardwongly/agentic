# Team Workflow Handoffs

## Purpose

This runbook documents how shared operator work should move between the owner, editor, and viewer lanes in the dashboard without creating silent ownership gaps.

## Queue lanes

- `Mine`: The work the current role is expected to clear next. Owners hold policy approvals; editors hold execution-first queue work and recovery.
- `Delegated`: Work intentionally routed to another lane. Owners delegate execution to editors; editors delegate policy decisions back to owners.
- `Escalated`: Approvals or connector issues that breached their expected response window and should move back to the owner boundary.
- `Blocked`: Async recovery issues and blocked commitments that cannot progress without explicit intervention.
- `Waiting`: Work that is still inside SLA but cannot move until a scheduled dependency or bounded approval decision completes.

## Handoff rules

1. Work the active lane in queue order before pulling in ad hoc requests.
2. Escalate policy decisions to the owner boundary instead of routing around approvals.
3. Keep execution recovery with the editor lane until async health is stable again.
4. Rebalance ownership through workspace membership and role boundaries instead of informal side-channel assignments.
5. Export audit evidence after major handoffs or escalations so the next operator can verify the chain of custody.

## Role responsibilities

- Owner:
  Holds membership, governance, privacy lifecycle controls, and overdue approval escalation.
- Editor:
  Owns shared execution flow, queue triage, and recovery of degraded execution paths.
- Viewer:
  Reviews evidence, identifies the highest-signal blocker, and escalates rather than acting as the authority.

## SLA interpretation

- Approvals older than six hours should be treated as breached for the shared-team operating loop.
- A blocked queue with stale async recovery should be treated as critical even if individual commitments are still pending.
- Waiting work is acceptable only while it remains inside the documented approval and dependency window.
