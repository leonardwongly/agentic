# Connector enablement

This runbook is the operator reference for enabling each Agentic connector: which
runtime configuration and scopes to set, how to verify readiness without leaking
secrets, how to recover a degraded connector, and the graduation criteria for the
`integrations-workspace` capability.

It pairs with two adjacent runbooks:

- [`connector-credential-lifecycle.md`](connector-credential-lifecycle.md) for managed Google credential lifecycle and repair states.
- [`connector-recovery-cockpit.md`](connector-recovery-cockpit.md) for the dashboard recovery surface and the governed recovery API.

> **Operator-gated.** Final connector proof requires real provider secrets and a
> deployed origin. The local validation in this runbook proves the readiness
> *logic* (config presence, scope requirements, recovery transitions) with stubs
> and no live secrets. The live-proof steps are marked **OPERATOR-GATED** and must
> be completed by an operator with the real credentials.

## The enablement readiness seam

`@agentic/integrations` exposes a pure, secret-free assessment of connector
enablement. It answers the operator question "can this connector be enabled, what
is missing, and what bounded recovery repairs it?" — complementary to
`describeIntegrationReadiness`, which scores the execution tier of an already
configured account.

```ts
import { assessConnectorEnablement, summarizeConnectorEnablement } from "@agentic/integrations";

// One connector
const slack = assessConnectorEnablement("slack");

// All connectors
const summary = summarizeConnectorEnablement();
```

Each assessment reports:

- `enablementState`: `ready` | `needs_configuration` | `blocked` | `disabled`.
- `configured`: whether the required runtime config (env vars) is present.
- `presentConfig` / `missingConfig`: env var **names** only — never values.
- `requiredScopes` / `missingScopes`: the provider scopes an operator must grant.
- `recoveryActions`: bounded, ordered operator steps to clear the state.

The assessment never reads or returns secret values, never calls a provider, and
never changes capability readiness. It accepts an injected `env`, a managed
Google credential snapshot, and a local-notes runtime config so the logic can be
verified without live secrets.

## Connector matrix

| Connector | Category | Required runtime config | Operator-granted scopes/permissions |
| --- | --- | --- | --- |
| Google (Gmail, Calendar) | managed OAuth | `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` (+ `AGENTIC_PROVIDER_SECRET_KEY`, `AGENTIC_PUBLIC_BASE_URL`) | `https://www.googleapis.com/auth/gmail.modify`, `https://www.googleapis.com/auth/calendar` |
| Slack | messaging | `SLACK_BOT_TOKEN`, `SLACK_SIGNING_SECRET` (+ `SLACK_DEFAULT_CHANNEL`) | `chat:write` |
| Telegram | messaging | `TELEGRAM_BOT_TOKEN`, `TELEGRAM_WEBHOOK_SECRET` (+ `TELEGRAM_DEFAULT_CHAT_ID`) | bot token authorization (no granular scope) |
| Local notes | local | dev: none. production: `AGENTIC_LOCAL_NOTES_ENABLED`, `AGENTIC_NOTES_PATH`, `AGENTIC_LOCAL_NOTES_ALLOWED_ROOT` | filesystem access bounded by the allowed root |
| GitHub | ingest | intake: `AGENTIC_GITHUB_WEBHOOK_SECRET`, `AGENTIC_GITHUB_ISSUE_ALLOWED_REPOSITORIES`. sync (optional): `AGENTIC_GITHUB_APP_ID`, `AGENTIC_GITHUB_APP_INSTALLATION_ID`, `AGENTIC_GITHUB_APP_PRIVATE_KEY`, `AGENTIC_GITHUB_APP_SYNC_SECRET` | App permissions: `issues:write`, `metadata:read`; webhook events: `issues`, `issue_comment` |

## Per-connector enablement

### Google (managed Gmail + Calendar)

1. Create a Google OAuth app and set `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET`.
2. Set `AGENTIC_PROVIDER_SECRET_KEY` (>=32 chars) and `AGENTIC_PROVIDER_SECRET_KEY_VERSION` so refresh tokens are encrypted at rest.
3. Set `AGENTIC_PUBLIC_BASE_URL` to the deployed origin for the OAuth redirect.
4. **OPERATOR-GATED.** Connect a workspace account through the Google setup flow and approve the required scopes (`gmail.modify`, `calendar`).
5. Verify readiness: the managed Google connector should report `ready` with `lifecycleState: healthy` and no `missingScopes`.

Recovery (see `connector-credential-lifecycle.md` for the full state model):

| Credential state | `enablementState` | Operator action |
| --- | --- | --- |
| No credential (OAuth app set) | `needs_configuration` | Connect the workspace account (`connect_google`). |
| Missing required scope | `blocked` | Reconnect and approve the missing scope (`request_scope_upgrade`). |
| Expired / revoked / reconnect-required | `blocked` | Reconnect the account (`reconnect_google`). |
| Refresh token missing / refresh failed | `blocked` | Repair the refresh-token path and revalidate. |

### Slack

1. Create a Slack app, install it to the workspace, and grant the `chat:write` bot scope.
2. Set `SLACK_BOT_TOKEN` (bot token) and `SLACK_SIGNING_SECRET` (request signing).
3. Optionally set `SLACK_DEFAULT_CHANNEL` for default notification routing.
4. Restart the web and worker processes so the adapter re-reads configuration.
5. **OPERATOR-GATED.** Confirm a test approval/notification posts and that webhook signatures verify.

`needs_configuration` until both `SLACK_BOT_TOKEN` and `SLACK_SIGNING_SECRET` are present; `ready` once both are set.

### Telegram

1. Create a bot with BotFather and capture the bot token.
2. Set `TELEGRAM_BOT_TOKEN` and `TELEGRAM_WEBHOOK_SECRET`.
3. Optionally set `TELEGRAM_DEFAULT_CHAT_ID`.
4. **OPERATOR-GATED.** Register the webhook with the secret header and confirm callback delivery and webhook-secret verification.

`needs_configuration` until both `TELEGRAM_BOT_TOKEN` and `TELEGRAM_WEBHOOK_SECRET` are present; `ready` once both are set.

### Local notes

- Development: enabled by default; no configuration required.
- Production: disabled until **all** of the following are set, with the notes path under the allowed root:
  1. `AGENTIC_LOCAL_NOTES_ENABLED=true`
  2. `AGENTIC_NOTES_PATH=<notes directory>`
  3. `AGENTIC_LOCAL_NOTES_ALLOWED_ROOT=<parent allowed root>`

If the notes path falls outside the allowed root, the connector reports `blocked`
(`scope_local_notes_path`); if the flags are unset it reports `disabled`
(`enable_local_notes`).

### GitHub

GitHub has two layers. Issue intake is the minimum; App sync is an optional layer.

1. Issue intake:
   1. Set `AGENTIC_GITHUB_WEBHOOK_SECRET` to the webhook signing secret.
   2. Set `AGENTIC_GITHUB_ISSUE_ALLOWED_REPOSITORIES` to the `owner/repo` allowlist.
   3. Optionally set `AGENTIC_GITHUB_ISSUE_INTAKE_USER_ID`.
   4. **OPERATOR-GATED.** Register the webhook for `issues` and `issue_comment` events and confirm signature verification.
2. App sync (optional): set `AGENTIC_GITHUB_APP_ID`, `AGENTIC_GITHUB_APP_INSTALLATION_ID`, `AGENTIC_GITHUB_APP_PRIVATE_KEY`, and `AGENTIC_GITHUB_APP_SYNC_SECRET`. Keep `AGENTIC_GITHUB_APP_SYNC_SECRET` in the deployment provider, not in repository CI secrets. See [`github-issue-autopilot.md`](github-issue-autopilot.md).

If App sync is partially configured, the connector reports `blocked`
(`complete_github_app_sync`) so a half-finished setup cannot be mistaken for ready.

## Verify readiness

Local logic verification (no live secrets):

```bash
npm exec -- vitest run tests/connector-enablement.test.ts tests/integration-readiness.test.ts
```

Live verification (**OPERATOR-GATED**, requires real secrets and a deployed origin):

- `summarizeConnectorEnablement()` reports the connectors you intend to use as `ready`.
- Authenticated `GET /api/ready/details` reports healthy connector health.
- For GitHub App sync: `npm run github:app-sync:preflight`.

## Graduation criteria — `integrations-workspace`

`integrations-workspace` is a **preview** capability. Its graduation to
`operational` is owned by **platform-security** and blocked by
[#142](https://github.com/leonardwongly/agentic/issues/142). Required validation
gate:

```bash
npm exec -- vitest run tests/integration-readiness.test.ts tests/google-provider-routes.test.ts
```

To graduate preview -> operational, attach evidence that (per the criteria in
[`../specs/capability-graduation.md`](../specs/capability-graduation.md)):

1. Connector config presence, scope validation, and recovery transitions are proven (this runbook's local gate + `tests/connector-enablement.test.ts`).
2. **OPERATOR-GATED.** At least one live connector is configured end to end with real secrets and verified through `/api/ready/details` connector health.
3. Provider mutation controls stay owner-gated and the recovery cockpit clears degraded state through the governed recovery API.
4. The capability registry's `requiredGates` for `integrations-workspace` are green and `nextValidationGate` ("Prove connector configuration, scopes, and recovery state under #142") has recorded evidence.

Do **not** bump the capability readiness in `apps/web/lib/feature-capabilities.ts`
without the operator-gated live proof above.

## Security notes

- Assessments expose env var **names**, scope strings, lifecycle classes, and
  bounded recovery steps — never secret values, tokens, ciphertext, OAuth state,
  or reconciliation cursors.
- Refresh tokens are stored only through encrypted provider credential secrets.
- Connector recovery writes from the dashboard go only through
  `POST /api/operations/recovery`, which owns auth, rate limiting, and audit.
- Workspace-scoped connector recovery remains owner-gated.

## Validation

```bash
npm exec -- vitest run tests/connector-enablement.test.ts tests/integration-readiness.test.ts
npm run typecheck
npm run lint
```

## Rollback

These changes are test, documentation, and a pure assessment helper. Rollback is a
normal revert of `packages/integrations/src/connector-enablement.ts`, its export
in `packages/integrations/src/index.ts`, the tests, and this runbook. No
migration, provider write, secret rotation, or capability readiness change is
introduced.
