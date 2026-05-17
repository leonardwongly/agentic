# Issue Theme Gate Taxonomy

## Purpose

The issue-theme gate taxonomy maps GitHub issue themes to targeted validation gates. It lets parallel workstreams run the smallest meaningful gate set for their risk surface while keeping the full integrated suite mandatory before merge.

This is a routing layer, not a replacement for final CI. It answers two operational questions:

1. Which shard owns this issue or file change?
2. Which validation commands must run before the branch can be reviewed?

## Trust Boundaries

Inputs:

- GitHub issue labels and titles
- changed file paths from git
- explicit `--theme` values passed by an operator or automation

All CLI inputs are treated as untrusted. Changed file paths must be repository-relative, non-empty, and stay inside the checkout. Unknown theme ids fail closed.
When a changed path does not match a known theme, the resolver uses a conservative all-theme fallback so new surfaces do not silently skip required checks.

Outputs:

- matching issue themes
- CI shard ids
- required validation commands

The command only prints or validates gate plans. It does not mutate files, close issues, call GitHub APIs, deploy, or execute the returned validation commands.

## Theme Shards

| Theme | Shard | Primary use |
| --- | --- | --- |
| `production-runtime` | `runtime` | Production bootstrap, deploy, ingress, shared auth, runtime closeout |
| `execution-spine` | `execution` | Durable workers, workflow DAGs, outbox, idempotency, replay |
| `connector-readiness` | `connectors` | Gmail, Calendar, provider credentials, connector readiness and recovery |
| `governance-trust` | `governance` | Policy, approvals, autonomy calibration, tenant and identity boundaries |
| `operator-shell` | `shell` | Dashboard, cockpit, tracker scale, bounded dashboard collections |
| `intelligence-fabric` | `intelligence` | Memory, provenance, recommendations, learning episodes |
| `security-privacy` | `security` | Secrets, redaction, abuse controls, compliance, safe errors |
| `observability-performance` | `observability` | Telemetry, trace propagation, smoke/canary, load and performance |
| `engineering-hygiene` | `hygiene` | Docs, CI, release gates, stale evidence, issue-to-evidence mapping |

## Commands

List the taxonomy:

```bash
npm run ci:issue-theme-gates -- --list
```

Resolve gates from a GitHub label:

```bash
npm run ci:issue-theme-gates -- --label aos-trust-spine
```

Resolve gates from an issue title:

```bash
npm run ci:issue-theme-gates -- --title "gap(g27): add issue-theme gate taxonomy and CI sharding"
```

Resolve gates from changed files:

```bash
npm run ci:issue-theme-gates -- --changed-file .github/workflows/ci.yml --changed-file apps/web/components/dashboard.tsx
```

Resolve gates from the current git diff:

```bash
npm run ci:issue-theme-gates -- --from-git --base-ref origin/main
```

Validate taxonomy consistency and workflow wiring:

```bash
npm run ci:issue-theme-gates -- --assert-workflow
```

Emit machine-readable output:

```bash
npm run ci:issue-theme-gates -- --label aos-shell --json
```

## CI Behavior

The CI workflow runs the taxonomy gate as a lightweight pre-validation job after provenance validation. The staging workflow also validates the taxonomy before staging-specific deployment checks.

The taxonomy deliberately does not skip the integrated validation job. Instead, it gives branch owners a shard-specific gate list so they can run targeted checks early and avoid discovering missing security, architecture, performance, or docs gates only at final integration time.

## Required Closeout

Before closing an issue that uses this taxonomy:

1. Resolve its theme using label, title, or changed file input.
2. Run the returned validation commands that are relevant to the touched surface.
3. Run the parent issue's required gates.
4. Attach the commands and results to the PR or issue closeout.
5. Run full integrated validation before merging a cross-stream branch.
