# Public Share Disclosure Review

AOS-04 makes public goal sharing an explicit review workflow instead of a direct link creation action. Operators must preview the externally visible projection, review redacted data classes and sensitive-content findings, then confirm before a public link is minted.

## Shareable Projection

Public share pages use the allowlisted `SharedGoalView` projection. They expose:

- goal title
- goal explanation
- goal status
- task title, status, summary, and artifact count
- artifact title, type, and creation timestamp

They do not expose:

- original operator request
- approvals or approval preview content
- action logs
- watcher details
- artifact body content
- artifact metadata
- memory context
- workflow checkpoints

## Review And Expiry

`POST /api/goals/:id/share` supports two explicit states:

- preview: returns `reviewRequired: true` plus the disclosure review and does not create a share record
- confirmed: persists the share record, disclosure review, expiry, and create audit event

Share expiry is bounded by server-side minimum and maximum day limits. The default remains seven days.

## Audit Events

The public share surface records:

- `share.link_created` when a confirmed share is created
- `share.link_viewed` when an active share is viewed after deduplication
- `share.link_revoked` when an operator revokes a share
- `share.link_expired` when an expired signed share is accessed
- `share.access_failed` for signed-token revoked, expired, or missing-share access

Audit details store token fingerprints and disclosure summaries, not raw public tokens.

## Rollout

1. Apply database migrations before deploying the web app so `goal_shares.disclosure_review` exists.
2. Deploy web and worker builds together.
3. Run public-share route, regression, security, and browser checks before enabling operators to rely on the review panel.

## Rollback

The `disclosure_review` column is additive and nullable. If rollback is required, deploy the previous web app version first. The unused column can remain in place until a later cleanup migration.

## Validation Commands

```bash
npm exec -- vitest run tests/share.test.ts tests/share-route.test.ts tests/public-share-view-route.test.ts tests/dashboard-goals-card.test.tsx tests/security-regression-suite.test.ts
npm run test:security:regression
npm run test:architecture:fitness
npm run test:performance:fitness
npm run build
npm run test:e2e -- tests/e2e/share-goal.spec.ts tests/e2e/security-headers.spec.ts
```
