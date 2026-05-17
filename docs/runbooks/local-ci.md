# Local CI

Use local CI when GitHub Actions is unavailable or when a branch needs a repeatable pre-push validation loop. The local runner mirrors the CI workflow with explicit local substitutes for GitHub-only steps.

## Fast PR gate

Run the fast gate before pushing a normal PR update:

```bash
npm run ci:local
```

This runs:

- `npm ci`
- `npm run ci:validate-provenance`
- `npm run ci:issue-theme-gates -- --assert-workflow`
- `npm run compliance:validate-registry`
- `npm run test:architecture:fitness`
- `npm run test:performance:fitness`
- `npm test`
- `npm run build`

Use `--skip-install` when dependencies are already current:

```bash
npm run ci:local -- --skip-install
```

Preview the exact steps without executing them:

```bash
npm run ci:local -- --dry-run
npm run ci:local -- --json
```

## Full local CI

Run the closest local equivalent of `.github/workflows/ci.yml`:

```bash
npm run ci:local -- --full --with-postgres
```

`--with-postgres` starts an isolated `postgres:16` container named `agentic-local-ci-postgres` and removes it when the run finishes. Use `--keep-postgres` only when you want to inspect the database after a failed run:

```bash
npm run ci:local -- --full --with-postgres --keep-postgres
```

For faster diagnosis that still covers the server-side CI gates, skip browser E2E:

```bash
npm run ci:local -- --full --with-postgres --no-e2e
```

Full mode requires an explicit database source. If a compatible local Postgres instance is already running, set `DATABASE_URL` and omit `--with-postgres`:

```bash
DATABASE_URL=postgres://postgres:postgres@127.0.0.1:5432/agentic npm run ci:local -- --full
```

Fast mode intentionally does not set `DATABASE_URL`, so `npm test` stays on the same in-memory/default path used by the fast PR gate. Full mode sets `DATABASE_URL` only from `--with-postgres` or the caller's environment because the GitHub workflow validates migrations and Postgres-backed repository behavior.

## GitHub-only gaps

The local runner intentionally reports, but does not execute, these GitHub-only steps:

- Dependency Review Action, which needs GitHub pull request and dependency review context.
- Artifact uploads, which are represented locally by files under `artifacts/`.
- Build provenance attestations, which require GitHub OIDC and attestations APIs.

If GitHub-hosted runners are blocked before startup, local CI can prove the repository behavior but cannot satisfy branch protection or produce remote attestations.

## Requirements

- Node 20 for parity with GitHub Actions. The repo declares `>=20 <26`.
- Docker for `--full --with-postgres`, container image build, and artifact image export.
- Playwright browser dependencies for full E2E, installed by the full local CI plan.
- `pandoc` if docs rendering is part of the local validation being run separately.
