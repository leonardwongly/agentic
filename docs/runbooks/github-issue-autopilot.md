# GitHub Issue Autopilot

GitHub Issue Autopilot turns GitHub issue activity into governed Agentic worker jobs. GitHub Actions forwards issue and issue-comment events to Agentic with an HMAC signature; Agentic verifies the signature, validates and bounds the payload, checks the repository allowlist, de-duplicates the trigger, and enqueues a `github_issue_intake` durable job.

Agentic can also run a GitHub App pull sync for existing open issues. The scheduled/manual `.github/workflows/github-app-issue-sync.yml` workflow calls Agentic with a bearer sync secret; Agentic then authenticates as a GitHub App installation, lists open issues from allowlisted repositories, skips pull requests, and enqueues the same `github_issue_intake` durable jobs.

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

## GitHub App Open Issue Sync

Create a GitHub App and install it on the repositories listed in `AGENTIC_GITHUB_ISSUE_ALLOWED_REPOSITORIES`.

Minimum GitHub App permissions:

- Metadata: read
- Issues: read

Do not grant contents write, issues write, pull request write, administration, or secrets permissions for this sync path.

Required Agentic runtime environment:

- `AGENTIC_GITHUB_APP_ID`: numeric GitHub App id.
- `AGENTIC_GITHUB_APP_INSTALLATION_ID`: numeric installation id for the repository or organization.
- `AGENTIC_GITHUB_APP_PRIVATE_KEY`: GitHub App private key PEM. Escaped newlines and base64-encoded PEM are accepted.
- `AGENTIC_GITHUB_APP_SYNC_SECRET`: high-entropy bearer secret used by the scheduled/manual sync workflow.

Optional Agentic runtime environment:

- `AGENTIC_GITHUB_APP_API_BASE_URL`: defaults to `https://api.github.com`; must use `https`.
- `AGENTIC_GITHUB_APP_SYNC_AUTOMATION_MODE`: `work` or `plan`; defaults to `work`.
- `AGENTIC_GITHUB_APP_SYNC_MAX_ISSUES_PER_REPOSITORY`: defaults to `100`, maximum `500`.

GitHub repository configuration:

- Secret `AGENTIC_GITHUB_APP_SYNC_SECRET`: same value as the Agentic runtime sync secret.
- Variable `AGENTIC_GITHUB_APP_ISSUE_SYNC_URL`: `https://<agentic-host>/api/github/issues/app/sync`.

Confirm the repository caller surface by name only; do not print secret values:

```bash
gh secret list --repo leonardwongly/agentic
gh variable list --repo leonardwongly/agentic
```

The repository Actions secret inventory must include
`AGENTIC_GITHUB_APP_SYNC_SECRET` and must not include
`AGENTIC_GITHUB_APP_PRIVATE_KEY`, `AGENTIC_GITHUB_APP_INSTALLATION_ID`, or a
GitHub installation token. Those values belong only in the Agentic deployment
provider secret manager.

Use a durable HTTPS URL for scheduled sync. The repository variable must point exactly at `/api/github/issues/app/sync` on the selected host and must not include embedded credentials, query strings, or fragments. Temporary tunnel hosts such as `trycloudflare.com`, `ngrok.io`, `ngrok.app`, `ngrok-free.app`, `loca.lt`, `localhost.run`, `devtunnels.ms`, `serveo.net`, `tunnelmole.net`, `localhost`, private network addresses, and `.local` are allowed only for explicit manual validation: scheduled runs emit a notice and skip them, while manual dispatch requires `allow_temporary_url=true`.

The sync route is intentionally a pull model: GitHub Actions only triggers Agentic with a bearer secret and never receives the GitHub App private key or installation token.

## Data Flow

1. `.github/workflows/github-issue-autopilot.yml` runs on `issues.opened`, `issues.reopened`, `issues.labeled`, and `issue_comment.created`.
2. The workflow reads the GitHub event JSON from `GITHUB_EVENT_PATH`.
3. It signs the raw JSON body with `AGENTIC_GITHUB_WEBHOOK_SECRET` and sends it to `/api/github/issues/webhook`.
4. Agentic verifies `x-hub-signature-256`, checks `x-github-event`, bounds body size, validates the event-specific payload, rejects repositories outside `AGENTIC_GITHUB_ISSUE_ALLOWED_REPOSITORIES`, and ignores pull-request events.
5. For labels, Agentic only trusts the top-level `payload.label` from the current `labeled` event. It does not infer work mode from the issue's historical label list.
6. For issue comments, Agentic accepts only exact `/agentic work` or `/agentic plan` commands from non-bot senders that match the configured authorization rules.
7. Agentic enqueues a `github_issue_intake` job with a stable idempotency key covering repository, issue number, automation mode, and trigger identity.
8. The worker runtime claims the job and converts it into a governed goal-create execution request. The original issue body is treated as untrusted external input and truncated before it reaches planning.

GitHub App sync data flow:

1. `.github/workflows/github-app-issue-sync.yml` runs on an hourly schedule or manual dispatch.
2. The workflow validates the configured URL and bearer secret, skips scheduled runs that still point at temporary tunnel hosts, and requires `allow_temporary_url=true` for ad hoc tunnel validation.
3. The workflow masks the bearer secret, creates a non-secret request id, and calls `POST /api/github/issues/app/sync` with `Authorization: Bearer <AGENTIC_GITHUB_APP_SYNC_SECRET>`, `x-request-id`, and `x-trace-id`.
4. Agentic verifies the bearer secret with constant-time comparison and validates GitHub App runtime configuration.
5. Agentic creates a short-lived GitHub App JWT, exchanges it for an installation token, and lists open issues from each allowlisted repository.
6. Agentic validates and bounds GitHub API responses, skips pull requests returned by the issues endpoint, and enqueues `github_issue_intake` jobs with trigger `issues.sync`.
7. The sync response returns each queued job id plus `statusUrl: /api/jobs/<job-id>` so the deployed worker path can be polled without exposing GitHub App credentials.
8. Repeated syncs de-duplicate by repository, issue number, automation mode, and the stable `github_app:open_issue_sync` trigger id.

Deployed completion proof:

```bash
export AGENTIC_SMOKE_BASE_URL=https://agentic.example.com
export AGENTIC_SMOKE_ACCESS_KEY=replace-this-with-the-runtime-access-key
export AGENTIC_GITHUB_APP_SYNC_SECRET=replace-this-with-the-runtime-sync-secret
npm run test:smoke:github-app-sync
```

The canary calls `/api/github/issues/app/sync`, validates same-origin job status URLs, and polls `/api/jobs/<job-id>` until every returned `github_issue_intake` job completes, dead-letters, or times out. The emitted evidence includes repository names, issue numbers, job ids, attempts, request/trace ids, and timings; it does not print the sync secret, access key, GitHub App private key, installation token, or raw issue body.

## Security Notes

- GitHub issue title, body, labels, assignees, and actor data are untrusted.
- The workflow never receives an Agentic API key and cannot mutate Agentic state without the shared HMAC secret.
- The route does not persist the raw webhook body. It stores only bounded, allowlisted fields needed for intake.
- The route fails closed unless the repository full name is explicitly allowlisted.
- Comment commands are exact-match only; quoted, embedded, or prose mentions are ignored.
- Bot senders are ignored to reduce feedback loops.
- Repository mutation remains behind Agentic governance and approval controls. The issue trigger only creates a queued worker job.
- Payloads over 256 KB are rejected. Issue body text is trimmed to 10,000 characters in the job payload and to the orchestrator request limit during worker execution.
- The GitHub App sync route stores only bounded issue fields and never logs the app private key, installation token, bearer sync secret, raw GitHub response, or raw issue body.
- The scheduled sync workflow does not receive the GitHub App private key; it only receives a route-specific bearer secret.
- Missing or malformed runtime-only GitHub App configuration returns a sanitized operational error before any GitHub API call is attempted.

## Validation

Run focused checks after changing this flow:

```bash
npm test -- tests/github-issue-webhook-route.test.ts tests/github-app-issue-sync-route.test.ts tests/github-issue-autopilot-workflow.test.ts tests/worker-runtime.test.ts
npm test -- tests/github-issue-job-route.test.ts tests/deployment-github-app-sync-canary.test.ts
npm run ci:validate-provenance
npm run build
```

## Rollback

Disable the GitHub repository variable `AGENTIC_GITHUB_ISSUE_WEBHOOK_URL` to stop webhook enqueueing without changing deployed Agentic code. Disable `AGENTIC_GITHUB_APP_ISSUE_SYNC_URL` or pause `.github/workflows/github-app-issue-sync.yml` to stop GitHub App pull sync. To fully remove either trigger, disable or revert its workflow.
