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
- `npm run test:oss:ownership`
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

For runtime-only diagnosis after a hygiene/docs gate has already been checked,
make the omission explicit:

```bash
npm run ci:local -- --full --with-postgres --skip-hygiene --skip-docs
```

Full mode requires an explicit database source. If a compatible local Postgres instance is already running, set `DATABASE_URL` and omit `--with-postgres`:

```bash
DATABASE_URL=postgres://postgres:postgres@127.0.0.1:5432/agentic npm run ci:local -- --full
```

Fast mode intentionally does not set `DATABASE_URL`, so `npm test` stays on the same in-memory/default path used by the fast PR gate. Full mode sets `DATABASE_URL` only from `--with-postgres` or the caller's environment because the GitHub workflow validates migrations and Postgres-backed repository behavior.

### Full-mode parity matrix

Full local CI mirrors the remote `validate` job in this order, except for
GitHub-only upload and attestation steps that are listed as skipped in dry-run
output:

| Remote validate job gate | Full local CI step | Optional skip |
| --- | --- | --- |
| `npm ci` | `npm ci` | `--skip-install` |
| Run lint gate | `npm run lint` | `--skip-hygiene` |
| Run typecheck gate | `npm run typecheck` | `--skip-hygiene` |
| Run format gate | `npm run format:check` | `--skip-hygiene` |
| Check release context | `npm run release:check-context` | `--skip-hygiene` |
| Validate OSS ownership defaults | `npm run test:oss:ownership` | none |
| Validate docs inventory | `npm run docs:render`, `npm run docs:validate` | `--skip-docs` |
| Create security artifact directories | local builtin artifact directory creation | none |
| Validate compliance registry references | `npm run compliance:validate-registry` | none |
| Audit production dependencies | `npm run security:audit-runtime -- --minimum-severity moderate --report artifacts/security/runtime-audit-report.json` | none |
| Validate migrations | `npm run db:check-migrations`, `npm run db:migrate`, `npm run db:status -- --require-ready` | none |
| Run governance simulation suite | `npm run governance:simulate` | none |
| Run security regression suite | `npm run test:security:regression` | none |
| Run unit and integration tests | `npm test` | none |
| Validate feature capability contracts | `npm run test:smoke:capabilities` | none |
| Validate architecture fitness | `npm run test:architecture:fitness` | none |
| Validate parallel worktree ownership | `npm run test:parallel-worktree:fitness` on `feat/parallel-*` branches | branch-conditioned |
| Validate performance fitness | `npm run test:performance:fitness` | none |
| Run async execution smoke | `npm run test:smoke:observability` | none |
| Build applications | `npm run build` | none |
| Generate runtime SBOM | `npm run security:sbom -- --output artifacts/security/agentic-sbom.spdx.json` | none |
| Install Playwright Chromium | `npx playwright install --with-deps chromium` | `--no-e2e` |
| Run browser E2E | `npm run test:e2e` | `--no-e2e` |
| Build container image | `docker build --build-arg NODE_OPTIONS=--max-old-space-size=4096 -t agentic-ci:local .` | none |
| Package deployable build artifacts | local builtin tar and `docker save` | none |
| Collect compliance evidence bundle | `npm run security:collect-evidence -- --require-artifacts --output-dir artifacts/compliance` | none |

## GitHub-only gaps

The local runner intentionally reports, but does not execute, these GitHub-only steps:

- Dependency Review Action, which needs GitHub pull request and dependency review context.
- Artifact uploads, which are represented locally by files under `artifacts/`.
- Build provenance attestations, which require GitHub OIDC and attestations APIs.

If GitHub-hosted runners are blocked before startup, local CI can prove the repository behavior but cannot satisfy branch protection or produce remote attestations.

## Requirements

- Node 22 for parity with GitHub Actions. The repo declares `>=20 <27`.
- Docker for `--full --with-postgres`, container image build, and artifact image export.
- Playwright browser dependencies for full E2E, installed by the full local CI plan.
- `pandoc` if docs rendering is part of the local validation being run separately.
