# Command Center

## Purpose

The command center is the dashboard's exception-first landing shell. It exists to reduce time-to-decision by surfacing blocked work, approvals, failures, and the next safe remediation step before broad summary content.

## Inputs and Outputs

### Inputs

- the current `DashboardData` snapshot
- the selected operator product, when present
- local UI state for the selected role lens

### Outputs

- a landing shell that ranks immediate exceptions
- deep links into the existing dashboard sections
- role-aware views for `Command`, `Communications`, and `Executive`
- command-center telemetry events routed through `/api/dashboard/core-loop`

## Trust Boundaries

### Trusted

- server-derived dashboard data
- server-side telemetry aggregation

### Untrusted

- any user-generated content already present inside dashboard payloads
- browser event timing and interaction order

The command center does not add new mutation endpoints. It reuses existing section-level remediation paths and sends bounded telemetry payloads through schema validation.

## Layout Hierarchy

The shell is intentionally ordered by operational leverage:

1. topline counts for blocked work, approvals, and failures
2. the next-best-action entry point
3. the immediate exception list
4. role-aware views for focused operator wedges
5. the existing dashboard sections below the shell

This hierarchy is the core non-negotiable behavior for `F10-T1`. Summary content may exist lower in the page, but it must not displace active failures or decisions from the landing surface.

## Role-Aware Views

### Command

- default operating lens when no specialized pack is active
- optimized for blocked work, queue recovery, and trust degradations

### Communications

- default lens when the `communications-operator` pack is selected
- optimized for approvals inbox, follow-up queue, and operator-pack setup

### Executive

- focused on cross-queue posture, escalation visibility, and leadership checks

Shared rendering primitives stay reusable across roles:

- role tabs
- stat chips
- action buttons
- focus cards

The view model owns the role-specific copy and targets so the React component stays generic.

## Deep-Link Contract

Every command-center action must route into an existing section-level remediation path instead of inventing a parallel flow. The command center may prioritize work, but it should not fork the execution model.

Current deep-link targets include:

- `approvals`
- `operations`
- `now`
- `operator-products`

## Telemetry Contract

The shell currently emits these event shapes through `/api/dashboard/core-loop`:

- `dashboard_view`
- `command_center_role_change`
- `command_center_action`

The API records:

- total role changes
- total command-center actions
- time-to-role-change
- time-to-decision
- time-to-recovery-start

Recovery-start metrics are intentionally limited to `next_best_action` and `priority` clicks so exploratory role browsing does not pollute recovery timing.

## Accessibility and Responsive Contract

The command center must remain operable with mouse, touch, and keyboard:

- role controls are exposed as a tablist with tabs and a labelled tabpanel
- actionable cards remain native buttons
- focus-visible outlines are always present for keyboard users

Responsive behavior is optimized for a narrow mobile stack:

- topline metrics collapse to a single column below `1100px`
- role tabs and role actions become full-width stacked buttons below `640px`
- priority and focus headers collapse vertically to avoid truncation

## Non-Goals

- no new backend mutation surface
- no per-role hard-coded components
- no hidden remediation state outside the existing dashboard sections
- no unbounded landing-shell queue growth; surfaced priorities stay capped

## Verification Evidence

Code and test evidence for this slice lives in:

- `tests/dashboard-command-center.test.tsx`
- `tests/core-loop-route.test.ts`
- `tests/e2e/dashboard-command-center.spec.ts`
- `apps/web/components/dashboard-command-center.tsx`
- `apps/web/lib/command-center.ts`
- `apps/web/app/api/dashboard/core-loop/route.ts`
