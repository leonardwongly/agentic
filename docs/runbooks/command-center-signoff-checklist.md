# Command Center Sign-Off Checklist

## Purpose

This checklist is the handoff artifact for `LEO-116` (`F10 Rebuild the dashboard as an exception-first operator command center`). It separates what is already verified in code from the explicit Web Product, QA, and Release acknowledgements that still need a human owner.

## Scope Covered by This Checklist

- exception-first landing shell
- role-aware operator views
- deep links into remediation sections
- shell-effectiveness telemetry
- responsive and keyboard-operable command-center behavior

## Checked-In Design and Walkthrough Artifacts

Review these before sign-off:

- `docs/specs/command-center.md`
- `docs/runbooks/command-center-operator-walkthrough.md`

## Code and Test Evidence

The current implementation evidence lives in:

- `apps/web/components/dashboard-command-center.tsx`
- `apps/web/lib/command-center.ts`
- `apps/web/lib/core-loop-client.ts`
- `apps/web/app/api/dashboard/core-loop/route.ts`
- `tests/dashboard-command-center.test.tsx`
- `tests/core-loop-route.test.ts`
- `tests/e2e/dashboard-command-center.spec.ts`

## Verification Commands

Run these commands from the repository root:

```bash
cd /Users/leonardwongly/.codex/worktrees/c9fe/Agentic
npm run test -- tests/core-loop-route.test.ts tests/dashboard-command-center.test.tsx tests/dashboard-advanced-operations-card.test.tsx
npm run test:e2e -- tests/e2e/dashboard-command-center.spec.ts
npm run build -w @agentic/web
```

Expected outcome:

- unit and route telemetry tests pass
- command-center E2E passes for deep-link, communications, mobile, and keyboard flows
- production web build completes successfully

## Functional Checks

Mark each item once reviewed:

- [ ] The command center appears above the broader dashboard sections.
- [ ] Blocked work, approvals, and failures are visible without scrolling into lower summary surfaces.
- [ ] The next-best-action control routes directly into the highest-leverage remediation section.
- [ ] Immediate exceptions are capped and prioritized rather than dumping the full queue.
- [ ] Communications, Command, and Executive views each show focused copy and actions.
- [ ] Role switching updates the visible wedge without introducing a separate dashboard path.
- [ ] Command-center actions deep-link into the existing remediation sections rather than creating parallel flows.

## Accessibility and Responsive Checks

- [ ] The role switcher exposes `tablist`, `tab`, and `tabpanel` semantics.
- [ ] All command-center controls remain keyboard reachable and activatable.
- [ ] Focus-visible outlines are present for keyboard users.
- [ ] On a narrow mobile viewport, topline metrics stack vertically and remain readable.
- [ ] On a narrow mobile viewport, role tabs and role actions remain full-width and usable.

## Telemetry Checks

- [ ] `dashboard_view` continues to emit for dashboard entry.
- [ ] `command_center_role_change` emits when switching wedges.
- [ ] `command_center_action` emits for next-best-action, priority, role-action, and focus-area clicks.
- [ ] `product.command_center.time_to_decision_ms` is recorded for operator action timing.
- [ ] `product.command_center.time_to_recovery_start_ms` is recorded only for recovery-start actions.

## Sign-Off Owners

Record the explicit owner acknowledgement here or in Linear before closing `LEO-116`:

- [ ] Web Product sign-off
- [ ] QA sign-off
- [ ] Release sign-off

## Close Criteria

`LEO-116` is ready to move from `In Progress` to `Done` when:

1. the verification commands above pass on the intended release candidate
2. the checklist items are reviewed
3. Web Product, QA, and Release sign-off are explicitly recorded
