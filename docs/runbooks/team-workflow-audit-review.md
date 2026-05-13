# Team Workflow Audit Review

This runbook captures the validation matrix and release evidence for shared-team workflow controls, with emphasis on delegated actions that stay visible to collaborators but remain owner-controlled at mutation time.

## Validation Matrix

| Workflow surface | Expected boundary | Coverage |
| --- | --- | --- |
| Ownership and membership changes | Only workspace owners can add collaborators or change governed workspace posture. | [`tests/route-user-scope.test.ts`](tests/route-user-scope.test.ts) |
| Shared approval decisions | Editors and viewers may inspect shared approvals, but only the workspace owner may approve or reject them. | [`tests/repository.test.ts`](tests/repository.test.ts), [`tests/route-user-scope.test.ts`](tests/route-user-scope.test.ts) |
| Shared workflow watchers | Editors may create, pause, and resume shared watchers. Viewers may inspect them, but watcher mutations must fail closed at the route boundary and stay visibly disabled in the dashboard. | [`tests/watchers-route.test.ts`](tests/watchers-route.test.ts), [`tests/dashboard-watcher-permissions.test.tsx`](tests/dashboard-watcher-permissions.test.tsx) |
| Shared autopilot event triggers | Editors may trigger watcher-backed automation for shared work. Viewers may inspect the event history, but route-level event creation must return `403` before any job is enqueued. | [`tests/autopilot-route.test.ts`](tests/autopilot-route.test.ts) |
| Shared queue delivery paths | Slack and Telegram callbacks acknowledge forbidden shared approval attempts without retry storms or side-effect jobs. | [`tests/slack-webhook-route.test.ts`](tests/slack-webhook-route.test.ts), [`tests/telegram-webhook-route.test.ts`](tests/telegram-webhook-route.test.ts) |
| Role-filtered content and audit exports | Collaborators can review the active shared workspace export without leaking the owner's personal workspace audit artifacts. | [`tests/governance-audit-route.test.ts`](tests/governance-audit-route.test.ts) |

## Permission Matrix

| Surface | Owner | Editor | Viewer |
| --- | --- | --- | --- |
| Shared approvals | approve or reject | inspect only | inspect only |
| Shared watchers | create and mutate | create and mutate | inspect only |
| Shared autopilot event triggers | trigger | trigger | inspect only |
| Workspace governance and membership | mutate | inspect and escalate | inspect and escalate |
| Audit export | export | export | export |

There is no collaborator-side break-glass override for these controls. The only supported break-glass path is owner-authenticated action through the same audited HTTP or callback boundary that enforces the normal role checks. If an editor or viewer needs a blocked action cleared urgently, the system must escalate to the owner instead of widening permissions locally.

## Delegated Action Audit Review Procedure

1. Confirm the acting principal resolved through the route boundary and that request bodies passed strict schema validation.
2. Confirm the approval is visible to the acting principal through the repository scope filter.
3. For workspace-scoped goals, confirm the acting principal is recorded as the workspace owner before mutating approval state.
4. For shared watchers and autopilot triggers, confirm editors retain the intended execution path while viewers receive `403` before watcher state or queued work changes.
5. Confirm the dashboard still shows blocked watcher controls with inline reason text so collaborators can see the boundary instead of guessing at missing controls.
6. Confirm denied collaborator attempts leave approvals pending, watcher state unchanged, and no approval evidence or follow-up jobs appended.
7. Confirm the owner-authenticated path still records the approval decision, evidence record, and downstream follow-up job as expected.
8. For shared delivery channels, confirm forbidden attempts are acknowledged as terminal so Slack and Telegram do not retry the same callback indefinitely.
9. Export the active workspace audit view and verify that role-filtered users do not inherit owner-personal artifacts from unrelated workspaces.

## Spot-Check Results

- Shared approval responses now fail closed for non-owner collaborators with a repository-level `forbidden` error and route-level `403`.
- Shared watcher mutations now fail closed for viewers at the route boundary while the dashboard keeps the Pause and Resume controls visible, disabled, and annotated with the deny reason.
- Shared watcher-backed autopilot triggers now allow editors and owners but reject viewers before any event job is enqueued.
- Shared approval denials preserve the pending approval state and do not create approval evidence until the owner responds.
- Slack and Telegram callbacks now acknowledge forbidden shared approval attempts with `reason: "forbidden"` and do not enqueue follow-up jobs.
- Shared workspace audit exports remain scoped to the selected shared workspace and exclude owner-personal audit operations from collaborator views.

## Release Checklist Update

- Verify the shared approval owner boundary with the repository and route regression tests before release.
- Verify the shared watcher and shared autopilot viewer denial paths with both route tests and the dashboard permission render test before release.
- Verify Slack and Telegram callback denial paths stay non-retrying for forbidden shared approval actions.
- Spot-check one collaborator audit export from a shared workspace to confirm role-filtered privacy still excludes owner-personal records.
- Treat any regression that allows non-owner approval mutation or cross-workspace audit leakage as a release blocker.
