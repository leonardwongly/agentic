# Team Workflow Audit Review

This runbook captures the validation matrix and release evidence for shared-team workflow controls, with emphasis on delegated actions that stay visible to collaborators but remain owner-controlled at mutation time.

## Validation Matrix

| Workflow surface | Expected boundary | Coverage |
| --- | --- | --- |
| Ownership and membership changes | Only workspace owners can add collaborators or change governed workspace posture. | [`tests/route-user-scope.test.ts`](/Users/leonardwongly/.codex/worktrees/24f9/Agentic/tests/route-user-scope.test.ts) |
| Shared approval decisions | Editors and viewers may inspect shared approvals, but only the workspace owner may approve or reject them. | [`tests/repository.test.ts`](/Users/leonardwongly/.codex/worktrees/24f9/Agentic/tests/repository.test.ts), [`tests/route-user-scope.test.ts`](/Users/leonardwongly/.codex/worktrees/24f9/Agentic/tests/route-user-scope.test.ts) |
| Shared queue delivery paths | Slack and Telegram callbacks acknowledge forbidden shared approval attempts without retry storms or side-effect jobs. | [`tests/slack-webhook-route.test.ts`](/Users/leonardwongly/.codex/worktrees/24f9/Agentic/tests/slack-webhook-route.test.ts), [`tests/telegram-webhook-route.test.ts`](/Users/leonardwongly/.codex/worktrees/24f9/Agentic/tests/telegram-webhook-route.test.ts) |
| Role-filtered content and audit exports | Collaborators can review the active shared workspace export without leaking the owner's personal workspace audit artifacts. | [`tests/governance-audit-route.test.ts`](/Users/leonardwongly/.codex/worktrees/24f9/Agentic/tests/governance-audit-route.test.ts) |

## Delegated Action Audit Review Procedure

1. Confirm the acting principal resolved through the route boundary and that request bodies passed strict schema validation.
2. Confirm the approval is visible to the acting principal through the repository scope filter.
3. For workspace-scoped goals, confirm the acting principal is recorded as the workspace owner before mutating approval state.
4. Confirm denied collaborator attempts leave the approval pending and do not append approval evidence or follow-up jobs.
5. Confirm the owner path still records the approval decision, evidence record, and downstream follow-up job as expected.
6. For shared delivery channels, confirm forbidden attempts are acknowledged as terminal so Slack and Telegram do not retry the same callback indefinitely.
7. Export the active workspace audit view and verify that role-filtered users do not inherit owner-personal artifacts from unrelated workspaces.

## Spot-Check Results

- Shared approval responses now fail closed for non-owner collaborators with a repository-level `forbidden` error and route-level `403`.
- Shared approval denials preserve the pending approval state and do not create approval evidence until the owner responds.
- Slack and Telegram callbacks now acknowledge forbidden shared approval attempts with `reason: "forbidden"` and do not enqueue follow-up jobs.
- Shared workspace audit exports remain scoped to the selected shared workspace and exclude owner-personal audit operations from collaborator views.

## Release Checklist Update

- Verify the shared approval owner boundary with the repository and route regression tests before release.
- Verify Slack and Telegram callback denial paths stay non-retrying for forbidden shared approval actions.
- Spot-check one collaborator audit export from a shared workspace to confirm role-filtered privacy still excludes owner-personal records.
- Treat any regression that allows non-owner approval mutation or cross-workspace audit leakage as a release blocker.
