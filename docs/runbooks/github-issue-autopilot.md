# GitHub Issue Autopilot

GitHub Issue Autopilot turns newly opened GitHub issues into governed Agentic worker jobs. GitHub Actions forwards the `issues.opened` event to Agentic with an HMAC signature; Agentic verifies the signature, validates and bounds the payload, de-duplicates by repository and issue number, and enqueues a `github_issue_intake` durable job.

## Runtime Configuration

Set the same high-entropy secret in both places:

- Agentic runtime environment: `AGENTIC_GITHUB_WEBHOOK_SECRET`
- GitHub repository secret: `AGENTIC_GITHUB_WEBHOOK_SECRET`

Set this GitHub repository variable:

- `AGENTIC_GITHUB_ISSUE_WEBHOOK_URL`: `https://<agentic-host>/api/github/issues/webhook`

Optional Agentic runtime environment:

- `AGENTIC_GITHUB_ISSUE_INTAKE_USER_ID`: owner for generated jobs; defaults to `SYSTEM_USER_ID`.
- `AGENTIC_GITHUB_ISSUE_INTAKE_WORKSPACE_ID`: workspace scope for generated goal work; defaults to personal/system scope.

The workflow intentionally exits with a notice when the URL or secret is missing so issue creation is not blocked before the deployment is configured. Once configured, invalid URL schemes or short secrets fail closed.

## Data Flow

1. `.github/workflows/github-issue-autopilot.yml` runs on `issues.opened`.
2. The workflow reads the GitHub event JSON from `GITHUB_EVENT_PATH`.
3. It signs the raw JSON body with `AGENTIC_GITHUB_WEBHOOK_SECRET` and sends it to `/api/github/issues/webhook`.
4. Agentic verifies `x-hub-signature-256`, checks `x-github-event`, bounds body size, validates the issue payload, and ignores non-opened or pull-request events.
5. Agentic enqueues a `github_issue_intake` job with a stable idempotency key: repository full name plus issue number.
6. The worker runtime claims the job and converts it into a governed goal-create execution request. The original issue body is treated as untrusted external input and truncated before it reaches planning.

## Security Notes

- GitHub issue title, body, labels, assignees, and actor data are untrusted.
- The workflow never receives an Agentic API key and cannot mutate Agentic state without the shared HMAC secret.
- The route does not persist the raw webhook body. It stores only bounded, allowlisted fields needed for intake.
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
