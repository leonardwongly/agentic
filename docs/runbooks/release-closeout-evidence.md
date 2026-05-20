# Release Closeout Evidence

## Purpose

The release closeout package keeps production-readiness evidence in one
reviewable place instead of scattering it across PR descriptions, issue
comments, local notes, and workflow logs. It is intentionally conservative:
local implementation evidence can pass while live deployment gates remain
blocked, but each blocked gate must link to the issue that prevents proof.

The source of truth is:

```bash
config/release/production-runtime-closeout.json
```

Validate it with:

```bash
npm run release:closeout:evidence
npm run release:closeout:evidence -- --json
```

## Evidence Contract

The manifest must include:

- pull requests, hosted status, and local validation commands
- tracked issues for the W01-T05 task and child subtasks
- required validation gates from the production closeout issue
- rollback, disablement, and secret rotation controls
- residual risks with owner, severity, blocker issue, and mitigation
- observability hooks for retained telemetry and rollout gates

The validator fails when:

- a child closeout issue is missing
- a required validation gate is missing
- a blocked or not-run gate has no blocker issue
- a blocked or deferred issue has no blocker issue
- a referenced repo path does not exist
- a GitHub URL points outside this repository
- raw secret-like values, token values, URL credentials, or private keys appear

## Live Gate Handling

Do not mark a live validation gate as passed unless it was actually run against
the target environment. While the provider target is blocked, record the gate as
`blocked` and link the issue that prevents execution.

The required live gates are:

```bash
npm run deploy:ingress:check
npm run db:status -- --require-ready
npm run test:smoke:deployment
npm run test:smoke:deployment-async
npm run github:app-sync:preflight
npm run telemetry:rollout-gate -- --dir "${AGENTIC_TELEMETRY_RETENTION_DIR:-.agentic/telemetry}"
```

Local CI evidence remains required on implementation branches while hosted CI is
unavailable or stops before validate jobs:

```bash
npm run ci:local
```

## Rollout Handoff

Before the production-readiness tracker closes, the release owner should attach
the current closeout report to the parent issue and confirm:

1. The stable provider target and HTTPS ingress exist.
2. Runtime secrets and repository settings are configured without exposing
   values.
3. Postgres and shared-auth status were verified against the target database.
4. The deployed worker can complete queued jobs.
5. Live GitHub App issue sync completes through the deployed worker.
6. Retained telemetry passes the rollout gate.
7. Residual risks are either mitigated or linked to follow-up issues.

## Rollback

Rollback follows the deployment runbook. The closeout manifest must repeat the
minimum operator actions so the evidence bundle is useful during an incident:

1. Stop routing new traffic to the current release.
2. Restore the previous known-good release artifact for web and worker.
3. Re-run `/api/health` and `/api/ready`.
4. Re-run deployment smoke, async canary, and rollout-gate validation.
5. Keep additive schema changes in place unless a separate tested rollback plan
   exists.

## Disablement

The release closeout must include explicit disablement controls. For the W01
production proof workstream, the minimum controls are:

- disable scheduled GitHub App issue sync or clear the stable sync URL
- restore the previous web and worker release artifact
- keep schema rollback manual and operator-approved

## Secret Rotation

The closeout record must describe how to rotate or revoke secrets without
copying values into the manifest, logs, issues, screenshots, or PR text.

Minimum rotation surfaces:

- deployment smoke access key
- GitHub App sync shared secret
- provider deploy credentials when provider-backed staging is enabled
- telemetry export token when retained telemetry is exported

After rotation, rerun the affected smoke or sync command and attach only the
command, result, timestamp, target, and redacted summary.

## Residual Risks

Residual risks are acceptable only when they are explicit. Each non-mitigated
risk must include:

- owner
- severity
- blocker issue
- mitigation
- condition that closes the risk

Do not close the umbrella production tracker from memory or verbal confirmation
alone. Use the manifest and validator output as the handoff artifact.
