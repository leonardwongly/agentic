# Workflow Responsibility Audit Checklist

Use this checklist when reviewing delegation, handoff, and escalation behavior for `LEO-164`.

- Goal, task, approval, and autopilot event records all carry a validated responsibility object.
- Each responsibility object defines owner, reviewer, escalation owner, and handoff status.
- Delegated execution records identify the concrete system delegate or workspace role.
- Approval-gated work uses `review_pending` instead of an implicit waiting state alone.
- Approval responses update handoff status and `lastChangedBy`.
- Delegation changes capture a delegation reason.
- Escalation paths capture an escalation reason before promotion to escalated handling.
- Audit requirements remain visible in operator-facing surfaces.
- Repository persistence round-trips responsibility data without dropping fields.
- Legacy records still parse through deterministic schema defaults.
