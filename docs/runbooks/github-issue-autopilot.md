# GitHub Issue Autopilot

GitHub Issue Autopilot turns GitHub issue activity into governed Agentic worker jobs. GitHub Actions forwards issue and issue-comment events to Agentic with an HMAC signature; Agentic verifies the signature, validates and bounds the payload, checks the repository allowlist, de-duplicates the trigger, and enqueues a `github_issue_intake` durable job.

Supported automation modes:

- `intake`: created from `issues.opened` and `issues.reopened`; classifies and decomposes the issue into governed Agentic work.
- `plan`: created by the `agentic:plan` label or an exact `/agentic plan` issue comment from an authorized collaborator; produces a plan and validation checklist only.
- `work`: created by the `agentic:work` label or an exact `/agentic work` issue comment from an authorized collaborator; prepares repo-grounded implementation work behind Agentic governance and approval controls.

## Runtime Configuration

Set the same high-entropy secret in both places:

- Agentic runtime environment: `AGENTIC_GITHUB_WEBHOOK_SECRET`
- GitHub repository secret: `AGENTIC_GITHUB_WEBHOOK_SECRET`

Set this GitHub repository variable:

- `AGENTIC_GITHUB_ISSUE_WEBHOOK_URL`: `https://<agentic-host>/api/github/issues/webhook`

Required Agentic runtime environment:

- `AGENTIC_GITHUB_ISSUE_ALLOWED_REPOSITORIES`: comma-separated allowlist such as `owner/repo,another-owner/another-repo`.

Optional Agentic runtime environment:

- `AGENTIC_GITHUB_ISSUE_INTAKE_USER_ID`: owner for generated jobs; defaults to `SYSTEM_USER_ID`.
- `AGENTIC_GITHUB_ISSUE_INTAKE_WORKSPACE_ID`: workspace scope for generated goal work; defaults to personal/system scope.
- `AGENTIC_GITHUB_ISSUE_WORK_LABEL`: label that enables `work` mode; defaults to `agentic:work`.
- `AGENTIC_GITHUB_ISSUE_PLAN_LABEL`: label that enables `plan` mode; defaults to `agentic:plan`.
- `AGENTIC_GITHUB_ISSUE_COMMAND_AUTHOR_ASSOCIATIONS`: comma-separated GitHub author associations allowed to run comment commands; defaults to `OWNER,MEMBER,COLLABORATOR`.
- `AGENTIC_GITHUB_ISSUE_COMMAND_ALLOWED_LOGINS`: optional comma-separated login allowlist. When set, a comment command must match both this login allowlist and the allowed author association list.

The workflow intentionally exits with a notice when the URL or secret is missing so issue creation is not blocked before the deployment is configured. Once configured, invalid URL schemes or short secrets fail closed.

## Data Flow

1. `.github/workflows/github-issue-autopilot.yml` runs on `issues.opened`, `issues.reopened`, `issues.labeled`, and `issue_comment.created`.
2. The workflow reads the GitHub event JSON from `GITHUB_EVENT_PATH`.
3. It signs the raw JSON body with `AGENTIC_GITHUB_WEBHOOK_SECRET` and sends it to `/api/github/issues/webhook`.
4. Agentic verifies `x-hub-signature-256`, checks `x-github-event`, bounds body size, validates the event-specific payload, rejects repositories outside `AGENTIC_GITHUB_ISSUE_ALLOWED_REPOSITORIES`, and ignores pull-request events.
5. For labels, Agentic only trusts the top-level `payload.label` from the current `labeled` event. It does not infer work mode from the issue's historical label list.
6. For issue comments, Agentic accepts only exact `/agentic work` or `/agentic plan` commands from non-bot senders that match the configured authorization rules.
7. Agentic enqueues a `github_issue_intake` job with a stable idempotency key covering repository, issue number, automation mode, and trigger identity.
8. The worker runtime claims the job and converts it into a governed goal-create execution request. The original issue body is treated as untrusted external input and truncated before it reaches planning.

## Security Notes

- GitHub issue title, body, labels, assignees, and actor data are untrusted.
- The workflow never receives an Agentic API key and cannot mutate Agentic state without the shared HMAC secret.
- The route does not persist the raw webhook body. It stores only bounded, allowlisted fields needed for intake.
- The route fails closed unless the repository full name is explicitly allowlisted.
- Comment commands are exact-match only; quoted, embedded, or prose mentions are ignored.
- Bot senders are ignored to reduce feedback loops.
- Repository mutation remains behind Agentic governance and approval controls. The issue trigger only creates a queued worker job.
- Payloads over 256 KB are rejected. Issue body text is trimmed to 10,000 characters in the job payload and to the orchestrator request limit during worker execution.

## Validation

Run focused checks after changing this flow:

```bash
npm test -- tests/github-issue-webhook-route.test.ts tests/github-issue-autopilot-workflow.test.ts tests/worker-runtime.test.ts
npm run ci:validate-provenance
npm run build
```

## Rollback

Disable the GitHub repository variable `AGENTIC_GITHUB_ISSUE_WEBHOOK_URL` to stop enqueueing without changing deployed Agentic code. To fully remove the trigger, disable or revert `.github/workflows/github-issue-autopilot.yml`.
