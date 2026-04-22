# Command Center Operator Walkthrough

## Purpose

This walkthrough captures the primary operator flows that the command center is expected to support for `F10-T1` and `F10-T2`.

## Preconditions

- the dashboard is unlocked
- at least one actionable request has been created
- the dashboard contains approval, failure, or blocked-work signals

## Walkthrough 1: Exception-First Triage

1. Land on the dashboard.
2. Confirm the command center appears before the rest of the operating sections.
3. Review the topline counts for blocked work, approvals, and failures.
4. Use the next-best-action control to jump directly into the highest-leverage remediation path.
5. Verify the target section is highlighted and the selected item is visible.

Expected outcome:

- the operator reaches the remediation section without scanning the rest of the page first
- the deep link carries the operator directly to the relevant item

## Walkthrough 2: Communications Wedge

1. Switch to the `Communications` role lens.
2. Confirm the role card changes to communications-focused copy and actions.
3. Open the `Approvals inbox` focus area.
4. Verify the shell routes into the approvals section and highlights the current item.

Expected outcome:

- communications operators stay inside an inbox-and-approvals loop without navigating through generic summaries

## Walkthrough 3: Executive Review

1. Switch to the `Executive` role lens by keyboard focus and activation.
2. Confirm the tab becomes selected and the tabpanel updates.
3. Review the executive summary chips and focus areas.

Expected outcome:

- leadership checks are visible as a focused lens rather than a separate dashboard
- keyboard-only activation remains functional

## Responsive and Accessibility Notes

The verified responsive/accessibility expectations for this slice are:

- mobile viewport keeps the topline metrics in a stacked single column
- role tabs remain reachable and activatable by keyboard
- actionable cards keep visible focus outlines
- the role lens uses tablist, tab, and tabpanel semantics

## Evidence Captured

The current code-backed evidence for this walkthrough is:

- `tests/e2e/dashboard-command-center.spec.ts`
  - deep-link remediation flow
  - communications wedge flow
  - mobile stacked-layout assertion
  - keyboard activation of the executive role and next-best-action
- `tests/dashboard-command-center.test.tsx`
  - exception-first render assertions
  - role defaulting assertions
  - accessibility semantics assertions
- `tests/core-loop-route.test.ts`
  - role-change telemetry
  - decision and recovery-start telemetry
