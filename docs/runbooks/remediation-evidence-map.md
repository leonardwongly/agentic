# Remediation Evidence Map

## Purpose

The remediation evidence map records which roadmap and tracker issues are
implemented, blocked, superseded, or still open. It keeps implementation proof
separate from deployment proof so planning does not confuse passing local tests
with production rollout evidence.

The map lives at:

```text
config/remediation/issue-evidence-map.json
```

Validate it with:

```bash
npm run remediation:evidence-map
npm run remediation:evidence-map -- --json
```

## Entry Contract

Each entry must include:

- issue number, title, parent issue, and owner lane
- status: `implemented`, `blocked`, `superseded`, or `open`
- implementation evidence that resolves to repo files, GitHub issues, GitHub
  PRs, or validation commands
- validation gates that a reviewer can rerun
- deployment proof status: `not_required`, `blocked`, or `available`
- blockers for open, blocked, or deployment-blocked entries
- residual risks with owner, blocker issue, and mitigation

## Evidence Boundaries

Use repo paths and GitHub links as evidence. Do not copy:

- raw secrets, tokens, credentials, private keys, or URL credentials
- unredacted deployment logs
- machine-local absolute paths
- generated artifact contents

Generated artifacts can be referenced by the command that produces them. They
should stay under ignored `artifacts/` paths unless a workflow explicitly uploads
them as retained CI evidence.

## Deployment Proof

Use `deploymentProof.status = "not_required"` for tracker, documentation, and
local CI hygiene issues that do not change runtime behavior.

Use `deploymentProof.status = "blocked"` when the code or evidence package is
ready but the live target is unavailable. The entry must link the issue that
blocks live proof.

Use `deploymentProof.status = "available"` only when live health, readiness,
smoke, canary, telemetry, or deployment run evidence exists and can be linked.

## Updating The Map

Update the map when:

- a tracker workstream closes
- a stale PR is closed, merged, or split into follow-up issues
- a roadmap issue moves from planned to implemented
- local implementation proof exists but production proof remains blocked
- residual risk is accepted, mitigated, or converted into a new issue

Run the validator and attach the output to the relevant parent issue before
closing tracker work.
