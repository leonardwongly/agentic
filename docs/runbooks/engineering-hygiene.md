# Engineering Hygiene And Evidence Discipline

## Purpose

This runbook defines the W10 engineering hygiene contract for issue #199 and major tasks #245 through #249. The goal is to make quality gates, docs truth, issue evidence, stale local artifacts, and first-run setup reproducible from the repository instead of relying on memory or strategy notes.

## Required Gates

Run these before a branch is considered release-ready:

```bash
npm run lint
npm run typecheck
npm run format:check
npm run release:check-context
npm run docs:validate
npm run remediation:verify
npm run ci:validate-provenance
npm run build
```

The CI workflow runs the lightweight gates before the heavier security, migration, test, build, and artifact stages. This keeps obvious hygiene failures cheap while preserving the full validation ladder.

## Gate Contracts

| Gate | Contract | Blocks on |
| --- | --- | --- |
| `npm run lint` | Validates the repo-owned hygiene contract: required scripts, CI gate wiring, and W10 evidence map references. | Missing scripts, missing CI gate calls, missing evidence paths, blocked issues without blockers. |
| `npm run typecheck` | Runs TypeScript over production app and package surfaces with `tsconfig.typecheck.json`. | Type errors in app or package surfaces included by the production typecheck config. |
| `npm run format:check` | Checks changed text files for LF endings, final newline, and trailing whitespace. | CRLF, missing final newline, trailing whitespace. |
| `npm run release:check-context` | Checks changed and visible local paths for files that should not become release evidence. | `.env*`, `.agentic`, build outputs, artifacts, logs, packaged outputs, key material, and secret-like filenames. |
| `npm run docs:validate` | Validates the generated document output contract. | Missing or invalid generated document output. |
| `npm run setup:check` | Reports first-run local readiness. | Unsupported Node version; warns on missing dependencies, access key, or database parity settings. |
| `npm run hygiene:repo` | Reports stale branches, stale PRs, and worktree state without mutating GitHub or the local repo. | Dirty worktrees are blockers; stale branches and PRs are warnings that need owner action. |

## Issue-To-Evidence Map

The W10 issue map lives at:

```text
config/engineering-hygiene/w10-evidence-map.json
```

Each entry must include:

- GitHub issue number and title
- parent issue for child tasks
- status: `implemented`, `deferred`, or `blocked`
- concrete evidence paths that exist in the checkout
- blocker notes when status is `blocked`

Strategy docs, roadmap text, and issue descriptions are context only. They are not implementation proof unless they point to code, tests, CI, runbooks, or generated evidence that exists and can be validated.

## Docs And API Inventory Truth

The canonical API inventory remains:

```text
docs/specs/api-route-inventory.md
```

Any change to `apps/web/app/api/**/route.ts` must update that inventory in the same change. The `tests/api-route-inventory.test.ts` suite checks every route handler and method against the inventory and rejects stale inventory rows.

## Stale Artifact And Release Context Reconciliation

Release evidence must exclude local and generated context:

- `.env`, `.env.local`, and secret-like filenames
- `.agentic/`
- `artifacts/`, `coverage/`, `dist/`, `test-results/`, and Playwright reports
- `.next/`, `apps/web/.next/`, and `apps/web/out/`
- package archives, logs, and key material

If a stale artifact is useful for debugging, keep it local or regenerate it in CI. Do not commit it as proof.

## Branch, PR, And Worktree Hygiene

Use the read-only report before cleanup or merge closeout:

```bash
npm run hygiene:repo -- --max-age-days 21
npm run hygiene:repo -- --json
```

The report does not delete branches, close PRs, remove worktrees, or push changes. Act on the output manually:

- stale branch: rebase, merge, delete after confirming it is merged, or record an owner and blocker
- stale PR: close, rebase, split, or link a blocker
- dirty worktree: inspect and preserve owner changes before cleanup
- missing worktree: decide whether it is intentionally absent or should be recreated

For managed parallel cleanup, continue to use:

```bash
npm run worktree:cleanup -- --print-only
```

## First-Run Validation

Fresh checkouts should run:

```bash
npm install
npm run setup:check
npm test
npm run build
```

`npm run setup:check` is intentionally non-destructive. It confirms supported Node, required repo files, dependency installation, access-key posture, and file-backed versus Postgres mode. For production-like local parity, set `DATABASE_URL`, run migrations, and run:

```bash
npm run db:migrate
npm run db:status -- --require-ready
```

## Rollback

These gates are repository-local and have no external side effects. Roll back by reverting the commit that changed scripts, workflow wiring, docs, or the evidence map. If CI blocks unexpectedly, use the failing gate output to decide whether the issue is a real hygiene failure or whether the contract needs a narrowly scoped adjustment.
